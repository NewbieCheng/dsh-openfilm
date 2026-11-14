// Debug window URL: the style/inspection window on its own port.
//
// A browser cannot hold Studio's Secure/Partitioned cookie, so the debug listener
// holds it and gates the window with its own token. The bridge handle is shared with
// the local console and with shutdown, so it is passed as a getter/setter pair
// rather than owned here.
import { redeemStudioSession, startStudioDebug } from '../../studio-debug.mjs';

export function createDebugUrlRoute({
  ctx,
  register,
  track,
  officialShell,
  isDisposed,
  getUpstream,
  ensureStudioStarted,
  proxyFor,
  getBridge,
  setBridge,
}) {
  const unregisterDebugUrl = track(register({
    kind: 'exact', path: '/api/no996-openfilm/debug-url',
    async handler(req, res) {
      res.setHeader('cache-control', 'no-store');
      if (req.method !== 'POST') { res.writeHead(405, { allow: 'POST' }).end(); return; }
      const admission = ctx.connection.admit({ headers: req.headers });
      if ('rejection' in admission || admission.peer.id !== ctx.connection.browserPeer.id) { res.writeHead(403).end('DSH_BROWSER_REQUIRED'); return; }
      try {
        await ensureStudioStarted();
        if (isDisposed() || !getUpstream()) { res.writeHead(503).end(); return; }
        const surface = req.headers['x-no996-surface'];
        const desktop = surface === 'dsh-app://app' || surface === 'app://app';
        const browser = desktop ? null : new URL(req.headers.origin || `http://${req.headers.host}`);
        const proxy = await proxyFor(desktop ? surface : browser.origin, desktop);
        const data = proxy.bootstrapData();
        if (!data) { res.writeHead(503).end(); return; }
        // A browser cannot hold Studio's Secure/Partitioned cookie, so the debug
        // listener holds it instead and gates the window with its own token.
        let url;
        if (data.ticket) {
          if (!getBridge()) {
            const bridge = redeemStudioSession(data.editorOrigin, data.ticket)
              .then(cookie => startStudioDebug({ editorOrigin: data.editorOrigin, sessionCookie: cookie, officialShell }));
            bridge.catch(() => { if (getBridge() === bridge) setBridge(undefined); });
            setBridge(bridge);
          }
          url = (await getBridge()).url;
        } else url = `${data.webOrigin}/no996-openfilm/standalone`;
        const body = JSON.stringify({ url });
        res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'content-length': Buffer.byteLength(body) }).end(body);
      } catch {
        if (!res.headersSent) res.writeHead(503, { 'content-type': 'text/plain; charset=utf-8' }).end('Studio is unavailable');
      }
    },
  }));

  return { disposers: [unregisterDebugUrl] };
}
