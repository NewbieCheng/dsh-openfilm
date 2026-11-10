import test from 'node:test';
import assert from 'node:assert/strict';
import { summarizeFilm } from '../src/film-summary.mjs';
import { layoutTimeline } from '../src/timeline-layout.mjs';

const film = body => summarizeFilm(`<html><head></head><body>${body}</body></html>`);

test('lays out real summaries in order, preserving flags and not mutating the input', () => {
  const summary = film('<section hidden locked><video src="a.mp4#t=0,4" at="2"></video><audio src="b.wav#t=0,2" at="8" disabled></audio></section><section muted></section>');
  const before = structuredClone(summary);
  const layout = layoutTimeline(summary);
  assert.deepEqual(summary, before);
  assert.equal(layout.duration, 10);
  assert.equal(layout.durationStatus, 'known');
  assert.equal(layout.scaleStatus, 'known');
  assert.equal(layout.truncated, false);
  assert.deepEqual(layout.tracks.map(t => [t.hidden, t.locked, t.muted]), [[true, true, false], [false, false, true]]);
  assert.deepEqual(layout.tracks[0].clips.map(c => [c.id, c.durationStatus, c.leftPercent, c.widthPercent, c.disabled]), [
    ['a', 'known', 20, 40, false], ['b', 'known', 80, 20, true],
  ]);
  assert.equal('src' in layout.tracks[0].clips[0], false);
});

test('unknown film and clip durations remain explicitly unknown', () => {
  const result = layoutTimeline(film('<section><video src="a.mp4#t=0,4"></video><audio src="https://example.invalid/x.wav" at="5"></audio></section>'));
  assert.equal(result.duration, null);
  assert.equal(result.durationStatus, 'unknown');
  assert.equal(result.scaleStatus, 'unknown');
  assert.deepEqual(result.tracks[0].clips.map(c => [c.durationStatus, c.duration, c.leftPercent, c.widthPercent]), [
    ['known', 4, null, null], ['unknown', null, null, null],
  ]);
  const knownScale = layoutTimeline({ duration: 10, tracks: [{ clips: [{ at: 5, duration: null, end: null }] }] });
  assert.equal(knownScale.tracks[0].clips[0].leftPercent, 50);
  assert.equal(knownScale.tracks[0].clips[0].widthPercent, null);
});

test('empty, zero-length and malformed numeric inputs do not produce NaN or invented timing', () => {
  assert.deepEqual(layoutTimeline(film('')), { duration: 0, durationStatus: 'known', scaleStatus: 'zero', tracks: [], omittedTracks: 0, truncated: false });
  const zero = layoutTimeline({ duration: 0, tracks: [{ clips: [{ at: 0, duration: 0, end: 0 }] }] });
  assert.equal(zero.tracks[0].clips[0].durationStatus, 'known');
  assert.equal(zero.tracks[0].clips[0].leftPercent, null);
  assert.equal(zero.tracks[0].clips[0].widthPercent, null);
  for (const duration of [NaN, Infinity, -1, '10', undefined]) {
    const result = layoutTimeline({ duration, tracks: [null, { clips: [null, { at: -1, duration: Infinity, end: NaN }] }] });
    assert.equal(result.durationStatus, 'unknown');
    assert.equal(result.tracks[1].clips[1].durationStatus, 'unknown');
    assert.equal(result.tracks[1].clips[1].leftPercent, null);
  }
  assert.equal(layoutTimeline(null).durationStatus, 'unknown');
  assert.equal(layoutTimeline({ tracks: Array(1) }).tracks[0].clips.length, 0);
});

test('clips overflowing the scale are bounded and invalid ends remain unknown', () => {
  const result = layoutTimeline({ duration: 10, tracks: [{ clips: [
    { at: 8, duration: 10, end: 18 }, { at: 20, duration: 1, end: 21 },
    { at: 3, duration: 1, end: 2 }, { at: 2, duration: 0, end: 2 },
  ] }] });
  assert.deepEqual(result.tracks[0].clips.map(c => [c.leftPercent, c.widthPercent, c.durationStatus]), [
    [80, 20, 'known'], [100, 0, 'known'], [30, null, 'unknown'], [20, 0, 'known'],
  ]);
});

test('caps output size, reports omissions and supports lower and zero limits', () => {
  const summary = { duration: 1, tracks: Array.from({ length: 102 }, () => ({ clips: Array.from({ length: 203 }, () => ({ at: 0, duration: 1, end: 1 })) })) };
  const result = layoutTimeline(summary, { maxTracks: 9999, maxClipsPerTrack: Infinity });
  assert.equal(result.tracks.length, 100);
  assert.equal(result.omittedTracks, 2);
  assert.equal(result.tracks[0].clips.length, 200);
  assert.equal(result.tracks[0].omittedClips, 3);
  assert.equal(result.truncated, true);
  const lower = layoutTimeline(summary, { maxTracks: 1, maxClipsPerTrack: 0 });
  assert.equal(lower.omittedTracks, 101);
  assert.equal(lower.tracks[0].omittedClips, 203);
  assert.equal(lower.tracks[0].truncated, true);
  assert.equal(layoutTimeline(summary, { maxTracks: 0 }).omittedTracks, 102);
});
