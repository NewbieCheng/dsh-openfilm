import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createPluginLog, redact } from '../src/plugin-log.mjs';

test('events land as one JSON object per line', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'no996-log-'));
  const log = createPluginLog({ file: join(dir, 'plugin.log') });
  log.info('studio-start', { port: 1234 });
  log.error('upstream-5xx', { status: 500, path: '/api/projects/x' });
  await log.flush();
  const lines = (await readFile(join(dir, 'plugin.log'), 'utf8')).trim().split('\n');
  assert.equal(lines.length, 2);
  const first = JSON.parse(lines[0]);
  assert.equal(first.level, 'info');
  assert.equal(first.event, 'studio-start');
  assert.equal(first.port, 1234);
  assert.ok(first.at);
});

test('a log never carries a credential or a project path', () => {
  const out = redact({
    ticket: 'abc123',
    apiKey: 'sk-live-1',
    sessionId: 'sess',
    projectPath: 'F:\\secret\\my film',
    projectName: '纸纹讲堂-af961a41ad23',
    status: 500,
    ok: true,
  });
  assert.equal(out.ticket, '[redacted]');
  assert.equal(out.apiKey, '[redacted]');
  assert.equal(out.sessionId, '[redacted]');
  assert.equal(out.projectPath.includes('secret'), false);
  assert.equal(out.projectName.includes('纸纹'), false);
  assert.match(out.projectPath, /^[0-9a-f]{10}:\d+$/);
  assert.equal(out.status, 500);
  assert.equal(out.ok, true);
});

test('rotation keeps a bounded pair of files', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'no996-log-'));
  const file = join(dir, 'plugin.log');
  const log = createPluginLog({ file, limit: 400, keep: 1 });
  for (let index = 0; index < 40; index += 1) log.info('tick', { index });
  await log.flush();
  const names = (await readdir(dir)).sort();
  assert.deepEqual(names, ['plugin.log', 'plugin.log.1']);
  const size = (await stat(file)).size;
  assert.ok(size < 1200, `current file should stay near the limit, was ${size}`);
});

test('the in-memory tail survives a failed disk and is capped', async () => {
  // A directory that cannot be created on purpose: writes fail, tail still works.
  const log = createPluginLog({ file: join(tmpdir(), '\u0000nope', 'plugin.log'), recent: 5 });
  for (let index = 0; index < 12; index += 1) log.warn('hickup', { index });
  await log.flush();
  const tail = log.tail(5);
  assert.equal(tail.length, 5);
  assert.deepEqual(tail.map(entry => entry.index), [7, 8, 9, 10, 11]);
});
