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

test('the three shipped templates reach the panel from real manifests', async () => {
  const { listTemplates } = await import('../src/official-templates.mjs');
  const { dirname, join, resolve } = await import('node:path');
  const { fileURLToPath } = await import('node:url');
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'vendor', 'templates');
  // Real manifests, shaped exactly as the Host bridge hands them to the page.
  const wired = (await listTemplates(root)).map(({ id, title, description, mode }) => ({ id, title, description, mode }));
  assert.deepEqual(wired.map(item => item.id), ['paper-texture', 'replica-film', 'sketchnote']);
  globalThis.window = { location: { protocol: 'http:', host: '127.0.0.1:1234', hostname: '127.0.0.1' }, addEventListener: () => {}, removeEventListener: () => {} };
  globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
  const panel = mount(createStudioPanel, { t: key => key, startStudio: async () => ({ editorOrigin: 'http://127.0.0.1:47822' }), templateRequest: async body => (body.action === 'list' ? { templates: wired } : { projectId: 'film123' }) });
  try {
    panel.render(); await new Promise(resolve => setImmediate(resolve));
    const tree = panel.render();
    const buttons = find(tree, 'button');
    // Three template buttons plus the explicit existing-projects entry.
    assert.equal(buttons.length, 4);
    const text = [];
    const walk = node => {
      if (typeof node === 'string') text.push(node);
      else if (node && typeof node === 'object') (Array.isArray(node.children) ? node.children : []).forEach(walk);
    };
    walk(tree);
    const labels = text.join('|');
    for (const title of ['纸纹讲堂', '复刻影片', '手绘笔记']) assert.match(labels, new RegExp(title), title);
  } finally { panel.close(); delete globalThis.window; delete globalThis.localStorage; }
});

test('template button navigates the already authenticated iframe', async () => {
  const listeners = new Map();
  globalThis.window = { location: { protocol: 'http:', host: '127.0.0.1:1234', hostname: '127.0.0.1' }, addEventListener: (event, fn) => listeners.set(event, fn), removeEventListener: event => listeners.delete(event) };
  globalThis.localStorage = { getItem: () => 'oldfilm', setItem() {}, removeItem() {} };
  let creates = 0, resolveCreate;
  const requests = [];
  const panel = mount(createStudioPanel, { t: key => key, startStudio: async () => ({ editorOrigin: 'http://127.0.0.1:47822' }), templateRequest: async body => { requests.push(body); return body.action === 'list' ? { templates: [{ id: 'paper-texture', title: 'Paper' }, { id: 'second', title: 'Second' }, { id: 'third', title: 'Third' }] } : (creates++, new Promise(resolve => { resolveCreate = resolve; })); } });
  try {
    panel.render(); await new Promise(resolve => setImmediate(resolve));
    let tree = panel.render();
    const frame = { src: '', contentWindow: {} };
    const initialFrame = find(tree, 'iframe')[0];
    assert.equal(initialFrame.props.src, 'http://127.0.0.1:47822/');
    assert.equal(initialFrame.props.style.visibility, 'hidden');
    assert.equal(find(tree, 'main').length, 1);
    assert.equal(find(tree, 'button').length, 4);
    assert.deepEqual(requests, [{ action: 'list' }]);
    initialFrame.props.ref.current = frame;
    listeners.get('message')({ origin: 'http://127.0.0.1:47822', source: frame.contentWindow, data: { type: 'no996-openfilm:boot', version: 1, rendered: true } });
    tree = panel.render();
    const button = find(tree, 'button')[0];
    assert.equal(button.props.disabled, false);
    const creating = button.props.onClick();
    button.props.onClick();
    assert.equal(creates, 1);
    assert.equal(find(panel.render(), 'button')[0].props.disabled, true);
    resolveCreate({ projectId: 'film123' });
    await creating;
    assert.equal(find(panel.render(), 'main').length, 0);
    const nextFrame = find(panel.render(), 'iframe')[0];
    assert.equal(nextFrame.props.style.visibility, 'visible');
    assert.equal(nextFrame.props.src, 'http://127.0.0.1:47822/projects/film123');
    assert.equal(nextFrame.props.ref.current, frame);
    assert.equal(find(panel.render(), 'iframe')[0].props.src, nextFrame.props.src);
  } finally { panel.close(); delete globalThis.window; delete globalThis.localStorage; }
});

