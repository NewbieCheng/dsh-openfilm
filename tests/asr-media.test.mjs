import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createMediaEdge } from '../src/asr-media.mjs';
import { resolveFfmpeg } from '../src/asr-audio.mjs';

const banner = "  Duration: 00:00:12.50, start: 0.000000, bitrate: 800 kb/s\n  Stream #0:1: Audio: aac (LC), 48000 Hz, stereo, fltp, 128 kb/s";

test('probe and extract both go through the same resolved executable', async (t) => {
  const workDir = await mkdtemp(join(tmpdir(), 'dsh-media-'));
  t.after(() => rm(workDir, { recursive: true, force: true }));
  const calls = [];
  const edge = createMediaEdge({
    ffmpegPath: 'C:/bin/ffmpeg.exe',
    run: async (ffmpeg, args) => {
      calls.push({ ffmpeg, args });
      if (args.includes('-i') && !args.includes('-y')) return { code: 1, stderr: banner };
      return { code: 0, stderr: '' };
    },
  });
  const probe = await edge.probe('C:/clips/a.mp4', { workDir });
  assert.equal(probe.hasAudio, true);
  assert.ok(Math.abs(probe.durationSec - 12.5) < 1e-9);
  await edge.extract('C:/clips/a.mp4', join(workDir, 'audio.wav'), { workDir });
  assert.equal(calls.length, 2);
  assert.equal(calls[0].ffmpeg, 'C:/bin/ffmpeg.exe');
  assert.equal(calls[1].ffmpeg, 'C:/bin/ffmpeg.exe');
  const args = calls[1].args;
  assert.ok(args.includes('-vn'));
  assert.equal(args[args.indexOf('-ac') + 1], '1');
  assert.equal(args[args.indexOf('-ar') + 1], '16000');
  assert.equal(args[args.indexOf('-c:a') + 1], 'pcm_s16le');
  assert.equal(args.at(-1), join(workDir, 'audio.wav'));
});

test('an explicit executable wins over the packaged one and over PATH', async () => {
  assert.equal(await resolveFfmpeg({ env: { NO996_OPENFILM_FFMPEG: 'D:/ff/ffmpeg.exe' } }), 'D:/ff/ffmpeg.exe');
});

test('without an override, a packaged ffmpeg-static is preferred', async () => {
  const importer = async () => ({ default: 'C:/plugins/ffmpeg-static/ffmpeg.exe' });
  assert.equal(await resolveFfmpeg({ env: {}, importer }), 'C:/plugins/ffmpeg-static/ffmpeg.exe');
});

test('with no override and no package, PATH is the last resort', async () => {
  const importer = async () => { throw new Error('not installed'); };
  assert.equal(await resolveFfmpeg({ env: {}, importer }), 'ffmpeg');
});
