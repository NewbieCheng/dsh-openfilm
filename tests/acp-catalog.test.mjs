import test from 'node:test';
import assert from 'node:assert/strict';
import { catalogFromConfigOptions } from '../src/acp-agent-service.mjs';

const options = [{
  id: 'model',
  category: 'model',
  currentValue: JSON.stringify(['deepseek-official', 'deepseek-v4-flash']),
  options: [
    { name: 'DeepSeek', options: [
      { value: JSON.stringify(['deepseek-official', 'deepseek-v4-flash']), name: 'DeepSeek V4 Flash' },
      { value: JSON.stringify(['deepseek-official', 'deepseek-flash']), name: 'DeepSeek Flash' },
    ] },
    { name: 'opencode-go', options: [
      { value: JSON.stringify(['opencode-go', 'deepseek-v4.1-flash']), name: 'DeepSeek V4.1 Flash' },
    ] },
  ],
}];

test('the old V4 is hidden and the default falls back to V4.1 Flash', () => {
  const catalog = catalogFromConfigOptions(options);
  const models = catalog.groups.flatMap(group => group.models.map(model => `${model.provider ?? group.id}/${model.id}`));
  assert.equal(models.includes('deepseek-official/deepseek-v4-flash'), false);
  assert.equal(models.includes('opencode-go/deepseek-v4.1-flash'), true);
  assert.deepEqual(catalog.default, { provider: 'deepseek-official', model: 'deepseek-flash' });
});

test('the old V4 can be kept for troubleshooting', () => {
  const previous = process.env.NO996_OPENFILM_KEEP_V4_FLASH;
  process.env.NO996_OPENFILM_KEEP_V4_FLASH = '1';
  try {
    const catalog = catalogFromConfigOptions(options);
    const models = catalog.groups.flatMap(group => group.models.map(model => `${model.provider ?? group.id}/${model.id}`));
    assert.equal(models.includes('deepseek-official/deepseek-v4-flash'), true);
    assert.deepEqual(catalog.default, { provider: 'deepseek-official', model: 'deepseek-v4-flash' });
  } finally {
    if (previous === undefined) delete process.env.NO996_OPENFILM_KEEP_V4_FLASH;
    else process.env.NO996_OPENFILM_KEEP_V4_FLASH = previous;
  }
});
