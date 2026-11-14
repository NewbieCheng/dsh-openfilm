// Per-turn event trace on disk: one JSON line per envelope the Host publishes to
// the panel.
//
// Why a file and not just `plugin.log`: "the panel shows nothing" has three
// possible moments — the ACP child never sent it, the Host dropped it, or the page
// received it and did not draw it — and the only way to tell them apart is a
// timestamped record of what went out, next to the page's own counts
// (`agent-trace`). Off unless `NO996_OPENFILM_TRACE=1`: a turn writes hundreds of
// lines and nobody should pay for that by default.
//
// What is written is shape, not content: kind, text length, tool name, status.
// The model's words stay out of the file on purpose.
import { appendFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const MAX_TEXT = 120;

function directory() {
  return join(tmpdir(), 'dsh-openfilm', 'trace');
}

/** One line's worth of an envelope, with no text worth leaking. */
export function describeEvent(event) {
  if (!event || typeof event !== 'object') return { kind: 'unknown' };
  if (event.kind === 'done') return { kind: 'done', ok: event.ok === true, stop: typeof event.stopReason === 'string' ? event.stopReason.slice(0, 24) : undefined };
  const update = event.update && typeof event.update === 'object' ? event.update : {};
  const name = typeof update.sessionUpdate === 'string' ? update.sessionUpdate.slice(0, 40) : 'update';
  const content = update.content && typeof update.content === 'object' ? update.content : {};
  const line = { kind: name };
  if (typeof content.text === 'string') line.chars = content.text.length;
  if (typeof content.type === 'string') line.contentType = content.type.slice(0, 16);
  if (typeof update.title === 'string') line.title = update.title.slice(0, MAX_TEXT);
  if (typeof update.status === 'string') line.status = update.status.slice(0, 24);
  if (typeof update.sessionId === 'string') line.session = update.sessionId.slice(0, 16);
  return line;
}

/**
 * @param {{ env?: NodeJS.ProcessEnv, write?: Function, projectLimit?: number }} [options]
 * @returns {{ enabled: boolean, record(projectId: string, event: unknown): void, path(projectId: string): string | null }}
 */
export function createChatTrace({ env = process.env, write = appendFileSync, projectLimit = 512 } = {}) {
  const enabled = env.NO996_OPENFILM_TRACE === '1';
  if (!enabled) return { enabled: false, record() {}, path: () => null };
  const lines = new Map();
  const pathFor = projectId => (typeof projectId === 'string' && /^[A-Za-z0-9_-]{6,40}$/.test(projectId) ? join(directory(), `${projectId}.jsonl`) : null);
  return {
    enabled: true,
    path: pathFor,
    record(projectId, event) {
      const file = pathFor(projectId);
      if (!file) return;
      const count = lines.get(projectId) ?? 0;
      if (count >= projectLimit * 20) return; // a runaway turn must not fill the disk
      lines.set(projectId, count + 1);
      try {
        mkdirSync(directory(), { recursive: true });
        write(file, JSON.stringify({ at: new Date().toISOString(), ...describeEvent(event) }) + '\n');
      } catch { /* tracing must never break the turn */ }
    },
  };
}
