import test from 'node:test';
import assert from 'node:assert/strict';
import { createOfficialAgentService } from '../src/official-agent-service.mjs';

function fixture({ emit, archived } = {}) {
  let feed;
  let promptReady;
  let nextReason = 'completed';
  let autoEnd = true;
  let turn = 0;
  const events = [];
  const selections = [];
  const cancellations = [];
  const controller = {
    modelCatalog: async () => ({ default: { provider: 'p', model: 'default' }, groups: [{ id: 'p', models: [{ id: 'chosen' }] }] }),
    selectModel: async (selection) => { selections.push(selection); return { selected: selection }; },
    follow(_request, signal) {
      const queue = [{ type: 'snapshot', header: { id: 'session' }, records: [], hasMore: false, assistantStream: {} }];
      let wake;
      let closed = false;
      feed = value => { queue.push(value); wake?.(); wake = undefined; };
      signal.addEventListener('abort', () => { closed = true; wake?.(); wake = undefined; }, { once: true });
      return { [Symbol.asyncIterator]() { return this; }, async next() {
        while (!queue.length && !closed) await new Promise(resolve => { wake = resolve; });
        return queue.length ? { value: queue.shift(), done: false } : { done: true };
      }, async return() { closed = true; wake?.(); return { done: true }; } };
    },
    async prompt({ requestId }) {
      const n = ++turn;
      feed({ type: 'event', event: { type: 'turn/start', data: { turn: n } } });
      feed({ type: 'event', event: { type: 'user/message', data: { source: { kind: 'user', rpcId: requestId } } } });
      if (autoEnd) feed({ type: 'event', event: { type: 'turn/end', data: { turn: n, reason: typeof nextReason === 'string' ? { kind: nextReason } : nextReason } } });
      promptReady?.();
      return { accepted: true };
    },
    cancel(request) { cancellations.push(request); return { accepted: true }; },
  };
  const service = createOfficialAgentService({ sessionController: controller }, {
    verifier: async projectId => ({ projectId, path: 'project' }),
    openProjectSessions: { ensure: async () => 'session' }, emit: emit || (async (_project, event) => { events.push(event); }),
    isArchived: archived,
  });
  return { service, controller, events, selections, cancellations,
    setReason: reason => { nextReason = reason; },
    hold: () => { autoEnd = false; },
    ready: () => new Promise(resolve => { promptReady = resolve; }),
    push: value => feed(value),
    end: reason => feed({ type: 'event', event: { type: 'turn/end', data: { turn, reason: typeof reason === 'string' ? { kind: reason } : reason } } }),
  };
}
const send = service => service.send('project1', { key: 'key', turnId: 'turn', text: 'hello' });

test('a terminal failed turn reports failure without permanently locking the project', async () => {
  const f = fixture();
  f.setReason('error');
  assert.equal((await send(f.service)).ok, false);
  assert.equal(f.events[0].kind, 'done');
  assert.equal(f.events[0].turnId, 'turn');
  assert.match(f.events[0].error, /error/);
  f.setReason('completed');
  assert.deepEqual(await send(f.service), { ok: true, stopReason: 'end_turn' });
});

test('model failure shows a safe status category without provider secrets', async () => {
  const f = fixture();
  f.setReason({ kind: 'error', error: { status: 401, code: 'SECRET_CODE', message: 'secret-token C:/private' } });
  const result = await send(f.service);
  assert.equal(result.ok, false);
  assert.match(result.error, /认证失败/);
  assert.doesNotMatch(result.error, /secret|private|SECRET/);
  assert.equal(f.events[0].error, result.error);
});

test('send does not overwrite an explicitly selected session model', async () => {
  const f = fixture();
  await f.service.selectModel('project1', { provider: 'p', model: 'chosen' });
  await send(f.service);
  assert.deepEqual(f.selections, [{ sessionId: 'session', provider: 'p', model: 'chosen' }]);
});

test('cancel calls DSH for the attributed live session and waits for terminal event', async () => {
  const f = fixture();
  f.hold();
  const ready = f.ready();
  const pending = send(f.service);
  await ready;
  // Allow the follow loop to consume attribution before cancelling.
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(await f.service.cancel('project1'), { ok: true });
  assert.deepEqual(f.cancellations, [{ sessionId: 'session' }]);
  f.end({ kind: 'aborted', reason: { kind: 'user' } });
  assert.deepEqual(await pending, { ok: true, stopReason: 'cancelled' });
  assert.equal(f.events[0].stopReason, 'cancelled');
  await assert.rejects(f.service.cancel('project1'), { code: 'OFFICIAL_AGENT_NOT_RUNNING' });
});

