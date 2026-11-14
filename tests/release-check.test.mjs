// Release rules are cheap to state and easy to forget, so they are pure functions
// with tests instead of prose in a playbook. Each case here is a mistake that has
// either happened in this repo (stale lockfile version, missing changelog entry) or
// is one commit away from happening (releasing a version whose tag already exists).
import assert from 'node:assert/strict';
import test from 'node:test';
import { releaseProblems } from '../scripts/release-check.mjs';

const base = {
  version: '0.15.1',
  changelog: '## 0.15.1 —— 收口\n\n- x\n',
  statusText: '| 仓库版本 | **0.15.1**（`package.json`） |',
  tags: ['v0.12.1'],
  dirty: false,
  lockVersion: '0.15.1',
};

test('a ready tree has no problems', () => {
  assert.deepEqual(releaseProblems(base), []);
});

test('a dirty tree blocks the release unless explicitly allowed', () => {
  assert.ok(releaseProblems({ ...base, dirty: true }).some(line => line.includes('not clean')));
});

test('a stale lockfile version blocks the release', () => {
  assert.ok(releaseProblems({ ...base, lockVersion: '0.13.4' }).some(line => line.includes('package-lock.json')));
});

test('a missing changelog section blocks the release', () => {
  assert.ok(releaseProblems({ ...base, changelog: '## 0.15.0 —— old\n' }).some(line => line.includes('CHANGELOG.md')));
});

test('a version that does not appear in STATUS blocks the release', () => {
  assert.ok(releaseProblems({ ...base, statusText: '| 仓库版本 | **0.15.0** |' }).some(line => line.includes('STATUS.md')));
});

test('an existing tag blocks the release', () => {
  assert.ok(releaseProblems({ ...base, tags: ['v0.15.1'] }).some(line => line.includes('tag v0.15.1')));
});

test('a missing changelog does not crash the check', () => {
  assert.deepEqual(releaseProblems({ ...base, changelog: null }), []);
});
