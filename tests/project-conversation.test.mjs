// The live module behind "one project = one conversation, in that project's folder".
//
// Two failures made every video project show up as a stray "新建会话" under
// 无工作区: a case-only path mismatch read as "the stored Session is not this
// project's" (so a fresh empty conversation was created on every open), and the
// Workspace value was read as a flat object while DSH 0.11 answers
// `{ workspace: { workspaceId, sessionIds }, created }` — so no id, no join, and
// a cwd-only Session that DSH can never adopt into a group.
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { openProjectConversations } from '../src/project-conversation.mjs';

const chain = () => ({ min: chain, regex: chain, strict: chain });
const z = { object: chain, string: chain, literal: chain, discriminatedUnion: chain };

const projectPath = path.resolve('F:/Dev/Films/demo-film');

/**
 * A Host that answers the way DSH 0.11 does.
 *
 * `workspace/create` returns the Remote value; `session/create` with a
 * `workspaceId` accounts the Session to the Workspace, with a `cwd` it does not
 * (that is the ungrouped pile); `session/list` returns `SessionSummary` rows,
 * which carry no `workspaceId`, only the projections carry a title.
 */
function fixture({
  items = [], workspace = true, rename = true, createFails = false, seat = true, legacy = false, catalog = true, seated = [],
} = {}) {
  const records = new Map();
  const calls = { create: [], list: 0, rename: [], workspace: [] };
  const state = { path: '', sessionIds: [...seated] };

  const view = () => ({ workspaceId: 'workspace-1', path: state.path, title: 'demo-film', sessionIds: [...state.sessionIds] });

  const ctx = {
    storageDomain: { async open() { return { table: () => ({ get: key => records.get(key), put: async (key, value) => records.set(key, value), entries: () => records.entries() }), close: async () => {} }; } },
    sessionController: {
      async create(request) {
        calls.create.push(request);
        if (createFails) throw new Error('nope');
        // One id per conversation, so a replaced Session never collides with its successor.
        const sessionId = `session-${items.length + 1}`;
        // The Host accounts a Workspace-created Session; a cwd-only one cannot be
        // adopted later, so it stays out of the list.
        if (seat && request.workspaceId === 'workspace-1') state.sessionIds.push(sessionId);
        items.push({ sessionId, cwd: projectPath, blank: true });
        return { sessionId };
      },
      async list() {
        calls.list += 1;
        if (!catalog) throw new Error('catalog unavailable');
        return { items };
      },
      ...(rename ? {
        async rename(request) {
          calls.rename.push(request);
          const item = items.find(candidate => candidate.sessionId === request.sessionId);
          if (item) item.projections = { kind: 'sequenced', asOfSeq: 1, values: { title: request.title } };
          return { ok: true };
        },
      } : {}),
    },
    get: name => (name === 'workspaceController' && workspace
      ? {
        async create(request) {
          calls.workspace.push(request);
          state.path = request.path;
          // The shape DSH 0.11 actually answers; `legacy` keeps the old flat view readable.
          return legacy ? view() : { workspace: view(), created: true };
        },
      }
      : undefined),
  };
  return { ctx, records, calls, items, state };
}

function hint(records, sessionId = 'session-1') {
  records.set('proj123456', { projectId: 'proj123456', path: projectPath, sessionId });
}

test('a new project registers its folder as a Workspace and seats the conversation in it', async () => {
  const { ctx, calls, records, state } = fixture();
  const conversations = await openProjectConversations(ctx, { z });
  const sessionId = await conversations.resolve({ projectId: 'proj123456', path: projectPath });

  assert.equal(sessionId, 'session-1');
  assert.deepEqual(calls.workspace, [{ path: projectPath }, { path: projectPath }], 'create is idempotent, so the read-back reuses it');
  // workspaceId and cwd are exclusive: joining is what puts the Session in the
  // project's group instead of the ungrouped pile.
  assert.deepEqual(calls.create[0], { workspaceId: 'workspace-1', agentPreset: 'openfilm-video-editing' });
  assert.deepEqual(state.sessionIds, ['session-1'], 'the Host accounts the Session to the Workspace');
  assert.equal(calls.rename.length, 1);
  assert.equal(calls.rename[0].title, 'demo-film', 'the conversation is named after its project folder');
  assert.equal(records.get('proj123456').sessionId, 'session-1');
  assert.equal(conversations.grouping('proj123456'), 'seated');
});

