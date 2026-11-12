// The ACP transport is the boundary the whole panel integration rests on, so it
// is tested against a stand-in agent that speaks the same wire protocol — never a
// real model (AGENTS §1: no real model calls in automated tests).
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { PassThrough, Writable } from 'node:stream';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { createAcpClient, resolveAcpCommand } from '../src/acp-client.mjs';

const fixture = fileURLToPath(new URL('./fixtures/fake-acp-agent.mjs', import.meta.url));

function startClient({ mode, timeoutMs = 5000 } = {}) {
  const client = createAcpClient({
    resolve: () => ({ command: process.execPath, args: [fixture] }),
    env: { ...process.env, ...(mode ? { FAKE_ACP_MODE: mode } : {}) },
    requestTimeoutMs: timeoutMs,
    promptTimeoutMs: timeoutMs,
    spawnChild: (command, args, options) => spawn(command, args, options),
  });
  return client;
}

test('the command defaults to the dsh acp profile the official shell uses', () => {
  const resolved = resolveAcpCommand({ env: {}, platform: 'linux' });
  assert.deepEqual(resolved.args, ['--profile', 'acp']);
  assert.equal(resolved.command, 'dsh');
  const override = resolveAcpCommand({ env: { NO996_OPENFILM_ACP_COMMAND: '/opt/dsh' }, platform: 'linux' });
  assert.equal(override.command, '/opt/dsh');
  assert.deepEqual(override.args, ['--profile', 'acp']);

  // Windows: prefer the shim shipped beside the desktop executable over a PATH lookup.
  const shipped = resolveAcpCommand({
    env: {},
    platform: 'win32',
    execPath: 'C:\\apps\\DSH\\DeepSeek Harness.exe',
    exists: candidate => /cli[\\/]bin[\\/]dsh\.cmd$/.test(candidate),
  });
  assert.match(shipped.command, /dsh\.cmd$/);
  assert.equal(shipped.shell, true);
  const plain = resolveAcpCommand({ env: {}, platform: 'win32', execPath: 'C:\\x\\x.exe', exists: () => false });
  assert.equal(plain.command, 'dsh');
});

test('initialize records the agent capabilities', async () => {
  const client = startClient();
  const capabilities = await client.start();
  assert.equal(capabilities.agentInfo.name, 'fake-acp');
  // ACP nests session capabilities under agentCapabilities (same shape the real
  // `dsh --profile acp` answered in the probe).
  assert.equal(capabilities.agentCapabilities.sessionCapabilities.resume !== undefined, true);
  await client.close();
});

test('a new session reports its config options, and sessions can be listed', async () => {
  const client = startClient();
  await client.start();
  const created = await client.newSession({ cwd: 'C:\\fake' });
  assert.equal(created.sessionId, 'session-fake-1');
  assert.equal(created.configOptions[0].id, 'model');
  const list = await client.listSessions();
  assert.deepEqual(list.sessions.map(s => s.sessionId), ['session-fake-1', 'session-fake-2']);
  await client.close();
});

test('a prompt streams updates and answers a permission request through the handler', async () => {
  const client = startClient();
  const updates = [];
  client.onUpdate(params => updates.push(params.update));
  const asked = [];
  client.setPermissionHandler(params => { asked.push(params.toolCall.title); return 'allow'; });
  await client.start();
  const outcome = await client.prompt({ sessionId: 'session-fake-1', blocks: [{ type: 'text', text: 'hi' }] });
  assert.equal(outcome.stopReason, 'end_turn');
  assert.deepEqual(updates.map(u => u.sessionUpdate), ['agent_thought_chunk', 'agent_message_chunk']);
  assert.deepEqual(asked, ['write']);
  await client.close();
});

test('a permission handler that refuses cancels the turn instead of stalling', async () => {
  const client = startClient();
  client.setPermissionHandler(() => null);
  await client.start();
  const outcome = await client.prompt({ sessionId: 'session-fake-1', blocks: [{ type: 'text', text: 'hi' }] });
  assert.equal(outcome.stopReason, 'cancelled');
  await client.close();
});

test('cancel is a notification the agent can hear', async () => {
  const client = startClient();
  const seen = [];
  client.onUpdate(params => seen.push(params));
  await client.start();
  assert.equal(client.cancel('session-fake-1'), true);
  await new Promise(resolve => setTimeout(resolve, 80));
  assert.equal(seen.length, 1);
  await client.close();
});

test('an agent that exits mid-request fails that request with a named code', async () => {
  const client = startClient({ mode: 'exit-on-prompt' });
  await client.start();
  await assert.rejects(client.prompt({ sessionId: 'session-fake-1', blocks: [] }), error => error.code === 'ACP_EXITED');
  await client.close();
});

test('a hung agent times out instead of hanging the panel', async () => {
  const client = startClient({ mode: 'hang-on-prompt', timeoutMs: 250 });
  await client.start();
  await assert.rejects(client.prompt({ sessionId: 'session-fake-1', blocks: [] }), error => error.code === 'ACP_TIMEOUT');
  await client.close();
});

test('requests after close are refused by name, not by crashing', async () => {
  const client = startClient();
  await client.start();
  await client.close();
  await assert.rejects(client.newSession({ cwd: 'C:\\fake' }), error => error.code === 'ACP_NOT_READY');
});

function fakeChild({ stdinFails = false, answer = false } = {}) {
  const child = new EventEmitter();
  let writes = 0;
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.stdin = new Writable({
    write(chunk, encoding, done) {
      if (stdinFails) return done(Object.assign(new Error('write EPIPE'), { code: 'EPIPE' }));
      writes += 1;
      if (answer && (answer === 'first' ? writes === 1 : true)) {
        child.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: JSON.parse(chunk).id, result: { agentInfo: { name: 'fake' } } }) + '\n');
      }
      done();
    },
  });
  child.kill = () => {};
  return child;
}

test('a dead pipe on stdin is logged, not an unhandled crash', async () => {
  const child = fakeChild({ stdinFails: true });
  const client = createAcpClient({
    resolve: () => ({ command: 'fake', args: [] }),
    env: {},
    requestTimeoutMs: 60,
    spawnChild: () => child,
    log: () => {},
  });
  // The write fails asynchronously on stdin. Before the guard this was an
  // unhandled 'error' event that killed the Host; now the call just times out.
  await assert.rejects(client.start(), error => error.code === 'ACP_TIMEOUT');
});

test('a prompt gets its own, much longer budget than control calls', async () => {
  const child = fakeChild({ answer: 'first' });
  const client = createAcpClient({
    resolve: () => ({ command: 'fake', args: [] }),
    env: {},
    requestTimeoutMs: 5000,
    promptTimeoutMs: 40,
    spawnChild: () => child,
  });
  await client.start();
  await assert.rejects(client.prompt({ sessionId: 's', blocks: [] }), error => error.code === 'ACP_TIMEOUT');
  // The control budget is untouched: an unanswered list is still waiting.
  let listed = 'pending';
  client.listSessions().then(() => { listed = 'resolved'; }, () => { listed = 'rejected'; });
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.equal(listed, 'pending');
  await client.close();
});
