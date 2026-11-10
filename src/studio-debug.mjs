import { createServer, request } from 'node:http';
import { randomBytes } from 'node:crypto';

/**
 * A development-only window onto one Studio editor.
 *
 * The desktop bridge deliberately refuses top-level browser use: its ticket is
 * iframe-only and its session cookie is `Secure; Partitioned`, which a plain
 * `http://127.0.0.1` page cannot hold. This listener is the explicit exception
 * the user asked for: it binds loopback, is gated by a random token, and is
 * only reachable while the plugin is loaded.
 *
 * It adds nothing to Studio's own authority. Requests are forwarded to the
 * editor origin with that origin's lobby session attached, so Studio still sees
 * exactly one local client and keeps its own file and process permissions.
 */
export function startStudioDebug({ editorOrigin, sessionCookie, logger, port = Number(process.env.NO996_OPENFILM_DEBUG_PORT || 47821) }) {
  const token = randomBytes(24).toString('base64url');
  const target = new URL(editorOrigin);
  const cookieName = 'no996_debug';
  const sessions = new Set([token]);
  const server = createServer((req, res) => {
    let url;
    try { url = new URL(req.url, 'http://debug.invalid'); } catch { res.writeHead(400).end(); return; }
    if (url.pathname === '/__debug' && url.searchParams.get('k') === token) {
      res.writeHead(302, {
        location: '/',
        'set-cookie': `${cookieName}=${token}; HttpOnly; SameSite=Lax; Path=/`,
        'cache-control': 'no-store',
      });
      res.end();
      return;
    }
    const held = String(req.headers.cookie || '').split(';').map(part => part.trim()).find(part => part.startsWith(`${cookieName}=`));
    // A URL typed or bookmarked in a browser sends no Origin and Sec-Fetch-Site:
    // none: that is the person asking for this window directly, so it is let in
    // without the one-time ticket. Anything linked from another site (the way a
    // stray page would try to use this port) still needs the ticket.
    const typed = !req.headers.origin && (req.headers['sec-fetch-site'] === 'none' || !req.headers['sec-fetch-site']);
    if ((!held || !sessions.has(held.slice(cookieName.length + 1))) && !(typed && req.method === 'GET')) {
      res.writeHead(401, { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' }).end('open this window through the video panel button');
      return;
    }
    const headers = { ...req.headers, host: target.host, cookie: sessionCookie, 'sec-fetch-site': 'same-origin' };
    // Studio's bridge inspects the navigation destination; a top-level document
    // is exactly what it refuses, so present the same shape the frame uses.
    if (req.headers.origin) headers.origin = editorOrigin;
    if (req.method === 'GET') { headers['sec-fetch-dest'] = 'iframe'; headers['sec-fetch-mode'] = 'navigate'; }
    delete headers['accept-encoding'];
    const upstream = request({
      hostname: target.hostname, port: target.port, method: req.method, path: req.url, headers,
    }, reply => {
      if (!res.headersSent) res.writeHead(reply.statusCode || 502, reply.headers);
      reply.pipe(res);
    });
    upstream.on('error', () => { if (!res.headersSent) res.writeHead(502, { 'content-type': 'text/plain' }); else res.destroy(); res.end(); });
    req.on('error', () => upstream.destroy());
    req.pipe(upstream);
  });
  server.on('upgrade', (req, socket, head) => {
    socket.on('error', () => socket.destroy());
    const headers = { ...req.headers, host: target.host, cookie: sessionCookie, 'sec-fetch-site': 'same-origin' };
    if (headers.origin) headers.origin = editorOrigin;
    const upstream = request({ hostname: target.hostname, port: target.port, method: req.method, path: req.url, headers });
    upstream.on('upgrade', (reply, upstreamSocket, upstreamHead) => {
      socket.write(`HTTP/1.1 101 Switching Protocols\r\n${Object.entries(reply.headers).map(([key, value]) => `${key}: ${value}`).join('\r\n')}\r\n\r\n`);
      if (upstreamHead?.length) socket.write(upstreamHead);
      if (head?.length) upstreamSocket.write(head);
      upstreamSocket.pipe(socket).pipe(upstreamSocket);
    });
    upstream.on('response', () => { socket.destroy(); upstream.destroy(); });
    upstream.on('error', () => socket.destroy());
    upstream.end();
  });
  return new Promise((resolve, reject) => {
    const finish = () => {
      server.off('error', reject);
      const address = server.address();
      const origin = `http://127.0.0.1:${address.port}`;
      logger?.(`OpenFilm debug window listening on ${origin}`);
      resolve(Object.freeze({
        origin,
        url: `${origin}/__debug?k=${token}`,
        async close() {
          sessions.clear();
          await new Promise(done => server.close(done));
        },
      }));
    };
    // A stable port so the address can be bookmarked; a busy port falls back to
    // an ephemeral one instead of failing the whole debug window.
    server.once('error', () => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', finish);
    });
    server.listen(Number.isInteger(port) && port > 0 && port < 65536 ? port : 0, '127.0.0.1', finish);
  });
}

/**
 * Redeem a lobby ticket for the one session cookie the debug window forwards.
 * Studio sets it `Secure; Partitioned`, which is why it cannot live in a plain
 * browser; holding it here, server-side, is the whole point.
 */
export async function redeemStudioSession(editorOrigin, ticket) {
  const target = new URL(editorOrigin);
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({ ticket });
    const req = request({
      hostname: target.hostname, port: target.port, method: 'POST', path: '/__dsh/session',
      headers: { host: target.host, origin: editorOrigin, 'sec-fetch-site': 'same-origin', 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) },
    }, res => {
      res.resume();
      const set = res.headers['set-cookie'];
      const value = Array.isArray(set) ? set.map(item => item.split(';')[0]).join('; ') : String(set || '').split(';')[0];
      if (res.statusCode !== 204 || !value) reject(new Error(`Studio session rejected (${res.statusCode})`));
      else resolve(value);
    });
    req.on('error', reject);
    req.end(body);
  });
}
