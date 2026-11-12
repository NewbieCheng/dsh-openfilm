// A stand-in React render of the project page: it is the one new screen with no
// browser harness, and the mistakes that matter (a row that does not open the
// panel, a search that never filters) are cheap to catch here.
import assert from 'node:assert/strict';
import test from 'node:test';
import { createProjectPanel } from '../src/area-panel.mjs';

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

function setup() {
  const calls = { projects: [], panel: 0 };
  const { react, render } = shim();
  const Component = createProjectPanel(react, {
    t: key => key,
    fetchArea: async () => ({ projects, hiddenSessionIds: ['session-a'] }),
    openProject: projectId => calls.projects.push(projectId),
    openPanel: () => { calls.panel += 1; },
    openSession: () => true,
  });
  const props = { useSessions: selector => selector({ byId: {}, ids: [] }) };
  const tree = render(Component, props);
  return { tree, calls, rerender: () => render(Component, props) };
}

test('the page lists projects with their conversation state', async () => {
  const page = setup();
  await flush();
  const text = textOf(page.rerender());
  assert.match(text, /areaPanelTitle/);
  assert.match(text, /复刻影片/);
  assert.match(text, /视频剪辑动效升级方案/);
  assert.match(text, /纸纹讲堂/);
  assert.match(text, /areaNotStarted/);
});

test('search narrows the list and the row opens the video panel', async () => {
  const page = setup();
  await flush();
  const input = nodesOf(page.rerender(), node => node.type === 'input')[0];
  assert.ok(input, 'the page has a search field');
  input.props.onChange({ target: { value: '纸纹' } });
  const text = textOf(page.rerender());
  assert.match(text, /纸纹讲堂/);
  assert.doesNotMatch(text, /复刻影片/);
  input.props.onChange({ target: { value: '' } });
  const row = nodesOf(page.rerender(), node => node.props?.['aria-label'] === '复刻影片')[0];
  assert.ok(row, 'each project is a row labelled by its name');
  row.props.onClick();
  assert.deepEqual(page.calls.projects, ['abc123']);
});

test('the new-project action opens the video panel', async () => {
  const page = setup();
  await flush();
  const button = nodesOf(page.rerender(), node => node.type === 'button' && textOf(node) === 'areaPanelNew')[0];
  assert.ok(button);
  button.props.onClick();
  assert.equal(page.calls.panel, 1);
});
