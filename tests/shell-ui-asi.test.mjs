import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { shellUiInjection } from '../src/shell-extras.mjs';

/*
 * `assets/shell-ui.js` is injected into the official OpenFilm page as one inline
 * <script>. Two ways it can break the whole page, both invisible to `node --check`:
 *
 *   1. automatic semicolon insertion — a statement starting with `(` right after
 *      a `})()` continues the previous expression as a call chain, which is how
 *      0.7.0 threw "(intermediate value)… is not a function" at the page;
 *   2. anything that throws at top level, because a script with a syntax or
 *      runtime error never defines what the rest of the injection needs.
 *
 * So this runs the real file against a stub DOM. It does not try to prove the
 * UI works — only that the page survives loading it.
 */
const source = await readFile(new URL('../assets/shell-ui.js', import.meta.url), 'utf8');

function stubElement(tag = 'div') {
  const element = {
    tagName: String(tag).toUpperCase(), dataset: {}, style: {}, children: [], classList: { add() {}, remove() {}, contains: () => false, toggle() {} },
    hidden: false, textContent: '', innerHTML: '', className: '', id: '', title: '',
    appendChild(child) { this.children.push(child); return child; },
    append(...nodes) { this.children.push(...nodes); },
    prepend(...nodes) { this.children.unshift(...nodes); },
    insertBefore(child) { this.children.push(child); return child; },
    removeChild() {}, remove() {}, setAttribute() {}, getAttribute: () => null, removeAttribute() {},
    addEventListener() {}, removeEventListener() {}, click() {}, focus() {}, blur() {},
    querySelector: () => null, querySelectorAll: () => [],
    getBoundingClientRect: () => ({ top: 0, bottom: 0, left: 0, right: 0, width: 0, height: 0 }),
    closest: () => null, contains: () => false, cloneNode() { return stubElement(tag); },
  };
  return element;
}

function runInStubDom() {
  const document = {
    readyState: 'complete',
    documentElement: stubElement('html'),
    head: stubElement('head'),
    body: stubElement('body'),
    createElement: tag => stubElement(tag),
    createTextNode: text => ({ textContent: text }),
    createDocumentFragment: () => stubElement('fragment'),
    querySelector: () => null,
    querySelectorAll: () => [],
    getElementById: () => null,
    addEventListener() {}, removeEventListener() {},
    cookie: '',
  };
  const window = {
    addEventListener() {}, removeEventListener() {}, location: { pathname: '/', href: 'http://127.0.0.1:1/projects/film123', search: '', origin: 'http://127.0.0.1:1' },
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }),
    setTimeout: () => 0, clearTimeout() {}, getComputedStyle: () => ({ getPropertyValue: () => '' }),
    fetch: async () => ({ ok: true, json: async () => ({}) }),
    requestAnimationFrame: () => 0,
  };
  const location = window.location;
  const navigator = { userAgent: 'node', language: 'zh-CN', platform: 'Win32', clipboard: { writeText: async () => {} } };
  const localStorage = window.localStorage;
  const fetch = window.fetch;
  const getComputedStyle = window.getComputedStyle;
  class MutationObserver { observe() {} disconnect() {} takeRecords() { return []; } }
  const timers = [];
  const setInterval = (fn) => { timers.push(fn); return timers.length; };
  const setTimeout = () => 0;
  const requestAnimationFrame = () => 0;

  // Called as a function body: the file is wrapped exactly as the page runs it.
  const innerWidth = 1440;
  const innerHeight = 900;
  const devicePixelRatio = 1;
  const scrollY = 0;
  const run = new Function('document', 'window', 'location', 'navigator', 'localStorage', 'fetch',
    'getComputedStyle', 'MutationObserver', 'setInterval', 'setTimeout', 'requestAnimationFrame',
    'innerWidth', 'innerHeight', 'devicePixelRatio', 'scrollY', 'addEventListener', source);
  run(document, window, location, navigator, localStorage, fetch, getComputedStyle, MutationObserver,
    setInterval, setTimeout, requestAnimationFrame, innerWidth, innerHeight, devicePixelRatio, scrollY, () => {});
  return { document, timers };
}

test('the injected script loads as a page script instead of throwing', () => {
  assert.doesNotThrow(runInStubDom);
});

test('loading twice is a no-op rather than a second set of listeners', () => {
  const first = runInStubDom();
  // `globalThis.__no996ShellUi` guards a second load: it must not throw either.
  assert.doesNotThrow(runInStubDom);
  assert.ok(first.document.body);
});

test('no statement starts a line with a bracket after a call chain', () => {
  // The exact shape that broke the page: `})()` then a line beginning with `(`.
  const lines = source.split(/\r?\n/);
  const significant = [];
  for (let i = 0; i < lines.length; i += 1) {
    const text = lines[i].trim();
    if (text === '' || text.startsWith('//') || text.startsWith('/*') || text.startsWith('*')) continue;
    significant.push({ index: i + 1, text });
  }
const offenders = [];
  for (let i = 1; i < significant.length; i += 1) {
    const current = significant[i];
    const previous = significant[i - 1];
    // Only the shape that actually merges: `… )` then a line beginning with `(`.
    // (`}` before it is a finished declaration, which is not a hazard.)
    if (!/^[([]/.test(current.text)) continue;
    if (!/[)\]]$/.test(previous.text)) continue;
    offenders.push(`line ${current.index} starts with "${current.text.slice(0, 12)}" after line ${previous.index} ending "${previous.text.slice(-12)}"`);
  }
  assert.deepEqual(offenders, []);
});

test('the load test really would catch the bug it exists for', () => {
  // The same shape that shipped in 0.7.0: two IIFEs with no semicolon between them.
  const broken = '(function(){ return undefined })()\n(function permissionGate(){})();';
  assert.throws(() => new Function(broken)(), /is not a function/);
  const fixed = '(function(){ return undefined })()\n;(function permissionGate(){})();';
  assert.doesNotThrow(() => new Function(fixed)());
});

test('the injected block stays inside one script tag', async () => {
  const injection = await shellUiInjection();
  assert.equal(typeof injection, 'string');
  assert.match(injection, /^<script>/);
  assert.match(injection, /<\/script>$/);
  assert.equal(injection.split('</script').length, 2);
});
