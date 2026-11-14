import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { shellUiInjection, shellUiVersion } from '../src/shell-extras.mjs';

const html = shellUiInjection();
const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(match => match[1]);
const body = scripts.join('\n');

test('the injected shell UI is balanced scripts that parse as JavaScript', () => {
  // Spliced into an existing <head>; a stray </script> or broken expression
  // would break the whole page rather than just the overlays.
  assert.match(html, /^<script>/);
  assert.match(html, /<\/script>$/);
  // Only the UI overlay is still injected; the login gate ships in the bundle.
  assert.equal((html.match(/<\/script>/g) || []).length, 1);
  assert.equal(scripts.length, 1);
  assert.match(body, /\/__dsh\/official-rpc/);
  assert.match(body, /__dsh\/shell-version/);
  assert.match(body, /function watchVersion\(\)/);
  assert.match(body, /auth:status/);
  // The hand-written block must not contain unresolved placeholders.
  assert.doesNotMatch(body, /\$\{/);
  for (const script of scripts) new Function(script);
});

test('the login city module is generated and mountable', () => {
  const city = readFileSync(new URL('../assets/login-city.js', import.meta.url), 'utf8');
  assert.match(city, /window\.__NOF_MOUNT_CITY__ = async function \(root\)/);
  assert.match(city, /const renderAt = async \(t\) =>/);
  // 登录页要隐藏内置太阳/光芒，改画会东升西落的日与月。
  assert.match(city, /id', 'nof-sun'/);
  assert.match(city, /id', 'nof-rays'/);
  // file:// 与 dsh-app:// 下都没有可 fetch 的源，cues 必须内联。
  assert.doesNotMatch(city, /fetch\(/);
});

test('the template picker left the injection; the upstream card is still stopped', () => {
  // The picker is React now (TemplatePicker.tsx, shipped in the vendored build):
  // the clone-and-place code is gone from here for good.
  for (const gone of [/cloneNode\(true\)/, /wrap=buildEntry\(card\)/, /el\.textContent='选择模板'/, /no996-template-modal/, /no996-bay-in/, /no996-template-picker/, /items\.forEach/, /aria-checked/]) {
    assert.doesNotMatch(body, gone);
  }
  // What stays: upstream's own 视频复刻 card is visible but inert, the About panel
  // says what this build is, and the unknown skill entries are stopped the same way.
  assert.match(body, /视频复刻暂不可用/);
  assert.match(body, /data-no996-disabled/);
  assert.match(body, /stopImmediatePropagation/);
  assert.match(body, /'更多技能','从示例开始'/);
  assert.match(body, /基于 OpenFilm 开发/);
  assert.match(body, /'GitHub'/);
  assert.match(body, /'官网'/);
  assert.match(body, /function tuneAbout\(\)/);
  assert.match(body, /function disableExtras\(\)/);
});

test('a dead Studio is answered by the shell source, not by an injected overlay', () => {
  // The overlay moved out of the injection and into the shell app itself
  // (apps/desktop/shell/RecoveryGate.tsx, shipped in the vendored build). The
  // injection must no longer carry it; the shipped bundle must.
  assert.doesNotMatch(body, /no996-stopped/);
  assert.doesNotMatch(body, /重新启动工作台/);
  const dir = join(dirname(fileURLToPath(import.meta.url)), '..', 'vendor', 'official-shell', 'ui', 'assets');
  const bundle = readdirSync(dir)
    .filter(name => name.endsWith('.js'))
    .map(name => readFileSync(join(dir, name), 'utf8'))
    .join('\n');
  assert.match(bundle, /重新启动工作台/);
  assert.match(bundle, /no996-openfilm:restart/);
  assert.match(bundle, /\/api\/version/);
});

test('a foreign plugin probing this page cannot throw in the console', () => {
  assert.match(body, /typeof window\.__dshEsSetShortcut!=='function'/);
});

test('the About panel names the pinned OpenFilm version', async () => {
  // The fallback in the injected script must follow package.json, otherwise the
  // About panel would keep advertising a version this build no longer bundles.
  const { readFileSync } = await import('node:fs');
  const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  const pinned = /openfilm-([0-9][0-9.]*)\.tgz/.exec(String(pkg.dependencies.openfilm))[1];
  assert.match(body, /兼容 OpenFilm /);
  assert.ok(body.includes(`__no996OpenfilmVersion||'${pinned}'`), `fallback should be ${pinned}`);
});

test('the overlay version is the file mtime the page polls', () => {
  assert.match(shellUiVersion(), /^\d+$/);
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
