import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { applyStudioLibraryPatch } from '../src/studio-library-patch.mjs';

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'openfilm-pkg-'));
  mkdirSync(join(root, 'library'), { recursive: true });
  mkdirSync(join(root, 'studio', 'server'), { recursive: true });
  writeFileSync(join(root, 'library', 'local-models.json'), JSON.stringify({
    version: 1,
    models: [{ id: 'whisper-small', files: [{ path: 'models/whisper-small/a.onnx', bytes: 1, sha256: 'x' }] }],
  }, null, 1) + '\n');
  writeFileSync(join(root, 'studio', 'server', 'local-models.mjs'), [
    'const ABOUT = {',
    "  'whisper-small': { kind: 'asr', name: 'Whisper Small' },",
    '};',
    '',
  ].join('\n'));
  return root;
}

test('the native catalog and the model list both gain SenseVoice, once', () => {
  const root = fixture();
  try {
    const first = applyStudioLibraryPatch({ packageRoot: root });
    assert.deepEqual(first, { patched: true, models: true, about: true });
    const models = JSON.parse(readFileSync(join(root, 'library', 'local-models.json'), 'utf8'));
    const entry = models.models.find(model => model.id === 'sensevoice-small');
    assert.ok(entry);
    assert.equal(entry.files.length, 2);
    const source = readFileSync(join(root, 'studio', 'server', 'local-models.mjs'), 'utf8');
    assert.match(source, /'sensevoice-small': \{ kind: 'asr', name: 'SenseVoice'/);
    assert.match(source, /\n\};/);

    const second = applyStudioLibraryPatch({ packageRoot: root });
    assert.deepEqual(second, { patched: false, models: false, about: false });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
