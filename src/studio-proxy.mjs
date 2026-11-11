import { createHash, randomBytes } from 'node:crypto';
import { appendFileSync, statSync, truncateSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer, request } from 'node:http';
import { officialFacadeSource } from './official-facade.mjs';
import { officialUploadSource } from './official-attachment.mjs';
import { shellUiInjection, shellUiVersion } from './shell-extras.mjs';

// Upstream 5xx bodies are the only description of a Studio failure the person
// can act on, and the page shows just the status. Keep the last few for
// diagnosis; never the request body, never a project path.
const failureLog = join(tmpdir(), 'dsh-openfilm-errors.jsonl');
function recordFailure(method, path, status, body) {
  try {
    const line = JSON.stringify({ at: new Date().toISOString(), method, path, status, body: String(body).slice(0, 800) }) + '\n';
    appendFileSync(failureLog, line, 'utf8');
    if (statSync(failureLog).size > 64 * 1024) truncateSync(failureLog, 0);
  } catch { /* diagnostics must never affect the response */ }
}

// Proxy for the pinned OpenFilm 0.3.2 protocol (0.3.1 shell snapshot). It does not provide process
// isolation. Unrecognized or unsafe representations fail closed.
const WS_GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';
const MAX_FRAME = 1024 * 1024;
const MAX_RESPONSE = 32 * 1024 * 1024;

// The 0.3.1 server sends unfragmented JSON frames and ping controls. Reject
// unsupported extensions, fragmented frames, invalid masks and oversized frames.
function wsFrame(opcode, payload, masked) {
  const size = payload.length;
  const length = size < 126 ? Buffer.from([size]) : size < 65536
    ? Buffer.from([126, size >>> 8, size & 255])
    : Buffer.from([127, 0, 0, 0, 0, (size >>> 24) & 255, (size >>> 16) & 255, (size >>> 8) & 255, size & 255]);
  if (!masked) return Buffer.concat([Buffer.from([0x80 | opcode]), length, payload]);
  length[0] |= 0x80;
  const mask = randomBytes(4);
  const copy = Buffer.from(payload);
  for (let i = 0; i < copy.length; i++) copy[i] ^= mask[i % 4];
  return Buffer.concat([Buffer.from([0x80 | opcode]), length, mask, copy]);
}
function frames(socket, expectMask, onMessage, close) {
  let pending = Buffer.alloc(0);
  const receive = (chunk) => {
    if (pending.length + chunk.length > MAX_FRAME + 14) return close();
    pending = Buffer.concat([pending, chunk]);
    while (pending.length >= 2) {
      const first = pending[0], second = pending[1], opcode = first & 15;
      if ((first & 0xf0) !== 0x80 || Boolean(second & 0x80) !== expectMask) return close();
      let n = second & 127, offset = 2;
      if (n === 126) { if (pending.length < 4) return; n = pending.readUInt16BE(2); offset = 4; if (n < 126) return close(); }
      else if (n === 127) {
        if (pending.length < 10) return;
        const value = pending.readBigUInt64BE(2);
        if (value < 65536n || value > BigInt(MAX_FRAME)) return close();
        n = Number(value); offset = 10;
      }
      if (n > MAX_FRAME || (opcode >= 8 && n > 125)) return close();
      const maskOffset = offset;
      if (expectMask) offset += 4;
      if (pending.length < offset + n) return;
      const data = Buffer.from(pending.subarray(offset, offset + n));
      if (expectMask) for (let i = 0; i < n; i++) data[i] ^= pending[maskOffset + i % 4];
      pending = pending.subarray(offset + n);
      if (opcode === 8) return close();
      if (opcode === 9) { socket.write(wsFrame(10, data, !expectMask)); continue; }
      if (opcode === 10) continue;
      if (opcode !== 1) return close();
      onMessage(opcode, data);
      if (socket.destroyed) return;
    }
  };
  socket.on('data', receive);
  return receive;
}
const SAFE_HEADERS = new Set(['accept', 'accept-language', 'content-type', 'content-length', 'range', 'if-range', 'if-none-match', 'if-modified-since']);
const RESPONSE_HEADERS = new Set(['content-type', 'content-range', 'accept-ranges', 'last-modified', 'etag', 'cache-control', 'content-disposition']);

function upstreamOrigin(value, hostname) {
  const url = new URL(value);
  if (url.protocol !== 'http:' || url.hostname !== hostname || !url.port || url.origin !== value || url.username || url.password) throw new TypeError('Invalid upstream origin');
  return url;
}
function listen(server, host, preferred = 0) {
  return new Promise((resolve, reject) => {
    const done = () => { server.off('error', fallback); resolve(server.address().port); };
    // A stable port keeps Studio's own localStorage (workspace layout, panes)
    // across restarts; a busy port falls back to an ephemeral one.
    const fallback = () => {
      server.off('error', fallback);
      server.once('error', reject);
      server.listen(0, host, () => { server.off('error', reject); resolve(server.address().port); });
    };
    server.once('error', fallback);
    server.listen(preferred, host, done);
  });
}
function shutdown(server) {
  return new Promise((resolve) => {
    if (!server.listening) return resolve();
    server.closeAllConnections();
    server.close(() => resolve());
  });
}
/**
 * Who may frame the editor. The desktop window is `dsh-app://app`, a scheme no
 * `frame-ancestors` entry of ours named until now — Chrome blocked the frame and
 * the panel showed a blank rectangle. Loopback ports plus the desktop scheme are
 * the only frames this localhost integration is built for; remote sites stay out.
 */
function ancestorsFor(origin) {
  return `${origin} 'self' http://127.0.0.1:* http://localhost:* dsh-app: app:`;
}

function fail(res, status = 403) {
  if (res.headersSent) return res.destroy();
  res.writeHead(status, { 'cache-control': 'no-store', 'content-length': '0' });
  res.end();
}

