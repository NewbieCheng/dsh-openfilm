import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createOfficialEventHub } from '../src/official-event-hub.mjs';
import { attachOfficialEventStream } from '../src/official-event-stream.mjs';

class Response extends EventEmitter {
  chunks = [];
  writableEnded = false;
  full = false;
  writeHead() {}
  write(chunk) {
    if (this.writableEnded) return false;
    // Node accepts the chunk and reports backpressure; it never drops bytes.
    if (this.full) { this.chunks.push(chunk); return false; }
    this.chunks.push(chunk);
    return true;
  }
  end() { this.writableEnded = true; }
}
const dataEvents = response => response.chunks
  .filter(chunk => typeof chunk === 'string' && chunk.startsWith('data: '))
  .map(chunk => JSON.parse(chunk.slice(6).trim()));

test('hub writes updates and terminal in SSE order on the same connection', () => {
  const hub = createOfficialEventHub(), response = new Response();
  const close = attachOfficialEventStream({ hub, projectId: 'project1', response });
  assert.equal(hub.publish('project1', { key: 'key', kind: 'update', update: { text: 'hello' } }), true);
  assert.equal(hub.publish('project1', { key: 'key', turnId: 'turn', kind: 'done', ok: true, stopReason: 'end_turn' }), true);
  const events = dataEvents(response);
  assert.deepEqual(events.map(event => event.kind), ['update', 'done']);
  assert.equal(events[1].turnId, 'turn');
  // The browser reconnects on its own; we only supply the delay hint.
  assert.match(response.chunks[0], /^retry: 3000/);
  close();
  assert.equal(hub.publish('project1', { kind: 'update' }), false);
});

test('backpressure queues frames instead of killing a live turn', () => {
  const hub = createOfficialEventHub(), response = new Response();
  const close = attachOfficialEventStream({ hub, projectId: 'project1', response });
  response.full = true; // the socket buffer is full, the client is still there
  assert.equal(hub.publish('project1', { key: 'k', kind: 'update', update: { seq: 1 } }), true);
  assert.equal(hub.publish('project1', { key: 'k', kind: 'update', update: { seq: 2 } }), true);
  assert.equal(hub.publish('project1', { key: 'k', kind: 'done', ok: true, stopReason: 'end_turn' }), true);
  assert.equal(response.writableEnded, false, 'a slow socket must not be treated as a disconnect');
  // Node already buffered the first chunk; only the return value signalled
  // backpressure, so exactly one frame is out and the rest wait for drain.
  assert.equal(dataEvents(response).length, 1);

  // The socket drains: every queued frame is flushed in order, terminal last.
  response.full = false;
  response.emit('drain');
  assert.deepEqual(dataEvents(response).map(event => event.kind), ['update', 'update', 'done']);
  assert.deepEqual(dataEvents(response).map(event => event.update?.seq ?? null), [1, 2, null]);
  close();
});

test('a backlog over the hard cap closes instead of growing forever', () => {
  const hub = createOfficialEventHub(), response = new Response();
  const close = attachOfficialEventStream({ hub, projectId: 'project1', response });
  response.full = true;
  let accepted = 0;
  for (let i = 0; i < 5000; i++) if (hub.publish('project1', { key: 'k', kind: 'update', update: { i } }) === true) accepted++;
  assert.ok(accepted < 5000, 'an unbounded dead reader must stop being accepted');
  assert.equal(response.writableEnded, true);
  close();
});
