/**
 * SenseVoice-small, through the sherpa-onnx Node addon.
 *
 * Three properties this wrapper is responsible for:
 *  - The engine is loaded once per process. Building a recognizer reads 240 MB of
 *    weights; doing that per segment would make a five-minute transcript look broken.
 *  - Decoding is asynchronous (`decodeAsync`). A synchronous decode would block the
 *    Host's event loop — the panel, the chat stream, everything — for the length of
 *    the segment.
 *  - Missing engine or missing weights are told apart from a decode failure, because
 *    they need different instructions: install a package, fetch a model, or listen
 *    to the audio again.
 */
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

const fail = (message, code) => Object.assign(new Error(message), { code });

/** The addon, loaded lazily so a person who never transcribes never pays for it. */
export function loadSherpa() {
  try {
    return require('sherpa-onnx-node');
  } catch (failure) {
    throw fail(
      '没有安装语音识别引擎 sherpa-onnx-node，本地转写不可用。在插件目录运行 npm install 后重试。',
      'ENGINE_MISSING',
    );
  }
}

export function createSenseVoiceRecognizer({
  model,
  tokens,
  language = 'auto',
  numThreads = 2,
  sherpa = null,
}) {
  if (typeof model !== 'string' || typeof tokens !== 'string') {
    throw fail('缺少模型路径', 'MODEL_MISSING');
  }
  let engine = null;
  const load = () => sherpa ?? loadSherpa();

  const config = () => ({
    featConfig: { sampleRate: 16000, featureDim: 80 },
    modelConfig: {
      // ITN is what restores Chinese punctuation. Without it every line comes back
      // as one unpunctuated run and the sentence splitter has nothing to cut on.
      senseVoice: { model, language, useInverseTextNormalization: 1 },
      tokens,
      numThreads,
      provider: 'cpu',
      debug: 0,
    },
  });

  return {
    name: 'sensevoice-small-int8',
    get loaded() { return engine !== null; },
    /** Build the recognizer now instead of on the first segment. */
    warm() {
      if (engine === null) engine = new (load().OfflineRecognizer)(config());
      return engine;
    },
    async transcribe(samples, { sampleRate = 16000 } = {}) {
      if (!(samples instanceof Float32Array) || samples.length === 0) return { text: '' };
      if (sampleRate !== 16000) {
        throw fail('识别引擎只接受 16 kHz 音频，收到 ' + sampleRate + ' Hz', 'BAD_SAMPLE_RATE');
      }
      const recognizer = this.warm();
      const stream = recognizer.createStream();
      stream.acceptWaveform({ samples, sampleRate });
      let result;
      try {
        // decodeAsync keeps the event loop free; getResult parses the addon's JSON.
        result = await recognizer.decodeAsync(stream);
        if (!result) result = recognizer.getResult?.(stream);
      } catch (failure) {
        throw fail('识别这一段时出错：' + String(failure?.message || failure).slice(0, 200), 'DECODE_FAILED');
      }
      return {
        text: String(result?.text ?? '').trim(),
        tokens: Array.isArray(result?.tokens) ? result.tokens : undefined,
        timestamps: Array.isArray(result?.timestamps) ? result.timestamps : undefined,
      };
    },
  };
}
