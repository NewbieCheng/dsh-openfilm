import test from 'node:test';
import assert from 'node:assert/strict';
import { createOfficialAgentEventState, translateOfficialAgentEvent } from '../src/official-agent-events.mjs';

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
