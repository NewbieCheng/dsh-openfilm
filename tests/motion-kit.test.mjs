import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

/**
 * 动作库的数学是不允许"看着差不多"的那一层：弹簧过冲、落体回弹、确定性随机，
 * 一旦漂了，19 个镜头会一起变样。所以测试直接执行**要发出去的那个文件**，
 * 而不是复制一份实现来对拍——复制的那份迟早和真身分叉。
 */

const root = fileURLToPath(new URL('../', import.meta.url));
const source = join(root, 'vendor', 'templates', '_kit', 'motion', 'motion.js');

function loadMotion() {
  assert.ok(existsSync(source), 'motion.js exists');
  const code = readFileSync(source, 'utf8');
  const sandbox = { window: {}, document: { querySelector: () => null, createElement: () => ({ style: {}, classList: { add() {} } }) } };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(code, sandbox, { filename: 'motion.js' });
  return sandbox.window.Motion;
}

const Motion = loadMotion();

test('时间：seg 夹在 0..1，stagger 线性', () => {
  assert.equal(Motion.seg(-1, 0, 1), 0);
  assert.equal(Motion.seg(0, 0, 1), 0);
  assert.equal(Motion.seg(0.5, 0, 1), 0.5);
  assert.equal(Motion.seg(2, 0, 1), 1);
  assert.equal(Motion.stagger(3, 0.04), 0.12);
});

test('弹簧：0 起、1 落、过冲约 9%', () => {
  assert.equal(Motion.spring(0), 0);
  assert.ok(Math.abs(Motion.spring(2) - 1) < 0.001, 'settles at 1');
  let peak = 0;
  for (let i = 0; i <= 200; i += 1) peak = Math.max(peak, Motion.spring(i * 0.005));
  assert.ok(peak > 1.05 && peak < 1.12, 'overshoot in the 5-12% band, got ' + peak.toFixed(3));
  // 同一时刻，低阻尼偏得更远（此时是下冲），高阻尼更贴近 1。
  assert.ok(Motion.spring(0.5, 0.6, 0.4) < Motion.spring(0.5, 0.6, 0.9));
  assert.ok(Number.isFinite(Motion.spring(0.3, 0.6, 1)), 'critical damping must not divide by zero');
});

test('落体：先下坠后触地，回弹收敛', () => {
  const start = Motion.drop(0);
  assert.equal(start.y, 1);
  assert.equal(start.sy, 1);
  assert.equal(start.landed, false);
  assert.ok(Motion.drop(0.15).y < 1 && Motion.drop(0.15).y > 0);
  assert.equal(Motion.drop(0.31).y, 0);
  assert.equal(Motion.drop(0.31).landed, true);
  assert.ok(Math.abs(Motion.drop(5).sy - 1) < 0.001);
});

test('确定性随机：同参同值，异参异值', () => {
  assert.equal(Motion.det(10, 2, 3), Motion.det(10, 2, 3));
  assert.notEqual(Motion.det(10, 2, 3), Motion.det(10, 2, 4));
  assert.notEqual(Motion.det(10, 2, 3), Motion.det(10, 3, 3));
  for (let i = 0; i < 50; i += 1) {
    const value = Motion.det(i, 7, 1);
    assert.ok(value >= 0 && value < 1, 'in [0,1)');
  }
  assert.equal(Motion.halton(0, 2), 0.5);
  assert.equal(Motion.halton(0, 3), 1 / 3);
});

test('相机取逆：推近再取逆回到原尺度', () => {
  const inverse = Motion.inversePose({ x: 100, y: -40, scale: 2, z: 300, rotate: 30 });
  assert.equal(inverse.zoom, 0.5);
  assert.equal(inverse.rotate, -30);
  assert.equal(inverse.x, -100);
  assert.equal(inverse.z, -300);
});

test('纯函数纪律：源码里没有墙上时钟与真随机', () => {
  const code = readFileSync(source, 'utf8');
  assert.equal(/Math\.random\s*\(/.test(code), false, 'no Math.random');
  assert.equal(/Date\.now\s*\(/.test(code), false, 'no Date.now');
  assert.equal(/performance\.now\s*\(/.test(code), false, 'no performance.now');
});
