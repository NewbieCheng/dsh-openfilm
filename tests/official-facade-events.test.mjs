import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runInNewContext } from 'node:vm';
import { officialFacadeSource } from '../src/official-facade.mjs';

function setup({ promptResult = { ok: true }, EventSourceAvailable = true } = {}) {
  const sources = [], calls = [], events = [], timers = new Map();
  let nextTimer = 0;
  class MockEventSource {
    constructor(url) { this.url = url; this.readyState = 0; this.handlers = {}; sources.push(this); }
    addEventListener(name, fn) { this.handlers[name] = fn; }
    open() { this.readyState = 1; }
    ready() { this.handlers.ready?.({ data: '{}' }); }
    error() { this.readyState = 0; this.onerror?.({}); }
    message(value) { this.onmessage?.({ data: JSON.stringify(value) }); }
    close() { this.readyState = 2; }
  }
  const factory = runInNewContext(officialFacadeSource, { EventSource: EventSourceAvailable ? MockEventSource : undefined,
    setTimeout: fn => { const id = ++nextTimer; timers.set(id, fn); return id; }, clearTimeout: id => timers.delete(id) });
  const facade = factory({ invoke: async (channel, payload) => {
    calls.push({ channel, payload });
    if (channel === 'agent:prompt') return await promptResult;
    if (channel === 'agent:cancel') return { ok: true };
    return null;
  } });
  facade.localAgents.onEvent(event => events.push(event));
  return { facade, sources, calls, events, fireTimers: () => { for (const fn of [...timers.values()]) fn(); } };
}
async function start(env) { return (await env.facade.localAgents.start('deepseek', '', null, { projectId: 'project1' })).key; }
const tick = () => new Promise(resolve => setImmediate(resolve));
const done = (key, turnId, extra = {}) => ({ key, turnId, kind: 'done', ok: true, stopReason: 'end_turn', ...extra });

test('RPC success cannot overtake ordered updates and matching terminal', async () => {
  const env = setup(), key = await start(env);
  let settled = false;
  const pending = env.facade.localAgents.prompt(key, 'hello', { turnId: 't1' }).then(value => { settled = true; return value; });
  const source = env.sources[0]; source.open();
  await tick(); assert.equal(env.calls.filter(x => x.channel === 'agent:prompt').length, 0);
  source.ready(); await tick(); assert.equal(settled, false);
  source.message(done(key, 'other')); assert.equal(settled, false);
  source.message({ key, kind: 'update', update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'hello' } } });
  source.message(done(key, 't1'));
  assert.equal((await pending).stopReason, 'end_turn');
  assert.deepEqual(env.events.map(x => x.kind), ['update', 'done']);
});

test('terminal can precede RPC and preserves failure or cancellation', async () => {
  for (const terminal of [{ ok: false, error: 'model failed' }, { ok: true, stopReason: 'cancelled' }]) {
    let finish; const rpc = new Promise(resolve => { finish = resolve; });
    const env = setup({ promptResult: rpc }), key = await start(env);
    const pending = env.facade.localAgents.prompt(key, 'hello', { turnId: 't1' });
    const source = env.sources[0]; source.open(); source.ready(); await tick();
    source.message(done(key, 't1', terminal));
    const result = await pending;
    assert.equal(result.ok, terminal.ok);
    if (!terminal.ok) assert.equal(result.error, 'model failed');
    else assert.equal(result.stopReason, 'cancelled');
    finish({ ok: true });
  }
});

test('missing terminal after RPC completion fails visibly instead of hanging', async () => {
  const env = setup(), key = await start(env);
  const pending = env.facade.localAgents.prompt(key, 'hello', { turnId: 't1' });
  env.sources[0].open(); env.sources[0].ready();
  await tick();
  env.fireTimers();
  await assert.rejects(pending, /terminal missing/);
  assert.equal(env.events.length, 0);
});

test('disconnect while active fails visibly instead of inventing done', async () => {
  const env = setup(), key = await start(env);
  const pending = env.facade.localAgents.prompt(key, 'hello', { turnId: 't1' });
  const source = env.sources[0]; source.open(); source.ready(); await tick(); source.error();
  await assert.rejects(pending, /stream disconnected/);
  assert.equal(env.events.length, 0);
});

test('RPC rejection is visible without a terminal', async () => {
  const env = setup({ promptResult: Promise.reject(new Error('admission refused')) }), key = await start(env);
  const pending = env.facade.localAgents.prompt(key, 'hello', { turnId: 't1' });
  env.sources[0].open(); env.sources[0].ready();
  await assert.rejects(pending, /admission refused/);
  assert.equal(env.events.length, 0);
});

