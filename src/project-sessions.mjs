import { createHash } from 'node:crypto';
import path from 'node:path';
import { closeSync, fstatSync, openSync, readSync, realpathSync } from 'node:fs';

export const PROJECT_SESSIONS_DOMAIN = 'no996_openfilm_project_sessions';

const error = (code, message, extra = {}) => Object.assign(new Error(message), { code, ...extra });
const keyOf = (id) => createHash('sha256').update(id, 'utf8').digest('hex');

/**
 * Open once per Host. `z` is the caller's explicit Zod 3 dependency; ctx must
 * inject storageDomain and sessionController. Inputs to ensure() must already
 * be confirmed by the upstream project authority, not supplied by a web page.
 * This registry is not an authorization or path-resolution boundary. The domain
 * facility provides single-open within one Host; this is not a cross-process CAS.
 */
export async function openProjectSessions(ctx, { z } = {}) {
  if (!ctx?.storageDomain?.open || !ctx?.sessionController?.create || !z?.object) {
    throw error('PROJECT_SESSION_DEPENDENCY', 'storageDomain, sessionController and Zod are required');
  }
  const nonempty = z.string().min(1);
  const record = z.discriminatedUnion('state', [
    z.object({ state: z.literal('pending'), projectId: nonempty, path: nonempty }).strict(),
    z.object({ state: z.literal('bound'), projectId: nonempty, path: nonempty, sessionId: nonempty }).strict(),
  ]);
  const domain = await ctx.storageDomain.open({
    name: PROJECT_SESSIONS_DOMAIN,
    version: 1,
    layout: 'per-record',
    tables: { projects: { valueSchema: record } },
  });
  const table = domain.table('projects');
  const inFlight = new Map();
  // A rejected put may still have changed the medium. Do not retry in this Host.
  const uncertain = new Set();
  const moved = new Set();
  let closing = false;
  let closePromise;

  function recovery(projectId, cause) {
    return error('PROJECT_SESSION_RECOVERY_REQUIRED',
      'Project session ownership is uncertain; manual recovery is required. No session was claimed or removed.',
      { projectId, recoverable: true, ...(cause ? { cause } : {}) });
  }

  async function ensure({ projectId, path: projectPath } = {}) {
    if (closing) throw error('PROJECT_SESSION_CLOSED', 'Project session registry is closing or closed');
    if (typeof projectId !== 'string' || !projectId.trim() || projectId.includes('\0') ||
        typeof projectPath !== 'string' || !projectPath.trim() || projectPath.includes('\0') ||
        !(path.isAbsolute(projectPath) || path.win32.isAbsolute(projectPath))) {
      throw error('PROJECT_SESSION_INPUT', 'A confirmed project ID and absolute project path are required');
    }
    const key = keyOf(projectId);
    const previous = inFlight.get(key);
    // Serialize, including after a failure, so each request observes persisted state.
    const operation = (previous ? previous.catch(() => {}) : Promise.resolve()).then(async () => {
      if (uncertain.has(key)) throw recovery(projectId);
      const existing = table.get(key);
      if (existing && existing.projectId !== projectId) throw error('PROJECT_SESSION_KEY_COLLISION', 'Project identity does not match the stored record');
      // A moved project must not silently resume an Agent rooted at the old
      // directory. Keep its history and require an explicit recovery path.
      if (existing?.state === 'bound') {
        if (existing.path !== projectPath) {
          moved.add(key);
          throw error('PROJECT_SESSION_PATH_CHANGED', 'The project directory changed; its conversation requires recovery.');
        }
        moved.delete(key);
        return existing.sessionId;
      }
      if (existing?.state === 'pending') throw recovery(projectId);

      try {
        await table.put(key, { state: 'pending', projectId, path: projectPath });
      } catch (cause) {
        uncertain.add(key);
        throw recovery(projectId, cause);
      }
      let sessionId;
      try {
        // Omitting sessionId is essential: a supplied blank session can be reused.
        ({ sessionId } = await ctx.sessionController.create({ cwd: projectPath, agentPreset: 'openfilm-video-editing' }));
        if (typeof sessionId !== 'string' || !sessionId.trim()) throw new Error('Session creation returned no ID');
      } catch (cause) {
        throw recovery(projectId, cause);
      }
      // A brand-new Session has no model, and prompting one fails before the turn
      // can start. Adopt the Host default once, here, so it never overwrites a
      // model the person picks later in the conversation.
      try {
        const catalog = await ctx.sessionController.modelCatalog();
        const chosen = catalog?.default;
        if (typeof chosen?.provider === 'string' && typeof chosen?.model === 'string') {
          await ctx.sessionController.selectModel({ sessionId, provider: chosen.provider, model: chosen.model });
        }
      } catch { /* the first prompt reports an unusable model */ }
      try {
        await table.put(key, { state: 'bound', projectId, path: projectPath, sessionId });
      } catch (cause) {
        uncertain.add(key);
        throw recovery(projectId, cause);
      }
      return sessionId;
    });
    inFlight.set(key, operation);
    try { return await operation; }
    finally { if (inFlight.get(key) === operation) inFlight.delete(key); }
  }

  function close() {
    if (!closePromise) {
      closing = true;
      closePromise = Promise.allSettled([...inFlight.values()]).then(() => domain.close());
    }
    return closePromise;
  }

  function sameProject(record) {
    let fd;
    try {
      // Recheck the canonical directory and bounded upstream ID at every prompt.
      // This does not claim confinement against hostile concurrent filesystem changes.
      if (realpathSync(record.path) !== record.path) return false;
      fd = openSync(path.join(record.path, '.film', 'id'), 'r');
      const info = fstatSync(fd);
      if (!info.isFile() || info.size > 128) return false;
      const bytes = Buffer.alloc(129);
      const size = readSync(fd, bytes, 0, bytes.length, 0);
      return size <= 128 && bytes.subarray(0, size).toString('utf8').trim() === record.projectId;
    } catch { return false; }
    finally { if (fd !== undefined) { try { closeSync(fd); } catch { /* already closed */ } } }
  }
  function boundSession(sessionId) {
    if (closing || typeof sessionId !== 'string') return undefined;
    let match;
    for (const [key, record] of table.entries()) {
      if (record.state !== 'bound' || record.sessionId !== sessionId || uncertain.has(key)) continue;
      if (match) return undefined; // Never infer ownership from an ambiguous mapping.
      match = { projectId: record.projectId, path: record.path, available: !moved.has(key) && sameProject(record) };
    }
    return match;
  }
  return Object.freeze({ ensure, close, boundSession });
}
