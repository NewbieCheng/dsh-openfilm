import test from 'node:test';
import assert from 'node:assert/strict';
import { startDraft, appendDraft, undoDraft, MAX_DRAFT_OPERATIONS } from '../src/draft-session.mjs';
import { draftFilm } from '../src/film-draft.mjs';

const source = '<!doctype html><html><head></head><body><section><video id="clip" src="clip.mp4#t=0,4"></video></section></body></html>';

test('replays every edit from the observed version and supports undo', () => {
  const initial = startDraft(source, 'v1');
  const one = appendDraft(initial, { op: 'move', clip: 'clip', at: 2 });
  const two = appendDraft(one, { op: 'split', clip: 'clip', at: 4 });
  assert.equal(initial.text, source);
  assert.equal(two.originalVersion, 'v1');
  assert.equal(two.text, draftFilm({ source, operations: two.operations }).text);
  assert.equal(undoDraft(two).text, one.text);
  assert.equal(undoDraft(one).text, source);
});

test('refuses invalid operations and bounds the retained operation list', () => {
  const initial = startDraft(source, 'v1');
  assert.throws(() => startDraft(source, ''));
  assert.throws(() => appendDraft(initial, { op: 'delete', clip: 'clip' }));
  assert.equal(initial.operations.length, 0);
  assert.throws(() => appendDraft({ ...initial, operations: Array(MAX_DRAFT_OPERATIONS).fill({}) }, { op: 'move', clip: 'clip', at: 1 }), /limit/);
});
