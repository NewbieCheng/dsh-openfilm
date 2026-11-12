import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { startStudioProxy } from '../src/studio-proxy.mjs';

/*
 * The transcript routes are the only way an image or a product reaches a person's
 * desktop, so their fences matter more than their happy path. This boots the real
 * proxy against two fake Studio servers and calls it the way the page does.
 */
const KEY = 'a'.repeat(48);

function listen(server) {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve(server.address().port));
  });
}
const close = server => new Promise(resolve => { server.closeAllConnections?.(); server.close(() => resolve()); });

async function boot(options = {}) {
  const editorUp = createServer((req, res) => { res.writeHead(200, { 'content-type': 'application/json' }); res.end('{}'); });
  const filmUp = createServer((req, res) => { res.writeHead(200, { 'content-type': 'text/html' }); res.end(''); });
  const editorPort = await listen(editorUp);
  const filmPort = await listen(filmUp);
  const previous = process.env.NO996_OPENFILM_EDITOR_PORT;
  process.env.NO996_OPENFILM_EDITOR_PORT = '0';
  const proxy = await startStudioProxy({
    upstream: { origin: `http://127.0.0.1:${editorPort}`, filmOrigin: `http://localhost:${filmPort}`, key: KEY },
    authenticateBrowser: () => true,
    webOrigin: 'http://127.0.0.1:5999',
    officialShell: true,
    officialRpc: async () => ({}),
    authorizeOfficialProject: options.authorize ?? (async () => true),
    attachOfficialEvents: async () => {},
    readProjectFile: options.read,
    openProjectFile: options.open,
  });
  if (previous === undefined) delete process.env.NO996_OPENFILM_EDITOR_PORT;
  else process.env.NO996_OPENFILM_EDITOR_PORT = previous;
  return {
    origin: proxy.bootstrapData().editorOrigin,
    async close() { await proxy.close(); await Promise.all([close(editorUp), close(filmUp)]); },
  };
}

const get = (origin, path) => fetch(origin + path, { headers: { 'sec-fetch-site': 'same-origin' } });

test('a verified project picture is served with the right type', async (t) => {
  const bytes = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
  const studio = await boot({ read: async () => ({ bytes, type: 'image/png' }) });
  t.after(() => studio.close());
  const response = await get(studio.origin, '/__dsh/project-file?projectId=film123&path=assets%2Fcontact.png');
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('content-type'), 'image/png');
  assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
  assert.deepEqual(Buffer.from(await response.arrayBuffer()), bytes);
});

test('a project the Host refuses is not served', async (t) => {
  const studio = await boot({ authorize: async () => false, read: async () => ({ bytes: Buffer.from('x'), type: 'image/png' }) });
  t.after(() => studio.close());
  const response = await get(studio.origin, '/__dsh/project-file?projectId=film123&path=assets%2Fcontact.png');
  assert.equal(response.status, 403);
});

test('a path the reader refuses looks like a missing file, not a leak', async (t) => {
  const studio = await boot({ read: async () => { throw new Error('PROJECT_FILE_PATH'); } });
  t.after(() => studio.close());
  const response = await get(studio.origin, '/__dsh/project-file?projectId=film123&path=..%2Fsecret.png');
  assert.equal(response.status, 404);
});

test('opening a product is a same-origin JSON POST and nothing more', async (t) => {
  const calls = [];
  const studio = await boot({ open: async request => { calls.push(request); } });
  t.after(() => studio.close());
  const response = await fetch(studio.origin + '/__dsh/open-file', {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: studio.origin, 'sec-fetch-site': 'same-origin' },
    body: JSON.stringify({ projectId: 'film123', path: 'film.mp4' }),
  });
  assert.equal(response.status, 204);
  assert.deepEqual(calls, [{ projectId: 'film123', path: 'film.mp4', reveal: false }]);

  const wrongOrigin = await fetch(studio.origin + '/__dsh/open-file', {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: 'http://evil.example', 'sec-fetch-site': 'same-origin' },
    body: JSON.stringify({ projectId: 'film123', path: 'film.mp4' }),
  });
  assert.equal(wrongOrigin.status, 403);
  assert.equal(calls.length, 1);
});

test('the first-run wizard channels do not need a project scope', async (t) => {
  const studio = await boot({ authorize: async () => false });
  t.after(() => studio.close());
  const call = channel => fetch(studio.origin + '/__dsh/official-rpc', {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: studio.origin, 'sec-fetch-site': 'same-origin' },
    body: JSON.stringify({ channel, payload: {} }),
  });
  for (const channel of ['system:check', 'system:install', 'asr:status', 'asr:install']) {
    assert.equal((await call(channel)).status, 200, channel + ' must work before a project exists');
  }
  // Everything else still needs a project the Host vouches for.
  assert.equal((await call('chat:turn')).status, 403);
});

