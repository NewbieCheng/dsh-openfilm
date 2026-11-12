import test from 'node:test';
import assert from 'node:assert/strict';
import { splitSentences, ribbonTimes, formatTimecode, truncateChars, countChars, textWeight } from '../src/asr-text.mjs';

test('sentences end at full stops and keep their punctuation', () => {
  assert.deepEqual(splitSentences('大家好。今天聊剪片！你觉得呢？'), ['大家好。', '今天聊剪片！', '你觉得呢？']);
});

test('a run of enders and a closing quote stay on one sentence', () => {
  assert.deepEqual(splitSentences('真的吗？！“我不敢信。”然后没了'), ['真的吗？！', '“我不敢信。”', '然后没了']);
});

test('line breaks split, blank text yields nothing', () => {
  assert.deepEqual(splitSentences('第一行\n第二行'), ['第一行', '第二行']);
  assert.deepEqual(splitSentences('   '), []);
  assert.deepEqual(splitSentences(undefined), []);
});

test('sentence times are proportional and stay inside the segment', () => {
  const placed = ribbonTimes(['短。', '这一段明显更长一些。'], 10, 20);
  assert.equal(placed.length, 2);
  assert.ok(placed[0].start >= 10 && placed[0].end <= 20);
  assert.ok(placed[1].end <= 20 + 1e-9);
  assert.ok(placed[0].end <= placed[1].start + 1e-9);
  assert.ok(placed[0].end - placed[0].start < placed[1].end - placed[1].start, 'the longer sentence gets more time');
});

test('an unusable span degrades to zero-length instead of throwing', () => {
  assert.deepEqual(ribbonTimes(['a'], 5, 5).map(item => [item.start, item.end]), [[5, 5]]);
  assert.deepEqual(ribbonTimes([], 0, 10), []);
});

test('timecodes are mm:ss.d under an hour and h:mm:ss above', () => {
  assert.equal(formatTimecode(0), '00:00.0');
  assert.equal(formatTimecode(7.45), '00:07.4');
  assert.equal(formatTimecode(187.9), '03:07.9');
  assert.equal(formatTimecode(3725), '1:02:05');
  assert.equal(formatTimecode(-3), '00:00.0');
});

test('truncation counts code points and never splits a glyph', () => {
  assert.deepEqual(truncateChars('你好世界', 2), { text: '你好', truncated: true });
  assert.deepEqual(truncateChars('你好', 5), { text: '你好', truncated: false });
  assert.equal(countChars('👩‍🎤ok'), Array.from('👩‍🎤ok').length);
});

test('CJK weighs one and ASCII weighs half, so slicing follows speech rate', () => {
  assert.equal(textWeight('中文'), 2);
  assert.equal(textWeight('ab'), 1);
});
