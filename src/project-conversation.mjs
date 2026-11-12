import path from 'node:path';
import { markProjectOpened } from './project-markers.mjs';

export const PROJECT_CONVERSATIONS_DOMAIN = 'no996_openfilm_project_conversations';

const error = (code, message) => Object.assign(new Error(message), { code });
const ID = /^[A-Za-z0-9_-]{6,40}$/;

/**
 * Whether two paths name the same directory.
 *
 * `path.resolve` alone is not enough on Windows: it keeps the case it was given,
 * while the same folder can come back as `F:\\Dev\\X` from the project lookup and
 * `f:\\dev\\x` from a Session record. A case mismatch used to read as "this Session
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
 * Read one Workspace registration from whatever `workspace/create` answers.
 *
 * DSH 0.11 answers the Remote value `{ workspace: { workspaceId, sessionIds, … }, created }`.
 * Earlier shapes answered the Workspace itself, so both stay readable. The shape
 * matters beyond the field names: membership lives only in `sessionIds` — a
 * `SessionSummary` carries no `workspaceId`, so an ungrouped conversation cannot
 * be proven grouped from the session catalog alone.
 */
function workspaceView(created) {
  if (!created || typeof created !== 'object') return undefined;
  const view = created.workspace && typeof created.workspace === 'object' ? created.workspace : created;
  const id = typeof view.workspaceId === 'string' && view.workspaceId ? view.workspaceId
    : typeof view.id === 'string' && view.id ? view.id
      : typeof created.workspaceId === 'string' && created.workspaceId ? created.workspaceId
        : undefined;
  if (!id) return undefined;
  // Omitted when the deployment does not expose the projection; an empty array
  // is a real answer ("no Session is accounted to this Workspace").
  const sessionIds = Array.isArray(view.sessionIds)
    ? view.sessionIds.filter(sessionId => typeof sessionId === 'string')
    : undefined;
  return { id, sessionIds };
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
export async function openProjectConversations(ctx, { z, archived, onFailure, onCreated } = {}) {
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
  // Per-project: the Session could not be proven to be under its Workspace.
  const degraded = new Map();
  // A blank ungrouped conversation is replaced once. Retrying after that would
  // spin against a Host that keeps answering the same way.
  const rebound = new Set();
  // Codes that describe a standing condition are logged once per project, not
  // once per open: the panel opens a project many times a minute.
  const reportedOnce = new Set();

  /** One place for the grouping trail: a silent catch is what hid this bug for a release. */
  function report(event, fields) {
    if (typeof onFailure === 'function') {
      try { onFailure(event, fields); } catch { /* reporting must not break the open */ }
    }
  }

  function reportOnce(projectId, event, fields) {
    const key = `${projectId}\u0000${event}\u0000${fields?.code ?? ''}`;
    if (reportedOnce.has(key)) return;
    reportedOnce.add(key);
    report(event, fields);
  }

  let closing = false;
  let closePromise;

  /**
   * Hand a just-created Session to the Host, before anything else uses it, so
   * the default permission can be applied while the Session is live. Best
   * effort: a Session left on DSH's own preset still works, it just asks more.
   */
  async function created(sessionId) {
    if (typeof onCreated !== 'function') return;
    try { await onCreated(sessionId); } catch { report('permission-default', { ok: false }); }
  }

  function remember(projectId, projectPath, sessionId, extra = {}) {
    live.set(sessionId, { projectId, path: projectPath, available: true, archived: extra.archived === true });
  }

  /** The session catalog, read once per decision; unreadable is not "absent". */
  async function catalog() {
    try {
      const page = await ctx.sessionController.list({}, AbortSignal.timeout(15000));
      return Array.isArray(page?.items) ? page.items : undefined;
    } catch { return undefined; }
  }

  /**
   * Whether the catalog still carries the project's Session.
   *
   * @returns {Promise<false|undefined|{state:'live'|'archived', title:string, blank:boolean}>}
   *   false: confirmed absent or foreign; undefined: the catalog could not be
   *   read, so the stored hint must survive; an object: present and usable.
   */
  async function sessionFor(sessionId, projectPath, workspace) {
    const items = await catalog();
    if (!items) return undefined;
    const item = items.find(candidate => candidate?.sessionId === sessionId);
    if (!item || item.agentAvailable === false || item.origin === 'subagent') return false;
    const inFolder = typeof item.cwd === 'string' && samePath(item.cwd, projectPath);
    // A Session created inside the project's Workspace may report the Workspace
    // rather than a cwd, and membership is the stronger proof.
    const member = memberOf(workspace, sessionId);
    if (!inFolder && member !== true) return false;
    const projected = item.projections && typeof item.projections === 'object' ? item.projections.values : undefined;
    const title = typeof projected?.title === 'string' ? projected.title.trim()
      : typeof item.title === 'string' ? item.title.trim() : '';
    return { state: isArchived(sessionId) === true ? 'archived' : 'live', title, blank: item.blank === true };
  }

  function memberOf(workspace, sessionId) {
    return workspace?.sessionIds ? workspace.sessionIds.includes(sessionId) : undefined;
  }

  async function createSession(canonical, workspace) {
    let sessionId;
    // `workspaceId` and `cwd` are exclusive by contract. A Session that joins the
    // Workspace is accounted to it (the sidebar's group); one that only owns a
    // cwd can never be adopted later — DSH has no attach for an existing Session.
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
      report('project-conversation-create', { detail, workspace: workspace?.id ? 'workspace' : 'cwd' });
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
   * every open is cheap and also repairs a Workspace someone deleted. The value
   * names the live Workspace and the Sessions accounted to it; that is the same
   * record the sidebar groups by, so it is also the membership check.
   * Best-effort: without the controller the project still opens — it just stays
   * where DSH would put it on its own.
   */
  async function ensureWorkspace(canonical) {
    const controller = typeof ctx?.get === 'function' ? ctx.get('workspaceController') : undefined;
    if (!controller || typeof controller.create !== 'function') {
      // The silent fallback to a cwd-only Session is what dropped conversations
      // into 未分组 with nothing left to look at. The fallback stays (work must
      // not stop), but it now says which step failed.
      report('workspace-join', { step: 'controller', ok: false, code: 'WORKSPACE_CONTROLLER_MISSING' });
      return undefined;
    }
    try {
      const created = await controller.create({ path: canonical });
      if (!created || typeof created !== 'object') {
        report('workspace-join', { step: 'create', ok: false, code: 'WORKSPACE_CREATE_EMPTY' });
        return undefined;
      }
      const workspace = workspaceView(created);
      if (!workspace) {
        report('workspace-join', { step: 'create', ok: false, code: 'WORKSPACE_CREATE_NO_ID' });
        return undefined;
      }
      return workspace;
    } catch (cause) {
      report('workspace-join', { step: 'create', ok: false, code: String(cause?.code ?? cause?.message ?? cause).slice(0, 120) });
      return undefined;
    }
  }

  /** Name the conversation after its project folder, once, when it has no title. */
  async function titleSession(sessionId, canonical) {
    const controller = ctx?.sessionController;
    if (!controller || typeof controller.rename !== 'function') return false;
    const title = path.basename(canonical) || 'OpenFilm';
    try { await controller.rename({ sessionId, title }); return true; } catch { return false; }
  }

  /**
   * Whether the Workspace now accounts this Session, read back from the Host.
   *
   * `create({ workspaceId })` returning an id is not proof of membership: a
   * Session can come back bound to a cwd, or to nothing at all, and that is
   * exactly the 未分组 case. Reading the Workspace back is the only check that
   * looks at the same record the sidebar groups by.
   *
   * @returns {Promise<'seated'|'ungrouped'|'unknown'>}
   */
  async function verifySeat(canonical, sessionId) {
    const workspace = await ensureWorkspace(canonical);
    if (!workspace) return 'unknown';
    const member = memberOf(workspace, sessionId);
    if (member === true) return 'seated';
    if (member === undefined) return 'unknown';
    return 'ungrouped';
  }

  function seatCode(state) {
    return state === 'unknown' ? 'WORKSPACE_MEMBERSHIP_UNKNOWN' : 'WORKSPACE_MEMBERSHIP_UNCONFIRMED';
  }

  async function store(projectId, canonical, sessionId) {
    remember(projectId, canonical, sessionId, { archived: false });
    // The hint is an optimization only: losing it starts a new empty
    // conversation later and never invalidates existing history.
    try { await table.put(projectId, { projectId, path: canonical, sessionId }); } catch { /* keep the live hint */ }
  }

  function checkInput({ projectId, path: projectPath } = {}) {
    if (typeof projectId !== 'string' || !ID.test(projectId) ||
        typeof projectPath !== 'string' || !path.isAbsolute(projectPath) || projectPath.includes('\\0')) {
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
      // A project the panel shows has been shown: mark it, so the kernel CLI
      // never starts Studio (and a browser window) to "show it for the first time".
      const marked = await markProjectOpened(canonical);
      if (!marked) report('project-marker', { ok: false, code: 'OPENED_MARKER_UNWRITABLE' });
      if (kept && kept.projectId === projectId && typeof kept.sessionId === 'string' && samePath(kept.path, canonical)) {
        const found = await sessionFor(kept.sessionId, canonical, workspace);
        if (found === undefined) {
          // An unreadable catalog must not spawn a duplicate conversation on every
          // open, so the stored hint is kept and the grouping stays unproven.
          remember(projectId, canonical, kept.sessionId, { archived: false });
          return kept.sessionId;
        }
        if (found !== false) {
          const member = memberOf(workspace, kept.sessionId);
          if (member !== false) {
            remember(projectId, canonical, kept.sessionId, { archived: found.state === 'archived' });
            degraded.set(projectId, member === true ? false : true);
            if (member === undefined && workspace) {
              reportOnce(projectId, 'workspace-join', { step: 'verify', ok: false, code: 'WORKSPACE_MEMBERSHIP_UNKNOWN' });
            }
            if (!found.title && !found.archived) await titleSession(kept.sessionId, canonical);
            return kept.sessionId;
          }
          // The stored conversation exists but the Workspace does not account it:
          // that is the 未分组 bug. DSH cannot adopt an existing Session, so a
          // blank one is left behind in favour of a new, seated one; a Session
          // with history is never swapped behind the person's back.
          if (found.blank && !rebound.has(projectId)) {
            rebound.add(projectId);
            const sessionId = await createSession(canonical, workspace);
            await created(sessionId);
            const seat = await verifySeat(canonical, sessionId);
            degraded.set(projectId, seat === 'seated' ? false : true);
            if (seat !== 'seated') report('workspace-join', { step: 'verify', ok: false, code: seatCode(seat) });
            await titleSession(sessionId, canonical);
            await store(projectId, canonical, sessionId);
            report('project-conversation-rebound', { from: kept.sessionId, to: sessionId });
            return sessionId;
          }
          remember(projectId, canonical, kept.sessionId, { archived: found.state === 'archived' });
          degraded.set(projectId, true);
          reportOnce(projectId, 'workspace-join', { step: 'verify', ok: false, code: 'WORKSPACE_SESSION_UNGROUPED' });
          return kept.sessionId;
        }
      }
      const sessionId = await createSession(canonical, workspace);
      await created(sessionId);
      const seat = workspace ? await verifySeat(canonical, sessionId) : 'unknown';
      degraded.set(projectId, seat === 'seated' ? false : true);
      // A conversation this process just made is never replaced by itself on the
      // next open when the Host would not confirm the join.
      if (seat !== 'seated') rebound.add(projectId);
      if (seat !== 'seated' && workspace) report('workspace-join', { step: 'verify', ok: false, code: seatCode(seat) });
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
      await markProjectOpened(canonical);
      const sessionId = await createSession(canonical, workspace);
      await created(sessionId);
      const seat = workspace ? await verifySeat(canonical, sessionId) : 'unknown';
      degraded.set(projectId, seat === 'seated' ? false : true);
      if (seat !== 'seated' && workspace) report('workspace-join', { step: 'verify', ok: false, code: seatCode(seat) });
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

  /**
   * Whether the project's Session could be proven to sit under its Workspace.
   *
   * \true means the sidebar will show it inside the project's folder. \false`n   * means it opened anyway but is either ungrouped or on the way there — worth
   * knowing in diagnostics, never worth refusing to work over.
   */
  function grouping(projectId) {
    return degraded.get(projectId) === true ? 'degraded' : degraded.has(projectId) ? 'seated' : 'unknown';
  }

  /**
   * Every stored binding, for the sidebar's project area. Read-only: nothing is
   * validated, created or archived, so drawing the sidebar cannot change state.
   */
  function bindings() {
    if (closing) return [];
    try {
      return [...table.entries()].map(([projectId, record]) => ({
        projectId, path: record.path, sessionId: record.sessionId,
      }));
    } catch { return []; }
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
  return Object.freeze({ resolve, rebind, peek, bindings, boundConversation, grouping, close });
}
