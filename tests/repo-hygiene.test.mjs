// `films/` is real user data (films, assets, the delete-trash) living inside the
// working tree so that one folder holds everything. Two things keep it from being
// published: `.gitignore` and the npm `files` whitelist. Both are one careless edit
// away from failing silently, so they are pinned here.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = path => readFileSync(join(root, path), 'utf8');

test('the local film library is git-ignored', () => {
  assert.match(read('.gitignore'), /^\/films\/$/m);
  if (!existsSync(join(root, '.git'))) return; // packaged tarball: nothing to check
  const ignored = execFileSync('git', ['check-ignore', '-q', 'films/Projects'], { cwd: root, stdio: 'ignore' });
  void ignored; // exit 0 = ignored; a non-zero exit throws and fails the test
});

test('the npm package whitelist does not ship films', () => {
  const files = JSON.parse(read('package.json')).files ?? [];
  assert.equal(files.some(entry => entry === 'films' || entry.startsWith('films/')), false);
});

test('the storage reference explains where the library lives', () => {
  const storage = read('docs/reference/storage.md');
  assert.match(storage, /films\/Projects/);
  assert.match(storage, /studio\.json/);
});
