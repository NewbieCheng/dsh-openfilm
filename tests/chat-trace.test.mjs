// The trace exists so "the panel shows nothing" can be answered with evidence:
// did the child send it, did the Host publish it, did the page count it.
import assert from 'node:assert/strict';
import test from 'node:test';
import { createChatTrace, describeEvent } from '../src/chat-trace.mjs';

test('tracing is off unless asked, and then writes shape only', () => {
  const off = createChatTrace({ env: {} });
  assert.equal(off.enabled, false);
  off.record('abcdef', { kind: 'update', update: { sessionUpdate: 'agent_thought_chunk', content: { type: 'text', text: 'secret' } } });

  const lines = [];
  const on = createChatTrace({ env: { NO996_OPENFILM_TRACE: '1' }, write: (_file, line) => lines.push(line) });
  assert.equal(on.enabled, true);
  on.record('abcdef', { kind: 'update', update: { sessionUpdate: 'agent_thought_chunk', content: { type: 'text', text: 'secret' } } });
  assert.equal(lines.length, 1);
  const parsed = JSON.parse(lines[0]);
  assert.equal(parsed.kind, 'agent_thought_chunk');
  assert.equal(parsed.chars, 6);
  assert.ok(!lines[0].includes('secret'), 'the model text never reaches the trace file');
});

test('a bad project id writes nothing, and a write error cannot break a turn', () => {
  const lines = [];
  const trace = createChatTrace({ env: { NO996_OPENFILM_TRACE: '1' }, write: () => { throw new Error('disk full'); } });
  trace.record('has space', { kind: 'done', ok: true, stopReason: 'end_turn' });
  assert.equal(lines.length, 0);
  assert.equal(trace.path('has space'), null);
  assert.equal(trace.path('abcdef'), trace.path('abcdef'));
});

test('done and tool updates describe themselves', () => {
  assert.deepEqual(describeEvent({ kind: 'done', ok: true, stopReason: 'end_turn' }), { kind: 'done', ok: true, stop: 'end_turn' });
  assert.deepEqual(describeEvent({ kind: 'update', update: { sessionUpdate: 'tool_call', title: 'openfilm_draft', status: 'pending' } }),
    { kind: 'tool_call', title: 'openfilm_draft', status: 'pending' });
  assert.deepEqual(describeEvent(null), { kind: 'unknown' });
});
