import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { startStudioProxy } from '../src/studio-proxy.mjs';

const KEY = 'c'.repeat(48);

function listen(server) {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve(server.address().port));
  });
}

async function boot(handler, options = {}) {
  const editorUp = createServer(handler);
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
    authorizeOfficialProject: async () => true,
    attachOfficialEvents: async () => {},
    ...options,
  });
  if (previous === undefined) delete process.env.NO996_OPENFILM_EDITOR_PORT;
  else process.env.NO996_OPENFILM_EDITOR_PORT = previous;
  return {
    origin: proxy.bootstrapData().editorOrigin,
    async close() {
      await proxy.close();
      await Promise.all([new Promise((r) => editorUp.close(r)), new Promise((r) => filmUp.close(r))]);
    },
  };
}

test('a raw child-process failure is replaced with a clear, non-retryable answer', async (t) => {
  const raw = JSON.stringify({ error: "Command failed: powershell.exe -NoProfile -NonInteractive -Command $ErrorActionPreference = 'Stop'" });
  const studio = await boot((req, res) => {
    res.writeHead(500, { 'content-type': 'application/json; charset=utf-8' });
    res.end(raw);
  });
  t.after(() => studio.close());
  const response = await fetch(studio.origin + '/api/projects/abc123', {
    method: 'DELETE',
    headers: { 'sec-fetch-site': 'same-origin', origin: studio.origin },
  });
  assert.equal(response.status, 409);
  const body = await response.json();
  assert.equal(body.code, 'no996-command-failed');
  assert.match(body.error, /占用/);
  assert.doesNotMatch(JSON.stringify(body), /powershell|Command failed/);
});

test('an ordinary upstream error keeps its own message and status', async (t) => {
  const studio = await boot((req, res) => {
    res.writeHead(500, { 'content-type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ error: 'the disk is full' }));
  });
  t.after(() => studio.close());
  const response = await fetch(studio.origin + '/api/projects/abc123', {
    method: 'DELETE',
    headers: { 'sec-fetch-site': 'same-origin', origin: studio.origin },
  });
  assert.equal(response.status, 500);
  assert.deepEqual(await response.json(), { error: 'the disk is full' });
});

test('the project conversation is stopped before Studio is asked to delete', async (t) => {
  const order = [];
  const studio = await boot((req, res) => {
    order.push('upstream');
    res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
    res.end('{}');
  }, {
    beforeProjectDelete: async (id) => {
      order.push(`hook:${id}`);
      await new Promise((resolve) => setTimeout(resolve, 30));
    },
  });
  t.after(() => studio.close());
  const response = await fetch(studio.origin + '/api/projects/abc123', {
    method: 'DELETE',
    headers: { 'sec-fetch-site': 'same-origin', origin: studio.origin },
  });
  assert.equal(response.status, 200);
  assert.deepEqual(order, ['hook:abc123', 'upstream']);
});
