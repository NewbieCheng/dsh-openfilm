// The editing list's pin and display name are cosmetic and local: they never
// rename a project, a film or a DSH Session, and losing the file only loses the
// pins. These tests pin that contract.
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { createEditingPrefs } from '../src/editing-prefs.mjs';

test('a pin and a display title round-trip and are listed', () => {
  const prefs = createEditingPrefs();
  assert.deepEqual(prefs.get('proj_ABC123'), undefined);
  prefs.set('proj_ABC123', { pinned: true, title: '  项目改造  ' });
  assert.deepEqual(prefs.get('proj_ABC123'), { pinned: true, title: '项目改造' });
  assert.deepEqual(prefs.all(), { proj_ABC123: { pinned: true, title: '项目改造' } });
});

test('clearing the title and the pin removes the record', () => {
  const prefs = createEditingPrefs();
  prefs.set('proj_ABC123', { pinned: true, title: 'x' });
  prefs.set('proj_ABC123', { title: '' });
  assert.deepEqual(prefs.get('proj_ABC123'), { pinned: true });
  prefs.set('proj_ABC123', { pinned: false });
  assert.equal(prefs.get('proj_ABC123'), undefined);
  assert.deepEqual(prefs.all(), {});
});

test('an invalid project id is refused instead of stored', () => {
  const prefs = createEditingPrefs();
  prefs.set('bad id!', { pinned: true });
  prefs.set('', { pinned: true });
  assert.deepEqual(prefs.all(), {});
});

test('removing a project forgets its pin/title and every conversation pref', () => {
  const prefs = createEditingPrefs();
  prefs.set('proj_ABC123', { pinned: true, title: 'x' });
  prefs.setSession('proj_ABC123', 'sess_XYZ789', { pinned: true, title: 'y' });
  prefs.setSession('proj_OTHER1', 'sess_XYZ789', { title: '别的项目' });
  assert.equal(prefs.remove('proj_ABC123'), true);
  assert.equal(prefs.get('proj_ABC123'), undefined);
  assert.equal(prefs.getSession('proj_ABC123', 'sess_XYZ789'), undefined);
  assert.deepEqual(prefs.getSession('proj_OTHER1', 'sess_XYZ789'), { pinned: false, title: '别的项目' });
  assert.equal(prefs.remove('proj_ABC123'), false);
});

test('conversation pins and titles are stored per session', () => {
  const prefs = createEditingPrefs();
  prefs.setSession('proj_ABC123', 'sess_XYZ789', { pinned: true, title: '第一条' });
  assert.deepEqual(prefs.getSession('proj_ABC123', 'sess_XYZ789'), { pinned: true, title: '第一条' });
  assert.equal(prefs.get('proj_ABC123'), undefined);
  prefs.setSession('proj_ABC123', 'sess_XYZ789', { pinned: false });
  assert.deepEqual(prefs.getSession('proj_ABC123', 'sess_XYZ789'), { pinned: false, title: '第一条' });
});

test('the store persists to its file and survives a reload', () => {
  const dir = mkdtempSync(join(tmpdir(), 'editing-prefs-'));
  const file = join(dir, 'editing-prefs.json');
  const first = createEditingPrefs({ file });
  first.set('proj_ABC123', { pinned: true, title: '素材' });
  const onDisk = JSON.parse(readFileSync(file, 'utf8'));
  assert.equal(onDisk.version, 1);
  assert.deepEqual(onDisk.projects.proj_ABC123, { pinned: true, title: '素材' });
  const second = createEditingPrefs({ file });
  assert.deepEqual(second.get('proj_ABC123'), { pinned: true, title: '素材' });
});
