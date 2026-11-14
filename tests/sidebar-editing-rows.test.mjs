// The editing area's own list: one label, one leading slot per folder row, and
// a header that keeps only the shipped search.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { EDITING_LABEL } from '../src/sidebar-editing.mjs';

const source = readFileSync(new URL('../src/sidebar-editing.mjs', import.meta.url), 'utf8');

test('the editing area is called 剪辑区 wherever the user can see it', () => {
  assert.equal(EDITING_LABEL, '剪辑区');
  assert.equal(source.includes('OpenFilm 素材剪辑区'), false);
  assert.equal(source.includes('OpenFilm 剪辑区'), false);
  assert.ok(source.includes("item(EDITING_LABEL, 'editing', 'clapper')"));
  assert.ok(source.includes("triggerLabel.textContent = mode === 'editing' ? EDITING_LABEL : '工作区'"));
});

test('a folder row uses one leading slot: folder at rest, chevron on hover', () => {
  assert.ok(source.includes('toggle.append(folderGlyph(folderOpen), chevron, name, count)'));
  assert.ok(source.includes('.n996-folder-toggle:hover .n996-folder{display:none}'));
  assert.ok(source.includes('.n996-folder-toggle:hover .n996-chevron{display:inline-flex}'));
  assert.ok(source.includes('.n996-chevron{display:none'));
  assert.equal(source.includes("chevron.style.cssText = 'flex:none;width:10px"), false);
});

test('the editing header hides its action buttons and keeps the view options reachable', () => {
  assert.ok(source.includes("for (const button of header.querySelectorAll('button'))"));
  assert.ok(source.includes("button.style.display = editing ? 'none' : ''"));
  assert.ok(source.includes("menuButton(menu, '视图选项…'"));
  assert.ok(source.includes('ensureStyle();'));
});

test('the header reserves a slot so an expanding search cannot cover the switch', () => {
  assert.ok(source.includes("const SWITCH_HOST = 'data-no996-switch-host'"));
  assert.ok(source.includes('padding-left:calc(4px + var(--n996-switch-w, 56px))'));
  assert.ok(source.includes('header.setAttribute(SWITCH_HOST'));
  assert.ok(source.includes("header.style.setProperty('--n996-switch-w'"));
});

test('a folder row separates clearing conversations from deleting the project', () => {
  assert.ok(source.includes("menuButton(menu, '清空对话（保留项目）…'"));
  assert.ok(source.includes("menuButton(menu, '删除项目…'"));
  assert.ok(source.includes("menuButton(menu, '刷新列表'"));
  assert.ok(source.includes("menuButton(menu, '删除对话…'"));
  assert.ok(source.includes('/api/no996-openfilm/editing-delete-project'));
  assert.ok(source.includes('移入回收站（可手动找回）'));
  assert.ok(source.includes('彻底删除，不可恢复'));
});

test('row glyphs are SVG icons, not text characters', () => {
  for (const glyph of ['▾', '▸', '✓', '⋯', '📌']) {
    assert.equal(source.includes(glyph), false, `the raw "${glyph}" glyph must not be rendered`);
  }
  assert.ok(source.includes("chevron.append(icon('chevron', 14))"));
  assert.ok(source.includes("button.append(icon('more', 16))"));
  assert.ok(source.includes("const dot = icon('dot', 10)"));
  assert.ok(source.includes("triggerCaret.classList.add('n996-trigger-chevron')"));
});

test('menus rise in place and refresh never flashes the list', () => {
  assert.ok(source.includes('@keyframes n996-rise'));
  assert.ok(source.includes('prefers-reduced-motion'));
  assert.ok(source.includes('void load(list, { quiet: true })'));
  assert.ok(source.includes('if (!quiet)'));
});

test('search matches visible conversation titles, not just folder names', () => {
  assert.ok(source.includes("import { filterEditing, matchRange, projectDisplayTitle, sessionDisplayTitle } from './editing-filter.mjs'"));
  assert.ok(source.includes('filterEditing(projects, { query, archived: view.archived })'));
  assert.ok(source.includes('appendHighlight(title, sessionDisplayTitle(session), query)'));
  assert.ok(source.includes('const shown = query ? sessions'));
});
