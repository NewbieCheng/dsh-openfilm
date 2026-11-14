// The bootstrap route is the first thing the panel calls, and it is the one that
// decides which failure a person sees: an allowlisted code in the body, never an
// upstream message (those may carry bearer keys).
//
// It used to live inside createStudioController and read `disposed`, `upstream`,
// `runtime` and `proxyFor` from the closure. After the move those are getters and
// functions, so this test exists to prove the wiring: happy path, disposed, Studio
// failure with a code, and the origin fence.
import assert from 'node:assert/strict';
import test from 'node:test';
import { createBootstrapRoute } from '../src/studio-controller/routes/bootstrap.mjs';

const BROWSER = { id: 'browser' };
const PATH = '/api/no996-openfilm/bootstrap';

function fakeRes() {
  return {
    headers: {},
    status: 0,
    body: undefined,
    headersSent: false,
    writableEnded: false,
    statusCode: 200,
    setHeader(name, value) { this.headers[name] = value; },
    writeHead(status, headers = {}) {
      this.status = status;
      this.statusCode = status;
      this.headersSent = true;
      Object.assign(this.headers, headers);
      return this;
    },
    end(body) {
      if (body !== undefined) this.body = body;
      this.writableEnded = true;
    },
  };
}

function mount(overrides = {}) {
  const routes = [];
  const warnings = [];
  const deps = {
    ctx: { connection: { admit: () => ({ peer: BROWSER }), browserPeer: BROWSER } },
    register: route => { routes.push(route); return () => {}; },
    track: dispose => dispose,
    log: { info() {}, warn: (event, fields) => warnings.push({ event, fields }) },
    origin: new URL('http://127.0.0.1:47822'),
    isDisposed: () => false,
    getUpstream: () => ({ port: 1234 }),
    ensureStudioStarted: async () => {},
    proxyFor: async () => ({ bootstrap: async res => { res.writeHead(204); res.end(); } }),
    ...overrides,
  };
  createBootstrapRoute(deps);
  return { route: routes.find(item => item.path === PATH), warnings };
}

const post = (overrides = {}) => ({
  method: 'POST',
  headers: { origin: 'http://127.0.0.1:47822', ...overrides },
  url: PATH,
});

test('a healthy bootstrap is handed to the proxy', async () => {
  const { route } = mount();
  const res = fakeRes();
  await route.handler(post(), res);
  assert.equal(res.status, 204);
});

test('a disposed Host answers 503 without touching Studio', async () => {
  const { route } = mount({ isDisposed: () => true });
  const res = fakeRes();
  await route.handler(post(), res);
  assert.equal(res.status, 503);
  assert.equal(res.body, 'STUDIO_DISPOSED');
});

test('a Studio failure surfaces an allowlisted code, not the message', async () => {
  const { route, warnings } = mount({
    ensureStudioStarted: async () => {
      throw Object.assign(new Error('powershell: C:\\secret\\path failed'), { code: 'OFFICIAL_SHELL_UNAVAILABLE' });
    },
  });
  const res = fakeRes();
  await route.handler(post(), res);
  assert.equal(res.status, 503);
  assert.match(res.body, /\(OFFICIAL_SHELL_UNAVAILABLE\)/);
  assert.doesNotMatch(res.body, /secret/);
  const failure = warnings.find(item => item.event === 'bootstrap-failed');
  assert.equal(failure.fields.code, 'OFFICIAL_SHELL_UNAVAILABLE');
});

test('an unknown error is logged as OTHER, and the body never echoes it', async () => {
  const { route, warnings } = mount({
    ensureStudioStarted: async () => { throw new Error('key sk-live-123'); },
  });
  const res = fakeRes();
  await route.handler(post(), res);
  assert.match(res.body, /\(OTHER\)/);
  assert.doesNotMatch(res.body, /sk-live/);
  assert.equal(warnings.find(item => item.event === 'bootstrap-failed').fields.code, 'OTHER');
});

test('a browser origin on another port is refused', async () => {
  const { route } = mount();
  const res = fakeRes();
  await route.handler(post({ origin: 'http://127.0.0.1:9' }), res);
  assert.equal(res.status, 403);
  assert.equal(res.body, 'DSH_ORIGIN_REJECTED');
});

test('the desktop surface is accepted without an Origin header', async () => {
  const { route } = mount();
  const res = fakeRes();
  await route.handler({ method: 'POST', headers: { 'x-no996-surface': 'dsh-app://app' }, url: PATH }, res);
  assert.equal(res.status, 204);
});

test('bootstrap is POST-only', async () => {
  const { route } = mount();
  const res = fakeRes();
  await route.handler({ method: 'GET', headers: {}, url: PATH }, res);
  assert.equal(res.status, 405);
  assert.equal(res.headers.allow, 'POST');
});
