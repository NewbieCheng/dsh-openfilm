import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * 一次性转换器：把 replica-film 的 19 个手工页面拆成
 *   shots/<id>.json      元信息 + COPY（内容）
 *   shots/<id>.content.html  该镜头 #content 的静态标记
 *   shots/<id>.anim.js   该镜头的 draw()（动画是逐镜头写的代码，不假装能数据化）
 *
 * 转换后页面由 _kit/replica/page.mjs 生成。原页面留在 tests/fixtures 里，
 * 用来证明"拆出来的片段 + 动画 = 原来的页面"。
 */

const root = fileURLToPath(new URL('../', import.meta.url));
const dir = join(root, 'vendor', 'templates', 'replica-film');
const pages = readdirSync(join(dir, 'pages')).filter(name => name.endsWith('.html')).sort();

const escapeHtml = value => String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
/** Same helper the pages import from scene.js. */
const pills = list => list.map(item => `<span class="pill">${escapeHtml(item)}</span>`).join('');

for (const name of pages) {
  const id = name.replace(/\.html$/, '');
  const source = readFileSync(join(dir, 'pages', name), 'utf8');

  const copyMatch = /const COPY = (\{[\s\S]*?\n  \});/.exec(source);
  if (!copyMatch) throw new Error(`${id}: COPY not found`);
  const copy = JSON.parse(copyMatch[1]);

  const duration = Number(/const DURATION = ([\d.]+);/.exec(source)[1]);
  const start = Number(/const START = ([\d.]+);/.exec(source)[1]);

  const stageClass = /<main id="stage" class="([^"]*)"/.exec(source)[1];
  const title = /<title>([^<]*)<\/title>/.exec(source)[1];
  const inlineStyle = (/<style>([\s\S]*?)<\/style>/.exec(source)?.[1] ?? '').trim();

  const htmlMatch = /\$\('#content'\)\.innerHTML = `([\s\S]*?)`;\n/.exec(source);
  if (!htmlMatch) throw new Error(`${id}: content literal not found`);
  const expression = htmlMatch[1];
  const content = new Function('COPY', 'escape', 'pills', `return \`${expression}\`;`)(copy, escapeHtml, pills);

  const drawMatch = /function draw\(t\) \{([\s\S]*?)\n  \}/.exec(source);
  if (!drawMatch) throw new Error(`${id}: draw not found`);
  const draw = drawMatch[1];

  const helpers = /const \{ ([^}]+) \} = Scene;/.exec(source)[1].split(',').map(part => part.trim()).filter(Boolean);

  writeFileSync(join(dir, 'shots', `${id}.json`), `${JSON.stringify({
    id,
    title: title.replace(/^\d+ · /, ''),
    pageTitle: title,
    theme: stageClass,
    start,
    duration,
    helpers,
    copy,
    ...(inlineStyle ? { style: inlineStyle } : {}),
  }, null, 2)}\n`, 'utf8');
  writeFileSync(join(dir, 'shots', `${id}.content.html`), content.replace(/^\n/, '').replace(/\n$/, '') + '\n', 'utf8');
  writeFileSync(join(dir, 'shots', `${id}.anim.js`), `function draw(t) {${draw}\n}\n`, 'utf8');
  console.log(`${id}: ${content.length} bytes content, draw ${draw.length} bytes, helpers ${helpers.join('/')}`);
}
