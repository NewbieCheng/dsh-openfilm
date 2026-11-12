// A guard introduced to stop re-registering a route must itself be declared
// before anything calls it. The first version was a `const` declared halfway
// down the apply body while routes were registered near the top — a temporal
// dead zone at runtime, which failed the whole plugin's activation and left the
// panel showing "HTTP 503". A function declaration hoists; a const does not.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

test('the route guard is hoisted, so early routes can call it', () => {
  const source = read('src/studio-controller.mjs');
  const declaration = source.indexOf('function registerRoute(');
  assert.ok(declaration >= 0, 'registerRoute must be a function declaration');
  assert.equal(/const\s+registerRoute\b/.test(source), false, 'a const would run before its initializer');
  const firstUse = source.search(/registerRoute\(\{/);
  assert.ok(firstUse > 0);
  assert.ok(source.indexOf('registerRoute(', firstUse + 1) > 0);
});

test('every local route goes through the guard', () => {
  const source = read('src/studio-controller.mjs');
  const raw = source.match(/ctx\.webServer\.register\(/g) ?? [];
  assert.equal(raw.length, 1, 'only the guard may call the registry directly');
});
