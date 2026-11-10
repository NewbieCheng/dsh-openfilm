import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createActivationStore } from '../src/panel-keepalive.mjs';

test('activation follows the main placeholder and notifies subscribers', () => {
  const store = createActivationStore();
  const seen = [];
  const stop = store.subscribe(active => seen.push(active));
  const node = { id: 'seat' };
  assert.equal(store.isActive(), false);
  store.enter(node);
  assert.equal(store.isActive(), true);
  assert.equal(store.seat(), node);
  store.enter(node); // repeated mount must not notify twice
  assert.deepEqual(seen, [true]);
  store.leave();
  assert.equal(store.isActive(), false);
  assert.equal(store.seat(), undefined);
  assert.deepEqual(seen, [true, false]);
  stop();
  store.enter(node);
  assert.deepEqual(seen, [true, false], 'an unsubscribed listener must not run');
});

test('a throwing subscriber cannot break the panel', () => {
  const store = createActivationStore();
  const seen = [];
  store.subscribe(() => { throw new Error('boom'); });
  store.subscribe(active => seen.push(active));
  assert.doesNotThrow(() => store.enter({}));
  assert.deepEqual(seen, [true]);
});

test('the entry keeps the panel in a slot rendered for the whole frame', async () => {
  const entry = await readFile(new URL('../src/studio-entry.js', import.meta.url), 'utf8');
  // The panel body must NOT sit in the keyed main slot: switching pages would
  // unmount it and reload Studio. Only the tiny placeholder belongs there.
  assert.match(entry, /name: 'main', key: PANEL, locale: NS \}, PanelSeat\)/);
  assert.match(entry, /name: 'shell\.overlay', id: 'no996-openfilm-panel'/);
  assert.doesNotMatch(entry, /name: 'main', key: PANEL[^\n]*\}, Panel\)/);
  assert.match(entry, /if \(!mounted\) return null/);
  assert.match(entry, /display: shown \? 'block' : 'none'/);
});
