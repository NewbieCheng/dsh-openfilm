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
  // A turn's own log, as the panel's trace tab reads it. Absent when the Host
  // keeps no such record: the channel then stays refused, as before.
  const turnLog = typeof options.turnLog === 'function' ? options.turnLog : null;
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
      // The panel's trace tab asks for a turn's log: one event per line, with what
      // the turn called. Without this the tab exists but can never show anything.
      if (channel === 'chat:log' && exact(payload, ['projectId', 'turnId'])) {
        if (!turnLog) throw failure();
        if (typeof payload.turnId !== 'string' || !payload.turnId || payload.turnId.length > 120) throw failure();
        const log = await turnLog(payload.projectId, payload.turnId);
        if (log === null || log === undefined) return null;
        if (typeof log !== 'object' || !Array.isArray(log.events)) throw failure();
        return log;
      }
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
      // Thinking intensity: the option for the project's current model, and the
      // person's choice. Both are validated against the live catalog in the
      // Host; the page only names a value it was shown.
      //
      // The option list is a convenience — a menu that can also offer "auto" — so
      // a failure here must never fail the panel that asked for it. It used to
      // throw, the catch below turned that into OFFICIAL_CHAT_UNAVAILABLE, and the
      // person saw a red 503 toast for a menu nobody opened. Degrading to null
      // keeps the reason in the log and the panel usable.
      if (channel === 'agent:thinking' && exact(payload, ['projectId'])) {
        if (typeof agent?.thinkingOption !== 'function') return null;
        try {
          return await agent.thinkingOption(payload.projectId);
        } catch (error) {
          const reason = String(error?.code ?? error?.message ?? error).slice(0, 120);
          if (typeof options.log === 'function') options.log('agent-thinking-unavailable', { reason });
          return null;
        }
      }

      if (channel === 'agent:select-thinking' && exact(payload, ['projectId', 'value']) &&
          typeof payload.value === 'string' && typeof agent?.selectThinking === 'function') {
        return await agent.selectThinking(payload.projectId, payload.value);
      }
      // One-shot permission answer from the panel. The Host resolves the owning
      // DSH agent from its own pending record; the page only names the question.
      if (channel === 'agent:answer-permission' && exact(payload, ['projectId', 'key', 'requestId', 'optionId']) &&
          typeof payload.key === 'string' && typeof payload.requestId === 'string' &&
          ['allow-once', 'reject-once'].includes(payload.optionId) &&
          typeof agent?.answerPermission === 'function') {
        return await agent.answerPermission(payload.projectId, { key: payload.key, requestId: payload.requestId, optionId: payload.optionId });
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
      // Our own codes name the cause without carrying a path or a stack, so they
      // are kept: collapsing them into OFFICIAL_CHAT_UNAVAILABLE is what made a
      // 503 unreadable in the first place.
      if (typeof error?.code === 'string' && /^OFFICIAL_(AGENT|CHAT)_[A-Z][A-Z_]{2,40}$/.test(error.code) &&
          error.code !== 'OFFICIAL_CHAT_UNAVAILABLE') {
        throw Object.assign(new Error(error.code), { code: error.code });
      }
      throw failure();
    }
  };
}
