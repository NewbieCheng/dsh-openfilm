import test from 'node:test';
import assert from 'node:assert/strict';
import { findSpeechRuns, rmsOf, percentile, createSilenceSegmenter } from '../src/asr-silence.mjs';

const loud = 0.1;
const hush = 0.0005;

test('two phrases split by a real pause become two runs', () => {
  const frames = [...new Array(20).fill(hush), ...new Array(30).fill(loud), ...new Array(40).fill(hush), ...new Array(30).fill(loud), ...new Array(10).fill(hush)];
  const runs = findSpeechRuns(frames, { frameSec: 0.02 });
  assert.equal(runs.length, 2);
  assert.ok(Math.abs(runs[0].start - 0.4) < 1e-9);
  assert.ok(Math.abs(runs[0].end - 1.0) < 1e-9);
  assert.ok(Math.abs(runs[1].start - 1.8) < 1e-9);
});

test('a stop consonant does not split a phrase', () => {
  const frames = [...new Array(10).fill(hush), ...new Array(10).fill(loud), ...new Array(3).fill(hush), ...new Array(10).fill(loud), ...new Array(10).fill(hush)];
  assert.equal(findSpeechRuns(frames, { frameSec: 0.02, minSilenceSec: 0.35 }).length, 1);
});

test('a blip below the minimum speech length is dropped', () => {
  const frames = [...new Array(10).fill(hush), loud, ...new Array(10).fill(hush)];
  assert.deepEqual(findSpeechRuns(frames, { frameSec: 0.02 }), []);
});

test('a file that is only hiss has no speech at all', () => {
  assert.deepEqual(findSpeechRuns(new Array(500).fill(0.0002)), []);
  assert.deepEqual(findSpeechRuns([]), []);
});

test('a quiet recording is still found, because the threshold follows the file', () => {
  const quietLoud = 0.02;
  const frames = [...new Array(10).fill(0.0002), ...new Array(40).fill(quietLoud), ...new Array(10).fill(0.0002)];
  assert.equal(findSpeechRuns(frames, { frameSec: 0.02 }).length, 1);
});

test('rms and percentile are the plain definitions', () => {
  assert.ok(Math.abs(rmsOf(new Float32Array([1, -1, 1, -1]), 0, 4) - 1) < 1e-9);
  assert.equal(rmsOf(new Float32Array(0), 0, 0), 0);
  assert.equal(percentile([3, 1, 2], 0.5), 2);
  assert.equal(percentile([], 0.5), 0);
});

test('the segmenter reads the file in chunks and reports progress', async () => {
  const samples = new Float32Array(16000 * 3);
  for (let index = 0; index < 16000; index += 1) samples[index] = 0.2;           // 0–1s speech
  for (let index = 16000 * 2; index < 16000 * 3; index += 1) samples[index] = 0.2; // 2–3s speech
  const audio = {
    sampleRate: 16000,
    sampleCount: samples.length,
    async read(start, count) { return samples.slice(start, start + count); },
  };
  const seen = [];
  const runs = await createSilenceSegmenter({ framesPerChunk: 25 }).detect(audio, {
    onProgress: event => seen.push(event.phase),
  });
  assert.equal(seen.length > 0, true);
  assert.equal(new Set(seen).size, 1);
  assert.equal(seen[0], 'segment');
  assert.equal(runs.length, 2);
  assert.ok(runs[1].start > 1.5);
});
