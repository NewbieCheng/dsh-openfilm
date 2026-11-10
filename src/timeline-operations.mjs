/*
 * Portions adapted from OpenFilm packages/openfilm/studio/server/ops.mjs
 * (fixed upstream snapshot: .codex/OpenFilm规划/upstream). Changes: isolated,
 * immutable, deliberately limited operations and stricter validation.
 *
 * MIT License
 * Copyright (c) 2026 OpenFilm contributors
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in all
 * copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
 * SOFTWARE.
 */

/** An invalid request or a conflict with the current film. */
export class TimelineEditError extends Error {
  constructor(message, kind = 'invalid') { super(message); this.name = 'TimelineEditError'; this.kind = kind; }
}
const invalid = (message) => { throw new TimelineEditError(message); };
const conflict = (message) => { throw new TimelineEditError(message, 'conflict'); };
// Upstream ops.mjs rounds drag times and sorts a track by clip.at.
const round = (s) => Math.round(s * 1000) / 1000;
const seconds = (n) => typeof n === 'number' && Number.isFinite(n) && n >= 0 && Number.isFinite(n * 1000);
const object = (x) => x !== null && typeof x === 'object' && !Array.isArray(x);
const keysOnly = (o, keys) => Object.keys(o).every((k) => keys.includes(k));
const validId = (id) => typeof id === 'string' && /^[A-Za-z][\w-]*$/.test(id);
const durationOf = (clip) => {
  const time = clip.time;
  const speed = clip.speed ?? 1;
  if (!Array.isArray(time) || time.length !== 2 || !seconds(time[0]) || !seconds(time[1]) || time[1] <= time[0] || typeof speed !== 'number' || !Number.isFinite(speed) || speed < 0.1 || speed > 100) return null;
  return (time[1] - time[0]) / speed;
};

/**
 * Apply a batch atomically to a cloned film, without file, network, DOM or HTML.
 * Operations: {op:'move',clip,at,track?}; {op:'trim',clip,start,end};
 * {op:'split',clip,at,rightId?}. Trim bounds use source seconds; split at uses
 * film seconds. Trims only narrow a known explicit two-ended source interval.
 * Linked clips, fades/overrides, animated styles and clip-length components are
 * deliberately not edited where their dependent state would need recomputation.
 * Move rejects overlaps and unknown spans on occupied tracks; no ripple or media probing.
 */
