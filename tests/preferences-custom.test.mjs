import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createPreferencesStore, onboardingCopy } from '../src/preferences.mjs';

test('自定义画布与时长：默认值、合法值、拒绝非法值', async (t) => {
  const home = mkdtempSync(join(tmpdir(), 'openfilm-prefs-'));
  t.after(() => rmSync(home, { recursive: true, force: true }));
  const prefs = createPreferencesStore({ home });
  const initial = await prefs.get();
  assert.equal(initial.customRatio, '16:9');
  assert.equal(initial.customSeconds, 30);

  const saved = await prefs.set({ customRatio: '9:16', customSeconds: 60, onboardingCompleted: true });
  assert.equal(saved.customRatio, '9:16');
  assert.equal(saved.customSeconds, 60);

  await assert.rejects(() => prefs.set({ customRatio: '4:3' }), /画布比例/);
  await assert.rejects(() => prefs.set({ customSeconds: 45 }), /时长/);

  const copy = onboardingCopy('custom', { ratio: '9:16', seconds: 60 });
  assert.equal(copy.ratio, '9:16');
  assert.equal(copy.seconds, 60);
});
