import test from 'node:test';
import assert from 'node:assert/strict';
import { shellUiInjection } from '../src/shell-extras.mjs';

test('the injected shell UI is one balanced script that parses as JavaScript', () => {
  // It is spliced into an existing <head>, so a stray </script> or an accidental
  // template literal would break the whole page rather than just the picker.
  assert.match(shellUiInjection, /^<script>/);
  assert.match(shellUiInjection, /<\/script>$/);
  assert.equal((shellUiInjection.match(/<\/script>/g) || []).length, 1);
  assert.doesNotMatch(shellUiInjection, /\$\{/);
  assert.match(shellUiInjection, /no996-template-picker/);
  assert.match(shellUiInjection, /\/__dsh\/official-rpc/);
  // Throws on a syntax error, which is exactly the failure mode we cannot see
  // without a browser.
  new Function(shellUiInjection.slice('<script>'.length, -('</script>'.length)));
});

test('the picker only talks over the fixed bridge channels', () => {
  const channels = [...shellUiInjection.matchAll(/rpc\('([^']+)'/g)].map(match => match[1]);
  assert.deepEqual([...new Set(channels)].sort(), ['client:log', 'editor:link', 'template:create', 'template:list']);
  // The one-time link must be rejected unless it is the local ticket bridge.
  assert.match(shellUiInjection, /__dsh\/open#/);
  // No project path or session identity may be constructed in the page.
  assert.doesNotMatch(shellUiInjection, /sessionId|projectPath|\/api\/no996-openfilm/);
});

test('a dead Studio is answered inside the page, not with an app-restart hint', () => {
  // The upstream overlay says to restart an application the person cannot see.
  // Our own control must be present, must poll, and must lead to the console.
  assert.match(shellUiInjection, /no996-stopped/);
  assert.match(shellUiInjection, /重新启动工作台/);
  assert.match(shellUiInjection, /http:\/\/127\.0\.0\.1:47821\/editor/);
  assert.match(shellUiInjection, /\/api\/version/);
  // Two consecutive misses before covering the page: one blip is not an outage.
  assert.match(shellUiInjection, /misses>=2/);
});

test('a foreign plugin probing this page cannot throw in the console', () => {
  // dsh-element-source-plus runs `window.__dshEsSetShortcut(config)` in every
  // webview before its own bundle is injected there; accepting the call is the
  // difference between a silent no-op and an uncaught TypeError on every load.
  assert.match(shellUiInjection, /typeof window\.__dshEsSetShortcut!=='function'/);
  assert.match(shellUiInjection, /window\.__dshEsSetShortcut=function\(\)\{ return false; \}/);
});
