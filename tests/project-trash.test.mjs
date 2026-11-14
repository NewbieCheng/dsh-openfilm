// Deleting a project must refuse anything that is not an OpenFilm folder, and
// must never half-delete when the OS holds a file open.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, realpath, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, parse } from 'node:path';
import { createProjectTrash, TRASH_DIR } from '../src/project-trash.mjs';

async function project(over = {}) {
  const rawRoot = await mkdtemp(join(tmpdir(), 'n996-trash-'));
  const root = await realpath(rawRoot);
  const path = join(root, 'Projects', '自定义-7f8dfa');
  await mkdir(path, { recursive: true });
  if (!over.noMarker) {
    await writeFile(join(path, 'film.html'), '<html></html>', 'utf8');
    await mkdir(join(path, '.openfilm'), { recursive: true });
  }
  const trash = createProjectTrash({ home: root, now: () => new Date(2026, 10, 14, 9, 8, 7), suffix: () => 'abc123', ...over.options });
  return { root, path, trash };
}

test('a marked project moves to <root>/../.no996-trash with its film', async () => {
  const { root, path, trash } = await project();
  const result = await trash.discard(path);
  assert.equal(result.permanent, false);
  assert.equal(result.trashPath, join(dirname(dirname(path)), TRASH_DIR, '自定义-7f8dfa-20261114-090807-abc123'));
  await assert.rejects(stat(path), { code: 'ENOENT' });
  assert.match(await readFile(join(result.trashPath, 'film.html'), 'utf8'), /html/);
  await rm(root, { recursive: true, force: true });
});

test('a folder without a project marker is refused untouched', async () => {
  const { root, path, trash } = await project({ noMarker: true });
  await assert.rejects(trash.discard(path), { code: 'PROJECT_NOT_OPENFILM' });
  await stat(path);
  await rm(root, { recursive: true, force: true });
});

test('a top-level directory or non-directory is refused', async () => {
  const { root, trash } = await project();
  await assert.rejects(trash.discard(parse(root).root), { code: 'PROJECT_PATH_INVALID' });
  await assert.rejects(trash.discard(join(root, 'missing')), { code: 'PROJECT_PATH_INVALID' });
  await rm(root, { recursive: true, force: true });
});

test('a busy rename aborts without deleting anything', async () => {
  const real = await import('node:fs/promises');
  const locked = {
    ...real,
    rename: async () => { throw Object.assign(new Error('locked'), { code: 'EPERM' }); },
    access: real.access,
  };
  const { root, path, trash } = await project({ options: { fs: locked } });
  await assert.rejects(trash.discard(path), { code: 'PROJECT_BUSY' });
  await stat(path);
  await rm(root, { recursive: true, force: true });
});

test('permanent deletion removes the project without a trash copy', async () => {
  const { root, path, trash } = await project();
  const result = await trash.discard(path, { permanent: true });
  assert.equal(result.permanent, true);
  assert.equal(result.trashPath, null);
  await assert.rejects(stat(path), { code: 'ENOENT' });
  await assert.rejects(stat(join(root, TRASH_DIR)), { code: 'ENOENT' });
  await rm(root, { recursive: true, force: true });
});
