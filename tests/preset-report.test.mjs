import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { reportPresetStatus } from '../src/preset-report.mjs';

const ctxWith = roster => ({ get: name => (name === 'agentPresets' ? { list: async () => roster } : undefined) });

test('reports an activated preset, an activation failure and a missing row', async t => {
  const dir = mkdtempSync(join(tmpdir(), 'openfilm-report-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const file = join(dir, 'report.json');

  const ok = await reportPresetStatus(ctxWith([{ id: 'openfilm-video-editing' }, { id: 'standard' }]), { file }).done;
  assert.deepEqual(ok.ok, true);
  assert.equal(ok.registered, true);
  assert.deepEqual(ok.presets, ['openfilm-video-editing', 'standard']);
  assert.equal(JSON.parse(readFileSync(file, 'utf8')).ok, true);

  const failed = await reportPresetStatus(ctxWith([{ id: 'openfilm-video-editing', error: 'MODULE_NOT_FOUND dsh-tool-web' }]), { file }).done;
  assert.equal(failed.ok, false);
  assert.match(failed.detail, /MODULE_NOT_FOUND/);

  // The shape 0.2.2 actually uses: a successful list() item carrying `broken`.
  const broken = await reportPresetStatus(ctxWith([{ id: 'openfilm-video-editing', broken: 'tool-fs-search: invalid config' }]), { file }).done;
  assert.equal(broken.ok, false, 'a broken child must not be reported as ok');
  assert.match(broken.detail, /invalid config/);
  assert.match(broken.raw, /invalid config/);

  const missing = await reportPresetStatus(ctxWith([{ id: 'standard' }]), { file }).done;
  assert.equal(missing.registered, false);
  assert.equal(JSON.parse(readFileSync(file, 'utf8')).registered, false);
});

test('a registry that throws is reported instead of breaking startup', async () => {
  const throwing = { get: () => ({ list: async () => { throw new Error('registry unavailable'); } }) };
  const report = await reportPresetStatus(throwing, { file: join(tmpdir(), 'openfilm-report-unused.json') }).done;
  assert.equal(report.ok, false);
  assert.match(report.detail, /registry unavailable/);
});