test('the older flat Workspace view still groups the conversation', async () => {
  const { ctx, calls } = fixture({ legacy: true });
  const conversations = await openProjectConversations(ctx, { z });
  const sessionId = await conversations.resolve({ projectId: 'proj123456', path: projectPath });
  assert.equal(sessionId, 'session-1');
  assert.deepEqual(calls.create[0], { workspaceId: 'workspace-1', agentPreset: 'openfilm-video-editing' });
  assert.equal(conversations.grouping('proj123456'), 'seated');
});

test('reopening the same project reuses its conversation instead of making another', async () => {
  const { ctx, records, calls } = fixture({ items: [{ sessionId: 'session-1', cwd: projectPath, blank: false }], seated: ['session-1'] });
  hint(records);
  const conversations = await openProjectConversations(ctx, { z });
  assert.equal(await conversations.resolve({ projectId: 'proj123456', path: projectPath }), 'session-1');
  // The title is read from the Session's projections, so it is never overwritten.
  assert.equal(calls.rename.length, 1);
  const again = await conversations.resolve({ projectId: 'proj123456', path: projectPath });
  assert.equal(again, 'session-1');
  assert.equal(calls.create.length, 0, 'one project, one conversation');
  assert.equal(calls.rename.length, 1, 'a title the person chose is never overwritten');
  assert.equal(conversations.grouping('proj123456'), 'seated');
});

test('a cwd that differs only in case still counts as the same folder on Windows', { skip: process.platform !== 'win32' ? 'case-insensitive paths are a Windows fact' : false }, async () => {
  const { ctx, records, calls } = fixture({ items: [{ sessionId: 'session-1', cwd: projectPath.toUpperCase(), blank: false }], seated: ['session-1'] });
  hint(records);
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
  assert.equal(conversations.grouping('proj123456'), 'degraded');
});

test('a foreign Session with the same id but another folder is not adopted', async () => {
  const { ctx, records, calls } = fixture({ items: [{ sessionId: 'session-1', cwd: path.resolve('F:/Dev/Films/other'), blank: false }] });
  hint(records);
  const conversations = await openProjectConversations(ctx, { z });
  const sessionId = await conversations.resolve({ projectId: 'proj123456', path: projectPath });
  assert.equal(sessionId, 'session-2', 'a Session in another folder is never claimed, so a new one is made');
  assert.equal(calls.create.length, 1);
});

test('an empty ungrouped conversation is replaced by one that joins the Workspace', async () => {
  // The regression: the stored conversation exists but the Workspace does not
  // account it, which is exactly what the sidebar draws as 未分组. DSH has no
  // attach for an existing Session, so a blank one is left behind for a new,
  // seated conversation. The old Session is never deleted or renamed.
  const { ctx, records, calls, items } = fixture({ items: [{ sessionId: 'session-1', cwd: projectPath, blank: true }] });
  hint(records);
  const failures = [];
  const conversations = await openProjectConversations(ctx, { z, onFailure: (event, fields) => failures.push([event, fields]) });
  const sessionId = await conversations.resolve({ projectId: 'proj123456', path: projectPath });
  assert.equal(sessionId, 'session-2');
  assert.deepEqual(calls.create, [{ workspaceId: 'workspace-1', agentPreset: 'openfilm-video-editing' }]);
  assert.equal(records.get('proj123456').sessionId, 'session-2', 'the hint moves to the seated conversation');
  assert.ok(items.some(item => item.sessionId === 'session-1'), 'the previous Session still exists');
  assert.equal(conversations.grouping('proj123456'), 'seated');
  const rebindEvent = failures.find(([event]) => event === 'project-conversation-rebound');
  assert.deepEqual(rebindEvent?.[1], { from: 'session-1', to: 'session-2' });
});

test('a conversation with history is never swapped behind the person back', async () => {
  const { ctx, records, calls } = fixture({ items: [{ sessionId: 'session-1', cwd: projectPath, blank: false }] });
  hint(records);
  const failures = [];
  const conversations = await openProjectConversations(ctx, { z, onFailure: (event, fields) => failures.push([event, fields]) });
  const sessionId = await conversations.resolve({ projectId: 'proj123456', path: projectPath });
  assert.equal(sessionId, 'session-1');
  assert.equal(calls.create.length, 0);
  assert.equal(conversations.grouping('proj123456'), 'degraded');
  assert.deepEqual(failures.filter(([event, fields]) => event === 'workspace-join' && fields.step === 'verify'),
    [['workspace-join', { step: 'verify', ok: false, code: 'WORKSPACE_SESSION_UNGROUPED' }]]);
});

