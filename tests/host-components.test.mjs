import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createHostComponentDetector } from '../src/host-components.mjs';

function fakeSpawn(results, calls = []) {
  return (bin, args, options) => {
    calls.push({ bin, args, options });
    const child = new EventEmitter();
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    child.kill = signal => { child.killedWith = signal; return true; };
    const result = results[bin];
    queueMicrotask(() => {
      if (result.error) child.emit('error', Object.assign(new Error('spawn failed'), { code: result.error }));
      for (const chunk of [].concat(result.output ?? [])) child.stdout.emit('data', Buffer.from(chunk));
      for (const chunk of [].concat(result.stderr ?? [])) child.stderr.emit('data', Buffer.from(chunk));
      if (result.streamError) child[result.streamError].emit('error', new Error('private stream detail'));
      if (result.close !== undefined) child.emit('close', result.close, result.signal ?? null);
    });
    return child;
  };
}
const wrap = (ffmpeg, ffprobe) => ({ platform: process.platform, tools: { ffmpeg, ffprobe } });

test('lazily probes both PATH commands without exposing their output', async () => {
  const calls = [];
  const detect = createHostComponentDetector({ spawn: fakeSpawn({
    ffmpeg: { output: 'ffmpeg version 7\nconfiguration\n', close: 0 },
    ffprobe: { output: 'ffprobe version 7\r\nrest', close: 0 },
  }, calls) });
  assert.equal(calls.length, 0);
  assert.deepEqual(await detect(), wrap(
    { status: 'ok' }, { status: 'ok' },
  ));
  assert.deepEqual(calls.map(call => call.bin), ['ffmpeg', 'ffprobe']);
  for (const call of calls) {
    assert.deepEqual(call.args, ['-version']);
    assert.deepEqual(call.options, { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true, shell: false });
  }
});

test('distinguishes absent, non-executable, and other failed commands', async () => {
  for (const [code, expected] of [
    ['ENOENT', { status: 'missing' }],
    ...['EACCES', 'EPERM', 'ENOEXEC'].map(code => [code, { status: 'unusable', reason: 'not-executable' }]),
    ['EIO', { status: 'unusable', reason: 'spawn-error' }],
  ]) {
    const detect = createHostComponentDetector({ spawn: fakeSpawn({ ffmpeg: { error: code }, ffprobe: { close: 1 } }) });
    assert.deepEqual(await detect(), wrap(expected, { status: 'unusable', reason: 'exit' }));
  }
});

test('times out and kills a hung subprocess before continuing', async () => {
  let first;
  const base = fakeSpawn({ ffmpeg: {}, ffprobe: { output: 'ffprobe version 7\n', close: 0 } });
  const detect = createHostComponentDetector({ timeoutMs: 10, spawn: (...args) => {
    const child = base(...args);
    if (args[0] === 'ffmpeg') first = child;
    return child;
  } });
  assert.deepEqual(await detect(), wrap({ status: 'timeout' }, { status: 'ok' }));
  assert.equal(first.killedWith, 'SIGKILL');
});

test('caps combined stdout and stderr and kills excessive output', async () => {
  const children = [];
  const base = fakeSpawn({ ffmpeg: { output: '123', stderr: '456', close: 0 }, ffprobe: { output: '123456', close: 0 } });
  const spawn = (...args) => { const child = base(...args); children.push(child); return child; };
  const result = await createHostComponentDetector({ spawn, maxOutputBytes: 5 })();
  assert.deepEqual(result, wrap({ status: 'unusable', reason: 'output-limit' }, { status: 'unusable', reason: 'output-limit' }));
  assert.deepEqual(children.map(child => child.killedWith), ['SIGKILL', 'SIGKILL']);
});

test('rejects fake and mismatched version output without leaking it', async () => {
  for (const output of ['', 'private secret', 'ffprobe version 7\n', 'prefix ffmpeg version 7\n', 'ffmpeg version \n', 'ffmpeg versions 7\n']) {
    const detect = createHostComponentDetector({ spawn: fakeSpawn({
      ffmpeg: { output, close: 0 }, ffprobe: { output: 'ffmpeg version 7\n', close: 0 },
    }) });
    assert.deepEqual(await detect(), wrap(
      { status: 'unusable', reason: 'version-mismatch' },
      { status: 'unusable', reason: 'version-mismatch' },
    ));
  }
});

test('handles chunked signatures, output limits, stream errors and exits', async () => {
  const signature = 'ffmpeg version 7';
  const detect = createHostComponentDetector({ maxOutputBytes: signature.length, spawn: fakeSpawn({
    ffmpeg: { output: ['ffm', 'peg version 7'], close: 0 },
    ffprobe: { output: 'ffprobe version 7', close: 0 },
  }) });
  assert.deepEqual(await detect(), wrap({ status: 'ok' }, { status: 'unusable', reason: 'output-limit' }));
  const failing = createHostComponentDetector({ spawn: fakeSpawn({
    ffmpeg: { output: 'ffmpeg version 7', streamError: 'stdout', close: 0 },
    ffprobe: { output: 'ffprobe version 7', close: 0, signal: 'SIGTERM' },
  }) });
  assert.deepEqual(await failing(), wrap({ status: 'unusable', reason: 'stream-error' }, { status: 'unusable', reason: 'exit' }));
  const nonzero = createHostComponentDetector({ spawn: fakeSpawn({
    ffmpeg: { output: 'ffmpeg version 7', close: 1 }, ffprobe: { output: 'ffprobe version 7', close: 1 },
  }) });
  assert.deepEqual(await nonzero(), wrap({ status: 'unusable', reason: 'exit' }, { status: 'unusable', reason: 'exit' }));
  const stderr = createHostComponentDetector({ spawn: fakeSpawn({
    ffmpeg: { stderr: 'ffmpeg version 7\r\n', close: 0 }, ffprobe: { stderr: 'ffprobe version 7\n', close: 0 },
  }) });
  assert.deepEqual(await stderr(), wrap({ status: 'ok' }, { status: 'ok' }));
});

test('rejects invalid limits and classifies synchronous spawn failures', async () => {
  assert.throws(() => createHostComponentDetector({ timeoutMs: 0 }), RangeError);
  assert.throws(() => createHostComponentDetector({ maxOutputBytes: Infinity }), RangeError);
  const detect = createHostComponentDetector({ spawn() { throw Object.assign(new Error(), { code: 'EACCES' }); } });
  assert.deepEqual(await detect(), wrap({ status: 'unusable', reason: 'not-executable' }, { status: 'unusable', reason: 'not-executable' }));
});
