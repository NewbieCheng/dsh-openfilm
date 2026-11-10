import { officialModelOptions } from './official-model-catalog.mjs';

const PROJECT_ID = /^[A-Za-z0-9_-]{6,40}$/;
const failure = () => Object.assign(new Error('OpenFilm chat request is invalid or unavailable'), { code: 'OFFICIAL_CHAT_UNAVAILABLE' });
const exact = (value, keys) => value && typeof value === 'object' && !Array.isArray(value) &&
  Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));

/** Host-only dispatcher. The caller must authenticate the peer and origin and
 * supply a store whose verifier checks each project against the active Studio.
 * This is not a network endpoint; it never accepts filesystem paths or session
 * identities from the caller. Errors are deliberately not serialized here.
 */
export function createOfficialChatRpc(store, agent) {
  if (!store || typeof store.load !== 'function' || typeof store.saveSessions !== 'function' || typeof store.saveTurn !== 'function') throw new TypeError('Official chat store is required');
  return async (channel, payload) => {
    try {
      if (!payload || typeof payload.projectId !== 'string' || !PROJECT_ID.test(payload.projectId)) throw failure();
      if (channel === 'chat:load' && exact(payload, ['projectId'])) return await store.load(payload.projectId);
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
        const revision = await store.saveSessions(payload.projectId, { sessions: payload.sessions, last: payload.last, expectedRevision: payload.expectedRevision });
        return { ok: true, revision };
      }
      if (channel === 'chat:save-turn' && exact(payload, ['projectId', 'turn', 'items', 'expectedRevision'])) {
        const revision = await store.saveTurn(payload.projectId, { turn: payload.turn, items: payload.items, expectedRevision: payload.expectedRevision });
        return { ok: true, revision };
      }
      throw failure();
    } catch {
      // Storage failures and user-controlled data must never expose a path,
      // upstream key, history or stack to the renderer.
      throw failure();
    }
  };
}
