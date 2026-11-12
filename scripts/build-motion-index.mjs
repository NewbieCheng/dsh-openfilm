import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * 从 vendor/motion 的两个 catalog 生成两份人读索引。
 *
 * 为什么生成而不是手写：124 张卡与 14 种风格会随上游更新，手写索引迟早和
 * catalog 分叉；模型读到"不存在的卡"比读不到更糟。生成物提交进仓库，
 * `--check` 用来在 CI 里拦住"改了 catalog 忘了重建"。
 */

const root = fileURLToPath(new URL('../', import.meta.url));
const check = process.argv.includes('--check');
const readJson = (rel) => JSON.parse(readFileSync(join(root, rel), 'utf8'));
const trim = (text, max) => {
  const value = String(text || '').replace(/\s+/g, ' ').trim();
  return value.length > max ? value.slice(0, max - 1) + '…' : value;
};

const styles = readJson('vendor/motion/styles/catalog.json');
const cards = readJson('vendor/motion/shotcards/catalog.json');

/**
 * 样片是上游开发服务器里的页面，很多引用 /node_modules、/assets/fonts、
 * /demos/<slug>/film.js。把它们说成"拿来就能用"会让下一个人白花一天，
 * 所以这里按实际标记算出搬运依赖，写进索引。
 */
function demoDeps(demoPath) {
  const file = join(root, 'vendor/motion/styles', demoPath);
  const html = existsSync(file) ? readFileSync(file, 'utf8') : '';
  const refs = [...html.matchAll(/(?:src|href)="(\/[^"]+)"/g)].map((match) => match[1]);
  const parts = [];
  if (refs.some((ref) => ref.startsWith('/node_modules'))) parts.push('node_modules');
  if (refs.some((ref) => ref.startsWith('/assets'))) parts.push('上游字体');
  if (/three\/addons|three\/build|from ['"]three/.test(html)) parts.push('three');
  if (/type="module"/.test(html) && refs.some((ref) => ref.endsWith('.js'))) parts.push('本地 film.js');
  return parts.length ? parts.join(' + ') : '单文件';
}

const stylesDoc = [
  '# 风格库（14 种）',
  '',
  '> 由 `scripts/build-motion-index.mjs` 从 `vendor/motion/styles/catalog.json` 生成，不要手改。',
  '> 上游 [mg-styles-15](https://github.com/Vincentwei1021/mg-styles-15)（MIT，commit `49052d8`）。',
  '',
  '| 风格 | 引擎 | 画幅/时长 | 节奏 | 搬样片要带的依赖 | 一句话 | 入口 |',
  '|---|---|---|---|---|---|---|',
  ...styles.styles.map((style) => {
    const rhythm = style.rhythm || {};
    const spec = [style.aspect || '16:9', (rhythm.duration || '?') + 's'].join(' / ');
    const beat = [rhythm.bpm ? rhythm.bpm + ' bpm' : '-', rhythm.cutFrames ? rhythm.cutFrames + 'f 切' : ''].filter(Boolean).join(' · ');
    return '| **' + style.slug + '** ' + style.name + ' | ' + (style.engine || '-') + ' | ' + spec + ' | ' + beat
      + ' | ' + demoDeps(style.demos[0]) + ' | ' + trim(style.oneLiner, 46) + ' | `' + style.demos[0] + '` |';
  }),
  '',
  '## 怎么用',
  '',
  '1. 先看样片（`vendor/motion/styles/demos/<slug>/index.html`）——多数是"给定 t 画一帧"的页面，但**不是**拿来就能跑：上表倒数第二列写明要带哪些依赖；',
  '2. 读同 slug 的 `briefs/<slug>.md`：signature（签名动作）、色板、字体、节奏；',
  '3. 按 `docs/MOTION.md` 的 G2 先做一镜定调帧，风格对了再铺开；',
  '4. 引擎是 `three` 的两支（10/22）先确认 Studio 渲染路径支持 WebGL，再决定要不要搬。',
  '',
].join('\n');

const byCategory = new Map();
for (const card of cards.cards) {
  const list = byCategory.get(card.category) ?? [];
  list.push(card);
  byCategory.set(card.category, list);
}

const cardsDoc = [
  '# 镜头卡（124 张）',
  '',
  '> 由 `scripts/build-motion-index.mjs` 从 `vendor/motion/shotcards/catalog.json` 生成，不要手改。',
  '> 上游 [video-shotcraft](https://github.com/Vincentwei1021/video-shotcraft)（Apache-2.0，commit `1266a3e`）。',
  '> 每张卡的完整 recipe（动效核心 / 参数表 / 已知坑）在 `vendor/motion/shotcards/references/shots/`。',
  '',
  '## 怎么用',
  '',
  '1. 按类别找一张卡（开场 / 字卡 / 数据 / 转场…）；',
  '2. 读 recipe 的**动效核心**与**参数表**，把参数按自己的时长换算；',
  '3. 用当镜的引擎实现（DOM / Canvas / WebGL），不要照搬 TSX；',
  '4. 一镜只用一张卡的核心动作，混三张就变成 PPT。',
  '',
];
for (const [key, category] of Object.entries(cards.categories)) {
  const list = byCategory.get(key) ?? [];
  cardsDoc.push('## ' + category.zh + ' · ' + key + '（' + list.length + '）', '');
  cardsDoc.push('| 卡 | 时长 | 能量 | 一句话 |');
  cardsDoc.push('|---|---|---|---|');
  for (const card of list) {
    cardsDoc.push('| **' + card.id + '** | ' + (card.duration || '-') + ' | ' + trim(card.energy, 18) + ' | ' + trim(card.summary, 52) + ' |');
  }
  cardsDoc.push('');
}
const cardsDocText = cardsDoc.join('\n');

const planned = [
  { path: join(root, 'docs/STYLES.md'), body: stylesDoc },
  { path: join(root, 'docs/SHOT-CARDS.md'), body: cardsDocText },
];

let changed = 0;
for (const file of planned) {
  const current = existsSync(file.path) ? readFileSync(file.path, 'utf8') : null;
  if (current === file.body) continue;
  changed += 1;
  if (check) {
    console.error('out of date: ' + file.path.replace(root, ''));
    continue;
  }
  writeFileSync(file.path, file.body, 'utf8');
  console.log('wrote ' + file.path.replace(root, ''));
}
if (check && changed) process.exitCode = 1;
else if (!check) console.log(changed + ' file(s) updated');
