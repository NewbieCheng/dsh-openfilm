import test from 'node:test';
import assert from 'node:assert/strict';
import { createExportTool, exportAsk, blockedBy } from '../src/export-tool.mjs';
import { cliArguments, createCliTool, resolveCli } from '../src/cli-tool.mjs';

const bound = { projectId: 'film123', path: 'C:\\films\\one' };
const agent = { id: 'session-a' };
const link = { isProjectAgent: candidate => candidate?.id === 'session-a', projectOf: candidate => (candidate?.id === 'session-a' ? bound : undefined) };

function fakeHttp(replies = {}) {
  const calls = [];
  const client = {
    async get(path, options) { calls.push({ method: 'GET', path, options }); return replies[`GET ${path}`] ?? {}; },
    async post(path, options) { calls.push({ method: 'POST', path, options }); return replies[`POST ${path}`] ?? {}; },
    async del(path, options) { calls.push({ method: 'DELETE', path, options }); return {}; },
    async put() { return {}; },
    async picture() { return { bytes: new Uint8Array() }; },
  };
  return { calls, http: () => client };
}

test('the ask keeps documented fields and drops empty ones', () => {
  assert.deepEqual(exportAsk({ kind: 'video', codec: 'hevc', frame: '', fps: 30, at: [1, NaN, 2], other: 'x' }),
    { kind: 'video', codec: 'hevc', fps: 30, at: [1, 2] });
  assert.deepEqual(exportAsk({ kind: 'audio', mix: true, stems: false }), { kind: 'audio', mix: true, stems: false });
});

test('a machine without an encoder refuses before queueing', async () => {
  const { calls, http } = fakeHttp({ 'GET /api/projects/film123/exports': { can: { h264: false }, exports: [] } });
  const tool = createExportTool({ ...link, http });
  await assert.rejects(tool.execute({ kind: 'video' }, { agent }), /编不了 H\.264/);
  assert.equal(calls.filter(call => call.method === 'POST').length, 0);
  assert.match(blockedBy({ h264: false }, 'video'), /H\.264/);
  assert.equal(blockedBy({ h264: false }, 'audio'), undefined);
});

test('a queued export names its job and its folder, and never claims a file', async () => {
  const { calls, http } = fakeHttp({
    'GET /api/projects/film123/exports': { can: { h264: true }, folder: 'C:/out', exports: [] },
    'POST /api/projects/film123/exports': { export: { id: 'job1', kind: 'video', status: 'waiting' } },
  });
  const tool = createExportTool({ ...link, http });
  const value = await tool.execute({ kind: 'video', codec: 'h264', frame: '9:16' }, { agent });
  assert.deepEqual(calls[1].options.body, { kind: 'video', codec: 'h264', frame: '9:16' });
  assert.match(value.text, /job1/);
  assert.match(value.text, /C:\/out/);
  assert.match(value.text, /不要说"已经导出好了"/);
});

test('status reports outputs, so success can be checked', async () => {
  const { http } = fakeHttp({
    'GET /api/projects/film123/exports': {
      can: { h264: true },
      exports: [{ id: 'job1', kind: 'video', status: 'done', outputs: ['C:/out/one.mp4'] }, { id: 'job2', kind: 'gif', status: 'failed', error: 'ffmpeg died' }],
    },
  });
  const tool = createExportTool({ ...link, http });
  const value = await tool.execute({ action: 'status' }, { agent });
  assert.match(value.text, /C:\/out\/one\.mp4/);
  assert.match(value.text, /ffmpeg died/);
});

test('cancel goes to DELETE for that job only', async () => {
  const { calls, http } = fakeHttp();
  const tool = createExportTool({ ...link, http });
  await tool.execute({ action: 'cancel', job: 'job1' }, { agent });
  assert.equal(calls[0].method, 'DELETE');
  assert.equal(calls[0].path, '/api/projects/film123/exports/job1');
  await assert.rejects(tool.execute({ action: 'cancel' }, { agent }), /Which export/);
});

test('an unknown kind is refused by name', async () => {
  const { http } = fakeHttp();
  const tool = createExportTool({ ...link, http });
  await assert.rejects(tool.execute({ kind: 'mp4' }, { agent }), /kind must be one of/);
});

