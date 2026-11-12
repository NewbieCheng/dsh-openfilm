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
 * The one thing this module decides by itself is the starting point: a Session
 * created by this bridge begins with full access, because video work that stops
 * to ask in another window cannot proceed. `apply` still records a decision a
 * person made in the menu, and `resume` never overrides one they made in DSH.
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
export async function openProjectPermissions(ctx, { z, onFailure } = {}) {
  if (typeof ctx?.storageDomain?.open !== 'function' || !z?.object) {
    throw error('PROJECT_PERMISSION_DEPENDENCY', 'storageDomain and Zod are required');
  }
  const record = z.object({
    projectId: z.string().regex(ID), preset: z.string().min(1), at: z.number().int().nonnegative(),
  }).strict();
  // The stored record is only a hint: the preset in force lives in DSH itself.
  // A domain this build cannot open (a schema it disagrees with, a storage that
  // moved) must not take the menu row and the default down with it — that is
  // exactly how the permission row disappeared once, with nothing in the log.
  let table = null;
  try {
    const domain = await ctx.storageDomain.open({
      name: PROJECT_PERMISSIONS_DOMAIN, version: 1, layout: 'per-record',
      tables: { projects: { valueSchema: record } },
    });
    table = domain.table('projects');
  } catch (failure) {
    if (typeof onFailure === 'function') {
      try {
        onFailure('permission-hint-unavailable', {
          code: String(failure?.code ?? failure?.name ?? 'NONE').slice(0, 40),
          detail: String(failure?.message ?? '').replace(/[A-Za-z]:[\\/][^\s"']*/g, '[path]').slice(0, 160),
        });
      } catch { /* reporting must not break the permission store */ }
    }
  }

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
    if (!table || typeof projectId !== 'string' || !ID.test(projectId)) return undefined;
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

  /** Put one preset on a live Session; refuses when DSH cannot do it. */
  function applyToSession(sessionId, preset) {
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
  }

  async function applyPreset(projectId, sessionId, preset) {
    if (typeof projectId !== 'string' || !ID.test(projectId)) throw error('PROJECT_PERMISSION_INPUT', 'A confirmed project ID is required');
    if (!KNOWN.has(preset)) throw error('PROJECT_PERMISSION_INPUT', 'Unknown permission preset');
    applyToSession(sessionId, preset);
    // The hint is an optimization: forgetting it means asking again, never a
    // permission that silently stays on.
    if (table) {
      try { await table.put(projectId, { projectId, preset, at: Date.now() }); } catch { /* keep the applied preset */ }
    }
    return { projectId, preset };
  }

  /**
   * The preset a conversation created by this bridge starts with, applied
   * without recording a decision: nobody answered yet, so a later choice of
   * `workspace-write` (in the menu or in DSH) must stay the person's.
   */
  async function applyDefault(sessionId) {
    try {
      applyToSession(sessionId, FULL_ACCESS);
      return { preset: FULL_ACCESS, applied: true };
    } catch (failure) {
      // An older DSH, or a Session that is not live yet, is not an error here.
      return { preset: FULL_ACCESS, applied: false, error: failure?.code };
    }
  }

  /** Remember a decision without a Session to apply it to yet. */
  async function decide(projectId, preset) {
    if (typeof projectId !== 'string' || !ID.test(projectId)) throw error('PROJECT_PERMISSION_INPUT', 'A confirmed project ID is required');
    if (!KNOWN.has(preset)) throw error('PROJECT_PERMISSION_INPUT', 'Unknown permission preset');
    const offered = presetNames();
    if (offered.length > 0 && !offered.includes(preset)) {
      throw error('PROJECT_PERMISSION_UNAVAILABLE', `This DSH build offers presets: ${offered.join(', ')}`);
    }
    if (!table) throw error('PROJECT_PERMISSION_UNAVAILABLE', 'This DSH build cannot store the decision; pick the permission once the conversation exists');
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

    /** The preset this bridge starts a new conversation with. */
    defaultPreset() {
      return FULL_ACCESS;
    },

    /** Apply that default to a Session that was just created (not remembered). */
    applyDefault,

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
      // No recorded decision means the default, and the default is full access:
      // the menu reports it, so the Session has to run under it too. An explicit
      // `workspace-write` is a recorded decision and is never overridden here.
      const recorded = remembered(projectId);
      const kept = recorded ?? FULL_ACCESS;
      if (kept !== FULL_ACCESS) return { projectId, preset: kept, applied: false };
      const current = currentOf(sessionId);
      if (current === FULL_ACCESS) return { projectId, preset: kept, applied: false };
      // The default is only a default: a Session somebody deliberately set to
      // another preset in DSH keeps it. The states a fresh conversation can be
      // in are "no preset reported" and DSH's own workspace-write.
      if (recorded === undefined && current !== undefined && current !== WORKSPACE_WRITE) {
        return { projectId, preset: current, applied: false };
      }
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
      if (!table || typeof projectId !== 'string' || !ID.test(projectId)) return false;
      try {
        if (typeof table.delete !== 'function') return false;
        await table.delete(projectId);
        return true;
      } catch { return false; }
    },
  });
}
