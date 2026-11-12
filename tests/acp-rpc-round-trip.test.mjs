// The page ↔ Host contract for the model and thinking menus, composed end to end:
// the real chat RPC dispatcher over the real ACP service, with a stand-in child.
// It pins the one thing both halves assume: the base64url value the page echoes
// back is decoded into the provider/model pair the ACP option needs.
import assert from 'node:assert/strict';
import test from 'node:test';
import { createOfficialChatRpc } from '../src/official-chat-rpc.mjs';
import { createAcpAgentService } from '../src/acp-agent-service.mjs';

const PROJECT = 'proj123456';

function memoryStore() {
  return {
    load: async () => ({ revision: 0, sessions: [], last: null, turns: [] }),
    saveSessions: async () => 1,
    saveTurn: async () => 1,
  };
}

function fakeChild(calls) {
  let modelValue = '["p","m1"]';
  let effort = 'high';
  const configOptions = () => [
    {
      id: 'model', name: 'Model', category: 'model', type: 'select', currentValue: modelValue,
      options: [
        { group: 'p', name: 'P Group', options: [{ value: '["p","m1"]', name: 'm1' }, { value: '["p","m2"]', name: 'm2' }] },
      ],
    },
    {
      id: 'reasoning_effort', name: 'Reasoning effort', category: 'thought_level', type: 'select', currentValue: effort,
      options: [{ value: 'off', name: 'Off' }, { value: 'high', name: 'High' }],
    },
  ];
  return {
    onUpdate() {},
    on() {},
    setPermissionHandler() {},
    async start() { return { agentCapabilities: { promptCapabilities: { image: false } } }; },
    async newSession() { return { sessionId: 'session-x', configOptions: configOptions() }; },
    async resumeSession() { return { sessionId: 'session-x', configOptions: configOptions() }; },
    async listSessions() { return { sessions: [] }; },
    async setConfigOption({ configId, value }) {
      calls.push({ configId, value });
      if (configId === 'model') modelValue = value;
      if (configId === 'reasoning_effort') effort = value;
      return { configOptions: configOptions() };
    },
    async prompt() { return { stopReason: 'end_turn' }; },
    async close() {},
    cancel() {},
  };
}

function compose() {
  const calls = [];
  const service = createAcpAgentService({
    verifier: async projectId => ({ projectId, path: 'C:\\project' }),
    store: { get: () => undefined, set: () => {} },
    emit: () => true,
    createClient: () => fakeChild(calls),
  });
  const dispatch = createOfficialChatRpc(memoryStore(), service, {
    state: async projectId => ({ projectId, archived: false, available: true }),
  });
  return { calls, service, dispatch };
}

test('the model option the page shows decodes back to the ACP value on select', async () => {
  const { calls, service, dispatch } = compose();
  const option = await dispatch('agent:models', { projectId: PROJECT });
  assert.equal(option.id, 'model');
  assert.deepEqual(option.options.map(entry => entry.name), ['P Group / m1', 'P Group / m2']);
  const chosen = option.options.find(entry => entry.name === 'P Group / m2');
  const result = await dispatch('agent:select-model', { projectId: PROJECT, value: chosen.value });
  assert.deepEqual(result, { ok: true });
  assert.deepEqual(calls, [{ configId: 'model', value: '["p","m2"]' }]);
  await service.close();
});

test('a forged or stale model value is refused instead of reaching the child', async () => {
  const { calls, service, dispatch } = compose();
  await dispatch('agent:models', { projectId: PROJECT });
  await assert.rejects(dispatch('agent:select-model', { projectId: PROJECT, value: 'Zm9yZ2Vk' }), error => error.code === 'OFFICIAL_CHAT_UNAVAILABLE');
  assert.deepEqual(calls, []);
  await service.close();
});

test('the thinking menu round-trips to the reasoning_effort option', async () => {
  const { calls, service, dispatch } = compose();
  const option = await dispatch('agent:thinking', { projectId: PROJECT });
  assert.equal(option.id, 'thinking');
  assert.deepEqual(option.options.map(entry => entry.value), ['off', 'high']);
  const applied = await dispatch('agent:select-thinking', { projectId: PROJECT, value: 'off' });
  assert.equal(applied.ok, true);
  assert.deepEqual(calls, [{ configId: 'reasoning_effort', value: 'off' }]);
  await assert.rejects(dispatch('agent:select-thinking', { projectId: PROJECT, value: 'nope' }), error => error.code === 'OFFICIAL_AGENT_INPUT');
  await service.close();
});

test('the permission answer reaches the approvals coordinator with the panel key', async () => {
  const answers = [];
  const service = createAcpAgentService({
    verifier: async projectId => ({ projectId, path: 'C:\\project' }),
    store: { get: () => undefined, set: () => {} },
    emit: () => true,
    approvals: { request: async () => 'allowed-once', answerRequest: input => { answers.push(input); return true; }, close() {} },
    createClient: () => fakeChild([]),
  });
  const dispatch = createOfficialChatRpc(memoryStore(), service, {
    state: async projectId => ({ projectId, archived: false, available: true }),
  });
  const result = await dispatch('agent:answer-permission', { projectId: PROJECT, key: 'dsh-key', requestId: 'req-1', optionId: 'allow-once' });
  assert.deepEqual(result, { ok: true });
  assert.deepEqual(answers, [{ projectId: PROJECT, key: 'dsh-key', requestId: 'req-1', optionId: 'allow-once' }]);
  await service.close();
});
