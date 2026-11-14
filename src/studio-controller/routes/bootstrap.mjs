// The panel's bootstrap call: authenticate, make sure Studio is up, hand the
// response to the proxy's `bootstrap`, which writes the editor origin (and, in
// desktop mode, a one-time ticket).
//
// `desktop` comes from the privileged `dsh-app://app` surface, which does not share
// DSH's browser cookie with loopback frames; browser mode keeps its own origin and
// must be the same port as the Host. Failures are answered with an allowlisted code
// because upstream messages may carry bearer keys.
export function createBootstrapRoute({
  ctx,
  register,
  track,
  log,
  origin,
  isDisposed,
  getUpstream,
  ensureStudioStarted,
  proxyFor,
}) {
  const unregisterBootstrap = track(register({
    kind: 'exact', path: '/api/no996-openfilm/bootstrap',
    async handler(req, res) {
      res.setHeader('cache-control', 'no-store');
      if (isDisposed()) { res.writeHead(503).end('STUDIO_DISPOSED'); return; }
      if (req.method !== 'POST') { res.writeHead(405, { allow: 'POST' }).end(); return; }
      // Use DSH's own Host/Origin and authenticated-peer fence. It intentionally
      // accepts a missing Origin when the authenticated request is otherwise
      // trusted; requiring an Origin here rejects valid local browser requests.
      const admission = ctx.connection.admit({ headers: req.headers });
      if ('rejection' in admission) {
        res.writeHead(admission.rejection).end(admission.rejection === 403 ? 'DSH_ORIGIN_REJECTED' : 'DSH_SESSION_REQUIRED'); return;
      }
      if (admission.peer.id !== ctx.connection.browserPeer.id) {
        res.writeHead(403).end('DSH_BROWSER_REQUIRED'); return;
      }
      const bootStarted = Date.now();
      let stage = 'validate';
      try {
        // Desktop serves its UI from a privileged app scheme and forwards this
        // already-authenticated call to the Host. It does not share DSH's
        // browser cookie with loopback frames, so the proxy uses a one-time
        // desktop bootstrap instead. Normal browser mode keeps its own origin.
        const surface = req.headers['x-no996-surface'];
        const desktop = surface === 'dsh-app://app' || surface === 'app://app';
        const browser = desktop ? null : new URL(req.headers.origin || `http://${req.headers.host}`);
        if (!desktop && (browser.protocol !== 'http:' || !['127.0.0.1', 'localhost'].includes(browser.hostname) || browser.port !== origin.port)) {
          res.writeHead(403).end('DSH_ORIGIN_REJECTED'); return;
        }
        log.info('bootstrap-start', { desktop });
        stage = 'studio';
        await ensureStudioStarted();
        if (isDisposed() || !getUpstream()) { log.warn('bootstrap-unavailable', { stage, disposed: isDisposed() }); res.writeHead(503).end(); return; }
        stage = 'proxy';
        const proxy = await proxyFor(desktop ? surface : browser.origin, desktop);
        if (isDisposed()) { log.warn('bootstrap-unavailable', { stage, disposed: true }); res.writeHead(503).end(); return; }
        stage = 'response';
        await proxy.bootstrap(res);
        log.info('bootstrap-finish', { status: res.statusCode, ms: Date.now() - bootStarted, desktop });
      } catch (error) {
        // Log only a bounded allowlisted error code: messages may contain bearer keys.
        // OFFICIAL_SHELL_UNAVAILABLE belongs here: it is the one failure a person can
        // act on (the bundled shell does not match the pinned OpenFilm kernel), and
        // without it the log only ever said "OTHER".
        const allowed = ['STUDIO_START', 'STUDIO_CLOSE', 'STUDIO_DEPENDENCY', 'OFFICIAL_SHELL_UNAVAILABLE'];
        const code = allowed.includes(error?.code) ? error.code : 'OTHER';
        log.warn('bootstrap-failed', { stage, code, ms: Date.now() - bootStarted });
        if (!res.headersSent) res.writeHead(503, { 'content-type': 'text/plain; charset=utf-8' });
        // The panel shows this body beside the status: naming the code is the
        // difference between "broken" and "the shell and the kernel disagree".
        if (!res.writableEnded) res.end(`Studio is unavailable (${code})`);
      }
    },
  }));

  return { disposers: [unregisterBootstrap] };
}
