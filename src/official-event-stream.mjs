const ID = /^[A-Za-z0-9_-]{6,40}$/;
const MAX_EVENT_BYTES = 1024 * 1024;

/** Attach one project-scoped SSE response to the Host event hub.
 * The caller MUST authenticate the peer, validate Origin and authorize the
 * exact project scope before calling. This does not authenticate requests,
 * replay history or guarantee that the browser rendered a buffered event.
 */
export function attachOfficialEventStream({ hub, projectId, response, onDisconnect } = {}) {
  if (!hub || typeof hub.subscribe !== 'function' || typeof projectId !== 'string' || !ID.test(projectId) ||
      !response || typeof response.writeHead !== 'function' || typeof response.write !== 'function' ||
      typeof response.once !== 'function' || typeof response.end !== 'function' ||
      (onDisconnect !== undefined && typeof onDisconnect !== 'function')) throw new TypeError('A hub, authorized project and writable response are required');
  if (response.destroyed || response.writableEnded || response.headersSent) throw new Error('Event stream is unavailable');
  let closed = false;
  let stop;
  let timer;
  function close() {
    if (closed) return;
    closed = true;
    if (timer) clearInterval(timer);
    stop?.();
    response.off('close', close);
    if (!response.destroyed && !response.writableEnded) response.end();
    try { onDisconnect?.(); } catch { /* teardown must still finish */ }
  }
  function write(value) {
    if (closed || response.destroyed || response.writableEnded) { close(); return false; }
    // A slow client is disconnected instead of accumulating an unbounded queue.
    // write(false) accepted this chunk but does not acknowledge browser receipt.
    try { if (!response.write(value)) { close(); return false; } return true; }
    catch { close(); return false; }
  }
  response.writeHead(200, { 'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', connection: 'keep-alive' });
  response.once('close', close);
  try {
    stop = hub.subscribe(projectId, data => {
      if (typeof data !== 'string' || Buffer.byteLength(data, 'utf8') > MAX_EVENT_BYTES || /[\r\n]/.test(data)) { close(); return false; }
      return write(`data: ${data}\n\n`);
    });
    if (closed) { stop(); return close; }
    if (!write('event: ready\ndata: {}\n\n')) return close;
    timer = setInterval(() => { write(': keep-alive\n\n'); }, 25_000);
    timer.unref?.();
    return close;
  } catch (error) {
    close();
    throw error;
  }
}
