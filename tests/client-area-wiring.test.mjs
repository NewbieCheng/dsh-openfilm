// The sidebar takeover is wiring, not logic: these assertions keep the pieces
// connected the way the design says, because the failure mode (the official
// WorkspaceBrowser silently wins) is invisible in a unit test and expensive in
// the GUI.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const count = (text, needle) => text.split(needle).length - 1;

test('the Workspace region is taken over once, at a priority that outranks the shipped browser', () => {
  const entry = read('src/studio-entry.js');
  assert.equal(count(entry, "inject('sidebar.workspaces'"), 1, 'one registration, no conditional second path');
  assert.match(entry, /name: 'sidebar\.workspaces', priority: -100/,
    'single slots render the lowest-priority live entry; -100 is what beats the shipped occupant');
  assert.doesNotMatch(entry, /sidebar\.workspaces'\)\s*>\s*dispose|\.dispose\(\)\s*;?[^\n]*sidebar\.workspaces/,
    'the area is permanent now: switching modes is a view change, not an unregister');
});

test('one project row opens the panel and asks it to navigate, not the DSH conversation', () => {
  const entry = read('src/studio-entry.js');
  const start = entry.indexOf('openProject: projectId => {');
  assert.ok(start > 0, 'the row action must be the named openProject seam');
  const block = entry.slice(start, entry.indexOf('}', entry.indexOf('selectPanel();', start)) + 1);
  assert.match(block, /areaBus\.navigate\(projectId\)/, 'the panel is asked to show that project');
  assert.match(block, /selectPanel\(\)/, 'the middle area becomes the video panel');
  assert.doesNotMatch(block, /openSession\(/, 'a project row must not open the DSH chat view');
});

test('the client half declares the workspace package it borrows services from', () => {
  const pkg = JSON.parse(read('package.json'));
  assert.ok(pkg.dsh.client.inject.includes('@deepseek-ai/dsh-client-ui-workspace'),
    'ctx.get("uiWorkspace")/useWorkspaces need the package loaded first');
});

test('the panel forwards navigation and reports what the shell shows', () => {
  const panel = read('src/studio-panel.mjs');
  assert.match(panel, /import \{ areaBus \} from '\.\/area-bus\.mjs'/);
  assert.match(panel, /type: 'no996-openfilm:navigate'/, 'the iframe receives the request');
  assert.match(panel, /areaBus\.reportProject\(/, 'the sidebar follows the project on screen');
  assert.match(panel, /areaBus\.reportReady\(\)/, 'a click made while the frame boots is flushed, not dropped');
  assert.match(panel, /areaBus\.takePending\(\)/);
});

test('the injected shell bridge navigates with the history API and reports the new path', () => {
  const proxy = read('src/studio-proxy.mjs');
  assert.match(proxy, /no996-openfilm:navigate/);
  assert.match(proxy, /history\.pushState\(\{\},'',target\)/);
  assert.match(proxy, /PopStateEvent\('popstate'/);
  assert.match(proxy, /location\.assign\(target\)/, 'a shell that ignores popstate still moves, via a reload');
});

test('the Host route is registered for the official shell only', () => {
  const controller = read('src/studio-controller.mjs');
  assert.match(controller, /import \{ createAreaRoute \} from '\.\/area-route\.mjs'/);
  const block = controller.slice(controller.indexOf('if (officialShell) {'), controller.indexOf('unregister = trackRoute(ctx.webServer.register({', controller.indexOf('if (officialShell) {')));
  assert.match(block, /createAreaRoute\(\{/);
  assert.match(block, /ctx\.sessionController\.list\(/, 'the hidden set needs the catalog as well as the bindings');
});
