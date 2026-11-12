/**
 * Where the speech is, before anything is recognised.
 *
 * Two providers share one contract so the pipeline never knows which one ran:
 * Silero VAD (real speech boundaries) and a fixed window (no model, and tests).
 * Its output is then normalised by rules that matter for editing: too-short
 * fragments are folded into a neighbour rather than dropped (dropping loses
 * words), and anything longer than the recognizer's comfortable span is split
 * rather than handed over whole — one 90-second segment is a slow, memory-hungry
 * decode with a worse result than four small ones.
 */

export const SEGMENT_LIMITS = Object.freeze({
  minSec: 1.2,      // shorter than this is a cough, not a sentence
  maxSec: 15,       // above this a single decode gets slow and less accurate
  joinGapSec: 0.25, // silences shorter than this are inside a phrase
  floorSec: 0.15,   // below this it is noise, not speech
});

/** Fixed windows: the fallback when no VAD model is installed, and what tests use. */
export function planSegments(durationSec, { windowSec = 8 } = {}) {
  const total = Number(durationSec);
  if (!Number.isFinite(total) || total <= 0) return [];
  const step = Number.isFinite(windowSec) && windowSec >= 0.5 ? windowSec : 8;
  const out = [];
  for (let start = 0; start < total - 1e-6; start += step) {
    out.push({ start: Math.round(start * 1000) / 1000, end: Math.round(Math.min(total, start + step) * 1000) / 1000 });
  }
  return out;
}

/**
 * Clamp, sort, join, split, fold — in that order, because each step changes what
 * the next one sees. Idempotent: normalising an already-normal result is a no-op.
 */
export function normalizeSegments(raw, {
  durationSec = Number.POSITIVE_INFINITY,
  minSec = SEGMENT_LIMITS.minSec,
  maxSec = SEGMENT_LIMITS.maxSec,
  joinGapSec = SEGMENT_LIMITS.joinGapSec,
  floorSec = SEGMENT_LIMITS.floorSec,
} = {}) {
  const limit = Number.isFinite(durationSec) && durationSec > 0 ? durationSec : Number.POSITIVE_INFINITY;
  const cleaned = [];
  for (const item of Array.isArray(raw) ? raw : []) {
    const start = Number(item?.start);
    const end = Number(item?.end);
    if (!Number.isFinite(start) || !Number.isFinite(end)) continue;
    const from = Math.max(0, start);
    const to = Math.min(limit, end);
    if (!(to - from > floorSec)) continue;
    cleaned.push({ start: from, end: to });
  }
  if (cleaned.length === 0) return [];
  cleaned.sort((a, b) => a.start - b.start || a.end - b.end);

  const joined = [];
  for (const segment of cleaned) {
    const last = joined.at(-1);
    const bridged = last ? Math.max(last.end, segment.end) - last.start : Number.POSITIVE_INFINITY;
    if (last && segment.start - last.end < joinGapSec && bridged <= maxSec) {
      last.end = Math.max(last.end, segment.end);
      continue;
    }
    joined.push({ ...segment });
  }

  const capped = [];
  for (const segment of joined) {
    const span = segment.end - segment.start;
    if (span <= maxSec) { capped.push(segment); continue; }
    const parts = Math.ceil(span / maxSec);
    const step = span / parts;
    for (let index = 0; index < parts; index += 1) {
      capped.push({
        start: segment.start + index * step,
        end: index === parts - 1 ? segment.end : segment.start + (index + 1) * step,
      });
    }
  }

  // Fold a short fragment into the previous one when that stays within maxSec;
  // otherwise keep it — a 0.4 s "嗯" is still speech someone may need to see.
  const folded = [];
  for (const segment of capped) {
    const previous = folded.at(-1);
    if (segment.end - segment.start < minSec && previous && segment.end - previous.start <= maxSec) {
      previous.end = segment.end;
      continue;
    }
    folded.push({ ...segment });
  }

  return folded.map(segment => ({ start: Math.round(segment.start * 1000) / 1000, end: Math.round(segment.end * 1000) / 1000 }));
}
