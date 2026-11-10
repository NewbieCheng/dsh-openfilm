import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyTimelineOperations as apply, TimelineEditError } from '../src/timeline-operations.mjs';

const film = () => ({ stage: { w: 1920, h: 1080 }, extra: { keep: 1 }, keyframes: { unused: 'x' }, tracks: [
  { name: 'source', clips: [{ id: 'a', src: 'a.mp4', at: 2, time: [2, 10], speed: 2, box: { x: 1 } }] },
  { name: 'target', clips: [{ id: 'b', src: 'b.mp4', at: 10, time: [0, 2] }] },
  { captions: { src: 'c.vtt' }, clips: [] },
] });
const fails = (fn, kind) => assert.throws(fn, (e) => e instanceof TimelineEditError && e.kind === kind);

test('move sorts, rounds, keeps all track and film metadata and does not mutate input', () => {
  const f = film(), snapshot = structuredClone(f);
  const out = apply(f, [{ op: 'move', clip: 'a', at: 4.12349, track: 1 }]);
  assert.deepEqual(f, snapshot);
  assert.deepEqual(out.tracks[1].clips.map(c => [c.id, c.at]), [['a', 4.123], ['b', 10]]);
  assert.deepEqual(out.tracks[0], { name: 'source', clips: [] });
  assert.deepEqual(out.keyframes, f.keyframes);
  assert.deepEqual(out.extra, f.extra);
  assert.deepEqual(out.tracks[2], f.tracks[2]);
  assert.equal(apply(f, [{ op: 'move', clip: 'a', at: 0 }]).tracks[0].clips[0].at, undefined);
});

test('trim and split use source seconds and speed; halves own independent metadata', () => {
  const f = film();
  const trimmed = apply(f, [{ op: 'trim', clip: 'a', start: 3, end: 9 }]);
  assert.deepEqual(trimmed.tracks[0].clips[0].time, [3, 9]);
  const split = apply(f, [{ op: 'split', clip: 'a', at: 3.5 }]);
  const [left, right] = split.tracks[0].clips;
  assert.deepEqual([left.time, right.time, right.at, right.id], [[2, 5], [5, 10], 3.5, 'a-b']);
  left.box.x = 7;
  assert.equal(right.box.x, 1);
  assert.equal(f.tracks[0].clips[0].box.x, 1);
});

test('batches are atomic, unique ids are allocated, and invalid or conflicting edits fail', () => {
  const f = film(), before = structuredClone(f);
  fails(() => apply(f, [{ op: 'move', clip: 'a', at: 4 }, { op: 'split', clip: 'gone', at: 3 }]), 'conflict');
  assert.deepEqual(f, before);
  fails(() => apply(f, [{ op: 'split', clip: 'a', at: 3, rightId: 'b' }]), 'conflict');
  fails(() => apply(f, [{ op: 'split', clip: 'a', at: 2 }]), 'invalid');
  fails(() => apply(f, [{ op: 'trim', clip: 'a', start: 0, end: 3 }]), 'invalid');
  fails(() => apply(f, [{ op: 'move', clip: 'a', at: Infinity }]), 'invalid');
  fails(() => apply(f, [{ op: 'move', clip: 'a', at: 1, surprise: true }]), 'invalid');
  fails(() => apply(f, [{ op: 'remove', clip: 'a' }]), 'invalid');
  f.tracks[1].clips.push({ id: 'a-b', src: 'x' });
  assert.equal(apply(f, [{ op: 'split', clip: 'a', at: 3 }]).tracks[0].clips[1].id, 'a-b-2');
});

test('move rejects overlaps and unknown durations on occupied tracks', () => {
  const f = film();
  fails(() => apply(f, [{ op: 'move', clip: 'a', at: 9, track: 1 }]), 'conflict');
  assert.equal(apply(f, [{ op: 'move', clip: 'a', at: 6, track: 1 }]).tracks[1].clips[0].id, 'a');
  delete f.tracks[1].clips[0].time;
  fails(() => apply(f, [{ op: 'move', clip: 'a', at: 1, track: 1 }]), 'conflict');
});

test('locked tracks, linked clips, and unsupported dependent metadata are rejected', () => {
  const f = film();
  f.tracks[1].locked = true;
  fails(() => apply(f, [{ op: 'move', clip: 'a', at: 3, track: 1 }]), 'conflict');
  fails(() => apply(f, [{ op: 'trim', clip: 'b', start: 0, end: 1 }]), 'conflict');
  fails(() => apply(f, [{ op: 'move', clip: 'a', at: 3, track: 2 }]), 'conflict');
  f.tracks[0].clips[0].attrs = { 'data-link': 'pair' };
  fails(() => apply(f, [{ op: 'move', clip: 'a', at: 3 }]), 'conflict');
  delete f.tracks[0].clips[0].attrs;
  for (const field of ['overrides', 'style']) {
    f.tracks[0].clips[0][field] = field === 'style' ? 'animation: x' : [{ fade: [1, 1] }];
    fails(() => apply(f, [{ op: 'split', clip: 'a', at: 3 }]), 'conflict');
    delete f.tracks[0].clips[0][field];
  }
  f.tracks[0].clips[0].attrs = { 'data-props': '--clip-length' };
  fails(() => apply(f, [{ op: 'trim', clip: 'a', start: 2, end: 5 }]), 'conflict');
});
