import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { registerTemplateBridge } from '../src/template-bridge.mjs';
import { templateProjectUrl } from '../src/studio-panel.mjs';

function fixture() {
  let handler, removed = false, calls = [];
  const ctx = {
    connection: { browserPeer: { id: 'browser' }, admit: ({ headers }) => headers.cookie === 'valid' ? { peer: { id: 'browser' } } : headers.cookie === 'api' ? { peer: { id: 'api' } } : { rejection: 401 } },
    webServer: { register(route) { handler = route.handler; return () => { removed = true; }; } },
  };
  const list = async () => [{ id: 'paper-texture', title: 'Paper', description: 'desc', mode: 'style', entry: '/private/path' }];
  const dispose = registerTemplateBridge(ctx, { webOrigin: 'http://127.0.0.1:1234', list, create: async id => { calls.push(id); return { projectId: 'abc123', path: '/private/project', prompt: 'hello' }; }, isDisposed: () => removed });
  async function request(body, overrides = {}) {
    const req = Readable.from([Buffer.from(body)]);
    req.method = overrides.method ?? 'POST';
    req.headers = { host: '127.0.0.1:1234', origin: 'http://127.0.0.1:1234', cookie: 'valid', 'content-type': 'application/json', ...overrides.headers };
    const res = { writeHead(status, headers) { this.status = status; this.headers = headers; return this; }, end(value) { this.body = value; this.writableEnded = true; return this; } };
    await handler(req, res);
    return { status: res.status, body: JSON.parse(res.body) };
  }
  return { request, dispose, calls };
}

test('browser peer lists and creates without exposing paths', async () => {
  const f = fixture();
  assert.deepEqual(await f.request('{"action":"list"}'), { status: 200, body: { templates: [{ id: 'paper-texture', title: 'Paper', description: 'desc', mode: 'style' }] } });
  assert.deepEqual(await f.request('{"action":"create","templateId":"paper-texture"}'), { status: 200, body: { projectId: 'abc123', prompt: 'hello' } });
  assert.deepEqual(f.calls, ['paper-texture']);
  f.dispose();
  assert.equal((await f.request('{"action":"list"}')).status, 503);
});

test('rejects untrusted requests and non-whitelisted inputs', async () => {
  const f = fixture();
  const body = '{"action":"create","templateId":"paper-texture"}';
  for (const [overrides, status] of [
    [{ method: 'GET' }, 405],
    [{ headers: { cookie: '' } }, 401],
    [{ headers: { cookie: 'api' } }, 403],
    [{ headers: { origin: 'http://evil.example' } }, 403],
    [{ headers: { host: 'evil.example:1234' } }, 403],
    [{ headers: { 'content-type': 'text/plain' } }, 415],
  ]) assert.equal((await f.request(body, overrides)).status, status);
  assert.equal((await f.request('x'.repeat(1025))).status, 413);
  assert.equal((await f.request('{"action":"create","templateId":"../x"}')).status, 400);
  assert.equal((await f.request('{"action":"create","templateId":"paper-texture","path":"x"}')).status, 400);
  assert.deepEqual(f.calls, []);
});

test('project navigation accepts only opaque ids', () => {
  assert.equal(templateProjectUrl('http://127.0.0.1:47822/__dsh/open#ticket', 'abc123'), 'http://127.0.0.1:47822/projects/abc123');
  for (const id of ['../evil', 'abc/123', 'https://evil.example', '', null]) assert.throws(() => templateProjectUrl('http://127.0.0.1:47822/', id));
});
