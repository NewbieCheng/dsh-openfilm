import path from 'node:path';

export const PROJECT_CONVERSATIONS_DOMAIN = 'no996_openfilm_project_conversations';

const error = (code, message) => Object.assign(new Error(message), { code });
const ID = /^[A-Za-z0-9_-]{6,40}$/;

/**
 * Whether two paths name the same directory.
 *
 * `path.resolve` alone is not enough on Windows: it keeps the case it was given,
 * while the same folder can come back as `F:\Dev\X` from the project lookup and
 * `f:\dev\x` from a Session record. A case mismatch used to read as "this Session
 * is not the project's", so every open created another empty conversation — the
 * stray "新建会话" under 无工作区.
 */
function samePath(left, right) {
  const normal = value => {
    const resolved = path.resolve(value);
    return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
  };
  return normal(left) === normal(right);
}

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
export async function openProjectConversations(ctx, { z, archived, onFailure } = {}) {
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

  async function sessionExists(sessionId, projectPath, workspaceId) {
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
      // Membership is proof too: a Session created inside the project's Workspace
      // may report the Workspace rather than a cwd.
      const inWorkspace = Boolean(workspaceId) && item.workspaceId === workspaceId;
      const inFolder = typeof item.cwd === 'string' && samePath(item.cwd, projectPath);
      if (!inWorkspace && !inFolder) return false;
      return { state: isArchived(sessionId) === true ? 'archived' : 'live', title: typeof item.title === 'string' ? item.title.trim() : '' };
    } catch { return undefined; }
  }

  async function createSession(canonical, workspace) {
    let sessionId;
    // A Session that joins the project's Workspace is grouped under that folder;
    // one that only owns a cwd has no group, which is the stray "新建会话" under
    // 无工作区. `workspaceId` and `cwd` are exclusive by contract.
    const request = workspace?.id
      ? { workspaceId: workspace.id, agentPreset: 'openfilm-video-editing' }
      : { cwd: canonical, agentPreset: 'openfilm-video-editing' };
    try {
      ({ sessionId } = await ctx.sessionController.create(request));
    } catch (cause) {
      // Swallowing the Host's reason turned one broken preset into a bare
      // PROJECT_CONVERSATION_CREATE, and that cost a round of guessing. The code
      // and the message tail stay on the error (no paths: the message is DSH's).
      const detail = String(cause?.code ?? '').slice(0, 60) || String(cause?.message ?? cause).slice(0, 200);
      const wrapped = error('PROJECT_CONVERSATION_CREATE', 'A conversation for this project could not be created');
      wrapped.cause = cause;
      wrapped.detail = detail;
      if (typeof onFailure === 'function') onFailure('project-conversation-create', { detail, workspace: workspace?.id ? 'workspace' : 'cwd' });
      throw wrapped;
    }
    if (typeof sessionId !== 'string' || !sessionId.trim()) {
      throw error('PROJECT_CONVERSATION_CREATE', 'Session creation returned no ID');
    }
    return sessionId;
  }

  /**
   * Resolve the Workspace that covers the project's folder.
   *
   * `workspace/create` is idempotent over an existing directory, so calling it on
   * every open is cheap and also repairs a Workspace someone deleted. Its result
   * is the live Workspace (id, path, title, sessionIds, attachSession), which the
   * Session then joins. Best-effort: without the controller the project still
   * opens — it just stays where DSH would put it on its own.
   */
  async function ensureWorkspace(canonical) {
    const controller = typeof ctx?.get === 'function' ? ctx.get('workspaceController') : undefined;
    if (!controller || typeof controller.create !== 'function') return undefined;
    try {
      const created = await controller.create({ path: canonical });
      if (!created || typeof created !== 'object') return undefined;
      // The service answers either the live Workspace (`id`, `attachSession`) or a
      // plain view of it (`workspaceId`); both name the same registration.
      const id = typeof created.id === 'string' ? created.id
        : typeof created.workspaceId === 'string' ? created.workspaceId : undefined;
      return { id, attachSession: created.attachSession, workspace: created };
    } catch { return undefined; }
  }

  /** Name the conversation after its project folder, once, when it has no title. */
  async function titleSession(sessionId, canonical) {
    const controller = ctx?.sessionController;
    if (!controller || typeof controller.rename !== 'function') return false;
    const title = path.basename(canonical) || 'OpenFilm';
    try { await controller.rename({ sessionId, title }); return true; } catch { return false; }
  }

  /**
   * Make sure a Session is a member of the Workspace.
   *
   * `session/create` joins the Workspace when it is given `workspaceId`, but a
   * Session bound before that (or created while the registry was unavailable)
   * has to be attached, otherwise it never leaves the ungrouped pile. Both paths
   * are attempted and both are best-effort: membership is presentation, and a
   * failure must not stop the person from working.
   */
  async function joinWorkspace(workspace, sessionId) {
    if (!workspace || typeof workspace.attachSession !== 'function') return false;
    try { await workspace.attachSession(sessionId); return true; } catch { return false; }
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
      const workspace = await ensureWorkspace(canonical);
      if (kept && kept.projectId === projectId && typeof kept.sessionId === 'string' && samePath(kept.path, canonical)) {
        const found = await sessionExists(kept.sessionId, canonical, workspace?.id);
        if (found !== false) {
          remember(projectId, canonical, kept.sessionId, { archived: found?.state === 'archived' });
          // A Session bound before Workspaces were registered still needs to join
          // one, or it stays in the ungrouped pile forever.
          await joinWorkspace(workspace, kept.sessionId);
          if (found && !found.title) await titleSession(kept.sessionId, canonical);
          return kept.sessionId;
        }
      }
      const sessionId = await createSession(canonical, workspace);
      await joinWorkspace(workspace, sessionId);
      await titleSession(sessionId, canonical);
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
      const workspace = await ensureWorkspace(canonical);
      const sessionId = await createSession(canonical, workspace);
      await joinWorkspace(workspace, sessionId);
      await titleSession(sessionId, canonical);
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
