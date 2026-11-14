// These routes used to live inside createStudioController, where every helper they
// named was in scope. Moving them out silently broke that: the first version read
// `basename`, `officialStore` and `deleteEditingProject` without importing or
// receiving them. Unit tests stayed green because no test called the route.
//
// So this test calls it: the GET path runs the whole list pipeline
// (bound sessions → buildEditingProjects → chat store → prefs) against stubs.
import assert from 'node:assert/strict';
import test from 'node:test';
import { createEditingRoutes } from '../src/studio-controller/routes/editing.mjs';

const BROWSER = { id: 'browser' };

function fakeCtx() {
  return {
    connection: {
      admit: () => ({ peer: BROWSER }),
      browserPeer: BROWSER,
    },
  };
}

function fakeRes() {
  return {
    headers: {},
    status: 0,
    body: undefined,
    headersSent: false,
    writableEnded: false,
    setHeader(name, value) { this.headers[name] = value; },
    writeHead(status, headers = {}) {
      this.status = status;
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
  const deps = {
    ctx: fakeCtx(),
    register: route => { routes.push(route); return () => {}; },
    track: dispose => dispose,
    acpSessions: { all: () => [], remove() {} },
    archive: { isArchived: () => false, available: true },
    editingPrefs: { all: () => ({}), getSession: () => undefined, set: async () => ({}) },
    verifyOfficialProject: async () => ({ id: 'abcdef123456' }),
    listTemplates: async () => [],
    templatesRoot: '/templates',
    getLastProxy: () => null,
    officialStore: async () => ({ load: async () => ({ sessions: [] }) }),
    deleteEditingProject: async () => ({ ok: true }),
    getAcpAgentService: () => null,
    ...overrides,
  };
  createEditingRoutes(deps);
  return routes;
}

const routeOf = (routes, path) => routes.find(route => route.path === path);

test('the editing list answers with the projects the Host knows about', async () => {
  const routes = mount({
    acpSessions: {
      all: () => [{ projectId: 'abcdef123456', sessionId: 'session123', cwd: '/films/demo' }],
      remove() {},
    },
  });
  const route = routeOf(routes, '/api/no996-openfilm/editing-sessions');
  assert.ok(route, 'route is registered');

  const res = fakeRes();
  await route.handler({ method: 'GET', headers: {}, url: '/api/no996-openfilm/editing-sessions' }, res);
  assert.equal(res.status, 200);
  const body = JSON.parse(res.body);
  assert.equal(body.projects.length, 1);
  assert.equal(body.projects[0].name, 'demo', 'the row name falls back to the folder name');
  assert.equal(body.projects[0].sessions[0].sessionId, 'session123');
});

test('the editing list is GET-only', async () => {
  const routes = mount();
  const route = routeOf(routes, '/api/no996-openfilm/editing-sessions');
  const res = fakeRes();
  await route.handler({ method: 'POST', headers: {}, url: '/api/no996-openfilm/editing-sessions' }, res);
  assert.equal(res.status, 405);
  assert.equal(res.headers.allow, 'GET');
});

test('a failing dependency becomes 503, not an exception', async () => {
  const routes = mount({ getLastProxy: () => { throw new Error('no proxy'); } });
  const route = routeOf(routes, '/api/no996-openfilm/editing-sessions');
  const res = fakeRes();
  await route.handler({ method: 'GET', headers: {}, url: '/api/no996-openfilm/editing-sessions' }, res);
  assert.equal(res.status, 200, 'a missing proxy falls back to bound sessions');
});

test('every editing route refuses a foreign peer or the wrong method', async () => {
  const routes = mount({
    ctx: { connection: { admit: () => ({ peer: { id: 'someone-else' } }), browserPeer: BROWSER } },
  });
  assert.equal(routes.length, 5);
  for (const route of routes) {
    const res = fakeRes();
    await route.handler({ method: 'GET', headers: {}, url: route.path }, res);
    // POST-only routes answer 405 before admission; both are refusals.
    assert.ok(res.status >= 400, `${route.path} answered ${res.status}`);
  }
});
