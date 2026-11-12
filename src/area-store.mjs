// Project conversations, remembered once so a Session row can ask "is this one
// a project?" without a request per row. Read-only: it only mirrors the Host's
// area payload and never opens, creates or renames anything.
import { parseAreaPayload } from './area-client.mjs';

export function createAreaStore({ fetchArea, intervalMs = 20000, now = () => Date.now() }) {
  let payload = { projects: [], hidden: [] };
  const bySession = new Map();
  const listeners = new Set();
  let started = false;
  let lastAt = 0;

  const publish = () => {
    listeners.forEach(listener => { try { listener(); } catch { /* a row must not break the list */ } });
  };
  const absorb = data => {
    payload = parseAreaPayload(data);
    bySession.clear();
    for (const project of payload.projects) {
      if (project.sessionId) bySession.set(project.sessionId, project);
    }
    lastAt = now();
    publish();
  };
  const load = () => fetchArea().then(absorb).catch(() => {});

  return {
    start() {
      if (started) return;
      started = true;
      void load();
      setInterval(() => { void load(); }, intervalMs);
      window.addEventListener('focus', () => { void load(); });
    },
    /** The project a Session belongs to, or null when it is an ordinary one. */
    projectOf(sessionId) {
      if (typeof sessionId !== 'string' || bySession.size === 0) return null;
      return bySession.get(sessionId) ?? null;
    },
    snapshot: () => payload,
    getSnapshot: () => payload,
    lastUpdatedAt: () => lastAt,
    subscribe(listener) {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
  };
}
