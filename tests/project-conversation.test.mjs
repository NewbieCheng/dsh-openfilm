// The live module behind "one project = one conversation, in that project's folder".
//
// Two failures made every video project show up as a stray "新建会话" under
// 无工作区: a case-only path mismatch read as "the stored Session is not this
// project's" (so a fresh empty conversation was created on every open), and
// nothing registered the project's folder as a Workspace, so DSH had no group to
// put the Session in.
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { openProjectConversations } from '../src/project-conversation.mjs';

const chain = () => ({ min: chain, regex: chain, strict: chain });
const z = { object: chain, string: chain, literal: chain, discriminatedUnion: chain };

function fixture({ items = [], workspace = true, rename = true, createFails = false } = {}) {
  const records = new Map();
  const calls = { create: [], list: 0, rename: [], workspace: [], attach: [] };
  const ctx = {
    storageDomain: { async open() { return { table: () => ({ get: key => records.get(key), put: async (key, value) => records.set(key, value) }), close: async () => {} }; } },
    sessionController: {
      async create(request) {
        calls.create.push(request);
        if (createFails) throw new Error('nope');
        return { sessionId: `session-${calls.create.length}` };
      },
      async list() { calls.list += 1; return { items }; },
      ...(rename ? { async rename(request) { calls.rename.push(request); return { ok: true }; } } : {}),
    },
    get: name => (name === 'workspaceController' && workspace
      ? {
        async create(request) {
          calls.workspace.push(request);
          return {
            id: 'workspace-1',
            path: request.path,
            title: 'demo-film',
            sessionIds: [],
            async attachSession(sessionId) { calls.attach.push(sessionId); },
          };
        },
      }
      : undefined),
  };
  return { ctx, records, calls };
}

const projectPath = path.resolve('F:/Dev/Films/demo-film');

test('a new project registers its folder as a Workspace and names the conversation', async () => {
  const { ctx, calls, records } = fixture();
  const conversations = await openProjectConversations(ctx, { z });
  const sessionId = await conversations.resolve({ projectId: 'proj123456', path: projectPath });

  assert.equal(sessionId, 'session-1');
  assert.deepEqual(calls.workspace, [{ path: projectPath }], 'the folder must be on the Workspace list, or DSH has no group for it');
  // workspaceId and cwd are exclusive: joining is what puts the Session in the
  // project's group instead of the ungrouped pile.
  assert.deepEqual(calls.create[0], { workspaceId: 'workspace-1', agentPreset: 'openfilm-video-editing' });
  assert.deepEqual(calls.attach, ['session-1']);
  assert.equal(calls.rename.length, 1);
  assert.equal(calls.rename[0].title, 'demo-film', 'the conversation is named after its project folder');
  assert.equal(records.get('proj123456').sessionId, 'session-1');
});

test('reopening the same project reuses its conversation instead of making another', async () => {
  const { ctx, calls } = fixture({ items: [{ sessionId: 'session-1', cwd: projectPath, title: 'demo-film' }] });
  const conversations = await openProjectConversations(ctx, { z });
  // First open binds the project to a conversation and names it once.
  assert.equal(await conversations.resolve({ projectId: 'proj123456', path: projectPath }), 'session-1');
  assert.equal(calls.rename.length, 1);
  // Every later open must find that same conversation.
  const again = await conversations.resolve({ projectId: 'proj123456', path: projectPath });
  assert.equal(again, 'session-1');
  assert.equal(calls.create.length, 1, 'one project, one conversation');
  assert.equal(calls.rename.length, 1, 'a title the person chose is never overwritten');
  assert.equal(calls.workspace.length, 2, 'grouping is repaired on every open, and it is idempotent');
});

test('an untitled conversation is named on the next open', async () => {
  const { ctx, calls } = fixture({ items: [{ sessionId: 'session-1', cwd: projectPath, title: '' }] });
  const conversations = await openProjectConversations(ctx, { z });
  // Seed the hint the way a previous run would have.
  await conversations.resolve({ projectId: 'proj123456', path: projectPath });
  calls.rename.length = 0;
  const sessionId = await conversations.resolve({ projectId: 'proj123456', path: projectPath });
  assert.equal(sessionId, 'session-1');
});

test('a cwd that differs only in case still counts as the same folder on Windows', { skip: process.platform !== 'win32' ? 'case-insensitive paths are a Windows fact' : false }, async () => {
  const shouted = projectPath.toUpperCase();
  const { ctx, records, calls } = fixture({ items: [{ sessionId: 'session-1', cwd: shouted, title: 'demo-film' }] });
  records.set('proj123456', { projectId: 'proj123456', path: projectPath, sessionId: 'session-1' });
  const conversations = await openProjectConversations(ctx, { z });
  const sessionId = await conversations.resolve({ projectId: 'proj123456', path: projectPath });
  assert.equal(sessionId, 'session-1');
  assert.equal(calls.create.length, 0, 'a case mismatch must not look like a foreign Session');
});

test('a profile without the Workspace controller still opens the project, owning its folder', async () => {
  const { ctx, calls } = fixture({ workspace: false, rename: false });
  const conversations = await openProjectConversations(ctx, { z });
  const sessionId = await conversations.resolve({ projectId: 'proj123456', path: projectPath });
  assert.equal(sessionId, 'session-1');
  assert.deepEqual(calls.create[0], { cwd: projectPath, agentPreset: 'openfilm-video-editing' });
  assert.deepEqual(calls.attach, []);
});

test('a foreign Session with the same id but another folder is not adopted', async () => {
  const { ctx, records, calls } = fixture({ items: [{ sessionId: 'session-foreign', cwd: path.resolve('F:/Dev/Films/other'), title: 'x' }] });
  records.set('proj123456', { projectId: 'proj123456', path: projectPath, sessionId: 'session-foreign' });
  const conversations = await openProjectConversations(ctx, { z });
  const sessionId = await conversations.resolve({ projectId: 'proj123456', path: projectPath });
  assert.equal(sessionId, 'session-1', 'a Session in another folder is never claimed, so a new one is made');
  assert.equal(calls.create.length, 1);
});
// The service may answer a plain Workspace view (`workspaceId`) rather than the
// live object; the Session still has to join it.
test('a Workspace view without attachSession still groups the conversation', async () => {
  const records = new Map();
  const calls = { create: [], workspace: [] };
  const ctx = {
    storageDomain: { async open() { return { table: () => ({ get: k => records.get(k), put: async (k, v) => records.set(k, v) }), close: async () => {} }; } },
    sessionController: {
      async create(request) { calls.create.push(request); return { sessionId: 'session-1' }; },
      async list() { return { items: [] }; },
    },
    get: name => (name === 'workspaceController'
      ? { async create(request) { calls.workspace.push(request); return { workspaceId: 'workspace-9', path: request.path, title: 'demo-film', sessionIds: [] }; } }
      : undefined),
  };
  const conversations = await openProjectConversations(ctx, { z });
  const sessionId = await conversations.resolve({ projectId: 'proj123456', path: projectPath });
  assert.equal(sessionId, 'session-1');
  assert.deepEqual(calls.create[0], { workspaceId: 'workspace-9', agentPreset: 'openfilm-video-editing' });
});