test('CLI argv is built here, and only from the whitelist', () => {
  assert.deepEqual(cliArguments('doctor', {}, 'C:/p').argv, ['doctor']);
  assert.deepEqual(cliArguments('look', { at: 4.5, count: 12 }, 'C:/p').argv, ['look', '4.5', '--count', '12']);
  assert.deepEqual(cliArguments('look', { from: 3, to: 6, full: true, loudness: -14 }, 'C:/p').argv,
    ['look', '3-6', '--full', '--loudness=-14']);
  assert.deepEqual(cliArguments('render', { fps: 29.97, alpha: true, loudness: -14 }, 'C:/p').argv,
    ['render', '--fps', '29.97', '--alpha', '--loudness=-14']);
  // Anything not on the list is refused instead of passed through.
  assert.match(cliArguments('get', {}, 'C:/p').error, /只允许 doctor \/ look \/ render/);
  assert.match(cliArguments('render', { out: 'C:/elsewhere/out.mp4' }, 'C:/p').error, /必须在项目文件夹里/);
  assert.deepEqual(cliArguments('render', { out: 'C:/p/out.mp4' }, 'C:/p').argv.slice(0, 3), ['render', '--out', 'C:\\p\\out.mp4']);
  // A range that would be nonsense is dropped rather than passed as a literal.
  assert.deepEqual(cliArguments('render', { from: 9, to: 3 }, 'C:/p').argv, ['render']);
});

test('a run reports the exit code and the output, and never throws on failure', async () => {
  const spawnImpl = (cmd, argv, options) => {
    const listeners = {};
    const child = {
      stdout: { on: (_name, fn) => { listeners.out = fn; } },
      stderr: { on: (_name, fn) => { listeners.err = fn; } },
      on: (name, fn) => { listeners[name] = fn; },
      kill() {},
    };
    setImmediate(() => { listeners.out?.('rendering…\n'); listeners.err?.('warn\n'); listeners.close?.(0); });
    assert.equal(argv[0], 'C:/cli/bin/openfilm.mjs');
    assert.equal(options.cwd, bound.path);
    assert.equal(options.shell, false);
    assert.equal(options.env.NO996_OPENFILM_CLI, '0');
  // The kernel's own switch: Studio starts, nothing opens in the person's browser.
  // Without it open puts a second editing window on screen, with the upstream
  // desktop-app pitch in it, while the panel is already showing the film.
  assert.equal(options.env.OPENFILM_NO_BROWSER, '1', 'a tool call must never open a browser window');
    return child;
  };
  const tool = createCliTool({ ...link, cliPath: 'C:/cli/bin/openfilm.mjs', spawnImpl, timeoutMs: 50 });
  const value = await tool.execute({ verb: 'doctor' }, { agent });
  assert.match(value.text, /退出码 0/);
  assert.match(value.text, /rendering/);
});

test('a failing run is handed back for the model to read', async () => {
  const spawnImpl = () => {
    const listeners = {};
    const child = {
      stdout: { on: () => {} },
      stderr: { on: (_n, fn) => { listeners.err = fn; } },
      on: (name, fn) => { listeners[name] = fn; },
      kill() {},
    };
    setImmediate(() => { listeners.err?.('not a project\n'); listeners.close?.(2); });
    return child;
  };
  const tool = createCliTool({ ...link, cliPath: 'C:/cli/bin/openfilm.mjs', spawnImpl, timeoutMs: 50 });
  // `look` is refused now (it starts Studio and a window), so the failing run is doctor's.
  const value = await tool.execute({ verb: 'doctor' }, { agent });
  assert.match(value.text, /退出码 2/);
  assert.match(value.text, /not a project/);
  assert.match(value.text, /不要原样重试/);
});

test('the recursion guard and a missing CLI are explicit', async () => {
  const tool = createCliTool({ ...link, cliPath: undefined, spawnImpl: () => { throw new Error('must not run'); } });
  const saved = process.env.NO996_OPENFILM_CLI;
  process.env.NO996_OPENFILM_CLI = '1';
  try {
    await assert.rejects(tool.execute({ verb: 'doctor' }, { agent }), /不许调用 CLI/);
  } finally {
    if (saved === undefined) delete process.env.NO996_OPENFILM_CLI; else process.env.NO996_OPENFILM_CLI = saved;
  }
  // The bundled dependency is present in this repo, so resolution finds a real path.
  const found = resolveCli();
  assert.ok(found === undefined || /openfilm\.mjs$/.test(found), String(found));
});

test('the tool only runs doctor: look and render would start Studio and a window', async () => {
  const tool = createCliTool({
    isProjectAgent: () => true,
    projectOf: () => ({ path: 'C:/p' }),
    cliPath: 'C:/openfilm/bin/openfilm.mjs',
    spawnImpl: () => { throw new Error('must not spawn'); },
  });
  assert.deepEqual(tool.parameters.properties.verb.enum, ['doctor']);
  for (const verb of ['look', 'render']) {
    await assert.rejects(
      () => tool.execute({ verb }, { agent: {} }),
      error => /openfilm_cli 只保留 doctor/.test(error.message) && /openfilm_frame/.test(error.message),
      verb + ' must be refused by name, pointing at the tool that does the job',
    );
  }
});
