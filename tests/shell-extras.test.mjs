import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { shellUiInjection, shellUiVersion } from '../src/shell-extras.mjs';

const html = shellUiInjection();
const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(match => match[1]);
const body = scripts.join('\n');

test('the injected shell UI is balanced scripts that parse as JavaScript', () => {
  // Spliced into an existing <head>; a stray </script> or broken expression
  // would break the whole page rather than just the overlays.
  assert.match(html, /^<script>/);
  assert.match(html, /<\/script>$/);
  assert.equal((html.match(/<\/script>/g) || []).length, 3);
  assert.equal(scripts.length, 3);
  assert.match(body, /no996-template-picker/);
  assert.match(body, /\/__dsh\/official-rpc/);
  assert.match(body, /__dsh\/shell-version/);
  assert.match(body, /function watchVersion\(\)/);
  assert.match(body, /no996-shell-login/);
  assert.match(body, /auth:action/);
  assert.match(body, /__NOF_MOUNT_CITY__/);
  // The city block is generated upstream code and legitimately uses template literals;
  // the hand-written blocks must not contain unresolved placeholders.
  assert.doesNotMatch(scripts.filter(script => !script.includes('__NOF_MOUNT_CITY__')).join('\n'), /\$\{/);
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
    'auth:action',
    'auth:remember-clear',
    'auth:remember-get',
    'auth:remember-set',
    'auth:status',
    'client:log',
    'environment:check',
    'prefs:get',
    'project:create-blank',
    'system:check',
    'system:install',
    'template:create',
    'template:list',
  ]);
  // Account chip lives in OpenFilm React; login overlay still talks auth over the bridge.
  assert.doesNotMatch(body, /id='no996-account'/);
  assert.match(body, /auth:status/);
  assert.match(body, /no996-openfilm:auth/);
  assert.match(body, /no996-auth-changed/);
  // Compact login uses the white brand mark, not a floating panel chip.
  assert.match(body, /logo-symbol-white|今天不加班AI 深色模式Logo|dark 白橙/);
  assert.doesNotMatch(body, /sessionId|projectPath|\/api\/no996-openfilm/);
});

test('a dead Studio is answered inside the page, not with an app-restart hint', () => {
  // The upstream overlay says to restart an application the person cannot see.
  // Our own control must be present, must poll, and must lead to the console.
  assert.match(body, /no996-stopped/);
  assert.match(body, /重新启动工作台/);
  assert.doesNotMatch(body, /http:\/\/127\.0\.0\.1:47821\/editor/);
  assert.match(body, /no996-openfilm:restart/);
  assert.match(body, /window\.parent\.postMessage/);
  assert.match(body, /\/api\/version/);
  assert.match(body, /misses>=2/);
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