test('updates precede the bound terminal in the emitted stream', async () => {
  const f = fixture(); f.hold();
  const ready = f.ready(); const pending = send(f.service); await ready;
  f.push({ type: 'assistant-stream', frame: { type: 'start', turn: 1, step: 0, attemptId: 'a', revision: 0 } });
  f.push({ type: 'assistant-stream', frame: { type: 'chunk', attemptId: 'a', revision: 1, index: 0, chunk: { type: 'text-delta', index: 0, text: 'hello' } } });
  f.end('completed');
  await pending;
  assert.deepEqual(f.events.map(event => event.kind), ['update', 'done']);
  assert.deepEqual(f.events[1], { key: 'key', turnId: 'turn', kind: 'done', ok: true, stopReason: 'end_turn' });
});

test('unaccepted update fails explicitly and leaves unknown turn locked', async () => {
  const f = fixture({ emit: async () => false }); f.hold();
  const ready = f.ready(), pending = send(f.service); await ready;
  f.push({ type: 'assistant-stream', frame: { type: 'start', turn: 1, step: 0, attemptId: 'a', revision: 0 } });
  f.push({ type: 'assistant-stream', frame: { type: 'chunk', attemptId: 'a', revision: 1, index: 0, chunk: { type: 'text-delta', index: 0, text: 'hello' } } });
  await assert.rejects(pending, /No live event stream accepted/);
  await assert.rejects(send(f.service), { code: 'OFFICIAL_AGENT_BUSY' });
});

test('an unattributed prompt failure is retryable, an attributed one stays locked', async () => {
  // Nothing entered the session: locking here is what turned "no model" into a
  // permanently broken project.
  const failed = fixture();
  failed.controller.prompt = async () => { throw new Error('Model is not selected'); };
  await assert.rejects(send(failed.service), { code: 'OFFICIAL_AGENT_NOT_STARTED' });
  failed.controller.prompt = async () => { throw new Error('Model is not selected'); };
  await assert.rejects(send(failed.service), { code: 'OFFICIAL_AGENT_NOT_STARTED' });

  // The session did accept this exact prompt before the receipt was lost.
  const uncertain = fixture();
  uncertain.controller.prompt = async ({ requestId }) => {
    uncertain.push({ type: 'event', event: { type: 'turn/start', data: { turn: 1 } } });
    uncertain.push({ type: 'event', event: { type: 'user/message', data: { source: { kind: 'user', rpcId: requestId } } } });
    await new Promise(resolve => setTimeout(resolve, 10));
    throw new Error('receipt lost');
  };
  await assert.rejects(send(uncertain.service), /do not retry/);
  await assert.rejects(send(uncertain.service), { code: 'OFFICIAL_AGENT_BUSY' });
  const rejected = fixture();
  rejected.controller.prompt = async () => ({ accepted: false });
  await assert.rejects(send(rejected.service), { code: 'OFFICIAL_AGENT_ADMISSION' });
  await assert.rejects(send(rejected.service), { code: 'OFFICIAL_AGENT_ADMISSION' });
});

// Recorded shape: the prompt is announced through `agent/inbox/spliced` before
// turn/start exists, and a gated (archived) Session ends the turn as `blocked`
// without ever emitting `user/message`. That used to read as a protocol
// conflict and surface as 503 OFFICIAL_AGENT_NOT_STARTED.
test('a gated turn attributed through the inbox splice reports blocked, not a 503 conflict', async () => {
  const f = fixture();
  f.controller.prompt = async ({ requestId }) => {
    f.push({ type: 'event', event: { type: 'agent/inbox/spliced', data: { target: 'next-turn', inserted: [{ content: [{ type: 'text', text: 'hello' }], source: { kind: 'user', rpcId: requestId } }] } } });
    f.push({ type: 'event', event: { type: 'turn/start', data: { turn: 1 } } });
    f.push({ type: 'event', event: { type: 'turn/end', data: { turn: 1, reason: { kind: 'blocked' } } } });
    return { accepted: true };
  };
  const result = await send(f.service);
  assert.equal(result.ok, false);
  assert.match(result.error, /blocked/);
  assert.equal(f.events.at(-1).kind, 'done');
  // The project stays usable: a gated turn is terminal, not uncertain.
  f.controller.prompt = async ({ requestId }) => {
    f.push({ type: 'event', event: { type: 'turn/start', data: { turn: 2 } } });
    f.push({ type: 'event', event: { type: 'user/message', data: { source: { kind: 'user', rpcId: requestId } } } });
    f.push({ type: 'event', event: { type: 'turn/end', data: { turn: 2, reason: { kind: 'completed' } } } });
    return { accepted: true };
  };
  assert.deepEqual(await send(f.service), { ok: true, stopReason: 'end_turn' });
});

