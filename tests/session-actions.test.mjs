// The two additive entries on the shipped Workspace rows. A Session that is not
// a project must render nothing; a project's row gets one button and its ⋯ menu
// gets one item, both dispatching the same request.
import assert from 'node:assert/strict';
import test from 'node:test';
import { createAreaStore } from '../src/area-store.mjs';
import { createSessionActions } from '../src/session-actions.mjs';

globalThis.setInterval = () => 0;
globalThis.window = { addEventListener() {} };

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
    index = 0;
    effects.length = 0;
    dirty = false;
    const tree = Component(props);
    for (const effect of effects) effect?.();
    return tree;
  };
  return { react, render };
}

const flush = () => new Promise(resolve => setTimeout(resolve, 0));

const projects = [
  { projectId: 'abc123', path: 'C:\\P\\复刻影片', name: '复刻影片', sessionId: 'session-a', sessionTitle: '视频剪辑动效升级方案' },
  { projectId: 'def456', path: 'C:\\P\\纸纹讲堂', name: '纸纹讲堂', sessionId: 'session-b', sessionTitle: '纸纹讲堂' },
];

async function store() {
  const area = createAreaStore({ fetchArea: async () => ({ projects, hiddenSessionIds: ['session-a', 'session-b'] }) });
  area.start();
  await flush();
  return area;
}

test('the store maps project conversations, and only those', async () => {
  const area = await store();
  assert.equal(area.projectOf('session-a').projectId, 'abc123');
  assert.equal(area.projectOf('session-b').projectId, 'def456');
  assert.equal(area.projectOf('session-z'), null, 'ordinary Sessions have no project');
  assert.equal(area.projectOf(undefined), null);
});

test('a row of an ordinary Session renders nothing', async () => {
  const area = await store();
  const calls = [];
  const { react, render } = shim();
  const { RowAction } = createSessionActions(react, { t: key => key, store: area, openInEditing: id => calls.push(id) });
  assert.equal(render(RowAction, { sessionId: 'session-z', displayTitle: '普通会话' }), null);
  assert.deepEqual(calls, []);
});

test('a project row gets one button that opens the editing area', async () => {
  const area = await store();
  const calls = [];
  const { react, render } = shim();
  const { RowAction } = createSessionActions(react, { t: key => key, store: area, openInEditing: id => calls.push(id) });
  const tree = render(RowAction, { sessionId: 'session-a', displayTitle: '视频剪辑动效升级方案' });
  assert.equal(tree.type, 'button');
  assert.equal(tree.props['aria-label'], 'openInEditing');
  let stopped = false;
  tree.props.onClick({ stopPropagation: () => { stopped = true; } });
  assert.equal(stopped, true, 'the row click must not also open the conversation');
  assert.deepEqual(calls, ['abc123']);
});

test('the menu item does the same and closes the menu', async () => {
  const area = await store();
  const calls = [];
  const closed = [];
  const { react, render } = shim();
  const MenuItemButton = function MenuItemButton() { return null; };
  const { MenuItem } = createSessionActions(react, { t: key => key, store: area, primitives: { MenuItemButton }, openInEditing: id => calls.push(id) });
  const tree = render(MenuItem, { sessionId: 'session-b', displayTitle: '纸纹讲堂', useMenuOpenState: () => [true, open => closed.push(open)] });
  assert.equal(tree.type, MenuItemButton, 'the shipped menu button is used, so the item looks native');
  tree.props.onSelect();
  assert.deepEqual(closed, [false]);
  assert.deepEqual(calls, ['def456']);
});

test('an ordinary Session contributes no menu item', async () => {
  const area = await store();
  const { react, render } = shim();
  const { MenuItem } = createSessionActions(react, { t: key => key, store: area, openInEditing: () => {} });
  assert.equal(render(MenuItem, { sessionId: 'session-z', displayTitle: '普通会话' }), null);
});
