import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { startStudioDebug } from '../src/studio-debug.mjs';

function env(name, value) {
  const previous = process.env[name];
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
  return () => {
    if (previous === undefined) delete process.env[name];
    else process.env[name] = previous;
  };
}

test('the debug window carries the theme and the workbench', async (t) => {
  const upstream = createServer((req, res) => {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end('<html><head><title>editor</title></head><body>ok</body></html>');
  });
  await new Promise((resolve) => upstream.listen(0, '127.0.0.1', resolve));
  const { port } = upstream.address();
  const restoreLab = env('NO996_OPENFILM_STYLE_LAB', '1');
  const restoreTheme = env('NO996_OPENFILM_THEME', undefined);
  const debug = await startStudioDebug({
    editorOrigin: `http://127.0.0.1:${port}`,
    sessionCookie: 'studio_session=test',
    port: 0,
  });
  t.after(async () => {
    await debug.close();
    await new Promise((resolve) => upstream.close(resolve));
    restoreLab();
    restoreTheme();
  });

  const response = await fetch(`${debug.origin}/`);
  const html = await response.text();
  assert.equal(response.status, 200);
  assert.match(html, /<head><style data-no996-theme="studio">/);
  assert.match(html, /data-no996-style-lab/);
  assert.equal(response.headers.get('content-length'), String(Buffer.byteLength(html)));
});

test('NO996_OPENFILM_THEME=0 leaves the debug page untouched', async (t) => {
  const upstream = createServer((req, res) => {
    res.writeHead(200, { 'content-type': 'text/html' });
    res.end('<html><head></head><body>ok</body></html>');
  });
  await new Promise((resolve) => upstream.listen(0, '127.0.0.1', resolve));
  const { port } = upstream.address();
  const restoreLab = env('NO996_OPENFILM_STYLE_LAB', undefined);
  const restoreTheme = env('NO996_OPENFILM_THEME', '0');
  const debug = await startStudioDebug({
    editorOrigin: `http://127.0.0.1:${port}`,
    sessionCookie: 'studio_session=test',
    port: 0,
  });
  t.after(async () => {
    await debug.close();
    await new Promise((resolve) => upstream.close(resolve));
    restoreLab();
    restoreTheme();
  });

  const html = await (await fetch(`${debug.origin}/`)).text();
  assert.doesNotMatch(html, /data-no996-theme/);
  assert.doesNotMatch(html, /data-no996-style-lab/);
});
