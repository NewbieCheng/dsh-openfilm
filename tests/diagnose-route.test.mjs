// The diagnose route is the support surface: it must answer with evidence even
// when almost everything else is broken, and it must never throw because one
// probe failed. It also owns the "log a health change once" behaviour.
import assert from 'node:assert/strict';
import test from 'node:test';
import { createDiagnoseRoute } from '../src/studio-controller/routes/diagnose.mjs';

const BROWSER = { id: 'browser' };
const PATH = '/api/no996-openfilm/diagnose';

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
  const infos = [];
  const deps = {
    ctx: { connection: { admit: () => ({ peer: BROWSER }), browserPeer: BROWSER }, get: () => null },
    register: route => { routes.push(route); return () => {}; },
    track: dispose => dispose,
    log: { info: (event, fields) => infos.push({ event, fields }), file: 'plugin.log', tail: () => [] },
    officialShell: false,
    archive: { available: true, archivedIds: () => [] },
    bridgeTrace: { snapshot: () => ({ published: 3 }) },
    runtime: { health: async () => ({ running: true }) },
    permissions: async () => ({ available: () => true, names: () => ['full-access'] }),
    agentService: null,
    getLastProxy: () => Promise.resolve(null),
    ...overrides,
  };
  createDiagnoseRoute(deps);
  return { route: routes.find(item => item.path === PATH), infos };
}

const post = () => ({ method: 'POST', headers: {}, url: PATH });

test('diagnose answers with evidence instead of throwing', async () => {
  const { route } = mount();
  const res = fakeRes();
  await route.handler(post(), res);
  assert.equal(res.status, 200);
  const body = JSON.parse(res.body);
  assert.equal(body.mode, 'dsh');
  assert.equal(body.studio.running, true);
  assert.equal(body.grouping, 'acp');
  assert.deepEqual(body.permission, { available: true, names: ['full-access'] });
  assert.deepEqual(body.bridge, { published: 3 });
  assert.equal(body.archive.available, true);
  assert.equal(body.turns, null, 'no agent service means no turn evidence, not a failure');
});

test('a failing probe degrades that field only', async () => {
  const { route } = mount({ permissions: async () => { throw Object.assign(new Error('nope'), { code: 'PERMISSION_UNAVAILABLE' }); } });
  const res = fakeRes();
  await route.handler(post(), res);
  const body = JSON.parse(res.body);
  assert.equal(res.status, 200);
  assert.deepEqual(body.permission, { available: false, error: 'PERMISSION_UNAVAILABLE' });
});

test('a health change is logged once, not on every call', async () => {
  const { route, infos } = mount();
  await route.handler(post(), fakeRes());
  await route.handler(post(), fakeRes());
  const changes = infos.filter(item => item.event === 'studio-health');
  assert.equal(changes.length, 1);
  assert.deepEqual(changes[0].fields, { running: true });
});

test('diagnose is POST-only and refuses a foreign peer', async () => {
  const { route } = mount({ ctx: { connection: { admit: () => ({ peer: { id: 'other' } }), browserPeer: BROWSER }, get: () => null } });
  const get = fakeRes();
  await route.handler({ method: 'GET', headers: {}, url: PATH }, get);
  assert.equal(get.status, 405);
  const foreign = fakeRes();
  await route.handler(post(), foreign);
  assert.equal(foreign.status, 403);
});
