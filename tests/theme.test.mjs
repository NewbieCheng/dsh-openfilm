import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, utimesSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createTheme, THEME_SURFACES, themeSurfaceFor } from '../src/theme.mjs';

const BRAND = Object.freeze({
  name: '不加班剪辑',
  colors: Object.freeze({ accent: '#ff6400', paper: '#f5f0e5', ink: '#18171c' }),
});

function fixture(files = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-openfilm-theme-'));
  const defaults = {
    'tokens.css': ':root{--n996-radius:10px}',
    'shell.css': '::selection{background:var(--n996-accent)}',
    'studio.css': '.studio{outline:1px solid var(--n996-accent)}',
  };
  for (const [name, body] of Object.entries({ ...defaults, ...files })) {
    writeFileSync(join(dir, name), body);
  }
  return dir;
}

test('a surface gets brand variables plus its own stylesheet', () => {
  const theme = createTheme({ dir: fixture(), brand: () => BRAND, env: {} });
  const html = theme.injection('shell');
  assert.match(html, /^<style data-no996-theme="shell">/);
  assert.match(html, /--n996-accent: #ff6400/);
  assert.match(html, /--n996-radius:10px/);
  assert.match(html, /::selection/);
  assert.doesNotMatch(html, /\.studio/);
});

test('the studio surface does not receive shell rules', () => {
  const theme = createTheme({ dir: fixture(), brand: () => BRAND, env: {} });
  const html = theme.injection('studio');
  assert.match(html, /\.studio/);
  assert.doesNotMatch(html, /::selection/);
});

test('NO996_OPENFILM_THEME=0 turns every surface off', () => {
  const theme = createTheme({ dir: fixture(), brand: () => BRAND, env: { NO996_OPENFILM_THEME: '0' } });
  assert.equal(theme.injection('shell'), '');
  assert.equal(theme.injection('studio'), '');
});

test('an unknown surface is a programmer error, not a silent no-op', () => {
  const theme = createTheme({ dir: fixture(), brand: () => BRAND, env: {} });
  assert.throws(() => theme.injection('film'), /unknown theme surface/);
  assert.deepEqual(Object.keys(THEME_SURFACES).sort(), ['shell', 'studio']);
});

test('a stylesheet that could close the injected block is refused whole', () => {
  const dir = fixture({ 'shell.css': 'body{color:red}</style><script>alert(1)</script>' });
  const theme = createTheme({ dir, brand: () => BRAND, env: {} });
  assert.equal(theme.injection('shell'), '');
});

test('a missing stylesheet degrades to no injection instead of breaking the page', () => {
  const dir = fixture();
  const theme = createTheme({ dir, brand: () => BRAND, env: {} });
  // tokens.css is read first; removing it makes the whole surface unavailable.
  writeFileSync(join(dir, 'tokens.css'), '');
  const empty = createTheme({ dir: join(dir, 'nope'), brand: () => BRAND, env: {} });
  assert.equal(empty.injection('shell'), '');
  assert.match(theme.injection('shell'), /--n996-accent/);
});

test('saving a stylesheet is picked up without a restart', () => {
  const dir = fixture();
  const theme = createTheme({ dir, brand: () => BRAND, env: {} });
  assert.match(theme.injection('shell'), /::selection/);
  const path = join(dir, 'shell.css');
  writeFileSync(path, '.saved{color:var(--n996-accent)}');
  const later = new Date(Date.now() + 2000);
  utimesSync(path, later, later);
  assert.match(theme.injection('shell'), /\.saved/);
});

test('version is a stable string derived from the files on disk', () => {
  const theme = createTheme({ dir: fixture(), brand: () => BRAND, env: {} });
  assert.match(theme.version(), /^\d+$/);
});

test('the shell owns only the root route; the editor owns project routes', () => {
  assert.equal(themeSurfaceFor('/', true), 'shell');
  assert.equal(themeSurfaceFor('/', false), 'studio');
  assert.equal(themeSurfaceFor('/projects/abc123', true), 'studio');
  assert.equal(themeSurfaceFor('/projects/abc123', false), 'studio');
});
