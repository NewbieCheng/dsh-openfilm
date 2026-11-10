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
