import test from 'node:test';
import assert from 'node:assert/strict';
import { draftFilm } from '../src/film-draft.mjs';
import { MAX_SOURCE_BYTES } from '../src/film-source.mjs';

const source = `<!doctype html>\r\n<html><head><style>/* keep */ .x { color: red }</style></head>\r\n<body>\r\n<!-- track note -->\r\n<section id='one'>\r\n  <!-- a note -->\r\n  <video data-note='hello' id='a' src='a.mp4#t=1,9' at='1' class='x'></video>\r\n  <!-- b note -->\r\n  <audio id='b' src='b.wav#t=0,3' at='20'></audio>\r\n</section>\r\n<section id='two'></section>\r\n<section><track src='captions.vtt' kind='captions'></section>\r\n</body></html>`;

test('move changes only the relevant attribute and retains unrelated source byte-for-byte', () => {
  const { text, summary } = draftFilm({ source, operations: [{ op: 'move', clip: 'a', at: 2 }] });
  assert.equal(text, source.replace("at='1'", 'at="2"'));
  assert.equal(summary.tracks[0].clips[0].at, 2);
  assert.equal(summary.tracks[2].captions.src, 'captions.vtt');
});

test('trim preserves other attributes; split keeps the original and adds a right clip', () => {
  const trim = draftFilm({ source, operations: [{ op: 'trim', clip: 'a', start: 2, end: 8 }] });
  assert.equal(trim.text, source.replace("src='a.mp4#t=1,9'", 'src="a.mp4#t=2,8"'));
  const split = draftFilm({ source, operations: [{ op: 'split', clip: 'a', at: 5, rightId: 'right' }] });
  assert.deepEqual(split.summary.tracks[0].clips.map(c => [c.id, c.time]), [['a', [1, 5]], ['right', [5, 9]], ['b', [0, 3]]]);
  assert.ok(split.text.includes("data-note='hello' id='a' src=\"a.mp4#t=1,5\" at='1' class='x'"));
  assert.ok(split.text.includes('<!-- a note -->') && split.text.includes('<!-- b note -->'));
});

test('moving between tracks preserves comments, original unrelated tags and head', () => {
  const { text, summary } = draftFilm({ source, operations: [{ op: 'move', clip: 'a', at: 3, track: 1 }] });
  assert.equal(summary.tracks[1].clips[0].id, 'a');
  for (const fragment of ['<!-- a note -->', '<!-- b note -->', "<audio id='b' src='b.wav#t=0,3' at='20'></audio>", "<track src='captions.vtt' kind='captions'>", '<style>/* keep */ .x { color: red }</style>']) assert.ok(text.includes(fragment));
});

test('invalid, unknown, locked, and failed batches throw without altering source', () => {
  const locked = source.replace("<section id='two'>", "<section id='two' locked>");
  assert.throws(() => draftFilm({ source: locked, operations: [{ op: 'move', clip: 'a', at: 1, track: 1 }] }), /locked/);
  assert.throws(() => draftFilm({ source, operations: [{ op: 'delete', clip: 'a' }] }), /unsupported/);
  assert.throws(() => draftFilm({ source, operations: [{ op: 'move', clip: 'a', at: 3 }, { op: 'move', clip: 'missing', at: 1 }] }), /not found/);
  assert.throws(() => draftFilm({ source: source.replace('a.mp4#t=1,9', 'a.mp4#t=bad'), operations: [{ op: 'move', clip: 'a', at: 3 }] }), { code: 'INVALID_FILM' });
  assert.ok(source.includes("at='1'"));
});

test('enforces the UTF-8 byte limit, source type and no binary input', () => {
  const operations = [{ op: 'move', clip: 'a', at: 1 }];
  assert.throws(() => draftFilm({ source: '界'.repeat(Math.ceil(MAX_SOURCE_BYTES / 3)), operations }), { code: 'SOURCE_TOO_LARGE' });
  assert.throws(() => draftFilm({ source: null, operations }), { code: 'INVALID_FILM' });
  assert.throws(() => draftFilm({ source: '\0', operations }), { code: 'INVALID_FILM' });
});

test('rejects ambiguous markup and edits that cannot be round-trip verified', () => {
  const duplicate = source.replace("at='1'", "at='1' at='2'");
  assert.throws(() => draftFilm({ source: duplicate, operations: [{ op: 'move', clip: 'a', at: 3 }] }), { code: 'UNSAFE_FILM' });
  // Unnamed clips acquire identities by position, so reordering them cannot be safely retained.
  const unnamed = '<section><video src="same.mp4#t=0,5"></video><video src="same.mp4#t=0,6" at="10"></video></section>';
  assert.throws(() => draftFilm({ source: unnamed, operations: [{ op: 'move', clip: 'same', at: 20 }] }), { code: 'UNSAFE_FILM' });
});
