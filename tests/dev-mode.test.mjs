import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createWorkbenchAuth } from '../src/workbench-auth.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

test('dev mode: status is a synthetic local session, no fetch, no file', async (t) => {
  const home = mkdtempSync(join(tmpdir(), 'openfilm-dev-'));
  t.after(() => rmSync(home, { recursive: true, force: true }));
  let called = 0;
  const auth = createWorkbenchAuth({
    dev: true,
    home,
    fetchImpl: () => { called += 1; throw new Error('dev must not reach the network'); },
  });
  const status = await auth.status();
  assert.equal(status.loggedIn, true);
  assert.equal(status.dev, true);
  assert.equal(status.account, 'dev@local');
  assert.equal(status.displayName, '开发模式');
  assert.equal(called, 0);
  assert.equal(existsSync(join(home, 'no996-openfilm', 'workbench-auth.json')), false);
  const out = await auth.logout();
  assert.equal(out.loggedIn, true);
  assert.equal(out.dev, true);
});

test('without dev mode and without a session, status is logged out', async (t) => {
  const home = mkdtempSync(join(tmpdir(), 'openfilm-nodev-'));
  t.after(() => rmSync(home, { recursive: true, force: true }));
  const auth = createWorkbenchAuth({ dev: false, home, fetchImpl: () => { throw new Error('no network'); } });
  const status = await auth.status();
  assert.equal(status.loggedIn, false);
  assert.equal(status.dev, undefined);
});

test('shell-ui no longer probes on page load', () => {
  const source = readFileSync(join(root, 'assets', 'shell-ui.js'), 'utf8');
  assert.match(source, /window\.__no996CheckTools=function\(\)\{run\(\);\};/);
  // 页面加载时不得直接调用 run()：旧代码在环境面板 IIFE 末尾就跑了。
  assert.equal(/\n\s{4}run\(\);\n\s{2\}\)\(\);/.test(source), false);
});

test('controller enables dev only from the explicit environment flag', () => {
  const source = readFileSync(join(root, 'src', 'studio-controller.mjs'), 'utf8');
  assert.match(source, /createWorkbenchAuth\(\{ dev: process\.env\.NO996_OPENFILM_DEV === '1' \}\)/);
  assert.match(source, /dev: status\.dev === true/);
});
