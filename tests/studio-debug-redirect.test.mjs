import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startLocalConsole } from '../src/studio-debug-redirect.mjs';

test('loopback debug console refuses unauthenticated project creation', async () => {
  let calls = 0;
  const consoleServer = await startLocalConsole({
    port: 0,
    templates: async () => [{ id: 'example', title: 'Example', mode: 'film' }],
    create: async () => { calls++; return { projectId: 'unexpected' }; },
  });
  try {
    const page = await fetch(consoleServer.url);
    assert.equal(page.status, 200);
    const body = await page.text();
    assert.match(body, /Example/);
    assert.doesNotMatch(body, /data-id="example"/);
    for (const headers of [{}, { origin: 'https://example.com' }]) {
      const response = await fetch(`${consoleServer.url}create?template=example`, { method: 'POST', headers });
      assert.equal(response.status, 403);
    }
    assert.equal(calls, 0);
  } finally {
    await consoleServer.close();
  }
});

test('the console answers a ticketed editor address for custom-scheme pages', async () => {
  // `dsh-app://app` cannot reach /api/... on the Host, so the panel asks this
  // loopback console instead. It must be readable cross-origin (no credential
  // is involved) and must expose the ticket exactly once per call.
  const console_ = await startLocalConsole({
    port: 0,
    templates: async () => [],
    editorUrl: async () => 'http://127.0.0.1:47822/__dsh/open#abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQ',
  });
  try {
    const response = await fetch(`${console_.url}api/studio-url`, { headers: { origin: 'dsh-app://app' } });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('access-control-allow-origin'), '*');
    assert.equal(response.headers.get('cache-control'), 'no-store');
    const body = await response.json();
    assert.equal(body.origin, 'http://127.0.0.1:47822');
    assert.equal(body.ticket, 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQ');
  } finally { await console_.close(); }
});
