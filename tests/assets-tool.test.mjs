import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createAssetsTool, flattenFiles } from '../src/assets-tool.mjs';

const bound = { projectId: 'film123', path: 'C:/films/one' };
const agent = { id: 'session-a' };
const link = { isProjectAgent: candidate => candidate?.id === 'session-a', projectOf: candidate => (candidate?.id === 'session-a' ? bound : undefined) };

function fakeHttp(replies = {}) {
  const calls = [];
  const client = {
    async get(path, options) { calls.push({ method: 'GET', path, options }); return replies[`GET ${path}`] ?? {}; },
    async post(path, options) { calls.push({ method: 'POST', path, options }); return replies[`POST ${path}`] ?? {}; },
    async put(path, options) { calls.push({ method: 'PUT', path, options }); return replies[`PUT ${path}`] ?? { path: options?.query?.path }; },
  };
  return { calls, http: () => client };
}

test('the listing flattens to the paths film.html actually uses', () => {
  const files = flattenFiles({
    files: [
      { name: 'film.html', type: 'file', size: 900 },
      { name: 'assets', type: 'directory', files: [{ name: 'a.mp4', type: 'file', size: 2048 }] },
    ],
  });
  assert.deepEqual(files.map(entry => entry.path), ['film.html', 'assets/a.mp4']);
  assert.equal(files[1].size, 2048);
});

test('a listing is returned as referenceable relative paths', async () => {
  const { http } = fakeHttp({ 'GET /api/projects/film123/files': { files: [{ name: 'music', type: 'directory', files: [{ name: 'bed.mp3', type: 'file', size: 10 }] }] } });
  const tool = createAssetsTool({ ...link, http });
  const value = await tool.execute({ list: true }, { agent });
  assert.match(value.text, /music\/bed\.mp3/);
});

test('an import goes through Studio with the real bytes and a usable path', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-assets-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const source = join(dir, 'voice.png');
  await writeFile(source, new Uint8Array([1, 2, 3, 4]));
  const { calls, http } = fakeHttp({ 'PUT /api/projects/film123/files': { path: 'assets/voice.png' } });
  const tool = createAssetsTool({ ...link, http });
  const value = await tool.execute({ from: source }, { agent });
  assert.equal(calls[0].method, 'PUT');
  assert.equal(calls[0].options.query.path, 'assets/voice.png');
  assert.equal(calls[0].options.raw.byteLength, 4);
  assert.equal(calls[0].options.type, 'image/png');
  assert.match(value.text, /已入库：assets\/voice\.png/);
});

test('an unreadable file is reported as Studio saw it, not hidden', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-assets-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const source = join(dir, 'broken.mp4');
  await writeFile(source, new Uint8Array([0]));
  const { http } = fakeHttp({ 'PUT /api/projects/film123/files': { path: 'assets/broken.mp4', unreadable: 'there is no picture in it' } });
  const tool = createAssetsTool({ ...link, http });
  const value = await tool.execute({ from: source }, { agent });
  assert.match(value.text, /读不出内容/);
});

test('traversal and absolute destinations are refused before any upload', async () => {
  const { calls, http } = fakeHttp();
  const tool = createAssetsTool({ ...link, http });
  await assert.rejects(tool.execute({ from: 'C:/tmp/a.png', into: '../outside.png' }, { agent }), /without \.\./);
  await assert.rejects(tool.execute({ from: 'C:/tmp/a.png', into: 'C:/absolute.png' }, { agent }), /without \.\./);
  assert.equal(calls.length, 0);
});

test('a missing source file is said plainly', async () => {
  const { http } = fakeHttp();
  const tool = createAssetsTool({ ...link, http });
  await assert.rejects(tool.execute({ from: 'C:/definitely/not/here.png' }, { agent }), /读不到/);
});

test('a relative source is refused', async () => {
  const { http } = fakeHttp();
  const tool = createAssetsTool({ ...link, http });
  await assert.rejects(tool.execute({ from: 'assets/a.png' }, { agent }), /absolute path/);
});
