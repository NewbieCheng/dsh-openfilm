import assert from 'node:assert/strict';
import test from 'node:test';
import {
  AREA_MODE_KEY, defaultMode, filterArea, matchesQuery, parseAreaPayload, readMode,
  searchProjects, sortProjects, writeMode,
} from '../src/area-client.mjs';

function memoryStorage(initial = {}) {
  const table = new Map(Object.entries(initial));
  return {
    getItem: key => (table.has(key) ? table.get(key) : null),
    setItem: (key, value) => { table.set(key, String(value)); },
    removeItem: key => { table.delete(key); },
    snapshot: () => Object.fromEntries(table),
  };
}

test('the payload accepts an object or text and refuses malformed rows', () => {
  const payload = {
    projects: [
      { projectId: 'abc123', path: 'C:\\P\\a', name: 'a' },
      { projectId: 'abc123', path: 'C:\\P\\dupe', name: 'dupe' },
      { projectId: 'bad id', path: 'C:\\P\\x' },
      { projectId: 'def456', path: '' },
      { projectId: 'ghi789', path: '/P/ghi', sessionId: 'session-1', sessionTitle: 'hi' },
    ],
    hiddenSessionIds: ['session-1', 'session-1', '', 'session-2'],
  };
  const parsed = parseAreaPayload(JSON.stringify(payload));
  assert.deepEqual(parsed.projects.map(row => row.projectId), ['abc123', 'ghi789']);
  assert.equal(parsed.projects[1].sessionId, 'session-1');
  assert.equal(parsed.projects[1].sessionTitle, 'hi');
  assert.deepEqual(parsed.hidden, ['session-1', 'session-2']);
  assert.deepEqual(parseAreaPayload('{not json'), { projects: [], hidden: [] });
  assert.deepEqual(parseAreaPayload(null), { projects: [], hidden: [] });
});

test('a missing name falls back to the folder', () => {
  const parsed = parseAreaPayload({ projects: [{ projectId: 'abc123', path: 'C:\\P\\纸纹讲堂' }] });
  assert.equal(parsed.projects[0].name, '纸纹讲堂');
});

test('a real DSH Session id (44 chars) survives the payload', () => {
  const sessionId = 'session-ed6552ef-d958-4977-a740-c7440dbd56ed';
  const parsed = parseAreaPayload({
    projects: [{ projectId: 'abc123', path: 'C:\\P\\a', sessionId, sessionTitle: '视频剪辑' }],
    hiddenSessionIds: [sessionId],
  });
  assert.equal(parsed.projects[0].sessionId, sessionId);
  assert.equal(parsed.projects[0].sessionTitle, '视频剪辑');
  assert.deepEqual(parsed.hidden, [sessionId]);
});

test('search matches the project name or its conversation title', () => {
  const projects = [
    { name: '复刻影片', sessionTitle: '视频剪辑动效升级方案' },
    { name: '纸纹讲堂', sessionTitle: '项目改造及样式方案' },
  ];
  assert.equal(searchProjects(projects, '').length, 2);
  assert.deepEqual(searchProjects(projects, '纸纹').map(p => p.name), ['纸纹讲堂']);
  assert.deepEqual(searchProjects(projects, '动效').map(p => p.name), ['复刻影片']);
  assert.deepEqual(searchProjects(projects, '不存在'), []);
  assert.equal(matchesQuery('ABC', 'abc'), true);
  assert.equal(matchesQuery(null, 'x'), false);
});

test('started projects sort by recency and unstarted keep their order', () => {
  const projects = [
    { projectId: 'a', sessionId: null },
    { projectId: 'b', sessionId: 's-b' },
    { projectId: 'c', sessionId: 's-c' },
    { projectId: 'd', sessionId: null },
  ];
  const sessions = { byId: { 's-b': { updatedAt: 10 }, 's-c': { updatedAt: 50 } } };
  assert.deepEqual(sortProjects(projects, sessions).map(p => p.projectId), ['c', 'b', 'a', 'd']);
  assert.deepEqual(sortProjects(projects, null).map(p => p.projectId), ['a', 'b', 'c', 'd']);
});

test('the mode is remembered per Session and unknown values read as null', () => {
  const storage = memoryStorage();
  assert.equal(readMode(storage, 'session-1'), null);
  assert.equal(writeMode(storage, 'session-1', 'work'), true);
  assert.equal(readMode(storage, 'session-1'), 'work');
  assert.equal(readMode(storage, 'session-2'), null);
  assert.equal(writeMode(storage, 'session-1', 'edit'), true);
  assert.equal(readMode(storage, 'session-1'), 'edit');
  assert.equal(writeMode(storage, 'session-1', 'nonsense'), false);
  assert.equal(readMode(storage, ''), null);
  assert.deepEqual(Object.keys(JSON.parse(storage.snapshot()[AREA_MODE_KEY])), ['session-1']);
  // A storage that throws (private mode) must read as "no memory", never crash.
  const hostile = { getItem: () => { throw new Error('denied'); }, setItem: () => { throw new Error('denied'); } };
  assert.equal(readMode(hostile, 'session-1'), null);
  assert.equal(writeMode(hostile, 'session-1', 'work'), false);
  // Corrupt JSON is the same as no memory.
  assert.equal(readMode(memoryStorage({ [AREA_MODE_KEY]: '{oops' }), 'session-1'), null);
});

test('project conversations default to the editing area', () => {
  assert.equal(defaultMode(true), 'edit');
  assert.equal(defaultMode(false), 'work');
  assert.equal(defaultMode(undefined), 'work');
});

test('the Workspace view hides project conversations but keeps mixed groups', () => {
  const workspaces = [
    { workspaceId: 'w1', title: '普通项目', path: 'C:\\P\\ordinary', sessionIds: ['s-1', 's-2'] },
    { workspaceId: 'w2', title: '复刻影片', path: 'C:\\P\\复刻影片', sessionIds: ['s-3'] },
    { workspaceId: 'w3', title: '纸纹讲堂', path: 'C:\\P\\纸纹讲堂', sessionIds: ['s-4', 's-5'] },
    { workspaceId: 'w4', title: '空工作区', path: 'C:\\P\\empty', sessionIds: [] },
  ];
  const sessions = { ids: ['s-1', 's-2', 's-3', 's-4', 's-5', 's-6', 's-7'], byId: {} };
  const filtered = filterArea({
    workspaces,
    sessions,
    hidden: ['s-3', 's-4'],
    projectPaths: ['C:\\P\\复刻影片', 'C:\\P\\纸纹讲堂'],
    archived: ['s-2'],
  });
  assert.deepEqual(filtered.groups.map(group => [group.workspaceId, group.sessionIds]), [
    ['w1', ['s-1']],
    ['w3', ['s-5']],
    ['w4', []],
  ]);
  assert.deepEqual(filtered.ungrouped, ['s-6', 's-7']);
  assert.equal(filtered.hiddenCount, 2);
});

test('without a catalog the ungrouped list falls back to the byId keys', () => {
  const filtered = filterArea({
    workspaces: [],
    sessions: { byId: { 's-1': {}, 's-2': {} } },
    hidden: ['s-2'],
  });
  assert.deepEqual(filtered.ungrouped, ['s-1']);
  assert.deepEqual(filtered.groups, []);
});
