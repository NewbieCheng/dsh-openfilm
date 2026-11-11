/**
 * The thinking-intensity choice a person made, per project.
 *
 * `auto` is a real value here, not the absence of one: it means "decide from
 * what I said". A concrete effort id means "always use this". Nothing is applied
 * by this module — it only remembers the answer, so the panel can show it and
 * the turn can act on it.
 *
 * Kept apart from the model selection itself: DSH stores the effort in force on
 * the Session, while this stores the *intent*. Auto would be indistinguishable
 * from "medium was chosen" if both lived in the same place.
 */
export const PROJECT_THINKING_DOMAIN = 'no996_openfilm_project_thinking';
export const AUTO = 'auto';
const ID = /^[A-Za-z0-9_-]{6,40}$/;
const EFFORT = /^[A-Za-z0-9_.-]{1,40}$/;

const error = (code, message) => Object.assign(new Error(message), { code });

export async function openTurnPolicy(ctx, { z } = {}) {
  if (typeof ctx?.storageDomain?.open !== 'function' || !z?.object) {
    throw error('PROJECT_THINKING_DEPENDENCY', 'storageDomain and Zod are required');
  }
  const record = z.object({
    projectId: z.string().regex(ID), thinking: z.string().min(1), at: z.number().int().nonnegative(),
  }).strict();
  const domain = await ctx.storageDomain.open({
    name: PROJECT_THINKING_DOMAIN, version: 1, layout: 'per-record',
    tables: { projects: { valueSchema: record } },
  });
  const table = domain.table('projects');

  return Object.freeze({
    /** The remembered intent: an effort id, `auto`, or undefined when never set. */
    thinking(projectId) {
      if (typeof projectId !== 'string' || !ID.test(projectId)) return undefined;
      try {
        const kept = table.get(projectId);
        if (!kept || kept.projectId !== projectId || typeof kept.thinking !== 'string') return undefined;
        return kept.thinking === AUTO || EFFORT.test(kept.thinking) ? kept.thinking : undefined;
      } catch { return undefined; }
    },

    /** Remember the person's choice. A failed write only costs the next question. */
    async setThinking(projectId, thinking) {
      if (typeof projectId !== 'string' || !ID.test(projectId)) throw error('PROJECT_THINKING_INPUT', 'A confirmed project ID is required');
      if (thinking !== AUTO && !(typeof thinking === 'string' && EFFORT.test(thinking))) {
        throw error('PROJECT_THINKING_INPUT', 'Unknown thinking intensity');
      }
      await table.put(projectId, { projectId, thinking, at: Date.now() });
      return { projectId, thinking };
    },

    /** Back to auto, without touching whatever the Session currently uses. */
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
