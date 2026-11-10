import { randomUUID } from 'node:crypto';
import { createOfficialAgentEventState, translateOfficialAgentEvent } from './official-agent-events.mjs';

// Host-only adapter. verifier must authorize the caller and return the upstream
// canonical project path on every invocation. openProjectSessions is a single,
// already-open Host ownership registry, not a client-controlled factory.
// This adapter serializes its own sends, but cannot lock out other DSH clients.
// A conflicting durable user message stops output; previously emitted text
// cannot be retracted. Permissions, questions, attachments, history, replay and
// reconnection are not implemented. Do not expose this as a complete chat API.
const fail = (code, message) => Object.assign(new Error(message), { code });
const nonempty = value => typeof value === 'string' && value.trim().length > 0 && !value.includes('\0');
const ordinal = value => Number.isSafeInteger(value) && value >= 0;

export function createOfficialAgentService(ctx, { verifier, openProjectSessions, emit } = {}) {
  const controller = ctx?.sessionController;
  if (typeof verifier !== 'function' || typeof emit !== 'function' ||
      typeof openProjectSessions?.ensure !== 'function' ||
      ['modelCatalog', 'selectModel', 'prompt', 'follow', 'cancel'].some(name => typeof controller?.[name] !== 'function')) {
    throw fail('OFFICIAL_AGENT_DEPENDENCY', 'Trusted verifier, registry, emitter and session controller are required');
  }
  const active = new Map();
  // Following admission failure or conflict, the prompt may still be queued or
  // running. Never silently retry or attach a later call to that unknown turn.
  const uncertain = new Set();
  // One live stream per project, so cancel ends exactly the turn this bridge
  // started and never another caller's turn.
  const aborts = new Map();

  async function verify(projectId) {
    if (!nonempty(projectId)) throw fail('OFFICIAL_AGENT_INPUT', 'A project ID is required');
    const project = await verifier(projectId);
    if (!project || project.projectId !== projectId || !nonempty(project.path)) {
      throw fail('OFFICIAL_AGENT_PROJECT_UNVERIFIED', 'Project authorization or canonical path verification failed');
    }
    return { projectId, path: project.path };
  }
  async function sessionFor(projectId) {
    const project = await verify(projectId);
    // The registry owns pending/recovery; never replace or delete its records.
    const sessionId = await openProjectSessions.ensure(project);
    if (!nonempty(sessionId)) throw fail('OFFICIAL_AGENT_OWNERSHIP', 'Ownership registry returned no session ID');
    return sessionId;
  }
  function idleSnapshot(frame, sessionId) {
    if (frame?.type !== 'snapshot' || frame.header?.id !== sessionId || !Array.isArray(frame.records) ||
        !frame.assistantStream || frame.assistantStream.activeAttempt) return false;
    // A complete empty prefix or a latest turn/end proves no durable turn was
    // open at the snapshot cut. A truncated prefix without a boundary cannot.
    for (let i = frame.records.length - 1; i >= 0; i--) {
      const event = frame.records[i]?.event;
      if (event?.type === 'turn/start') return false;
      if (event?.type === 'turn/end') return true;
    }
    return frame.hasMore === false;
  }

  return Object.freeze({
    async ensureProject(projectId) { await sessionFor(projectId); },
    async modelCatalog(projectId) {
      await verify(projectId);
      return controller.modelCatalog();
    },
    async selectModel(projectId, selection) {
      if (active.has(projectId) || uncertain.has(projectId)) throw fail('OFFICIAL_AGENT_BUSY', 'Project turn is active or requires recovery');
      const reservation = {};
      active.set(projectId, reservation);
      try {
      const project = await verify(projectId);
      const { provider, model } = selection ?? {};
      if (!nonempty(provider) || !nonempty(model)) throw fail('OFFICIAL_AGENT_INPUT', 'A provider and model are required');
      const catalog = await controller.modelCatalog();
      const listed = Array.isArray(catalog?.groups) && catalog.groups.some(group => group?.id === provider &&
        Array.isArray(group.models) && group.models.some(item => item?.id === model));
      const isDefault = catalog?.default?.provider === provider && catalog.default.model === model;
      if (!listed && !isDefault) throw fail('OFFICIAL_AGENT_MODEL_UNAVAILABLE', 'Model is not in the Host catalog or its default');
      const sessionId = await openProjectSessions.ensure(project);
      if (!nonempty(sessionId)) throw fail('OFFICIAL_AGENT_OWNERSHIP', 'Ownership registry returned no session ID');
      // Host selectModel also saves the deployment default in the background.
      return await controller.selectModel({ sessionId, provider, model });
      } finally {
        if (active.get(projectId) === reservation) active.delete(projectId);
      }
    },

    // key and turnId identify OpenFilm state, never a DSH session. Callers may
    // add reference stills, but only as typed image parts.
    async send(projectId, { key, turnId, text, images } = {}) {
      if (!nonempty(key) || !nonempty(turnId) || !nonempty(text)) throw fail('OFFICIAL_AGENT_INPUT', 'A key, turn ID and text are required');
      const parts = [{ type: 'text', text }];
      if (images !== undefined) {
        if (!Array.isArray(images) || images.length > 4) throw fail('OFFICIAL_AGENT_INPUT', 'At most four reference images are allowed');
        for (const image of images) {
          const mediaType = image?.mediaType;
          if (!['image/jpeg', 'image/png', 'image/webp', 'image/gif'].includes(mediaType) || typeof image?.data !== 'string' ||
              image.data.length < 8 || image.data.length > 8 * 1024 * 1024 || !/^[A-Za-z0-9+/=]+$/.test(image.data)) {
            throw fail('OFFICIAL_AGENT_INPUT', 'A reference image is not a supported inline image');
          }
          parts.push({ type: 'image', mediaType, data: image.data, ...(nonempty(image.name) ? { name: String(image.name).slice(0, 120) } : {}) });
        }
      }
      if (active.has(projectId) || uncertain.has(projectId)) throw fail('OFFICIAL_AGENT_BUSY', 'Project turn is active or requires recovery');
      const operation = { admitted: false, matched: false, conflict: false };
      active.set(projectId, operation); // before the first await
      const abort = new AbortController();
      aborts.set(projectId, abort);
      let iterator;
      let pump;
      try {
        const sessionId = await sessionFor(projectId);
        // A freshly created Session may have no model yet. Adopt the Host's
        // configured default so the first message can run; a failure here keeps
        // whatever the Session already had and is reported by the prompt.
        try {
          const catalog = await controller.modelCatalog();
          const chosen = catalog?.default;
          if (nonempty(chosen?.provider) && nonempty(chosen?.model)) {
            await controller.selectModel({ sessionId, provider: chosen.provider, model: chosen.model });
          }
        } catch { /* the prompt below reports an unusable model */ }
        const requestId = randomUUID();
        const stream = controller.follow({ address: { kind: 'session', sessionId }, activate: true, assistantStream: true }, abort.signal);
        iterator = stream[Symbol.asyncIterator]();
        const opening = await iterator.next(); // follow is lazy; snapshot is the readiness barrier
        if (opening.done || !idleSnapshot(opening.value, sessionId)) throw fail('OFFICIAL_AGENT_BUSY', 'Session is running or its state cannot be established');
        let candidate;
        let state;
        let finished = false;
        let resolveEnd, rejectEnd;
        const end = new Promise((resolve, reject) => { resolveEnd = resolve; rejectEnd = reject; });
        // Attach a rejection handler immediately, including while prompt awaits.
        end.catch(() => {});
        pump = (async () => {
          try {
            while (!finished) {
              const next = await iterator.next();
              if (next.done) throw fail('OFFICIAL_AGENT_STREAM_LOST', 'Session stream ended before the turn completed');
              const frame = next.value;
              if (frame?.type === 'event') {
                const event = frame.event;
                if (event?.type === 'turn/start') {
                  if (!operation.admitted || candidate !== undefined || !ordinal(event.data?.turn)) throw fail('OFFICIAL_AGENT_CONFLICT', 'Unexpected concurrent turn');
                  candidate = event.data.turn;
                } else if (event?.type === 'user/message') {
                  const source = event.data?.source;
                  if (source?.kind === 'runtime-context') continue;
                  if (candidate === undefined || source?.kind !== 'user' || source.rpcId !== requestId || operation.matched) {
                    throw fail('OFFICIAL_AGENT_CONFLICT', 'Concurrent or unidentifiable session input');
                  }
                  operation.matched = true;
                  state = createOfficialAgentEventState({ sessionId, turnId, turn: candidate, key });
                } else if (event?.type === 'turn/end') {
                  if (!operation.matched || event.data?.turn !== candidate) throw fail('OFFICIAL_AGENT_CONFLICT', 'Unexpected turn end');
                  finished = true;
                  const reason = event.data?.reason?.kind;
                  if (reason === 'completed') resolveEnd({ ok: true, stopReason: 'end_turn' });
                  else rejectEnd(fail('OFFICIAL_AGENT_TURN_FAILED', `Turn ended without completion (${typeof reason === 'string' ? reason : 'unknown'})`));
                }
              } else if (frame?.type === 'assistant-stream') {
                if (!state) throw fail('OFFICIAL_AGENT_CONFLICT', 'Assistant stream arrived before prompt attribution');
                const result = translateOfficialAgentEvent(state, { sessionId, turnId, frame });
                if (result.state === state) throw fail('OFFICIAL_AGENT_STREAM_INVALID', 'Assistant stream lost turn or attempt continuity');
                state = result.state;
                for (const event of result.events) {
                  // Delivery is best effort: the live view may be reconnecting or
                  // closed. A missed delta must not abort a running turn, or one
                  // refresh would kill the conversation. Durable history is the
                  // chat store's job, not the stream's.
                  try { await emit(projectId, event); } catch { /* no live view */ }
                }
              } else throw fail('OFFICIAL_AGENT_STREAM_INVALID', 'Unexpected session stream frame');
            }
          } catch (error) {
            operation.conflict = true;
            rejectEnd(error);
          }
        })();
        // The stream loop and all attribution state exist before admission.
        if (operation.conflict) throw fail('OFFICIAL_AGENT_CONFLICT', 'Session changed before prompt admission');
        operation.admitted = true; // outcome can be uncertain even if prompt rejects
        const receipt = await controller.prompt({ requestId, sessionId, mode: 'queue', content: parts }, abort.signal);
        if (receipt?.accepted !== true) throw fail('OFFICIAL_AGENT_ADMISSION', 'Prompt admission was not confirmed');
        return await end;
      } catch (error) {
        // Only a turn that actually started can leave this project's state
        // unknown. A rejected prompt (busy session, unusable model, refused
        // admission) never ran a turn, so locking the project forever would
        // make one bad message block every later attempt.
        if (operation.matched) uncertain.add(projectId);
        throw error;
      } finally {
        abort.abort();
        if (aborts.get(projectId) === abort) aborts.delete(projectId);
        if (iterator?.return) { try { await iterator.return(); } catch { /* stream already failed */ } }
        if (pump) await pump;
        if (active.get(projectId) === operation) active.delete(projectId);
      }
    },
    async cancel(projectId) {
      await verify(projectId);
      const abort = aborts.get(projectId);
      // Only a turn this bridge is running can be stopped: the Host cancel is
      // session-wide and could end a turn that started elsewhere.
      if (!abort) throw fail('OFFICIAL_AGENT_NOT_RUNNING', 'No turn from this window is running');
      abort.abort();
      uncertain.add(projectId);
      return { ok: true };
    },
  });
}
