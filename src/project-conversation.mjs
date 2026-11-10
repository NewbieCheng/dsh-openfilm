import path from 'node:path';

export const PROJECT_CONVERSATIONS_DOMAIN = 'no996_openfilm_project_conversations';

const error = (code, message) => Object.assign(new Error(message), { code });
const ID = /^[A-Za-z0-9_-]{6,40}$/;

/**
 * One DSH Session per OpenFilm project, resolved without a two-phase registry.
 *
 * The DSH Session remains the single source of truth: this module only keeps a
 * replaceable hint. Replacing the hint is always a fallback to a new empty
 * conversation, never a claim on someone else's Session. Nothing is deleted,
 * no Session is renamed, and a failed hint write is not an error. `path` must
 * come from the Host's own upstream project lookup, never from a web page.
 *
 * An archived Session is still the project's Session: the hint is kept and the
 * binding is reported as archived instead of silently creating a duplicate.
 * `rebind` is the only way to move a project to a new conversation, and it
 * leaves the archived Session and its history untouched.
 */
export async function openProjectConversations(ctx, { z, archived } = {}) {
  if (!ctx?.storageDomain?.open || !ctx?.sessionController?.create || !ctx?.sessionController?.list || !z?.object) {
    throw error('PROJECT_CONVERSATION_DEPENDENCY', 'storageDomain, sessionController and Zod are required');
  }
  const isArchived = typeof archived === 'function' ? archived : () => false;
  const record = z.object({
    projectId: z.string().regex(ID), path: z.string().min(1), sessionId: z.string().min(1),
  }).strict();
  const domain = await ctx.storageDomain.open({
    name: PROJECT_CONVERSATIONS_DOMAIN,
    version: 1,
    layout: 'per-record',
    tables: { projects: { valueSchema: record } },
  });
  const table = domain.table('projects');
  const live = new Map();
  const inFlight = new Map();
  let closing = false;
  let closePromise;

  function remember(projectId, projectPath, sessionId, extra = {}) {
    live.set(sessionId, { projectId, path: projectPath, available: true, archived: extra.archived === true });
  }

  async function sessionExists(sessionId, projectPath) {
    // 'archived': confirmed present but hidden from grouping surfaces; 'live':
    // present and usable; false: confirmed absent or foreign; undefined: catalog
    // could not be read. An unreadable catalog must not spawn a duplicate
    // conversation on every open, so the stored hint is kept.
    try {
      const page = await ctx.sessionController.list({}, AbortSignal.timeout(15000));
      const items = Array.isArray(page?.items) ? page.items : null;
      if (!items) return undefined;
      const item = items.find(candidate => candidate?.sessionId === sessionId);
      if (!item || item.agentAvailable === false || item.origin === 'subagent') return false;
      // An unreadable cwd cannot prove this Session belongs to the project.
      if (typeof item.cwd !== 'string' || path.resolve(item.cwd) !== projectPath) return false;
      return isArchived(sessionId) === true ? 'archived' : 'live';
    } catch { return undefined; }
  }

  async function createSession(canonical) {
    let sessionId;
    try {
      ({ sessionId } = await ctx.sessionController.create({ cwd: canonical, agentPreset: 'openfilm-video-editing' }));
    } catch {
      throw error('PROJECT_CONVERSATION_CREATE', 'A conversation for this project could not be created');
    }
    if (typeof sessionId !== 'string' || !sessionId.trim()) {
      throw error('PROJECT_CONVERSATION_CREATE', 'Session creation returned no ID');
    }
    return sessionId;
  }

  async function store(projectId, canonical, sessionId) {
    remember(projectId, canonical, sessionId, { archived: false });
    // The hint is an optimization only: losing it starts a new empty
    // conversation later and never invalidates existing history.
    try { await table.put(projectId, { projectId, path: canonical, sessionId }); } catch { /* keep the live hint */ }
  }

  function checkInput({ projectId, path: projectPath } = {}) {
    if (typeof projectId !== 'string' || !ID.test(projectId) ||
        typeof projectPath !== 'string' || !path.isAbsolute(projectPath) || projectPath.includes('\0')) {
      throw error('PROJECT_CONVERSATION_INPUT', 'A confirmed project ID and absolute path are required');
    }
    return path.resolve(projectPath);
  }

  function resolve({ projectId, path: projectPath } = {}) {
    if (closing) return Promise.reject(error('PROJECT_CONVERSATION_CLOSED', 'Project conversations are closed'));
    const canonical = checkInput({ projectId, path: projectPath });
    const previous = inFlight.get(projectId);
    const operation = (previous ? previous.catch(() => {}) : Promise.resolve()).then(async () => {
      if (closing) throw error('PROJECT_CONVERSATION_CLOSED', 'Project conversations are closed');
      let kept;
      try { kept = table.get(projectId); } catch { kept = undefined; }
      if (kept && kept.projectId === projectId && kept.path === canonical && typeof kept.sessionId === 'string') {
        const exists = await sessionExists(kept.sessionId, canonical);
        if (exists !== false) {
          remember(projectId, canonical, kept.sessionId, { archived: exists === 'archived' });
          return kept.sessionId;
        }
      }
      const sessionId = await createSession(canonical);
      await store(projectId, canonical, sessionId);
      return sessionId;
    });
    inFlight.set(projectId, operation);
    return operation.finally(() => { if (inFlight.get(projectId) === operation) inFlight.delete(projectId); });
  }

  /** Move a project to a new empty conversation. The old Session is untouched. */
  function rebind({ projectId, path: projectPath } = {}) {
    if (closing) return Promise.reject(error('PROJECT_CONVERSATION_CLOSED', 'Project conversations are closed'));
    const canonical = checkInput({ projectId, path: projectPath });
    const previous = inFlight.get(projectId);
    const operation = (previous ? previous.catch(() => {}) : Promise.resolve()).then(async () => {
      if (closing) throw error('PROJECT_CONVERSATION_CLOSED', 'Project conversations are closed');
      const sessionId = await createSession(canonical);
      await store(projectId, canonical, sessionId);
      return sessionId;
    });
    inFlight.set(projectId, operation);
    return operation.finally(() => { if (inFlight.get(projectId) === operation) inFlight.delete(projectId); });
  }

  /** The project a live Session belongs to, for Host prompt policy. */
  function boundConversation(sessionId) {
    if (closing || typeof sessionId !== 'string') return undefined;
    return live.get(sessionId);
  }

  /** The stored hint for a project, without creating or validating a Session. */
  function peek(projectId) {
    if (closing || typeof projectId !== 'string') return undefined;
    try { return table.get(projectId); } catch { return undefined; }
  }

  function close() {
    if (!closePromise) {
      closing = true;
      closePromise = Promise.allSettled([...inFlight.values()]).then(() => domain.close()).catch(() => {});
    }
    return closePromise;
  }
  return Object.freeze({ resolve, rebind, peek, boundConversation, close });
}
