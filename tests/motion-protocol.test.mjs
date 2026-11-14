import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * 生产协议不是文档装饰：它要在预设里被找到、被引用，素材库要真的在盘上。
 * 这几条断言保证「模型被告知的行为」与「仓库里存在的东西」不分叉。
 */

const root = fileURLToPath(new URL('../', import.meta.url));
const read = (rel) => readFileSync(join(root, rel), 'utf8');

test('skill：frontmatter 完整，描述里带触发词', () => {
  const text = read('skills/openfilm-motion/SKILL.md');
  const front = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text);
  assert.ok(front, 'has frontmatter');
  assert.match(front[1], /^name:\s*openfilm-motion$/m);
  const description = /^description:\s*(.+)$/m.exec(front[1])[1];
  for (const word of ['动效', '风格', '开始']) assert.ok(description.includes(word), 'description mentions ' + word);
  for (const gate of ['G0', 'G1', 'G2', 'G3', 'G4', 'G5', 'G6']) assert.ok(text.includes(gate), 'skill lists ' + gate);
});

test('规范：七道闸门与完成契约都在', () => {
  const text = read('docs/MOTION.md');
  for (const gate of ['G0 接单', 'G1 分镜', 'G2 定调帧', 'G3 量产', 'G4 声音', 'G5 帧检', 'G6 交付']) {
    assert.ok(text.includes(gate), 'spec lists ' + gate);
  }
  assert.match(text, /完成契约/);
  assert.match(text, /允许停下来问的三种情况/);
});

test('预设提示：明确指向 openfilm-motion 与「回读输出」', () => {
  const text = read('src/openfilm-prompt.mjs');
  assert.ok(text.includes('openfilm-motion'), 'prompt names the skill');
  assert.ok(text.includes('read its outputs back'), 'prompt defines done');
  assert.ok(text.includes('Do not pause between those stages'), 'prompt forbids mid-way stalls');
});

test('风格库：14 种，brief/prompt/样片齐全', () => {
  const catalog = JSON.parse(read('vendor/motion/styles/catalog.json'));
  assert.equal(catalog.styles.length, 14);
  assert.equal(catalog.license, 'MIT');
  for (const style of catalog.styles) {
    assert.ok(existsSync(join(root, 'vendor/motion/styles', style.brief)), style.slug + ' brief');
    assert.ok(existsSync(join(root, 'vendor/motion/styles', style.prompt)), style.slug + ' prompt');
    const demo = join(root, 'vendor/motion/styles', style.demos[0]);
    assert.ok(existsSync(demo), style.slug + ' demo');
    // 不要求样片自包含：上游开发服务器的页面会引用 /node_modules、/assets/fonts、
    // /demos/<slug>/film.js。要求的是依赖被如实记进索引，而不是假装它没有。
    assert.ok(readFileSync(demo, 'utf8').length > 0, style.slug + ' demo readable');
  }
});

test('镜头卡：124 张，每张有 recipe 与分类', () => {
  const catalog = JSON.parse(read('vendor/motion/shotcards/catalog.json'));
  assert.equal(catalog.cards.length, 124);
  assert.equal(Object.keys(catalog.categories).length, 10);
  for (const card of catalog.cards) {
    assert.ok(catalog.categories[card.category], card.id + ' category');
    assert.ok(existsSync(join(root, 'vendor/motion/shotcards', card.source)), card.id + ' recipe');
  }
});

test('风格索引：14 种都在，且写明搬运依赖（已并入 MOTION.md）', () => {
  const doc = read('docs/MOTION.md');
  for (const slug of ['01-flat-vector', '02-line-art', '10-synthwave', '22-hud']) assert.ok(doc.includes(slug), 'index lists ' + slug);
  assert.ok(doc.includes('搬样片要带的依赖'), 'index states porting deps');
});

test('构建产物：每个模板的 motion.js 与源一致，页面按顺序加载', () => {
  const source = read('vendor/templates/_kit/motion/motion.js').trim();
  // 目前只有复刻片声明了 sharedScripts；其它模板接入时把名字加进这份清单。
  for (const template of ['replica-film']) {
    const emitted = read('vendor/templates/' + template + '/assets/motion.js').trim();
    assert.ok(emitted.endsWith(source), template + ' motion.js matches source');
  }
  const page = read('vendor/templates/replica-film/pages/shot-01.html');
  assert.ok(page.indexOf('assets/motion.js') < page.indexOf('assets/scene.js'), 'motion.js loads before scene.js');
});

test('motion-styles：模板页暴露影片契约，镜头墙引用正确', () => {
  const page = read('vendor/templates/motion-styles/pages/shot-01.html');
  assert.match(page, /window\.film = \{/);
  assert.match(page, /frame: function \(t\)/);
  assert.match(page, /window\.__ready === true/);
  const wall = read('vendor/templates/motion-styles/film.html');
  assert.match(wall, /src="pages\/shot-01\.html#t=0,10"/);
  assert.match(wall, /at="0\.000"/);
  assert.match(wall, /src="pages\/shot-02\.html#t=0,8"/);
  assert.match(wall, /at="10\.000"/);
  const authored = read('vendor/templates/motion-styles/pages/shot-02.html');
  assert.match(authored, /src="\.\.\/assets\/motion\.js"/);
  assert.match(authored, /frame: function \(t\) \{ return draw\(t\); \}/);
  // 模板必须自包含：页面里不能出现 /assets 或 /node_modules 这类绝对外链。
  assert.equal(/(?:src|href)="\/(?!\/)/.test(page), false, 'no absolute asset refs');
});

test('许可：两套库都带全文', () => {
  assert.match(read('vendor/motion/styles/LICENSE'), /MIT License/);
  assert.match(read('vendor/motion/shotcards/LICENSE'), /Apache License/);
  assert.ok(existsSync(join(root, 'vendor/motion/PROVENANCE.md')));
});
