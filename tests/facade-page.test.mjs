// The injected page code, executed for real in a VM with a minimal browser
// surface. This is the layer below the React shell: `globalThis.openfilmNative`
// is the exact expression the proxy embeds, and its menu/prompt/terminal logic is
// what the official shell calls. No browser and no real model.
import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import { officialFacadeSource } from '../src/official-facade.mjs';

const PROJECT = 'film123';
// Values cross the VM realm boundary, so their prototypes are not this realm's.
const plain = value => JSON.parse(JSON.stringify(value));

function createPage() {
  const calls = [];
  const events = [];
  let source = null;
  const modelValue = Buffer.from(JSON.stringify(['deepseek-official', 'deepseek-chat'])).toString('base64url');
  const invoke = async (channel, payload) => {
    calls.push({ channel, payload });
    if (channel === 'agent:models') {
      return {
        id: 'model', name: 'Model', category: 'model', type: 'select', currentValue: modelValue,
        options: [{ name: 'DeepSeek / deepseek-chat', value: modelValue }, { name: 'DeepSeek / pro', value: Buffer.from(JSON.stringify(['deepseek-official', 'deepseek-v4-pro'])).toString('base64url') }],
      };
    }
    if (channel === 'agent:thinking') {
      return { id: 'thinking', name: 'Thinking', currentValue: 'high', options: [{ value: 'off', name: 'Off' }, { value: 'high', name: 'High' }] };
    }
    if (channel === 'agent:session') return { ok: true, sessionId: 'session-1', resumed: true };
    if (channel === 'agent:permission') {
      return { available: true, decided: true, remembered: 'danger-full-access', current: 'danger-full-access', names: [], fullAccess: 'danger-full-access', workspace: 'workspace-write' };
    }
    if (channel === 'agent:select-model' || channel === 'agent:select-thinking' || channel === 'agent:permission-set') return { ok: true };
    if (channel === 'agent:prompt') {
      setTimeout(() => {
        source.push({ key: payload.key, kind: 'update', update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'hi' } } });
        source.push({ key: payload.key, kind: 'done', turnId: payload.turnId, ok: true, stopReason: 'end_turn' });
      }, 1);
      return { ok: true, stopReason: 'end_turn' };
    }
    return { ok: true };
  };

  class FakeEventSource {
    constructor(url) {
      this.url = url;
      this.readyState = 0;
      this.listeners = new Map();
      this.onmessage = null;
      this.onerror = null;
      source = this;
      setTimeout(() => {
        this.readyState = 1;
        for (const listener of this.listeners.get('ready') ?? []) listener();
      }, 0);
    }
    addEventListener(name, listener) {
      if (!this.listeners.has(name)) this.listeners.set(name, []);
      this.listeners.get(name).push(listener);
    }
    close() { this.readyState = 2; }
    push(value) { this.onmessage?.({ data: JSON.stringify(value) }); }
  }

  const context = vm.createContext({
    console, setTimeout, clearTimeout, Promise, JSON, Math, Date, Array, Object, String, Number, Error, Map, Set, RegExp,
    location: { pathname: '/projects/' + PROJECT },
    localStorage: { getItem: () => null, setItem: () => {} },
    dispatchEvent: () => {},
    CustomEvent: class CustomEvent { constructor(type, init) { this.type = type; this.detail = init?.detail; } },
    openfilmDesktop: { hello: async () => ({ project: { id: PROJECT, path: 'C:\\fake' } }) },
    EventSource: FakeEventSource,
    __invoke: invoke,
    __upload: async () => ({ ok: false }),
  });
  vm.runInContext(`globalThis.openfilmNative = ${officialFacadeSource}({ invoke: globalThis.__invoke, upload: globalThis.__upload });`, context);
  const native = context.openfilmNative;
  native.localAgents.onEvent(event => events.push(event));
  return { native, calls, events };
}

test('the injected page code builds the three menu rows from the RPC layer', async () => {
  const page = createPage();
  const probed = await page.native.localAgents.probe();
  assert.equal(probed.ok, true);
  assert.deepEqual(plain(probed.info.configOptions.map(option => option.id)), ['model', 'thinking', 'permission']);
  const permission = probed.info.configOptions.at(-1);
  assert.equal(permission.currentValue, 'danger-full-access');
  assert.deepEqual(plain(permission.options.map(option => option.value)), ['danger-full-access', 'workspace-write']);

  const started = await page.native.localAgents.start('deepseek', 'C:\\fake', null, { projectId: PROJECT });
  assert.equal(started.ok, true);
  assert.ok(started.key.startsWith('dsh-'));
  assert.deepEqual(plain(started.info.configOptions.map(option => option.id)), ['model', 'thinking', 'permission']);
  // The Host said this conversation continues: the shell must not show its
  // "could not open the previous session" hand-over.
  assert.equal(started.info.resumed, true);
  assert.ok(String(started.info.sessionId).startsWith('dsh-'), 'a fresh conversation gets a new id');

  // A reload asks to resume the conversation it already knows; the answer must
  // carry that same id, or the shell reports a failed resume every time.
  const reopened = await page.native.localAgents.start('deepseek', 'C:\\fake', 'conversation-1', { projectId: PROJECT });
  assert.equal(reopened.info.sessionId, 'conversation-1');
});

test('the page sends a turn, forwards the chosen options and finishes on the terminal event', async () => {
  const page = createPage();
  const started = await page.native.localAgents.start('deepseek', 'C:\\fake', null, { projectId: PROJECT });
  const modelValue = started.info.configOptions[0].options[1].value;
  await page.native.localAgents.setOption(started.key, 'model', modelValue);
  await page.native.localAgents.setOption(started.key, 'thinking', 'off');
  await page.native.localAgents.setOption(started.key, 'permission', 'workspace-write');

  const sent = await page.native.localAgents.prompt(started.key, 'hello', { turnId: 'turn-1' });
  assert.deepEqual(plain(sent), { ok: true, stopReason: 'end_turn' });

  const channels = page.calls.map(call => call.channel);
  assert.ok(channels.includes('agent:select-model'));
  assert.ok(channels.includes('agent:select-thinking'));
  assert.ok(channels.includes('agent:permission-set'));
  const prompt = page.calls.find(call => call.channel === 'agent:prompt');
  assert.equal(prompt.payload.projectId, PROJECT);
  assert.equal(prompt.payload.key, started.key);
  assert.equal(prompt.payload.turnId, 'turn-1');
  assert.equal(prompt.payload.text, 'hello');

  const updates = page.events.filter(event => event.kind === 'update');
  const done = page.events.find(event => event.kind === 'done');
  assert.equal(updates.length, 1);
  assert.equal(done.turnId, 'turn-1');
  assert.equal(done.ok, true);
});

test('a prompt for a key this page never started is refused by name', async () => {
  const page = createPage();
  await assert.rejects(page.native.localAgents.prompt('dsh-unknown', 'hi', { turnId: 't' }), error => /unavailable/i.test(String(error.message)));
  assert.equal(page.calls.length, 0);
});
