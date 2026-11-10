import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { openProjectSessions } from '../src/project-sessions.mjs';
import { openProjectConversations } from '../src/project-conversation.mjs';

const chain = () => ({ min: chain, regex: chain, strict: chain });
const z = { object: chain, string: chain, literal: chain, discriminatedUnion: chain };
const project = { projectId: 'film123', path: path.resolve('film') };
function fixture() {
  const table = new Map();
  table.put = async (key, value) => table.set(key, value);
  const creates = [];
  const ctx = {
    storageDomain: { async open() { return { table: () => table, close: async () => {} }; } },
    sessionController: { async create(request) { creates.push(request); throw new Error('preset unavailable'); }, async list() { throw new Error('unavailable'); } },
  };
  return { table, ctx, creates };
}

test('existing durable session binding is returned without preset migration', async () => {
  const { table, ctx, creates } = fixture();
  const key = createHash('sha256').update(project.projectId, 'utf8').digest('hex');
  table.set(key, { state: 'bound', ...project, sessionId: 'old-session' });
  const sessions = await openProjectSessions(ctx, { z });
  assert.equal(await sessions.ensure(project), 'old-session');
  assert.deepEqual(creates, []);
  await sessions.close();
});

test('failed creation does not silently fall back to the default preset', async () => {
  const { ctx, creates } = fixture();
  const conversations = await openProjectConversations(ctx, { z });
  await assert.rejects(conversations.resolve(project), { code: 'PROJECT_CONVERSATION_CREATE' });
  assert.deepEqual(creates, [{ cwd: project.path, agentPreset: 'openfilm-video-editing' }]);
  await conversations.close();
});

test('unreadable session catalog does not replace the saved old conversation', async () => {
  const { ctx, table, creates } = fixture();
  table.set(project.projectId, { ...project, sessionId: 'old-session' });
  const conversations = await openProjectConversations(ctx, { z });
  assert.equal(await conversations.resolve(project), 'old-session');
  assert.deepEqual(creates, []);
  await conversations.close();
});

test('an archived binding is kept, reported, and never silently replaced', async () => {
  const { ctx, table, creates } = fixture();
  ctx.sessionController.list = async () => ({ items: [{ sessionId: 'old-session', cwd: project.path, agentAvailable: true }] });
  table.set(project.projectId, { ...project, sessionId: 'old-session' });
  const conversations = await openProjectConversations(ctx, { z, archived: id => id === 'old-session' });
  // The Session still exists; only its visibility changed, so it must not be
  // swapped for a fresh conversation behind the person's back.
  assert.equal(await conversations.resolve(project), 'old-session');
  assert.deepEqual(creates, []);
  assert.equal(conversations.boundConversation('old-session').archived, true);
  assert.equal(conversations.peek(project.projectId).sessionId, 'old-session');
  // Peeking is a read: it creates nothing and does not need the catalog.
  ctx.sessionController.create = async () => { throw new Error('should not create'); };
  assert.equal(conversations.peek(project.projectId).sessionId, 'old-session');
  await conversations.close();
});
