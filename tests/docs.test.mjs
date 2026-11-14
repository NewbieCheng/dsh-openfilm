import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { checkDocs, linksIn, markdownFiles, stripFences } from '../scripts/docs-check.mjs';
import { checkBrand, walkStrings } from '../scripts/brand-check.mjs';

function temp() {
  return mkdtempSync(join(tmpdir(), 'dsh-openfilm-docs-'));
}

test('a dead relative link is reported, a live one is not', () => {
  const root = temp();
  writeFileSync(join(root, 'a.md'), '[ok](b.md) [dead](missing.md) [web](https://example.com)');
  writeFileSync(join(root, 'b.md'), '# b');
  const { problems } = checkDocs({ root, agentsLimit: 1024 });
  assert.deepEqual(problems, [join(root, 'a.md').slice(root.length) + ' -> missing.md']);
});

test('fenced code is not treated as links', () => {
  const text = '```\n[not a link](nope.md)\n```\n[real](b.md)';
  assert.deepEqual(linksIn(text), ['b.md']);
  assert.ok(!stripFences(text).includes('nope.md'));
});

test('routes, anchors and placeholders are skipped', () => {
  assert.deepEqual(linksIn('[x](/api/no996-openfilm/attachment?id=<hex>) [y](#top) [z](url)'), [
    '/api/no996-openfilm/attachment?id=<hex>',
    '#top',
    'url',
  ]);
  const root = temp();
  writeFileSync(join(root, 'a.md'), '[x](/api/x) [y](#top) [z](url)');
  assert.deepEqual(checkDocs({ root, agentsLimit: 1024 }).problems, []);
});

test('the agent manual has a size budget', () => {
  const root = temp();
  writeFileSync(join(root, 'AGENTS.md'), 'x'.repeat(2048));
  const { warnings } = checkDocs({ root, agentsLimit: 1024 });
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /AGENTS\.md is 2\.0 KB/);
});

test('nested markdown files are scanned', () => {
  const root = temp();
  mkdirSync(join(root, 'docs'));
  writeFileSync(join(root, 'docs', 'x.md'), '[dead](gone.md)');
  assert.ok(markdownFiles(root).some((file) => file.endsWith('x.md')));
  assert.equal(checkDocs({ root, agentsLimit: 1024 }).problems.length, 1);
});

test('the repository brand passes its own check', () => {
  assert.deepEqual(checkBrand(), []);
});

test('an upstream product name in a locale value is caught', () => {
  const root = temp();
  mkdirSync(join(root, 'assets', 'theme'), { recursive: true });
  for (const name of ['tokens.css', 'shell.css', 'studio.css']) {
    writeFileSync(join(root, 'assets', 'theme', name), ':root{--n996-x:1}');
  }
  mkdirSync(join(root, 'locale'));
  writeFileSync(join(root, 'locale', 'zh.json'), JSON.stringify({ meta: { title: 'OpenFilm 剪辑' } }));
  const problems = checkBrand({ root });
  assert.ok(problems.some((line) => line.includes('locale/zh.json:meta.title')));
});

test('walkStrings reaches arrays and nested objects', () => {
  const seen = [];
  walkStrings({ a: ['x', { b: 'y' }] }, (value, key) => seen.push([key, value]));
  assert.deepEqual(seen, [['a[0]', 'x'], ['a[1].b', 'y']]);
});

// --- freshness rules (strictMeta) -------------------------------------------

function metaRoot({ version = '0.15.1', docs = {}, root = {} } = {}) {
  const dir = temp();
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ version, scripts: { build: 'node x', 'docs:check': 'node y' } }));
  mkdirSync(join(dir, 'docs'), { recursive: true });
  for (const [name, body] of Object.entries(docs)) writeFileSync(join(dir, 'docs', name), body);
  for (const [name, body] of Object.entries(root)) writeFileSync(join(dir, name), body);
  return dir;
}

const GOOD_HEADER = '<!-- doc\nid: x\nreader: 谁\nfact-source: src/x.mjs\nchecked: 0.15.1\nrot-if: 变了\n-->\n\n';

test('strictMeta requires the doc header under docs/', () => {
  const dir = metaRoot({ docs: { 'a.md': '# no header\n' } });
  const { problems } = checkDocs({ root: dir, agentsLimit: 1024, strictMeta: true });
  assert.ok(problems.some((line) => line.includes('missing <!-- doc ... --> header')));
});

