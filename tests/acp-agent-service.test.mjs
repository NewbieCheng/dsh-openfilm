// The ACP-backed conversation service: what the panel's model menu, thinking
// menu and prompt now talk to. Tested against the wire-level stand-in agent, so
// no real model is ever called (AGENTS §1).
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { createAcpClient } from '../src/acp-client.mjs';
import { catalogFromConfigOptions, createAcpAgentService } from '../src/acp-agent-service.mjs';

const fixture = fileURLToPath(new URL('./fixtures/fake-acp-agent.mjs', import.meta.url));
const PROJECT = 'proj123456';

function memoryStore(seed = {}) {
  const table = new Map(Object.entries(seed));
  return { get: id => table.get(id), set: (id, value) => table.set(id, value), all: () => [...table] };
}

function harness({ mode, image = false, emptyList = false, store = memoryStore(), approvals, defaultSelection } = {}) {
  const events = [];
  const service = createAcpAgentService({
    verifier: async projectId => ({ projectId, path: 'C:\\fake' }),
    store,
    emit: (projectId, event) => { events.push({ projectId, ...event }); return true; },
    approvals,
    defaultSelection: defaultSelection ?? (() => undefined),
    createClient: () => createAcpClient({
      resolve: () => ({ command: process.execPath, args: [fixture] }),
      env: { ...process.env, ...(mode ? { FAKE_ACP_MODE: mode } : {}), ...(image ? { FAKE_ACP_IMAGE: '1' } : {}), ...(emptyList ? { FAKE_ACP_EMPTY_LIST: '1' } : {}) },
      requestTimeoutMs: 5000,
      spawnChild: (command, args, options) => spawn(command, args, options),
    }),
  });
  return { service, events };
}

const updatesOf = events => events.filter(event => event.kind === 'update').map(event => event.update);

test('the advertised model catalog becomes the DSH shape the menu expects', async () => {
  const { service } = harness();
  const catalog = await service.modelCatalog(PROJECT);
  assert.deepEqual(catalog.groups.map(group => group.id), ['p', 'q']);
  assert.deepEqual(catalog.groups[0].models.map(model => model.id), ['m1', 'm2']);
  assert.deepEqual(catalog.default, { provider: 'p', model: 'm1' });
  await service.close();
});

test('flattening tolerates option rows that carry no group', () => {
  const catalog = catalogFromConfigOptions([
    { id: 'model', category: 'model', currentValue: '["x","y"]', options: [{ value: '["x","y"]', name: 'Y' }] },
  ]);
  assert.deepEqual(catalog.groups, [{ id: 'x', name: 'x', models: [{ id: 'y', name: 'Y' }] }]);
});

test('the panel session adopts the DSH-side model selection', async () => {
  const { service } = harness({ defaultSelection: () => ({ provider: 'q', model: 'q1' }) });
  const catalog = await service.modelCatalog(PROJECT);
  assert.deepEqual(catalog.default, { provider: 'q', model: 'q1' });
  await service.close();
});

test('a prompt streams updates under the panel key and ends the turn', async () => {
  const { service, events } = harness();
  const result = await service.send(PROJECT, { key: 'dsh-key-1', turnId: 'turn-1', text: 'hello' });
  assert.equal(result.ok, true);
  assert.equal(result.stopReason, 'end_turn');
  const updates = events.filter(event => event.kind === 'update');
  assert.ok(updates.length >= 2, 'thought and message chunks both arrive');
  assert.ok(updates.every(event => event.key === 'dsh-key-1'));
  const done = events.find(event => event.kind === 'done');
  assert.equal(done.turnId, 'turn-1');
  assert.equal(done.ok, true);
  await service.close();
});

test('DSH-side sessions in the folder are not mistaken for resumable ACP sessions', async () => {
  // session/list reports DSH ids; resuming one fails by protocol. A missing mapping
  // must open a fresh ACP Session instead of pretending the old one came back.
  const { service } = harness({ emptyList: true });
  await service.modelCatalog(PROJECT);
  assert.equal(service.sessionOf(PROJECT), 'session-fake-1');
  await service.close();
});

