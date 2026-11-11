import test from 'node:test';
import assert from 'node:assert/strict';
import { openProjectPermissions, PROJECT_PERMISSIONS_DOMAIN } from '../src/official-permission.mjs';

const chain = () => ({ min: chain, regex: chain, int: chain, nonnegative: chain, strict: chain });
const z = { object: chain, string: chain, number: chain };
const project = 'film123';

function fixture({ presets = true, deleteSupported = true } = {}) {
  const table = new Map();
  table.put = async (key, value) => table.set(key, value);
  const remove = Map.prototype.delete.bind(table);
  table.delete = deleteSupported ? (async key => remove(key)) : undefined;
  const sets = [];
  const service = {
    names: ['workspace-write', 'danger-full-access'],
    current: session => service.values.get(session.id),
    set(session, name) {
      sets.push([session.id, name]);
      service.values.set(session.id, name);
    },
    values: new Map(),
  };
  const ctx = {
    storageDomain: { async open(options) { ctx.domainName = options.name; return { table: () => table }; } },
    agents: { list: () => [{ session: { id: 'session-a' } }, { session: { id: 'session-b' } }] },
    get: name => (presets && name === 'permissionPresets' ? service : undefined),
  };
  return { ctx, table, sets, service };
}

test('it opens its own domain and starts with no decision', async () => {
  const { ctx } = fixture();
  const permissions = await openProjectPermissions(ctx, { z });
  assert.equal(ctx.domainName, PROJECT_PERMISSIONS_DOMAIN);
  assert.equal(permissions.available(), true);
  assert.equal(permissions.remembered(project), undefined);
  assert.deepEqual(permissions.names(), ['workspace-write', 'danger-full-access']);
});

test('applying full access writes the Session preset and remembers the decision', async () => {
  const { ctx, table, sets } = fixture();
  const permissions = await openProjectPermissions(ctx, { z });
  assert.deepEqual(await permissions.apply(project, 'session-a', 'danger-full-access'), { projectId: project, preset: 'danger-full-access' });
  assert.deepEqual(sets, [['session-a', 'danger-full-access']]);
  assert.equal(table.get(project).preset, 'danger-full-access');
  assert.equal(permissions.remembered(project), 'danger-full-access');
  assert.equal(permissions.current('session-a'), 'danger-full-access');
});

test('a project id or preset that the Host cannot vouch for is refused', async () => {
  const { ctx, sets } = fixture();
  const permissions = await openProjectPermissions(ctx, { z });
  await assert.rejects(permissions.apply('short', 'session-a', 'danger-full-access'), { code: 'PROJECT_PERMISSION_INPUT' });
  await assert.rejects(permissions.apply(project, 'session-a', 'root'), { code: 'PROJECT_PERMISSION_INPUT' });
  assert.deepEqual(sets, []);
});

test('a Session that is not live is refused instead of silently remembered', async () => {
  const { ctx, table } = fixture();
  const permissions = await openProjectPermissions(ctx, { z });
  await assert.rejects(permissions.apply(project, 'session-gone', 'danger-full-access'), { code: 'PROJECT_PERMISSION_SESSION' });
  assert.equal(table.get(project), undefined);
});

test('a DSH build without permission presets says so instead of pretending', async () => {
  const { ctx } = fixture({ presets: false });
  const permissions = await openProjectPermissions(ctx, { z });
  assert.equal(permissions.available(), false);
  await assert.rejects(permissions.apply(project, 'session-a', 'danger-full-access'), { code: 'PROJECT_PERMISSION_UNAVAILABLE' });
});

test('a deployment that does not offer the preset gets the offered names back', async () => {
  const { ctx, service } = fixture();
  service.names = ['read-only', 'workspace-write'];
  const permissions = await openProjectPermissions(ctx, { z });
  await assert.rejects(permissions.apply(project, 'session-a', 'danger-full-access'), { code: 'PROJECT_PERMISSION_UNAVAILABLE' });
});

test('resume re-applies a remembered decision to a Session created later', async () => {
  const { ctx, table, sets } = fixture();
  table.set(project, { projectId: project, preset: 'danger-full-access', at: 1 });
  const permissions = await openProjectPermissions(ctx, { z });
  assert.deepEqual(await permissions.resume(project, 'session-b'), { projectId: project, preset: 'danger-full-access', applied: true });
  assert.deepEqual(sets, [['session-b', 'danger-full-access']]);
  // Already in force: nothing is written twice.
  assert.deepEqual(await permissions.resume(project, 'session-b'), { projectId: project, preset: 'danger-full-access', applied: false });
  assert.equal(sets.length, 1);
});

test('resume never applies anything when the remembered choice is the safer one', async () => {
  const { ctx, table, sets } = fixture();
  table.set(project, { projectId: project, preset: 'workspace-write', at: 1 });
  const permissions = await openProjectPermissions(ctx, { z });
  assert.deepEqual(await permissions.resume(project, 'session-a'), { projectId: project, preset: 'workspace-write', applied: false });
  assert.deepEqual(sets, []);
});

test('a stored record for another project or an unknown preset is ignored', async () => {
  const { ctx, table } = fixture();
  table.set(project, { projectId: 'other999', preset: 'danger-full-access', at: 1 });
  const permissions = await openProjectPermissions(ctx, { z });
  assert.equal(permissions.remembered(project), undefined);
  table.set(project, { projectId: project, preset: 'root', at: 1 });
  assert.equal(permissions.remembered(project), undefined);
});

test('a decision recorded before the first message is applied by resume later', async () => {
  const { ctx, table, sets } = fixture();
  const permissions = await openProjectPermissions(ctx, { z });
  assert.deepEqual(await permissions.decide(project, 'danger-full-access'), { projectId: project, preset: 'danger-full-access', applied: false });
  assert.equal(permissions.remembered(project), 'danger-full-access');
  assert.deepEqual(sets, []);
  assert.deepEqual(await permissions.resume(project, 'session-a'), { projectId: project, preset: 'danger-full-access', applied: true });
  assert.deepEqual(sets, [['session-a', 'danger-full-access']]);
});

test('a decision never records a preset the deployment does not offer', async () => {
  const { ctx, service, table } = fixture();
  service.names = ['read-only'];
  const permissions = await openProjectPermissions(ctx, { z });
  await assert.rejects(permissions.decide(project, 'danger-full-access'), { code: 'PROJECT_PERMISSION_UNAVAILABLE' });
  assert.equal(table.get(project), undefined);
});

test('forgetting is honest about a table that cannot delete', async () => {
  const { ctx, table } = fixture({ deleteSupported: false });
  table.set(project, { projectId: project, preset: 'danger-full-access', at: 1 });
  const permissions = await openProjectPermissions(ctx, { z });
  assert.equal(await permissions.forget(project), false);
  assert.equal(permissions.remembered(project), 'danger-full-access');
});

test('forgetting removes only the remembered decision', async () => {
  const { ctx, table, service } = fixture();
  table.set(project, { projectId: project, preset: 'danger-full-access', at: 1 });
  service.values.set('session-a', 'danger-full-access');
  const permissions = await openProjectPermissions(ctx, { z });
  assert.equal(await permissions.forget(project), true);
  assert.equal(permissions.remembered(project), undefined);
  assert.equal(permissions.current('session-a'), 'danger-full-access');
});
