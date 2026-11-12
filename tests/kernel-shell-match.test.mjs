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
  assert.ok(Array.isArray(manifest.patch.files) && manifest.patch.files.length > 0, 'the patch must name the files it changes');
  // The two code edits are the fork; the locale files only carry the search strings.
  for (const required of ['apps/desktop/chat/src/components/ModelPopover.tsx', 'apps/desktop/chat/src/lib/agent-menu-rows.ts']) {
    assert.ok(manifest.patch.files.includes(required), 'the patch must include ' + required);
  }
  assert.equal(existsSync(patchFile), true, 'manifest.patch must ship as patch.diff');
  const diff = readFileSync(patchFile, 'utf8');
  assert.match(diff, /^diff --git /m);
  for (const file of manifest.patch.files) assert.ok(diff.includes('b/' + file), 'patch.diff must carry ' + file);
  assert.match(diff, /category === 'permission'/, 'the recorded diff must include the permission row');
  assert.match(diff, /data-agent-option-level/, 'and the one-level menu');
  assert.match(diff, /data-agent-search/, 'and its search box');
  assert.match(diff, /data-agent-choice-group/, 'and the model menu grouped by provider');
  assert.match(diff, /data-session-delete/, 'and a conversation that can be deleted');
  // The panel shows what the agent thought: the bridge passes the reasoning text through, the
  // transcript keeps a thought row, and the row renders. All four links must stay in the patch.
  for (const file of [
    'apps/desktop/chat/src/lib/agent-transcript.ts',
    'apps/desktop/chat/src/lib/local-agent-run.ts',
    'apps/desktop/chat/src/components/AgentActivityRow.tsx',
    'packages/shared/src/contract.ts',
  ]) {
    assert.ok(manifest.patch.files.includes(file), 'the patch must include ' + file);
  }
  assert.match(diff, /data-thought/, 'the thought block must be rendered');
  assert.match(diff, /agent_thought_chunk/, 'and fed from the agent thought chunks');

  // The panel says what actually ran: the real tool name travels beside the closed act, and the
  // row prints it. A picture the agent made is drawn in the transcript, not left as a file name.
  for (const file of [
    'apps/desktop/chat/src/components/Markdown.tsx',
    'packages/shared/src/markdown-blocks.ts',
  ]) {
    assert.ok(manifest.patch.files.includes(file), 'the patch must include ' + file);
  }
  assert.match(diff, /data-tool-name/, 'the act row must print the tool name');
  assert.match(diff, /toolName/, 'and the bridge must be able to pass it in');
  assert.match(diff, /kind: 'image'/, 'an empty-label markdown link is a picture');
  assert.match(diff, /InlinePicture/, 'and the transcript draws it');
});
