// The editing instructions an ACP conversation receives through AGENTS.md.
// File-system behaviour only; the content is asserted for the facts that would
// otherwise be folk knowledge (never claim an unverified save, keep originals).
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { ensureProjectInstructions, INSTRUCTIONS } from '../src/project-instructions.mjs';

const folder = () => mkdtempSync(join(tmpdir(), 'no996-agents-md-'));

test('a project without instructions gets them, once', () => {
  const root = folder();
  const first = ensureProjectInstructions({ root });
  assert.equal(first.created, true);
  assert.equal(first.file, join(root, 'AGENTS.md'));
  const text = readFileSync(first.file, 'utf8');
  assert.match(text, /film\.html/);
  assert.match(text, /openfilm_clip/);
  assert.match(text, /只有真的画出一帧/);
  const second = ensureProjectInstructions({ root });
  assert.equal(second.created, false);
  assert.equal(readFileSync(first.file, 'utf8'), text, 'a second call changes nothing');
});

test('an existing AGENTS.md is never overwritten', () => {
  const root = folder();
  const file = join(root, 'AGENTS.md');
  writeFileSync(file, '# 我自己的规则\n', 'utf8');
  const result = ensureProjectInstructions({ root });
  assert.equal(result.created, false);
  assert.equal(readFileSync(file, 'utf8'), '# 我自己的规则\n');
});

test('a missing folder is created, and the file stays under the instruction cap', () => {
  const root = join(folder(), 'nested', 'project');
  const result = ensureProjectInstructions({ root });
  assert.equal(result.created, true);
  assert.ok(existsSync(result.file));
  assert.ok(Buffer.byteLength(INSTRUCTIONS, 'utf8') <= 8 * 1024);
});

test('the instructions keep the verification rule the preset gives', () => {
  assert.match(INSTRUCTIONS, /未.*核对|看不见就不算完成/);
  assert.match(INSTRUCTIONS, /不要删除原始素材/);
});

test('a folder argument is required', () => {
  assert.throws(() => ensureProjectInstructions({}), error => error.toString().includes('project folder'));
  assert.throws(() => ensureProjectInstructions({ root: '' }));
});
