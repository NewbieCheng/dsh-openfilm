const ID = /^[A-Za-z0-9_-]{6,40}$/;
const MAX_EVENT_BYTES = 1024 * 1024;
// A slow but alive client must survive a burst; a dead one must not accumulate
// forever. Frames are small, so this backlog covers minutes of text.
const MAX_QUEUE_FRAMES = 4096;
const MAX_QUEUE_BYTES = 8 * 1024 * 1024;

/** Attach one project-scoped SSE response to the Host event hub.
 * The caller MUST authenticate the peer, validate Origin and authorize the
 * exact project scope before calling. This does not authenticate requests,
 * replay history or guarantee that the browser rendered a buffered event.
 *
 * Flow control: a `false` from `response.write` means "the socket buffer is
 * full", not "the client is gone". Treating it as a disconnect is what killed
 * every live turn under a burst (a large tool result plus streaming deltas),
 * so frames are queued and flushed on `drain` instead.
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
  let blocked = false;
  let draining = false;
  const queue = [];
  let queuedBytes = 0;

  function close() {
    if (closed) return;
    closed = true;
    if (timer) clearInterval(timer);
    stop?.();
    response.off('close', close);
    if (!response.destroyed && !response.writableEnded) response.end();
    try { onDisconnect?.(); } catch { /* teardown must still finish */ }
  }

  function armDrain() {
    if (draining || closed) return;
    draining = true;
    response.once('drain', () => {
      draining = false;
      blocked = false;
      flush();
    });
  }

  function flush() {
    while (!closed && !blocked && queue.length) {
      const frame = queue.shift();
      queuedBytes -= frame.bytes;
      try {
        if (!response.write(frame.text)) {
          blocked = true;
          armDrain();
          return;
        }
      } catch { close(); return; }
    }
  }

  function write(text) {
    if (closed || response.destroyed || response.writableEnded) { close(); return false; }
    // Fast path: nothing waiting, the socket accepted the chunk into its own
    // buffer. A `false` here only arms the drain listener; the chunk is queued
    // by Node and MUST NOT be treated as a failure.
    if (!blocked && queue.length === 0) {
      try {
        if (!response.write(text)) { blocked = true; armDrain(); }
        return true;
      } catch { close(); return false; }
    }
    const bytes = Buffer.byteLength(text, 'utf8');
    if (queue.length >= MAX_QUEUE_FRAMES || queuedBytes + bytes > MAX_QUEUE_BYTES) {
      // The reader is effectively gone. Closing is honest; silently dropping a
      // terminal event would leave the page waiting forever.
      close();
      return false;
    }
    queue.push({ text, bytes });
    queuedBytes += bytes;
    return true;
  }

  response.writeHead(200, {
    'content-type': 'text/event-stream; charset=utf-8',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
    connection: 'keep-alive',
  });
  response.once('close', close);
  try {
    stop = hub.subscribe(projectId, data => {
      if (typeof data !== 'string' || Buffer.byteLength(data, 'utf8') > MAX_EVENT_BYTES || /[\r\n]/.test(data)) { close(); return false; }
      return write(`data: ${data}\n\n`);
    });
    if (closed) { stop(); return close; }
    // Reconnection hint for the browser's EventSource, then readiness.
    if (!write('retry: 3000\n\n')) return close;
    if (!write('event: ready\ndata: {}\n\n')) return close;
    timer = setInterval(() => { write(': keep-alive\n\n'); }, 25_000);
    timer.unref?.();
    return close;
  } catch (error) {
    close();
    throw error;
  }
}
