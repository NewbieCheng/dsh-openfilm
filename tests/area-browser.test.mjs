// The project area is the only screen in this repo with no browser harness, so
// it gets a tiny React stand-in: enough hooks to render, let the Host payload
// arrive, and dispatch the two clicks that matter. A bundle build catches syntax;
// this catches the wiring mistakes (a row that never reaches the panel, a hidden
// conversation that still renders).
import assert from 'node:assert/strict';
import test from 'node:test';
import { createAreaBrowser } from '../src/area-browser.mjs';

// The component polls the Host while mounted; the stand-in never unmounts, so
// the interval is stubbed out instead of keeping the test process alive.
globalThis.setInterval = () => 0;
globalThis.clearInterval = () => {};
// The component watches window focus to refresh; the stand-in has no window.
globalThis.window = { addEventListener() {}, removeEventListener() {} };

function shim() {
  const hookState = [];
  const effects = [];
  let index = 0;
  let dirty = false;
  const react = {
    createElement(type, props, ...children) {
      const flat = children.flat(Infinity).filter(child => child !== null && child !== undefined && child !== false && child !== true);
      return { type, props: { ...(props ?? {}), children: flat.length <= 1 ? flat[0] : flat } };
    },
    useState(initial) {
      const slot = index++;
      if (!(slot in hookState)) hookState[slot] = typeof initial === 'function' ? initial() : initial;
      return [hookState[slot], value => { hookState[slot] = typeof value === 'function' ? value(hookState[slot]) : value; dirty = true; }];
    },
    useRef(initial) {
      const slot = index++;
      if (!(slot in hookState)) hookState[slot] = { current: initial };
      return hookState[slot];
    },
    useMemo(factory) {
      const slot = index++;
      if (!(slot in hookState)) hookState[slot] = factory();
      return hookState[slot];
    },
    useCallback(fn) { index += 1; return fn; },
    useEffect(fn) { effects.push(fn); },
  };
  const render = (Component, props) => {
    let tree;
    for (let round = 0; round < 12; round += 1) {
      index = 0;
      effects.length = 0;
      dirty = false;
      tree = Component(props);
      for (const effect of effects) effect?.();
      if (!dirty) break;
    }
    return tree;
  };
  return { react, render };
}

function textOf(node) {
  if (node === null || node === undefined || typeof node === 'boolean') return '';
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(textOf).join(' ');
  return textOf(node.props?.children);
}

function nodesOf(node, predicate, found = []) {
  if (!node || typeof node !== 'object') return found;
  if (Array.isArray(node)) { node.forEach(child => nodesOf(child, predicate, found)); return found; }
  if (predicate(node)) found.push(node);
  nodesOf(node.props?.children, predicate, found);
  return found;
}

const flush = () => new Promise(resolve => setTimeout(resolve, 0));

const projects = [
  { projectId: 'abc123', path: 'C:\\P\\复刻影片', name: '复刻影片', sessionId: 'session-a', sessionTitle: '视频剪辑动效升级方案' },
  { projectId: 'def456', path: 'C:\\P\\纸纹讲堂', name: '纸纹讲堂', sessionId: null, sessionTitle: '' },
];

function sessionsWith(activeId) {
  return {
    ids: ['session-a', 'session-b', 'session-c'],
    byId: {
      'session-a': { id: 'session-a', title: '视频剪辑动效升级方案', retainedBy: { mainView: activeId === 'session-a' ? 1 : 0 } },
      'session-b': { id: 'session-b', title: '项目改造及样式方案', retainedBy: { mainView: activeId === 'session-b' ? 1 : 0 } },
      'session-c': { id: 'session-c', blank: true, retainedBy: { mainView: 0 } },
    },
  };
}

function storage() {
  const table = new Map();
  return {
    getItem: key => (table.has(key) ? table.get(key) : null),
    setItem: (key, value) => { table.set(key, String(value)); },
  };
}

function setup({ mode = 'edit', workspaces = { items: [], archivedSessionIds: [] }, area = { projects, hiddenSessionIds: ['session-a'] } } = {}) {
  const calls = { panel: 0, projects: [], sessions: [] };
  const { react, render } = shim();
  const Component = createAreaBrowser(react, {
    t: key => key,
    storage: storage(),
    fetchArea: async () => area,
    openProject: projectId => calls.projects.push(projectId),
    openPanel: () => { calls.panel += 1; },
    openSession: sessionId => { calls.sessions.push(sessionId); return true; },
  });
  const props = {
    useSessions: selector => selector(sessionsWith(mode === 'edit' ? 'session-a' : 'session-b')),
    useWorkspaces: selector => selector(workspaces),
  };
  const tree = render(Component, props);
  return { tree, calls, rerender: () => render(Component, props) };
}

test('the project area lists each project with its conversation', async () => {
  const page = setup();
  await flush();
  const text = textOf(page.rerender());
  assert.match(text, /areaProjects/);
  assert.match(text, /复刻影片/);
  assert.match(text, /视频剪辑动效升级方案/);
  assert.match(text, /纸纹讲堂/);
  assert.match(text, /areaNotStarted/);
});

test('the header dropdown offers both areas', () => {
  const { tree } = setup();
  const [select] = nodesOf(tree, node => node.type === 'select');
  assert.ok(select, 'the header carries the area switch');
  const options = (select.props.children ?? []).flat().map(option => option.props.value);
  assert.deepEqual(options, ['edit', 'work']);
});

test('clicking a project only asks the panel to open it', async () => {
  const page = setup();
  await flush();
  const tree = page.rerender();
  const row = nodesOf(tree, node => node.props?.['aria-label'] === '复刻影片')[0];
  assert.ok(row, 'the project row is labelled by the project');
  row.props.onClick();
  assert.deepEqual(page.calls.projects, ['abc123']);
  assert.deepEqual(page.calls.sessions, [], 'a project row must not open the DSH conversation');
});

test('the workspace view hides project conversations and shows ordinary ones', async () => {
  const page = setup({
    mode: 'work',
    workspaces: {
      items: [{ workspaceId: 'w1', title: '普通项目', path: 'C:\\P\\ordinary', sessionIds: ['session-b', 'session-a'] }],
      archivedSessionIds: [],
    },
  });
  await flush();
  const text = textOf(page.rerender());
  assert.match(text, /普通项目/);
  assert.match(text, /项目改造及样式方案/);
  assert.doesNotMatch(text, /视频剪辑动效升级方案/);
  assert.match(text, /areaHiddenNote/);
});

test('a project-only folder disappears from the workspace view', async () => {
  const page = setup({
    mode: 'work',
    workspaces: {
      items: [{ workspaceId: 'w2', title: '复刻影片', path: 'C:\\P\\复刻影片', sessionIds: ['session-a'] }],
      archivedSessionIds: [],
    },
  });
  await flush();
  const text = textOf(page.rerender());
  assert.doesNotMatch(text, /复刻影片/);
});
