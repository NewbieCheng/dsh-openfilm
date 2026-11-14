// Route registration and disposal for the Host side.
//
// This used to live at the bottom of `createStudioController` as a function
// declaration, purely so routes registered earlier in the same body could call it
// — a temporal-dead-zone workaround that cost two activations ("application:
// failed", panel stuck at HTTP 503). In a module the guard exists before any
// caller by construction, so the hazard is gone instead of documented.
//
// Two behaviours matter and are pinned by tests:
//   - `webServer.register` throws on a duplicate exact path; a management toggle
//     re-runs the same block in a Host that already mounted it, so a throw here
//     must not fail activation — log and hand back a no-op disposer;
//   - disposers run synchronously, last-in-first-out, and a failing disposer must
//     not stop the rest (a half-rolled-back set leaks paths for the next enable).
export function createRouter({ webServer, log } = {}) {
  if (!webServer || typeof webServer.register !== 'function') throw new TypeError('createRouter needs a webServer');

  const disposers = [];
  const warn = (event, fields) => void log?.warn?.(event, fields);

  function register(route) {
    try {
      return webServer.register(route);
    } catch (error) {
      warn('route-already-mounted', { path: route?.path, detail: String(error?.message ?? error).slice(0, 160) });
      return () => {};
    }
  }

  function track(dispose) {
    if (typeof dispose === 'function') disposers.push(dispose);
    return dispose;
  }

  /** Register and track in one step — the only form route modules should use. */
  function mount(route) {
    return track(register(route));
  }

  function rollback() {
    while (disposers.length) {
      try { disposers.pop()(); } catch { /* already gone */ }
    }
  }

  return { register, track, mount, rollback, size: () => disposers.length };
}
