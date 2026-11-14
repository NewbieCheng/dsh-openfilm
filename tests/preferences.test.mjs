import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createPreferencesStore, onboardingCopy, productMeta } from '../src/preferences.mjs';

test('preferences default, persist, and sanitize', async () => {
  const home = await mkdtemp(join(tmpdir(), 'nof-prefs-'));
  const store = createPreferencesStore({ home });
  assert.deepEqual(await store.get(), {
    onboardingCompleted: false,
    defaultTemplateId: '',
    customRatio: '16:9',
    customSeconds: 30,
    customLanguage: '中文',
    lastProjectId: '',
    cachedAvailablePoints: null,
    cachedPointsBalance: null,
    cachedPeriodPointsBalance: null,
    cachedExpertPointsBalance: null,
    cachedPeriodExpiresAt: '',
    cachedBalanceAt: '',
  });
  const saved = await store.set({
    onboardingCompleted: true,
    defaultTemplateId: 'paper-texture',
    lastProjectId: 'proj_abcdef',
    cachedAvailablePoints: 1200,
    cachedPointsBalance: 1000,
    cachedPeriodPointsBalance: 200,
    cachedExpertPointsBalance: 0,
    cachedBalanceAt: '2026-11-12T00:00:00.000Z',
  });
  assert.equal(saved.onboardingCompleted, true);
  assert.equal(saved.defaultTemplateId, 'paper-texture');
  assert.equal(saved.lastProjectId, 'proj_abcdef');
  assert.equal(saved.cachedAvailablePoints, 1200);
  assert.equal(saved.cachedPeriodPointsBalance, 200);
  const disk = JSON.parse(await readFile(store.file, 'utf8'));
  assert.equal(disk.onboardingCompleted, true);
  assert.equal(disk.cachedAvailablePoints, 1200);
  const again = createPreferencesStore({ home });
  assert.deepEqual(await again.get(), saved);
  await assert.rejects(() => store.set({ defaultTemplateId: '../evil' }), /无效模板/);
  await assert.rejects(() => store.set({ cachedAvailablePoints: -1 }), /无效积分缓存/);
});

test('balance cache helpers match 清流 available = permanent + period', async () => {
  const { balanceCachePatch, balanceFromPrefs, clearBalanceCachePatch } = await import('../src/preferences.mjs');
  const patch = balanceCachePatch({
    points_balance: 100,
    period_points_balance: 50,
    expert_points_balance: 3,
    available_points: 150,
    period_expires_at: '2026-12-01T00:00:00.000Z',
  });
  assert.equal(patch.cachedAvailablePoints, 150);
  assert.equal(patch.cachedPointsBalance, 100);
  assert.equal(patch.cachedPeriodPointsBalance, 50);
  const view = balanceFromPrefs({ ...patch });
  assert.equal(view.available_points, 150);
  assert.equal(view.expert_points_balance, 3);
  const cleared = clearBalanceCachePatch();
  assert.equal(cleared.cachedAvailablePoints, null);
  assert.equal(cleared.cachedBalanceAt, '');
});

test('product catalog and onboarding copy cover five choices', () => {
  for (const id of ['paper-texture', 'replica-film', 'sketchnote', 'motion-styles', 'custom']) {
    const meta = productMeta(id);
    assert.ok(meta?.productTitle);
    assert.match(meta.productBlurb, /适合/);
    assert.doesNotMatch(meta.productBlurb, /DrawAI|film\.html/);
    const copy = onboardingCopy(id);
    assert.ok(copy.title.includes('AI 剪辑员工'));
    assert.ok(copy.steps.length >= 3);
    assert.match(copy.uploadHint, /对话框/);
  }
  assert.equal(productMeta('nope'), null);
});
