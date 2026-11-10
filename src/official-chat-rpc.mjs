import { officialModelOptions } from './official-model-catalog.mjs';

const PROJECT_ID = /^[A-Za-z0-9_-]{6,40}$/;
const failure = () => Object.assign(new Error('OpenFilm chat request is invalid or unavailable'), { code: 'OFFICIAL_CHAT_UNAVAILABLE' });
// A deliberate, user-actionable state. It carries no path, credential or history,
// so it is the one error this dispatcher may relay instead of the fixed message.
const archivedFailure = () => Object.assign(new Error('This conversation is archived. Restore it in DSH or the video panel before continuing.'), { code: 'OFFICIAL_CHAT_ARCHIVED' });
const exact = (value, keys) => value && typeof value === 'object' && !Array.isArray(value) &&
  Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));

/** Host-only dispatcher. The caller must authenticate the peer and origin and
 * supply a store whose verifier checks each project against the active Studio.
 * This is not a network endpoint; it never accepts filesystem paths or session
 * identities from the caller. Errors are deliberately not serialized here.
 *
 * Archive state comes from the Host's single Workspace-view subscription
 * (`options.state`), never from renderer input: an archived project's history
 * is withheld and its writes are refused, but nothing is deleted.
 */
export function createOfficialChatRpc(store, agent, options = {}) {
  if (!store || typeof store.load !== 'function' || typeof store.saveSessions !== 'function' || typeof store.saveTurn !== 'function') throw new TypeError('Official chat store is required');
  const state = typeof options.state === 'function' ? options.state : null;
  const archive = typeof options.archive === 'function' ? options.archive : null;
  const unarchive = typeof options.unarchive === 'function' ? options.unarchive : null;
  const inspect = async projectId => {
    if (!state) return { archived: false, available: false };
    const value = await state(projectId);
    if (!value || typeof value !== 'object') throw failure();
    return { archived: value.archived === true, available: value.available !== false, ...(typeof value.sessionId === 'string' ? { sessionId: value.sessionId } : {}) };
  };
  return async (channel, payload) => {
    try {
      if (!payload || typeof payload.projectId !== 'string' || !PROJECT_ID.test(payload.projectId)) throw failure();
      if (channel === 'chat:archive-state' && exact(payload, ['projectId'])) return await inspect(payload.projectId);
      if (channel === 'chat:load' && exact(payload, ['projectId'])) {
        const loaded = await store.load(payload.projectId);
        const current = await inspect(payload.projectId);
        // An archived conversation disappears from the surface, but the stored
        // record is untouched: restoring returns exactly what was there.
        return current.archived
          ? { sessions: [], last: null, turns: [], revision: loaded.revision, archived: true }
          : { ...loaded, archived: false };
      }
      if (channel === 'chat:archive' && exact(payload, ['projectId'])) {
        if (!archive) throw failure();
        await archive(payload.projectId);
        return await inspect(payload.projectId);
      }
      if (channel === 'chat:unarchive' && exact(payload, ['projectId'])) {
        if (!unarchive) throw failure();
        await unarchive(payload.projectId);
        return await inspect(payload.projectId);
      }
      if (channel === 'agent:models' && exact(payload, ['projectId']) && typeof agent?.modelCatalog === 'function') {
        return officialModelOptions(await agent.modelCatalog(payload.projectId)).option;
      }
      if (channel === 'agent:select-model' && exact(payload, ['projectId', 'value']) &&
          typeof payload.value === 'string' && typeof agent?.modelCatalog === 'function' && typeof agent?.selectModel === 'function') {
        const { choices } = officialModelOptions(await agent.modelCatalog(payload.projectId));
        const choice = choices.get(payload.value);
        if (!choice) throw failure();
        await agent.selectModel(payload.projectId, choice);
        return { ok: true };
      }
      if (channel === 'chat:save-sessions' && exact(payload, ['projectId', 'sessions', 'last', 'expectedRevision'])) {
        if ((await inspect(payload.projectId)).archived) throw archivedFailure();
        const revision = await store.saveSessions(payload.projectId, { sessions: payload.sessions, last: payload.last, expectedRevision: payload.expectedRevision });
        return { ok: true, revision };
      }
      if (channel === 'chat:save-turn' && exact(payload, ['projectId', 'turn', 'items', 'expectedRevision'])) {
        if ((await inspect(payload.projectId)).archived) throw archivedFailure();
        const revision = await store.saveTurn(payload.projectId, { turn: payload.turn, items: payload.items, expectedRevision: payload.expectedRevision });
        return { ok: true, revision };
      }
      throw failure();
    } catch (error) {
      // Storage failures and user-controlled data must never expose a path,
      // upstream key, history or stack to the renderer.
      if (error?.code === 'OFFICIAL_CHAT_ARCHIVED') throw error;
      throw failure();
    }
  };
}
