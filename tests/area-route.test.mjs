import assert from 'node:assert/strict';
import test from 'node:test';
import { createAreaRoute } from '../src/area-route.mjs';

function call(route, { method = 'GET', admit = true } = {}) {
  const req = { method, headers: {} };
  return new Promise((resolve, reject) => {
    const state = { status: null, headers: {}, body: '' };
    const res = {
      setHeader(name, value) { state.headers[name.toLowerCase()] = value; },
      writeHead(status, headers) {
        state.status = status;
        if (headers) for (const [name, value] of Object.entries(headers)) state.headers[name.toLowerCase()] = value;
        return res;
      },
      end(body = '') { state.body = String(body); resolve(state); },
      on() {}, once() {}, destroy() {},
    };
    try { route.handler(req, res); } catch (error) { reject(error); }
  });
}

const projects = [{ id: 'abc123', path: 'C:\\P\\复刻影片' }];
const bindings = [{ projectId: 'abc123', path: 'C:\\P\\复刻影片', sessionId: 'session-1' }];
const sessions = [{ sessionId: 'session-1', cwd: 'C:\\P\\复刻影片' }, { sessionId: 'ordinary', cwd: 'C:\\Elsewhere' }];

function route(overrides = {}) {
  return createAreaRoute({
    admit: () => true,
    proxyOf: () => Promise.resolve({ listProjects: async () => projects }),
    conversationsOf: () => Promise.resolve({ bindings: () => bindings }),
    listSessions: async () => sessions,
    ...overrides,
  });
}

test('the route is a read-only GET and declares its exact path', async () => {
  const built = route();
  assert.equal(built.kind, 'exact');
  assert.equal(built.path, '/api/no996-openfilm/area');
  const response = await call(built);
  assert.equal(response.status, 200);
  assert.equal(response.headers['cache-control'], 'no-store');
  const body = JSON.parse(response.body);
  assert.deepEqual(body.projects, [{
    projectId: 'abc123', path: 'C:\\P\\复刻影片', name: '复刻影片', sessionId: 'session-1', sessionTitle: '',
  }]);
  assert.deepEqual(body.hiddenSessionIds, ['session-1']);
});

test('a POST is refused without touching Studio', async () => {
  const response = await call(route(), { method: 'POST' });
  assert.equal(response.status, 405);
  assert.equal(response.headers.allow, 'GET');
});

test('a foreign browser peer gets nothing', async () => {
  const response = await call(route({ admit: () => false }));
  assert.equal(response.status, 403);
});

test('no live proxy answers an empty payload', async () => {
  const response = await call(route({ proxyOf: () => Promise.resolve(undefined) }));
  assert.equal(response.status, 503);
  assert.deepEqual(JSON.parse(response.body), { projects: [], hiddenSessionIds: [] });
});

test('a failing project list degrades to an empty library, not a 500', async () => {
  const warnings = [];
  const response = await call(route({
    proxyOf: () => Promise.resolve({ listProjects: async () => { throw new Error('Studio down'); } }),
    log: { warn: (event, fields) => warnings.push([event, fields]) },
  }));
  assert.equal(response.status, 200);
  assert.deepEqual(JSON.parse(response.body).projects, []);
  assert.equal(warnings[0][0], 'area-projects-failed');
});

test('a failing binding store still lists the projects', async () => {
  const response = await call(route({ conversationsOf: () => Promise.reject(new Error('store closed')) }));
  const body = JSON.parse(response.body);
  assert.equal(body.projects.length, 1);
  assert.equal(body.projects[0].sessionId, null);
  assert.deepEqual(body.hiddenSessionIds, ['session-1'], 'folder matches still hide the conversation');
});

test('an unreadable catalog keeps the bound Session hidden', async () => {
  const response = await call(route({ listSessions: async () => { throw new Error('catalog busy'); } }));
  const body = JSON.parse(response.body);
  assert.deepEqual(body.hiddenSessionIds, ['session-1']);
});

test('a proxy that cannot list projects is treated as unavailable', async () => {
  const response = await call(route({ proxyOf: () => Promise.resolve({}) }));
  assert.equal(response.status, 503);
});
