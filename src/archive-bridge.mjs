// Browser route for archive state. It runs on DSH's existing Web server and
// reuses the same fence as the template bridge: authenticated browser peer,
// this Host's exact authority, JSON only, 1 KiB body, fixed reply fields.
//
// The route never accepts a Session ID, a path or an archive list from the
// page. It takes only an OpenFilm project ID and resolves everything else in
// the Host, so a page cannot unarchive someone else's Session.
const PROJECT_ID = /^[A-Za-z0-9_-]{6,40}$/;

export function registerArchiveBridge(ctx, { webOrigin, state, archive, unarchive, rebind, isDisposed }) {
  const web = new URL(webOrigin);
  const reply = (res, status, value) => {
    const body = JSON.stringify(value);
    res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' }).end(body);
  };
  return ctx.webServer.register({ kind: 'exact', path: '/api/no996-openfilm/archive', async handler(req, res) {
    if (req.method !== 'POST') return reply(res, 405, { error: 'METHOD' });
    if (isDisposed()) return reply(res, 503, { error: 'UNAVAILABLE' });
    const admission = ctx.connection.admit({ headers: req.headers });
    if ('rejection' in admission) return reply(res, admission.rejection, { error: 'AUTH' });
    if (admission.peer.id !== ctx.connection.browserPeer.id) return reply(res, 403, { error: 'AUTH' });
    let host;
    try { host = new URL(`http://${req.headers.host}`); } catch { return reply(res, 403, { error: 'ORIGIN' }); }
    if (!['127.0.0.1', 'localhost'].includes(host.hostname) || host.port !== web.port || host.host !== req.headers.host || host.pathname !== '/') return reply(res, 403, { error: 'ORIGIN' });
    const surface = req.headers['x-no996-surface'];
    const desktop = surface === 'dsh-app://app' || surface === 'app://app';
    const origin = req.headers.origin;
    if (origin && origin !== host.origin && !(desktop && origin === surface)) return reply(res, 403, { error: 'ORIGIN' });
    if (!/^application\/json(?:\s*;|$)/i.test(String(req.headers['content-type'] || ''))) return reply(res, 415, { error: 'CONTENT_TYPE' });
    try {
      let size = 0;
      const chunks = [];
      for await (const chunk of req) {
        size += chunk.length;
        if (size > 1024) return reply(res, 413, { error: 'BODY_LIMIT' });
        chunks.push(chunk);
      }
      const value = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      if (!value || typeof value !== 'object' || Array.isArray(value)) return reply(res, 400, { error: 'INPUT' });
      const actions = { state, archive, unarchive, rebind };
      if (Object.keys(value).length !== 2 || typeof value.action !== 'string' ||
          !Object.hasOwn(actions, value.action) || typeof value.projectId !== 'string' || !PROJECT_ID.test(value.projectId)) {
        return reply(res, 400, { error: 'INPUT' });
      }
      const result = await actions[value.action](value.projectId);
      if (isDisposed()) return reply(res, 503, { error: 'UNAVAILABLE' });
      if (!result || typeof result !== 'object') return reply(res, 502, { error: 'ARCHIVE' });
      return reply(res, 200, {
        archived: result.archived === true,
        available: result.available !== false,
        ...(typeof result.sessionId === 'string' ? { sessionId: result.sessionId } : {}),
      });
    } catch (error) {
      // Deliberate state errors are safe to name; everything else stays opaque.
      if (error?.code === 'OFFICIAL_AGENT_CONVERSATION_ARCHIVED') return reply(res, 409, { error: 'ARCHIVED' });
      if (!res.headersSent && !res.destroyed) reply(res, 503, { error: 'UNAVAILABLE' });
    }
  } });
}
