// The last mile without a browser: the real proxy, the real SSE stream and the
// real ACP service, driven exactly as the injected page does — open
// /__dsh/official-events, wait for `ready`, POST agent:prompt, read the updates
// and the terminal event off the stream. A stand-in child speaks ACP.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import test from 'node:test';
import { attachOfficialEventStream } from '../src/official-event-stream.mjs';
import { createOfficialEventHub } from '../src/official-event-hub.mjs';
import { createAcpAgentService } from '../src/acp-agent-service.mjs';
import { startStudioProxy } from '../src/studio-proxy.mjs';

const KEY = 'd'.repeat(48);
const PROJECT = 'proj123456';
const ORIGIN = 'http://127.0.0.1:5999';

const listen = server => new Promise((resolve, reject) => {
  server.once('error', reject);
  server.listen(0, '127.0.0.1', () => resolve(server.address().port));
});

/** Reads one SSE event (blank-line terminated) from a streaming response. */
function reader(body) {
  const decoder = new TextDecoder();
  const stream = body.getReader();
  let buffer = '';
  return async function next() {
    for (;;) {
      const split = buffer.indexOf('\n\n');
      if (split >= 0) {
        const frame = buffer.slice(0, split);
        buffer = buffer.slice(split + 2);
        const event = { event: '', data: '' };
        for (const line of frame.split('\n')) {
          if (line.startsWith('event: ')) event.event = line.slice(7);
          else if (line.startsWith('data: ')) event.data += line.slice(6);
        }
        // retry:/keep-alive frames carry no payload; the facade skips them too.
        if (!event.event && !event.data) continue;
        return { event: event.event || 'message', data: event.data };
      }
      const { value, done } = await stream.read();
      if (done) return null;
      buffer += decoder.decode(value, { stream: true }).replaceAll('\r\n', '\n');
    }
  };
}

function fakeChild() {
  let update = null;
  return {
    onUpdate(listener) { update = listener; },
    on() {},
    setPermissionHandler() {},
    async start() { return { agentCapabilities: { promptCapabilities: { image: false } } }; },
    async newSession() { return { sessionId: 'session-e2e', configOptions: [] }; },
    async resumeSession() { return { sessionId: 'session-e2e', configOptions: [] }; },
    async listSessions() { return { sessions: [] }; },
    async setConfigOption() { return { configOptions: [] }; },
    async prompt() {
      update?.({ sessionId: 'session-e2e', update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'hel' } } });
      update?.({ sessionId: 'session-e2e', update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'lo' } } });
      await new Promise(resolve => setTimeout(resolve, 10));
      return { stopReason: 'end_turn' };
    },
    async close() {},
    cancel() {},
  };
}

async function boot() {
  const editorUp = createServer((req, res) => { res.writeHead(200, { 'content-type': 'text/html' }); res.end('<html></html>'); });
  const filmUp = createServer((req, res) => { res.writeHead(200, { 'content-type': 'text/html' }); res.end(''); });
  const editorPort = await listen(editorUp);
  const filmPort = await listen(filmUp);
  const hub = createOfficialEventHub();
  const service = createAcpAgentService({
    verifier: async projectId => ({ projectId, path: 'C:\\fake' }),
    store: { get: () => undefined, set: () => {} },
    emit: (projectId, event) => hub.publish(projectId, event),
    createClient: () => fakeChild(),
  });
  const dispatch = async (channel, payload) => {
    if (channel === 'agent:prompt') return service.send(payload?.projectId, { key: payload?.key, turnId: payload?.turnId, text: payload?.text });
    throw Object.assign(new Error('unsupported'), { code: 'OFFICIAL_CHAT_UNAVAILABLE' });
  };
  const previous = process.env.NO996_OPENFILM_EDITOR_PORT;
  process.env.NO996_OPENFILM_EDITOR_PORT = '0';
  const proxy = await startStudioProxy({
    upstream: { origin: `http://127.0.0.1:${editorPort}`, filmOrigin: `http://localhost:${filmPort}`, key: KEY },
    authenticateBrowser: () => true,
    webOrigin: ORIGIN,
    officialShell: true,
    officialRpc: dispatch,
    authorizeOfficialProject: async () => true,
    attachOfficialEvents: ({ projectId, res }) => { attachOfficialEventStream({ hub, projectId, response: res }); },
  });
  if (previous === undefined) delete process.env.NO996_OPENFILM_EDITOR_PORT;
  else process.env.NO996_OPENFILM_EDITOR_PORT = previous;
  return {
    origin: proxy.bootstrapData().editorOrigin,
    async close() {
      await service.close();
      await proxy.close();
      await Promise.all([new Promise(r => editorUp.close(r)), new Promise(r => filmUp.close(r))]);
    },
  };
}

test('the panel wire: ready, updates under the panel key, then one terminal event', async (t) => {
  const studio = await boot();
  const abort = new AbortController();
  t.after(async () => { abort.abort(); await studio.close(); });
  const stream = await fetch(`${studio.origin}/__dsh/official-events?projectId=${PROJECT}`, {
    headers: { origin: studio.origin, 'sec-fetch-site': 'same-origin', accept: 'text/event-stream' },
    signal: abort.signal,
  });
  assert.equal(stream.status, 200);
  assert.match(stream.headers.get('content-type'), /text\/event-stream/);
  const next = reader(stream.body);
  assert.equal((await next()).event, 'ready');

  const response = await fetch(`${studio.origin}/__dsh/official-rpc`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: studio.origin, 'sec-fetch-site': 'same-origin' },
    body: JSON.stringify({ channel: 'agent:prompt', payload: { projectId: PROJECT, key: 'panel-key-1', turnId: 'turn-1', text: 'hi' } }),
  });
  assert.equal(response.status, 200);

  const events = [];
  for (let i = 0; i < 10; i += 1) {
    const event = await next();
    assert.ok(event, 'the stream must deliver every event of the turn');
    if (event.event === 'ready') continue;
    const value = JSON.parse(event.data);
    events.push(value);
    if (value.kind === 'done') break;
  }
  const updates = events.filter(event => event.kind === 'update');
  assert.ok(updates.length >= 2, 'both message chunks arrive');
  assert.ok(events.every(event => event.key === 'panel-key-1'), 'every envelope carries the panel key');
  const text = updates.map(event => event.update.content?.text ?? '').join('');
  assert.equal(text, 'hello');
  const done = events.at(-1);
  assert.equal(done.kind, 'done');
  assert.equal(done.turnId, 'turn-1');
  assert.equal(done.ok, true);
  assert.equal(done.stopReason, 'end_turn');
});

test('the same wire refuses a project the Host does not vouch for', async (t) => {
  const studio = await boot();
  t.after(() => studio.close());
  const response = await fetch(`${studio.origin}/__dsh/official-events?projectId=${PROJECT}`, {
    headers: { origin: 'http://evil.example', 'sec-fetch-site': 'same-origin' },
  });
  assert.equal(response.status, 403);
});
