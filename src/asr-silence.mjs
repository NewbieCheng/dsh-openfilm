/**
 * Where the speech is, without a model.
 *
 * A talking-head recording is one voice and real pauses; that is a signal an RMS
 * envelope can find reliably, and doing it here keeps the first version free of a
 * second ONNX runtime (or of shipping silero weights just to cut on silence).
 *
 * The two decisions that matter:
 *  - The threshold adapts to the file. A fixed dBFS cutoff cuts off a quiet phone
 *    recording and keeps the hiss of a loud one. Noise floor and peak are measured
 *    from the file itself, with an absolute floor so a file of pure silence does
 *    not become one long "speech" segment.
 *  - Gaps shorter than minSilence are closed and runs shorter than minSpeech are
 *    dropped. Cutting inside a word loses that word; joining two words across a
 *    breath costs nothing.
 */

const EPSILON = 1e-9;

export function rmsOf(samples, start, count) {
  if (!samples || count <= 0) return 0;
  let sum = 0;
  for (let index = 0; index < count; index += 1) {
    const value = samples[start + index];
    sum += value * value;
  }
  return Math.sqrt(sum / count);
}

export function percentile(values, ratio) {
  if (!Array.isArray(values) || values.length === 0) return 0;
  const sorted = values.slice().sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.floor(sorted.length * ratio)));
  return sorted[index];
}

/**
 * Turn a per-frame RMS envelope into speech runs, in seconds.
 * Pure: no IO, so the awkward cases (a click, a 3-second pause, a file that is all
 * hiss) are pinned by tests instead of by listening.
 */
export function findSpeechRuns(rms, {
  frameSec = 0.02,
  minSilenceSec = 0.35,
  minSpeechSec = 0.2,
  absoluteFloor = 0.004,
  peakRatio = 0.08,
  noiseRatio = 3,
} = {}) {
  const frames = Array.isArray(rms) ? rms : [];
  if (frames.length === 0) return [];
  // A three-hour file is ~540k frames; `Math.max(...frames)` overflows the
  // argument limit and throws. Peak is a loop, not a spread.
  let peak = 0;
  for (const value of frames) if (value > peak) peak = value;
  if (!Number.isFinite(peak) || peak < absoluteFloor) return [];

  const noise = percentile(frames, 0.2);
  const threshold = Math.max(noise * noiseRatio, peak * peakRatio, absoluteFloor);
  const mark = frames.map(value => value > threshold);

  const minSilenceFrames = Math.max(1, Math.round(minSilenceSec / frameSec));
  const minSpeechFrames = Math.max(1, Math.round(minSpeechSec / frameSec));

  // Close short gaps: a stop consonant is not a pause.
  for (let index = 0; index < mark.length; index += 1) {
    if (mark[index]) continue;
    let end = index;
    while (end < mark.length && !mark[end]) end += 1;
    const gap = end - index;
    const surrounded = index > 0 && end < mark.length;
    if (surrounded && gap <= minSilenceFrames) {
      for (let fill = index; fill < end; fill += 1) mark[fill] = true;
    }
    index = end;
  }

  const runs = [];
  for (let index = 0; index < mark.length; index += 1) {
    if (!mark[index]) continue;
    let end = index;
    while (end < mark.length && mark[end]) end += 1;
    if (end - index >= minSpeechFrames) runs.push({ start: index * frameSec, end: end * frameSec });
    index = end - 1;
  }
  return runs;
}

/**
 * The segmenter the pipeline sees: reads the wav in chunks so a three-hour file
 * costs one chunk of memory, and reports progress because this is the long part.
 */
export function createSilenceSegmenter({
  frameSec = 0.02,
  framesPerChunk = 250,
  minSilenceSec = 0.35,
  minSpeechSec = 0.2,
} = {}) {
  return {
    name: 'silence',
    async detect(audio, { onProgress = () => {} } = {}) {
      const frameSamples = Math.max(1, Math.round(audio.sampleRate * frameSec));
      const chunkSamples = frameSamples * framesPerChunk;
      const total = audio.sampleCount;
      const rms = [];
      for (let start = 0; start < total; start += chunkSamples) {
        const count = Math.min(total - start, chunkSamples);
        const samples = await audio.read(start, count);
        const whole = Math.floor(samples.length / frameSamples);
        for (let frame = 0; frame < whole; frame += 1) rms.push(rmsOf(samples, frame * frameSamples, frameSamples));
        const tail = samples.length - whole * frameSamples;
        if (tail > 0) rms.push(rmsOf(samples, whole * frameSamples, tail));
        onProgress({ phase: 'segment', done: (start + count) / Math.max(1, total) });
      }
      if (rms.length === 0) return [];
      return findSpeechRuns(rms, { frameSec, minSilenceSec, minSpeechSec });
    },
  };
}
