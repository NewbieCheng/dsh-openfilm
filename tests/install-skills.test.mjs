// The video skill has to be installable without a DSH restart, and only where DSH looks.
//
// `dsh-skill-filesystem` scans `<dshHome>/skills` and watches it, so copying a skill there is the
// supported way in. This guards the three things that would silently break it: the destination root,
// the frontmatter requirement, and not overwriting a person's own edits by default.
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = fileURLToPath(new URL('..', import.meta.url));
const script = join(repo, 'scripts', 'install-skills.mjs');

function run(home, ...args) {
  return execFileSync(process.execPath, [script, ...args], {
    env: { ...process.env, DSH_HOME: home }, encoding: 'utf8',
  });
}

test('installs the shipped skill into <DSH_HOME>/skills and keeps it by default', () => {
  const home = mkdtempSync(join(tmpdir(), 'dsh-home-'));
  const first = run(home);
  assert.match(first, /installed openfilm-editing/);
  const installed = join(home, 'skills', 'openfilm-editing', 'SKILL.md');
  assert.equal(existsSync(installed), true);
  assert.match(readFileSync(installed, 'utf8'), /^---\r?\nname: openfilm-editing/m);

  // A second run leaves the person's copy alone: editing a skill by hand must survive.
  writeFileSync(installed, '---\nname: openfilm-editing\ndescription: mine\n---\nmine\n');
  const second = run(home);
  assert.match(second, /keep openfilm-editing/);
  assert.match(readFileSync(installed, 'utf8'), /mine/);

  // --force is the explicit way to take ours back.
  run(home, '--force');
  assert.match(readFileSync(installed, 'utf8'), /剪辑手法|OpenFilm/);
});

test('--print says what it would do and writes nothing', () => {
  const home = mkdtempSync(join(tmpdir(), 'dsh-home-'));
  const out = run(home, '--print');
  assert.match(out, /would install openfilm-editing/);
  assert.equal(existsSync(join(home, 'skills')), false);
});

test('a skill without frontmatter is refused rather than half-installed', () => {
  const home = mkdtempSync(join(tmpdir(), 'dsh-home-'));
  const source = join(repo, 'skills', 'broken-example');
  mkdirSync(source, { recursive: true });
  writeFileSync(join(source, 'SKILL.md'), 'no frontmatter here\n');
  try {
    const out = run(home);
    assert.match(out, /skip broken-example/);
    assert.equal(existsSync(join(home, 'skills', 'broken-example')), false);
  } finally {
    rmSync(source, { recursive: true, force: true });
  }
});
