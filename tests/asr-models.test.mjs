import test from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { libraryCacheRoot, senseVoiceDir, senseVoiceReadyMark } from '../src/asr-models.mjs';

test('the transcription model lives where the Studio installs it', () => {
  assert.equal(libraryCacheRoot({ env: {}, home: '/home/x' }), join('/home/x', '.openfilm', 'library'));
  assert.equal(libraryCacheRoot({ env: { OPENFILM_LIBRARY_CACHE: '/cache' }, home: '/home/x' }), '/cache');
  assert.equal(libraryCacheRoot({ env: { OPENFILM_HOME: '/studio' }, home: '/home/x' }), join('/studio', 'library'));
  assert.equal(senseVoiceDir({ env: { OPENFILM_LIBRARY_CACHE: '/cache' }, home: '/home/x' }), join('/cache', 'models', 'sensevoice-small'));
  assert.match(senseVoiceReadyMark({ env: { OPENFILM_LIBRARY_CACHE: '/cache' } }), /models[\\/]sensevoice-small\.[0-9a-f]{12}\.ok$/);
});
