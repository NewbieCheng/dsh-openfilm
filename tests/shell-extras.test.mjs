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
  assert.match(body, /no996-template-picker/);
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

test('picker lists templates beside the disabled original suggestion', () => {
  assert.match(body, /cloneNode\(true\)/);
  assert.match(body, /wrap=buildEntry\(card\)/);
  assert.match(body, /el\.textContent='选择模板'/);
  assert.match(body, /wrap\.nextElementSibling!==host/);
  assert.match(body, /holder\.cloneNode\(true\)/);
  // Account chip + reload moved into OpenFilm React (WorkbenchAccountControls).
  assert.match(body, /WorkbenchAccountControls/);
  assert.match(body, /data-workbench-account/);
  assert.match(body, /基于 OpenFilm 开发/);
  assert.match(body, /function tuneAbout\(\)/);
  assert.match(body, /'GitHub'/);
  assert.match(body, /'官网'/);
  assert.match(body, /aria-expanded/);
  assert.match(body, /button,\[role="button"\],a,div,span,p/);
  assert.match(body, /aria-disabled/);
  assert.match(body, /stopImmediatePropagation/);
  assert.doesNotMatch(body, /card\.style\.display='none'/);
  assert.match(body, /items\.forEach/);
  assert.match(body, /aria-checked/);
  assert.match(body, /cancel\.textContent='取消'/);
  assert.match(body, /create\.textContent='用这个开工'/);
  assert.match(body, /你想剪哪种视频？/);
  assert.match(body, /#FF6400/);
  assert.match(body, /no996-bay-in/);
  assert.match(body, /no996-template-modal/);
  assert.match(body, /role','dialog'|aria-modal/);
  assert.match(body, /no996-template-picker/);
  assert.match(body, /whiteSpace='nowrap'/);
  assert.match(body, /function disableExtras\(\)/);
  assert.match(body, /'更多技能','从示例开始'/);
  assert.match(body, /no996-bay-rail/);
  assert.match(body, /min\(1080px,96vw\)/);
  assert.match(body, /openFlag/);
  assert.doesNotMatch(body, /create\.style\.cssText=[\s\S]{0,200}#3b82f6/);
  assert.doesNotMatch(body, /rpc\('editor:link'/);
  assert.match(body, /wrap\.style\.display='none';[\s\S]{0,120}location\.href/);
  assert.doesNotMatch(body, /wrap\.style\.cssText='position:fixed/);
});

test('the overlays only talk over the fixed bridge channels', () => {
  const channels = [...body.matchAll(/rpc\('([^']+)'/g)].map(match => match[1]);
  assert.deepEqual([...new Set(channels)].sort(), [
    'asr:install',
    'auth:status',
    'environment:check',
    'prefs:get',
    'project:create-blank',
    'system:check',
    'system:install',
    'template:create',
    'template:list',
  ]);
  // Account chip lives in OpenFilm React; the login gate now ships in the bundle.
  assert.doesNotMatch(body, /id='no996-account'/);
  assert.match(body, /auth:status/);
  assert.doesNotMatch(body, /no996-shell-login/);
  assert.doesNotMatch(body, /__NOF_MOUNT_CITY__/);
  assert.doesNotMatch(body, /sessionId|projectPath|\/api\/no996-openfilm/);
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
