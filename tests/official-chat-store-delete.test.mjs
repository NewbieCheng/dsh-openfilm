// Deleting a conversation in the panel is only real if the Host forgets its turns too.
//
// The chat removes the session from the list it saves; this store must drop every
// turn that belonged to a session the saved list no longer names — otherwise a
// deleted conversation keeps its bytes on disk forever and a later read hands them
// back to a list that no longer contains it.
import test from 'node:test';
import assert from 'node:assert/strict';
import { openOfficialChatStore } from '../src/official-chat-store.mjs';

const chain = () => ({ min: chain, max: chain, regex: chain, strict: chain, optional: () => chain });
const z = { object: chain, string: chain, array: chain, literal: chain, unknown: chain };

const projectPath = 'C:\\Films\\demo';
const identity = async projectId => ({ projectId, path: projectPath });
const turn = (id, sessionId) => ({ turn: { id, sessionId, createdAt: '2026-01-01T00:00:00.000Z', status: 'done' }, items: [] });

function stored() {
  return {
    version: 1,
    revision: 3,
    sessions: [{ id: 's1' }, { id: 's2' }],
    last: 's2',
    turns: [turn('t1', 's1'), turn('t2', 's2')],
  };
}

async function open({ failWrite = false } = {}) {
  let record = { projectId: 'proj123', path: projectPath, data: JSON.stringify(stored()) };
  const ctx = {
    storageDomain: {
      async open() {
        return {
          table: () => ({
            get: () => record,
            put: async (key, value) => {
              if (failWrite) throw new Error('disk full');
              record = value;
            },
            delete: async () => { record = undefined; },
          }),
          close: async () => {},
        };
      },
    },
  };
  const store = await openOfficialChatStore(ctx, { z, requireVerifiedProject: identity });
  return { store, record: () => record };
}

test('removing a project drops its chat record without re-verifying a deleted folder', async () => {
  const { store, record } = await open();
  await store.remove('proj123');
  assert.equal(record(), undefined);
  // Idempotent: the second call is a no-op, not an error.
  await store.remove('proj123');
  const loaded = await store.load('proj123');
  assert.deepEqual(loaded.sessions, []);
});

test('saving a list without a conversation drops that conversation\'s turns', async () => {
  const { store, record } = await open();
  const revision = await store.saveSessions('proj123', {
    sessions: [{ id: 's2' }], last: 's2', expectedRevision: 3,
  });
  assert.equal(revision, 4);
  const loaded = await store.load('proj123');
  assert.deepEqual(loaded.sessions.map(s => s.id), ['s2']);
  assert.deepEqual(loaded.turns.map(e => e.turn.id), ['t2'], 'a deleted conversation keeps no turn behind');
  const persisted = JSON.parse(record().data);
  assert.deepEqual(persisted.turns.map(e => e.turn.id), ['t2'], 'and the record on disk was rewritten');
});
