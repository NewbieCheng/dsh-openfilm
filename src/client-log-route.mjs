// POST /api/no996-openfilm/client-log — the browser half's evidence channel.
//
// A client plugin cannot write to the Host log, and a silent failure (a slot
// service missing, a registration rejected, an empty project mapping) leaves no
// trace in DevTools either. This route accepts one small, sanitized event and
// writes it to the same `plugin.log` the Host already records, so the GUI can be
// diagnosed without asking the user to open a console.
//
// It is a log sink only: no state, no callbacks, no files. Bodies over 4 KiB or
// events that are not `{event, detail}` are dropped.
const LIMIT = 4096;

/**
 * @param {object} deps
 * @param {string} [deps.path]
 * @param {(req: import('node:http').IncomingMessage) => boolean} deps.admit
 * @param {{info: Function, warn: Function}} deps.log
 */
export function createClientLogRoute({ path = '/api/no996-openfilm/client-log', admit, log } = {}) {
  if (typeof admit !== 'function') throw new TypeError('admit is required');
  if (!log || typeof log.info !== 'function') throw new TypeError('log is required');
  return {
    kind: 'exact',
    path,
    async handler(req, res) {
      res.setHeader('cache-control', 'no-store');
      if (req.method !== 'POST') { res.writeHead(405, { allow: 'POST' }).end(); return; }
      if (!admit(req)) { res.writeHead(403, { 'content-type': 'application/json; charset=utf-8' }).end('{}'); return; }
      let body = '';
      let size = 0;
      try {
        for await (const chunk of req) {
          size += chunk.length;
          if (size > LIMIT) { res.writeHead(413).end(); req.destroy(); return; }
          body += chunk;
        }
      } catch {
        res.writeHead(400).end();
        return;
      }
      let parsed;
      try { parsed = JSON.parse(body); } catch { parsed = null; }
      const event = typeof parsed?.event === 'string' ? parsed.event.slice(0, 80) : null;
      if (!event) { res.writeHead(400).end(); return; }
      const detail = parsed?.detail === undefined ? undefined : JSON.stringify(parsed.detail).slice(0, 600);
      void log.info('client', { event, detail });
      res.writeHead(204).end();
    },
  };
}
