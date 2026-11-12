import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { startStudioProxy } from '../src/studio-proxy.mjs';

const KEY = 'b'.repeat(48);

function listen(server) {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve(server.address().port));
  });
}

function env(name, value) {
  const previous = process.env[name];
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
  return () => {
    if (previous === undefined) delete process.env[name];
    else process.env[name] = previous;
  };
}

async function boot() {
  const html = '<!doctype html><html><head><title>t</title></head><body>ok</body></html>';
  const editorUp = createServer((req, res) => {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(html);
  });
  const filmUp = createServer((req, res) => {
    res.writeHead(200, { 'content-type': 'text/html' });
    res.end('');
  });
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
  });
  if (previous === undefined) delete process.env.NO996_OPENFILM_EDITOR_PORT;
  else process.env.NO996_OPENFILM_EDITOR_PORT = previous;
  return {
    origin: proxy.bootstrapData().editorOrigin,
    async close() {
      await proxy.close();
      await Promise.all([new Promise((resolve) => editorUp.close(resolve)), new Promise((resolve) => filmUp.close(resolve))]);
    },
  };
}

const get = (origin, path) => fetch(origin + path, { headers: { 'sec-fetch-site': 'same-origin' } });

test('the shell route gets the shell theme, project routes get the editor theme', async (t) => {
  const studio = await boot();
  const restoreTheme = env('NO996_OPENFILM_THEME', undefined);
  const restoreLab = env('NO996_OPENFILM_STYLE_LAB', undefined);
  t.after(async () => {
    restoreTheme();
    restoreLab();
    await studio.close();
  });

  const shell = await (await get(studio.origin, '/')).text();
  assert.match(shell, /data-no996-theme="shell"/);
  assert.match(shell, /--n996-accent/);
  assert.match(shell, /<title>不加班剪辑<\/title>/);
  assert.doesNotMatch(shell, /data-no996-theme="studio"/);

  const editor = await (await get(studio.origin, '/projects/abc123')).text();
  assert.match(editor, /data-no996-theme="studio"/);
});

test('the workbench rides along only in developer mode', async (t) => {
  const studio = await boot();
  const restoreTheme = env('NO996_OPENFILM_THEME', undefined);
  const restoreLab = env('NO996_OPENFILM_STYLE_LAB', '1');
  t.after(async () => {
    restoreTheme();
    restoreLab();
    await studio.close();
  });
  const html = await (await get(studio.origin, '/projects/abc123')).text();
  assert.match(html, /data-no996-style-lab/);
});

test('the kill switch removes the theme from the page', async (t) => {
  const studio = await boot();
  const restoreTheme = env('NO996_OPENFILM_THEME', '0');
  const restoreLab = env('NO996_OPENFILM_STYLE_LAB', undefined);
  t.after(async () => {
    restoreTheme();
    restoreLab();
    await studio.close();
  });
  const html = await (await get(studio.origin, '/')).text();
  assert.doesNotMatch(html, /data-no996-theme/);
});