test('the first turn creates a Session; the id is remembered for resume', async () => {
  const store = memoryStore();
  const first = harness({ store, emptyList: true });
  await first.service.send(PROJECT, { key: 'k', turnId: 't1', text: 'hi' });
  const sessionId = first.service.sessionOf(PROJECT);
  assert.equal(sessionId, 'session-fake-1');
  assert.equal(store.get(PROJECT).sessionId, sessionId);
  await first.service.close();

  const second = harness({ store, emptyList: true });
  const catalog = await second.service.modelCatalog(PROJECT);
  assert.equal(second.service.sessionOf(PROJECT), sessionId, 'the stored id is resumed, not recreated');
  assert.ok(catalog.groups.length > 0);
  await second.service.close();
});

test('model and thinking selections go through ACP config options', async () => {
  const { service } = harness();
  const selected = await service.selectModel(PROJECT, { provider: 'q', model: 'q1' });
  assert.equal(selected.ok, true);
  assert.equal(JSON.parse(selected.currentValue)[1], 'q1');

  const thinking = await service.thinkingOption(PROJECT);
  assert.equal(thinking.id, 'thinking');
  assert.deepEqual(thinking.options.map(option => option.value), ['off', 'high']);

  const applied = await service.selectThinking(PROJECT, 'off');
  assert.equal(applied.ok, true);
  await assert.rejects(service.selectThinking(PROJECT, 'nope'), error => error.code === 'OFFICIAL_AGENT_INPUT');
  await assert.rejects(service.selectModel(PROJECT, { provider: 'p', model: 'missing' }), error => error.code === 'OFFICIAL_AGENT_MODEL_UNAVAILABLE');
  await service.close();
});

test('a model that declares no image input gets reference paths instead of image blocks', async () => {
  const { service, events } = harness({ image: false });
  await service.send(PROJECT, {
    key: 'k', turnId: 't', text: 'look',
    images: [{ mediaType: 'image/png', data: Buffer.from('fake').toString('base64') }],
  });
  const message = updatesOf(events).find(update => update.sessionUpdate === 'agent_message_chunk');
  assert.match(message.content.text, /blocks:text/);
  assert.equal(updatesOf(events).some(update => update.content?.type === 'image'), false);
  await service.close();
});

test('an image-capable route sends the inline picture', async () => {
  const { service, events } = harness({ image: true });
  await service.send(PROJECT, {
    key: 'k', turnId: 't', text: 'look',
    images: [{ mediaType: 'image/png', data: Buffer.from('fake').toString('base64') }],
  });
  const message = updatesOf(events).find(update => update.sessionUpdate === 'agent_message_chunk');
  assert.match(message.content.text, /blocks:image,text/);
  await service.close();
});

test('a permission request is asked through the approvals coordinator', async () => {
  const asked = [];
  const { service } = harness({
    approvals: {
      request: async input => { asked.push(input); return 'allowed-once'; },
      answerRequest: () => true,
      close: () => {},
    },
  });
  const result = await service.send(PROJECT, { key: 'k', turnId: 't', text: 'go' });
  assert.equal(result.stopReason, 'end_turn');
  assert.equal(asked.length, 1);
  assert.equal(asked[0].projectId, PROJECT);
  assert.equal(asked[0].key, 'k');
  assert.equal(asked[0].toolName, 'write');
  assert.equal(service.answerPermission(PROJECT, { key: 'k', requestId: 'r', optionId: 'allow-once' }).ok, true);
  await service.close();
});

test('a refused permission answers the agent instead of hanging the turn', async () => {
  const asked = [];
  const { service } = harness({ approvals: { request: async input => { asked.push(input); return 'rejected'; }, answerRequest: () => true, close: () => {} } });
  const result = await service.send(PROJECT, { key: 'k', turnId: 't', text: 'go' });
  assert.equal(asked.length, 1);
  assert.ok(['end_turn', 'cancelled'].includes(result.stopReason), 'the agent decides; we never leave it waiting');
  await service.close();
});

test('cancel reaches the agent and a second concurrent turn is refused by name', async () => {
  const { service } = harness({ mode: 'hang-on-prompt' });
  const first = service.send(PROJECT, { key: 'k', turnId: 't1', text: 'go' }).catch(error => error);
  await new Promise(resolve => setTimeout(resolve, 60));
  await assert.rejects(service.send(PROJECT, { key: 'k', turnId: 't2', text: 'again' }), error => error.code === 'OFFICIAL_AGENT_BUSY');
  const cancelled = await service.cancel(PROJECT);
  assert.equal(cancelled.ok, true);
  await first;
  await service.close();
});
