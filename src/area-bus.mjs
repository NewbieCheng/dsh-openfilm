// One page, two modules: the sidebar (studio-entry) publishes the project the
// user clicked; the panel (studio-panel) owns the iframe that can act on it and
// reports the project the official shell currently shows. This module is that
// seam, and it is deliberately tiny: a request queue plus subscribers.
//
// The panel may not be mounted yet when the sidebar asks (the video area is a
// main panel the user has not opened), so a navigate request is kept until the
// panel says it is ready. Keeping it is what makes "click a project" work from a
// cold start instead of only after the panel happened to be visible.

function normalizeProjectId(value) {
  return typeof value === 'string' && /^[A-Za-z0-9_-]{6,40}$/.test(value) ? value : null;
}

export function createAreaBus() {
  const listeners = new Set();
  const state = { projectId: null, ready: false, pending: null };
  function emit(event) {
    for (const listener of [...listeners]) {
      try { listener(event); } catch { /* one broken listener must not starve the other */ }
    }
  }
  return {
    subscribe(listener) {
      if (typeof listener !== 'function') return () => {};
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    /** Ask the panel to navigate; a request made before it mounts is kept. */
    navigate(projectId) {
      const id = normalizeProjectId(projectId);
      if (!id) return false;
      state.pending = id;
      emit({ type: 'navigate', projectId: id });
      return true;
    },
    /** Take the pending request (the panel flushes it once it is listening). */
    takePending() {
      const id = state.pending;
      state.pending = null;
      return id;
    },
    /** The official shell has a live frame again. */
    reportReady() {
      state.ready = true;
      emit({ type: 'ready' });
    },
    /** The project the official shell currently shows (null when none). */
    reportProject(projectId) {
      state.projectId = normalizeProjectId(projectId);
      emit({ type: 'project', projectId: state.projectId });
    },
    snapshot() {
      return { ...state };
    },
  };
}

export const areaBus = createAreaBus();
