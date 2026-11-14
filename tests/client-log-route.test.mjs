// The page-side event sink is enum-only and tiny, but it is the only way the
// sidebar can leave evidence when its switch goes missing. It had never been
// called by a test — and indeed named a constant that was not in scope, so every
// real request threw instead of logging.
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import test from 'node:test';
import { createDiagnosticsRoutes } from '../src/studio-controller/routes/diagnostics.mjs';

const BROWSER = { id: 'browser' };
const ctx = { connection: { admit: () => ({ peer: BROWSER }), browserPeer: BROWSER } };

function fakeRes() {
  return {
    status: 0,
    headers: {},
    writableEnded: false,
    setHeader(name, value) { this.headers[name] = value; },
    writeHead(status) { this.status = status; return this; },
    end() { this.writableEnded = true; },
  };
}

function mount(events) {
  const routes = [];
  const logged = [];
  createDiagnosticsRoutes({
    ctx,
    log: { info: (event, fields) => logged.push({ event, ...fields }) },
    clientEvents: events,
    register: route => { routes.push(route); return () => {}; },
    track: dispose => dispose,
  });
  return { route: routes.find(r => r.path === '/api/no996-openfilm/client-log'), logged };
}

function post(route, payload) {
  const req = new EventEmitter();
  req.method = 'POST';
  const res = fakeRes();
  const done = route.handler(req, res);
  req.emit('data', Buffer.from(JSON.stringify(payload)));
  req.emit('end');
  return Promise.resolve(done).then(() => res);
}

test('a listed page event is logged with its short detail', async () => {
  const { route, logged } = mount(new Set(['switch-lost']));
  const res = await post(route, { event: 'switch-lost', detail: 'no-header' });
  assert.equal(res.status, 204);
  assert.deepEqual(logged, [{ event: 'page-switch-lost', anchor: undefined, detail: 'no-header' }]);
});

test('an unlisted event is refused, so this stays a diagnostic sink', async () => {
  const { route, logged } = mount(new Set(['switch-lost']));
  const res = await post(route, { event: 'something-else' });
  assert.equal(res.status, 400);
  assert.equal(logged.length, 0);
});

test('a malformed body is a 400, not a crash', async () => {
  const { route } = mount(new Set(['switch-lost']));
  const req = new EventEmitter();
  req.method = 'POST';
  const res = fakeRes();
  const done = route.handler(req, res);
  req.emit('data', Buffer.from('{not json'));
  req.emit('end');
  await Promise.resolve(done);
  assert.equal(res.status, 400);
});
