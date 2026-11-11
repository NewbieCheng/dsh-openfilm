// The pinned kernel and the bundled desktop shell must move together.
// `resolveOfficialShell()` refuses a shell whose manifest version differs from
// the installed openfilm version, and the refusal is not obvious from the panel:
// bootstrap answers 503, no project conversation can be opened, and the nine
// project tools disappear from the session. Upgrading the kernel alone broke
// exactly that once — this test is the tripwire.
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import test from 'node:test';

const read = path => JSON.parse(readFileSync(new URL(`../${path}`, import.meta.url), 'utf8'));

test('the pinned openfilm kernel matches the bundled desktop shell', () => {
  const pkg = read('package.json');
  const pinned = /^https:\/\/registry\.npmjs\.org\/openfilm\/-\/openfilm-(\d+\.\d+\.\d+)\.tgz$/
    .exec(String(pkg.dependencies.openfilm));
  assert.ok(pinned, 'dependencies.openfilm must be a pinned npmjs tarball URL');
  const manifest = read('vendor/official-shell/manifest.json');
  assert.equal(manifest.version, pinned[1],
    'vendor/official-shell was built from a different OpenFilm than package.json pins: '
    + `kernel ${pinned[1]} vs shell ${manifest.version}. Rebuild the shell (scripts/build-official-shell.mjs) `
    + 'or keep the kernel pin where the shell is.');
});

test('the bundled shell manifest names the commit it was built from', () => {
  const manifest = read('vendor/official-shell/manifest.json');
  assert.match(String(manifest.commit), /^[0-9a-f]{40}$/);
});
// The vendored shell is no longer a byte-for-byte upstream build: one file is
// patched so the composer menu can draw the permission row. The snapshot has to
// say so — a fork nobody can see is indistinguishable from a stale snapshot.
test('the shell snapshot declares its one upstream patch, or none at all', () => {
  const manifest = JSON.parse(readFileSync(new URL('../vendor/official-shell/manifest.json', import.meta.url), 'utf8'));
  const patchFile = new URL('../vendor/official-shell/patch.diff', import.meta.url);
  if (!manifest.patch) {
    assert.equal(existsSync(patchFile), false, 'a patch.diff without manifest.patch is an unrecorded fork');
    return;
  }
  assert.deepEqual(manifest.patch.files, ['apps/desktop/chat/src/lib/agent-menu-rows.ts']);
  assert.equal(existsSync(patchFile), true, 'manifest.patch must ship as patch.diff');
  const diff = readFileSync(patchFile, 'utf8');
  assert.match(diff, /^diff --git /m);
  assert.match(diff, /category === 'permission'/, 'the recorded diff must be the permission row');
});