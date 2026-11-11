/**
 * Bridge trace: what the Host actually sent to the panel, and whether anything
 * live took it.
 *
 * Why this exists: `%TEMP%\dsh-openfilm-frames.jsonl` records what came *out of
 * DSH*, but nothing recorded what we *turned it into* or whether the page ever
 * received it. Without that middle link, "the panel shows nothing" can only be
 * guessed at — and guessing the frame shape is exactly what cost this repo two
 * rounds before (see AGENTS.md §6). One snapshot from `/diagnose` now answers
 * three questions at once:
 *
 *   1. did the turn produce frames at all            → frames.jsonl  (existing)
 *   2. did the bridge translate and publish anything → this trace   (emitted/refused)
 *   3. did the page receive the same events          → this trace   (panel.seen)
 *
 * Bounded on purpose: counters plus the last few envelopes, never full text.
 */
const MAX_ENTRIES = 40;
const MAX_KINDS = 24;
const MAX_TEXT = 200;

const text = (value) => (typeof value === 'string' ? (value.length > MAX_TEXT ? `${value.slice(0, MAX_TEXT)}…` : value) : '');

/** One sessionUpdate name, clamped to a short token so a bad frame cannot bloat the trace. */
function kindOf(event) {
  const name = event?.update?.sessionUpdate;
  return typeof name === 'string' && /^[a-z_]{1,40}$/.test(name) ? name : 'unknown';
}

/**
 * @param options.limit how many recent envelopes to keep (1..MAX_ENTRIES).
 * @returns an immutable-by-convention recorder; every snapshot is a plain copy.
 */
export function createBridgeTrace({ limit = MAX_ENTRIES } = {}) {
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > MAX_ENTRIES) throw new RangeError(`limit must be 1..${MAX_ENTRIES}`);
  let emitted = 0;
  let accepted = 0;
  let refused = 0;
  const kinds = Object.create(null);
  const tail = [];
  const panel = new Map();
  let closed = false;

  function count(name) {
    kinds[name] = (kinds[name] ?? 0) + 1;
  }

  return Object.freeze({
    /** Record one envelope the bridge published, and whether a live stream took it. */
    emit(projectId, event, wasAccepted) {
      if (closed) return;
      emitted += 1;
      if (wasAccepted === true) accepted += 1; else refused += 1;
      const kind = kindOf(event);
      count(kind);
      tail.push({
        at: Date.now(), projectId: typeof projectId === 'string' ? projectId : '',
        key: text(event?.key), kind: event?.kind === 'done' ? 'done' : 'update', update: kind, accepted: wasAccepted === true,
      });
      while (tail.length > limit) tail.shift();
    },

    /** Record the page's own count of what it received for this project. */
    panel(projectId, counts) {
      if (closed || typeof projectId !== 'string') return false;
      const seen = Number(counts?.seen);
      if (!Number.isSafeInteger(seen) || seen < 0 || seen > 1_000_000) return false;
      const received = Object.create(null);
      const source = counts?.kinds && typeof counts.kinds === 'object' ? counts.kinds : {};
      for (const [name, value] of Object.entries(source).slice(0, MAX_KINDS)) {
        if (!/^[a-z_]{1,40}$/.test(name)) continue;
        const countValue = Number(value);
        if (Number.isSafeInteger(countValue) && countValue >= 0 && countValue <= 1_000_000) received[name] = countValue;
      }
      panel.set(projectId, { seen, kinds: received, at: Date.now() });
      return true;
    },

    /** Counters plus the most recent envelopes; safe to serialize into `/diagnose`. */
    snapshot() {
      const panels = Object.create(null);
      for (const [projectId, value] of panel) {
        panels[projectId] = { seen: value.seen, kinds: { ...value.kinds }, at: value.at };
      }
      return {
        emitted, accepted, refused,
        kinds: { ...kinds },
        // The single most useful derived number: envelopes the Host published
        // that no live panel stream accepted (a closed tab or a broken SSE).
        lost: refused,
        panel: panels,
        tail: tail.map(entry => ({ ...entry })),
      };
    },

    /** Nothing new is recorded after this; existing snapshots stay readable. */
    close() { closed = true; },
  });
}