/**
 * Host-only. bootstrap(res) MUST be invoked only after authenticating a browser
 * request on the Host's 127.0.0.1 origin and checking its Host and Origin. It
 * writes the editor origin and, in desktop mode, a one-time ticket; it does not
 * create a cookie. authenticateBrowser is a synchronous Host callback returning true only for an authenticated DSH
 * browser peer. It receives the actual request after the proxy's own trust checks;
 * the Host is responsible for carefully mapping the validated authority for DSH.
 * Film files use signed tokens on the separate localhost hostname.
 *
 * Buffered responses are limited to 32 MiB; eligible binary media is streamed.
 * Compressed responses, redirects and text ranges are refused. WebSocket messages
 * are bounded and only unfragmented JSON event streams are supported. Key
 * scanning is not protection against a malicious or modified upstream. OpenFilm
 * retains its native file and process permissions; DSH workspace tool restrictions
 * do not constrain these APIs.
 */
export async function startStudioProxy({ upstream, authenticateBrowser, webOrigin, desktop = false, officialShell = false, officialRpc, authorizeOfficialProject, attachOfficialEvents, log } = {}) {
  // A proxy without a logger is valid (tests, embedders); the calls are no-ops.
  const say = typeof log?.write === 'function' ? log : { write() {}, info() {}, warn() {}, error() {} };
  if (typeof officialShell !== 'boolean') throw new TypeError('officialShell must be a boolean');
  if (officialRpc !== undefined && typeof officialRpc !== 'function') throw new TypeError('officialRpc must be a function');
  if (authorizeOfficialProject !== undefined && typeof authorizeOfficialProject !== 'function') throw new TypeError('authorizeOfficialProject must be a function');
  if (attachOfficialEvents !== undefined && typeof attachOfficialEvents !== 'function') throw new TypeError('attachOfficialEvents must be a function');
  const web = new URL(webOrigin);
  if (desktop ? !['dsh-app://app', 'app://app'].includes(webOrigin) :
      web.protocol !== 'http:' || !['127.0.0.1', 'localhost'].includes(web.hostname) || !web.port || web.origin !== webOrigin || web.username || web.password) throw new TypeError('Invalid DSH origin');
  if (typeof authenticateBrowser !== 'function') throw new TypeError('Browser authentication callback is required');
  const editorUpstream = upstreamOrigin(upstream?.origin, '127.0.0.1');
  const filmUpstream = upstreamOrigin(upstream?.filmOrigin, 'localhost');
  const key = upstream?.key;
  // The pinned release generates a 24-byte hexadecimal key when not advertised.
  if (typeof key !== 'string' || !/^[a-f0-9]{48}$/.test(key)) throw new TypeError('Invalid Studio key');
  let closed = false;
  let editorOrigin;
  let filmOrigin;
  let officialRequests = 0;
  // Facts for the panel when the frame stays silent: was the shell page even
  // served, and was the preload injected? No project data or secrets here.
  const diag = { html: 0, injected: 0, lastPath: '', lastStatus: 0, refusals: 0 };
  const sockets = new Set();
  const tickets = new Map();
  const sessions = new Map();
  const ticketLifetime = 60_000;
  const sessionLifetime = 30 * 60_000;
  const maxCredentials = 128;
  const cookieName = 'dsh_openfilm_session';
  function prune(map) {
    const now = Date.now();
    for (const [token, expiry] of map) if (expiry <= now) map.delete(token);
  }
  function authenticated(req) {
    if (closed) return false;
    // A ticket session is as strong as the cookie it was exchanged for: it is
    // minted only from a Host-issued one-use ticket, HttpOnly and short-lived.
    // Accepting it on both surfaces is what lets a browser without DSH's cookie
    // (the built-in one, another browser) keep using the page it just opened.
    prune(sessions);
    const matches = String(req.headers.cookie || '').split(';').map((part) => part.trim()).filter((part) => part.startsWith(`${cookieName}=`));
    if (matches.length === 1 && sessions.has(matches[0].slice(cookieName.length + 1))) return true;
    if (desktop) return false;
    try { return authenticateBrowser(req) === true; } catch { return false; }
  }
  function desktopBridge(req, res) {
    // A ticket is a one-use, 60 s grant minted only by an authenticated Host
    // request. Serving it to a top-level tab is how the same local Studio can be
    // opened in a separate browser that has no DSH cookie.
    if (!req.url?.startsWith('/__dsh/')) return false;
    if (closed || req.headers.host !== new URL(editorOrigin).host) { fail(res); return true; }
    const site = req.headers['sec-fetch-site'];
    if (req.url === '/__dsh/open' && req.method === 'GET') {
      if (!['iframe', 'document'].includes(req.headers['sec-fetch-dest']) || !['cross-site', 'none'].includes(site) ||
          (req.headers.origin && req.headers.origin !== webOrigin && req.headers.origin !== 'null')) { fail(res); return true; }
      const body = `<!doctype html><meta charset="utf-8"><body><script>(async()=>{const ticket=location.hash.slice(1);history.replaceState(null,'',location.pathname);try{const r=await fetch('/__dsh/session',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({ticket})});if(!r.ok){document.body.textContent='Unable to open OpenFilm Studio (OF_TICKET_REJECTED).';return}const check=await fetch('/__dsh/session',{cache:'no-store'});if(!check.ok){document.body.textContent='Unable to open OpenFilm Studio (OF_SESSION_COOKIE_UNAVAILABLE). Partitioned secure cookies may be unavailable.';return}location.replace('/');return}catch{}document.body.textContent='Unable to open OpenFilm Studio (OF_BRIDGE_FAILED).'})()</script></body>`;
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'referrer-policy': 'no-referrer', 'x-content-type-options': 'nosniff', 'content-security-policy': `default-src 'none'; script-src 'unsafe-inline'; connect-src 'self'; frame-ancestors ${ancestorsFor(webOrigin)}`, 'content-length': Buffer.byteLength(body) });
      res.end(body);
      return true;
    }
    if (req.url === '/__dsh/session' && req.method === 'GET') {
      if (site !== 'same-origin' || (req.headers.origin && req.headers.origin !== editorOrigin) || !authenticated(req)) fail(res);
      else { res.writeHead(204, { 'cache-control': 'no-store' }); res.end(); }
      return true;
    }
    if (req.url !== '/__dsh/session' || req.method !== 'POST' || req.headers.origin !== editorOrigin || site !== 'same-origin' ||
        !/^application\/json(?:\s*;|$)/i.test(String(req.headers['content-type'] || ''))) { fail(res); return true; }
    let length = 0;
    const chunks = [];
    req.on('data', (chunk) => {
      length += chunk.length;
      if (length > 512) { fail(res, 413); req.destroy(); return; }
      chunks.push(chunk);
    });
    req.on('error', () => { if (!res.destroyed && !res.writableEnded) fail(res, 400); });
    req.on('end', () => {
      if (closed || res.writableEnded || res.destroyed) return;
      let value;
      try { value = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { return fail(res, 400); }
      if (!value || Array.isArray(value) || Object.keys(value).length !== 1 || typeof value.ticket !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(value.ticket)) return fail(res);
      prune(tickets);
      prune(sessions);
      if (!tickets.has(value.ticket) || sessions.size >= maxCredentials) return fail(res);
      // No await between checking and deleting: only one request can consume a ticket.
      tickets.delete(value.ticket);
      const session = randomBytes(32).toString('base64url');
      sessions.set(session, Date.now() + sessionLifetime);
      say.info('ticket-redeemed', { desktop, active: sessions.size });
      res.writeHead(204, { 'cache-control': 'no-store', 'set-cookie': `${cookieName}=${session}; HttpOnly; Secure; SameSite=None; Partitioned; Path=/; Max-Age=${sessionLifetime / 1000}` });
      res.end();
    });
    return true;
  }
  function rejectionReason(req, film) {
    const expected = new URL(film ? filmOrigin : editorOrigin);
    if (closed || req.headers.host !== expected.host) return 'OF_HOST_REJECTED';
    const origin = req.headers.origin;
    const desktopNavigation = desktop && !film && req.method === 'GET' && req.headers['sec-fetch-dest'] === 'iframe' && authenticated(req);
    if (origin && origin !== editorOrigin && !(film && origin === filmOrigin) && !(desktopNavigation && (origin === webOrigin || origin === 'null'))) return 'OF_ORIGIN_REJECTED';
    if (!film) {
      const site = req.headers['sec-fetch-site'];
      if (site !== undefined && !['same-origin', 'same-site', 'none'].includes(site) && !(desktopNavigation && site === 'cross-site')) return 'OF_SITE_REJECTED';
      if (!origin && !['GET', 'HEAD'].includes(req.method)) return 'OF_METHOD_REJECTED';
      if (!origin && !['same-origin', 'same-site', 'none'].includes(site) && !(desktopNavigation && site === 'cross-site')) return 'OF_METADATA_MISSING';
    } else if (!['GET', 'HEAD'].includes(req.method)) return 'OF_METHOD_REJECTED';
    return null;
  }
  function permitted(req, film) { return rejectionReason(req, film) === null; }
  function forward(req, res, film) {
    const refuse = (code) => {
      if (!film && req.method === 'GET' && ['iframe', 'document'].includes(req.headers['sec-fetch-dest'])) {
        res.writeHead(403, { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' });
        return res.end(`无法打开 OpenFilm 工作台 (${code})。请刷新 DSH 后重试。\nUnable to open OpenFilm Studio (${code}). Refresh DSH and retry.`);
      }
      return fail(res);
    };
    // Only navigations, so the log answers "what did the browser actually ask
    // for, and did it still carry the session" without recording every asset.
    const dest = req.headers['sec-fetch-dest'];
    if (!film && req.method === 'GET' && (dest === 'document' || dest === 'iframe')) {
      say.info('nav', { route: req.url.split('?')[0].slice(0, 60), dest, authed: Boolean(req.headers.cookie && req.headers.cookie.includes(cookieName)) });
    }
    const rejection = rejectionReason(req, film);
    if (rejection) return refuse(rejection);
    if (!film && !authenticated(req)) return refuse('OF_SESSION_REQUIRED');
    let url;
    try {
      if (!req.url?.startsWith('/') || req.url.startsWith('//') || req.url.includes('\\')) return fail(res);
      url = new URL(req.url, 'http://proxy.invalid');
      let path = decodeURIComponent(url.pathname);
      if (path.includes('\\') || path.split('/').some((part) => part === '.' || part === '..')) return fail(res);
      // No aliases or trailing slashes for key-bearing open endpoints.
      path = path.replace(/\/+$/, '') || '/';
      if (film && !/^\/p\/[A-Za-z0-9_-]+(?:\/|$)/.test(path)) return fail(res);
      if (!film && (path === '/open' || path === '/api/open' || path.startsWith('/open/') || path.startsWith('/api/open/'))) return fail(res);
      if (url.searchParams.has('key') || (desktop && (url.searchParams.has('ticket') || path === '/__dsh' || path.startsWith('/__dsh/')))) return fail(res);
    } catch { return fail(res, 400); }
    const target = film ? filmUpstream : editorUpstream;
    const headers = { host: target.host, 'x-studio-key': key, 'accept-encoding': 'identity' };
    for (const [name, value] of Object.entries(req.headers)) if (SAFE_HEADERS.has(name) && value !== undefined) headers[name] = value;
    if (req.headers.origin) headers.origin = film && req.headers.origin === filmOrigin ? filmUpstream.origin : editorUpstream.origin;
    const remote = request({ hostname: '127.0.0.1', port: target.port, method: req.method, path: req.url, headers }, (up) => {
      up.on('error', (error) => {
        say.error('upstream-error', { path: (() => { try { return new URL(req.url, 'http://x').pathname; } catch { return '?'; } })(), message: String(error?.code || error?.message || error) });
        if (!res.destroyed && !res.writableEnded) fail(res, 502);
      });
      const status = up.statusCode || 502;
      if ((status >= 300 && status < 400 && status !== 304) ||
          (status !== 304 && up.headers['content-encoding'] && up.headers['content-encoding'] !== 'identity')) {
        up.resume(); return fail(res, 502);
      }
      const out = {};
      for (const [name, value] of Object.entries(up.headers)) {
        if (RESPONSE_HEADERS.has(name) && typeof value === 'string') out[name] = value;
      }
      const forbidden = [key, encodeURIComponent(key), Buffer.from(key).toString('base64'), editorUpstream.origin, filmUpstream.origin];
      const headerText = JSON.stringify(out);
      if (forbidden.some((value) => headerText.includes(value))) { up.resume(); return fail(res, 502); }
      if (film) {
        out['access-control-allow-origin'] = editorOrigin;
        out['x-content-type-options'] = 'nosniff';
      }
      out['cache-control'] = 'no-store';
      out['referrer-policy'] = 'no-referrer';
      const type = String(up.headers['content-type'] ?? '').toLowerCase();
      out['x-content-type-options'] = 'nosniff';
      if (!film && (type.startsWith('image/svg+xml') || (url.pathname.startsWith('/api/') && (type.startsWith('text/html') || type.startsWith('application/xhtml+xml'))))) {
        // User-provided SVG/HTML must not acquire the editor's API origin.
        out['content-security-policy'] = "sandbox; default-src 'none'; style-src 'unsafe-inline'";
      } else if (!film && (type.startsWith('text/html') || type.startsWith('application/xhtml+xml'))) {
        out['content-security-policy'] = `frame-ancestors ${ancestorsFor(desktop ? webOrigin : web.origin)}`;
      }
      const text = /^(text\/|application\/(json|javascript|xml|x-javascript))/.test(type);
      const stream = !text && (status === 206 || /^(audio\/|video\/|image\/|application\/(?:octet-stream|zip|x-zip-compressed)(?:\s*;|$))/.test(type));
      const noBody = req.method === 'HEAD' || status === 304 || status === 204 || status === 205;
      const needles = forbidden.map((value) => Buffer.from(value));
      const containsForbidden = (body) => needles.some((needle) => body.includes(needle));
      res.once('close', () => { if (!res.writableEnded) up.destroy(); });
      (async () => {
        try {
          if (noBody) {
            // HEAD describes the selected representation; rewritten text has no known length.
            if (req.method === 'HEAD' && status !== 304 && !text && /^\d+$/.test(String(up.headers['content-length'] ?? ''))) {
              out['content-length'] = up.headers['content-length'];
            }
            up.resume();
            res.writeHead(status, out);
            res.end();
            return;
          }
          if (text && status === 206) { up.resume(); return fail(res, 502); }
          if (stream) {
            if (/^\d+$/.test(String(up.headers['content-length'] ?? ''))) out['content-length'] = up.headers['content-length'];
            const tailLength = Math.max(...needles.map((needle) => needle.length)) - 1;
            let tail = Buffer.alloc(0);
            let started = false;
            const write = async (data) => {
              if (!data.length) return;
              if (res.destroyed) throw new Error('Client disconnected');
              if (!started) { res.writeHead(status, out); started = true; }
              if (!res.write(data)) await new Promise((resolve, reject) => {
                const done = () => { res.off('close', closed); resolve(); };
                const closed = () => { res.off('drain', done); reject(new Error('Client disconnected')); };
                res.once('drain', done);
                res.once('close', closed);
              });
            };
            for await (const chunk of up) {
              const data = Buffer.concat([tail, chunk]);
              if (containsForbidden(data)) { up.destroy(); return fail(res, 502); }
              const safeLength = Math.max(0, data.length - tailLength);
              await write(data.subarray(0, safeLength));
              tail = data.subarray(safeLength);
            }
            await write(tail);
            if (!started) res.writeHead(status, out);
            res.end();
            return;
          }
          const chunks = [];
          let length = 0;
          for await (const chunk of up) {
            length += chunk.length;
            if (length > MAX_RESPONSE) { up.destroy(); return fail(res, 502); }
            chunks.push(chunk);
          }
          if (res.destroyed || res.writableEnded) return;
          let body = Buffer.concat(chunks);
          if (text) {
            let value = body.toString('utf8');
            if (!Buffer.from(value).equals(body)) return fail(res, 502);
            value = value.replaceAll(filmUpstream.origin, filmOrigin);
            if (status >= 500 && !film) {
              recordFailure(req.method, url.pathname, status, value);
              say.warn('upstream-5xx', { method: req.method, path: url.pathname, status });
            }
            if (film && type.startsWith('text/html')) {
              value = value.replaceAll(`const EDITOR = ${JSON.stringify(editorUpstream.origin)};`, `const EDITOR = ${JSON.stringify(editorOrigin)};`);
            } else if (!film && type.startsWith('text/html') && !url.pathname.startsWith('/api/')) {
              diag.html += 1;
              diag.lastPath = url.pathname;
              diag.lastStatus = status;
              // The host marker is OpenFilm's public interface. Route observation is
              // specific to the pinned Studio version and carries no project content.
              const parentOrigin = JSON.stringify(webOrigin).replaceAll('<', '\\u003c');
              // Install the official preload facade only on Studio's own page,
              // never on arbitrary user HTML or API content. Its fixed-channel
              // transport is bound to the authenticated editor origin below.
              const officialPage = url.pathname === '/' || /^\/projects\/[A-Za-z0-9_-]{6,40}\/?$/.test(url.pathname);
              const transport = `async (channel,payload)=>{const r=await fetch('/__dsh/official-rpc',{method:'POST',credentials:'same-origin',headers:{'content-type':'application/json'},body:JSON.stringify({channel,payload})});if(!r.ok){let detail='';try{detail=(await r.text()).slice(0,300)}catch(e){}throw new Error('OpenFilm capability unavailable: '+channel+' ['+r.status+'] '+(detail||''));}return r.json()}`;
              const nativePrelude = officialShell && officialPage ? `<script>globalThis.openfilmNative=${officialFacadeSource}({invoke:${transport},upload:${officialUploadSource}});</script>` : '';
              // Visible, copyable failure reporting for a page we only partly control:
              // the official shell has no error UI of its own, so a thrown module or a
              // rejected promise otherwise leaves a blank frame with nothing to quote.
              // Text only, no user data, no stack beyond the first line.
              const diagnostics = officialShell ? '<script>(function(){' +
                'if(globalThis.__no996Diag)return;globalThis.__no996Diag=1;var n=0;' +
                'function show(m){try{if(n>3)return;n++;var d=document.getElementById("no996-diag");' +
                'if(!d){d=document.createElement("div");d.id="no996-diag";' +
                'd.style.cssText="position:fixed;left:12px;right:12px;bottom:12px;z-index:2147483647;background:#7f1d1d;color:#fff;font:12px/1.5 ui-monospace,Consolas,monospace;padding:10px 40px 10px 12px;border-radius:8px;max-height:40vh;overflow:auto;white-space:pre-wrap;text-align:left";' +
                'document.documentElement.appendChild(d);' +
                'var b=document.createElement("button");b.textContent="×";b.style.cssText="position:absolute;right:8px;top:4px;background:transparent;border:0;color:#fff;font-size:18px;cursor:pointer";b.onclick=function(){d.remove()};d.appendChild(b);}' +
                'd.appendChild(document.createTextNode(String(m)+"\\n"));}catch(e){}}' +
                'globalThis.__no996ShowError=show;' +
                'addEventListener("error",function(e){var m=e.message||"unknown";if(/ResizeObserver loop/.test(m))return;show("[JS] "+m+" @ "+(e.filename||"")+":"+(e.lineno||0));});' +
                'addEventListener("unhandledrejection",function(e){var r=e.reason;var m=(r&&r.message)||String(r);var s=(r&&r.stack)||"";var at=String(s).split("\\n").filter(function(l){return l.indexOf("at ")>=0}).slice(0,3).join(" | ");show("[Promise] "+m+(at?"\\n"+at:""));});' +
                'var ce=console.error;console.error=function(){try{if(n<4){for(var i=0;i<arguments.length;i++){var a=arguments[i];if(a instanceof Error){show("[React] "+(a.message||a.name));break;}}}}catch(e){}return ce.apply(console,arguments);};' +
                'var f=globalThis.fetch;if(f)globalThis.fetch=function(u,o){return f.apply(this,arguments).then(function(r){try{var s=String(u);if((r.status>=500||(r.status===404&&s.indexOf("/api/projects")>=0))&&n<4){var base="[HTTP "+r.status+"] "+s.slice(0,180);if(r.status>=500){r.clone().text().then(function(t){var why="";try{var j=JSON.parse(t);if(j&&typeof j.error==="string"&&j.error)why=" - "+j.error.slice(0,240);}catch(e){}show(base+why);}).catch(function(){show(base);});}else show(base);}}catch(e){}return r;},function(e){try{if(n<4)show("[网络] "+String(u).slice(0,180)+" "+((e&&e.message)||e));}catch(_){}throw e;});};' +
                'setTimeout(function(){try{parent.postMessage({type:"no996-openfilm:boot",version:1,hasNative:!!globalThis.openfilmNative,rendered:!!(document.getElementById("root")||{}).firstElementChild},' + "'*'" + ')}catch(e){}},1500);' +
                'setTimeout(function(){var r=document.getElementById("root");if(r&&!r.firstElementChild)show("界面 10 秒后仍未渲染（#root 为空）");},10000);' +
                '})()</script>' : '';
              const host = `${diagnostics}${nativePrelude}<script>try{
// Studio keeps its workspace layout in this origin's localStorage. Seed it once
// with the chat docked on the right: Studio then insets the right side itself,
// so the chat has no empty band on the left.
if(!localStorage.getItem('openfilm.workspace.current.v2')){
  var base={mode:'edit',tree:null,assets:false,layers:false,timeline:true,inspector:true,chat:true,libraryDock:'chat',chatSide:'left',layersSide:'left',inspectorSide:'right',timelineEdge:'bottom',assetsWidth:320,libraryHeight:280,layersWidth:240,inspectorWidth:360,timelineHeight:null,chatWidth:420};
  var plan=JSON.parse(JSON.stringify(base));plan.mode='canvas';plan.timeline=false;plan.inspector=false;
  localStorage.setItem('openfilm.workspace.current.v2',JSON.stringify({version:2,edit:base,canvas:plan}));
}else{
  // Earlier builds seeded chatSide:'right'. Move only that seeded shape back to
  // upstream's default; a layout someone rearranged by hand is left alone.
  try{
    var saved=JSON.parse(localStorage.getItem('openfilm.workspace.current.v2'));
    if(saved&&saved.edit&&saved.edit.chatSide==='right'&&saved.edit.chatWidth===420){
      saved.edit.chatSide='left';
      if(saved.canvas&&saved.canvas.chatSide==='right')saved.canvas.chatSide='left';
      localStorage.setItem('openfilm.workspace.current.v2',JSON.stringify(saved));
    }
  }catch(e){}
}
}catch(e){}globalThis.openfilmHost={version:1,name:'DSH'};
(function(){
  const parentOrigin=${parentOrigin}, targetOrigin=${desktop ? "'*'" : parentOrigin};
  let last;
  function report(force){
    const match=/^\\/projects\\/([\\w-]{6,40})\\/?$/.exec(location.pathname);
    const projectId=match?match[1]:null;
    if(!force&&last===projectId)return;
    last=projectId;
    try{if(parent!==window)parent.postMessage({type:'no996-openfilm:project',version:1,projectId},targetOrigin)}catch{}
  }
  for(const name of ['pushState','replaceState']){
    const original=history[name];
    history[name]=function(...args){const result=original.apply(this,args);report(false);return result};
  }
  addEventListener('popstate',()=>report(false));
  addEventListener('message',event=>{
    if(event.source!==parent||parent===window||!(event.origin===parentOrigin||(${desktop}&&event.origin==='null')))return;
    const data=event.data;
    if(data&&typeof data==='object'&&!Array.isArray(data)&&Object.keys(data).length===2&&data.type==='no996-openfilm:project-snapshot-request'&&data.version===1)report(true);
    // Layout requests come from the standalone browser page (or any trusted
    // parent on this origin): the same placement calls the app's own controls use.
    if(data&&typeof data==='object'&&data.type==='no996-openfilm:layout'&&data.version===1){
      const h=globalThis.openfilmHost;
      if(h&&h.panel){
        if(data.side==='left'||data.side==='right'){try{h.panel.setPlacement({side:data.side,libraryDock:'left'})}catch(e){}}
        if(typeof data.width==='number'&&isFinite(data.width)){try{h.panel.setWidth(Math.max(240,Math.min(800,data.width)),true)}catch(e){}}
      }
    }
  });
  report(true);
})();
</script>${officialShell && officialPage ? shellUiInjection() : ''}<style>[data-app-menu]>[role="menuitem"]:not(:first-child),[data-community-menu]{display:none!important}</style>`;
              value = value.replace(/<head(?:\s[^>]*)?>/i, match => match + host);
              if (value.includes('__no996Diag')) diag.injected += 1;
              else diag.refusals += 1;
            }
            body = Buffer.from(value);
            delete out.etag;
            delete out['last-modified'];
          }
          if (containsForbidden(body)) return fail(res, 502);
          out['content-length'] = String(body.length);
          res.writeHead(status, out);
          res.end(body);
        } catch {
          up.destroy();
          if (!res.destroyed && !res.writableEnded) fail(res, 502);
        }
      })();
    });
    remote.on('error', () => fail(res, 502));
    req.on('error', () => remote.destroy());
    res.on('close', () => { if (!res.writableEnded) remote.destroy(); });
    req.pipe(remote);
  }
  // Lets the page notice that the injected overlay changed on disk, so a saved
  // shell-ui.js reaches a long-lived desktop window without reopening the panel.
  function shellVersion(req, res) {
    if (!officialShell || req.url !== '/__dsh/shell-version') return false;
    if (req.method !== 'GET' || !permitted(req, false) || !authenticated(req)) { fail(res); return true; }
    const body = JSON.stringify({ version: shellUiVersion() });
    res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', 'content-length': Buffer.byteLength(body) });
    res.end(body);
    return true;
  }
  // Fixed-channel official Chat RPC rides the existing authenticated editor
  // origin. No renderer-supplied path or upstream secret is accepted here.
  function officialBridge(req, res) {
    if (!officialShell || req.url !== '/__dsh/official-rpc') return false;
    // A browser session alone is not project authority. Until the Host can bind
    // this request to a trusted project scope, reject all project Chat RPCs.
    if (typeof officialRpc !== 'function' || typeof authorizeOfficialProject !== 'function' || req.method !== 'POST' || !permitted(req, false) || !authenticated(req) ||
        req.headers.origin !== editorOrigin || req.headers['sec-fetch-site'] !== 'same-origin' ||
        !/^application\/json(?:\s*;|$)/i.test(String(req.headers['content-type'] || ''))) {
      fail(res); return true;
    }
    // Bound aggregate buffered request data before reading a body; limiting
    // each request alone still allows many concurrent 9 MiB allocations.
    if (officialRequests >= 4) { fail(res, 503); return true; }
    officialRequests += 1;
    void (async () => {
      try {
        const chunks = [];
        let length = 0;
        for await (const chunk of req) {
          length += chunk.length;
          if (length > 9 * 1024 * 1024) { fail(res, 413); req.destroy(); return; }
          chunks.push(chunk);
        }
        const value = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        if (!value || typeof value !== 'object' || Array.isArray(value) ||
            Object.keys(value).length !== 2 || typeof value.channel !== 'string' || !Object.hasOwn(value, 'payload')) return fail(res, 400);
        // These fixed channels do not access project data; they still require
        // the editor's authenticated origin, cookie and same-site checks above.
        // `client:log` is here too: it is a page-side diagnostic line about this
        // page itself, it carries no project id, and gating it on a project made
        // the page's own logging fail with an empty 403 body.
        const needsProject = value.channel !== 'template:list' && value.channel !== 'template:create'
          && value.channel !== 'environment:check' && value.channel !== 'client:log';
        if (needsProject && await authorizeOfficialProject(req, value.payload?.projectId) !== true) return fail(res);
        const result = await officialRpc(value.channel, value.payload);
        if (closed || res.destroyed || res.writableEnded) return;
        const body = Buffer.from(JSON.stringify(result));
        if (body.length > 9 * 1024 * 1024) return fail(res, 502);
        res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', 'content-length': body.length });
        res.end(body);
      } catch (error) {
        // Never forward arbitrary exception text: providers and filesystem errors
        // may contain credentials or private paths. The turn reason is emitted
        // only when it is one of the explicitly recognized fixed values.
        const code = typeof error?.code === 'string' && /^[A-Z][A-Z0-9_]{2,40}$/.test(error.code) ? error.code : 'OFFICIAL_RPC_FAILED';
        const match = code === 'OFFICIAL_AGENT_TURN_FAILED' && typeof error?.message === 'string'
          ? /^Turn ended without completion \((aborted|blocked|error|max-tokens|interrupted|forked|unknown)\)$/.exec(error.message) : null;
        if (!res.destroyed && !res.writableEnded) {
          res.writeHead(503, { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' });
          res.end(match ? `${code}: ${match[1]}` : code);
        }
      } finally {
        officialRequests -= 1;
      }
    })();
    return true;
  }
  // Binary files chosen by the user go through the existing Studio import
  // endpoint, not an unrestricted Host filesystem write. A trusted project
  // scope is required independently of the renderer-provided project ID. This
  // gate does not yet restrict Studio's general /api/projects routes: the
  // official shell must remain disabled until that boundary is also addressed.
  function officialUpload(req, res) {
    let url;
    try { url = new URL(req.url, 'http://proxy.invalid'); } catch { return false; }
    if (!officialShell || url.pathname !== '/__dsh/official-upload') return false;
    const values = [...url.searchParams.keys()];
    const projectId = url.searchParams.get('projectId');
    const name = url.searchParams.get('name');
    const size = Number(req.headers['content-length']);
    if (typeof authorizeOfficialProject !== 'function' || req.method !== 'PUT' || !permitted(req, false) || !authenticated(req) ||
        req.headers.origin !== editorOrigin || req.headers['sec-fetch-site'] !== 'same-origin' ||
        String(req.headers['content-type'] || '').toLowerCase() !== 'application/octet-stream' ||
        values.length !== 2 || new Set(values).size !== 2 || !values.includes('projectId') || !values.includes('name') ||
        typeof projectId !== 'string' || !/^[A-Za-z0-9_-]{6,40}$/.test(projectId) ||
        typeof name !== 'string' || !name || name.length > 200 || name.startsWith('.') || /[\\/\\\\<>:\"|?*\\x00-\\x1f\\x7f]/.test(name) || /[. ]$/.test(name) ||
        /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\\.|$)/i.test(name) ||
        !Number.isSafeInteger(size) || size < 1) { fail(res); return true; }
    if (size > 256 * 1024 * 1024) { fail(res, 413); return true; }
    if (officialRequests >= 4) { fail(res, 503); return true; }
    officialRequests += 1;
    let remote;
    let released = false;
    const release = () => { if (!released) { released = true; officialRequests -= 1; } };
    res.once('close', () => { if (remote && !res.writableEnded) remote.destroy(); release(); });
    void (async () => {
      try {
        if (await authorizeOfficialProject(req, projectId) !== true || closed || res.destroyed) return fail(res);
        const target = `/api/projects/${encodeURIComponent(projectId)}/files?path=${encodeURIComponent(`assets/upload/${name}`)}`;
        remote = request({ hostname: editorUpstream.hostname, port: editorUpstream.port, method: 'PUT', path: target,
          headers: { host: editorUpstream.host, 'x-studio-key': key, 'content-type': 'application/octet-stream', 'content-length': size, 'accept-encoding': 'identity', origin: editorUpstream.origin } }, up => {
          void (async () => {
            try {
              if (up.statusCode !== 200) { up.resume(); return fail(res, 502); }
              let length = 0;
              const chunks = [];
              for await (const chunk of up) { length += chunk.length; if (length > 65536) { up.destroy(); return fail(res, 502); } chunks.push(chunk); }
              const result = JSON.parse(Buffer.concat(chunks).toString('utf8'));
              const path = result?.path;
              if (typeof path !== 'string' || !path.startsWith('assets/upload/') || path.includes('\\\\') || path.split('/').some(part => !part || part === '.' || part === '..') || path.includes(key)) return fail(res, 502);
              // Studio commits the file before probing. A failed probe is not a
              // rollback: it may even have reused a pre-existing user file.
              if (result.unreadable) { res.writeHead(422, { 'cache-control': 'no-store' }); res.end(); return; }
              const body = Buffer.from(JSON.stringify({ path }));
              if (!res.destroyed && !res.writableEnded) { res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', 'content-length': body.length }); res.end(body); }
            } catch { if (!res.destroyed && !res.writableEnded) fail(res, 502); }
          })();
        });
        remote.on('error', () => { if (!res.destroyed && !res.writableEnded) fail(res, 502); });
        let received = 0;
        req.on('data', chunk => { received += chunk.length; if (received > size) { remote.destroy(); req.destroy(); } });
        req.on('aborted', () => remote.destroy());
        req.on('error', () => remote.destroy());
        req.pipe(remote);
      } catch { if (!res.destroyed && !res.writableEnded) fail(res, 503); }
    })();
    return true;
  }
  // Server-sent events for one authorized project. The DSH page cannot reach the
  // editor origin's cookie, so this rides the same authenticated proxy origin
  // as the RPC instead of exposing the Studio port.
  function officialEvents(req, res) {
    let url;
    try { url = new URL(req.url, 'http://proxy.invalid'); } catch { return false; }
    if (!officialShell || url.pathname !== '/__dsh/official-events') return false;
    const projectId = url.searchParams.get('projectId');
    if (typeof attachOfficialEvents !== 'function' || req.method !== 'GET' || !permitted(req, false) || !authenticated(req) ||
        (req.headers.origin !== undefined && req.headers.origin !== editorOrigin) || req.headers['sec-fetch-site'] !== 'same-origin' ||
        url.searchParams.size !== 1 || typeof projectId !== 'string' || !/^[A-Za-z0-9_-]{6,40}$/.test(projectId)) {
      fail(res); return true;
    }
    void (async () => {
      try {
        if (await authorizeOfficialProject(req, projectId) !== true || closed || res.destroyed) { fail(res); return; }
        await attachOfficialEvents({ projectId, res, req });
      } catch { if (!res.destroyed && !res.headersSent) fail(res, 503); else if (!res.destroyed) res.end(); }
    })();
    return true;
  }
  const editor = createServer((req, res) => { if (!officialEvents(req, res) && !officialUpload(req, res) && !shellVersion(req, res) && !officialBridge(req, res) && !desktopBridge(req, res)) forward(req, res, false); });
  const film = createServer((req, res) => forward(req, res, true));
  film.on('upgrade', (_req, socket) => socket.destroy());
  editor.on('upgrade', (req, socket, head) => {
    socket.on('error', () => socket.destroy());
    let parsed;
    try { parsed = new URL(req.url, editorOrigin); } catch { return socket.destroy(); }
    const global = parsed.pathname === '/api/events';
    const project = /^\/api\/projects\/[^/]+\/events$/.test(parsed.pathname);
    if (!permitted(req, false) || req.headers.origin !== editorOrigin || (!global && !project) ||
        parsed.searchParams.has('key') || (desktop && parsed.searchParams.has('ticket')) || parsed.origin !== editorOrigin || req.headers['sec-websocket-version'] !== '13' ||
        typeof req.headers['sec-websocket-key'] !== 'string' || !/^[A-Za-z0-9+/]{22}==$/.test(req.headers['sec-websocket-key']) ||
        String(req.headers.upgrade).toLowerCase() !== 'websocket') return socket.destroy();
    if (!authenticated(req)) return socket.destroy();
    const nonce = randomBytes(16).toString('base64');
    const expectedAccept = createHash('sha1').update(nonce + WS_GUID).digest('base64');
    const remote = request({ hostname: editorUpstream.hostname, port: editorUpstream.port, path: req.url,
      headers: { host: editorUpstream.host, connection: 'Upgrade', upgrade: 'websocket',
        'sec-websocket-version': '13', 'sec-websocket-key': nonce, 'x-studio-key': key, origin: editorUpstream.origin } });
    sockets.add(socket);
    let peer;
    const recheck = setInterval(() => { if (!authenticated(req)) close(); }, 30_000);
    recheck.unref();
    const close = () => { clearInterval(recheck); sockets.delete(socket); socket.destroy(); peer?.destroy(); remote.destroy(); };
    socket.once('close', close);
    remote.on('error', close);
    remote.on('response', (response) => { response.resume(); close(); });
    remote.on('upgrade', (response, upstreamSocket, upstreamHead) => {
      peer = upstreamSocket;
      peer.on('error', close);
      peer.once('close', close);
      if (!authenticated(req) || response.headers['sec-websocket-accept'] !== expectedAccept || response.headers['sec-websocket-extensions']) return close();
      const accept = createHash('sha1').update(req.headers['sec-websocket-key'] + WS_GUID).digest('base64');
      socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`);
      const clientFrames = frames(socket, true, (opcode, data) => {
        if (!authenticated(req)) return close();
        if (opcode !== 1 || !global) return close();
        try {
          const value = JSON.parse(data.toString('utf8'));
          if (!value || Object.keys(value).length !== 1 || typeof value.visible !== 'boolean') return close();
          peer.write(wsFrame(1, Buffer.from(JSON.stringify({ visible: value.visible })), true));
        } catch { close(); }
      }, close);
      const serverFrames = frames(peer, false, (opcode, data) => {
        if (!authenticated(req) || opcode !== 1) return close();
        try {
          const value = JSON.parse(data.toString('utf8'));
          if (!value || Array.isArray(value) || typeof value.type !== 'string') return close();
          let text = JSON.stringify(value).replaceAll(filmUpstream.origin, filmOrigin);
          if (text.includes(key) || text.includes(editorUpstream.origin) || text.includes(filmUpstream.origin)) return close();
          socket.write(wsFrame(1, Buffer.from(text), false));
        } catch { close(); }
      }, close);
      if (head.length) clientFrames(head);
      if (upstreamHead.length) serverFrames(upstreamHead);
    });
    remote.end();
  });
  try {
    // The editor must use the DSH page's hostname so its host-only browser
    // session cookie remains available. Film pages use the other hostname.
    const editorHost = desktop ? '127.0.0.2' : web.hostname;
    const filmHost = editorHost === 'localhost' ? '127.0.0.1' : 'localhost';
    editorOrigin = `http://${editorHost}:${await listen(editor, desktop ? editorHost : '127.0.0.1', Number(process.env.NO996_OPENFILM_EDITOR_PORT || 47822))}`;
    filmOrigin = `http://${filmHost}:${await listen(film, '127.0.0.1')}`;
  } catch {
    await Promise.all([shutdown(editor), shutdown(film)]);
    throw new Error('Studio proxy could not start');
  }
  // Two Studio calls the template installer needs. They stay inside this module
  // so the Studio key never leaves it.
  function studioCall(method, path, body) {
    return new Promise((resolve, reject) => {
      const payload = body === undefined ? undefined : Buffer.from(JSON.stringify(body));
      const req = request({ hostname: editorUpstream.hostname, port: editorUpstream.port, method, path,
        headers: { host: editorUpstream.host, 'x-studio-key': key, 'accept-encoding': 'identity', origin: editorUpstream.origin,
          ...(payload ? { 'content-type': 'application/json', 'content-length': payload.length } : {}) } }, (reply) => {
        const chunks = [];
        reply.on('data', chunk => { if (chunks.length < 512) chunks.push(chunk); });
        reply.on('end', () => {
          let value;
          try { value = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { value = undefined; }
          resolve({ status: reply.statusCode, value });
        });
      });
      req.on('error', () => reject(new Error('Studio request failed')));
      if (payload) req.write(payload);
      req.end();
    });
  }

  return Object.freeze({
    editorOrigin,
    diagnostics: () => ({ ...diag, mode: officialShell ? 'official' : 'dsh' }),
    async listProjects() {
      const reply = await studioCall('GET', '/api/projects');
      const items = Array.isArray(reply.value) ? reply.value : reply.value?.projects;
      if (reply.status !== 200 || !Array.isArray(items)) throw new Error('Studio project list unavailable');
      return items.map(project => ({ id: String(project.id), path: String(project.path) }));
    },
    async createProject(projectPath) {
      if (typeof projectPath !== 'string' || !projectPath) throw new Error('A project path is required');
      // Opening a folder as a project (projects.mjs openProject): the folder is
      // made when missing, a film.html already there is never touched, and the
      // project joins the library list. The reply is unwrapped leniently so a
      // ({project} | project) shape both work.
      const reply = await studioCall('POST', '/api/projects', { path: projectPath });
      if (reply.status !== 200) throw new Error(`Studio refused the project (HTTP ${reply.status})`);
      const project = reply.value?.project ?? reply.value;
      const id = project?.id ?? project?.projectId;
      if (typeof id !== 'string' || !id) throw new Error('Studio returned no project id');
      return { id, path: typeof project.path === 'string' ? project.path : projectPath };
    },
    issueTicket() {
      if (closed) return null;
      prune(tickets);
      if (tickets.size >= maxCredentials) return null;
      const ticket = randomBytes(32).toString('base64url');
      tickets.set(ticket, Date.now() + ticketLifetime);
      say.info('ticket-minted', { desktop, pending: tickets.size });
      return { url: `${editorOrigin}/__dsh/open#${ticket}`, expiresIn: Math.round(ticketLifetime / 1000) };
    },
    bootstrapData() {
      if (desktop) {
        prune(tickets);
        if (tickets.size >= maxCredentials) return null;
        const ticket = randomBytes(32).toString('base64url');
        tickets.set(ticket, Date.now() + ticketLifetime);
        return { editorOrigin, ticket, mode: officialShell ? 'official' : 'dsh', webOrigin };
      }
      return { editorOrigin, mode: officialShell ? 'official' : 'dsh', webOrigin };
    },
    bootstrap(res) {
      if (closed) return fail(res);
      const data = this.bootstrapData();
      if (!data) return fail(res, 503);
      const body = JSON.stringify({ ...data, diagnostics: diag });
      res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store', 'referrer-policy': 'no-referrer', 'content-length': Buffer.byteLength(body) });
      res.end(body);
    },
    async close() {
      closed = true;
      tickets.clear();
      sessions.clear();
      for (const socket of sockets) socket.destroy();
      sockets.clear();
      await Promise.all([shutdown(editor), shutdown(film)]);
    },
  });
}
