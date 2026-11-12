import test from 'node:test';
import assert from 'node:assert/strict';
import { ensureStudioLibraryMirror } from '../src/studio-library-mirror.mjs';

const body = () => new ReadableStream({ start(controller) { controller.enqueue(new TextEncoder().encode('MODEL')); controller.close(); } });

test('the mirror serves SenseVoice from hf-mirror and sends the rest to OpenFilm', async () => {
  const calls = [];
  const fetchImpl = async url => {
    calls.push(url);
    if (url.startsWith('https://hf-mirror.com/')) return new Response(body(), { status: 200 });
    throw new Error('offline');
  };
  const mirror = await ensureStudioLibraryMirror({ fetchImpl });
  try {
    const voice = await fetch(`${mirror.origin}/library/models/sensevoice-small/tokens.txt`);
    assert.equal(voice.status, 200);
    assert.equal(await voice.text(), 'MODEL');
    assert.match(calls[0], /hf-mirror\.com/);

    const other = await fetch(`${mirror.origin}/library/models/whisper-small/config.json`, { redirect: 'manual' });
    assert.equal(other.status, 302);
    assert.equal(other.headers.get('location'), 'https://openfilm.dev/library/models/whisper-small/config.json');
  } finally {
    await mirror.close();
  }
});
