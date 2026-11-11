import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runInNewContext } from 'node:vm';
import { officialFacadeSource } from '../src/official-facade.mjs';
import { officialUploadSource } from '../src/official-attachment.mjs';

function facade(upload) {
  const context = { ArrayBuffer, location: { pathname: '/projects/project1' }, openfilmDesktop: { hello: async () => ({ project: { id: 'project1', path: '/project' } }) } };
  return runInNewContext(officialFacadeSource, context)({ upload });
}
class SizedBuffer extends ArrayBuffer {
  constructor(size) { super(1); this.size = size; }
  get byteLength() { return this.size; }
}

test('attachment facade distinguishes size, empty file, invalid input and missing upload', async () => {
  const api = facade();
  for (const [bytes, pattern] of [[new SizedBuffer(256 * 1024 * 1024 + 1), /超过 256 MiB/], [new ArrayBuffer(0), /附件为空/], [null, /无法读取附件/], [new ArrayBuffer(1), /上传暂不可用/]]) {
    await assert.rejects(api.chat.saveAttachment('/project', 'x.mp4', bytes), pattern);
  }
  await assert.rejects(api.chat.saveAttachment('/project', '', new ArrayBuffer(1)), /文件名无效/);
});

test('attachment facade accepts the exact limit and preserves transport errors', async () => {
  const calls = [];
  const api = facade(async (...args) => { calls.push(args); return { path: 'assets/upload/x.mp4' }; });
  const result = await api.chat.saveAttachment('/project', 'x.mp4', new SizedBuffer(256 * 1024 * 1024));
  assert.equal(result.path, 'assets/upload/x.mp4');
  assert.equal(calls[0][0], 'project1');
  const failure = facade(async () => { throw new Error('上传暂不可用'); });
  await assert.rejects(failure.chat.saveAttachment('/project', 'x.mp4', new ArrayBuffer(1)), /上传暂不可用/);
});

test('injected upload transport reports statuses and uncertain outcomes in Chinese', async () => {
  const make = fetch => runInNewContext(officialUploadSource, { fetch, URLSearchParams });
  for (const [response, pattern] of [
    [{ status: 413, ok: false }, /超过 256 MiB/],
    [{ status: 422, ok: false }, /已导入但无法读取/],
    [{ status: 503, ok: false }, /上传暂不可用.*可能已导入/],
    [{ status: 200, ok: true, json: async () => { throw new Error('bad json'); } }, /结果无法读取.*可能已导入/],
  ]) await assert.rejects(make(async () => response)('project1', 'x.mp4', new ArrayBuffer(1)), pattern);
  await assert.rejects(make(async () => { throw new Error('network'); })('project1', 'x.mp4', new ArrayBuffer(1)), /连接失败.*可能已导入/);
  let request;
  const result = await make(async (url, options) => { request = { url, options }; return { ok: true, status: 200, json: async () => ({ path: 'assets/upload/x.mp4' }) }; })('project1', 'x.mp4', new ArrayBuffer(1));
  assert.equal(result.path, 'assets/upload/x.mp4');
  assert.match(request.url, /^\/__dsh\/official-upload\?/);
  assert.equal(request.options.method, 'PUT');
  assert.equal(request.options.credentials, 'same-origin');
});
