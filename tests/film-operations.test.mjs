import test from 'node:test';
import assert from 'node:assert/strict';
import { createFilmOperations, MAX_FILM_BYTES } from '../src/film-operations.mjs';

function fixture() {
  const entries = new Map([['/ws', { type: 'directory', version: 'root' }], ['/ws/project', { type: 'directory', version: 'dir' }]]);
  const calls = [];
  let rev = 0;
  const workspace = { targetKey: '/ws', displayPath: '/ws' };
  const policy = { mode: 'workspace-write', workspaceRoot: '/ws' };
  const key = (path, cwd) => path.startsWith('/') ? path : `${cwd}/${path}`;
  const fs = {
    processPath: t => t.targetKey,
    contains: (a, b) => b.targetKey === a.targetKey || b.targetKey.startsWith(a.targetKey + '/'),
    async resolve(path, { cwd }) { const p = key(path, cwd); const e = entries.get(p); return { targetKey: e?.destination ?? p, displayPath: p }; },
    async lstat(path, { cwd }) { return entries.get(key(path, cwd)); },
    async stat(t) { const e = entries.get(t.targetKey); return e && { ...e, size: e.text === undefined ? undefined : new TextEncoder().encode(e.text).length }; },
    async readBytes(t, _signal, maxBytes) {
      const data = new TextEncoder().encode(entries.get(t.targetKey).text);
      if (data.length > maxBytes) throw Object.assign(new Error('too large'), { code: 'FS_TOO_LARGE' });
      return data;
    },
    async writeText(t, text, intent, signal, sandboxPolicy) {
      calls.push({ t, text, intent, signal, sandboxPolicy });
      const prior = entries.get(t.targetKey);
      if (intent.kind === 'createIfAbsent' && prior) throw Object.assign(new Error('exists'), { code: 'FS_NOT_OBSERVED' });
      if (intent.kind === 'replaceIfVersion' && (!prior || prior.version !== intent.version)) throw Object.assign(new Error('stale'), { code: 'FS_STALE_VERSION' });
      const version = `v${++rev}`;
      entries.set(t.targetKey, { type: 'file', version, text });
      return { version, operation: prior ? 'update' : 'create', before: prior?.text ?? null, after: text };
    },
  };
  return { fs, workspace, policy, entries, calls, service: createFilmOperations({ fs, workspace, sandboxPolicy: policy }) };
}
const code = value => ({ code: value });

test('requires a caller-authorized target and policy', () => {
  assert.throws(() => createFilmOperations({}), code('AUTHORITY'));
  const { fs, workspace } = fixture();
  assert.throws(() => createFilmOperations({ fs, workspace }), code('AUTHORITY'));
  assert.throws(() => createFilmOperations({ fs, workspace, sandboxPolicy: {} }), code('AUTHORITY'));
  assert.throws(() => createFilmOperations({ fs, workspace, sandboxPolicy: { mode: 'unexpected', workspaceRoot: '/ws' } }), code('AUTHORITY'));
});

test('read-only policy rejects writes even when the provider does not enforce it', async () => {
  const { fs, workspace, calls } = fixture();
  const service = createFilmOperations({ fs, workspace, sandboxPolicy: { mode: 'read-only', workspaceRoot: '/ws' } });
  await assert.rejects(service.create('project'), code('READ_ONLY'));
  await assert.rejects(service.edit('project', { tracks: [] }, 'v1'), code('READ_ONLY'));
  assert.equal(calls.length, 0);
});

test('create, read and edit preserve source and forward guards and policy', async () => {
  const { service, calls, policy, entries } = fixture();
  const created = await service.create('project');
  assert.equal(created.version, 'v1');
  assert.deepEqual(calls[0].intent, { kind: 'createIfAbsent' });
  assert.equal(calls[0].sandboxPolicy, policy);
  await assert.rejects(service.create('project'), code('FS_NOT_OBSERVED'));
  const entry = entries.get('/ws/project/film.html');
  entry.text = entry.text.replace('</head>', '<!-- retained -->\n</head>');
  const read = await service.read('project');
  assert.match(read.text, /retained/);
  const edited = await service.edit('project', { tracks: [{ clips: [] }] }, read.version);
  assert.match(edited.text, /retained/);
  assert.equal(edited.version, 'v2');
  assert.deepEqual(calls.at(-1).intent, { kind: 'replaceIfVersion', version: read.version });
  assert.equal(calls.at(-1).sandboxPolicy, policy);
  assert.equal((await service.read('project')).text, edited.text);
  await assert.rejects(service.edit('project', { tracks: [] }, read.version), code('FS_STALE_VERSION'));
});

test('a race at publication is rejected by provider version guard', async () => {
  const { service, fs, entries } = fixture();
  const first = await service.create('project');
  const write = fs.writeText;
  fs.writeText = async (...args) => { entries.get('/ws/project/film.html').version = 'other'; return write(...args); };
  await assert.rejects(service.edit('project', { tracks: [] }, first.version), code('FS_STALE_VERSION'));
});

test('rejects traversal, absolute paths, links, missing directories and escaped targets', async () => {
  const { service, entries } = fixture();
  for (const path of ['../x', 'project/../x', '/project', '\\project', 'C:project', 'C:\\project', 'project//x', 'project/./x', 'file:foo']) {
    await assert.rejects(service.read(path), code('PATH'));
  }
  await assert.rejects(service.create('missing'), code('PATH'));
  entries.set('/ws/link', { type: 'symlink', destination: '/outside' });
  await assert.rejects(service.create('link'), code('PATH'));
  entries.set('/ws/project/film.html', { type: 'symlink', destination: '/outside/file' });
  await assert.rejects(service.read('project'), code('PATH'));
  entries.set('/ws/project', { type: 'directory', destination: '/outside' });
  await assert.rejects(service.create('project'), code('PATH'));
});

test('rejects invalid films, oversized input and stale reads', async () => {
  const { service, entries, fs } = fixture();
  await assert.rejects(service.create('project', { tracks: 'bad' }), code('INVALID_FILM'));
  await service.create('project');
  const entry = entries.get('/ws/project/film.html');
  entry.text = '<script>evil()</script>';
  await assert.rejects(service.read('project'), code('INVALID_FILM'));
  entry.text = 'x'.repeat(MAX_FILM_BYTES + 1);
  await assert.rejects(service.read('project'), code('FS_TOO_LARGE'));
  entry.text = '<body></body>';
  const read = fs.readBytes;
  fs.readBytes = async (...args) => { const data = await read(...args); entry.version = 'changed'; return data; };
  await assert.rejects(service.read('project'), code('FS_STALE_VERSION'));
});
