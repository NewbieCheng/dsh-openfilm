import test from 'node:test';
import assert from 'node:assert/strict';
import { augmentPath, knownBinaryDirs, modelBases, toolSourceUrls } from '../src/download-sources.mjs';

test('every tool lists a China mirror before the canonical host', () => {
  const ffmpeg = toolSourceUrls('ffmpeg', { platform: 'darwin', arch: 'arm64' });
  assert.deepEqual(ffmpeg.map(source => source.id), ['npmmirror', 'github']);
  assert.match(ffmpeg[0].url, /npmmirror\.com/);
  assert.match(ffmpeg[0].url, /ffmpeg-darwin-arm64\.gz$/);
  const ffprobe = toolSourceUrls('ffprobe', { platform: 'win32', arch: 'x64' });
  assert.deepEqual(ffprobe.map(source => source.id), ['npmmirror', 'npm']);
});

test('an explicit ASR base URL overrides every mirror', () => {
  assert.deepEqual(modelBases({}).map(source => source.id), ['hf-mirror', 'huggingface']);
  assert.deepEqual(modelBases({ NO996_OPENFILM_ASR_BASE_URL: 'http://box/models/' }), [
    { id: 'custom', base: 'http://box/models/' },
  ]);
});

test('a GUI PATH gets the package managers directories', () => {
  assert.ok(knownBinaryDirs('darwin').includes('/opt/homebrew/bin'));
  assert.ok(knownBinaryDirs('win32', { LOCALAPPDATA: 'C:\\Users\\x\\AppData\\Local' })
    .some(dir => dir.endsWith('WinGet\\Links')));
  const env = { PATH: '/usr/bin' };
  assert.equal(augmentPath({ platform: 'darwin', env }), true);
  assert.equal(env.PATH, '/opt/homebrew/bin:/usr/local/bin:/usr/bin');
  assert.equal(augmentPath({ platform: 'darwin', env }), false);
});
