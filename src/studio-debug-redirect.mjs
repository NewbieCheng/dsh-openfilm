import { createServer } from 'node:http';

/**
 * A small console on the fixed loopback port.
 *
 * Why it exists: the right-side browser does not share DSH's session cookie, so
 * every DSH route answers 401 there. The only origin it can reach is this
 * listener, so the template list and the "make a project" button live here and
 * all Studio work happens in the Host behind them.
 *
 * Loopback only; bound to the same port as the editor window, so one bookmark
 * covers both: `/` is the template console, `/editor` opens the editor page.
 */
export function startLocalConsole({
  port = Number(process.env.NO996_OPENFILM_DEBUG_PORT || 47821),
  templates = async () => [],
  editorUrl = () => null,
} = {}) {
  const escape = value => String(value).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]);

  const page = (body) => `<!doctype html><meta charset="utf-8"><title>OpenFilm 模板</title>
<style>
  :root { color-scheme: dark }
  body { font: 14px/1.6 system-ui, -apple-system, "Segoe UI", sans-serif; background:#161616; color:#e9e9e9; margin:0; padding:28px 32px }
  h1 { font-size:20px; margin:0 0 4px } .sub { opacity:.6; margin:0 0 22px }
  ul { list-style:none; padding:0; margin:0; display:grid; gap:12px; grid-template-columns:repeat(auto-fill,minmax(280px,1fr)) }
  li { border:1px solid #2e2e2e; border-radius:10px; padding:16px; background:#1d1d1d }
  h2 { font-size:15px; margin:0 0 6px } .tag { font-size:11px; padding:2px 6px; border-radius:999px; background:#2b3b33; color:#8fd3ac; margin-left:6px; vertical-align:2px }
  p { margin:0 0 12px; opacity:.75; font-size:13px }
  button, a.btn { display:inline-block; padding:7px 13px; border-radius:7px; border:1px solid #4a4a4a; background:#262626; color:inherit; cursor:pointer; font:inherit; text-decoration:none }
  button:hover, a.btn:hover { background:#313131 } button:disabled { opacity:.5; cursor:default }
  #msg { margin-top:18px } .ok { color:#7ddc9b } .err { color:#ff8a8a }
  code { background:#242424; padding:1px 5px; border-radius:4px }
</style>
<h1>OpenFilm 模板</h1>
<p class="sub">此调试页面仅供查看模板；请在视频创作面板中创建项目。</p>
<p><a class="btn" href="/editor">打开 OpenFilm Studio 编辑器 ›</a></p>
${body}
<script>
document.addEventListener('click', async (event) => {
  const button = event.target.closest('button[data-id]');
  if (!button) return;
  const msg = document.getElementById('msg');
  button.disabled = true; const label = button.textContent; button.textContent = '创建中…';
  try {
    const response = await fetch('/create?template=' + encodeURIComponent(button.dataset.id), { method: 'POST' });
    const data = await response.json();
    if (!response.ok || !data.projectId) throw new Error(data.error || ('HTTP ' + response.status));
    msg.className = 'ok';
    msg.innerHTML = '已创建项目 <code>' + data.projectId + '</code>' +
      (data.link ? ' · <a class="btn" href="' + data.link + '">打开编辑器</a>' : '') +
      '<br>回到左侧「视频创作」刷新即可看到它。';
  } catch (error) {
    msg.className = 'err'; msg.textContent = '创建失败：' + (error && error.message || error);
    button.disabled = false; button.textContent = label;
  }
});
</script>`;

  const server = createServer((req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1');
    const send = (status, type, body) => {
      if (res.writableEnded) return;
      res.writeHead(status, { 'content-type': type, 'cache-control': 'no-store', 'content-length': Buffer.byteLength(body) });
      res.end(body);
    };
    void (async () => {
      if (url.pathname === '/editor') {
        const location = await editorUrl();
        if (!location) return send(503, 'text/plain; charset=utf-8', '编辑器尚未就绪：请先在视频创作面板打开一次（或稍后重试）。');
        res.writeHead(302, { location, 'cache-control': 'no-store' }).end();
        return;
      }
      if (url.pathname === '/api/studio-url' && (req.method === 'GET' || req.method === 'OPTIONS')) {
        // The desktop window runs on a custom protocol (`dsh-app://app`), where a
        // relative /api/... request never reaches this Host — it is answered by
        // the app protocol handler with 404. So the panel asks this loopback
        // console for an editor address instead.
        //
        // No cookie is required, which matches /editor above: a bare loopback
        // address was never the authentication boundary here. The ticket is
        // single-use and expires in 60 seconds; the cookie it buys is HttpOnly.
        // `*` is safe because no credential is read or written by this route.
        const cors = {
          'access-control-allow-origin': '*',
          'access-control-allow-methods': 'GET, OPTIONS',
          'access-control-allow-headers': 'content-type',
          'access-control-max-age': '600',
          'cache-control': 'no-store',
        };
        if (req.method === 'OPTIONS') { res.writeHead(204, cors).end(); return; }
        const location = await editorUrl();
        if (!location) { res.writeHead(503, { ...cors, 'content-type': 'application/json; charset=utf-8' }).end(JSON.stringify({ error: 'editor not ready' })); return; }
        const target = new URL(location);
        const body = JSON.stringify({ origin: target.origin, ticket: target.hash.replace(/^#/, '') });
        res.writeHead(200, { ...cors, 'content-type': 'application/json; charset=utf-8', 'content-length': Buffer.byteLength(body) }).end(body);
        return;
      }
      if (url.pathname === '/create' && req.method === 'POST') {
        // A loopback address alone is not authentication: arbitrary web pages
        // can send cross-origin form POSTs. Project creation is available only
        // through the authenticated editor bridge.
        send(403, 'application/json; charset=utf-8', JSON.stringify({ error: '请在视频创作面板中创建项目。' }));
        return;
      }
      if (url.pathname !== '/' || req.method !== 'GET') return send(405, 'text/plain; charset=utf-8', '不支持的请求');
      let items = [];
      try { items = await templates(); } catch { /* an empty page still explains itself */ }
      const cards = items.map(item => `<li><h2>${escape(item.title)}<span class="tag">${escape(item.mode)}</span></h2><p>${escape(item.description || '')}</p></li>`).join('');
      send(200, 'text/html; charset=utf-8', page(`<ul>${cards || '<li><p>没有可用模板。</p></li>'}</ul><div id="msg"></div>`));
    })();
  });

  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => {
      server.off('error', reject);
      server.on('error', () => {});
      resolve({
        url: `http://127.0.0.1:${server.address().port}/`,
        close: () => new Promise(done => server.close(() => done())),
      });
    });
  });
}
