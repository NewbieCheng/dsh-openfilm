import test from 'node:test';
import assert from 'node:assert/strict';
import { createStudioHttp } from '../src/studio-http.mjs';

const origin = 'http://127.0.0.1:4999';
const studio = async () => ({ origin, key: 'secret-key' });

function respond(body, { status = 200, headers = {} } = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: name => headers[name.toLowerCase()] ?? null },
    async json() { return typeof body === 'string' ? JSON.parse(body) : body; },
    async text() { return typeof body === 'string' ? body : JSON.stringify(body); },
    async arrayBuffer() { return new Uint8Array([1, 2, 3]).buffer; },
  };
}

function client(handler, options = {}) {
  const calls = [];
  const http = createStudioHttp({
    studio: options.studio ?? studio,
    async fetchImpl(url, init) { calls.push({ url: String(url), init }); return handler(String(url), init); },
  });
  return { http, calls };
}

test('the key and the query travel, and JSON comes back parsed', async () => {
  const { http, calls } = client(() => respond({ projects: [] }));
  assert.deepEqual(await http.get('/api/projects/film123/media', { query: { path: 'film.html', ms: 500 } }), { projects: [] });
  const url = new URL(calls[0].url);
  assert.equal(url.origin, origin);
  assert.equal(url.pathname, '/api/projects/film123/media');
  assert.equal(url.searchParams.get('ms'), '500');
  assert.equal(calls[0].init.headers['x-studio-key'], 'secret-key');
  assert.equal(calls[0].init.redirect, 'error');
});

test('a POST carries a JSON body only when there is one', async () => {
  const { http, calls } = client(() => respond({ ok: true }));
  await http.post('/api/get', { body: { verb: 'tts', args: {} } });
  assert.equal(calls[0].init.headers['content-type'], 'application/json');
  assert.deepEqual(JSON.parse(calls[0].init.body), { verb: 'tts', args: {} });
  await http.get('/api/get');
  assert.equal(calls[1].init.body, undefined);
  assert.equal(calls[1].init.headers['content-type'], undefined);
});

test('an upstream refusal becomes one readable sentence, not a stack', async () => {
  const { http } = client(() => respond({ code: 2, text: 'there is no --nope' }, { status: 400 }));
  await assert.rejects(http.post('/api/get/library', { body: {} }), error => {
    assert.equal(error.code, 'STUDIO_FAILED');
    assert.match(error.message, /there is no --nope/);
    assert.doesNotMatch(error.message, /secret-key/);
    return true;
  });
});

test('a picture comes back as bytes with its type', async () => {
  const { http } = client(() => respond('binary', { headers: { 'content-type': 'image/jpeg' } }));
  const picture = await http.picture('/api/projects/film123/media', { query: { what: 'poster' } });
  assert.equal(picture.type, 'image/jpeg');
  assert.equal(picture.bytes.byteLength, 3);
});

test('a picture that fails reports the status instead of returning empty bytes', async () => {
  const { http } = client(() => respond('nope', { status: 404 }));
  await assert.rejects(http.picture('/api/projects/film123/media'), { code: 'STUDIO_FAILED' });
});

test('uploading sends the bytes as the body, not as JSON', async () => {
  const { http, calls } = client(() => respond({ path: 'assets/a.png' }));
  const bytes = new Uint8Array([9, 8, 7]);
  const landed = await http.put('/api/projects/film123/files', { query: { path: 'assets/a.png' }, raw: bytes, type: 'image/png' });
  assert.deepEqual(landed, { path: 'assets/a.png' });
  assert.equal(calls[0].init.method, 'PUT');
  assert.equal(calls[0].init.headers['content-type'], 'image/png');
  assert.equal(calls[0].init.body, bytes);
  assert.equal(new URL(calls[0].url).searchParams.get('path'), 'assets/a.png');
});

test('no running Studio is said plainly', async () => {
  const { http } = client(() => respond({}), { studio: async () => undefined });
  await assert.rejects(http.get('/api/get'), { code: 'STUDIO_UNAVAILABLE' });
});

test('a transport failure never leaks the key', async () => {
  const http = createStudioHttp({
    studio,
    async fetchImpl() { throw new Error(`connect ECONNREFUSED ${origin}?key=secret-key`); },
  });
  await assert.rejects(http.get('/api/get'), error => {
    assert.equal(error.code, 'STUDIO_UNREACHABLE');
    assert.doesNotMatch(error.message, /secret-key/);
    return true;
  });
});

test('a success that is not JSON is a failure, not an empty object', async () => {
  const { http } = client(() => respond('<html>'));
  await assert.rejects(http.get('/api/get'), { code: 'STUDIO_FAILED' });
});
