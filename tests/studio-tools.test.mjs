import test from 'node:test';
import assert from 'node:assert/strict';
import { createFrameTool } from '../src/frame-tool.mjs';
import { createFilmTool, summarizeFilm, exportReadiness } from '../src/film-tool.mjs';
import { createLibraryTool } from '../src/library-tool.mjs';
import { createGetTool } from '../src/get-tool.mjs';

const bound = { projectId: 'film123', path: 'C:/films/one' };
const agent = { id: 'session-a', session: { requestHeader: () => ({ config: { provider: 'p', model: 'm' } }) } };

function fakeHttp(replies = {}) {
  const calls = [];
  const client = {
    async get(path, options) { calls.push({ method: 'GET', path, options }); return replies[`GET ${path}`] ?? {}; },
    async post(path, options) { calls.push({ method: 'POST', path, options }); return replies[`POST ${path}`] ?? {}; },
    async picture(path, options) { calls.push({ method: 'PICTURE', path, options }); return replies[`PICTURE ${path}`] ?? { bytes: new Uint8Array([0xff, 0xd8, 0xff, 0xd9]) }; },
  };
  return { calls, http: () => client };
}

const link = { isProjectAgent: candidate => candidate?.id === 'session-a', projectOf: candidate => (candidate?.id === 'session-a' ? bound : undefined) };
const run = (tool, args = {}) => tool.execute(args, { agent });

test('every project tool refuses an unbound conversation', async () => {
  const { http } = fakeHttp();
  for (const tool of [
    createFrameTool({ ...link, http, attachments: () => ({}) }),
    createFilmTool({ ...link, http }),
    createLibraryTool({ ...link, http }),
    createGetTool({ ...link, http }),
  ]) {
    await assert.rejects(tool.execute({}, { agent: { id: 'someone-else' } }), /only to a conversation bound/);
  }
});

test('a frame is drawn by the running Studio and handed over as an image', async () => {
  const { calls, http } = fakeHttp();
  const saved = [];
  const tool = createFrameTool({
    ...link, http,
    attachments: () => ({ async saveImage(input) { saved.push(input); return { attachmentId: 'att-1', bytes: 4, width: 960, height: 540 }; } }),
    llm: () => ({ async resolveModelInfo() { return { inputModalities: ['text', 'image'] }; } }),
  });
  const value = await run(tool, { at: 12.5, width: 640 });
  assert.deepEqual(calls[0].options.query, { path: 'film.html', what: 'frame', ms: 12500, w: 640 });
  assert.equal(saved.length, 1);
  assert.equal(value.image.attachmentId, 'att-1');
  assert.equal(value.image.width, 960);
  assert.match(value.text, /第 12.5 秒/);
});

test('a model that cannot see images is told the truth instead of being sent one', async () => {
  const { http } = fakeHttp();
  const tool = createFrameTool({
    ...link, http,
    attachments: () => ({ async saveImage() { return { attachmentId: 'att-1', bytes: 4, width: 10, height: 10 }; } }),
    llm: () => ({ async resolveModelInfo() { return { inputModalities: ['text'] }; } }),
  });
  const value = await run(tool, { at: 3 });
  assert.equal(value.image, undefined);
  assert.match(value.text, /不支持读图/);
});

test('page facts come back as text, not as a picture', async () => {
  const { calls, http } = fakeHttp({ 'GET /api/projects/film123/media': { duration: 12, width: 1080, height: 1920 } });
  const tool = createFilmTool({ ...link, http });
  const frame = createFrameTool({ ...link, http, attachments: () => ({}), llm: () => undefined });
  const value = await frame.execute({ probe: true }, { agent });
  assert.equal(calls[0].options.query.what, 'probe');
  assert.match(value.text, /duration/);
  assert.equal(typeof value.image, 'undefined');
  assert.equal(typeof tool.execute, 'function');
});

test('the film summary counts tracks and clips without dumping the document', () => {
  const summary = summarizeFilm({
    tracks: [
      { id: 'v1', name: 'Video', locked: true, clips: [{ id: 'c1', from: 0, to: 3, src: 'a.mp4' }, { id: 'c2', from: 3, to: 6 }] },
      { id: 'a1', name: 'Audio', clips: [] },
    ],
    width: 1080,
    height: 1920,
  });
  assert.equal(summary.clips, 2);
  assert.equal(summary.tracks.length, 2);
  assert.equal(summary.tracks[0].locked, true);
  assert.equal(summary.tracks[0].clips[0].id, 'c1');
  assert.equal(summary.film.width, 1080);
  assert.equal(summary.tracks[1].clips.length, 0);
});

test('export readiness reports only what upstream actually said', async () => {
  const { calls, http } = fakeHttp({ 'GET /api/projects/film123/exports': { can: { h264: true, prores: false }, folder: 'C:/out', exports: [] } });
  const tool = createFilmTool({ ...link, http });
  const value = await run(tool, { detail: 'exports' });
  assert.equal(calls[0].path, '/api/projects/film123/exports');
  assert.match(value.text, /h264/);
  assert.equal(exportReadiness(undefined).known, false);
});

test('a library search and a take are different upstream calls', async () => {
  const { calls, http } = fakeHttp({
    'POST /api/get/library': { code: 0, lines: ['transition: soft-fade — 柔和淡入 (id: t-9)'] },
    'POST /api/get': { ok: true, text: 'assets/library/soft-fade.html → assets/' },
  });
  const tool = createLibraryTool({ ...link, http });
  const found = await run(tool, { query: '柔和淡入', kind: 'transition' });
  assert.deepEqual(calls[0].options.body, { verb: 'transition', args: { prompt: '柔和淡入', limit: 8 } });
  assert.match(found.text, /t-9/);

  const taken = await run(tool, { take: 't-9', kind: 'sfx' });
  assert.equal(calls[1].path, '/api/get');
  assert.deepEqual(calls[1].options.body, { folder: bound.path, verb: 'sound', args: { take: 't-9' } });
  assert.match(taken.text, /取入项目/);
});

test('generation reports what is connected, and a refusal stays a readable answer', async () => {
  const { calls, http } = fakeHttp({
    'GET /api/get': { verbs: [{ verb: 'tts', help: 'voice-over' }], note: 'Connect a service in Settings' },
    'POST /api/get': { ok: false, code: 1, text: 'Not connected here: tts (ElevenLabs)' },
  });
  const tool = createGetTool({ ...link, http });
  const listed = await run(tool, { list: true });
  assert.match(listed.text, /tts/);
  assert.match(listed.text, /Connect a service/);

  const refused = await run(tool, { verb: 'tts', prompt: '你好' });
  assert.deepEqual(calls[1].options.body, { folder: bound.path, verb: 'tts', args: { prompt: '你好' } });
  assert.match(refused.text, /没有做成/);
  assert.match(refused.text, /Not connected/);
  assert.match(refused.text, /不要原样重试/);
});

test('spending is only confirmed when the person said so', async () => {
  const { calls, http } = fakeHttp({ 'POST /api/get': { ok: true, text: 'done' } });
  const tool = createGetTool({ ...link, http });
  await run(tool, { verb: 'video', prompt: '日落' });
  assert.equal(calls[0].options.body.yes, undefined);
  await run(tool, { verb: 'video', prompt: '日落', yes: true });
  assert.equal(calls[1].options.body.yes, true);
});
