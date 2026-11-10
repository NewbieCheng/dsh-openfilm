import { appendFile, mkdir, readFile, rename, stat } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';

/**
 * One append-only log for everything this plugin does at run time.
 *
 * Why a file and not the Host's stdout: the interesting failures (a Studio that
 * stopped, a ticket that was refused, an upstream 5xx) happen while the person
 * is looking at a page, and are gone once the process is restarted. The log is
 * the only artifact that survives that, so it is written for a human reading it
 * after the fact, not for a tracer.
 *
 * Rules:
 *  - JSON Lines, one event per line, so `tail` and grep both work;
 *  - secrets and project identity are never written: keys whose name looks like
 *    a credential or a path are replaced by a short digest plus a length;
 *  - rotation happens at `limit` bytes (one previous file kept), so the log can
 *    never grow without bound;
 *  - writing never throws and never blocks a request.
 */

/** Names whose values must never reach the file. */
const SECRET_KEY = /^(?:.*(?:key|secret|token|ticket|cookie|session|password|credential|authorization).*)$/i;
/** Values that identify what a person worked on. */
const PATH_KEY = /^(?:.*(?:path|file|dir|folder|root|home|name).*)$/i;

const digests = new Map();
function digest(value) {
  const text = String(value);
  const cached = digests.get(text);
  if (cached) return cached;
  const short = `${createHash('sha256').update(text).digest('hex').slice(0, 10)}:${text.length}`;
  if (digests.size < 256) digests.set(text, short);
  return short;
}

export function redact(fields) {
  if (!fields || typeof fields !== 'object') return undefined;
  const out = {};
  for (const [key, value] of Object.entries(fields)) {
    if (value === undefined) continue;
    if (SECRET_KEY.test(key)) { out[key] = '[redacted]'; continue; }
    if (PATH_KEY.test(key)) { out[key] = digest(value); continue; }
    if (typeof value === 'string') {
      // A free-text field may carry a prompt, a URL with a ticket, or a body.
      out[key] = value.length > 200 ? `${value.slice(0, 200)}…` : value;
      continue;
    }
    if (typeof value === 'number' || typeof value === 'boolean' || value === null) { out[key] = value; continue; }
    if (Array.isArray(value)) { out[key] = value.slice(0, 20).map(item => (typeof item === 'string' ? (item.length > 80 ? `${item.slice(0, 80)}…` : item) : typeof item)); continue; }
    out[key] = '[object]';
  }
  return out;
}

export function createPluginLog({ file = join(tmpdir(), 'dsh-openfilm', 'plugin.log'), limit = 512 * 1024, keep = 1, recent = 200 } = {}) {
  const ring = [];
  let queue = Promise.resolve();
  let writes = 0;

  function remember(level, event, fields, at) {
    ring.push({ at, level, event, ...(fields || {}) });
    if (ring.length > recent) ring.splice(0, ring.length - recent);
  }

  function write(level, event, fields) {
    const at = new Date().toISOString();
    const entry = { at, level, event, ...(redact(fields) || {}) };
    remember(level, event, redact(fields), at);
    writes += 1;
    const line = `${JSON.stringify(entry)}\n`;
    // Serialized so rotation cannot interleave two writers.
    queue = queue.then(async () => {
      try {
        await mkdir(dirname(file), { recursive: true });
        const size = await stat(file).then(info => info.size, () => 0);
        if (size + Buffer.byteLength(line) > limit) {
          if (keep > 0) {
            for (let index = keep; index >= 1; index -= 1) {
              const from = index === 1 ? file : `${file}.${index - 1}`;
              await rename(from, `${file}.${index}`).catch(() => {});
            }
          } else {
            await rename(file, `${file}.1`).catch(() => {});
          }
        }
        await appendFile(file, line, 'utf8');
      } catch { /* a log failure must never surface */ }
    });
    return queue;
  }

  return {
    file,
    write,
    info: (event, fields) => write('info', event, fields),
    warn: (event, fields) => write('warn', event, fields),
    error: (event, fields) => write('error', event, fields),
    /** Entries still in memory, newest last. */
    tail(count = 20) { return ring.slice(Math.max(0, ring.length - count)); },
    /** Settle pending writes, for tests and for dispose. */
    flush: () => queue,
    get count() { return writes; },
    /** Read the file back, newest last, tolerating a truncated tail. */
    async read(count = 50) {
      const text = await readFile(file, 'utf8').catch(() => '');
      const lines = text.split('\n').filter(Boolean).slice(-count);
      const entries = [];
      for (const line of lines) { try { entries.push(JSON.parse(line)); } catch { /* partial last line */ } }
      return entries;
    },
  };
}
// hmr probe 1794330856
