// The route guard has one job: a plugin activation must not die because a path is
// already mounted, and a failed setup must not leak paths.
//
// Its first version was a `const` halfway down the apply body while routes were
// registered near the top — a temporal dead zone at runtime, which failed the whole
// plugin's activation and left the panel showing "HTTP 503". The fix at the time was
// a hoisted function declaration; the fix now is that the guard lives in a module,
// where it exists before any caller by construction. These tests pin the new shape
// so nobody re-introduces a local guard in the controller.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { createRouter } from '../src/studio-controller/router.mjs';

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

test('the controller never calls the web registry directly', () => {
  const controller = read('src/studio-controller.mjs');
  assert.equal((controller.match(/ctx\.webServer\.register\(/g) ?? []).length, 0, 'only the router module may register routes');
});

test('the router module is the single direct caller', () => {
  const router = read('src/studio-controller/router.mjs');
  assert.equal((router.match(/webServer\.register\(/g) ?? []).length, 1);
  assert.equal(/const\s+registerRoute\b/.test(router), false, 'the guard is a function, not a binding that could run early');
});

test('the router is created before the first route registration', () => {
  const source = read('src/studio-controller.mjs');
  const declaration = source.indexOf('const router = createRouter(');
  const firstUse = source.indexOf('trackRoute(registerRoute(');
  assert.ok(declaration > 0, 'the controller creates a router');
  assert.ok(firstUse > 0, 'a route uses the router');
  assert.ok(declaration < firstUse, 'a const bound after first use would crash activation');
});

test('a duplicate path is tolerated and reported, not fatal', () => {
  const warned = [];
  const router = createRouter({
    webServer: { register() { throw new Error('duplicate exact route /api/a'); } },
    log: { warn: (event, fields) => warned.push({ event, fields }) },
  });
  const dispose = router.register({ path: '/api/a' });
  assert.equal(typeof dispose, 'function');
  assert.equal(warned.length, 1);
  assert.equal(warned[0].event, 'route-already-mounted');
  assert.equal(warned[0].fields.path, '/api/a');
  assert.doesNotThrow(dispose);
});

test('rollback runs last-in-first-out and survives a throwing disposer', () => {
  const order = [];
  const router = createRouter({ webServer: { register: () => () => order.push('registered') }, log: null });
  router.mount({ path: '/api/a' });
  router.track(() => order.push('first'));
  router.track(() => { throw new Error('already gone'); });
  router.track(() => order.push('last'));
  router.rollback();
  assert.deepEqual(order, ['last', 'first', 'registered']);
  assert.equal(router.size(), 0);
});
