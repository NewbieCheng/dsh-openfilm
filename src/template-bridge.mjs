// The route runs on DSH's existing Web server; it is not an independent listener.
export function registerTemplateBridge(ctx, { webOrigin, list, create, isDisposed }) {
  const web = new URL(webOrigin);
  const reply = (res, status, value) => {
    const body = JSON.stringify(value);
    res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' }).end(body);
  };
  return ctx.webServer.register({ kind: 'exact', path: '/api/no996-openfilm/templates', async handler(req, res) {
    if (req.method !== 'POST') return reply(res, 405, { error: 'METHOD' });
    if (isDisposed()) return reply(res, 503, { error: 'UNAVAILABLE' });
    const admission = ctx.connection.admit({ headers: req.headers });
    if ('rejection' in admission) return reply(res, admission.rejection, { error: 'AUTH' });
    if (admission.peer.id !== ctx.connection.browserPeer.id) return reply(res, 403, { error: 'AUTH' });
    // A trusted browser credential is necessary, but never substitutes for the
    // carrier's authority and origin checks. Desktop forwarding may omit Origin.
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
      if (value.action === 'list' && Object.keys(value).length === 1) {
        const templates = await list();
        if (isDisposed()) return reply(res, 503, { error: 'UNAVAILABLE' });
        return reply(res, 200, { templates: templates.map(({ id, title, description, mode }) => ({ id, title, description, mode })) });
      }
      if (value.action !== 'create' || Object.keys(value).length !== 2 || typeof value.templateId !== 'string') return reply(res, 400, { error: 'INPUT' });
      const templates = await list();
      if (!templates.some(item => item.id === value.templateId)) return reply(res, 400, { error: 'INPUT' });
      const result = await create(value.templateId);
      if (isDisposed()) return reply(res, 503, { error: 'UNAVAILABLE' });
      if (!/^[A-Za-z0-9_-]{6,40}$/.test(result?.projectId || '')) return reply(res, 502, { error: 'PROJECT' });
      return reply(res, 200, { projectId: result.projectId, prompt: typeof result.prompt === 'string' ? result.prompt : '' });
    } catch {
      if (!res.headersSent && !res.destroyed) reply(res, 503, { error: 'UNAVAILABLE' });
    }
  } });
}