export function applyTimelineOperations(film, operations) {
  if (!object(film) || !Array.isArray(film.tracks)) invalid('film needs tracks');
  if (!Array.isArray(operations) || !operations.length) invalid('an edit needs operations');
  let value;
  try { value = structuredClone(film); } catch { invalid('film must be cloneable data'); }
  const ids = new Set();
  for (const track of value.tracks) {
    if (!object(track) || !Array.isArray(track.clips) || (track.locked !== undefined && typeof track.locked !== 'boolean')) invalid('invalid track');
    for (const clip of track.clips) {
      if (!object(clip) || !validId(clip.id) || typeof clip.src !== 'string' || !clip.src || (clip.at !== undefined && !seconds(clip.at))) invalid('invalid clip');
      if (ids.has(clip.id)) conflict('duplicate clip id');
      ids.add(clip.id);
    }
  }
  const find = (id) => {
    if (!validId(id)) invalid('invalid clip id');
    for (let t = 0; t < value.tracks.length; t++) {
      const c = value.tracks[t].clips.findIndex((clip) => clip.id === id);
      if (c >= 0) return { track: value.tracks[t], t, c, clip: value.tracks[t].clips[c] };
    }
    conflict(`clip ${id} not found`);
  };
  for (const op of operations) {
    if (!object(op) || !['move', 'trim', 'split'].includes(op.op)) invalid('unsupported operation');
    const allowed = op.op === 'move' ? ['op', 'clip', 'at', 'track'] : op.op === 'trim' ? ['op', 'clip', 'start', 'end'] : ['op', 'clip', 'at', 'rightId'];
    if (!keysOnly(op, allowed)) invalid('unknown operation field');
    const { track, t, c, clip } = find(op.clip);
    if (track.locked) conflict('source track is locked');
    if (clip.attrs !== undefined && (!object(clip.attrs) || (clip.attrs['data-link'] !== undefined && typeof clip.attrs['data-link'] !== 'string') || (clip.attrs['data-props'] !== undefined && typeof clip.attrs['data-props'] !== 'string'))) invalid('invalid clip attributes');
    if (clip.attrs?.['data-link']) conflict('linked clips are not supported');
    if (op.op === 'move') {
      if (!seconds(op.at)) invalid('move at must be nonnegative finite seconds');
      const target = op.track === undefined ? t : op.track;
      if (!Number.isInteger(target) || target < 0 || target >= value.tracks.length) conflict('destination track not found');
      if (value.tracks[target].locked) conflict('destination track is locked');
      if (value.tracks[target].captions) conflict('cannot move onto a captions track');
      const at = round(op.at);
      const others = value.tracks[target].clips.filter(other => other.id !== clip.id);
      const movingDuration = durationOf(clip);
      if (others.length && movingDuration === null) conflict('cannot place a clip with unknown duration on an occupied track');
      for (const other of others) {
        const duration = durationOf(other);
        if (duration === null) conflict('cannot verify an occupied track with unknown clip duration');
        const otherAt = other.at ?? 0;
        // Protocol permits overlaps of at most one millisecond after rounding.
        if (Math.min(at + movingDuration, otherAt + duration) - Math.max(at, otherAt) > 0.001 + 1e-9) conflict('clips cannot overlap on a track');
      }
      track.clips.splice(c, 1);
      if (at) clip.at = at; else delete clip.at;
      value.tracks[target].clips.push(clip);
      value.tracks[target].clips.sort((a, b) => (a.at ?? 0) - (b.at ?? 0));
      continue;
    }
    // These require upstream's fade, motion, or page-duration dependency updates.
    if (clip.overrides !== undefined || clip.style !== undefined || clip.attrs?.['data-props']?.includes('--clip-length')) conflict('dependent clip metadata is not supported for trim or split');
    const time = clip.time;
    const speed = clip.speed === undefined ? 1 : clip.speed;
    if (!Array.isArray(time) || time.length !== 2 || !seconds(time[0]) || !seconds(time[1]) || time[1] <= time[0] || typeof speed !== 'number' || !Number.isFinite(speed) || speed < 0.1 || speed > 100) invalid('clip needs an explicit valid time range and speed');
    if (op.op === 'trim') {
      if (!seconds(op.start) || !seconds(op.end)) invalid('trim needs source start and end');
      const start = round(op.start), end = round(op.end);
      if (start < time[0] || end > time[1] || start >= end) invalid('trim must narrow the existing range');
      clip.time = [start, end];
      continue;
    }
    if (!seconds(op.at)) invalid('split needs a finite film time');
    const at = round(op.at);
    const cut = round(time[0] + (at - (clip.at ?? 0)) * speed);
    if (!Number.isFinite(cut) || cut <= time[0] || cut >= time[1] || at <= (clip.at ?? 0) || at >= (clip.at ?? 0) + (time[1] - time[0]) / speed) invalid('split must be inside the clip');
    let rightId = op.rightId;
    if (rightId !== undefined && !validId(rightId)) invalid('invalid rightId');
    if (rightId !== undefined && ids.has(rightId)) conflict('rightId already exists');
    if (rightId === undefined) {
      const stem = `${clip.id}-b`;
      rightId = stem;
      for (let n = 2; ids.has(rightId); n++) rightId = `${stem}-${n}`;
    }
    ids.add(rightId);
    const right = structuredClone(clip);
    right.id = rightId;
    right.at = at;
    right.time = [cut, time[1]];
    clip.time = [time[0], cut];
    track.clips.splice(c + 1, 0, right);
  }
  return value;
}
