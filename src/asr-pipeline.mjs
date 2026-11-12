/**
 * The one sequence that turns a file into a transcript.
 *
 * Everything expensive is injected — the media edge, the segmenter, the
 * recognizer — for one reason: this is where the rules live (refuse early, cut on
 * silence, keep going on a segment the model misread), and rules are only cheap to
 * test when no model has to run. `node --test` here is a stub recognizer; the real
 * one is exercised by hand, and its numbers belong in the checklist, not in a unit
 * test pretending to be one.
 *
 * Failure policy, in order of importance:
 *  1. A file with no audio, or with the wrong conditions for this machine, is
 *     refused before any PCM is written (probing is cheap, decoding is not).
 *  2. A segment the model returns nothing for is skipped, not fatal: one dropped
 *     breath must not cost a twenty-minute transcript.
 *  3. When everything is empty, say so plainly — an empty transcript is a
 *     diagnosable outcome (silence, wrong stream), not a success.
 */
import { join } from 'node:path';
import { normalizeSegments } from './asr-segments.mjs';
import { splitSentences, ribbonTimes, round3, countChars } from './asr-text.mjs';

export const TRANSCRIBE_LIMITS = Object.freeze({
  minSec: 0.5,
  maxSec: 3 * 60 * 60,
  maxSegments: 20_000,
});

const fail = (message, code) => Object.assign(new Error(message), { code });

/** The same loop yield the Host needs: a long decode must not freeze the panel. */
const defaultYield = () => new Promise(resolve => setImmediate(resolve));

/** Segments in, text and sentences out — one implementation for the pipeline and for a refined transcript. */
export function assembleTranscript(segments) {
  const spoken = (Array.isArray(segments) ? segments : [])
    .filter(segment => typeof segment?.text === 'string' && segment.text.length > 0);
  const sentences = [];
  for (const segment of spoken) {
    const parts = splitSentences(segment.text);
    const placed = ribbonTimes(parts.length > 0 ? parts : [segment.text], segment.start, segment.end);
    for (const sentence of placed) {
      sentences.push({ start: round3(sentence.start), end: round3(sentence.end), text: sentence.text });
    }
  }
  return { text: spoken.map(segment => segment.text).join(''), sentences, segments: spoken };
}

export function createTranscribePipeline({
  media,
  segmenter,
  recognizer,
  limits = TRANSCRIBE_LIMITS,
  yieldTo = defaultYield,
} = {}) {
  if (!media) throw new TypeError('A media edge is required');
  if (!segmenter) throw new TypeError('A segmenter is required');
  if (!recognizer) throw new TypeError('A recognizer is required');

  async function run({ source, workDir, signal, onProgress = () => {} } = {}) {
    if (typeof source !== 'string' || source.length === 0) throw fail('需要一个音频或视频文件路径', 'NO_SOURCE');
    if (typeof workDir !== 'string' || workDir.length === 0) throw fail('缺少临时目录', 'NO_WORKDIR');
    const started = Date.now();
    const tick = (phase, extra) => {
      try { onProgress({ phase, ...extra }); } catch { /* a progress listener must never fail a transcript */ }
    };

    tick('probe', { source });
    const probe = await media.probe(source, { workDir, signal });
    if (!probe || probe.hasAudio !== true) throw fail('这个文件没有音轨：' + source, 'NO_AUDIO');
    const reported = Number(probe.durationSec);
    if (!Number.isFinite(reported) || reported <= 0) {
      throw fail('读不出这条音轨的时长，文件可能已损坏', 'NO_DURATION');
    }
    if (reported < limits.minSec) throw fail('音频只有 ' + reported.toFixed(2) + ' 秒，太短了', 'TOO_SHORT');
    if (reported > limits.maxSec) {
      throw fail(
        '音轨长 ' + Math.round(reported / 60) + ' 分钟，超过 ' + Math.round(limits.maxSec / 60)
          + ' 分钟上限。先切成几段再转，或者指定起止时间',
        'TOO_LONG',
      );
    }

    const target = join(workDir, 'audio.wav');
    tick('extract', { durationSec: reported });
    await media.extract(source, target, { workDir, signal });

    const audio = await media.openWav(target);
    let audioSec;
    let spans;
    const segments = [];
    try {
      audioSec = round3(audio.durationSec);
      if (!Number.isFinite(audioSec) || audioSec <= 0) throw fail('抽出来的音轨是空的', 'EMPTY_AUDIO');
      if (audioSec > limits.maxSec + 1) throw fail('抽出的音轨超出上限，已停止', 'TOO_LONG');

      tick('segment', { durationSec: audioSec });
      const raw = await segmenter.detect(audio, {
        signal,
        onProgress: ({ done } = {}) => tick('segment', { durationSec: audioSec, progress: Number.isFinite(done) ? done : undefined }),
      });
      spans = normalizeSegments(raw, { durationSec: audio.durationSec });
      if (spans.length === 0) {
        throw fail('这条音轨里没有听到人声（全段静音或音量太低），没有可转写的内容', 'NO_SPEECH');
      }
      if (spans.length > limits.maxSegments) {
        throw fail('切出了 ' + spans.length + ' 段，超过上限 ' + limits.maxSegments + ' 段', 'TOO_MANY_SEGMENTS');
      }

      for (let index = 0; index < spans.length; index += 1) {
        if (signal?.aborted) throw fail('已取消', 'ABORTED');
        const span = spans[index];
        const from = Math.floor(span.start * audio.sampleRate);
        const count = Math.max(1, Math.ceil((span.end - span.start) * audio.sampleRate));
        const samples = await audio.read(from, count);
        let said = '';
        if (samples.length > 0) {
          const result = await recognizer.transcribe(samples, { sampleRate: audio.sampleRate, signal });
          said = String(result?.text ?? '').replace(/\s+/g, ' ').trim();
        }
        segments.push({ start: span.start, end: span.end, text: said });
        tick('transcribe', { done: index + 1, total: spans.length, durationSec: audioSec });
        await yieldTo();
      }
    } finally {
      await audio.close().catch(() => undefined);
    }

    const spoken = segments.filter(segment => segment.text.length > 0);
    const text = spoken.map(segment => segment.text).join('');
    if (text.length === 0) {
      throw fail('模型没有听出任何文字：音轨可能是纯音乐、强噪声，或者说的不是支持的语言', 'EMPTY_TRANSCRIPT');
    }

    const { sentences } = assembleTranscript(spoken);

    const elapsedMs = Date.now() - started;
    return {
      durationSec: audioSec,
      segments: spoken,
      sentences,
      text,
      stats: {
        elapsedMs,
        audioSec,
        rtf: audioSec > 0 ? Math.round((elapsedMs / 1000 / audioSec) * 1000) / 1000 : null,
        segments: spoken.length,
        droppedSegments: segments.length - spoken.length,
        sentences: sentences.length,
        chars: countChars(text),
      },
    };
  }

  return { run };
}
