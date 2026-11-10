import test from 'node:test';
import assert from 'node:assert/strict';
import { saveSessionFilm } from '../src/session-save.mjs';
import { MAX_SOURCE_BYTES } from '../src/film-source.mjs';

const source = `<html><head><!-- retained --></head><body><section><video id='a' src='a.mp4#t=1,9' at='1'></video></section></body></html>`;
const operations = [{ op: 'move', clip: 'a', at: 2 }];
const code = code => ({ code });
function fixture() {
  const entries = new Map([
    ['/ws', { type: 'directory', version: 'root' }],
    ['/ws/project', { type: 'directory', version: 'dir' }],
    ['/ws/project/film.html', { type: 'file', version: 'v1', text: source }],
  ]);
  const calls = [];
  const session = { id: 'session' }, agent = { session };
  const policy = { mode: 'workspace-write', workspaceRoot: '/ws' };
  const absolute = (p, cwd) => p.startsWith('/') ? p : `${cwd}/${p}`;
  const fs = {
    async resolve(p, opts = {}) { const path = absolute(p, opts.cwd); return { targetKey: entries.get(path)?.destination ?? path, displayPath: path }; },
    processPath: t => t.targetKey,
    contains: (a, b) => b.targetKey === a.targetKey || b.targetKey.startsWith(`${a.targetKey}/`),
    async lstat(p, { cwd }) { return entries.get(absolute(p, cwd)); },
    async stat(t) { const e = entries.get(t.targetKey); return e && { ...e, size: e.size ?? (e.text === undefined ? undefined : new TextEncoder().encode(e.text).length) }; },
    async readBytes(t, signal, max) { calls.push(['read', max]); const data = new TextEncoder().encode(entries.get(t.targetKey).text); if (data.length > max) throw Object.assign(new Error('too large'), { code: 'FS_TOO_LARGE' }); return data; },
    async writeText(t, text, intent, signal, actualPolicy) {
      calls.push(['write', intent, actualPolicy]);
      const old = entries.get(t.targetKey);
      if (!old || old.version !== intent.version) throw Object.assign(new Error('stale'), { code: 'FS_STALE_VERSION' });
      entries.set(t.targetKey, { type: 'file', version: 'v2', text });
      return { version: 'v2' };
    },
  };
  const ctx = { fs, sandboxPolicy: { resolve(request) { assert.deepEqual(request, { session }); return policy; } }, workingDirectory: { get(s) { assert.equal(s, session); return '/ws'; } } };
  const save = (request = {}) => saveSessionFilm(ctx, agent, { project: 'project', expectedVersion: 'v1', operations, ...request });
  return { entries, calls, fs, ctx, agent, policy, save };
}

test('saves only the Host-read source with guarded publication and session policy', async () => {
  const f = fixture();
  const result = await f.save({ source: '<client html>', workspace: '/outside' });
  assert.equal(result.version, 'v2');
  assert.equal(result.text, source.replace("at='1'", 'at="2"'));
  assert.deepEqual(f.calls, [['read', MAX_SOURCE_BYTES], ['write', { kind: 'replaceIfVersion', version: 'v1' }, f.policy]]);
  assert.equal(f.entries.get('/ws/project/film.html').text, result.text);
});

test('read-only and absent authority fail before writing', async () => {
  const f = fixture(); f.policy.mode = 'read-only';
  await assert.rejects(f.save(), code('READ_ONLY'));
  assert.equal(f.calls.length, 0);
  await assert.rejects(saveSessionFilm(f.ctx, {}, {}), code('AUTHORITY'));
});

test('rejects traversal, links, missing targets, escape, and policy root mismatch', async () => {
  for (const project of ['../x', '/x', 'C:x', 'x/../y', 'x//y', 'x/./y', 'x\0y', 'x:y', '\\x']) {
    const f = fixture(); await assert.rejects(f.save({ project }), code('PATH')); assert.equal(f.calls.length, 0);
  }
  for (const [path, entry] of [
    ['/ws/project', { type: 'symlink', destination: '/outside' }],
    ['/ws/project', { type: 'directory', destination: '/outside' }],
    ['/ws/project/film.html', { type: 'symlink', destination: '/outside/film.html' }],
    ['/ws/project/film.html', { type: 'file', destination: '/outside/film.html' }],
  ]) {
    const f = fixture(); f.entries.set(path, entry); await assert.rejects(f.save(), code('PATH')); assert.equal(f.calls.length, 0);
  }
  const f = fixture(); f.entries.delete('/ws/project/film.html'); await assert.rejects(f.save(), code('FS_NOT_FOUND'));
  const g = fixture(); g.policy.workspaceRoot = '/elsewhere'; await assert.rejects(g.save(), code('PATH'));
});

test('rejects stale before read, during read, and at guarded write', async () => {
  const f = fixture(); await assert.rejects(f.save({ expectedVersion: 'old' }), code('FS_STALE_VERSION')); assert.equal(f.calls.length, 0);
  const g = fixture(); const read = g.fs.readBytes; g.fs.readBytes = async (...args) => { const data = await read(...args); g.entries.get('/ws/project/film.html').version = 'v3'; return data; };
  await assert.rejects(g.save(), code('FS_STALE_VERSION')); assert.equal(g.calls.filter(c => c[0] === 'write').length, 0);
  const h = fixture(); const write = h.fs.writeText; h.fs.writeText = async (...args) => { h.entries.get('/ws/project/film.html').version = 'v3'; return write(...args); };
  await assert.rejects(h.save(), code('FS_STALE_VERSION')); assert.equal(h.entries.get('/ws/project/film.html').text, source);
});

test('rejects oversized source, invalid UTF-8, missing version and invalid edits', async () => {
  const f = fixture(); f.entries.get('/ws/project/film.html').size = MAX_SOURCE_BYTES + 1; await assert.rejects(f.save(), code('FS_TOO_LARGE')); assert.equal(f.calls.length, 0);
  const g = fixture(); g.fs.readBytes = async () => new Uint8Array([255]); await assert.rejects(g.save(), code('INVALID_FILM'));
  const h = fixture(); await assert.rejects(h.save({ expectedVersion: '' }), code('VERSION'));
  await assert.rejects(h.save({ operations: [{ op: 'delete', clip: 'a' }] }));
  assert.equal(h.calls.filter(c => c[0] === 'write').length, 0);
});
