import test from 'node:test';
import assert from 'node:assert/strict';
import { openTurnPolicy, PROJECT_THINKING_DOMAIN, AUTO } from '../src/official-turn-policy.mjs';

const chain = () => ({ min: chain, regex: chain, int: chain, nonnegative: chain, strict: chain });
const z = { object: chain, string: chain, number: chain };
const project = 'film123';

function fixture() {
  const table = new Map();
  table.put = async (key, value) => table.set(key, value);
  const remove = Map.prototype.delete.bind(table);
  table.delete = async key => remove(key);
  const ctx = { storageDomain: { async open(options) { ctx.domain = options.name; return { table: () => table }; } } };
  return { ctx, table };
}

test('it opens its own domain and starts with no intent', async () => {
  const { ctx } = fixture();
  const policy = await openTurnPolicy(ctx, { z });
  assert.equal(ctx.domain, PROJECT_THINKING_DOMAIN);
  assert.equal(policy.thinking(project), undefined);
});

test('auto and a concrete effort are both remembered', async () => {
  const { ctx } = fixture();
  const policy = await openTurnPolicy(ctx, { z });
  await policy.setThinking(project, AUTO);
  assert.equal(policy.thinking(project), AUTO);
  await policy.setThinking(project, 'high');
  assert.equal(policy.thinking(project), 'high');
});

test('a value that cannot be an effort is refused before it is stored', async () => {
  const { ctx, table } = fixture();
  const policy = await openTurnPolicy(ctx, { z });
  await assert.rejects(policy.setThinking(project, 'not a rung / with spaces'), { code: 'PROJECT_THINKING_INPUT' });
  await assert.rejects(policy.setThinking('short', 'high'), { code: 'PROJECT_THINKING_INPUT' });
  assert.equal(table.size, 0);
});

test('a corrupt or foreign record is ignored rather than trusted', async () => {
  const { ctx, table } = fixture();
  table.set(project, { projectId: 'other999', thinking: 'high', at: 1 });
  const policy = await openTurnPolicy(ctx, { z });
  assert.equal(policy.thinking(project), undefined);
  table.set(project, { projectId: project, thinking: 'bad value with spaces', at: 1 });
  assert.equal(policy.thinking(project), undefined);
});

test('forgetting only drops the remembered intent', async () => {
  const { ctx, table } = fixture();
  table.set(project, { projectId: project, thinking: 'low', at: 1 });
  const policy = await openTurnPolicy(ctx, { z });
  assert.equal(await policy.forget(project), true);
  assert.equal(policy.thinking(project), undefined);
  assert.equal(table.get(project), undefined);
});
