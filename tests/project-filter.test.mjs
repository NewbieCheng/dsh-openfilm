// The "Projects only" filter is mostly DOM work, so what can be tested is the
// part that decides *what* to hide: the persisted toggle and the Session set.
import assert from 'node:assert/strict';
import test from 'node:test';
import { createProjectFilter, projectSessionIds, readProjectFilter, writeProjectFilter } from '../src/project-filter.mjs';

function memoryStorage() {
  const table = new Map();
  return { getItem: key => (table.has(key) ? table.get(key) : null), setItem: (key, value) => table.set(key, String(value)) };
}

test('the filter defaults to off and remembers the choice', () => {
  const storage = memoryStorage();
  assert.equal(readProjectFilter(storage), false);
  writeProjectFilter(storage, true);
  assert.equal(readProjectFilter(storage), true);
  writeProjectFilter(storage, false);
  assert.equal(readProjectFilter(storage), false);
});

test('a hostile or absent storage never throws', () => {
  assert.equal(readProjectFilter(undefined), false);
  assert.doesNotThrow(() => writeProjectFilter(undefined, true));
  const broken = { getItem() { throw new Error('denied'); }, setItem() { throw new Error('denied'); } };
  assert.equal(readProjectFilter(broken), false);
  assert.doesNotThrow(() => writeProjectFilter(broken, true));
});

test('the Host\'s project-conversation set is what gets kept', () => {
  const ids = projectSessionIds({ hidden: ['session-1', 'session-2'], projects: [{ projectId: 'a', sessionId: 'session-1' }] });
  assert.deepEqual([...ids].sort(), ['session-1', 'session-2'], 'a cwd-matched conversation counts too');
  assert.equal(projectSessionIds({ hiddenSessionIds: ['session-3'] }).has('session-3'), true);
  assert.equal(projectSessionIds(undefined).size, 0);
});

test('without a document the filter is a no-op instead of a crash', () => {
  const store = { snapshot: () => ({ projects: [] }), subscribe: () => () => {} };
  const filter = createProjectFilter({ store, doc: undefined });
  assert.doesNotThrow(() => filter.start());
  assert.equal(filter.isOn(), false);
  assert.doesNotThrow(() => filter.toggle());
});
