import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const ui = readFileSync(join(root, 'assets', 'shell-ui.js'), 'utf8');
const ctrl = readFileSync(join(root, 'src', 'studio-controller.mjs'), 'utf8');

test('首次启动向导只在前台跑一次：受 onboardingCompleted 与 sessionStorage 控制', () => {
  assert.match(ui, /__no996FirstRun/);
  assert.match(ui, /prefs\.onboardingCompleted===true\)return/);
  assert.match(ui, /sessionStorage\.getItem\('no996\.onboard\.skip'\)/);
  // 环境齐了就直接交给原片型页，不额外打扰。
  assert.match(ui, /if\(ff&&fp&&asrState\.ready===true\)return/);
});

test('向导的安装动作走固定桥通道，不新造下载器', () => {
  assert.match(ui, /rpc\('system:check'/);
  assert.match(ui, /rpc\('system:install'/);
  assert.match(ui, /rpc\('asr:install'/);
  assert.match(ctrl, /channel === 'system:check'/);
  // 注入层不许直连 /api：所有请求都必须经过 official-rpc。
  assert.equal(/\/api\/no996-openfilm/.test(ui), false);
});

test('向导只在登录后出现', () => {
  assert.match(ui, /if\(!status\|\|status\.loggedIn!==true\)/);
  assert.match(ui, /no996-auth-changed/);
});

test('开发者模式是显式环境变量，且不写真实会话', () => {
  assert.match(ctrl, /NO996_OPENFILM_DEV === '1'/);
  assert.match(ctrl, /if \(workbenchAuth\.dev\) return \{ loggedIn: true, dev: true \}/);
});
