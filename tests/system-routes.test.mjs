import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const ctrl = readFileSync(join(root, 'src', 'studio-controller.mjs'), 'utf8');

test('Host exposes system/check and system/install, and both mirror the installer', () => {
  assert.match(ctrl, /path: '\/api\/no996-openfilm\/system\/check'/);
  assert.match(ctrl, /path: '\/api\/no996-openfilm\/system\/install'/);
  assert.match(ctrl, /channel === 'system:check'/);
  assert.match(ctrl, /channel === 'system:install'/);
  assert.match(ctrl, /startSystemInstall/);
  // Both routes are POST-only and admitted like the other loopback routes.
  const check = ctrl.slice(ctrl.indexOf("'/api/no996-openfilm/system/check'"));
  assert.match(check, /req\.method !== 'POST'/);
  assert.match(check, /browserPeer\.id/);
});

test('the detector prefers the installer-resolved binary', () => {
  assert.match(ctrl, /createHostComponentDetector\(\{ resolve: name => toolInstaller\.resolveAny\(name\)\?\.path \?\? null \}\)/);
});
