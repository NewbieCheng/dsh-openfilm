/**
 * Sentence shaping for a transcript.
 *
 * SenseVoice answers with one string per VAD segment, punctuation restored by its
 * own ITN head — and no character timestamps. So a "sentence" here carries an
 * *interpolated* time: we split the segment text at sentence-ending marks and give
 * each sentence a slice of the segment proportional to its length. That is enough
 * to place a subtitle, and it stays honest only as long as callers know the times
 * inside a segment are estimates rather than measurements.
 */

const ENDERS = new Set(['。', '！', '？', '!', '?', '…', '\n']);
const CLOSERS = new Set(['”', '’', '"', "'", '」', '』', '）', ')', '】', ']', '》', '〉']);

/** Split one segment's text into sentences, keeping the punctuation. */
export function splitSentences(text) {
  if (typeof text !== 'string' || text.length === 0) return [];
  const chars = Array.from(text);
  const out = [];
  let buffer = '';
  const flush = () => {
    const trimmed = buffer.trim();
    if (trimmed.length > 0) out.push(trimmed);
    buffer = '';
  };
  for (let index = 0; index < chars.length; index += 1) {
    const char = chars[index];
    if (char === '\n') { flush(); continue; }
    buffer += char;
    if (!ENDERS.has(char)) continue;
    // "！？" and a closing quote belong to the same sentence.
    while (index + 1 < chars.length && (ENDERS.has(chars[index + 1]) || CLOSERS.has(chars[index + 1]))) {
      index += 1;
      buffer += chars[index];
    }
    flush();
  }
  flush();
  return out;
}

/** Relative "how much time this text deserves", used to slice a segment's span. */
export function textWeight(value) {
  let total = 0;
  for (const char of Array.from(String(value ?? ''))) {
    const code = char.codePointAt(0);
    if (char === ' ') total += 0.05;
    else if (code < 0x2e80) total += 0.5; // ASCII letters/digits read faster than a CJK glyph
    else total += 1;
  }
  return total;
}

/**
 * Give each sentence a [start, end] inside [from, to], proportional to its weight.
 * Zero-weight (empty) input returns no sentences rather than a zero-length one.
 */
export function ribbonTimes(sentences, from, to) {
  const list = Array.isArray(sentences) ? sentences : [];
  const start = Number(from);
  const end = Number(to);
  if (list.length === 0) return [];
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) {
    return list.map(text => ({ start: Number.isFinite(start) ? start : 0, end: Number.isFinite(start) ? start : 0, text }));
  }
  const weights = list.map(textWeight);
  const total = weights.reduce((sum, weight) => sum + weight, 0);
  if (total <= 0) {
    const step = (end - start) / list.length;
    return list.map((text, index) => ({ start: start + index * step, end: start + (index + 1) * step, text }));
  }
  const span = end - start;
  let cursor = 0;
  return list.map((text, index) => {
    const sentenceStart = start + span * (cursor / total);
    cursor += weights[index];
    const sentenceEnd = start + span * (cursor / total);
    return { start: sentenceStart, end: sentenceEnd, text };
  });
}

export function round3(value) {
  return Math.round(Number(value) * 1000) / 1000;
}

/** mm:ss.d under an hour, h:mm:ss above it. */
export function formatTimecode(seconds) {
  const value = Number(seconds);
  const safe = Number.isFinite(value) && value > 0 ? value : 0;
  const whole = Math.floor(safe);
  const hours = Math.floor(whole / 3600);
  const minutes = Math.floor((whole % 3600) / 60);
  const secs = whole % 60;
  const pad = n => String(n).padStart(2, '0');
  if (hours > 0) return `${hours}:${pad(minutes)}:${pad(secs)}`;
  // A tenth computed as (safe - whole) * 10 is off by one for 11.2 (1.9999…),
  // so round within the tenth instead of truncating; test fixtures pin this.
  return `${pad(minutes)}:${pad(secs)}.${Math.floor((safe - whole) * 10 + 1e-6)}`;
}

/** Count code points, not UTF-16 units, so a truncated string never splits a glyph. */
export function countChars(text) {
  return Array.from(String(text ?? '')).length;
}

/** Cut at a code-point boundary and say so; never invent text to fill the gap. */
export function truncateChars(text, maxChars) {
  const chars = Array.from(String(text ?? ''));
  const limit = Number.isFinite(maxChars) && maxChars >= 0 ? Math.floor(maxChars) : chars.length;
  if (chars.length <= limit) return { text: chars.join(''), truncated: false };
  return { text: chars.slice(0, limit).join(''), truncated: true };
}
