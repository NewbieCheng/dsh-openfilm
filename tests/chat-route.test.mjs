// The MCP endpoint the ACP child talks to. Extracted from the controller, this
// handler once read `disposed` where the factory only receives `isDisposed` — a
// ReferenceError on every request, answered by the Host as 400, which the child
// reported as "initial connection or tool synchronization failed" and killed the
// whole chat. These cases call the handler the way the Host does.
import assert from 'node:assert/strict';
import test from 'node:test';
import { createChatRoutes } from '../src/studio-controller/routes/chat.mjs';

function fakeResponse() {
  const headers = {};
  return {
    headers,
    status: null,
    body: '',
    setHeader(name, value) { headers[String(name).toLowerCase()] = value; },
    writeHead(status, extra) { this.status = status; Object.assign(headers, extra ?? {}); return this; },
    end(body) { if (body !== undefined) this.body = String(body); return this; },
  };
}

function mount({ disposed = false, endpoint = null } = {}) {
  let route = null;
  const calls = [];
  createChatRoutes({
    register: (value) => { route = value; return () => {}; },
    track: (dispose) => dispose,
    mcpEndpoint: endpoint ?? { handle: async () => ({ status: 200, body: { ok: true } }) },
    isDisposed: () => disposed,
    log: { warn: (event, fields) => calls.push([event, fields]) },
  });
  assert.ok(route, 'the route is registered');
  return { route, calls };
}

function postRequest(body = '{}') {
  return {
    method: 'POST',
    headers: { authorization: 'Bearer test' },
    [Symbol.asyncIterator]: async function* iterate() { yield Buffer.from(body); },
  };
}

test('a non-POST request is answered 405, not a crashed handler', async () => {
  const { route } = mount();
  const res = fakeResponse();
  await route.handler({ method: 'GET', headers: {} }, res);
  assert.equal(res.status, 405);
  assert.equal(res.headers.allow, 'POST');
  assert.equal(res.headers['cache-control'], 'no-store');
});

test('a disposed Host answers 503 instead of half-serving', async () => {
  const { route } = mount({ disposed: true });
  const res = fakeResponse();
  await route.handler(postRequest(), res);
  assert.equal(res.status, 503);
});

test('a POST reaches the endpoint and its answer is written back', async () => {
  const seen = [];
  const { route } = mount({ endpoint: { handle: async ({ headers, body }) => { seen.push({ headers, body }); return { status: 200, body: { id: 'x' } }; } } });
  const res = fakeResponse();
  await route.handler(postRequest('{"jsonrpc":"2.0"}'), res);
  assert.equal(res.status, 200);
  assert.equal(res.headers['content-type'], 'application/json; charset=utf-8');
  assert.equal(res.body, '{"id":"x"}');
  assert.deepEqual(seen, [{ headers: { authorization: 'Bearer test' }, body: '{"jsonrpc":"2.0"}' }]);
});

test('an endpoint that throws becomes 500 and is logged, never a hang', async () => {
  const { route, calls } = mount({ endpoint: { handle: async () => { const error = new Error('boom'); error.code = 'EBOOM'; throw error; } } });
  const res = fakeResponse();
  await route.handler(postRequest(), res);
  assert.equal(res.status, 500);
  assert.deepEqual(calls, [['mcp-failed', { code: 'EBOOM' }]]);
});
