import test from 'node:test';
import assert from 'node:assert/strict';
import { summarizeFilm } from '../src/film-summary.mjs';

const film = (body, head = '') => `<html><head>${head}</head><body>${body}</body></html>`;

test('uses upstream stage defaults and handles empty films', () => {
  assert.deepEqual(summarizeFilm(film('')), {
    stage: { w: 1920, h: 1080 }, duration: 0, tracks: [], diagnostics: [],
  });
});

test('summarizes ordered tracks, clip timing, size and speed', () => {
  const result = summarizeFilm(film(`
    <section id="top" hidden>
      <iframe src="page.html#t=1,5" size="800x600" style="left: 5px; width: 400px"></iframe>
      <img src="photo.png#t=2,6" at="7">
    </section>
    <section muted locked><video src="video.mp4#t=2,10" at="3" speed="2"></video>
      <audio src="video.mp4#t=0,8" speed="0.5" disabled></audio></section>
    <section><track src="words.vtt" kind="subtitles" srclang="en"></section>
  `, '<meta name="viewport" content="width=1080, height=1920">'));
  assert.deepEqual(result.stage, { w: 1080, h: 1920 });
  assert.equal(result.duration, 16);
  assert.deepEqual(result.diagnostics, []);
  assert.equal(result.tracks.length, 3);
  assert.equal(result.tracks[0].hidden, true);
  assert.equal(result.tracks[0].attrs.id, 'top');
  assert.deepEqual(result.tracks[0].clips[0], {
    id: 'page', src: 'page.html', kind: 'page', at: 0, disabled: false,
    time: [1, 5], speed: 1, duration: 4, end: 4,
    box: { x: 5, y: 0, w: 400 }, size: { w: 800, h: 600 },
  });
  assert.equal(result.tracks[0].clips[1].duration, 4);
  assert.equal(result.tracks[0].clips[1].end, 11);
  assert.equal(result.tracks[1].clips[0].duration, 4);
  assert.equal(result.tracks[1].clips[1].kind, 'sound');
  assert.equal(result.tracks[1].clips[1].disabled, true);
  assert.deepEqual(result.tracks[2].captions, { src: 'words.vtt', kind: 'subtitles', srclang: 'en' });
});

test('unknown native durations are explicit, not zero or invalid', () => {
  const result = summarizeFilm(film('<section><video src="a.mp4"></video><audio src="b.wav#t=2"></audio><iframe src="page.html"></iframe><img src="still.png"></section>'));
  assert.equal(result.duration, null);
  assert.deepEqual(result.tracks[0].clips.map(c => [c.duration, c.end]), [[null, null], [null, null], [null, null], [null, null]]);
  assert.deepEqual(result.diagnostics.map(d => d.code), Array(4).fill('DURATION_UNKNOWN'));
  assert.equal(result.diagnostics[1].clipId, 'b');
});

test('rejects invalid markup and data with explicit errors', () => {
  assert.throws(() => summarizeFilm(null), { code: 'INVALID_FILM' });
  for (const text of [film('<section><video src="a.mp4" speed="0"></video></section>'), film('', '<meta name="viewport" content="width=0,height=20">'), film('<script>globalThis.executed = true</script>')]) {
    assert.throws(() => summarizeFilm(text), error => error.code === 'INVALID_FILM' && error.problems.length > 0);
  }
});

test('source HTML is parsed as data and external URLs are never fetched', () => {
  const result = summarizeFilm(film('<section><iframe src="https://example.invalid/x.html#t=0,3"></iframe></section>'));
  assert.equal(result.duration, 3);
  assert.equal(result.tracks[0].clips[0].src, 'https://example.invalid/x.html');
});
