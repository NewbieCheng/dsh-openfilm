import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { bake, composeThemeCss } from '../scripts/theme-bake.mjs';

const BRAND = Object.freeze({
  name: '不加班剪辑',
  colors: Object.freeze({ accent: '#ff6400', paper: '#f5f0e5', ink: '#18171c' }),
});
const sha = (value) => createHash('sha256').update(value).digest('hex');

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'dsh-openfilm-bake-'));
  mkdirSync(join(root, 'ui', 'assets'), { recursive: true });
  writeFileSync(
    join(root, 'ui', 'index.html'),
    '<!doctype html><html><head><title>OpenFilm</title><link rel="stylesheet" crossorigin href="/assets/index-x.css"></head><body></body></html>',
  );
  writeFileSync(join(root, 'ui', 'assets', 'index-x.css'), 'body{margin:0}');
  const manifest = {
    version: '0.3.2',
    commit: 'abc1234',
    files: {
      'ui/index.html': sha(readFileSync(join(root, 'ui', 'index.html'))),
      'ui/assets/index-x.css': sha(readFileSync(join(root, 'ui', 'assets', 'index-x.css'))),
    },
  };
  writeFileSync(join(root, 'manifest.json'), JSON.stringify(manifest, null, 2));
  return root;
}

test('baking adds one stylesheet link and records it in the manifest', () => {
  const shellRoot = fixture();
  const { cssFile } = bake({ shellRoot, brand: () => BRAND });
  const html = readFileSync(join(shellRoot, 'ui', 'index.html'), 'utf8');
  assert.equal((html.match(/data-no996-baked/g) || []).length, 1);
  assert.ok(html.indexOf('data-no996-baked') > html.indexOf('index-x.css'));
  const css = readFileSync(cssFile, 'utf8');
  assert.match(css, /--n996-accent: #ff6400/);
  const manifest = JSON.parse(readFileSync(join(shellRoot, 'manifest.json'), 'utf8'));
  assert.equal(manifest.files['ui/index.html'], sha(html));
  assert.equal(manifest.files['ui/assets/no996-theme.css'], sha(css));
  assert.equal(manifest.overrides.theme.sha256, sha(css));
  assert.equal(manifest.version, '0.3.2');
});

test('baking twice is idempotent', () => {
  const shellRoot = fixture();
  bake({ shellRoot, brand: () => BRAND });
  const first = readFileSync(join(shellRoot, 'ui', 'index.html'), 'utf8');
  bake({ shellRoot, brand: () => BRAND });
  const second = readFileSync(join(shellRoot, 'ui', 'index.html'), 'utf8');
  assert.equal(first, second);
  assert.equal((second.match(/data-no996-baked/g) || []).length, 1);
});

test('the baked CSS is exactly what development injects', () => {
  const css = composeThemeCss({ brand: () => BRAND });
  assert.match(css, /--n996-accent: #ff6400/);
  assert.match(css, /--n996-radius/);
  assert.match(css, /::selection/);
});
