import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

/*
 * The transcript handlers live inside one injected <script>: a product link must
 * become a Host request (not a browser tab the proxy refuses), and a picture path
 * must become an inline picture. This runs the real file against a stub DOM with
 * one fake anchor, so a regression in the click rule fails here instead of in the
 * panel.
 */
const source = await readFile(new URL('../assets/shell-ui.js', import.meta.url), 'utf8');

function stubElement(tag = 'div') {
  const element = {
    tagName: String(tag).toUpperCase(), dataset: {}, style: {}, children: [], attributes: {},
    classList: { add() {}, remove() {}, contains: () => false, toggle() {} },
    hidden: false, textContent: '', innerHTML: '', className: '', id: '', title: '', src: '', alt: '',
    appendChild(child) { this.children.push(child); return child; },
    append(...nodes) { this.children.push(...nodes); },
    prepend(...nodes) { this.children.unshift(...nodes); },
    insertBefore(child) { this.children.push(child); return child; },
    removeChild() {}, remove() {}, removeAttribute(name) { delete this.attributes[name]; },
    setAttribute(name, value) { this.attributes[name] = String(value); },
    getAttribute(name) { return Object.hasOwn(this.attributes, name) ? this.attributes[name] : null; },
    addEventListener() {}, removeEventListener() {}, click() {}, focus() {}, blur() {},
    querySelector: () => null, querySelectorAll: () => [],
    getBoundingClientRect: () => ({ top: 0, bottom: 0, left: 0, right: 0, width: 0, height: 0 }),
    closest: () => null, contains: () => false, cloneNode() { return stubElement(tag); },
  };
  return element;
}

function run({ pathname = '/projects/film123' } = {}) {
  // The injected script installs itself once per page; every test is a new page.
  delete globalThis.__no996ShellUi;
  const listeners = new Map();
  const fetched = [];
  const document = {
    readyState: 'complete',
    documentElement: stubElement('html'),
    head: stubElement('head'),
    body: stubElement('body'),
    activeElement: null,
    createElement: tag => stubElement(tag),
    createTextNode: text => ({ textContent: text }),
    createDocumentFragment: () => stubElement('fragment'),
    querySelector: () => null,
    querySelectorAll: () => [],
    getElementById: () => null,
    addEventListener(type, handler) {
      const list = listeners.get(type) ?? [];
      list.push(handler);
      listeners.set(type, list);
    },
    removeEventListener() {},
    cookie: '',
  };
  const location = { pathname, href: 'http://127.0.0.1:1' + pathname, search: '', origin: 'http://127.0.0.1:1' };
  const window = {
    addEventListener() {}, removeEventListener() {}, location,
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }),
    setTimeout: () => 0, clearTimeout() {}, getComputedStyle: () => ({ getPropertyValue: () => '' }),
    fetch: async (...args) => { fetched.push(args); return { ok: true, json: async () => ({}) }; },
    requestAnimationFrame: () => 0,
  };
  const navigator = { userAgent: 'node', language: 'zh-CN', platform: 'Win32', clipboard: { writeText: async () => {} } };
  class MutationObserver { observe() {} disconnect() {} takeRecords() { return []; } }
  const runBody = new Function('document', 'window', 'location', 'navigator', 'localStorage', 'fetch',
    'getComputedStyle', 'MutationObserver', 'setInterval', 'setTimeout', 'requestAnimationFrame',
    'innerWidth', 'innerHeight', 'devicePixelRatio', 'scrollY', 'addEventListener', source);
  runBody(document, window, location, navigator, window.localStorage, window.fetch, window.getComputedStyle,
    MutationObserver, () => 0, () => 0, () => 0, 1440, 900, 1, 0, () => {});
  const click = (href, extra = {}) => {
    let prevented = false;
    let stopped = false;
    const anchor = {
      style: {}, attributes: { href },
      getAttribute(name) { return Object.hasOwn(this.attributes, name) ? this.attributes[name] : null; },
      setAttribute(name, value) { this.attributes[name] = String(value); },
      removeAttribute(name) { delete this.attributes[name]; },
      parentNode: null, querySelector: () => null,
    };
    const target = { closest: selector => (selector === 'a[href]' ? anchor : null) };
    const event = { type: 'click', target, shiftKey: false, altKey: false, preventDefault() { prevented = true; }, stopPropagation() { stopped = true; }, ...extra };
    for (const handler of listeners.get('click') ?? []) handler(event);
    return { prevented, stopped, anchor };
  };
  const hostCalls = () => fetched.filter(call => call[0] === '/__dsh/open-file');
  return { document, fetched, hostCalls, click, listeners };
}

test('clicking a product link asks the Host to open it instead of navigating', () => {
  const { hostCalls, click } = run();
  const result = click('手绘笔记-9e6b7c5847a2.mp4');
  assert.equal(result.prevented, true);
  const calls = hostCalls();
  assert.equal(calls.length, 1);
  assert.equal(calls[0][1].method, 'POST');
  const body = JSON.parse(calls[0][1].body);
  assert.deepEqual(body, { projectId: 'film123', path: '手绘笔记-9e6b7c5847a2.mp4', reveal: false });
});

test('a link to another site is left alone', () => {
  const { hostCalls, click } = run();
  const result = click('https://example.com/film.mp4');
  assert.equal(result.prevented, false);
  assert.equal(hostCalls().length, 0);
});

test('a link outside a project page is left alone', () => {
  const { hostCalls, click } = run({ pathname: '/' });
  click('film.mp4');
  assert.equal(hostCalls().length, 0);
});

test('clicking a picture path opens the in-page preview, not the browser', () => {
  const { document, hostCalls, click } = run();
  const result = click('assets/contact.png');
  assert.equal(result.prevented, true);
  assert.equal(hostCalls().length, 0);
  const dialog = document.documentElement.children.find(child => child.getAttribute && child.getAttribute('role') === 'dialog');
  assert.ok(dialog, 'a preview dialog should be mounted');
  const picture = dialog.children.find(child => child.tagName === 'IMG');
  assert.equal(picture.src, '/__dsh/project-file?projectId=film123&path=assets%2Fcontact.png');
});

test('the native open honours a modifier key by revealing the file', () => {
  const { hostCalls, click } = run();
  // shift on a picture still previews; shift on a video reveals it instead
  click('assets/contact.png', { shiftKey: true });
  assert.equal(hostCalls().length, 0);
  click('film.mp4', { shiftKey: true });
  assert.equal(JSON.parse(hostCalls()[0][1].body).reveal, true);
});
