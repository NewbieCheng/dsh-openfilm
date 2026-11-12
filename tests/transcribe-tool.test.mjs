import test from 'node:test';
import assert from 'node:assert/strict';
import { createTranscribeTool } from '../src/transcribe-tool.mjs';

const bound = { projectId: 'film123', path: 'C:/films/one' };
const agent = { id: 'session-a' };
const link = {
  isProjectAgent: candidate => candidate?.id === 'session-a',
  projectOf: candidate => (candidate?.id === 'session-a' ? bound : undefined),
};

function harness(overrides = {}) {
  const refineCalls = overrides.refineCalls ?? [];
  const calls = { transcribe: [], setups: 0, status: 0 };
  const record = {
    key: 'abc123', source: 'talk.mp4', durationSec: 623.4, model: 'sensevoice-small-int8', cached: false,
    segments: [{ start: 0, end: 6.4, text: '大家好，今天我们聊剪片。' }, { start: 6.9, end: 11.2, text: '先说结论。' }],
    sentences: [], text: '大家好，今天我们聊剪片。先说结论。',
    stats: { elapsedMs: 12_400, rtf: 0.02 },
    ...overrides.record,
  };
  const service = {
    async status() {
      calls.status += 1;
      return {
        ready: true, label: 'SenseVoice-small (int8)', dir: 'C:/models/sensevoice',
        bytesTotal: 239549735, bytesOnDisk: 239549735, progress: 1, installing: false, engine: 'ready',
        ...overrides.state,
      };
    },
    async transcribe(request) {
      calls.transcribe.push(request);
      if (overrides.error) throw overrides.error;
      return record;
    },
    setup() { calls.setups += 1; return Promise.resolve({ ready: true }); },
  };
  const tool = createTranscribeTool({
    ...link, service, refineCalls,
    refine: overrides.refine === undefined ? null : overrides.refine,
  });
  return { tool, calls, record, refineCalls };
}

const run = (tool, args, who = { ...agent }) => tool.execute(args, { agent: who });

test('only a bound conversation may use it', async () => {
  const { tool } = harness();
  await assert.rejects(run(tool, { status: true }, { id: 'stranger' }), /only to a conversation bound/);
});

test('status reports readiness, the model directory and the size', async () => {
  const { tool } = harness();
  const value = await run(tool, { status: true });
  assert.match(value.text, /已就绪/);
  assert.match(value.text, /C:\/models\/sensevoice/);
  assert.match(value.text, /228 MB/);
  assert.match(value.text, /不出这台电脑/);
});

test('status on a fresh machine explains the download instead of failing', async () => {
  const { tool } = harness({ state: { ready: false, installing: false, progress: 0, bytesOnDisk: 0 } });
  const value = await run(tool, { status: true });
  assert.match(value.text, /未就绪/);
  assert.match(value.text, /setup 开始下载/);
});

test('status while installing shows real progress', async () => {
  const { tool } = harness({ state: { ready: false, installing: true, progress: 0.42, bytesOnDisk: 100_000_000 } });
  const value = await run(tool, { status: true });
  assert.match(value.text, /正在下载：42%/);
  assert.match(value.text, /95 \/ 228 MB/);
});

test('setup starts the download and does not wait for it', async () => {
  const { tool, calls } = harness({ state: { ready: false, installing: false, progress: 0, bytesOnDisk: 0 } });
  const value = await run(tool, { setup: true });
  assert.equal(calls.setups, 1);
  assert.match(value.text, /已开始下载/);
  assert.match(value.text, /不会卡住这一轮/);
});

test('setup on a ready machine just reports the state', async () => {
  const { tool, calls } = harness();
  const value = await run(tool, { setup: true });
  assert.equal(calls.setups, 0);
  assert.match(value.text, /已就绪/);
});

test('a transcript comes back with timecodes, segments and the cache path', async () => {
  const { tool, calls } = harness();
  const value = await run(tool, { from: 'C:\\clips\\talk.mp4' });
  assert.equal(calls.transcribe.length, 1);
  assert.match(calls.transcribe[0].cacheDir, /films[\\/]one[\\/]\.openfilm[\\/]transcripts$/);
  assert.equal(calls.transcribe[0].lang, 'auto');
  assert.match(value.text, /\[00:00\.0–00:06\.4\] 大家好/);
  assert.match(value.text, /\[00:06\.9–00:11\.2\] 先说结论/);
  assert.match(value.text, /2 段/);
  assert.match(value.text, /RTF 0\.02/);
  assert.match(value.text, /transcripts[\\/]abc123\.json/);
});

test('a relative path is refused before anything runs', async () => {
  const { tool, calls } = harness();
  await assert.rejects(run(tool, { from: 'clips/talk.mp4' }), /绝对路径/);
  assert.equal(calls.transcribe.length, 0);
});

test('a missing model starts the download and says what happens next', async () => {
  const error = Object.assign(new Error('模型还没准备好。已经自动开始下载，完成后再次调用即可。'), { code: 'MODEL_NOT_READY' });
  const { tool, calls } = harness({ error });
  const value = await run(tool, { from: 'C:\\clips\\talk.mp4' });
  assert.equal(calls.setups, 1);
  assert.match(value.text, /这不是错误/);
  assert.match(value.text, /status/);
});

test('a real failure still rejects with its own message', async () => {
  const { tool } = harness({ error: Object.assign(new Error('音轨里没有听到人声'), { code: 'NO_SPEECH' }) });
  await assert.rejects(run(tool, { from: 'C:\\clips\\talk.mp4' }), /没有听到人声/);
});

test('a refined transcript keeps its timings and says what changed', async () => {
  const refine = async ({ segments }) => ({
    refined: true, changed: 1,
    segments: segments.map((segment, index) => (index === 0 ? { ...segment, text: '大家好，今天聊 OpenFilm 剪辑。' } : segment)),
  });
  const { tool } = harness({ refine });
  const value = await run(tool, { from: 'C:\\clips\\talk.mp4' });
  assert.match(value.text, /DSH 模型已校对术语与标点（改动 1 段/);
  assert.match(value.text, /\[00:00\.0–00:06\.4\] 大家好，今天聊 OpenFilm 剪辑。/);
});

test('refine can be turned off per call, and says so', async () => {
  const refine = async () => { throw new Error('should not be called'); };
  const { tool } = harness({ refine });
  const value = await run(tool, { from: 'C:\\clips\\talk.mp4', refine: false });
  assert.match(value.text, /已跳过（按要求关闭）/);
});

test('a bad refine reply keeps the raw transcript', async () => {
  const refine = async () => ({ refined: false, reason: 'bad_reply', segments: [] });
  const { tool } = harness({ refine });
  const value = await run(tool, { from: 'C:\\clips\\talk.mp4' });
  assert.match(value.text, /格式不对/);
  assert.match(value.text, /大家好，今天我们聊剪片。/);
});

test('maxChars truncates the inline text and says where the rest is', async () => {
  const { tool } = harness({ record: { text: '字'.repeat(2000) } });
  const value = await run(tool, { from: 'C:\\clips\\talk.mp4', maxChars: 200 });
  assert.match(value.text, /只给了前 200 字/);
  assert.match(value.text, /共 2000 字/);
});
