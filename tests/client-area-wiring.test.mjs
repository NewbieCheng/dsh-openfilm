// The project page and the sidebar filter are wiring, not logic: these
// assertions keep the pieces connected the way the design says. The failure
// modes (the shipped sidebar replaced by a lookalike; a project row that opens
// the chat view) are invisible in a unit test and expensive in the GUI.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const count = (text, needle) => text.split(needle).length - 1;

test('the shipped Workspace browser is never replaced', () => {
  const entry = read('src/studio-entry.js');
  assert.equal(count(entry, "inject('sidebar.workspaces'"), 0,
    'taking the slot over is what lost the native folder buttons and spacing');
  assert.doesNotMatch(entry, /sidebar\.workspaces/);
});

test('the project page is a conversation-area panel with its own icon', () => {
  const entry = read('src/studio-entry.js');
  assert.match(entry, /const PROJECTS = 'no996-openfilm-projects'/);
  assert.match(entry, /name: 'main', key: PROJECTS/, 'the page renders in the conversation area');
  assert.match(entry, /name: 'sidebar\.panellist', id: PROJECTS/, 'and is reachable from the icon rail');
  assert.match(entry, /createProjectPanel\(React, \{/);
});

test('a project row opens the video panel and asks it to navigate, not the DSH conversation', () => {
  const entry = read('src/studio-entry.js');
  const start = entry.indexOf('openProject: projectId => {');
  assert.ok(start > 0, 'the row action must be the named openProject seam');
  const block = entry.slice(start, entry.indexOf('},', start));
  assert.match(block, /areaBus\.navigate\(projectId\)/, 'the panel is asked to show that project');
  assert.match(block, /selectPanel\(\)/, 'the middle area becomes the video panel');
  assert.doesNotMatch(block, /openSession\(/, 'a project row must not open the DSH chat view');
});

test('project conversations are hidden with a row stylesheet, not by re-rendering the list', () => {
  const hider = read('src/area-hider.mjs');
  assert.match(hider, /data-row-key="session:\$\{id\}"/, 'the shipped rows carry the Session id');
  assert.match(hider, /display:none!important/);
  const entry = read('src/studio-entry.js');
  assert.match(entry, /createAreaHider\(\)/);
  assert.match(entry, /hider\.apply\(payload\?\.hiddenSessionIds\)/);
});

test('the client half still declares the workspace package it borrows services from', () => {
  const pkg = JSON.parse(read('package.json'));
  assert.ok(pkg.dsh.client.inject.includes('@deepseek-ai/dsh-client-ui-workspace'));
});

test('the panel forwards navigation and reports what the shell shows', () => {
  const panel = read('src/studio-panel.mjs');
  assert.match(panel, /import \{ areaBus \} from '\.\/area-bus\.mjs'/);
  assert.match(panel, /type: 'no996-openfilm:navigate'/, 'the iframe receives the request');
  assert.match(panel, /areaBus\.reportProject\(/, 'the page can follow the project on screen');
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
