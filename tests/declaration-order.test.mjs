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

test('the MCP endpoint exists before the chat route is mounted', () => {
  const read = path => readFileSync(fileURLToPath(new URL(`../${path}`, import.meta.url)), 'utf8');
  const controller = read('src/studio-controller.mjs');
  const endpoint = controller.indexOf('const mcpEndpoint = createMcpEndpoint(');
  const mount = controller.indexOf('createChatRoutes({');
  assert.ok(endpoint > 0, 'the endpoint is created in the controller');
  assert.ok(mount > 0, 'the chat routes are mounted in the controller');
  assert.ok(endpoint < mount, 'mounting before the endpoint exists would hand over undefined');
  // The path itself moved to the chat module; that is where it must stay unique.
  assert.match(read('src/studio-controller/routes/chat.mjs'), /path: '\/api\/no996-openfilm\/mcp'/);
});

test('the ACP service handle is declared before the RPC handlers read it', () => {
  const declared = at('let acpAgentService = null;');
  const firstRead = at('acpAgentService?.reset?.(projectId)');
  assert.ok(declared > 0 && firstRead > 0);
  assert.ok(declared < firstRead);
  // Assigned once, later in the same scope; a `const` here would be a TDZ trap.
  assert.equal(source.includes('const acpAgentService ='), false);
});
