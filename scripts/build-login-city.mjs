import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * 从上游整片样片生成登录页背景模块（assets/login-city.js）。
 *
 * 登录页要的是"城市 + 公交"这一段，而不是整支 10 秒影片。直接复用样片的
 * 绘制代码（而不是重画）能保证背景和风格库看到的是同一套图形；这里只做
 * 三处必要改写：
 *
 *   1. `getElementById('S')` → 挂载点里的 svg（同一页面可能已有 id=S）；
 *   2. cues.json 的 fetch → 内联（登录页在 file:// / dsh-app:// 下没有可 fetch 的源）；
 *   3. 去掉自动播放与 __ready，导出 renderAt 交给登录页的时钟驱动；
 *   4. 给内置太阳与光芒加 id，登录页隐藏它们，改画会东升西落的日/月。
 *
 * 生成文件已提交；改样片后跑 `npm run login:city`，CI 用 --check 校验。
 */
const root = fileURLToPath(new URL('..', import.meta.url));
const demoPath = resolve(root, 'vendor/motion/styles/demos/01-flat-vector/index.html');
const cuesPath = resolve(root, 'vendor/motion/styles/demos/01-flat-vector/cues.json');
const outPath = resolve(root, 'assets/login-city.js');

const demo = readFileSync(demoPath, 'utf8');
const cues = JSON.parse(readFileSync(cuesPath, 'utf8'));
const match = demo.match(/<script type="module">([\s\S]*?)<\/script>/);
if (!match) throw new Error('demo 01: module script not found');

let code = match[1];
const before = code;
code = code.replace("const S = document.getElementById('S');", 'const S = root;');
if (code === before) throw new Error('demo 01: mount line changed');
const cuesLine = /const cues = await \(await fetch\('[^']*cues\.json'\)\)\.json\(\);/;
if (!cuesLine.test(code)) throw new Error('demo 01: cues fetch changed');
code = code.replace(cuesLine, 'const cues = ' + JSON.stringify(cues) + ';');
const dotLine = "const dotW = el('circle', { cx: 0, cy: 0, r: R0, fill: C.CO }, world);";
if (!code.includes(dotLine)) throw new Error('demo 01: sun dot changed');
code = code.replace(dotLine, dotLine + " dotW.setAttribute('id', 'nof-sun');");
const raysLine = 'const raysG = G(world); const rays = [];';
if (!code.includes(raysLine)) throw new Error('demo 01: rays group changed');
code = code.replace(raysLine, raysLine + " raysG.setAttribute('id', 'nof-rays');");
code = code.replace('window.renderAt = async (t) => {', 'const renderAt = async (t) => {');
code = code.replace(/\nawait window\.renderAt\(0\);\nwindow\.__ready = true;\n/, '\n');

const header = [
  '/* 由 scripts/build-login-city.mjs 生成，请勿手改。',
  ' * 源：vendor/motion/styles/demos/01-flat-vector（DrawAI mg-styles，MIT）。',
  ' * 用途：登录页城市背景；window.__NOF_MOUNT_CITY__(svg) → { renderAt(t) }。',
  ' */',
  '',
].join('\n');
const output = header
  + 'window.__NOF_MOUNT_CITY__ = async function (root) {\n'
  + code
  + '\nreturn { renderAt: renderAt, width: 1920, height: 1080 };\n'
  + '};\n';

if (process.argv.includes('--check')) {
  const current = readFileSync(outPath, 'utf8');
  if (current !== output) {
    console.error('assets/login-city.js is stale; run npm run login:city');
    process.exit(1);
  }
  console.log('assets/login-city.js is up to date');
} else {
  writeFileSync(outPath, output);
  console.log('wrote assets/login-city.js (' + output.length + ' bytes)');
}
