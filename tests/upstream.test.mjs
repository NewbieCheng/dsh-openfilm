import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { plan, splitDiff, groupOf } from '../scripts/split-patch.mjs';
import { compareVersions, consistency, readState, versionFromTarball } from '../scripts/upstream.mjs';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const DIFF = join(ROOT, 'vendor', 'official-shell', 'patch.diff');
const SERIES = JSON.parse(readFileSync(join(ROOT, 'patches', 'series.json'), 'utf8'));
const MANIFEST = JSON.parse(readFileSync(join(ROOT, 'vendor', 'official-shell', 'manifest.json'), 'utf8'));
const sha = (value) => createHash('sha256').update(value).digest('hex');

test('the patch series covers exactly the files the manifest records', () => {
  const fromSeries = SERIES.patches.map((patch) => patch.source).sort();
  const fromManifest = [...MANIFEST.patch.files].sort();
  assert.deepEqual(fromSeries, fromManifest);
  assert.equal(new Set(fromSeries).size, fromSeries.length, 'a file appears twice in the series');
});

test('every recorded patch still matches its hash and bytes', () => {
  for (const patch of SERIES.patches) {
    const body = readFileSync(join(ROOT, 'patches', patch.file), 'utf8');
    assert.equal(sha(body), patch.sha256, patch.file);
    assert.equal(Buffer.byteLength(body), patch.bytes, patch.file);
    assert.match(body, new RegExp(`^diff --git a/${patch.source.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} b/`));
  }
});

test('the series is exactly the current diff, split by file', () => {
  const text = readFileSync(DIFF, 'utf8');
  const chunks = splitDiff(text);
  assert.equal(chunks.length, SERIES.patches.length);
  const rebuilt = plan(text, SERIES.upstream);
  assert.deepEqual(rebuilt.patches, SERIES.patches);
  assert.equal(rebuilt.generatedFrom.sha256, SERIES.generatedFrom.sha256);
});

test('groups are coarse and deterministic', () => {
  assert.equal(groupOf('apps/desktop/chat/src/i18n/locales/zh-CN.ts'), 'i18n');
  assert.equal(groupOf('packages/shared/src/contract.ts'), 'shared');
  assert.equal(groupOf('apps/desktop/chat/src/components/ModelPopover.tsx'), 'menus');
  assert.equal(groupOf('apps/desktop/chat/src/components/OnboardingGate.tsx'), 'onboarding');
  assert.equal(groupOf('apps/desktop/chat/src/App.tsx'), 'chat');
});

test('the three pins agree', () => {
  const state = readState(ROOT);
  assert.equal(state.pin.version, MANIFEST.version);
  assert.deepEqual(consistency(state), []);
});

test('tarball versions and ordering are read without a registry', () => {
  assert.equal(versionFromTarball('https://registry.npmjs.org/openfilm/-/openfilm-0.3.2.tgz'), '0.3.2');
  assert.equal(versionFromTarball('openfilm@latest'), '');
  assert.equal(compareVersions('0.3.10', '0.3.9'), 1);
  assert.equal(compareVersions('0.3.2', '0.3.2'), 0);
  assert.equal(compareVersions('0.2.9', '0.3.0'), -1);
});

test('a drifted manifest is reported instead of silently accepted', () => {
  const state = readState(ROOT);
  const drifted = { ...state, manifest: { ...state.manifest, version: '9.9.9' }, series: { ...state.series, count: 1 } };
  const problems = consistency(drifted);
  assert.ok(problems.some((line) => line.includes('manifest version')));
  assert.ok(problems.some((line) => line.includes('patch series')));
});
