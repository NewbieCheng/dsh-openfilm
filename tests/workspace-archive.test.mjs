import test from 'node:test';
import assert from 'node:assert/strict';
import { createArchiveWatcher } from '../src/workspace-archive.mjs';

/** A Workspace controller stand-in: one follow stream plus two mutations. */
function fakeController(initial = []) {
  const archived = new Set(initial);
  const queue = [];
  let wake;
  const calls = [];
  return {
    archived, calls,
    emit(frame) { queue.push(frame); const resume = wake; wake = undefined; resume?.(); },
    controller: {
      follow(signal) {
        return {
          [Symbol.asyncIterator]() { return this; },
          async next() {
            if (signal.aborted) return { done: true };
            if (!queue.length) await new Promise(resolve => { wake = resolve; signal.addEventListener('abort', resolve, { once: true }); });
            if (signal.aborted) return { done: true };
            return { value: queue.shift(), done: false };
          },
        };
      },
      async archiveSession(request) {
        calls.push(['archive', request]);
        archived.add(request.sessionId);
        return { archivedSessionIds: [...archived] };
      },
      async unarchiveSession(request) {
        calls.push(['unarchive', request]);
        archived.delete(request.sessionId);
        return { archivedSessionIds: [...archived] };
      },
    },
  };
}
const ctxFor = controller => ({ get: name => (name === 'workspaceController' ? controller : undefined) });
const tick = () => new Promise(resolve => setImmediate(resolve));

test('the live archive set is unknown until the baseline arrives, then exact', async () => {
  const fake = fakeController();
  const watcher = createArchiveWatcher(ctxFor(fake.controller));
  assert.equal(watcher.available, true);
  // Unknown is not "live": callers must not read the absence of a baseline as proof.
  assert.equal(watcher.state('session-a'), 'unknown');
  fake.emit({ type: 'baseline', value: { items: [], archivedSessionIds: ['session-a'], pinnedSessionIds: [] } });
  await watcher.ready;
  assert.equal(watcher.isArchived('session-a'), true);
  assert.equal(watcher.state('session-b'), 'live');
  assert.deepEqual(watcher.archivedIds(), ['session-a']);
  watcher.close();
});

test('archive and unarchive mutate through DSH and republish the set', async () => {
  const fake = fakeController();
  const watcher = createArchiveWatcher(ctxFor(fake.controller));
  fake.emit({ type: 'baseline', value: { items: [], archivedSessionIds: [], pinnedSessionIds: [] } });
  await watcher.ready;

  assert.deepEqual(await watcher.archive('session-c', { stopActivity: true }), { archived: true, archivedIds: ['session-c'] });
  assert.deepEqual(fake.calls[0], ['archive', { sessionId: 'session-c', stopActivity: true }]);
  assert.equal(watcher.isArchived('session-c'), true);

  assert.deepEqual(await watcher.unarchive('session-c'), { archived: false, archivedIds: [] });
  assert.deepEqual(fake.calls[1], ['unarchive', { sessionId: 'session-c' }]);
  assert.equal(watcher.isArchived('session-c'), false);

  await assert.rejects(watcher.archive(''), { code: 'ARCHIVE_INPUT' });
  watcher.close();
});

test('a Host without the Workspace registry reports the capability as unavailable', async () => {
  const watcher = createArchiveWatcher({ get: () => undefined });
  assert.equal(watcher.available, false);
  // Never claim a Session is open when the set cannot be read.
  assert.equal(watcher.state('session-a'), 'unknown');
  assert.equal(watcher.isArchived('session-a'), false);
  await assert.rejects(watcher.archive('session-a'), { code: 'ARCHIVE_UNAVAILABLE' });
  assert.equal(await watcher.ready, false);
  watcher.close();
});

test('a replace frame reflects a filtered view without inventing entries', async () => {
  const fake = fakeController(['session-a', 'session-z']);
  const watcher = createArchiveWatcher(ctxFor(fake.controller));
  fake.emit({ type: 'baseline', value: { items: [], archivedSessionIds: ['session-a', 'session-z'], pinnedSessionIds: [] } });
  await watcher.ready;
  fake.emit({ type: 'replace', value: { items: [], archivedSessionIds: ['session-z'], pinnedSessionIds: [] } });
  await tick();
  assert.deepEqual(watcher.archivedIds(), ['session-z']);
  watcher.close();
});
