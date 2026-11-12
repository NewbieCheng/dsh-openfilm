// The sidebar block is wiring plus one React tree: these assertions keep the
// pieces connected, and the stand-in render below covers the two states that
// matter (video studio open → editing area, elsewhere → Workspaces).
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { createAreaBrowser } from '../src/area-browser.mjs';

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const count = (text, needle) => text.split(needle).length - 1;

test('the block is one slot occupant that switches by the active page tag', () => {
  const entry = read('src/studio-entry.js');
  assert.equal(count(entry, "inject('sidebar.workspaces'"), 1);
  assert.match(entry, /priority: -100/, 'a single slot renders its lowest priority entry');
  const area = read('src/area-browser.mjs');
  assert.match(area, /props\?\.usePanelInfo/, 'the tag comes from the shell, not from a guess');
  assert.match(area, /activePanelId/, 'the video studio is the tag that switches the block');
});

test('the block borrows the shipped classes and icons instead of redrawing them', () => {
  const area = read('src/area-browser.mjs');
  assert.match(area, /data-plugin-css\*="ui-workspace"/, 'the official CSS module is already in the document');
  assert.match(area, /discoverPrefixes/, 'the hashed class prefix is read back at runtime');
  assert.match(area, /IconFolderOpenRegular/, 'icons are the official primitives');
  assert.match(area, /IconWorkspaceTreeOutlineRegular/, 'including the switch control');
  assert.match(read('src/studio-entry.js'), /require\('@deepseek-ai\/dsh-client-ui-primitives'\)/);
  assert.match(area, /ensureFallbackStyles/, 'a renamed DSH build degrades to a bundled stylesheet');
});

test('a project row opens the video panel and asks it to navigate, not the DSH conversation', () => {
  const entry = read('src/studio-entry.js');
  const start = entry.indexOf('openProject: projectId => {');
  assert.ok(start > 0, 'the row action must be the named openProject seam');
  const block = entry.slice(start, entry.indexOf('},', start));
  assert.match(block, /areaBus\.navigate\(projectId\)/);
  assert.match(block, /selectPanel\(\)/);
  assert.doesNotMatch(block, /openSession\(/, 'a project row must not open the DSH chat view');
});

test('the panel forwards navigation and reports what the shell shows', () => {
  const panel = read('src/studio-panel.mjs');
  assert.match(panel, /type: 'no996-openfilm:navigate'/);
  assert.match(panel, /areaBus\.reportProject\(/);
  assert.match(panel, /areaBus\.reportReady\(\)/);
  assert.match(panel, /areaBus\.takePending\(\)/);
});

test('the injected shell bridge navigates with the history API and reports the new path', () => {
  const proxy = read('src/studio-proxy.mjs');
  assert.match(proxy, /no996-openfilm:navigate/);
  assert.match(proxy, /history\.pushState\(\{\},'',target\)/);
  assert.match(proxy, /PopStateEvent\('popstate'/);
  assert.match(proxy, /location\.assign\(target\)/);
});

test('the Host route is registered for the official shell only', () => {
  const controller = read('src/studio-controller.mjs');
  assert.match(controller, /import \{ createAreaRoute \} from '\.\/area-route\.mjs'/);
  const start = controller.indexOf('if (officialShell) {');
  const block = controller.slice(start, controller.indexOf('unregister = trackRoute(ctx.webServer.register({', start));
  assert.match(block, /createAreaRoute\(\{/);
  assert.match(block, /ctx\.sessionController\.list\(/);
});

// ---- stand-in render -------------------------------------------------------

globalThis.setInterval = () => 0;
globalThis.clearInterval = () => {};
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
    ids: ['session-a', 'session-b'],
    byId: {
      'session-a': { id: 'session-a', title: '视频剪辑动效升级方案', retainedBy: { mainView: 0 } },
      'session-b': { id: 'session-b', title: '项目改造及样式方案', retainedBy: { mainView: activeId === 'session-b' ? 1 : 0 } },
    },
  };
}

function setup({ activePanel = 'no996-openfilm', mode = 'work' } = {}) {
  const calls = { projects: [], sessions: [], panel: 0 };
  const { react, render } = shim();
  const Component = createAreaBrowser(react, {
    t: key => key,
    fetchArea: async () => ({ projects, hiddenSessionIds: ['session-a'] }),
    openProject: projectId => calls.projects.push(projectId),
    openPanel: () => { calls.panel += 1; },
    openSession: sessionId => { calls.sessions.push(sessionId); return true; },
    primitives: {},
  });
  const props = {
    useSessions: selector => selector(sessionsWith(mode === 'edit' ? 'session-a' : 'session-b')),
    useWorkspaces: selector => selector({
      items: [
        { workspaceId: 'w1', title: '普通项目', path: 'C:\\P\\ordinary', sessionIds: ['session-b', 'session-a'] },
        { workspaceId: 'w2', title: '复刻影片', path: 'C:\\P\\复刻影片', sessionIds: ['session-a'] },
      ],
      archivedSessionIds: [],
    }),
    usePanelInfo: selector => selector({ activePanelId: activePanel }),
  };
  const tree = render(Component, props);
  return { tree, calls, rerender: () => render(Component, props) };
}

test('with the video studio open the block is the editing area', async () => {
  const page = setup({ activePanel: 'no996-openfilm' });
  await flush();
  const tree = page.rerender();
  const text = textOf(tree);
  assert.match(text, /areaEditTitle/);
  assert.match(text, /复刻影片/);
  assert.match(text, /视频剪辑动效升级方案/);
  assert.match(text, /纸纹讲堂/);
  assert.deepEqual(tree.props['data-no996-openfilm-area'], 'edit');
});

test('on any other page the block is the normal Workspace list', async () => {
  const page = setup({ activePanel: 'some-other-panel' });
  await flush();
  const tree = page.rerender();
  const text = textOf(tree);
  assert.match(text, /areaWorkTitle/);
  assert.match(text, /普通项目/);
  assert.match(text, /项目改造及样式方案/);
  assert.doesNotMatch(text, /视频剪辑动效升级方案/);
  assert.deepEqual(tree.props['data-no996-openfilm-area'], 'work');
});

test('the header switch flips the block and opens the studio', async () => {
  const page = setup({ activePanel: 'some-other-panel' });
  await flush();
  const tree = page.rerender();
  const button = nodesOf(tree, node => node.props?.['aria-label'] === 'areaSwitchEdit')[0];
  assert.ok(button, 'the editing-area switch sits in the header');
  button.props.onClick();
  assert.equal(page.calls.panel, 1, 'switching to the editing area opens the studio');
  assert.match(textOf(page.rerender()), /areaEditTitle/);
});

test('clicking a project row only asks the panel to open it', async () => {
  const page = setup({ activePanel: 'no996-openfilm' });
  await flush();
  const tree = page.rerender();
  const row = nodesOf(tree, node => node.props?.['aria-label'] === '复刻影片')[0];
  assert.ok(row);
  row.props.onClick();
  assert.deepEqual(page.calls.projects, ['abc123']);
  assert.deepEqual(page.calls.sessions, [], 'a project row must not open the DSH conversation');
});

test('the Workspace view drops project folders that have nothing left to show', async () => {
  const page = setup({ activePanel: null });
  await flush();
  const text = textOf(page.rerender());
  assert.match(text, /普通项目/, 'an ordinary workspace stays');
  assert.doesNotMatch(text, /复刻影片/, 'a folder holding only project conversations disappears');
});
