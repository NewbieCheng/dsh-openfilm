// The sidebar is the shipped Workspace browser, and the plugin touches nothing
// in it: no slot, no menu item, no stylesheet, no filter. This test is the
// contract — it fails if any of that comes back.
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import test from 'node:test';

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const srcFiles = () => readdirSync(new URL('../src', import.meta.url)).filter(name => name.endsWith('.mjs'));

test('the shipped Workspace browser is never replaced', () => {
  const entry = read('src/studio-entry.js');
  assert.doesNotMatch(entry, /name: 'sidebar\.workspaces',/);
  assert.equal(entry.includes('priority: -100'), false);
});

test('nothing is injected into the Workspace list, its rows or its menus', () => {
  const entry = read('src/studio-entry.js');
  for (const banned of ['session.row.action', 'session.menu.item', 'contextMenus', 'viewOptionsMenu', 'data-row-key']) {
    assert.equal(entry.includes(banned), false, `studio-entry.js must not mention ${banned}`);
  }
  for (const file of srcFiles()) {
    const source = read(`src/${file}`);
    for (const banned of ['viewOptionsMenu', 'data-row-key', 'hiddenSessionIds', 'sidebar.workspaces']) {
      assert.equal(source.includes(banned), false, `${file} must not carry sidebar integration (${banned})`);
    }
  }
});

test('no workspace-area route or client store is left behind', () => {
  for (const gone of ['area-route.mjs', 'area-view.mjs', 'area-client.mjs', 'area-store.mjs', 'project-filter.mjs']) {
    assert.equal(srcFiles().includes(gone), false, `${gone} was removed with the sidebar feature`);
  }
  const controller = read('src/studio-controller.mjs');
  assert.equal(controller.includes('/api/no996-openfilm/area'), false);
  const entry = read('src/studio-entry.js');
  assert.equal(entry.includes('no996-openfilm/area'), false);
});

test('the video panel is still the only thing the plugin adds to the UI', () => {
  const entry = read('src/studio-entry.js');
  assert.match(entry, /name: 'main', key: PANEL/);
  assert.match(entry, /name: 'sidebar\.panellist', id: PANEL/);
  assert.equal((entry.match(/name: 'sidebar\.panellist'/g) ?? []).length, 1);
  assert.match(entry, /name: 'shell\.overlay'/);
});

test('the Workspace header switch is the one narrow sidebar addition', () => {
  const source = read('src/sidebar-editing.mjs');
  assert.match(source, /export function installWorkspaceSwitch/);
  assert.match(source, /areaBus\.navigate/);
  // It must stay a header-only append: no single slot, no row actions, no menus.
  assert.equal(source.includes('sidebar.workspaces'), false);
  assert.equal(source.includes('session.row.action'), false);
  assert.equal(source.includes('session.menu.item'), false);
  assert.match(read('src/studio-entry.js'), /installWorkspaceSwitch\(\{/);
});
