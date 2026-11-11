import test from 'node:test';
import assert from 'node:assert/strict';
import { attachApprovalBridge } from '../src/official-approval-bridge.mjs';
import { createOfficialApprovals } from '../src/official-approvals.mjs';

const project = 'film123';
const KEY = 'local:turn';

/**
 * A Context whose only power is triggering `approval/request` listeners, plus a
 * real coordinator with a fake panel transport. The timeout is short so a test
 * that deliberately leaves a question unanswered cannot hold the process open.
 */
function bridge({ live = true, bound = 'session-a', key = KEY } = {}) {
  const listeners = [];
  const delivered = [];
  const ctx = { on(name, handler) { listeners.push({ name, handler }); return () => {}; } };
  const approvals = createOfficialApprovals({
    deliver: (projectId, event) => {
      if (!live) return false;
      delivered.push({ projectId, event });
      return true;
    },
    timeoutMs: 50,
  });
  attachApprovalBridge(ctx, {
    approvals,
    deliver: (projectId, event) => {
      if (!live) return false;
      delivered.push({ projectId, event });
      return true;
    },
    projectOfSession: sessionId => (sessionId === bound ? project : undefined),
    keyOfProject: id => (id === project ? key : undefined),
  });
  const handler = listeners.find(entry => entry.name === 'approval/request')?.handler;
  const fire = (request, next = async () => 'unavailable') => handler(request, next);
  return { approvals, delivered, fire };
}

const ask = (sessionId = 'session-a') => ({ agent: { session: { id: sessionId } }, toolName: 'pwsh', callId: 'call-1' });
const withEnv = (options) => {
  const env = bridge(options);
  return { ...env, close: () => env.approvals.close() };
};

test('a conversation this Host does not own is delegated untouched', async t => {
  const env = withEnv();
  t.after(env.close);
  let asked = false;
  const outcome = await env.fire(ask('someone-else'), async () => { asked = true; return 'allowed-once'; });
  assert.equal(outcome, 'allowed-once');
  assert.equal(asked, true);
  assert.equal(env.delivered.length, 0);
});

test('the question reaches the panel as a permission card plus a visible notice', async t => {
  const env = withEnv();
  t.after(env.close);
  const pending = env.fire(ask());
  const card = env.delivered.find(entry => entry.event.kind === 'permission');
  assert.equal(card.projectId, project);
  assert.equal(card.event.key, KEY);
  assert.equal(card.event.params.toolCall.title, 'pwsh');
  assert.deepEqual(card.event.params.options.map(option => option.optionId), ['allow-once', 'reject-once']);
  const notice = env.delivered.find(entry => entry.event.update?.sessionUpdate === 'notice');
  assert.equal(notice.projectId, project);
  assert.match(notice.event.update.description, /等你决定/);

  // The panel answers; the DSH side of the waterfall is never asked.
  assert.equal(env.approvals.answerRequest({ projectId: project, key: KEY, requestId: card.event.requestId, optionId: 'allow-once' }), true);
  assert.equal(await pending, 'allowed-once');
});

test('a rejection travels just as far as an approval', async t => {
  const env = withEnv();
  t.after(env.close);
  const pending = env.fire(ask());
  const card = env.delivered.find(entry => entry.event.kind === 'permission');
  env.approvals.answerRequest({ projectId: project, key: KEY, requestId: card.event.requestId, optionId: 'reject-once' });
  assert.equal(await pending, 'rejected');
});

test('with no live panel the deployment still owns the decision', async t => {
  const env = withEnv({ live: false });
  t.after(env.close);
  let asked = 0;
  const outcome = await env.fire(ask(), async () => { asked += 1; return 'allowed-once'; });
  assert.equal(outcome, 'allowed-once');
  assert.equal(asked, 1);
});

test('the deployment answers first when it is quicker', async t => {
  const env = withEnv();
  t.after(env.close);
  assert.equal(await env.fire(ask(), async () => 'rejected'), 'rejected');
});

test('an approval outside any OpenFilm turn is never published', async t => {
  const listeners = [];
  const delivered = [];
  const ctx = { on(name, handler) { listeners.push(handler); return () => {}; } };
  const approvals = createOfficialApprovals({ deliver: (projectId) => { delivered.push(projectId); return true; }, timeoutMs: 50 });
  t.after(() => approvals.close());
  attachApprovalBridge(ctx, {
    approvals,
    deliver: (projectId, event) => { delivered.push({ projectId, event }); return true; },
    projectOfSession: () => project,
    // No active turn: there is no card to attach the question to.
    keyOfProject: () => undefined,
  });
  assert.equal(await listeners[0](ask(), async () => 'allowed-once'), 'allowed-once');
  assert.deepEqual(delivered, []);
});

test('a second answer for the same question is refused, not applied twice', async t => {
  const env = withEnv();
  t.after(env.close);
  const pending = env.fire(ask());
  const card = env.delivered.find(entry => entry.event.kind === 'permission');
  assert.equal(env.approvals.answerRequest({ projectId: project, key: KEY, requestId: card.event.requestId, optionId: 'allow-once' }), true);
  assert.equal(await pending, 'allowed-once');
  // A late click from the other window finds nothing pending.
  assert.equal(env.approvals.answerRequest({ projectId: project, key: KEY, requestId: card.event.requestId, optionId: 'reject-once' }), false);
});
