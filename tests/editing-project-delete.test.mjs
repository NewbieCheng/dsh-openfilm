// Deleting a project must move the folder first and only then forget its chat
// and binding; a locked folder must leave everything (including chat) intact.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createEditingProjectDelete } from '../src/editing-project-delete.mjs';

function harness(over = {}) {
  const calls = [];
  const store = {
    load: async () => ({ sessions: [{ id: 'sess-bbbbbb' }, { id: 'sess-aaaaaa' }] }),
    remove: async id => { calls.push(['remove', id]); },
  };
  const deps = {
    verifyProject: async id => ({ projectId: id, path: 'C:\\Films\\proj' }),
    acpSessions: {
      get: () => ({ sessionId: 'sess-aaaaaa' }),
      remove: id => { calls.push(['unbind', id]); },
    },
    editingPrefs: { remove: id => { calls.push(['prefs', id]); } },
    officialStore: async () => store,
    archive: {
      available: true,
      isArchived: id => id === 'sess-aaaaaa',
      archive: async id => { calls.push(['archive', id]); },
    },
    trash: {
      discard: async (path, options) => {
        calls.push(['discard', path, options.permanent]);
        return { trashPath: 'C:\\Films\\.no996-trash\\proj-1' };
      },
    },
    reset: async id => { calls.push(['reset', id]); },
    log: { info: () => calls.push(['log']) },
    ...over,
  };
  return { calls, deps };
}

test('stops ACP, moves the folder, then forgets chat/binding/archive once', async () => {
  const { calls, deps } = harness();
  const result = await createEditingProjectDelete(deps)('proj123456', {});
  assert.deepEqual(calls, [
    ['reset', 'proj123456'],
    ['discard', 'C:\\Films\\proj', false],
    ['remove', 'proj123456'],
    ['unbind', 'proj123456'],
    ['prefs', 'proj123456'],
    ['archive', 'sess-bbbbbb'],
    ['log'],
  ]);
  assert.deepEqual(result, {
    projectId: 'proj123456', permanent: false,
    trashPath: 'C:\\Films\\.no996-trash\\proj-1', sessions: 2,
  });
});

test('a locked folder aborts before any chat, binding or preference is touched', async () => {
  const { calls, deps } = harness({
    trash: { discard: async () => { throw Object.assign(new Error('locked'), { code: 'PROJECT_BUSY' }); } },
  });
  await assert.rejects(createEditingProjectDelete(deps)('proj123456', {}), { code: 'PROJECT_BUSY' });
  assert.deepEqual(calls, [['reset', 'proj123456']]);
});

test('an unknown project is refused without touching anything', async () => {
  const { calls, deps } = harness({
    verifyProject: async () => { throw new Error('missing'); },
  });
  await assert.rejects(createEditingProjectDelete(deps)('proj123456', {}), { code: 'UNKNOWN_PROJECT' });
  assert.deepEqual(calls, []);
});

test('a missing chat store still deletes and archives the binding', async () => {
  const { calls, deps } = harness({
    officialStore: async () => { throw new Error('store down'); },
    archive: { available: true, isArchived: () => false, archive: async id => { calls.push(['archive', id]); } },
  });
  const result = await createEditingProjectDelete(deps)('proj123456', { permanent: true });
  assert.equal(result.permanent, true);
  assert.deepEqual(calls, [
    ['reset', 'proj123456'],
    ['discard', 'C:\\Films\\proj', true],
    ['unbind', 'proj123456'],
    ['prefs', 'proj123456'],
    ['archive', 'sess-aaaaaa'],
    ['log'],
  ]);
});
