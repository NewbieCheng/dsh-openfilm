import test from 'node:test';
import assert from 'node:assert/strict';
import { buildRefinePrompt, parseRefineReply, refineTranscript } from '../src/asr-refine.mjs';

const segments = [
  { start: 0, end: 2, text: '我们今天聊 openfil 的剪辑' },
  { start: 2, end: 4, text: '先说结论 口播最怕念稿' },
];

test('the prompt numbers every line and pins the answer length', () => {
  const prompt = buildRefinePrompt(segments);
  assert.match(prompt, /1\. 我们今天聊 openfil 的剪辑/);
  assert.match(prompt, /2\. 先说结论 口播最怕念稿/);
  assert.match(prompt, /长度必须等于 2/);
});

test('only a reply of exactly the same length is accepted', () => {
  assert.deepEqual(parseRefineReply('["a","b"]', 2), ['a', 'b']);
  assert.equal(parseRefineReply('["a"]', 2), null);
  assert.equal(parseRefineReply('["a","b","c"]', 2), null);
  assert.equal(parseRefineReply('not json', 2), null);
  assert.equal(parseRefineReply('["a",1]', 2), null);
});

test('a good reply rewrites the text and keeps every timing', async () => {
  const result = await refineTranscript({
    ask: async () => '{"ok": true}'.slice(0, 0) + '["我们今天聊 OpenFilm 的剪辑。","先说结论：口播最怕念稿。"]',
    segments,
  });
  assert.equal(result.refined, true);
  assert.equal(result.changed, 2);
  assert.deepEqual(result.segments.map(s => [s.start, s.end]), [[0, 2], [2, 4]]);
  assert.equal(result.segments[0].text, '我们今天聊 OpenFilm 的剪辑。');
});

test('a wrong-length reply changes nothing', async () => {
  const result = await refineTranscript({ ask: async () => '["only one"]', segments });
  assert.equal(result.refined, false);
  assert.equal(result.reason, 'bad_reply');
  assert.deepEqual(result.segments, segments);
});

test('a failed request changes nothing', async () => {
  const result = await refineTranscript({ ask: async () => { throw new Error('network'); }, segments });
  assert.equal(result.refined, false);
  assert.equal(result.reason, 'failed');
});

test('no ask function or no segments is a skip, not an error', async () => {
  assert.equal((await refineTranscript({ segments })).reason, 'unavailable');
  assert.equal((await refineTranscript({ ask: async () => '[]' })).reason, 'empty');
});

test('a very long transcript is not sent in one request', async () => {
  const many = new Array(500).fill(0).map((_, index) => ({ start: index, end: index + 1, text: 'a' }));
  const result = await refineTranscript({ ask: async () => '[]', segments: many });
  assert.equal(result.reason, 'too_long');
  assert.equal(result.segments.length, 500);
});
