import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
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
