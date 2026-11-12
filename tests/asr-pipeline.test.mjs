import test from 'node:test';
import assert from 'node:assert/strict';
import { createTranscribePipeline, TRANSCRIBE_LIMITS } from '../src/asr-pipeline.mjs';

const quiet = () => () => new Promise(resolve => setImmediate(resolve));

function harness({
  durationSec = 10,
  hasAudio = true,
  spans = [{ start: 0, end: 4 }, { start: 6, end: 10 }],
  texts = ['第一段。还是第一段。', '第二段。'],
  probeDuration,
} = {}) {
  const calls = { probe: 0, extract: 0, reads: [], transcribed: [], closed: 0, progress: [] };
  const samples = new Float32Array(16000 * Math.max(1, Math.ceil(durationSec)));
  const media = {
    async probe() { calls.probe += 1; return { hasAudio, durationSec: probeDuration ?? durationSec }; },
    async extract(_source, target) { calls.extract += 1; assert.match(target, /audio\.wav$/); },
    async openWav() {
      return {
        sampleRate: 16000,
        sampleCount: samples.length,
        durationSec,
        async read(start, count) { calls.reads.push([start, count]); return samples.slice(start, start + count); },
        async close() { calls.closed += 1; },
      };
    },
  };
  const segmenter = { async detect() { return spans; } };
  const recognizer = {
    async transcribe() { const text = texts[calls.transcribed.length] ?? ''; calls.transcribed.push(text); return { text }; },
  };
  const pipeline = createTranscribePipeline({
    media, segmenter, recognizer, yieldTo: quiet(),
  });
  return { pipeline, calls, samples };
}

const run = (pipeline, calls, extra = {}) => pipeline.run({
  source: 'C:/clips/talk.mp4', workDir: 'C:/tmp/work',
  onProgress: event => calls.progress.push(event.phase), ...extra,
});

test('a file becomes segments, sentences and one text', async () => {
  const { pipeline, calls } = harness();
  const value = await run(pipeline, calls);
  assert.equal(value.segments.length, 2);
  assert.equal(value.sentences.length, 3);
  assert.equal(value.text, '第一段。还是第一段。第二段。');
  assert.equal(value.stats.segments, 2);
  assert.equal(value.stats.chars, 14);
  assert.equal(calls.extract, 1);
  assert.equal(calls.closed, 1, 'the wav handle is always closed');
  assert.ok(value.stats.rtf >= 0);
});

test('each segment is read at its own offset, one decode per segment', async () => {
  // Both spans are longer than the 1.2 s minimum, so normalisation keeps two.
  const { pipeline, calls } = harness({ spans: [{ start: 2, end: 4 }, { start: 6, end: 8 }] });
  await run(pipeline, calls);
  assert.deepEqual(calls.reads, [[32000, 32000], [96000, 32000]]);
  assert.equal(calls.transcribed.length, 2);
});

test('progress names every phase in order', async () => {
  const { pipeline, calls } = harness();
  await run(pipeline, calls);
  const phases = calls.progress.filter((phase, index, all) => index === 0 || phase !== all[index - 1]);
  assert.deepEqual(phases.filter(phase => phase !== 'segment' || true), ['probe', 'extract', 'segment', 'transcribe']);
});

test('an empty decode is skipped, not fatal, and counted', async () => {
  // A real gap, so normalisation cannot join the two spans into one decode.
  const { pipeline, calls } = harness({ spans: [{ start: 0, end: 3 }, { start: 6, end: 9 }], texts: ['第一句。', ''] });
  const value = await run(pipeline, calls);
  assert.equal(value.segments.length, 1);
  assert.equal(value.stats.droppedSegments, 1);
});

test('a file with no audio is refused before any PCM is written', async () => {
  const { pipeline, calls } = harness({ hasAudio: false });
  await assert.rejects(run(pipeline, calls), error => error.code === 'NO_AUDIO');
  assert.equal(calls.extract, 0);
});

test('an over-long file is refused with the minutes in the message', async () => {
  const { pipeline, calls } = harness({ probeDuration: TRANSCRIBE_LIMITS.maxSec + 1 });
  await assert.rejects(run(pipeline, calls), error => error.code === 'TOO_LONG' && /分钟/.test(error.message));
  assert.equal(calls.extract, 0);
});

test('silence, a missing duration and an empty result each fail with their own code', async () => {
  const silence = harness({ spans: [] });
  await assert.rejects(run(silence.pipeline, silence.calls), error => error.code === 'NO_SPEECH');
  const noDuration = harness({ probeDuration: Number.NaN });
  await assert.rejects(run(noDuration.pipeline, noDuration.calls), error => error.code === 'NO_DURATION');
  const nothing = harness({ texts: ['', ''] });
  await assert.rejects(run(nothing.pipeline, nothing.calls), error => error.code === 'EMPTY_TRANSCRIPT');
});

test('an aborted signal stops between segments', async () => {
  const { pipeline, calls } = harness();
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(run(pipeline, calls, { signal: controller.signal }), error => error.code === 'ABORTED');
  assert.equal(calls.transcribed.length, 0);
});
