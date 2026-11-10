import test from 'node:test';
import assert from 'node:assert/strict';
import { createDraftTool } from '../src/draft-tool.mjs';

const source = '<!doctype html><html><head></head><body><section><video id="clip" src="clip.mp4#t=0,4"></video></section></body></html>';

test('the agent tool returns an unsaved edited film', async () => {
  const tool = createDraftTool();
  const result = await tool.execute({ source, operations: [{ op: 'move', clip: 'clip', at: 2 }] });
  assert.match(result.text, /at="2"/);
  assert.deepEqual(tool.output.render({}, result), [{ type: 'text', text: result.text }]);
  assert.equal(tool.isConcurrencySafe(), true);
});

test('the agent tool rejects oversized and empty requests', async () => {
  const tool = createDraftTool();
  await assert.rejects(tool.execute({ source: 'x'.repeat(65537), operations: [{ op: 'move', clip: 'clip', at: 2 }] }), /64 KiB/);
  await assert.rejects(tool.execute({ source, operations: [] }), /1 to 100/);
  await assert.rejects(tool.execute({ source, operations: [{ op: 'remove', clip: 'clip' }] }), /unsupported operation/);
});
