import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createOfficialEventHub } from '../src/official-event-hub.mjs';
import { attachOfficialEventStream } from '../src/official-event-stream.mjs';

class Response extends EventEmitter {
  chunks = [];
  writeHead() {}
  write(chunk) { this.chunks.push(chunk); return true; }
  end() { this.writableEnded = true; }
}

test('hub writes updates and terminal in SSE order on the same connection', () => {
  const hub = createOfficialEventHub(), response = new Response();
  const close = attachOfficialEventStream({ hub, projectId: 'project1', response });
  assert.equal(hub.publish('project1', { key: 'key', kind: 'update', update: { text: 'hello' } }), true);
  assert.equal(hub.publish('project1', { key: 'key', turnId: 'turn', kind: 'done', ok: true, stopReason: 'end_turn' }), true);
  const events = response.chunks.slice(1).map(chunk => JSON.parse(chunk.slice(6).trim()));
  assert.deepEqual(events.map(event => event.kind), ['update', 'done']);
  assert.equal(events[1].turnId, 'turn');
  close();
  assert.equal(hub.publish('project1', { kind: 'update' }), false);
});

test('backpressure disconnects rather than silently accepting later frames', () => {
  const hub = createOfficialEventHub(), response = new Response();
  const close = attachOfficialEventStream({ hub, projectId: 'project1', response });
  response.write = () => false;
  assert.equal(hub.publish('project1', { kind: 'update' }), false);
  assert.equal(response.writableEnded, true);
  assert.equal(hub.publish('project1', { kind: 'done' }), false);
  close();
});
