// What the proxy is allowed to say upstream, and what it may show back.
//
// Two rules live here: header allow-lists (never forward a header just because it
// arrived) and the failure vocabulary (an upstream 5xx may be a raw child-process
// error carrying a PowerShell script — that never reaches the page).
import { appendFileSync, statSync, truncateSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Upstream 5xx bodies are the only description of a Studio failure the person
// can act on, and the page shows just the status. Keep the last few for
// diagnosis; never the request body, never a project path.
const failureLog = join(tmpdir(), 'dsh-openfilm-errors.jsonl');
export function recordFailure(method, path, status, body) {
  try {
    const line = JSON.stringify({ at: new Date().toISOString(), method, path, status, body: String(body).slice(0, 800) }) + '\n';
    appendFileSync(failureLog, line, 'utf8');
    if (statSync(failureLog).size > 64 * 1024) truncateSync(failureLog, 0);
  } catch { /* diagnostics must never affect the response */ }
}

/**
 * Upstream 5xx bodies can be raw child-process failures: Node's `Command failed:`
 * message carries the whole PowerShell script. Showing that to a person is
 * useless and, worse, the shell's fetch wrapper retries 5xx up to four times —
 * so a delete that cannot finish is attempted again and again.
 *
 * Recognise the class, answer with a short explanation, and use 409 so nothing
 * retries it. The original text still goes to the failure log for diagnosis.
 */
export const COMMAND_FAILURE = /Command failed:|powershell\.exe|spawn .* ENOENT/i;

/**
 * The same failed move has different causes per platform. Windows refuses a
 * directory a watcher still holds; macOS moves it by rename (POSIX allows that
 * with open handles), so a failure there is a permission or cross-volume one.
 */
export function projectDeleteMessage() {
  if (process.platform === 'win32') {
    return '这个项目的文件夹正被其他程序占用（通常是仍打开的 DSH 会话或文件监视），无法移入回收站。请关闭使用该文件夹的会话后再删除。';
  }
  if (process.platform === 'darwin') {
    return '这个项目的文件夹无法移入废纸篓。请检查访达权限（完全磁盘访问），或关闭仍在使用它的程序后再试。';
  }
  return '这个项目的文件夹无法移入回收站。请关闭仍在使用它的程序后再试。';
}

export function friendlyCommandFailure(text, pathname) {
  if (!COMMAND_FAILURE.test(text)) return null;
  const projectDelete = /^\/api\/projects\/[A-Za-z0-9_-]+\/?$/.test(pathname);
  const error = projectDelete ? projectDeleteMessage() : '操作失败：系统命令执行出错。详细原因已写入插件日志。';
  let json = null;
  try { json = JSON.parse(text); } catch { /* not JSON: answer with ours */ }
  const body = json && typeof json === 'object'
    ? JSON.stringify({ ...json, error, code: 'no996-command-failed' })
    : JSON.stringify({ error, code: 'no996-command-failed' });
  return { status: 409, body };
}

export const SAFE_HEADERS = new Set(['accept', 'accept-language', 'content-type', 'content-length', 'range', 'if-range', 'if-none-match', 'if-modified-since']);
export const RESPONSE_HEADERS = new Set(['content-type', 'content-range', 'accept-ranges', 'last-modified', 'etag', 'cache-control', 'content-disposition']);

export function upstreamOrigin(value, hostname) {
  const url = new URL(value);
  if (url.protocol !== 'http:' || url.hostname !== hostname || !url.port || url.origin !== value || url.username || url.password) throw new TypeError('Invalid upstream origin');
  return url;
}
export function listen(server, host, preferred = 0) {
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
export function shutdown(server) {
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
export function ancestorsFor(origin) {
  return `${origin} 'self' http://127.0.0.1:* http://localhost:* dsh-app: app:`;
}

export function fail(res, status = 403) {
  if (res.headersSent) return res.destroy();
  res.writeHead(status, { 'cache-control': 'no-store', 'content-length': '0' });
  res.end();
}
