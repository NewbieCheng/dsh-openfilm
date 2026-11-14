// Orchestration for deleting one OpenFilm project from the sidebar. It lives
// outside the HTTP route so the order — stop the ACP child, move the folder,
// then forget chat/binding — is unit-testable with fakes. The folder move is the
// point of no return: if it fails, nothing else is touched.
const failure = (code, message, cause) => Object.assign(new Error(message), { code, ...(cause ? { cause } : {}) });

export function createEditingProjectDelete({
  verifyProject, acpSessions, editingPrefs, officialStore, archive, trash, reset, log,
} = {}) {
  return async function deleteEditingProject(projectId, { permanent = false } = {}) {
    let identity;
    try { identity = await verifyProject(projectId); }
    catch (cause) { throw failure('UNKNOWN_PROJECT', 'Studio does not know this project', cause); }
    const record = acpSessions.get(projectId);
    const sessionIds = new Set();
    if (record && typeof record.sessionId === 'string') sessionIds.add(record.sessionId);
    try {
      const store = await officialStore();
      const data = await store.load(projectId);
      for (const session of Array.isArray(data?.sessions) ? data.sessions : []) {
        if (typeof session?.id === 'string') sessionIds.add(session.id);
      }
    } catch { /* a project without a chat record is still deletable */ }
    // Stop the ACP child before touching its cwd; on Windows an open file can
    // otherwise turn the rename into a lock error.
    try { await reset?.(projectId); } catch { /* best effort */ }
    const discarded = await trash.discard(identity.path, { permanent });
    try {
      const store = await officialStore();
      await store.remove(projectId);
    } catch { /* the orphaned record is unreachable once the folder is gone */ }
    acpSessions.remove(projectId);
    editingPrefs.remove(projectId);
    for (const sessionId of sessionIds) {
      try {
        if (archive.available && archive.isArchived(sessionId) !== true) await archive.archive(sessionId, { stopActivity: true });
      } catch { /* DSH owns its Session files; archiving is best effort */ }
    }
    void log?.info?.('editing-project-deleted', {
      projectId, permanent, sessions: sessionIds.size, trashed: typeof discarded.trashPath === 'string',
    });
    return { projectId, permanent, trashPath: discarded.trashPath ?? null, sessions: sessionIds.size };
  };
}
