import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = path => readFileSync(join(root, path), 'utf8');
const ctrl = read('src/studio-controller.mjs');
const routes = read('src/studio-controller/routes/system.mjs');

test('Host exposes system/check and system/install from one module', () => {
  assert.match(routes, /path: '\/api\/no996-openfilm\/system\/check'/);
  assert.match(routes, /path: '\/api\/no996-openfilm\/system\/install'/);
  // Both routes are POST-only and admitted like the other loopback routes.
  const check = routes.slice(routes.indexOf("'/api/no996-openfilm/system/check'"));
  assert.match(check, /req\.method !== 'POST'/);
  assert.match(check, /browserPeer\.id/);
});

test('the Host RPC answers from the same snapshot as the routes', () => {
  assert.match(ctrl, /channel === 'system:check'/);
  assert.match(ctrl, /channel === 'system:install'/);
  assert.match(ctrl, /system\.snapshot\(\)/);
  assert.match(ctrl, /system\.install\(tool\)/);
  // The controller must not keep a second copy of the routes or the installer.
  assert.doesNotMatch(ctrl, /api\/no996-openfilm\/system\//);
  assert.doesNotMatch(ctrl, /startSystemInstall/);
});

test('the detector prefers the installer-resolved binary', () => {
  assert.match(ctrl, /createHostComponentDetector\(\{ resolve: name => toolInstaller\.resolveAny\(name\)\?\.path \?\? null \}\)/);
});
