// Two pieces of UI that used to be runtime injections now live in the upstream
// shell source (apps/desktop/shell/{RecoveryGate,EnvironmentNotice}.tsx) and ship in
// the vendored build. Our repo cannot render React in a test, so this asserts the
// two halves that *are* checkable: the injection no longer carries them, and the
// shipped bundle still does. Behavior itself is verified by the manual acceptance
// run (playbooks/manual-acceptance.md).
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const injection = readFileSync(join(root, 'assets', 'shell-ui.js'), 'utf8');
const assets = join(root, 'vendor', 'official-shell', 'ui', 'assets');
const bundle = readdirSync(assets)
  .filter(name => name.endsWith('.js'))
  .map(name => readFileSync(join(assets, name), 'utf8'))
  .join('\n');

test('the recovery overlay is source, not injection', () => {
  assert.doesNotMatch(injection, /no996-stopped/);
  assert.match(bundle, /重新启动工作台/);
  assert.match(bundle, /no996-openfilm:restart/);
});

test('the environment notice is source, not injection', () => {
  assert.doesNotMatch(injection, /no996-environment/);
  assert.doesNotMatch(injection, /__no996CheckTools=/);
  assert.match(bundle, /视频工具环境检查/);
  assert.match(bundle, /environment:check/);
  assert.match(bundle, /尚未配置或安装/);
});

test('the template picker is in the shell source, and the injection yields to it', () => {
  // Mid-migration on purpose: the React picker is live, the old injection still
  // exists but must not render its cloned card while the React one is on the page.
  assert.match(bundle, /你想剪哪种视频？/);
  assert.match(bundle, /用这个开工/);
  assert.match(bundle, /data-no996-template-react/);
  assert.match(injection, /data-no996-template-react/);
});

test('the login gate ships in the bundle, not as a page script', () => {
  assert.doesNotMatch(injection, /no996-shell-login/);
  assert.doesNotMatch(injection, /__NOF_MOUNT_CITY__/);
  assert.match(bundle, /no996-shell-login/);
  assert.match(bundle, /__NOF_MOUNT_CITY__/);
});

test('both components are mounted by the shell entry', () => {
  // The entry is upstream source; the patch series is what carries it. Find the
  // patch through series.json rather than guessing its number.
  const series = JSON.parse(readFileSync(join(root, 'patches', 'series.json'), 'utf8'));
  const entry = series.patches.find(patch => patch.source.endsWith('apps/desktop/shell/main.tsx'));
  assert.ok(entry, 'series records the shell entry');
  const patch = readFileSync(join(root, 'patches', entry.file), 'utf8');
  assert.match(patch, /RecoveryGate/);
  assert.match(patch, /EnvironmentNotice/);
  const starters = series.patches.find(entry => entry.source.endsWith('apps/desktop/chat/src/components/ProjectStarters.tsx'));
  assert.ok(starters, 'series records the starters component');
  assert.match(readFileSync(join(root, 'patches', starters.file), 'utf8'), /TemplatePicker/);
});
