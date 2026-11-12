// The MCP endpoint an ACP child calls back for OpenFilm tools. Protocol-level
// tests only: a fake tool stands in, no child process is spawned.
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import test from 'node:test';
import { createMcpEndpoint, createMcpTokens, mcpServerEntry, MCP_PROTOCOL_VERSION } from '../src/mcp-server.mjs';

const token = 'a'.repeat(24);
const agent = { id: 'mcp:proj123456' };
const session = { projectId: 'proj123456', path: 'C:\\project', agent };
const headers = { authorization: `Bearer ${token}` };

function endpoint(extra = {}) {
  const calls = [];
  const tools = [{
    name: 'openfilm_guide',
    description: 'Read the manual',
    parameters: { type: 'object', properties: { topic: { type: 'string' } }, required: ['topic'] },
    output: { render: (_args, value) => [{ type: 'text', text: value.text }] },
    async execute(args, exec) {
      calls.push({ args, agent: exec.agent });
      if (args.topic === 'boom') throw new Error('manual unavailable');
      return { topic: args.topic, text: `manual:${args.topic}` };
    },
  }, {
    name: 'openfilm_plain',
    parameters: { type: 'object', properties: {} },
    async execute() { return { ok: true }; },
  }];
  const mcp = createMcpEndpoint({ tools, resolveToken: candidate => candidate === token ? session : undefined, ...extra });
  return { mcp, calls };
}

const post = async (mcp, payload, extraHeaders = headers) => mcp.handle({ headers: extraHeaders, body: JSON.stringify(payload) });

test('initialize answers with a protocol version, tools capability and identity', async () => {
  const { mcp } = endpoint();
  const answer = await post(mcp, { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'dsh' } } });
  assert.equal(answer.status, 200);
  assert.equal(answer.body.result.protocolVersion, '2025-06-18');
  assert.deepEqual(answer.body.result.capabilities, { tools: {} });
  assert.equal(answer.body.result.serverInfo.name, 'no996-openfilm');
  const fallback = await post(mcp, { jsonrpc: '2.0', id: 2, method: 'initialize', params: {} });
  assert.equal(fallback.body.result.protocolVersion, MCP_PROTOCOL_VERSION);
});

test('initialized is a notification: accepted without a body', async () => {
  const { mcp } = endpoint();
  const answer = await post(mcp, { jsonrpc: '2.0', method: 'notifications/initialized' });
  assert.equal(answer.status, 202);
  assert.equal(answer.body, undefined);
});

test('tools/list exposes JSON schemas and skips tools without execute', async () => {
  const { mcp } = endpoint();
  const answer = await post(mcp, { jsonrpc: '2.0', id: 3, method: 'tools/list' });
  const names = answer.body.result.tools.map(tool => tool.name);
  assert.deepEqual(names, ['openfilm_guide', 'openfilm_plain']);
  assert.equal(answer.body.result.tools[0].inputSchema.required[0], 'topic');
  assert.equal(answer.body.result.tools[1].description, undefined);
});

test('tools/call runs against the token’s project agent and renders output', async () => {
  const { mcp, calls } = endpoint();
  const answer = await post(mcp, { jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'openfilm_guide', arguments: { topic: 'edit' } } });
  assert.deepEqual(calls[0], { args: { topic: 'edit' }, agent });
  assert.deepEqual(answer.body.result.content, [{ type: 'text', text: 'manual:edit' }]);
  assert.equal(answer.body.result.isError, undefined);
  const plain = await post(mcp, { jsonrpc: '2.0', id: 5, method: 'tools/call', params: { name: 'openfilm_plain' } });
  assert.equal(plain.body.result.content[0].text, '{"ok":true}');
});

test('tool failures and unknown tools are results, not transport errors', async () => {
  const { mcp } = endpoint();
  const failed = await post(mcp, { jsonrpc: '2.0', id: 6, method: 'tools/call', params: { name: 'openfilm_guide', arguments: { topic: 'boom' } } });
  assert.equal(failed.status, 200);
  assert.equal(failed.body.result.isError, true);
  assert.match(failed.body.result.content[0].text, /manual unavailable/);
  const unknown = await post(mcp, { jsonrpc: '2.0', id: 7, method: 'tools/call', params: { name: 'nope' } });
  assert.equal(unknown.body.result.isError, true);
  const badArgs = await post(mcp, { jsonrpc: '2.0', id: 8, method: 'tools/call', params: { name: 'openfilm_plain', arguments: [1] } });
  assert.equal(badArgs.body.result.isError, true);
});

test('an unknown method is a JSON-RPC error and batches keep ordering', async () => {
  const { mcp } = endpoint();
  const missing = await post(mcp, { jsonrpc: '2.0', id: 9, method: 'resources/list' });
  assert.equal(missing.body.error.code, -32601);
  const batch = await post(mcp, [
    { jsonrpc: '2.0', method: 'notifications/initialized' },
    { jsonrpc: '2.0', id: 10, method: 'ping' },
    { jsonrpc: '2.0', id: 11, method: 'tools/list' },
  ]);
  assert.equal(batch.body.length, 2);
  assert.equal(batch.body[0].id, 10);
  assert.equal(batch.body[1].id, 11);
});

test('a missing or unknown token is refused before any protocol work', async () => {
  const { mcp } = endpoint();
  const anonymous = await post(mcp, { jsonrpc: '2.0', id: 1, method: 'tools/list' }, {});
  assert.equal(anonymous.status, 401);
  const wrong = await post(mcp, { jsonrpc: '2.0', id: 1, method: 'tools/list' }, { authorization: `Bearer ${'b'.repeat(24)}` });
  assert.equal(wrong.status, 401);
  const malformed = await post(mcp, { jsonrpc: '2.0', id: 1, method: 'tools/list' }, { authorization: 'Bearer short' });
  assert.equal(malformed.status, 401);
});

test('the ACP server entry names the endpoint and carries the bearer token', () => {
  const entry = mcpServerEntry({ url: 'http://127.0.0.1:48096/api/no996-openfilm/mcp', token });
  assert.equal(entry.type, 'http');
  assert.equal(entry.name, 'no996-openfilm');
  assert.deepEqual(entry.headers, [{ name: 'Authorization', value: `Bearer ${token}` }]);
});

test('tokens are unique, expirable and revocable per project', () => {
  let clock = 1_000;
  const tokens = createMcpTokens({ randomBytes: size => randomBytes(size), now: () => clock, ttlMs: 100 });
  const first = tokens.mint({ projectId: 'proj123456', path: 'C:\\p', agent });
  const second = tokens.mint({ projectId: 'proj123456', path: 'C:\\p', agent });
  assert.notEqual(first, second);
  assert.equal(tokens.resolve(first).projectId, 'proj123456');
  clock += 101;
  assert.equal(tokens.resolve(first), undefined);
  const third = tokens.mint({ projectId: 'proj123456', path: 'C:\\p', agent });
  tokens.revokeProject('proj123456');
  assert.equal(tokens.resolve(third), undefined);
  assert.equal(tokens.size(), 0);
});
