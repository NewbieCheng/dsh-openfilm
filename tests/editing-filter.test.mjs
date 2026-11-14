// The editing list's search must match what the row shows: a project's
// displayed name/path, and a conversation's visible title including the
// `新对话` fallback — not just the raw stored title.
import assert from 'node:assert/strict';
import test from 'node:test';
import { filterEditing, matchRange, sessionDisplayTitle, projectDisplayTitle } from '../src/editing-filter.mjs';

const project = (over = {}) => ({
  projectId: 'proj123456', name: '自定义-7f8dfa', path: 'F:\\Films\\自定义-7f8dfa',
  sessions: [{ sessionId: 'sess-aaaaaa', title: '' }, { sessionId: 'sess-bbbbbb', title: '分镜讨论' }],
  ...over,
});

test('a conversation with no stored title is searchable as 新对话', () => {
  assert.equal(sessionDisplayTitle({ title: '' }), '新对话');
  assert.equal(projectDisplayTitle({ name: 'x' }), 'x');
  const rows = filterEditing([project()], { query: '新对话' });
  assert.equal(rows.length, 1);
  assert.deepEqual(rows[0].sessions.map(s => s.sessionId), ['sess-aaaaaa'], 'only the visible match shows');
  assert.equal(rows[0].open, true, 'a search hit opens the folder');
});

test('a project-name hit shows all of its conversations', () => {
  const rows = filterEditing([project()], { query: '7f8dfa' });
  assert.equal(rows[0].sessions.length, 2);
  assert.equal(rows[0].open, true);
});

test('a folder with no hit and no matching conversation disappears', () => {
  assert.deepEqual(filterEditing([project()], { query: '不存在' }), []);
});

test('archived conversations are hidden unless the view asks for them', () => {
  const archived = project({ sessions: [{ sessionId: 'sess-cccccc', title: '旧对话', archived: true }] });
  assert.equal(filterEditing([archived], { archived: false })[0].sessions.length, 0);
  assert.equal(filterEditing([archived], { archived: true })[0].sessions.length, 1);
  assert.deepEqual(filterEditing([archived], { query: '旧对话', archived: false }), []);
});

test('matchRange points at the visible match, case-insensitively', () => {
  assert.deepEqual(matchRange('分镜讨论', '讨论'), { start: 2, end: 4 });
  assert.deepEqual(matchRange('OpenFilm 素材', 'openfilm'), { start: 0, end: 8 });
  assert.equal(matchRange('分镜讨论', ''), null);
  assert.equal(matchRange('分镜讨论', 'zzz'), null);
});
