#!/usr/bin/env node
/**
 * Pre-release gate: the four things a human forgets when the tests are green.
 *
 *   node scripts/release-check.mjs               # release day
 *   node scripts/release-check.mjs --allow-dirty # while drafting the commit
 *
 * The rules are advisory in the sense that nothing here changes files; each failure
 * names the file and what to do. `npm run check` answers "is the tree healthy",
 * this answers "is this tree allowed to become a release".
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));

/** Pure so the rules are testable without a git repo or a release on disk. */
export function releaseProblems({ version, changelog, statusText, tags = [], dirty = false, lockVersion = null }) {
  const problems = [];
  if (!version) {
    problems.push('package.json has no version');
    return problems;
  }
  if (dirty) problems.push('working tree is not clean — commit or stash first (`--allow-dirty` to skip)');
  if (lockVersion && lockVersion !== version) problems.push(`package-lock.json says ${lockVersion}, package.json is ${version}`);
  if (changelog !== null && !new RegExp(`^##\\s+${version.replace(/\./g, '\\.')}(\\b|\\s)`, 'm').test(changelog)) {
    problems.push(`CHANGELOG.md has no "## ${version}" section`);
  }
  if (statusText !== null && !statusText.includes(`**${version}**`)) {
    problems.push(`docs/STATUS.md does not state **${version}** as the current version`);
  }
  if (tags.includes(`v${version}`)) {
    problems.push(`tag v${version} already exists — bump the version before releasing`);
  }
  return problems;
}

function git(...args) {
  try {
    return execFileSync('git', args, { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    return '';
  }
}

function readIfPresent(path) {
  try {
    return existsSync(path) ? readFileSync(path, 'utf8') : null;
  } catch {
    return null;
  }
}

export function inspectRepo() {
  const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
  const lock = JSON.parse(readFileSync(join(ROOT, 'package-lock.json'), 'utf8'));
  const tags = git('tag', '--list', 'v*').split('\n').filter(Boolean);
  return {
    version: pkg.version,
    lockVersion: lock.version,
    changelog: readIfPresent(join(ROOT, 'CHANGELOG.md')),
    statusText: readIfPresent(join(ROOT, 'docs', 'STATUS.md')),
    tags,
    dirty: git('status', '--porcelain') !== '',
  };
}

function main() {
  const allowDirty = process.argv.includes('--allow-dirty');
  const state = inspectRepo();
  if (allowDirty) state.dirty = false;
  const problems = releaseProblems(state);
  for (const problem of problems) process.stdout.write(`release-check: ${problem}\n`);
  if (problems.length) {
    process.stdout.write(`release-check: ${problems.length} problem(s) — not ready to release\n`);
    process.exitCode = 1;
    return;
  }
  process.stdout.write(`release-check ok (${state.version})\n`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) main();
