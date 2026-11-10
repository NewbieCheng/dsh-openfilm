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
  assert.deepEqual([...new Set(channels)].sort(), ['editor:link', 'template:create', 'template:list']);
  // The one-time link must be rejected unless it is the local ticket bridge.
  assert.match(shellUiInjection, /__dsh\/open#/);
  // No project path or session identity may be constructed in the page.
  assert.doesNotMatch(shellUiInjection, /sessionId|projectPath|\/api\/no996-openfilm/);
});