test('desktop history opens only on request after the ticket is redeemed', async () => {
  const listeners = new Map();
  const ticket = 'a'.repeat(32);
  globalThis.window = { location: { protocol: 'dsh-app:', host: 'app', hostname: 'app' }, addEventListener: (event, fn) => listeners.set(event, fn), removeEventListener: event => listeners.delete(event) };
  let mutations = 0, creates = 0;
  globalThis.localStorage = { getItem: () => 'oldfilm', setItem: () => mutations++, removeItem: () => mutations++ };
  const panel = mount(createStudioPanel, { t: key => key, startStudio: async () => ({ editorOrigin: 'http://127.0.0.2:47822', ticket }), templateRequest: async body => body.action === 'list' ? { templates: [] } : (creates++, {}) });
  try {
    panel.render(); await new Promise(resolve => setImmediate(resolve));
    let tree = panel.render();
    const frame = { contentWindow: {} };
    const iframe = find(tree, 'iframe')[0];
    assert.equal(iframe.props.src, `http://127.0.0.2:47822/__dsh/open#${ticket}`);
    iframe.props.ref.current = frame;
    listeners.get('message')({ origin: 'http://127.0.0.2:47822', source: frame.contentWindow, data: { type: 'no996-openfilm:project', version: 1, projectId: '' } });
    assert.equal(mutations, 0);
    listeners.get('message')({ origin: 'http://127.0.0.2:47822', source: frame.contentWindow, data: { type: 'no996-openfilm:boot', version: 1, rendered: true } });
    tree = panel.render();
    find(tree, 'button')[0].props.onClick();
    tree = panel.render();
    assert.equal(find(tree, 'main').length, 0);
    assert.equal(find(tree, 'iframe')[0].props.src, 'http://127.0.0.2:47822/projects/oldfilm');
    assert.equal(creates, 0);
    assert.equal(mutations, 0);
  } finally { panel.close(); delete globalThis.window; delete globalThis.localStorage; }
});

test('uncertain creation prevents duplicate projects and keeps existing projects accessible', async () => {
  const listeners = new Map();
  globalThis.window = { location: { protocol: 'http:', hostname: '127.0.0.1' }, addEventListener: (event, fn) => listeners.set(event, fn), removeEventListener: event => listeners.delete(event) };
  globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
  const panel = mount(createStudioPanel, { t: key => key, startStudio: async () => ({ editorOrigin: 'http://127.0.0.1:47822' }), templateRequest: async body => { if (body.action === 'list') return { templates: [{ id: 'one', title: 'One' }] }; throw new Error('failed'); } });
  try {
    panel.render(); await new Promise(resolve => setImmediate(resolve));
    let tree = panel.render();
    const frame = { contentWindow: {} };
    find(tree, 'iframe')[0].props.ref.current = frame;
    listeners.get('message')({ origin: 'http://127.0.0.1:47822', source: frame.contentWindow, data: { type: 'no996-openfilm:boot', version: 1 } });
    tree = panel.render();
    await find(tree, 'button')[0].props.onClick();
    tree = panel.render();
    assert.equal(find(tree, 'main').length, 1);
    assert.equal(find(tree, 'button')[0].props.disabled, true);
    assert.equal(find(tree, 'button')[1].props.disabled, false);
    assert.equal(find(tree, 'p').some(p => p.props.role === 'alert' && p.children.includes('templateUncertain')), true);
  } finally { panel.close(); delete globalThis.window; delete globalThis.localStorage; }
});
