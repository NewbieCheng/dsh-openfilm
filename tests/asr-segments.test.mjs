import test from 'node:test';
import assert from 'node:assert/strict';
import { planSegments, normalizeSegments, SEGMENT_LIMITS } from '../src/asr-segments.mjs';

test('fixed windows cover the whole file and stop at the end', () => {
  assert.deepEqual(planSegments(20, { windowSec: 8 }), [
    { start: 0, end: 8 }, { start: 8, end: 16 }, { start: 16, end: 20 },
  ]);
  assert.deepEqual(planSegments(0), []);
  assert.deepEqual(planSegments(Number.NaN), []);
});

test('a short silence inside a phrase is joined, not cut', () => {
  const out = normalizeSegments([{ start: 0, end: 3 }, { start: 3.1, end: 6 }]);
  assert.deepEqual(out, [{ start: 0, end: 6 }]);
});

test('a long silence keeps the two segments apart', () => {
  const out = normalizeSegments([{ start: 0, end: 3 }, { start: 5, end: 8 }]);
  assert.equal(out.length, 2);
  assert.equal(out[1].start, 5);
});

test('a segment longer than the decode budget is split evenly', () => {
  const out = normalizeSegments([{ start: 0, end: 40 }], { maxSec: 15 });
  assert.equal(out.length, 3);
  assert.equal(out.at(-1).end, 40);
  for (const segment of out) assert.ok(segment.end - segment.start <= 15 + 1e-9);
});

test('a fragment below the floor is noise and disappears; a short one is folded into its neighbour', () => {
  assert.deepEqual(normalizeSegments([{ start: 0, end: 0.05 }]), []);
  const out = normalizeSegments([{ start: 0, end: 5 }, { start: 5.3, end: 5.9 }]);
  assert.deepEqual(out, [{ start: 0, end: 5.9 }]);
});

test('overlaps, out-of-range values and junk are made safe', () => {
  const out = normalizeSegments(
    [{ start: -2, end: 3 }, { start: 2, end: 4 }, { start: 'x', end: 1 }, { start: 8, end: 12 }],
    { durationSec: 10 },
  );
  assert.deepEqual(out, [{ start: 0, end: 4 }, { start: 8, end: 10 }]);
});

test('normalising twice changes nothing', () => {
  const once = normalizeSegments([{ start: 0, end: 3 }, { start: 3.1, end: 40.2 }]);
  assert.deepEqual(normalizeSegments(once), once);
});

test('the limits are the documented ones', () => {
  assert.equal(SEGMENT_LIMITS.maxSec, 15);
  assert.ok(SEGMENT_LIMITS.minSec < SEGMENT_LIMITS.maxSec);
});
