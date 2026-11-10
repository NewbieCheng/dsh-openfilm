import test from 'node:test';
import assert from 'node:assert/strict';
import { shellUiInjection } from '../src/shell-extras.mjs';

const html = shellUiInjection();
const body = html.replace(/^<script>/, '').replace(/<\/script>$/, '');

test('the injected shell UI is one balanced script that parses as JavaScript', () => {
  // It is spliced into an existing <head>, so a stray </script> or a broken
  // expression would break the whole page rather than just the picker.
  assert.match(html, /^<script>/);
  assert.match(html, /<\/script>$/);
  assert.equal((html.match(/<\/script>/g) || []).length, 1);
  assert.match(body, /no996-template-picker/);
  assert.match(body, /\/__dsh\/official-rpc/);
  assert.doesNotMatch(html, /\$\{/);
  // Throws on a syntax error, which is exactly the failure mode we cannot see
  // without a browser.
  new Function(body);
});

test('the picker only talks over the fixed bridge channels', () => {
  const channels = [...body.matchAll(/rpc\('([^']+)'/g)].map(match => match[1]);
  assert.deepEqual([...new Set(channels)].sort(), ['client:log', 'editor:link', 'template:create', 'template:list']);
  // No project path or session identity may be constructed in the page.
  assert.doesNotMatch(body, /sessionId|projectPath|\/api\/no996-openfilm/);
});

test('a dead Studio is answered inside the page, not with an app-restart hint', () => {
  // The upstream overlay says to restart an application the person cannot see.
  // Our own control must be present, must poll, and must lead to the console.
  assert.match(body, /no996-stopped/);
  assert.match(body, /重新启动工作台/);
  assert.match(body, /http:\/\/127\.0\.0\.1:47821\/editor/);
  assert.match(body, /\/api\/version/);
  assert.match(body, /misses>=2/);
});

test('a foreign plugin probing this page cannot throw in the console', () => {
  assert.match(body, /typeof window\.__dshEsSetShortcut!=='function'/);
});

test('the overlay is re-read from disk so editing it needs only a refresh', async () => {
  const { readFileSync, writeFileSync, utimesSync } = await import('node:fs');
  const { fileURLToPath } = await import('node:url');
  const file = fileURLToPath(new URL('../assets/shell-ui.js', import.meta.url));
  const original = readFileSync(file, 'utf8');
  try {
    writeFileSync(file, `${original}\n// probe ${Date.now()}\n`, 'utf8');
    const future = new Date(Date.now() + 2000);
    utimesSync(file, future, future);
    assert.match(shellUiInjection(), /\/\/ probe/);
  } finally {
    writeFileSync(file, original, 'utf8');
  }
});
