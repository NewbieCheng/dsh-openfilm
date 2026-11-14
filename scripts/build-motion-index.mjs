import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * 把 vendor/motion 的两份 catalog 注入 docs/MOTION.md 的标记区。
 *
 * 为什么注入而不是各自成文：风格库和镜头卡只在"做一支片"时被读，单独两个文件只是
 * 让人多点两次；而它们又必须由 catalog 生成，手写迟早和上游分叉（模型读到"不存在的
 * 卡"比读不到更糟）。标记区让规范正文与生成清单待在同一篇里，各管各的边界。
 *
 * `--check` 在 CI 里拦住"改了 catalog 忘了重建"。
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

const stylesBlock = [
  '### 6.1 风格库（' + styles.styles.length + ' 种 · 自动生成）',
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
  '选风格看三件事：引擎（`dom` / `canvas2d` / `three`）、能量（静 / 中 / 高）、你的画幅。',
  '搬样片前先看最后一列：多数样片**不是**拿来就能跑；再读 `briefs/<slug>.md` 的 signature 动作、色板与节奏。',
  '`three` 的两支（10 / 22）要先确认 Studio 渲染路径支持 WebGL，再决定搬不搬。',
].join('\n');

const byCategory = new Map();
for (const card of cards.cards) {
  const list = byCategory.get(card.category) ?? [];
  list.push(card);
  byCategory.set(card.category, list);
}

const cardsBlockLines = [
  '### 6.2 镜头卡（' + cards.cards.length + ' 张 · 自动生成）',
  '',
  '> 由 `scripts/build-motion-index.mjs` 从 `vendor/motion/shotcards/catalog.json` 生成，不要手改。',
  '> 上游 [video-shotcraft](https://github.com/Vincentwei1021/video-shotcraft)（Apache-2.0，commit `1266a3e`）。',
  '> 每张卡的完整 recipe（动效核心 / 参数表 / 已知坑）在 `vendor/motion/shotcards/references/shots/`。',
  '',
  '用法：按类别找一张卡（开场 / 字卡 / 数据 / 转场…）→ 读 recipe 的**动效核心**与**参数表**，把参数按自己的时长换算 →',
  '用当镜的引擎实现（DOM / Canvas / WebGL），**不要**照搬 TSX → 一镜只用一张卡的核心动作，混三张就变成 PPT。',
  '',
];
for (const [key, category] of Object.entries(cards.categories)) {
  const list = byCategory.get(key) ?? [];
  cardsBlockLines.push('#### ' + category.zh + ' · ' + key + '（' + list.length + '）', '');
  cardsBlockLines.push('| 卡 | 时长 | 能量 | 一句话 |');
  cardsBlockLines.push('|---|---|---|---|');
  for (const card of list) {
    cardsBlockLines.push('| **' + card.id + '** | ' + (card.duration || '-') + ' | ' + trim(card.energy, 18) + ' | ' + trim(card.summary, 52) + ' |');
  }
  cardsBlockLines.push('');
}
const cardsBlock = cardsBlockLines.join('\n');

const target = join(root, 'docs/MOTION.md');
const current = readFileSync(target, 'utf8');

function inject(text, name, block) {
  const start = '<!-- generated:' + name + ':start -->';
  const end = '<!-- generated:' + name + ':end -->';
  const from = text.indexOf(start);
  const to = text.indexOf(end);
  if (from < 0 || to < 0 || to < from) {
    throw new Error('docs/MOTION.md is missing the ' + name + ' marker pair');
  }
  return text.slice(0, from + start.length) + '\n' + block.trimEnd() + '\n' + text.slice(to);
}

const next = inject(inject(current, 'styles', stylesBlock), 'shotcards', cardsBlock);

if (next === current) {
  console.log('motion index is current');
} else if (check) {
  console.error('out of date: docs/MOTION.md (run npm run motion:index)');
  process.exitCode = 1;
} else {
  writeFileSync(target, next, 'utf8');
  console.log('wrote docs/MOTION.md');
}
