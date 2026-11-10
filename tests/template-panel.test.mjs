import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createStudioPanel } from '../src/studio-panel.mjs';

test('client loader id matches the independent package name', async () => {
  const entry = await readFile(new URL('../src/studio-entry.js', import.meta.url), 'utf8');
  const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
  const id = /window\.__ModuleLoader__\.load\(\{\s*id:\s*['"]([^'"]+)['"]/.exec(entry)?.[1];
  assert.equal(id, pkg.name);
});

// Minimal hook harness exercises the actual panel component without a browser or model.
function mount(Panel, props) {
  const hooks = [], effects = []; let cursor = 0, tree;
  const React = {
    createElement: (type, attributes, ...children) => ({ type, props: attributes || {}, children }),
    useState(initial) { const i = cursor++; if (!(i in hooks)) hooks[i] = initial; return [hooks[i], value => { hooks[i] = typeof value === 'function' ? value(hooks[i]) : value; }]; },
    useRef(initial) { const i = cursor++; return hooks[i] ||= { current: initial }; },
    useEffect(fn, deps) { const i = cursor++; const old = hooks[i]; if (!old || deps.some((x, n) => x !== old.deps[n])) { effects.push(() => { old?.cleanup?.(); hooks[i] = { deps, cleanup: fn() }; }); } },
  };
  const Component = Panel(React);
  function render() { cursor = 0; tree = Component(props); while (effects.length) effects.shift()(); return tree; }
  return { render, close: () => hooks.forEach(h => h?.cleanup?.()) };
}
function find(node, type) {
  if (!node || typeof node !== 'object') return [];
  return [...(node.type === type ? [node] : []), ...node.children.flatMap(child => Array.isArray(child) ? child.flatMap(x => find(x, type)) : find(child, type))];
}
function text(node) {
  if (typeof node === 'string') return node;
  if (!node || typeof node !== 'object') return '';
  return (Array.isArray(node.children) ? node.children : []).map(text).join('|');
}
const browser = (overrides = {}) => {
  globalThis.window = {
    location: { protocol: 'http:', host: '127.0.0.1:1234', hostname: '127.0.0.1' },
    addEventListener: () => {}, removeEventListener: () => {},
    ...overrides,
  };
  globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
};
const cleanup = () => { delete globalThis.window; delete globalThis.localStorage; };

test('opens the official editor directly, with no template home page', async () => {
  browser();
  const panel = mount(createStudioPanel, { t: key => key, startStudio: async () => ({ editorOrigin: 'http://127.0.0.1:47822' }) });
  try {
    panel.render(); await new Promise(resolve => setImmediate(resolve));
    const tree = panel.render();
    assert.equal(find(tree, 'main').length, 0, 'the template home page is gone');
    assert.equal(find(tree, 'button').length, 0);
    const frame = find(tree, 'iframe')[0];
    assert.equal(frame.props.src, 'http://127.0.0.1:47822/');
    assert.equal(frame.props.style.visibility, undefined, 'the frame is visible from the start');
    // Templates are offered inside the shell now, not from this panel.
    assert.doesNotMatch(text(tree), /templateHomeTitle|使用模板创建项目/);
  } finally { panel.close(); cleanup(); }
});

test('a failed start offers exactly one retry that re-runs bootstrap', async () => {
  browser();
  let attempts = 0;
  const panel = mount(createStudioPanel, {
    t: key => key,
    startStudio: async () => { attempts++; throw new Error('Studio is unavailable'); },
  });
  try {
    panel.render(); await new Promise(resolve => setImmediate(resolve));
    let tree = panel.render();
    const alert = find(tree, 'p').find(node => node.props.role === 'alert');
    assert.match(text(alert), /studioFailed/);
    const retry = find(tree, 'button')[0];
    assert.equal(text(retry), 'studioRetry');
    retry.props.onClick();
    await new Promise(resolve => setImmediate(resolve));
    tree = panel.render();
    await new Promise(resolve => setImmediate(resolve));
    tree = panel.render();
    assert.equal(attempts, 2);
    assert.equal(find(tree, 'iframe').length, 0);
  } finally { panel.close(); cleanup(); }
});

test('desktop opens the ticket URL and never a keyed upstream address', async () => {
  globalThis.window = {
    location: { protocol: 'dsh-app:', host: 'app', hostname: 'app' },
    addEventListener: () => {}, removeEventListener: () => {},
  };
  globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
  const ticket = 'a'.repeat(32);
  const panel = mount(createStudioPanel, { t: key => key, startStudio: async () => ({ editorOrigin: 'http://127.0.0.2:47822', ticket }) });
  try {
    panel.render(); await new Promise(resolve => setImmediate(resolve));
    const frame = find(panel.render(), 'iframe')[0];
    assert.equal(frame.props.src, `http://127.0.0.2:47822/__dsh/open#${ticket}`);
    // Any other scheme or host is refused before the frame is rendered.
    assert.equal(find(panel.render(), 'main').length, 0);
  } finally { panel.close(); cleanup(); }
});

test('an invalid editor origin is refused instead of framed', async () => {
  browser();
  const panel = mount(createStudioPanel, { t: key => key, startStudio: async () => ({ editorOrigin: 'https://evil.example.com' }) });
  try {
    panel.render(); await new Promise(resolve => setImmediate(resolve));
    const tree = panel.render();
    assert.equal(find(tree, 'iframe').length, 0);
    assert.match(text(tree), /Invalid local Studio address/);
  } finally { panel.close(); cleanup(); }
});
