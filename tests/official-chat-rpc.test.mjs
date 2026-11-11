import test from 'node:test';
import assert from 'node:assert/strict';
import { createOfficialChatRpc } from '../src/official-chat-rpc.mjs';

function store() {
  const loaded = { revision: 2, sessions: [{ id: 's1' }], last: 's1', turns: [{ turn: { id: 't1' }, items: [] }] };
  const writes = [];
  return {
    writes,
    load: async () => loaded,
    saveSessions: async (...args) => { writes.push(['sessions', ...args]); return 3; },
    saveTurn: async (...args) => { writes.push(['turn', ...args]); return 3; },
  };
}

function rpc({ archived = false, available = true, fail, turnLog } = {}) {
  const fake = store();
  const dispatch = createOfficialChatRpc(fake, null, {
    ...(turnLog ? { turnLog } : {}),
    state: async projectId => {
      if (fail) throw new Error('unavailable');
      return { projectId, archived, available, sessionId: 'session-a' };
    },
    archive: async () => { archived = true; },
    unarchive: async () => { archived = false; },
  });
  return { fake, dispatch, isArchived: () => archived };
}

test('an archived conversation hides history but keeps its revision', async () => {
  const { dispatch } = rpc({ archived: true });
  const value = await dispatch('chat:load', { projectId: 'project1' });
  assert.deepEqual(value.sessions, []);
  assert.equal(value.last, null);
  assert.deepEqual(value.turns, []);
  assert.equal(value.archived, true);
  assert.equal(value.revision, 2);
});

test('an open conversation loads untouched and is marked not archived', async () => {
  const { dispatch } = rpc();
  const value = await dispatch('chat:load', { projectId: 'project1' });
  assert.equal(value.sessions.length, 1);
  assert.equal(value.archived, false);
});

test('writing to an archived conversation is refused with an actionable code', async () => {
  const { dispatch, fake } = rpc({ archived: true });
  await assert.rejects(dispatch('chat:save-turn', { projectId: 'project1', turn: { id: 't1' }, items: [], expectedRevision: 2 }),
    { code: 'OFFICIAL_CHAT_ARCHIVED' });
  await assert.rejects(dispatch('chat:save-sessions', { projectId: 'project1', sessions: [], last: null, expectedRevision: 2 }),
    { code: 'OFFICIAL_CHAT_ARCHIVED' });
  assert.equal(fake.writes.length, 0);
});

test('archive and unarchive go through the Host state, not renderer input', async () => {
  const { dispatch, isArchived } = rpc();
  assert.deepEqual(await dispatch('chat:archive-state', { projectId: 'project1' }), { archived: false, available: true, sessionId: 'session-a' });
  assert.deepEqual(await dispatch('chat:archive', { projectId: 'project1' }), { archived: true, available: true, sessionId: 'session-a' });
  assert.equal(isArchived(), true);
  assert.deepEqual(await dispatch('chat:unarchive', { projectId: 'project1' }), { archived: false, available: true, sessionId: 'session-a' });
});

test('untrusted payloads and broken state never expose details', async () => {
  const { dispatch } = rpc();
  await assert.rejects(dispatch('chat:load', {}), { code: 'OFFICIAL_CHAT_UNAVAILABLE' });
  await assert.rejects(dispatch('chat:save-turn', { projectId: 'project1', turn: 'x' }), { code: 'OFFICIAL_CHAT_UNAVAILABLE' });
  await assert.rejects(dispatch('chat:archive', { projectId: 'project1', sessionId: 'session-b' }), { code: 'OFFICIAL_CHAT_UNAVAILABLE' });
  const broken = rpc({ fail: true });
  await assert.rejects(broken.dispatch('chat:load', { projectId: 'project1' }), { code: 'OFFICIAL_CHAT_UNAVAILABLE' });
});
// The panel's trace tab reads a turn's log through this channel. It used to be
// refused outright (the tab existed but could never show a line).
test('a turn log comes back for a turn the Host watched, and nothing otherwise', async () => {
  const events = [
    { t: 1, kind: 'tool_call', title: 'openfilm_film', rawInput: { view: 'summary' } },
    { t: 2, kind: 'agent_message_chunk', content: { text: '你好' } },
  ];
  const seen = [];
  const watched = rpc({ turnLog: async (projectId, turnId) => { seen.push([projectId, turnId]); return turnId === 'local:1' ? { file: 'dsh-turn', cut: false, whole: true, events, calls: [], callsWhole: true, callsCut: false, at: { events: 2, calls: 0, callsFile: 0 } } : null; } });
  const log = await watched.dispatch('chat:log', { projectId: 'film123', turnId: 'local:1' });
  assert.equal(log.events.length, 2);
  assert.equal(log.whole, true);
  assert.deepEqual(seen[0], ['film123', 'local:1']);
  assert.equal(await watched.dispatch('chat:log', { projectId: 'film123', turnId: 'local:9' }), null);
});

test('without a turn log the channel stays refused rather than inventing one', async () => {
  const { dispatch } = rpc();
  await assert.rejects(() => dispatch('chat:log', { projectId: 'film123', turnId: 'local:1' }));
});