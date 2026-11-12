// Declaration order is not a style question here: a Host-side `const` used before
// its declaration is a TDZ ReferenceError that fails the whole plugin ("application:
// failed", blank panel). Both incidents this repo hit are pinned below.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const source = readFileSync(fileURLToPath(new URL('../src/studio-controller.mjs', import.meta.url)), 'utf8');
const at = needle => source.indexOf(needle);

test('trackRoute is declared before the first route that uses it', () => {
  const declared = at('const trackRoute = ');
  assert.ok(declared > 0, 'trackRoute is declared');
  const firstUse = at('trackRoute(registerRoute(');
  assert.ok(firstUse > 0, 'a route uses trackRoute');
  assert.ok(declared < firstUse, 'trackRoute must be initialized before the first route block');
});

test('acpSessions is declared before archiveState reads it', () => {
  const declared = at('const acpSessions = ');
  const read = at('acpSessions.get(projectId)');
  assert.ok(declared > 0 && read > 0);
  assert.ok(declared < read, 'archiveState runs at request time, but a TDZ read is still a crash');
});

test('the MCP endpoint exists before its route handler references it', () => {
  const endpoint = at('const mcpEndpoint = createMcpEndpoint(');
  const route = at("path: '/api/no996-openfilm/mcp'");
  assert.ok(endpoint > 0 && route > 0);
  assert.ok(endpoint < route);
});
