import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseWavHeader, openWav } from '../src/asr-wav.mjs';

/** A minimal 16-bit PCM wav with a LIST chunk in front of the data, like ffmpeg writes. */
function wavBytes({ sampleRate = 16000, channels = 1, samples = [], extraChunk = true }) {
  const frames = samples.length / channels;
  const data = Buffer.alloc(frames * channels * 2);
  samples.forEach((value, index) => data.writeInt16LE(Math.round(Math.max(-1, Math.min(1, value)) * 32767), index * 2));
  const fmt = Buffer.alloc(16);
  fmt.writeUInt16LE(1, 0);
  fmt.writeUInt16LE(channels, 2);
  fmt.writeUInt32LE(sampleRate, 4);
  fmt.writeUInt32LE(sampleRate * channels * 2, 8);
  fmt.writeUInt16LE(channels * 2, 12);
  fmt.writeUInt16LE(16, 14);
  const chunks = [Buffer.from('fmt '), Buffer.from('data')];
  const parts = [];
  const push = (id, body) => {
    const head = Buffer.alloc(8);
    head.write(id, 0, 'ascii');
    head.writeUInt32LE(body.length, 4);
    parts.push(head, body);
  };
  push('fmt ', fmt);
  if (extraChunk) push('LIST', Buffer.alloc(10));
  push('data', data);
  void chunks;
  const body = Buffer.concat(parts);
  const riff = Buffer.alloc(12);
  riff.write('RIFF', 0, 'ascii');
  riff.writeUInt32LE(body.length + 4, 4);
  riff.write('WAVE', 8, 'ascii');
  return Buffer.concat([riff, body]);
}

test('the header is read past the extra chunks ffmpeg writes', () => {
  const header = parseWavHeader(wavBytes({ samples: new Array(16000).fill(0.5) }));
  assert.equal(header.sampleRate, 16000);
  assert.equal(header.channels, 1);
  assert.equal(header.bitsPerSample, 16);
  assert.equal(header.sampleCount, 16000);
  assert.ok(Math.abs(header.durationSec - 1) < 1e-9);
});

test('a data size that ends mid-frame is floored, not rounded up', () => {
  const bytes = wavBytes({ samples: new Array(4).fill(0) });
  const at = bytes.indexOf('data');
  bytes.writeUInt32LE(7, at + 4); // 7 bytes = 3 whole 16-bit frames and a half
  const header = parseWavHeader(bytes);
  assert.equal(header.sampleCount, 3);
  assert.ok(Number.isFinite(header.durationSec));
});

test('rubbish is refused with a readable code', () => {
  assert.throws(() => parseWavHeader(Buffer.from('not a wav at all, really not')), error => error.code === 'BAD_WAV');
  const bytes = wavBytes({ samples: new Array(4).fill(0) });
  bytes.writeUInt16LE(7, 20); // format tag 7 (mu-law)
  assert.throws(() => parseWavHeader(bytes), error => error.code === 'UNSUPPORTED_CODEC');
});

test('windowed reads return exactly the requested span and stay in range', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-wav-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const path = join(dir, 'a.wav');
  await writeFile(path, wavBytes({ samples: new Array(16000).fill(0).map((_, index) => (index % 2 ? -0.5 : 0.5)) }));
  const audio = await openWav(path);
  t.after(() => audio.close());
  assert.equal(audio.sampleRate, 16000);
  assert.equal(audio.sampleCount, 16000);
  const middle = await audio.read(8000, 100);
  assert.equal(middle.length, 100);
  assert.ok(Math.abs(middle[0] - 0.5) < 1e-4);
  assert.ok(Math.abs(middle[1] + 0.5) < 1e-4);
  const tail = await audio.read(15990, 100);
  assert.equal(tail.length, 10, 'clamped to the end of the data');
  assert.equal((await audio.read(16000, 10)).length, 0);
  assert.equal((await audio.read(-5, 4)).length, 4, 'a negative start is clamped, not an error');
});

test('stereo is down-mixed so the recognizer sees one channel', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-wav-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const path = join(dir, 'st.wav');
  await writeFile(path, wavBytes({ channels: 2, samples: [0.5, 0.5, -0.5, -0.5] }));
  const audio = await openWav(path);
  t.after(() => audio.close());
  assert.equal(audio.channels, 2);
  assert.equal(audio.sampleCount, 2);
  const samples = await audio.read(0, 2);
  assert.ok(Math.abs(samples[0] - 0.5) < 1e-4);
  assert.ok(Math.abs(samples[1] + 0.5) < 1e-4);
});
