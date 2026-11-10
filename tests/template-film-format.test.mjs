import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runInNewContext } from 'node:vm';
import { readFilmFile, parseFilm, filmHtml, clipSpan } from 'openfilm/film-doc';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../vendor/templates');
const cases = [
  { name: 'paper-texture', stage: [1080, 1920], lengths: [6, 7], duration: 13 },
  { name: 'replica-film', stage: [1080, 1920], lengths: [5.233, 6.267, 4.333, 6.234, 8.066, 6.7, 9.867, 7.233, 5.334, 4.233, 5.633, 7.067, 5.833, 6, 6, 6, 8.567, 7.333, 6], duration: 121.933 },
  { name: 'sketchnote', stage: [1920, 1080], lengths: [2.756, 2.744, 3.383, 3.679, 3.859, 1.472, 2.051], duration: 19.944 },
];

test('paper still pages expose the OpenFilm frame contract', async () => {
  for (const [name, duration] of [['shot-01', 6], ['shot-02', 7]]) {
    const html = await readFile(resolve(root, 'paper-texture', 'pages', `${name}.html`), 'utf8');
    const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)];
    assert.equal(scripts.length, 1);
    const window = {};
    const ready = Promise.resolve();
    runInNewContext(scripts[0][1], { window, document: { fonts: { ready } } });
    assert.equal(window.film.width, 1080);
    assert.equal(window.film.height, 1920);
    assert.equal(window.film.duration, duration);
    await window.film.ready;
    for (const t of [0, duration - 0.01, 1, 0]) assert.doesNotThrow(() => window.film.frame(t));
  }
});

for (const { name, stage, lengths, duration } of cases) {
  test(`${name}: official film parser, format and referenced clips`, async () => {
    const dir = resolve(root, name);
    const source = await readFile(resolve(dir, 'film.html'), 'utf8');
    const result = readFilmFile(source);
    assert.deepEqual(result.problems, []);
    assert.ok(result.doc);
    const doc = parseFilm(result.value);
    assert.deepEqual(doc, result.doc);
    assert.deepEqual([doc.stage.w, doc.stage.h], stage);
    assert.equal(doc.tracks.length, 1);
    const clips = doc.tracks[0].clips;
    assert.equal(clips.length, lengths.length);
    let endMs = 0;
    for (const [i, clip] of clips.entries()) {
      assert.equal(clip.id, `shot-${String(i + 1).padStart(2, '0')}`);
      assert.equal(clip.src, `pages/${clip.id}.html`);
      assert.equal(Math.round(clip.at * 1000), endMs, `${clip.id} start`);
      const span = clipSpan(clip);
      assert.equal(span.from, 0);
      assert.equal(Math.round(span.length * 1000), Math.round(lengths[i] * 1000), `${clip.id} length`);
      endMs += Math.round(span.length * 1000);
      await readFile(resolve(dir, clip.src));
    }
    assert.equal(endMs, Math.round(duration * 1000));
    const roundTrip = readFilmFile(filmHtml(result.value, source));
    assert.deepEqual(roundTrip.problems, []);
    assert.deepEqual(roundTrip.doc, doc);
  });
}
