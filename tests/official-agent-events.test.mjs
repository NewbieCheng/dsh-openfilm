import test from 'node:test';
import assert from 'node:assert/strict';
import { createOfficialAgentEventState, translateOfficialAgentEvent, translateSessionEvent } from '../src/official-agent-events.mjs';

const base = { sessionId: 's1', turnId: 't1', turn: 1, key: 'k' };
const feed = (state, frame) => translateOfficialAgentEvent(state, { sessionId: 's1', turnId: 't1', frame: { type: 'assistant-stream', frame } });

test('a chunk whose start frame was missed is still delivered', () => {
  // A subscription that began mid-attempt never sees `start`; dropping its text
  // made a running model look idle.
  let state = createOfficialAgentEventState(base);
  const result = feed(state, { type: 'chunk', turn: 1, attemptId: 'a', revision: 4, index: 3, chunk: { type: 'text-delta', index: 0, text: '你好' } });
  state = result.state;
  assert.equal(result.events.length, 1);
  assert.equal(result.events[0].update.content.text, '你好');
  // The same index twice must not duplicate text.
  assert.equal(feed(state, { type: 'chunk', turn: 1, attemptId: 'a', revision: 5, index: 3, chunk: { type: 'text-delta', index: 0, text: '你好' } }).events.length, 0);
});

test('thinking deltas surface as thought updates', () => {
  let state = createOfficialAgentEventState(base);
  state = feed(state, { type: 'start', turn: 1, step: 0, attemptId: 'a', revision: 1 }).state;
  const thought = feed(state, { type: 'chunk', turn: 1, attemptId: 'a', revision: 2, index: 0, chunk: { type: 'reasoning-delta', text: '想一想' } });
  assert.equal(thought.events[0].update.sessionUpdate, 'agent_thought_chunk');
  const text = feed(thought.state, { type: 'chunk', turn: 1, attemptId: 'a', revision: 3, index: 1, chunk: { type: 'text-delta', index: 0, text: '答案' } });
  assert.equal(text.events[0].update.sessionUpdate, 'agent_message_chunk');
});

test('gaps and other turns never corrupt the stream', () => {
  let state = createOfficialAgentEventState(base);
  state = feed(state, { type: 'chunk', turn: 1, attemptId: 'a', revision: 2, index: 0, chunk: { type: 'text-delta', text: 'A' } }).state;
  // A later index is accepted (no strict consecutive rule) ...
  const later = feed(state, { type: 'chunk', turn: 1, attemptId: 'a', revision: 4, index: 5, chunk: { type: 'text-delta', text: 'B' } });
  assert.equal(later.events[0].update.content.text, 'B');
  // ... an older index is not replayed.
  assert.equal(feed(later.state, { type: 'chunk', turn: 1, attemptId: 'a', revision: 6, index: 2, chunk: { type: 'text-delta', text: 'C' } }).events.length, 0);
  // A start for another turn is ignored.
  assert.equal(feed(later.state, { type: 'start', turn: 2, step: 0, attemptId: 'b', revision: 1 }).events.length, 0);
  // Unknown chunk kinds update the cursor but emit nothing.
  const unknown = feed(later.state, { type: 'chunk', turn: 1, attemptId: 'a', revision: 7, index: 6, chunk: { type: 'tool-delta', text: 'x' } });
  assert.equal(unknown.events.length, 0);
});

test('a foreign session or turn is ignored entirely', () => {
  const state = createOfficialAgentEventState(base);
  const frame = { type: 'assistant-stream', frame: { type: 'chunk', turn: 1, attemptId: 'a', revision: 1, index: 0, chunk: { type: 'text-delta', text: 'x' } } };
  assert.equal(translateOfficialAgentEvent(state, { sessionId: 'other', turnId: 't1', frame }).events.length, 0);
  assert.equal(translateOfficialAgentEvent(state, { sessionId: 's1', turnId: 'other', frame }).events.length, 0);
});

// Durable events are the only complete tool lifecycle DSH publishes, and the
// committed thinking/text blocks are the fallback when nothing streamed.
const durable = (state, event) => translateSessionEvent(state, { sessionId: 's1', turnId: 't1', event });
const callEvent = (callId = 'c1', turn = 1) => ({ type: 'tool/call', data: { turn, step: 1, callId, name: 'ops_glob', arguments: '{"pattern":["*"]}' } });
const resultEvent = (callId = 'c1', turn = 1) => ({ type: 'tool/result', data: { turn, step: 1, toolCallId: callId, message: { role: 'tool', toolCallId: callId, content: [{ type: 'text', text: 'a.md' }] } } });

test('a tool call and its result become one act pair, never a duplicate', () => {
  let state = createOfficialAgentEventState(base);
  const called = durable(state, callEvent());
  state = called.state;
  assert.equal(called.events.length, 1);
  assert.equal(called.events[0].update.sessionUpdate, 'tool_call');
  assert.equal(called.events[0].update.toolCallId, 'c1');
  assert.equal(called.events[0].update.title, 'ops_glob');
  // rawInput must be an object: the shell takes the detail (pattern, path,
  // command) out of it and discards a string outright.
  assert.deepEqual(called.events[0].update.rawInput, { pattern: '*' });
  assert.equal(called.events[0].update.kind, 'search');
  // A repeated call (streamed and durable, or two frames) must not open a second card.
  assert.equal(durable(state, callEvent()).events.length, 0);

  const done = durable(state, resultEvent());
  state = done.state;
  assert.equal(done.events.length, 1);
  assert.equal(done.events[0].update.sessionUpdate, 'tool_call_update');
  assert.equal(done.events[0].update.status, 'completed');
  assert.equal(done.events[0].update.content[0].text, 'a.md');
  assert.equal(durable(state, resultEvent()).events.length, 0);
});

test('committed thinking and text fill in only when that step never streamed', () => {
  let state = createOfficialAgentEventState(base);
  const committed = { type: 'assistant/message', data: { turn: 1, step: 1, message: { role: 'assistant', content: [
    { type: 'reasoning', text: '先看目录' },
    { type: 'tool-call', id: 'c2', name: 'ops_read_files', arguments: '{"files":["a.md"]}' },
    { type: 'text', text: '读到了' },
  ] } } };
  const result = durable(state, committed);
  state = result.state;
  assert.deepEqual(result.events.map(event => event.update.sessionUpdate), ['agent_thought_chunk', 'agent_message_chunk', 'tool_call']);
  assert.equal(result.events[0].update.content.text, '先看目录');

  // Streaming already delivered step 2, so its durable copy stays silent.
  state = { ...state, textSteps: [2], thoughtSteps: [2] };
  const same = durable(state, { type: 'assistant/message', data: { turn: 1, step: 2, message: { role: 'assistant', content: [
    { type: 'reasoning', text: 'x' }, { type: 'text', text: 'y' },
  ] } } });
  assert.equal(same.events.length, 0);
});

test('durable events from another turn are ignored', () => {
  const state = createOfficialAgentEventState(base);
  assert.equal(durable(state, callEvent('c9', 2)).events.length, 0);
  assert.equal(durable(state, resultEvent('c9', 2)).events.length, 0);
});
