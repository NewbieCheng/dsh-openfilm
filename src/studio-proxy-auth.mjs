import { randomBytes, timingSafeEqual } from 'node:crypto';

/**
 * A deliberately small building block for a future Studio reverse proxy.
 * It does not start a server, forward requests, or protect upstream Studio.
 *
 * The caller must invoke bootstrap only from a route on the actual DSH web
 * server, and `admitBrowser` must verify that request against DSH Connection's
 * authenticated *browser* peer. It must not admit API tokens or trust headers
 * without authentication. Both the DSH server and editor must use the exact
 * 127.0.0.1 hostname: cookies are host scoped, not port scoped. The film origin
 * must use a different hostname; this is not network or process isolation.
 *
 * The returned capability is valid for at most 60 seconds and is exchanged
 * once. No upstream Studio key is accepted, stored, logged, or returned here.
 * A production proxy still needs request/response/WS mediation and a session
 * lifecycle appropriate for an editing session before this can be connected.
 */
export function createStudioProxyAuth({ webOrigin, editorOrigin, admitBrowser }) {
  function loopbackOrigin(value) {
    const url = new URL(value);
    if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1' || !url.port ||
        url.username || url.password || url.pathname !== '/' || url.search || url.hash || url.origin !== value) {
      throw new TypeError('expected an exact HTTP 127.0.0.1 origin with a port');
    }
    return url;
  }
  const web = loopbackOrigin(webOrigin);
  const editor = loopbackOrigin(editorOrigin);
  if (web.origin === editor.origin || typeof admitBrowser !== 'function') throw new TypeError('distinct origins and browser admission are required');

  const name = `dsh_openfilm_${randomBytes(16).toString('hex')}`;
  let session = null;
  let issued = false;
  let closed = false;
  const reject = (res, code) => {
    res.writeHead(code, { 'cache-control': 'no-store', 'referrer-policy': 'no-referrer' });
    res.end();
  };

  return Object.freeze({
    /** Owns res. The caller must not log request or response headers. */
    async bootstrap(req, res) {
      if (closed || issued) return reject(res, 403);
      if (req.method !== 'POST' || req.headers.host !== web.host || req.headers.origin !== web.origin) return reject(res, 403);
      // Set before awaiting admission: concurrent bootstrap requests cannot both win.
      issued = true;
      let admitted = false;
      try { admitted = await admitBrowser(req) === true; } catch { /* fail closed */ }
      if (!admitted || closed) return reject(res, 403);
      const value = randomBytes(32).toString('base64url');
      session = { value, expires: Date.now() + 60_000 };
      res.writeHead(204, {
        'cache-control': 'no-store',
        'referrer-policy': 'no-referrer',
        'set-cookie': `${name}=${value}; Path=/; HttpOnly; SameSite=Strict; Max-Age=60`,
      });
      res.end();
    },
    /**
     * Check the cookie and target Host only. The future proxy MUST additionally
     * enforce request-specific Origin / Fetch-Metadata rules, including on WS.
     */
    hasSession(req) {
      if (closed || !session || Date.now() >= session.expires || req.headers.host !== editor.host) return false;
      const cookie = req.headers.cookie;
      if (typeof cookie !== 'string') return false;
      const values = cookie.split(';').map((part) => part.trim()).filter((part) => part.startsWith(`${name}=`));
      if (values.length !== 1) return false;
      const supplied = Buffer.from(values[0].slice(name.length + 1));
      const expected = Buffer.from(session.value);
      return supplied.length === expected.length && timingSafeEqual(supplied, expected);
    },
    close() { closed = true; session = null; },
  });
}
