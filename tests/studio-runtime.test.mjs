import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createStudioRuntime, OPENFILM_VERSION } from '../src/studio-runtime.mjs';

const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };

test('health observes a lost upstream and the next start cleans up and recovers', async () => {
  let server, starts = 0, closes = 0, disposals = 0;
  const runtime = createStudioRuntime({
    loadStudio: async () => async () => {
      starts++;
      server = createServer((req, res) => {
        assert.equal(req.url, '/api/health');
        res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify({ product: 'openfilm-studio', version: OPENFILM_VERSION, app: true, filmOrigin: 'http://127.0.0.1:12345' }));
      });
      await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
      const current = server;
      return { port: server.address().port, filmOrigin: 'http://127.0.0.1:12345', close: async () => { closes++; await new Promise(resolve => current.close(resolve)); } };
    },
    attach: () => () => { disposals++; },
  });
  try {
    await runtime.ensureStarted();
    assert.equal((await runtime.health()).running, true);
    await new Promise(resolve => server.close(resolve));
    assert.deepEqual(await runtime.health(), { running: false, port: null });
    assert.equal(starts, 1);
    const [one, two] = await Promise.all([runtime.ensureStarted(), runtime.ensureStarted()]);
    assert.equal(one.running, true);
    assert.deepEqual(one, two);
    assert.equal(starts, 2);
    assert.equal(closes, 1);
    assert.equal(disposals, 1);
  } finally { await runtime.close(); }
  assert.equal(closes, 2);
  assert.equal(disposals, 2);
});

test('failed cleanup blocks restart until explicit close succeeds', async () => {
  let starts = 0, attempts = 0, disposed = 0;
  const runtime = createStudioRuntime({
    checkHealth: async () => { throw new Error('secret'); },
    loadStudio: async () => async () => { starts++; return { port: 1, close: async () => { if (++attempts === 1) throw new Error('secret'); } }; },
    attach: () => () => { disposed++; },
  });
  await runtime.ensureStarted();
  await assert.rejects(runtime.ensureStarted(), { code: 'STUDIO_CLOSE', message: 'OpenFilm Studio could not close' });
  await assert.rejects(runtime.ensureStarted(), { code: 'STUDIO_CLOSE' });
  assert.equal(starts, 1);
  assert.equal(disposed, 1);
  await runtime.close();
  await runtime.ensureStarted();
  assert.equal(starts, 2);
  await runtime.close();
});

test('close waits for concurrent health and recovery without duplicate starts', async () => {
  const probe = deferred();
  const entered = deferred();
  let starts = 0, closes = 0;
  const runtime = createStudioRuntime({
    checkHealth: async () => { entered.resolve(); return probe.promise; },
    loadStudio: async () => async () => ({ port: ++starts, close: () => { closes++; } }),
  });
  await runtime.ensureStarted();
  const restart = runtime.ensureStarted();
  const another = runtime.ensureStarted();
  await entered.promise;
  const closing = runtime.close();
  probe.resolve(false);
  await Promise.all([restart, another, closing]);
  assert.equal(starts, 2);
  assert.equal(closes, 2);
  assert.deepEqual(runtime.status(), { running: false, port: null });
});

test('late failed health probe cannot invalidate a replacement instance', async () => {
  const probe = deferred();
  let starts = 0;
  const runtime = createStudioRuntime({
    checkHealth: () => probe.promise,
    loadStudio: async () => async () => ({ port: ++starts, close() {} }),
  });
  await runtime.ensureStarted();
  const oldHealth = runtime.health();
  await runtime.close();
  await runtime.ensureStarted();
  probe.resolve(false);
  assert.deepEqual(await oldHealth, { running: true, port: 2 });
  await runtime.close();
});
