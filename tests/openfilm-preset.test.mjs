import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { readFile } from 'node:fs/promises';
import { apply } from '../src/openfilm-prompt.mjs';
import { openProjectConversations } from '../src/project-conversation.mjs';
import { openProjectSessions } from '../src/project-sessions.mjs';

const chain = () => ({ min: chain, regex: chain, strict: chain });
const z = { object: chain, string: chain, literal: chain, discriminatedUnion: chain };
function fixture() {
  const records = new Map();
  const requests = [];
  const ctx = {
    storageDomain: { async open() { return { table: () => records, close: async () => {} }; } },
    sessionController: {
      async create(request) { requests.push(request); return { sessionId: `new-${requests.length}` }; },
      async list() { return { items: [] }; },
    },
  };
  // Storage domain tables expose asynchronous put, unlike a native Map.
  records.put = async (key, value) => records.set(key, value);
  return { ctx, records, requests };
}

test('new project conversations request the video preset without reusing a session', async () => {
  const { ctx, requests } = fixture();
  const project = { projectId: 'film123', path: path.resolve('film') };
  ctx.sessionController.list = async () => ({ items: requests.map((_, index) => ({ sessionId: `new-${index + 1}`, cwd: project.path })) });
  const registry = await openProjectConversations(ctx, { z });
  const [a, b] = await Promise.all([registry.resolve(project), registry.resolve(project)]);
  assert.equal(a, 'new-1');
  assert.equal(b, 'new-1');
  assert.deepEqual(requests, [{ cwd: project.path, agentPreset: 'openfilm-video-editing' }]);
  await registry.close();
});

test('existing project conversations remain bound without creating or selecting a preset', async () => {
  const { ctx, records, requests } = fixture();
  const project = { projectId: 'film123', path: path.resolve('film') };
  records.set(project.projectId, { ...project, sessionId: 'old-session' });
  ctx.sessionController.list = async () => ({ items: [{ sessionId: 'old-session', cwd: project.path }] });
  const registry = await openProjectConversations(ctx, { z });
  assert.equal(await registry.resolve(project), 'old-session');
  assert.deepEqual(requests, []);
  await registry.close();
});

test('project sessions create with the video preset and retain existing bindings', async () => {
  const { ctx, requests } = fixture();
  const registry = await openProjectSessions(ctx, { z });
  const project = { projectId: 'film123', path: path.resolve('film') };
  assert.equal(await registry.ensure(project), 'new-1');
  assert.equal(await registry.ensure(project), 'new-1');
  assert.deepEqual(requests, [{ cwd: project.path, agentPreset: 'openfilm-video-editing' }]);
  await registry.close();
});

test('preset prompt registers only on the supplied Cordis context and disposes', () => {
  let section, disposed = false;
  const dispose = apply({ systemPrompt: { section(value) { section = value; return () => { disposed = true; }; } } });
  assert.equal(section.name, 'openfilm-video-editing');
  assert.equal(section.interpolate, false);
  assert.match(section.text, /openfilm_draft/);
  assert.match(section.text, /sandbox/);
  dispose();
  assert.equal(disposed, true);
});

test('bundle declares the video preset and its prompt module', async () => {
  const patch = await readFile(new URL('../cordis.patch.yml', import.meta.url), 'utf8');
  assert.match(patch, /id: preset-openfilm-video-editing/);
  assert.match(patch, /id: openfilm-video-editing/);
  assert.match(patch, /name: 'dsh-openfilm\/openfilm-prompt'/);
  const prompt = await import('dsh-openfilm/openfilm-prompt');
  assert.equal(prompt.apply, apply);
  for (const name of ['tool-fs', 'tool-fs-search', 'tool-bash', 'tool-pwsh', 'tool-jobs', 'tool-skill', 'skill-filesystem', 'tool-todo', 'tool-web', 'agent-instructions']) {
    assert.match(patch, new RegExp(`id: ${name}\\n\\s+name: '@deepseek-ai/dsh-${name}'`));
  }
  assert.match(patch, /disabled: !!js process\.platform === 'win32'/);
  assert.match(patch, /disabled: !!js process\.platform !== 'win32'/);
  assert.doesNotMatch(patch, /dsh-plugin-manager\/tools/);
});
