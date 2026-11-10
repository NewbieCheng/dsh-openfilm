import test from 'node:test';
import assert from 'node:assert/strict';
import { decodeFilmSource, MAX_SOURCE_BYTES } from '../src/film-source.mjs';

test('decodes complete UTF-8 film data without executing markup', () => {
  const data = new TextEncoder().encode('<script>throw new Error("executed")</script>中文');
  assert.deepEqual(decodeFilmSource({ data, eof: true }), { text: '<script>throw new Error("executed")</script>中文', eof: true });
});
test('a partial multibyte character is allowed only for a truncated response', () => {
  const data = new Uint8Array([0xe4, 0xb8]);
  assert.equal(decodeFilmSource({ data, eof: false }).eof, false);
  assert.throws(() => decodeFilmSource({ data, eof: true }));
});
test('rejects malformed, binary and oversized responses', () => {
  assert.throws(() => decodeFilmSource({ data: [], eof: true }));
  assert.throws(() => decodeFilmSource({ data: new Uint8Array([0]), eof: true }));
  assert.throws(() => decodeFilmSource({ data: new Uint8Array(MAX_SOURCE_BYTES + 1), eof: true }));
});
