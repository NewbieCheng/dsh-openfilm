// DSH reserves `/api/<plugin>/mcp` for MCP servers declared in the plugin manifest.
// Registering our own handler there never serves a request: the Host answers 400,
// the ACP child reports "initial connection or tool synchronization failed", and
// every chat request fails with ACP_REQUEST_FAILED (no models, no prompt).
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const read = path => readFileSync(fileURLToPath(new URL(`../${path}`, import.meta.url)), 'utf8');
const route = read('src/studio-controller/routes/chat.mjs');
const controller = read('src/studio-controller.mjs');

test('the MCP endpoint does not sit on the reserved `/mcp` path', () => {
  assert.match(route, /path: '\/api\/no996-openfilm\/mcp-host'/);
  assert.doesNotMatch(route, /path: '\/api\/no996-openfilm\/mcp'/);
  assert.doesNotMatch(controller, /\/api\/no996-openfilm\/mcp`/);
});

test('the URL handed to the child is the one the route serves', () => {
  const served = /path: '([^']+)'/.exec(route)?.[1];
  assert.ok(served, 'the route declares a path');
  assert.ok(controller.includes(served), 'the child is handed the same path');
});

test('the endpoint is probed before the child is, so failures are attributable', () => {
  assert.match(controller, /'mcp-self-check'/);
  assert.match(controller, /void fetch\(mcpUrl/);
});
