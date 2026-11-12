import assert from 'node:assert/strict';
import test from 'node:test';
import { buildAreaView, normalizeBindings, normalizeProjects, projectName, samePath } from '../src/area-view.mjs';

const WINDOWS = process.platform === 'win32';

test('project rows keep id, path and folder name; junk is dropped', () => {
  const projects = normalizeProjects([
    { id: 'abc123', path: 'C:\\Videos\\OpenFilm\\Projects\\复刻影片' },
    { id: 'short', path: 'C:\\x' },
    { id: 'abc123', path: 'C:\\dupe' },
    { projectId: 'def456', path: '/home/u/Projects/纸纹讲堂' },
    { id: 'ghi789' },
    null,
  ]);
  assert.equal(projects.length, 2);
  assert.deepEqual(projects.map(project => project.projectId), ['abc123', 'def456']);
  assert.equal(projects[0].name, '复刻影片');
  assert.equal(projects[1].name, '纸纹讲堂');
});

test('bindings require both ids and keep one row per project', () => {
  const bindings = normalizeBindings([
    { projectId: 'abc123', path: 'C:\\a', sessionId: 'session-1' },
    { projectId: 'abc123', path: 'C:\\a', sessionId: 'session-2' },
    { projectId: 'bad', sessionId: 'session-3' },
    { projectId: 'def456', sessionId: '' },
    { projectId: 'ghi789', sessionId: 'session-4' },
  ]);
  assert.deepEqual(bindings.map(binding => [binding.projectId, binding.sessionId]), [
    ['abc123', 'session-1'],
    ['ghi789', 'session-4'],
  ]);
});

test('the folder name survives both separators', () => {
  assert.equal(projectName('C:\\Users\\me\\Videos\\OpenFilm\\Projects\\自定义-7f8dfa'), '自定义-7f8dfa');
  assert.equal(projectName('/home/me/projects/demo/'), 'demo');
  assert.equal(projectName(''), '');
  assert.equal(projectName(undefined), '');
});

test('samePath follows the platform case rules', () => {
  assert.equal(samePath('C:\\Users\\Me\\Proj', 'c:\\users\\me\\proj'), WINDOWS);
  assert.equal(samePath('C:\\Users\\Me\\Proj\\', 'C:\\Users\\Me\\Proj'), true);
  assert.equal(samePath('/home/me/proj', '/home/me/OTHER'), false);
  assert.equal(samePath('', '/home/me/proj'), false);
});

test('a project with a live binding shows its Session and title', () => {
  const view = buildAreaView({
    projects: [{ id: 'abc123', path: 'C:\\P\\复刻影片' }],
    bindings: [{ projectId: 'abc123', path: 'C:\\P\\复刻影片', sessionId: 'session-1' }],
    sessions: [{ sessionId: 'session-1', cwd: 'C:\\P\\复刻影片', projections: { values: { title: '视频剪辑动效升级方案' } } }],
  });
  assert.equal(view.projects.length, 1);
  assert.equal(view.projects[0].sessionId, 'session-1');
  assert.equal(view.projects[0].sessionTitle, '视频剪辑动效升级方案');
  assert.deepEqual(view.hiddenSessionIds, ['session-1']);
});

test('an unbound conversation in the project folder is hidden too', () => {
  const view = buildAreaView({
    projects: [{ id: 'abc123', path: 'C:\\P\\复刻影片' }],
    bindings: [],
    sessions: [
      { sessionId: 'legacy-1', cwd: WINDOWS ? 'c:\\p\\复刻影片' : 'C:\\P\\复刻影片', title: '' },
      { sessionId: 'ordinary', cwd: 'C:\\P\\Other' },
    ],
  });
  assert.equal(view.projects[0].sessionId, null);
  assert.deepEqual(view.hiddenSessionIds, ['legacy-1']);
});

test('a project never started still ships a row with no Session', () => {
  const view = buildAreaView({
    projects: [{ id: 'abc123', path: 'C:\\P\\纸纹讲堂' }],
    bindings: [],
    sessions: [],
  });
  assert.deepEqual(view.projects, [{ projectId: 'abc123', path: 'C:\\P\\纸纹讲堂', name: '纸纹讲堂', sessionId: null, sessionTitle: '' }]);
  assert.deepEqual(view.hiddenSessionIds, []);
});

test('an unreadable catalog keeps bindings but hides nothing else', () => {
  const view = buildAreaView({
    projects: [{ id: 'abc123', path: 'C:\\P\\a' }],
    bindings: [{ projectId: 'abc123', path: 'C:\\P\\a', sessionId: 'session-9' }],
    sessions: undefined,
  });
  assert.equal(view.projects[0].sessionId, 'session-9');
  assert.equal(view.projects[0].sessionTitle, '');
  assert.deepEqual(view.hiddenSessionIds, ['session-9']);
});

test('the hidden set is the union of bindings and folder matches, sorted', () => {
  const view = buildAreaView({
    projects: [{ id: 'abc123', path: 'C:\\P\\a' }, { id: 'def456', path: 'C:\\P\\b' }],
    bindings: [{ projectId: 'abc123', path: 'C:\\P\\a', sessionId: 'session-2' }],
    sessions: [
      { sessionId: 'session-1', cwd: 'C:\\P\\b' },
      { sessionId: 'session-2', cwd: 'C:\\P\\a' },
      { sessionId: 'session-3', cwd: 'C:\\Elsewhere' },
    ],
  });
  assert.deepEqual(view.hiddenSessionIds, ['session-1', 'session-2']);
});

test('a title without a projection falls back to the session title field', () => {
  const view = buildAreaView({
    projects: [{ id: 'abc123', path: 'C:\\P\\a' }],
    bindings: [{ projectId: 'abc123', path: 'C:\\P\\a', sessionId: 'session-1' }],
    sessions: [{ sessionId: 'session-1', cwd: 'C:\\P\\a', title: '  手绘笔记  ' }],
  });
  assert.equal(view.projects[0].sessionTitle, '手绘笔记');
});

test('a workspace opened on a project folder or its parent still counts as that project', () => {
  const view = buildAreaView({
    projects: [{ id: 'proj01', path: 'C:\\Work\\Demo\\film' }],
    bindings: [],
    sessions: [
      { sessionId: 'inside', cwd: 'C:\\Work\\Demo\\film\\shots' },
      { sessionId: 'parent', cwd: 'C:\\work\\demo' },
      { sessionId: 'other', cwd: 'C:\\Work\\Other' },
    ],
  });
  const hidden = new Set(view.hiddenSessionIds);
  assert.equal(hidden.has('inside'), true, 'a session inside the project folder belongs to it');
  assert.equal(hidden.has('parent'), true, 'so does the folder the project was created in');
  assert.equal(hidden.has('other'), false);
});
