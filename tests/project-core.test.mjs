import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createProjectCore } from '../src/project-core.mjs';

function fixture(t) {
  const dir = mkdtempSync(path.join(tmpdir(), 'dsh-film-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const root = path.join(dir, 'workspace');
  mkdirSync(root);
  mkdirSync(path.join(root, 'project'));
  return { dir, root, project: path.join(root, 'project') };
}
const code = (expected) => (e) => e.code === expected;

test('create, read and versioned edit use the upstream film format', async (t) => {
  const { root, project } = fixture(t);
  const core = await createProjectCore({ workspace: root });
  const first = core.create('project', { stage: { w: 640, h: 360 }, tracks: [{ clips: [{ src: 'scene.html', time: [0, 3] }] }] });
  assert.match(first.text, /<iframe/);
  assert.equal(first.doc.stage.w, 640);
  assert.equal(first.doc.tracks[0].clips[0].id, 'scene');
  assert.match(first.version, /^[a-f0-9]{64}$/);
  assert.throws(() => core.create('project'), code('EEXIST'));
  const edited = structuredClone(first.value);
  edited.stage.w = 1280;
  const next = core.write('project', edited, first.version);
  assert.equal(next.doc.stage.w, 1280);
  assert.notEqual(next.version, first.version);
  assert.equal(core.read('project').version, next.version);
  assert.throws(() => core.write('project', first.value, first.version), code('CONFLICT'));
  assert.equal(readFileSync(path.join(project, 'film.html'), 'utf8'), next.text);
});

test('detect external edits, invalid films, missing versions, and held locks', async (t) => {
  const { root, project } = fixture(t);
  const core = await createProjectCore({ workspace: root });
  const first = core.create('project');
  assert.throws(() => core.write('project', first.value), code('VERSION'));
  const externallyEdited = first.text.replace('<body>', '<body>\n<!-- external -->');
  writeFileSync(path.join(project, 'film.html'), externallyEdited);
  assert.throws(() => core.write('project', first.value, first.version), code('CONFLICT'));
  assert.equal(readFileSync(path.join(project, 'film.html'), 'utf8'), externallyEdited);
  const now = core.read('project');
  const changed = core.write('project', { stage: { w: 10, h: 20 }, tracks: [] }, now.version);
  assert.match(changed.text, /<!-- external -->/);
  assert.throws(() => core.write('project', { tracks: 'bad' }, changed.version), code('INVALID_FILM'));
  writeFileSync(path.join(project, '.dsh-openfilm.lock'), 'held');
  assert.throws(() => core.write('project', changed.value, changed.version), code('LOCKED'));
  assert.equal(core.read('project').version, changed.version);
});

test('reads invalid HTML as data and refuses to rewrite it', async (t) => {
  const { root, project } = fixture(t);
  const core = await createProjectCore({ workspace: root });
  const text = '<!doctype html><head><script>globalThis.__filmExecuted = true</script></head><body></body>';
  writeFileSync(path.join(project, 'film.html'), text);
  const read = core.read('project');
  assert.equal(globalThis.__filmExecuted, undefined);
  assert.equal(read.doc, null);
  assert.ok(read.problems.length);
  assert.throws(() => core.write('project', { tracks: [] }, read.version), code('INVALID_FILM'));
  assert.equal(readFileSync(path.join(project, 'film.html'), 'utf8'), text);
});

test('rejects traversal, absolute paths, links, and unpinned dependencies', async (t) => {
  const { dir, root, project } = fixture(t);
  const core = await createProjectCore({ workspace: root });
  for (const p of ['../outside', 'project/../project', path.resolve(project), 'C:outside', 'project//child']) {
    assert.throws(() => core.read(p), code('PATH'));
  }
  const fake = path.join(dir, 'fake.mjs');
  writeFileSync(fake, 'export {}');
  await assert.rejects(createProjectCore({ workspace: root, filmDocPath: fake }), code('DEPENDENCY'));
  const outside = path.join(dir, 'outside');
  mkdirSync(outside);
  writeFileSync(path.join(outside, 'film.html'), 'secret');
  try { symlinkSync(outside, path.join(root, 'linked'), 'junction'); }
  catch (e) { if (e.code === 'EPERM' || e.code === 'EACCES') return; throw e; }
  assert.throws(() => core.read('linked'), code('PATH'));
  try { symlinkSync(path.join(outside, 'film.html'), path.join(project, 'film.html'), 'file'); }
  catch (e) { if (e.code === 'EPERM' || e.code === 'EACCES') return; throw e; }
  assert.throws(() => core.read('project'), code('PATH'));
  assert.throws(() => core.create('project'), code('EEXIST'));
  assert.equal(readFileSync(path.join(outside, 'film.html'), 'utf8'), 'secret');
});
