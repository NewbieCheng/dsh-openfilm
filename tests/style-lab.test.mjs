import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { styleLabInjection, styleLabVersion } from '../src/style-lab.mjs';

const ASSET = fileURLToPath(new URL('../assets/style-lab.js', import.meta.url));

test('the workbench is off unless the developer asks for it', () => {
  assert.equal(styleLabInjection({}), '');
  assert.equal(styleLabInjection({ NO996_OPENFILM_STYLE_LAB: '0' }), '');
});

test('the workbench is one script tag and parses as JavaScript', () => {
  const html = styleLabInjection({ NO996_OPENFILM_STYLE_LAB: '1' });
  assert.match(html, /^<script data-no996-style-lab>/);
  assert.ok(html.endsWith('</script>'));
  const body = readFileSync(ASSET, 'utf8');
  assert.doesNotThrow(() => new Function(body));
  assert.ok(!body.includes('</script'), 'the asset must not close the injected block');
});

test('the toolbar is idempotent and scoped in a shadow root', () => {
  const body = readFileSync(ASSET, 'utf8');
  assert.match(body, /__no996StyleLab/);
  assert.match(body, /attachShadow/);
  assert.match(body, /Escape/);
  assert.match(body, /data-act="copy"/);
});

test('version is a stable stamp for cache busting', () => {
  assert.match(styleLabVersion(), /^\d+$/);
});
