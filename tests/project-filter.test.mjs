// The workspace-type filter decides *what* to hide; the DOM work is a thin
// presentation. These tests pin the decisions: the stored choice, the
// project-conversation set, and the generated selectors (which are what make
// the list paint correctly instead of flashing).
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildFilterCss, createProjectFilter, FILTER_ALL, FILTER_PROJECTS,
  projectSessionIds, readProjectFilter, writeProjectFilter,
} from '../src/project-filter.mjs';

function memoryStorage(initial = {}) {
  const table = new Map(Object.entries(initial));
  return { getItem: key => (table.has(key) ? table.get(key) : null), setItem: (key, value) => table.set(key, String(value)) };
}

test('the type filter defaults to all and remembers one of two values', () => {
  const storage = memoryStorage();
  assert.equal(readProjectFilter(storage), FILTER_ALL);
  writeProjectFilter(storage, FILTER_PROJECTS);
  assert.equal(readProjectFilter(storage), FILTER_PROJECTS);
  writeProjectFilter(storage, FILTER_ALL);
  assert.equal(readProjectFilter(storage), FILTER_ALL);
});

test('the old on/off key still selects video projects', () => {
  assert.equal(readProjectFilter(memoryStorage({ 'no996.openfilm.filter.projects': '1' })), FILTER_PROJECTS);
  assert.equal(readProjectFilter(memoryStorage({ 'no996.openfilm.filter.projects': '0' })), FILTER_ALL);
});

test('a hostile or absent storage never throws', () => {
  assert.equal(readProjectFilter(undefined), FILTER_ALL);
  assert.doesNotThrow(() => writeProjectFilter(undefined, FILTER_PROJECTS));
  const broken = { getItem() { throw new Error('denied'); }, setItem() { throw new Error('denied'); } };
  assert.equal(readProjectFilter(broken), FILTER_ALL);
  assert.doesNotThrow(() => writeProjectFilter(broken, FILTER_PROJECTS));
});

test('the Host set is used as-is, including folder-related conversations', () => {
  const ids = projectSessionIds({ hidden: ['session-1', 'session-2'], projects: [{ projectId: 'a', sessionId: 'session-1' }] });
  assert.deepEqual([...ids].sort(), ['session-1', 'session-2'], 'a cwd-matched conversation counts too');
  assert.equal(projectSessionIds({ hiddenSessionIds: ['session-3'] }).has('session-3'), true);
  assert.equal(projectSessionIds(undefined).size, 0);
  assert.equal(projectSessionIds({ hidden: ['bad id with spaces'] }).size, 0, 'only row keys are accepted');
});

test('all types generates no hiding at all', () => {
  assert.equal(buildFilterCss(FILTER_ALL, new Set(['session-1'])), '');
});

test('project types hide every other row in one stylesheet', () => {
  const css = buildFilterCss(FILTER_PROJECTS, new Set(['session-1', 'session-2']));
  assert.match(css, /html\[data-no996-type="projects"\] \[data-row-key\^="session:"\]/);
  assert.match(css, /:not\(\[data-row-key="session:session-1"\]\)/);
  assert.match(css, /:not\(\[data-row-key="session:session-2"\]\)/);
  assert.match(css, /:has\(\[data-row-key="session:session-1"\]\)/, 'empty groups are hidden by the same sheet');
  assert.match(css, /\[class\*="_groupSection"\]/);
});

test('an empty set never blanks the list while the Host payload is missing', () => {
  assert.equal(buildFilterCss(FILTER_PROJECTS, new Set()), '');
});

test('without a document the filter is inert instead of crashing', () => {
  const store = { snapshot: () => ({ hidden: [] }), subscribe: () => () => {} };
  const filter = createProjectFilter({ store, doc: undefined, labels: { section: 's', all: 'a', projects: 'p' } });
  assert.doesNotThrow(() => filter.start());
  assert.equal(filter.getType(), FILTER_ALL);
  assert.doesNotThrow(() => filter.choose(FILTER_PROJECTS));
});