test('strictMeta accepts a complete header and rejects a missing field', () => {
  const ok = metaRoot({ docs: { 'a.md': GOOD_HEADER + '# ok\n' } });
  assert.deepEqual(checkDocs({ root: ok, agentsLimit: 1024, strictMeta: true }).problems, []);
  const broken = metaRoot({ docs: { 'a.md': GOOD_HEADER.replace('reader: 谁\n', '') + '# ok\n' } });
  assert.ok(checkDocs({ root: broken, agentsLimit: 1024, strictMeta: true }).problems.some((l) => l.includes('"reader" is missing')));
});

test('progress wording is confined to STATUS and ROADMAP', () => {
  const dir = metaRoot({
    docs: {
      'ARCHITECTURE.md': GOOD_HEADER + '这个功能源码完成，待真机验证。\n',
      'STATUS.md': GOOD_HEADER + '源码完成，待真机验证。\n',
    },
  });
  const { problems } = checkDocs({ root: dir, agentsLimit: 1024, strictMeta: true });
  assert.equal(problems.filter((line) => line.includes('ARCHITECTURE.md') && line.includes('progress wording')).length, 2);
  assert.equal(problems.filter((line) => line.startsWith('/docs/STATUS.md')).length, 0);
});

test('a stale claim is reported where the doc lives', () => {
  const dir = metaRoot({ docs: { 'x.md': GOOD_HEADER + '插槽全表（77 个）\n' } });
  const { problems } = checkDocs({ root: dir, agentsLimit: 1024, strictMeta: true });
  assert.ok(problems.some((line) => line.includes('stale claim')));
});

test('a mentioned npm script must exist', () => {
  const dir = metaRoot({ docs: { 'x.md': GOOD_HEADER + '跑 `npm run nope` 和 `npm run build`。\n' } });
  const { problems } = checkDocs({ root: dir, agentsLimit: 1024, strictMeta: true });
  assert.deepEqual(problems.filter((line) => line.includes('missing script')), [
    '/docs/x.md: mentions missing script "npm run nope"',
  ]);
});

test('checked older than package.json warns, and three minors behind fails', () => {
  const near = metaRoot({ version: '0.15.1', docs: { 'x.md': GOOD_HEADER.replace('checked: 0.15.1', 'checked: 0.14.0') + '# ok\n' } });
  const nearResult = checkDocs({ root: near, agentsLimit: 1024, strictMeta: true });
  assert.deepEqual(nearResult.problems, []);
  assert.ok(nearResult.warnings.some((line) => line.includes('checked 0.14.0')));

  const far = metaRoot({ version: '0.15.1', docs: { 'x.md': GOOD_HEADER.replace('checked: 0.15.1', 'checked: 0.11.0') + '# ok\n' } });
  assert.ok(checkDocs({ root: far, agentsLimit: 1024, strictMeta: true }).problems.some((line) => line.includes('minors behind')));
});

test('generated reference pages match the tree', async () => {
  const { renderRoutes, renderEnv, renderModules } = await import('../scripts/gen-docs.mjs');
  const read = (name) => readFileSync(new URL(`../docs/reference/${name}`, import.meta.url), 'utf8');
  assert.equal(read('api-routes.md'), renderRoutes());
  assert.equal(read('env-vars.md'), renderEnv());
  assert.equal(read('modules.md'), renderModules());
  assert.match(read('api-routes.md'), /\/api\/no996-openfilm\/diagnose/);
});

// --- code spans that name repository files -----------------------------------

test('a code span naming a missing file is reported', () => {
  const dir = metaRoot({ docs: { 'x.md': GOOD_HEADER + '改 `src/gone.mjs` 即可。\n' } });
  const { problems } = checkDocs({ root: dir, agentsLimit: 1024, strictMeta: true });
  assert.deepEqual(problems.filter(line => line.includes('missing file')), [
    '/docs/x.md: names missing file src/gone.mjs',
  ]);
});

test('the same span is fine once the file exists, and line numbers are ignored', () => {
  const dir = metaRoot({ docs: { 'x.md': GOOD_HEADER + '改 `src/here.mjs:12-30` 即可。\n' } });
  mkdirSync(join(dir, 'src'), { recursive: true });
  writeFileSync(join(dir, 'src', 'here.mjs'), 'export {};\n');
  const { problems } = checkDocs({ root: dir, agentsLimit: 1024, strictMeta: true });
  assert.deepEqual(problems.filter(line => line.includes('missing file')), []);
});

test('fenced examples and dist output are not treated as claims', () => {
  const dir = metaRoot({
    docs: { 'x.md': GOOD_HEADER + '```\n见 src/whatever.mjs\n```\n构建产物在 `dist/bundle.mjs`。\n' },
  });
  const { problems } = checkDocs({ root: dir, agentsLimit: 1024, strictMeta: true });
  assert.deepEqual(problems.filter(line => line.includes('missing file')), []);
});