test('missing source and readiness timeout fail closed', async () => {
  const absent = setup({ EventSourceAvailable: false }), key1 = await start(absent);
  await assert.rejects(absent.facade.localAgents.prompt(key1, 'hello'), /agent.events/);
  const env = setup(), key = await start(env);
  const pending = env.facade.localAgents.prompt(key, 'hello');
  env.sources[0].open(); env.fireTimers();
  await assert.rejects(pending, /agent.events/);
  assert.equal(env.calls.filter(x => x.channel === 'agent:prompt').length, 0);
});

test('cancel while running does not manufacture a terminal', async () => {
  let finish; const rpc = new Promise(resolve => { finish = resolve; });
  const env = setup({ promptResult: rpc }), key = await start(env);
  const pending = env.facade.localAgents.prompt(key, 'hello', { turnId: 't1' });
  env.sources[0].open(); env.sources[0].ready(); await tick();
  await env.facade.localAgents.cancel(key);
  assert.equal(env.events.length, 0);
  env.sources[0].message(done(key, 't1', { stopReason: 'cancelled' }));
  assert.equal((await pending).stopReason, 'cancelled');
  finish({ ok: true });
});

test('cancel before ready never dispatches prompt', async () => {
  const env = setup(), key = await start(env);
  const pending = env.facade.localAgents.prompt(key, 'hello', { turnId: 't1' });
  await env.facade.localAgents.cancel(key);
  assert.equal((await pending).stopReason, 'cancelled');
  env.sources[0].open(); env.sources[0].ready(); await tick();
  assert.equal(env.calls.filter(x => x.channel === 'agent:prompt').length, 0);
});
// The permission row: it has to reach the composer menu, and it must not invent a
// preset the Host never applied.
test('the permission row carries the Host preset and a real choice', async () => {
  const sources = [];
  const calls = [];
  const factory = runInNewContext(officialFacadeSource, { EventSource: undefined, setTimeout: () => 0, clearTimeout: () => {} });
  const facade = factory({ invoke: async (channel, payload) => {
    calls.push({ channel, payload });
    if (channel === 'agent:permission') return { current: 'danger-full-access', decided: 'danger-full-access', available: true };
    if (channel === 'agent:permission-set') return { ok: true, preset: payload.preset, applied: true };
    if (channel === 'agent:models') return { id: 'model', name: '模型', category: 'model', type: 'select', currentValue: 'a', options: [{ value: 'a', name: 'A' }] };
    return null;
  } });
  const started = await facade.localAgents.start('deepseek', '', null, { projectId: 'project1' });
  const option = (started.info?.configOptions || []).find(o => o && o.category === 'permission');
  assert.ok(option, `expected a permission option, got ${JSON.stringify(started.configOptions)}`);
  assert.equal(option.currentValue, 'danger-full-access');
  // Values come from the vm realm, so compare textually rather than by prototype identity.
  assert.equal(option.options.map(o => o.value).join(','), 'danger-full-access,workspace-write');
  // Choosing it goes to the Host's own setter, not to a page-local pref.
  await facade.localAgents.setOption(started.key, 'permission', 'workspace-write');
  const set = calls.filter(c => c.channel === 'agent:permission-set').pop();
  assert.equal(set?.payload?.preset, 'workspace-write');
  assert.equal(sources.length, 0);
});

test('no applied preset means no permission row', async () => {
  const factory = runInNewContext(officialFacadeSource, { EventSource: undefined, setTimeout: () => 0, clearTimeout: () => {} });
  const facade = factory({ invoke: async (channel) => {
    if (channel === 'agent:permission') return { current: null, available: false };
    return null;
  } });
  const started = await facade.localAgents.start('deepseek', '', null, { projectId: 'project1' });
  assert.equal((started.info?.configOptions || []).some(o => o && o.category === 'permission'), false);
});
// The row must not disappear when the Host reports a preset this build does not name.
// It went missing entirely (person: "缺少选择权限") whenever the preset failed to
// resolve, because the builder returned null for any `current` it did not list.
test('an unknown current preset still draws the permission row', async () => {
  const env = setup();
  env.calls.length = 0;
  const factoryCalls = [];
  const facade = runInNewContext(officialFacadeSource, { EventSource: class { close() {} } })({
    invoke: async (channel, payload) => {
      factoryCalls.push({ channel, payload });
      if (channel === 'agent:permission') return { current: 'read-only', decided: 'read-only', available: true };
      return null;
    },
  });
  const started = await facade.localAgents.start('deepseek', '', null, { projectId: 'project1' });
  const option = (started.info?.configOptions || []).find(o => o && o.category === 'permission');
  assert.ok(option, `expected a permission option, got ${JSON.stringify(started.configOptions)}`);
  assert.equal(option.currentValue, 'read-only');
  assert.equal(option.options.map(o => o.value).join(','), 'danger-full-access,workspace-write,read-only');
});