test('a workspace join the Host does not confirm is reported once, not retried forever', async () => {
  const { ctx, records, calls } = fixture({ seat: false });
  const conversations = await openProjectConversations(ctx, { z });
  await conversations.resolve({ projectId: 'proj123456', path: projectPath });
  assert.equal(conversations.grouping('proj123456'), 'degraded');
  const first = calls.create.length;
  assert.equal(first, 1);
  // Every later open keeps the same conversation: replacing it again would be a
  // loop against a Host that answers the same way.
  await conversations.resolve({ projectId: 'proj123456', path: projectPath });
  assert.equal(calls.create.length, first);
  assert.equal(records.get('proj123456').sessionId, 'session-1');
});

test('a conversation the catalog already groups needs no new Session', async () => {
  const { ctx, calls, records } = fixture({ items: [{ sessionId: 'session-1', cwd: projectPath, blank: false }], seated: ['session-1'] });
  hint(records);
  const conversations = await openProjectConversations(ctx, { z });
  await conversations.resolve({ projectId: 'proj123456', path: projectPath });
  assert.deepEqual(calls.create, [], 'membership is proven by the Workspace, not re-applied');
  assert.equal(conversations.grouping('proj123456'), 'seated');
});

test('an unreadable catalog keeps the saved conversation instead of duplicating it', async () => {
  const { ctx, records, calls } = fixture({ catalog: false });
  hint(records);
  const conversations = await openProjectConversations(ctx, { z });
  assert.equal(await conversations.resolve({ projectId: 'proj123456', path: projectPath }), 'session-1');
  assert.deepEqual(calls.create, []);
});

test('a Workspace create without an id falls back to a cwd Session and says so', async () => {
  const records = new Map();
  const calls = [];
  const ctx = {
    storageDomain: { async open() { return { table: () => ({ get: k => records.get(k), put: async (k, v) => records.set(k, v) }), close: async () => {} }; } },
    sessionController: {
      async create(request) { calls.push(request); return { sessionId: 'session-1' }; },
      async list() { return { items: [] }; },
    },
    get: name => (name === 'workspaceController' ? { async create() { return { created: false }; } } : undefined),
  };
  const failures = [];
  const conversations = await openProjectConversations(ctx, { z, onFailure: (event, fields) => failures.push([event, fields]) });
  await conversations.resolve({ projectId: 'proj123456', path: projectPath });
  assert.deepEqual(calls[0], { cwd: projectPath, agentPreset: 'openfilm-video-editing' });
  assert.deepEqual(failures[0], ['workspace-join', { step: 'create', ok: false, code: 'WORKSPACE_CREATE_NO_ID' }]);
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

test('a created conversation is handed to the Host so its default permission applies', async () => {
  // The default is full access, and it is applied while the Session is live:
  // after this point the Session is a normal one that DSH itself can change.
  const { ctx, records } = fixture();
  const created = [];
  const conversations = await openProjectConversations(ctx, { z, onCreated: async id => { created.push(id); } });
  const sessionId = await conversations.resolve({ projectId: 'proj123456', path: projectPath });
  assert.deepEqual(created, [sessionId]);
  assert.equal(records.get('proj123456').sessionId, sessionId);
});

test('a failing default-permission hook never blocks the conversation', async () => {
  const { ctx } = fixture();
  const failures = [];
  const conversations = await openProjectConversations(ctx, {
    z,
    onCreated: () => { throw new Error('permission service down'); },
    onFailure: event => failures.push(event),
  });
  assert.equal(await conversations.resolve({ projectId: 'proj123456', path: projectPath }), 'session-1');
  // The failure is reported (a Session on DSH's own preset still works) and the
  // conversation exists either way.
  assert.ok(failures.includes('permission-default'));
});

test('bindings() lists stored rows without creating or validating anything', async () => {
  const { ctx, records, calls } = fixture()
  records.set('proj123456', { projectId: 'proj123456', path: projectPath, sessionId: 'session-1' })
  records.set('proj654321', { projectId: 'proj654321', path: `${projectPath}-b`, sessionId: 'session-2' })
  const conversations = await openProjectConversations(ctx, { z })
  assert.deepEqual(conversations.bindings(), [
    { projectId: 'proj123456', path: projectPath, sessionId: 'session-1' },
    { projectId: 'proj654321', path: `${projectPath}-b`, sessionId: 'session-2' },
  ])
  assert.equal(calls.list, 0, 'reading the sidebar must not touch the session catalog')
  await conversations.close()
  assert.deepEqual(conversations.bindings(), [], 'a closed store reads as empty, never as a crash')
})
