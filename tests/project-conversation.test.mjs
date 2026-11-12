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

function fixture({ items = [], workspace = true, rename = true, createFails = false, attachWorks = true } = {}) {
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
            // A real attach makes the Session a member, and the catalog says so: the
        // read-back is what proves membership, so the fake must move too.
        async attachSession(sessionId) {
          calls.attach.push(sessionId);
          if (!attachWorks) return;
          const item = items.find(candidate => candidate.sessionId === sessionId);
          if (item) item.workspaceId = 'workspace-1';
          else items.push({ sessionId, workspaceId: 'workspace-1' });
        },
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
// When the Host refuses to create the Session, the reason has to survive.
//
// A preset that failed to load made `sessionController.create` throw, the bare
// PROJECT_CONVERSATION_CREATE hid it, and the panel showed
// "OpenFilm capability unavailable: agent:prompt [503] PROJECT_CONVERSATION_CREATE"
// with nothing to act on. The code and message stay on the error now, and the log
// gets them too.
test('a refused session creation keeps the Host reason', async () => {
  const { ctx, records } = fixture({ workspace: false, createFails: true });
  const failures = [];
  const conversations = await openProjectConversations(ctx, {
    z,
    onFailure: (event, fields) => failures.push([event, fields]),
  });
  await assert.rejects(
    () => conversations.resolve({ projectId: 'proj123456', path: projectPath }),
    error => error.code === 'PROJECT_CONVERSATION_CREATE' && error.detail === 'nope' && error.cause instanceof Error,
  );
  // The grouping trail comes first now: a fallback to a cwd-only Session is
  // exactly what put conversations in 未分组, so it is reported, not swallowed.
  assert.deepEqual(failures, [
    ['workspace-join', { step: 'controller', ok: false, code: 'WORKSPACE_CONTROLLER_MISSING' }],
    ['project-conversation-create', { detail: 'nope', workspace: 'cwd' }],
  ]);
  assert.equal(records.size, 0, 'a failed creation stores no hint');
});
test('a conversation the catalog already groups needs no attach', async () => {
  // The bug being guarded: 未分组 came from never proving membership. When it is
  // already proven, touching the Workspace would be noise.
  const { ctx, calls } = fixture({ items: [{ sessionId: 'session-1', cwd: projectPath, title: 'demo-film', workspaceId: 'workspace-1' }] });
  const conversations = await openProjectConversations(ctx, { z });
  await conversations.resolve({ projectId: 'proj123456', path: projectPath });
  assert.deepEqual(calls.attach, [], 'membership is read back, not re-applied');
  assert.equal(conversations.grouping('proj123456'), 'seated');
});

test('an attach that does not take is reported, and the project still opens', async () => {
  // Membership is presentation: it must never stop the person from working, but a
  // failure that leaves the Session ungrouped has to be visible in diagnostics.
  const { ctx, calls } = fixture({ attachWorks: false });
  const failures = [];
  const conversations = await openProjectConversations(ctx, { z, onFailure: (event, fields) => failures.push([event, fields]) });
  const sessionId = await conversations.resolve({ projectId: 'proj123456', path: projectPath });
  assert.equal(sessionId, 'session-1');
  assert.equal(calls.attach.length, 1, 'one retry at most: a loop would spin against a Host that answers the same way');
  assert.equal(conversations.grouping('proj123456'), 'degraded');
  const verify = failures.filter(([event, fields]) => event === 'workspace-join' && fields.step === 'verify');
  assert.deepEqual(verify, [['workspace-join', { step: 'verify', ok: false, code: 'WORKSPACE_MEMBERSHIP_UNCONFIRMED' }]]);
});

test('binding a project marks it as shown, so the CLI never starts Studio for it', async () => {
  const { mkdtemp, rm, access } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const root = await mkdtemp(join(tmpdir(), 'openfilm-marker-'));
  try {
    const { ctx } = fixture();
    const conversations = await openProjectConversations(ctx, { z });
    await conversations.resolve({ projectId: 'proj123456', path: root });
    await access(join(root, '.film', 'opened'));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
