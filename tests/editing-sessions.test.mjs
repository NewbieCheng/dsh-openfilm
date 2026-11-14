// Every Studio project is a folder row — including one with zero conversations,
// so deleting the last chat cannot make the project vanish from the list.
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildEditingProjects } from '../src/editing-sessions.mjs';

test('a project without a binding is still listed, with no sessionId', () => {
  const items = buildEditingProjects([{ id: 'proj123456', name: '自定义-7f8dfa', path: 'C:\\Films\\p' }]);
  assert.deepEqual(items, [{
    projectId: 'proj123456', archived: false, pinned: false, name: '自定义-7f8dfa', path: 'C:\\Films\\p',
  }]);
});

test('a binding and a display preference decorate the row', () => {
  const items = buildEditingProjects(
    [{ id: 'proj123456', name: 'raw', path: 'C:\\Films\\p' }],
    { bound: new Map([['proj123456', { sessionId: 'sess-aaaaaa' }]]), prefs: { proj123456: { pinned: true, title: '我的项目' } }, isArchived: () => true },
  );
  assert.equal(items[0].sessionId, 'sess-aaaaaa');
  assert.equal(items[0].archived, true);
  assert.equal(items[0].pinned, true);
  assert.equal(items[0].title, '我的项目');
  assert.equal(items[0].name, 'raw');
});

test('pinned projects lead and invalid rows are dropped', () => {
  const items = buildEditingProjects(
    [{ id: 'proj-bbbbbb' }, { id: 'proj-aaaaaa' }, { name: 'no id' }],
    { prefs: { 'proj-aaaaaa': { pinned: true } } },
  );
  assert.deepEqual(items.map(item => item.projectId), ['proj-aaaaaa', 'proj-bbbbbb']);
});
