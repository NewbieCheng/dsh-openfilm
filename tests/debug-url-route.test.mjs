// debug-url decides which URL the style/inspection window opens. The interesting
// parts are not the URL: they are the three refusals (method, foreign peer,
// disposed Host) and the rule that an existing bridge is reused rather than
// redeemed twice.
import assert from 'node:assert/strict';
import test from 'node:test';
import { createDebugUrlRoute } from '../src/studio-controller/routes/debug-url.mjs';

const BROWSER = { id: 'browser' };
const PATH = '/api/no996-openfilm/debug-url';

function fakeRes() {
  return {
    headers: {}, status: 0, body: undefined, headersSent: false, writableEnded: false,
    setHeader(name, value) { this.headers[name] = value; },
    writeHead(status, headers = {}) { this.status = status; this.headersSent = true; Object.assign(this.headers, headers); return this; },
    end(body) { if (body !== undefined) this.body = body; this.writableEnded = true; },
  };
}

function mount(overrides = {}) {
  const routes = [];
  const state = { bridge: undefined };
  const deps = {
    ctx: { connection: { admit: () => ({ peer: BROWSER }), browserPeer: BROWSER } },
    register: route => { routes.push(route); return () => {}; },
    track: dispose => dispose,
    officialShell: false,
    isDisposed: () => false,
    getUpstream: () => ({ port: 1234 }),
    ensureStudioStarted: async () => {},
    proxyFor: async () => ({
      bootstrapData: () => ({ ticket: 't-1', editorOrigin: 'http://127.0.0.1:5555', webOrigin: 'http://127.0.0.1:47822' }),
    }),
    getBridge: () => state.bridge,
    setBridge: next => { state.bridge = next; },
    ...overrides,
  };
  createDebugUrlRoute(deps);
  return { route: routes.find(item => item.path === PATH), state };
}

const post = (headers = {}) => ({ method: 'POST', headers: { origin: 'http://127.0.0.1:47822', ...headers }, url: PATH });

test('without a ticket the window opens the standalone page', async () => {
  const { route } = mount({
    proxyFor: async () => ({
      bootstrapData: () => ({ editorOrigin: 'http://127.0.0.1:5555', webOrigin: 'http://127.0.0.1:47822' }),
    }),
  });
  const res = fakeRes();
  await route.handler(post(), res);
  assert.equal(res.status, 200);
  assert.deepEqual(JSON.parse(res.body), { url: 'http://127.0.0.1:47822/no996-openfilm/standalone' });
});

test('an existing bridge is reused instead of redeemed again', async () => {
  const { route, state } = mount();
  state.bridge = Promise.resolve({ url: 'http://127.0.0.1:47821/window' });
  const res = fakeRes();
  await route.handler(post(), res);
  assert.equal(res.status, 200);
  assert.equal(JSON.parse(res.body).url, 'http://127.0.0.1:47821/window');
});

test('a disposed Host answers 503 before touching the proxy', async () => {
  let asked = false;
  const { route } = mount({
    isDisposed: () => true,
    proxyFor: async () => { asked = true; return {}; },
  });
  const res = fakeRes();
  await route.handler(post(), res);
  assert.equal(res.status, 503);
  assert.equal(asked, false);
});

test('debug-url is POST-only and refuses a foreign peer', async () => {
  const { route } = mount({ ctx: { connection: { admit: () => ({ peer: { id: 'other' } }), browserPeer: BROWSER } } });
  const get = fakeRes();
  await route.handler({ method: 'GET', headers: {}, url: PATH }, get);
  assert.equal(get.status, 405);
  const foreign = fakeRes();
  await route.handler(post(), foreign);
  assert.equal(foreign.status, 403);
});
