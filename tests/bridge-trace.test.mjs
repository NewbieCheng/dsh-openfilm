import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createBridgeTrace } from '../src/bridge-trace.mjs';

const update = (name, extra = {}) => ({ key: 'dsh-key', kind: 'update', update: { sessionUpdate: name, ...extra } });

test('counts what was published and whether a live stream took it', () => {
  const trace = createBridgeTrace();
  trace.emit('project1', update('agent_thought_chunk'), true);
  trace.emit('project1', update('tool_call'), true);
  trace.emit('project1', update('tool_call_update'), false);
  const snapshot = trace.snapshot();
  assert.equal(snapshot.emitted, 3);
  assert.equal(snapshot.accepted, 2);
  assert.equal(snapshot.refused, 1);
  assert.equal(snapshot.lost, 1);
  assert.deepEqual(snapshot.kinds, { agent_thought_chunk: 1, tool_call: 1, tool_call_update: 1 });
});

test('an unrecognized or hostile sessionUpdate name never reaches the snapshot verbatim', () => {
  const trace = createBridgeTrace();
  trace.emit('project1', { key: 'k', kind: 'update', update: { sessionUpdate: 'bad name with spaces\n' } }, true);
  trace.emit('project1', { key: 'k', kind: 'update' }, true);
  trace.emit('project1', null, true);
  const snapshot = trace.snapshot();
  assert.deepEqual(snapshot.kinds, { unknown: 3 });
  assert.equal(snapshot.tail.length, 3);
});

test('the tail is bounded and keeps the newest envelopes', () => {
  const trace = createBridgeTrace({ limit: 3 });
  const names = ['ka', 'kb', 'kc', 'kd', 'ke', 'kf', 'kg', 'kh', 'ki', 'kj'];
  for (const name of names) trace.emit('project1', update(name), true);
  const snapshot = trace.snapshot();
  assert.equal(snapshot.tail.length, 3);
  assert.deepEqual(snapshot.tail.map(entry => entry.update), ['kh', 'ki', 'kj']);
});

test('a terminal event is recorded as done rather than as an update', () => {
  const trace = createBridgeTrace();
  trace.emit('project1', { key: 'dsh-key', kind: 'done', ok: true, stopReason: 'end_turn', turnId: 't1' }, true);
  assert.equal(trace.snapshot().tail[0].kind, 'done');
  assert.equal(trace.snapshot().tail[0].update, 'unknown');
});

test('panel counters are validated, clamped and kept per project', () => {
  const trace = createBridgeTrace();
  assert.equal(trace.panel('project1', { seen: 4, kinds: { tool_call: 2, 'bad key': 1, agent_message_chunk: 'x' } }), true);
  assert.equal(trace.panel('project2', { seen: -1 }), false);
  assert.equal(trace.panel('project2', { seen: 1.5 }), false);
  assert.equal(trace.panel(null, { seen: 1 }), false);
  const snapshot = trace.snapshot();
  assert.deepEqual(snapshot.panel.project1.seen, 4);
  assert.deepEqual(snapshot.panel.project1.kinds, { tool_call: 2 });
  assert.equal(snapshot.panel.project2, undefined);
});

test('a closed trace stops recording but still answers with its last state', () => {
  const trace = createBridgeTrace();
  trace.emit('project1', update('tool_call'), true);
  trace.close();
  trace.emit('project1', update('tool_call'), true);
  trace.panel('project1', { seen: 3 });
  const snapshot = trace.snapshot();
  assert.equal(snapshot.emitted, 1);
  assert.equal(snapshot.panel.project1, undefined);
});

test('the limit is validated so a caller cannot disable the bound', () => {
  assert.throws(() => createBridgeTrace({ limit: 0 }), RangeError);
  assert.throws(() => createBridgeTrace({ limit: 41 }), RangeError);
  assert.throws(() => createBridgeTrace({ limit: 1.5 }), RangeError);
});
