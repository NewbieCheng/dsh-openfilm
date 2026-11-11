import test from 'node:test';
import assert from 'node:assert/strict';
import { AUTO, modelEntry, effortsOf, thinkingOption, chooseEffort } from '../src/official-thinking.mjs';

const catalog = {
  groups: [{
    id: 'deepseek', name: 'DeepSeek', models: [
      { id: 'flash', name: 'V4 Flash', reasoning: { efforts: [{ id: 'low', name: '低' }, { id: 'medium', name: '中' }, { id: 'high', name: '高' }], defaultEffort: 'medium' } },
      { id: 'plain', name: 'No reasoning' },
    ],
  }],
};

test('a selection resolves to its live catalog entry and its efforts', () => {
  const entry = modelEntry(catalog, { provider: 'deepseek', model: 'flash' });
  assert.equal(entry.id, 'flash');
  assert.deepEqual(effortsOf(entry).map(effort => effort.id), ['low', 'medium', 'high']);
  assert.deepEqual(effortsOf(modelEntry(catalog, { provider: 'deepseek', model: 'plain' })), []);
  assert.equal(modelEntry(catalog, { provider: 'gone', model: 'flash' }), undefined);
  assert.equal(modelEntry(catalog, null), undefined);
});

test('a model without reasoning gets no invented rungs', () => {
  assert.deepEqual(effortsOf({ id: 'x', name: 'x' }), []);
  assert.deepEqual(effortsOf({ reasoning: { efforts: 'nope' } }), []);
  assert.deepEqual(effortsOf({ reasoning: { efforts: [{ id: 'low' }, { id: 'low' }, { id: '' }, {}] } }).map(e => e.id), ['low']);
});

test('the option always offers 自动 and never claims an undeclared effort', () => {
  const option = thinkingOption({ efforts: effortsOf(modelEntry(catalog, { provider: 'deepseek', model: 'flash' })), current: 'high' });
  assert.equal(option.currentValue, 'high');
  assert.deepEqual(option.options.map(o => o.value), [AUTO, 'low', 'medium', 'high']);
  const stale = thinkingOption({ efforts: effortsOf(modelEntry(catalog, { provider: 'deepseek', model: 'flash' })), current: 'max' });
  assert.equal(stale.currentValue, AUTO);
});

test('an explicit choice wins over the words', () => {
  const efforts = effortsOf(modelEntry(catalog, { provider: 'deepseek', model: 'flash' }));
  assert.equal(chooseEffort({ efforts, stored: 'low', prompt: '把整片重新剪一遍' }), 'low');
  // A stored rung the model no longer declares falls back to the words.
  assert.equal(chooseEffort({ efforts, stored: 'max', prompt: '把整片重新剪一遍' }), 'high');
});

test('whole-film work gets the highest rung, drafting the lowest', () => {
  const efforts = effortsOf(modelEntry(catalog, { provider: 'deepseek', model: 'flash' }));
  assert.equal(chooseEffort({ efforts, prompt: '把整片重新剪成 30 秒' }), 'high');
  assert.equal(chooseEffort({ efforts, prompt: '先给个草稿大纲' }), 'low');
  assert.equal(chooseEffort({ efforts, prompt: '把标题改一下' }), 'medium');
  assert.equal(chooseEffort({ efforts, prompt: '把标题改一下', firstTurn: true }), 'low');
});

test('a model without rungs is left alone', () => {
  assert.equal(chooseEffort({ efforts: [], prompt: '整片重排' }), undefined);
});

test('the middle rung is used when the provider declares no default', () => {
  const efforts = [{ id: 'a', name: 'a' }, { id: 'b', name: 'b' }, { id: 'c', name: 'c' }];
  assert.equal(chooseEffort({ efforts, prompt: '把标题改一下' }), 'b');
  assert.equal(chooseEffort({ efforts: [{ id: 'only', name: 'only' }], prompt: '把标题改一下' }), 'only');
});
// OpenFilm's composer menu renders only the rows whose category it knows:
// model, thought_level and speed (apps/desktop/chat/src/lib/agent-menu-rows.ts).
// Labelling the option 'thinking' made it invisible and left the menu showing its
// built-in "默认" placeholder instead.
test('the thinking option uses the category the composer menu renders', () => {
  const option = thinkingOption({ efforts: [{ id: 'high', name: '高' }] });
  assert.equal(option.id, 'thinking');
  assert.equal(option.category, 'thought_level');
  assert.equal(option.type, 'select');
  assert.equal(option.options[0].value, AUTO);
});