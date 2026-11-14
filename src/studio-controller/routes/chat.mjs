// The chat-side route: the MCP endpoint the ACP child talks to.
//
// It is the only route that skips cookie admission — the caller is the child
// process and proves itself with a per-Session bearer token resolved inside the
// endpoint. A Host that is shutting down answers 503 instead of half-serving.
//
// The path is `mcp-host`, not `/mcp`: `/mcp` is the name DSH uses for MCP servers a
// plugin declares, so the plain form invites a future collision.
//
// This handler once read `disposed` where this factory only receives `isDisposed`.
// That is a ReferenceError on every request — thrown *after* the cache-control header
// is set, so the Host answered 400 with our header and an empty body. The child
// reported "mcp-client(no996-openfilm): initial connection or tool synchronization
// failed" and every chat request failed with ACP_REQUEST_FAILED (no models, no
// prompt). tests/chat-route.test.mjs calls this handler the way the Host does.
export function createChatRoutes({ register, track, mcpEndpoint, isDisposed, log }) {
  const unregisterMcp = track(register({
    kind: 'exact', path: '/api/no996-openfilm/mcp-host',
    async handler(req, res) {
      res.setHeader('cache-control', 'no-store');
      if (isDisposed()) { res.writeHead(503).end('{}'); return; }
      if (req.method !== 'POST') { res.writeHead(405, { allow: 'POST' }).end('{}'); return; }
      const chunks = [];
      let size = 0;
      for await (const chunk of req) {
        size += chunk.byteLength;
        if (size > 4 * 1024 * 1024) { res.writeHead(413).end('{}'); return; }
        chunks.push(chunk);
      }
      let answer;
      try {
        answer = await mcpEndpoint.handle({ headers: req.headers, body: Buffer.concat(chunks).toString('utf8') });
      } catch (error) {
        void log.warn('mcp-failed', { code: String(error?.code ?? error?.name ?? 'NONE').slice(0, 40) });
        answer = { status: 500, body: { error: 'mcp failed' } };
      }
      if (answer.body === undefined) { res.writeHead(answer.status).end(); return; }
      const body = JSON.stringify(answer.body);
      res.writeHead(answer.status, { 'content-type': 'application/json; charset=utf-8', 'content-length': Buffer.byteLength(body) }).end(body);
    },
  }));

  return { disposers: [unregisterMcp] };
}