test('an archived conversation is refused before any prompt is admitted', async () => {
  const f = fixture({ archived: () => true });
  await assert.rejects(send(f.service), { code: 'OFFICIAL_AGENT_CONVERSATION_ARCHIVED' });
  // Nothing ran, so nothing is locked: restoring the conversation is enough.
  assert.equal(f.events.length, 0);
});

test('tool calls and results reach the panel as an ordered act pair', async () => {
  const f = fixture();
  f.hold();
  const ready = f.ready();
  const pending = send(f.service);
  await ready;
  f.push({ type: 'assistant-stream', frame: { type: 'start', turn: 1, step: 1, attemptId: 'a', revision: 0 } });
  f.push({ type: 'event', event: { type: 'tool/call', data: { turn: 1, step: 1, callId: 'c1', name: 'ops_glob', arguments: '{"pattern":["*"]}' } } });
  f.push({ type: 'event', event: { type: 'assistant/message', data: { turn: 1, step: 1, message: { role: 'assistant', content: [{ type: 'reasoning', text: '先看目录' }] } } } });
  f.push({ type: 'event', event: { type: 'tool/result', data: { turn: 1, step: 1, toolCallId: 'c1', message: { role: 'tool', toolCallId: 'c1', content: [{ type: 'text', text: 'a.md' }] } } } });
  f.end('completed');
  assert.deepEqual(await pending, { ok: true, stopReason: 'end_turn' });
  assert.deepEqual(f.events.filter(event => event.kind === 'update').map(event => event.update.sessionUpdate),
    ['tool_call', 'agent_thought_chunk', 'tool_call_update']);
  assert.equal(f.events.at(-1).kind, 'done');
});

// Recorded order on this machine: the prompt splice, turn/start, the queue
// removal, then the prompt's own `user/message` followed by the injected
// AGENTS.md block. The injected block is prompt assembly, not a second person.
test('injected workspace instructions do not count as a competing prompt', async () => {
  const f = fixture();
  f.controller.prompt = async ({ requestId }) => {
    f.push({ type: 'event', event: { type: 'agent/inbox/spliced', data: { target: 'next-turn', start: 0, inserted: [{ content: [{ type: 'text', text: '你好' }], source: { kind: 'user', rpcId: requestId }, role: 'user' }] } } });
    f.push({ type: 'event', event: { type: 'turn/start', data: { turn: 1 } } });
    f.push({ type: 'event', event: { type: 'agent/inbox/spliced', data: { target: 'next-turn', start: 0, removedCount: 1, inserted: [] } } });
    f.push({ type: 'event', event: { type: 'step/start', data: { turn: 1, step: 1 } } });
    f.push({ type: 'event', event: { type: 'user/message', data: { content: [{ type: 'text', text: '你好' }], source: { kind: 'user', rpcId: requestId }, role: 'user' } } });
    f.push({ type: 'event', event: { type: 'user/message', data: { content: [{ type: 'text', text: '<system-reminder>…' }], source: { kind: 'agent-instructions', form: 'instructions' }, role: 'user' } } });
    f.push({ type: 'event', event: { type: 'tool/call', data: { turn: 1, step: 1, callId: 'c1', name: 'ops_glob', arguments: '{}' } } });
    f.push({ type: 'event', event: { type: 'tool/result', data: { turn: 1, step: 1, toolCallId: 'c1', message: { role: 'tool', toolCallId: 'c1', content: [{ type: 'text', text: 'ok' }] } } } });
    f.push({ type: 'event', event: { type: 'turn/end', data: { turn: 1, reason: { kind: 'completed' } } } });
    return { accepted: true };
  };
  assert.deepEqual(await send(f.service), { ok: true, stopReason: 'end_turn' });
  assert.deepEqual(f.events.filter(event => event.kind === 'update').map(event => event.update.sessionUpdate), ['tool_call', 'tool_call_update']);
  // The project is not left locked by an event that was merely context.
  f.controller.prompt = async ({ requestId }) => {
    f.push({ type: 'event', event: { type: 'turn/start', data: { turn: 2 } } });
    f.push({ type: 'event', event: { type: 'user/message', data: { source: { kind: 'user', rpcId: requestId } } } });
    f.push({ type: 'event', event: { type: 'turn/end', data: { turn: 2, reason: { kind: 'completed' } } } });
    return { accepted: true };
  };
  assert.deepEqual(await send(f.service), { ok: true, stopReason: 'end_turn' });
});
