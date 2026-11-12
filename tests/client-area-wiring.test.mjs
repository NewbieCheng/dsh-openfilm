// The sidebar is the shipped Workspace browser, full stop. These assertions keep
// it that way and keep the two bridges that survive the revert wired: the Host
// area data and the parent -> iframe navigation request.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

test('the shipped Workspace browser is never replaced', () => {
  const entry = read('src/studio-entry.js');
  assert.doesNotMatch(entry, /name: 'sidebar\.workspaces',/,
    'occupying the single slot replaces the native list, its pin/archive menus and its running state');
  assert.equal(entry.includes('priority: -100'), false);
});

test('the plugin adds no session-row entries any more', () => {
  const entry = read('src/studio-entry.js');
  assert.equal((entry.match(/session\.row\.action/g) ?? []).length, 0);
  assert.equal((entry.match(/contextMenus/g) ?? []).length, 0);
  assert.equal(entry.includes('openInEditing'), false);
});

test('the one sidebar contribution is the view-menu filter', () => {
  const entry = read('src/studio-entry.js');
  assert.match(entry, /createProjectFilter\(\{/);
  assert.match(entry, /projectFilter\.start\(\)/);
  const filter = read('src/project-filter.mjs');
  assert.match(filter, /viewOptionsMenu/, 'the entry is appended to the shipped menu');
  assert.match(filter, /data-row-key\^="session:"/, 'rows are hidden by their own key');
});

test('the video panel is still the only conversation-area panel the plugin adds', () => {
  const entry = read('src/studio-entry.js');
  assert.match(entry, /name: 'main', key: PANEL/);
  assert.match(entry, /name: 'sidebar\.panellist', id: PANEL/);
  assert.equal((entry.match(/name: 'sidebar\.panellist'/g) ?? []).length, 1,
    'a second rail entry would duplicate the project list');
});

test('the panel forwards navigation and reports what the shell shows', () => {
  const panel = read('src/studio-panel.mjs');
  assert.match(panel, /type: 'no996-openfilm:navigate'/);
  assert.match(panel, /areaBus\.reportProject\(/);
  assert.match(panel, /areaBus\.reportReady\(\)/);
  assert.match(panel, /areaBus\.takePending\(\)/);
});

test('the injected shell bridge navigates with the history API and reports the new path', () => {
  const proxy = read('src/studio-proxy.mjs');
  assert.match(proxy, /no996-openfilm:navigate/);
  assert.match(proxy, /history\.pushState\(\{\},'',target\)/);
  assert.match(proxy, /PopStateEvent\('popstate'/);
  assert.match(proxy, /location\.assign\(target\)/);
});

test('the Host route reads project conversations without opening or creating anything', () => {
  const controller = read('src/studio-controller.mjs');
  assert.match(controller, /import \{ createAreaRoute \} from '\.\/area-route\.mjs'/);
  const start = controller.indexOf('if (officialShell) {');
  const block = controller.slice(start, controller.indexOf('unregister = trackRoute(ctx.webServer.register({', start));
  assert.match(block, /createAreaRoute\(\{/);
  const route = read('src/area-route.mjs');
  assert.doesNotMatch(route, /\.create\(|archiveSession|openSession/, 'the route is read-only');
});
