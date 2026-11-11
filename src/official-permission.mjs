/**
 * Session permission for OpenFilm projects.
 *
 * Video editing cannot work in an `ask`-everything box: exporting, starting a
 * renderer and writing outside the workspace are all normal here, and the person
 * in the panel has no way to see or answer a question that DSH asked in another
 * window. DSH already models this as a per-Session *preset* (sandbox mode +
 * approval policy), so this module does the honest thing: remember the person's
 * one decision per project, apply it to that project's Session, and let them
 * change it back.
 *
 * Two facts worth keeping straight:
 *   - `danger-full-access` = full disk + `never` (no prompts at all). Choosing it
 *     means approvals stop existing for that Session, which is exactly why it
 *     must be a deliberate, visible choice.
 *   - The write path is `permissionPresets.set(session, name)`, which appends
 *     durable Session events. It needs the Session *object*, not its id: DSH
 *     keeps live Sessions in the agent registry, so the id is resolved there.
 *
 * Nothing here decides by itself. `apply` is only called after a person answered
 * a question the panel showed them.
 */
export const PROJECT_PERMISSIONS_DOMAIN = 'no996_openfilm_project_permissions';
/** The two presets this plugin knows how to mean something about. */
export const FULL_ACCESS = 'danger-full-access';
export const WORKSPACE_WRITE = 'workspace-write';
const ID = /^[A-Za-z0-9_-]{6,40}$/;
const KNOWN = new Set([FULL_ACCESS, WORKSPACE_WRITE]);

const error = (code, message) => Object.assign(new Error(message), { code });

/**
 * @param ctx Cordis context of the Host plugin (storageDomain, agents, permissionPresets).
 * @param options.z the Zod instance DSH hands to plugins.
 */
export async function openProjectPermissions(ctx, { z } = {}) {
  if (typeof ctx?.storageDomain?.open !== 'function' || !z?.object) {
    throw error('PROJECT_PERMISSION_DEPENDENCY', 'storageDomain and Zod are required');
  }
  const record = z.object({
    projectId: z.string().regex(ID), preset: z.string().min(1), at: z.number().int().nonnegative(),
  }).strict();
  const domain = await ctx.storageDomain.open({
    name: PROJECT_PERMISSIONS_DOMAIN, version: 1, layout: 'per-record',
    tables: { projects: { valueSchema: record } },
  });
  const table = domain.table('projects');

  /** The service may be absent on an older DSH build; callers must ask first. */
  function presets() {
    try { return typeof ctx.get === 'function' ? ctx.get('permissionPresets') : undefined; } catch { return undefined; }
  }

  /** Live Session object for an id, as DSH's own preset code expects. */
  function sessionObject(sessionId) {
    if (typeof sessionId !== 'string' || !sessionId) return undefined;
    const agents = ctx.agents;
    if (!agents || typeof agents.list !== 'function') return undefined;
    try {
      for (const agent of agents.list()) {
        if (agent?.session?.id === sessionId) return agent.session;
      }
    } catch { return undefined; }
    return undefined;
  }

  function remembered(projectId) {
    if (typeof projectId !== 'string' || !ID.test(projectId)) return undefined;
    try {
      const kept = table.get(projectId);
      return keeps(kept, projectId) ? kept.preset : undefined;
    } catch { return undefined; }
  }

  function keeps(kept, projectId) {
    return Boolean(kept) && kept.projectId === projectId && typeof kept.preset === 'string' && KNOWN.has(kept.preset);
  }

  /** Preset names this deployment offers, for an honest error message. */
  function presetNames() {
    const service = presets();
    const names = service?.names;
    return Array.isArray(names) ? names.filter(name => typeof name === 'string').slice(0, 12) : [];
  }

  /** The preset DSH itself reports as in force for a Session. */
  function currentOf(sessionId) {
    const service = presets();
    const session = sessionObject(sessionId);
    if (!service || typeof service.current !== 'function' || !session) return undefined;
    try { return service.current(session); } catch { return undefined; }
  }

  async function applyPreset(projectId, sessionId, preset) {
    if (typeof projectId !== 'string' || !ID.test(projectId)) throw error('PROJECT_PERMISSION_INPUT', 'A confirmed project ID is required');
    if (!KNOWN.has(preset)) throw error('PROJECT_PERMISSION_INPUT', 'Unknown permission preset');
    const service = presets();
    if (!service || typeof service.set !== 'function') {
      throw error('PROJECT_PERMISSION_UNAVAILABLE', 'This DSH build exposes no permission presets; set the permission in DSH itself');
    }
    const offered = presetNames();
    if (offered.length > 0 && !offered.includes(preset)) {
      throw error('PROJECT_PERMISSION_UNAVAILABLE', `This DSH build offers presets: ${offered.join(', ')}`);
    }
    const session = sessionObject(sessionId);
    if (!session) throw error('PROJECT_PERMISSION_SESSION', 'That conversation is not running, so its permission cannot change yet');
    service.set(session, preset);
    // The hint is an optimization: forgetting it means asking again, never a
    // permission that silently stays on.
    try { await table.put(projectId, { projectId, preset, at: Date.now() }); } catch { /* keep the applied preset */ }
    return { projectId, preset };
  }

  /** Remember a decision without a Session to apply it to yet. */
  async function decide(projectId, preset) {
    if (typeof projectId !== 'string' || !ID.test(projectId)) throw error('PROJECT_PERMISSION_INPUT', 'A confirmed project ID is required');
    if (!KNOWN.has(preset)) throw error('PROJECT_PERMISSION_INPUT', 'Unknown permission preset');
    const offered = presetNames();
    if (offered.length > 0 && !offered.includes(preset)) {
      throw error('PROJECT_PERMISSION_UNAVAILABLE', `This DSH build offers presets: ${offered.join(', ')}`);
    }
    await table.put(projectId, { projectId, preset, at: Date.now() });
    return { projectId, preset, applied: false };
  }

  return Object.freeze({
    /** Whether this DSH build can switch presets at all. */
    available() {
      const service = presets();
      return Boolean(service && typeof service.set === 'function');
    },

    /** Preset names this deployment offers, for an honest error message. */
    names: presetNames,

    /** The decision remembered for this project, if any. */
    remembered,

    /** The preset actually in force for a Session, read from DSH's own projection. */
    current: currentOf,

    /** Apply one preset and remember it for the project; only after the person answered. */
    apply: applyPreset,

    /**
     * Record the answer when the project has no running Session yet. The decision
     * is applied by `resume` on the next prompt, so a person who answers before
     * sending a first message is not asked again.
     */
    decide,

    /** Re-apply a remembered full access to a Session created after the decision. */
    async resume(projectId, sessionId) {
      const kept = remembered(projectId);
      if (kept !== FULL_ACCESS) return { projectId, preset: kept, applied: false };
      if (currentOf(sessionId) === FULL_ACCESS) return { projectId, preset: kept, applied: false };
      try {
        await applyPreset(projectId, sessionId, FULL_ACCESS);
        return { projectId, preset: FULL_ACCESS, applied: true };
      } catch (failure) {
        // A Session that is not live yet (or an older DSH) is not an error here:
        // the panel still knows the decision and can apply it when it runs.
        return { projectId, preset: FULL_ACCESS, applied: false, error: failure?.code };
      }
    },

    /** Forget the decision without touching the Session's current preset. */
    async forget(projectId) {
      if (typeof projectId !== 'string' || !ID.test(projectId)) return false;
      try {
        if (typeof table.delete !== 'function') return false;
        await table.delete(projectId);
        return true;
      } catch { return false; }
    },
  });
}
