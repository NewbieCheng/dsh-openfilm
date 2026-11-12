import test from 'node:test';
import assert from 'node:assert/strict';
import { parseProbeOutput } from '../src/asr-audio.mjs';

const banner = `ffmpeg version 6.1.1 Copyright (c) 2000-2023 the FFmpeg developers
Input #0, mov,mp4,m4a,3gp,3g2,mj2, from 'C:\\clips\\talk.mp4':
  Metadata:
    major_brand     : isom
    creation_time   : 2026-01-02T03:04:05.000000Z
  Duration: 00:10:23.40, start: 0.000000, bitrate: 802 kb/s
  Stream #0:0[0x1](und): Video: h264 (High) (avc1 / 0x31637661), yuv420p(tv, bt709), 1920x1080, 2000 kb/s, 30 fps, 30 tbr, 15360 tbn
  Stream #0:1[0x2](und): Audio: aac (LC) (mp4a / 0x6134706D), 48000 Hz, stereo, fltp, 128 kb/s`;

test('a normal phone recording is probed for duration, rate and channels', () => {
  const probe = parseProbeOutput(banner);
  assert.ok(Math.abs(probe.durationSec - 623.4) < 1e-6);
  assert.equal(probe.hasAudio, true);
  assert.equal(probe.audioSampleRate, 48000);
  assert.equal(probe.audioChannels, 2);
  assert.equal(probe.unreadable, false);
});

test('a silent screen recording is reported as having no audio, not as broken', () => {
  const probe = parseProbeOutput("Input #0, matroska,webm, from 'screen.webm':\n  Duration: 00:00:41.02, start: 0.000000, bitrate: 400 kb/s\n  Stream #0:0: Video: vp9, yuv420p, 1280x720, 30 fps");
  assert.equal(probe.hasAudio, false);
  assert.ok(Math.abs(probe.durationSec - 41.02) < 1e-6);
});

test('a corrupt file is flagged rather than silently treated as empty', () => {
  assert.equal(parseProbeOutput("clip.mp4: Invalid data found when processing input").unreadable, true);
  assert.equal(parseProbeOutput("movie.mp4: moov atom not found").unreadable, true);
});

test('an hour-long file crosses the clock correctly', () => {
  assert.ok(Math.abs(parseProbeOutput('  Duration: 01:02:03.50, start: 0.0').durationSec - 3723.5) < 1e-6);
});

test('other channel layouts still yield a count', () => {
  const probe = parseProbeOutput('  Stream #0:1: Audio: pcm_s16le, 44100 Hz, 6 channels, s16, 423 kb/s');
  assert.equal(probe.audioChannels, 6);
  assert.equal(probe.audioSampleRate, 44100);
});
