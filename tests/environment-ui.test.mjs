import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync(new URL('../assets/shell-ui.js', import.meta.url), 'utf8');
const start = source.indexOf('  (function environmentNotice(){');
const end = source.indexOf('  // Entry card.', start);
assert.ok(start >= 0 && end > start);
const script = source.slice(start, end);

class Element {
  constructor(tag) { this.tagName = tag; this.children = []; this.style = {}; this.attributes = {}; this.hidden = false; this.listeners = {}; this.textContent = ''; }
  setAttribute(name, value) { this.attributes[name] = value; }
  appendChild(el) { this.children.push(el); return el; }
  addEventListener(name, fn) { this.listeners[name] = fn; }
  click() { if (!this.disabled) this.listeners.click?.(); }
  focus() { this.focused = true; }
  select() { this.selected = true; }
}
function setup(clipboard) {
  const requests = [];
  const root = new Element('root');
  const document = { documentElement: root, createElement: tag => new Element(tag) };
  const fetch = (url, options) => new Promise((resolve, reject) => requests.push({ url, options, resolve, reject }));
  vm.runInNewContext(script, { document, fetch, navigator: { clipboard }, Promise });
  const panel = root.children[0];
  const [heading, status, guide, actions, pathArea, feedback, fallback] = panel.children;
  const [details, installed, notInstalled, copy, check, skip] = actions.children;
  const pathInput = pathArea.children[0].children[0];
  return { requests, panel, status, guide, feedback, fallback, details, installed, notInstalled, pathArea, pathInput, copy, check, skip };
}
const flush = () => new Promise(resolve => setImmediate(resolve));
function result(req, platform, ffmpeg, ffprobe) {
  req.resolve({ ok: true, json: async () => ({ platform, tools: { ffmpeg: { status: ffmpeg }, ffprobe: { status: ffprobe } } }) });
}

test('startup visibly checks fresh RPC and shows the healthy result', async () => {
  const ui = setup();
  assert.equal(ui.panel.style.display, 'block');
  assert.match(ui.status.textContent, /正在检查/);
  assert.equal(ui.requests[0].url, '/__dsh/official-rpc');
  assert.equal(ui.requests[0].options.cache, 'no-store');
  assert.deepEqual(JSON.parse(ui.requests[0].options.body), { channel: 'environment:check', payload: {} });
  result(ui.requests[0], 'win32', 'ok', 'ok'); await flush();
  assert.equal(ui.panel.style.display, 'block');
  assert.match(ui.status.textContent, /检查通过/);
  assert.equal(ui.installed.hidden, true);
  assert.equal(ui.notInstalled.hidden, true);
  assert.equal(ui.copy.hidden, true);
  assert.equal(ui.skip.textContent, '关闭');
  ui.skip.click(); assert.equal(ui.panel.style.display, 'none');
});

test('all platforms show accurate issues and manual guidance, recheck fetches anew', async () => {
  for (const platform of ['win32', 'darwin', 'linux']) {
    const ui = setup(); result(ui.requests[0], platform, 'missing', 'timeout'); await flush();
    assert.equal(ui.panel.style.display, 'block');
    assert.match(ui.status.textContent, /ffmpeg：未找到.*ffprobe：检查超时/);
    ui.details.click(); assert.equal(ui.guide.hidden, false);
    assert.match(ui.guide.children[0].textContent, new RegExp(({ win32: 'Windows', darwin: 'macOS', linux: 'Linux' })[platform]));
    assert.match(ui.guide.children[1].textContent, /重启 DSH.*保存/);
    ui.check.click(); assert.equal(ui.check.disabled, true); assert.equal(ui.requests.length, 2);
    result(ui.requests[1], platform, 'ok', 'ok'); await flush();
    assert.equal(ui.panel.style.display, 'block');
    assert.match(ui.status.textContent, /检查通过.*重试/);
  }
});

test('failure is not reported as missing and skip invalidates an in-flight check', async () => {
  const ui = setup(); ui.requests[0].reject(new Error('offline')); await flush();
  assert.match(ui.status.textContent, /无法确定工具状态/); assert.doesNotMatch(ui.status.textContent, /未找到/);
  ui.check.click(); ui.skip.click(); result(ui.requests[1], 'linux', 'missing', 'unusable'); await flush();
  assert.equal(ui.panel.style.display, 'none');
});

test('invalid response is not mistaken for missing tools', async () => {
  const ui = setup(); ui.requests[0].resolve({ ok: true, json: async () => ({}) }); await flush();
  assert.match(ui.status.textContent, /无法确定工具状态/);
});

test('installed path is only copied as data; missing path blocks copy', async () => {
  let copied = '';
  const ui = setup({ writeText: text => { copied = text; return Promise.resolve(); } });
  result(ui.requests[0], 'win32', 'missing', 'missing'); await flush();
  ui.installed.click(); assert.equal(ui.pathArea.hidden, false);
  ui.copy.click(); assert.equal(copied, ''); assert.match(ui.feedback.textContent, /输入/);
  ui.pathInput.value = 'C:\\Program Files\\ffmpeg\\bin';
  ui.copy.click(); await flush();
  assert.ok(copied.includes(JSON.stringify(ui.pathInput.value)));
  assert.match(copied, /仅作数据.*勿执行/); assert.match(copied, /征求我的确认/);
  assert.match(copied, /Finder.*PATH/); assert.match(ui.feedback.textContent, /尚未配置或安装/);
  assert.equal(ui.requests.length, 1);
  ui.notInstalled.click(); assert.equal(ui.pathArea.hidden, true);
  ui.copy.click(); await flush(); assert.match(copied, /需要安装/); assert.doesNotMatch(copied, /Program Files/);
});

test('HTTP errors are unknown rather than missing', async () => {
  const ui = setup(); ui.requests[0].resolve({ ok: false, status: 403 }); await flush();
  assert.match(ui.status.textContent, /无法确定工具状态/); assert.doesNotMatch(ui.status.textContent, /未找到/);
});

test('clipboard failure offers selected safe prompt; success confirms copy', async () => {
  const ui = setup({ writeText: () => Promise.reject(new Error('denied')) });
  result(ui.requests[0], 'darwin', 'unusable', 'ok'); await flush(); ui.copy.click(); await flush();
  assert.equal(ui.fallback.hidden, false); assert.equal(ui.fallback.selected, true);
  assert.match(ui.fallback.value, /执行命令.*之前.*征求我的确认/);
  let copied = '';
  const other = setup({ writeText: text => { copied = text; return Promise.resolve(); } });
  result(other.requests[0], 'linux', 'missing', 'ok'); await flush(); other.copy.click(); await flush();
  assert.match(copied, /DeepSeek|OpenFilm/); assert.match(other.feedback.textContent, /已复制/);
});
