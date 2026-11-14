// Panel diagnostics: the enum-only event sink the page reports through.
//
// Deliberately tiny and closed: an event name must be in the fixed list, the body
// is capped at 512 bytes, and only the authenticated DSH browser is admitted. This
// is not a general log sink (see docs/reference/safety.md).
export function createDiagnosticsRoutes({ ctx, log, clientEvents, register, track }) {
  // recovery card appeared, the button was pressed. Enum-only, 512 bytes, and
  // only from the authenticated DSH browser — this is not a general log sink.
  // DSH register() takes one route only; client-log and bootstrap must be separate.
  const unregisterClientLog = track(register({
    kind: 'exact', path: '/api/no996-openfilm/client-log',
    async handler(req, res) {
      res.setHeader('cache-control', 'no-store');
      if (req.method !== 'POST') { res.writeHead(405, { allow: 'POST' }).end(); return; }
      const admission = ctx.connection.admit({ headers: req.headers });
      if ('rejection' in admission || admission.peer.id !== ctx.connection.browserPeer.id) { res.writeHead(403).end(); return; }
      const chunks = [];
      let size = 0;
      const finish = (status) => { if (!res.writableEnded) res.writeHead(status).end(); };
      req.on('data', (chunk) => {
        size += chunk.length;
        if (size > 512) { finish(413); req.destroy(); return; }
        chunks.push(chunk);
      });
      req.on('end', () => {
        if (res.writableEnded) return;
        let value;
        try { value = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { return finish(400); }
        const event = typeof value?.event === 'string' ? value.event : '';
        // This module is created with the allowlist; the bare constant was never in
        // scope here, so every client-log request threw instead of logging.
        if (!clientEvents.has(event)) return finish(400);
        log.info(`page-${event}`, {
          anchor: typeof value.anchor === 'string' ? value.anchor.slice(0, 16) : undefined,
          detail: typeof value.detail === 'string' ? value.detail.slice(0, 40) : undefined,
        });
        finish(204);
      });
    },
  }));

  return { disposers: [unregisterClientLog] };
}
