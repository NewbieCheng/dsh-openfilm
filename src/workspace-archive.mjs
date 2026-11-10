/**
 * Host-only view of DSH's durable archive set.
 *
 * Archiving is a Workspace-registry fact, not a Session-header field:
 * `sessionController.list()` has no archived flag, while
 * `workspaceController.follow()` streams `archivedSessionIds` and
 * `archiveSession`/`unarchiveSession` mutate exactly that set. The set is also
 * what the `agent/pre-step` gate reads, so an archived Session ends every new
 * turn as `blocked` — which is why the video bridge must consult this before it
 * sends anything.
 *
 * This module owns one subscription and one Set; it never invents a second
 * record of "archived" and never deletes a Session.
 */
const ID = /^[A-Za-z0-9_-]{8,120}$/;
const failure = (code, message) => Object.assign(new Error(message), { code });

function archiveSet(value) {
  const ids = new Set();
  if (Array.isArray(value)) for (const id of value) if (typeof id === 'string' && ID.test(id)) ids.add(id);
  return ids;
}

/**
 * @param ctx Host context. `workspaceController` is optional: profiles without
 *   it still load the plugin, but archive awareness is reported as unavailable
 *   instead of guessed.
 * @returns frozen capability object; `available` is false when the service is
 *   missing and every mutation rejects with ARCHIVE_UNAVAILABLE.
 */
export function createArchiveWatcher(ctx) {
  const controller = typeof ctx?.get === 'function' ? ctx.get('workspaceController') : undefined;
  const usable = controller && typeof controller.follow === 'function' &&
    typeof controller.archiveSession === 'function' && typeof controller.unarchiveSession === 'function';
  if (!usable) {
    return Object.freeze({
      available: false,
      // Unknown is not "live": callers must not treat a missing service as proof
      // that a Session is open. They may still send and rely on DSH's own gate.
      isArchived: () => false,
      state: () => 'unknown',
      archivedIds: () => [],
      subscribe: () => () => {},
      archive: async () => { throw failure('ARCHIVE_UNAVAILABLE', 'The Workspace registry is not available'); },
      unarchive: async () => { throw failure('ARCHIVE_UNAVAILABLE', 'The Workspace registry is not available'); },
      ready: Promise.resolve(false),
      close: () => {},
    });
  }

  const ids = new Set();
  const listeners = new Set();
  const abort = new AbortController();
  let closed = false;
  let known = false;
  let resolveReady;
  const ready = new Promise(resolve => { resolveReady = resolve; });

  const publish = () => {
    for (const listener of [...listeners]) {
      try { listener(); } catch { /* one closed view */ }
    }
  };
  const replace = next => {
    ids.clear();
    for (const id of next) ids.add(id);
    known = true;
    publish();
  };
  const settle = value => { const resolve = resolveReady; resolveReady = undefined; resolve?.(value); };

  (async () => {
    try {
      for await (const frame of controller.follow(abort.signal)) {
        if (closed) break;
        if (!frame || typeof frame !== 'object') continue;
        // `baseline` and `replace` carry the complete filtered state; `archived`
        // carries the complete archive set after one mutation.
        if (frame.type === 'baseline' || frame.type === 'replace') replace(archiveSet(frame.value?.archivedSessionIds));
        else if (frame.type === 'archived') replace(archiveSet(frame.archivedSessionIds));
        settle(true);
      }
    } catch {
      // A closed or replaced stream keeps the last known set: losing the
      // subscription must not read as "nothing is archived".
    }
    settle(false);
  })();

  const check = sessionId => {
    if (typeof sessionId !== 'string' || !ID.test(sessionId)) throw failure('ARCHIVE_INPUT', 'A Session ID is required');
  };

  return Object.freeze({
    available: true,
    ready,
    isArchived: sessionId => typeof sessionId === 'string' && ids.has(sessionId),
    state: sessionId => (!known ? 'unknown' : ids.has(sessionId) ? 'archived' : 'live'),
    archivedIds: () => [...ids],
    subscribe(listener) {
      if (typeof listener !== 'function') return () => {};
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    async archive(sessionId, { stopActivity = false } = {}) {
      check(sessionId);
      if (closed) throw failure('ARCHIVE_CLOSED', 'The archive subscription is closed');
      const value = await controller.archiveSession({ sessionId, ...(stopActivity ? { stopActivity: true } : {}) });
      const next = archiveSet(value?.archivedSessionIds);
      // An older Host may omit the set; never report a mutation we cannot see.
      if (next.size === 0) { ids.add(sessionId); known = true; publish(); }
      else replace(next);
      return { archived: true, archivedIds: [...ids] };
    },
    async unarchive(sessionId) {
      check(sessionId);
      if (closed) throw failure('ARCHIVE_CLOSED', 'The archive subscription is closed');
      const value = await controller.unarchiveSession({ sessionId });
      const next = archiveSet(value?.archivedSessionIds);
      if (next.size === 0) { ids.delete(sessionId); known = true; publish(); }
      else replace(next);
      return { archived: false, archivedIds: [...ids] };
    },
    close() {
      if (closed) return;
      closed = true;
      abort.abort();
      listeners.clear();
    },
  });
}
