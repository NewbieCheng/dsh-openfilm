import { randomUUID } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createOfficialAgentEventState, translateOfficialAgentEvent, translateSessionEvent } from './official-agent-events.mjs';

// Host-only adapter. verifier must authorize the caller and return the upstream
// canonical project path on every invocation. openProjectSessions is a single,
// already-open Host ownership registry, not a client-controlled factory.
// This adapter serializes its own sends, but cannot lock out other DSH clients.
// A conflicting durable user message stops output; previously emitted text
// cannot be retracted. Permissions, questions, attachments, history, replay and
// reconnection are not implemented. Do not expose this as a complete chat API.
const fail = (code, message) => Object.assign(new Error(message), { code });
const nonempty = value => typeof value === 'string' && value.trim().length > 0 && !value.includes('\\0');
const ordinal = value => Number.isSafeInteger(value) && value >= 0;

/** Clamp a frame for the diagnostic trace while keeping it valid JSON. */
function clampTrace(value, depth = 0) {
  if (typeof value === 'string') return value.length > 200 ? `${value.slice(0, 200)}…` : value;
  if (depth > 6) return '[deep]';
  if (Array.isArray(value)) return value.slice(0, 40).map(item => clampTrace(item, depth + 1));
  if (value && typeof value === 'object') {
    const copy = {};
    for (const [key, item] of Object.entries(value).slice(0, 40)) copy[key] = clampTrace(item, depth + 1);
    return copy;
  }
  return value;
}

// Only fixed categories are sent to the page. Raw provider messages, codes and
// request IDs can contain private data and must remain in the owning DSH session.
function turnFailureMessage(reason, { archived = false } = {}) {
  if (reason?.kind === 'blocked') {
    // DSH's pre-step gate reads the durable archive set, so a blocked turn on an
    // archived Session is the expected shape rather than a defect. Say which.
    return archived
      ? 'Turn ended without completion (blocked): this conversation is archived. Restore it in DSH or the video panel before sending again.'
      : 'Turn ended without completion (blocked): the session was stopped before inference (policy or archive gate)';
  }
  if (reason?.kind === 'error') {
    const status = reason.error?.status;
    const category = status === 401 ? '模型认证失败，请检查登录或凭据' :
      status === 403 ? '模型访问被拒绝，请检查权限' :
      status === 429 ? '模型请求受到限流，请稍后重试' :
      Number.isInteger(status) && status >= 500 && status <= 599 ? '模型服务暂时不可用' :
      Number.isInteger(status) && status >= 400 && status <= 499 ? '模型服务拒绝了请求' : '模型调用失败，请检查 DSH 会话详情';
    return `Turn ended without completion (error): ${category}`;
  }
  const kind = ['aborted', 'max-tokens', 'interrupted', 'forked'].includes(reason?.kind) ? reason.kind : 'unknown';
  return `Turn ended without completion (${kind})`;
}

export function createOfficialAgentService(ctx, { verifier, openProjectSessions, emit, isArchived } = {}) {
  const controller = ctx?.sessionController;
  if (typeof verifier !== 'function' || typeof emit !== 'function' ||
      typeof openProjectSessions?.ensure !== 'function' ||
      ['modelCatalog', 'selectModel', 'prompt', 'follow', 'cancel'].some(name => typeof controller?.[name] !== 'function')) {
    throw fail('OFFICIAL_AGENT_DEPENDENCY', 'Trusted verifier, registry, emitter and session controller are required');
  }
  // Archive state is optional: without it the bridge still works and DSH's own
  // gate decides; it must never be faked into "not archived".
  const archived = typeof isArchived === 'function' ? isArchived : () => false;
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
    // Sending into an archived Session is guaranteed to end `blocked`; refuse it
    // with an actionable reason instead of letting the turn collapse.
    if (archived(sessionId) === true) {
      throw fail('OFFICIAL_AGENT_CONVERSATION_ARCHIVED', 'This conversation is archived; restore it before sending');
    }
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
      const operation = { admitted: false, rejected: false, matched: false, sawPrompt: false, conflict: false, finished: false, blocked: false, sessionId: undefined, cancelRequested: false };
      const trace = [];
      active.set(projectId, operation); // before the first await
      const abort = new AbortController();
      aborts.set(projectId, abort);
      let iterator;
      let pump;
      try {
        const sessionId = await sessionFor(projectId);
        operation.sessionId = sessionId;
        // Preserve the Session's existing model selection. Selecting the Host
        // default here would overwrite an explicit choice on every message.
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
        // Attribution may arrive from either recorded shape: `user/message`
        // carries the prompt source directly, while a live prompt first appears
        // in `agent/inbox/spliced`. Requiring only `user/message` is what turned
        // a gated (blocked) turn into a bogus protocol conflict.
        const attribute = () => {
          if (operation.matched || candidate === undefined) return;
          operation.matched = true;
          if (!state) state = createOfficialAgentEventState({ sessionId, turnId, turn: candidate, key });
        };
        const finish = async result => {
          operation.finished = true;
          finished = true;
          if (await emit(projectId, { key, kind: 'done', turnId, ...result }) === false) throw fail('OFFICIAL_AGENT_STREAM_LOST', 'No live event stream accepted the terminal event');
          resolveEnd(result);
        };
        pump = (async () => {
          try {
            while (!finished) {
              const next = await iterator.next();
              if (next.done) throw fail('OFFICIAL_AGENT_STREAM_LOST', 'Session stream ended before the turn completed');
              const frame = next.value;
              // Temporary trace: the live frame shapes are not documented anywhere
              // reachable, and guessing them is how thinking and tool output went
              // missing. One file, overwritten per send, strings clamped so every
              // line stays parseable JSON (mid-line slicing made forensics manual).
              try { trace.push(JSON.stringify(clampTrace(frame))); } catch { /* unserializable frame */ }
              if (frame?.type === 'event') {
                const event = frame.event;
                if (event?.type === 'turn/start') {
                  if (!operation.admitted || candidate !== undefined || !ordinal(event.data?.turn)) throw fail('OFFICIAL_AGENT_CONFLICT', 'Unexpected concurrent turn');
                  candidate = event.data.turn;
                  if (operation.sawPrompt) attribute();
                } else if (event?.type === 'user/message') {
                  const source = event.data?.source;
                  // Only a *human* input can be a competing prompt. Prompt
                  // assembly records its own user-role messages here too
                  // (`agent-instructions` for AGENTS.md, `runtime-context`, …);
                  // treating those as foreign input failed every turn on this
                  // machine, where the workspace instruction block is injected
                  // right after the person's message.
                  if (source?.kind === 'user') {
                    // Our own prompt can be recorded twice (queued splice, then
                    // the durable message): attributing it again is correct, not
                    // a conflict. Any other human input during this turn is.
                    if (source.rpcId === requestId) {
                      operation.sawPrompt = true;
                      attribute();
                    } else {
                      throw fail('OFFICIAL_AGENT_CONFLICT', 'Concurrent or unidentifiable session input');
                    }
                  }
                } else if (event?.type === 'agent/inbox/spliced') {
                  // Admission-only notice: the prompt is queued for the next turn
                  // before turn/start exists. Identify it by our own request ID.
                  const inserted = Array.isArray(event.data?.inserted) ? event.data.inserted : [];
                  if (inserted.some(item => item?.source?.kind === 'user' && item.source.rpcId === requestId)) {
                    operation.sawPrompt = true;
                    attribute();
                  }
                } else if (event?.type === 'turn/end') {
                  const reason = event.data?.reason;
                  if (candidate === undefined || event.data?.turn !== candidate) throw fail('OFFICIAL_AGENT_CONFLICT', 'Unexpected turn end');
                  const kind = reason?.kind;
                  // A gated turn never reaches this bridge's attribution; that is a
                  // terminal outcome, not a conflict. Only an unattributed turn with
                  // any other reason is genuinely foreign.
                  if (!operation.matched && kind !== 'blocked') throw fail('OFFICIAL_AGENT_CONFLICT', 'Unattributed turn ended');
                  const result = kind === 'completed' ? { ok: true, stopReason: 'end_turn' }
                    : kind === 'aborted' && operation.cancelRequested && reason?.reason?.kind === 'user'
                      ? { ok: true, stopReason: 'cancelled' }
                      : { ok: false, error: turnFailureMessage(reason, { archived: archived(sessionId) === true }) };
                  operation.blocked = kind === 'blocked';
                  await finish(result);
                } else if (event?.type === 'tool/call' || event?.type === 'tool/result' || event?.type === 'assistant/message') {
                  // Durable lifecycle of the same turn. Ignore anything belonging
                  // to another turn; adoption of a late state is not allowed.
                  if (candidate === undefined || event.data?.turn !== candidate) continue;
                  if (!state && operation.sawPrompt) attribute();
                  if (!state) continue;
                  const result = translateSessionEvent(state, { sessionId, turnId, event });
                  state = result.state;
                  for (const eventUpdate of result.events) {
                    if (await emit(projectId, eventUpdate) === false) throw fail('OFFICIAL_AGENT_STREAM_LOST', 'No live event stream accepted the update');
                  }
                }
              } else if (frame?.type === 'assistant-stream') {
                if (!state) throw fail('OFFICIAL_AGENT_CONFLICT', 'Assistant stream arrived before prompt attribution');
                const result = translateOfficialAgentEvent(state, { sessionId, turnId, frame });
                // An unchanged state is normal: duplicate indexes, `start` for an
                // attempt already running, and chunk kinds we do not translate all
                // return it. Treating those as fatal failed every live turn.
                state = result.state;
                for (const event of result.events) {
                  // Refuse to report success if the transport cannot accept a frame.
                  // Acceptance is not browser acknowledgement or durable replay.
                  if (await emit(projectId, event) === false) throw fail('OFFICIAL_AGENT_STREAM_LOST', 'No live event stream accepted the update');
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
        const receipt = await Promise.race([
          controller.prompt({ requestId, sessionId, mode: 'queue', content: parts }, abort.signal),
          end.then(() => new Promise(() => {})), // propagate stream errors while admission is pending
        ]);
        if (receipt?.accepted !== true) {
          operation.rejected = receipt?.accepted === false;
          throw fail('OFFICIAL_AGENT_ADMISSION', 'Prompt admission was not confirmed');
        }
        return await end;
      } catch (error) {
        // The page only ever sees a code. Record the bridge's own reason next to
        // the frames so the next failure needs no guessing.
        try { trace.push(JSON.stringify({ bridgeError: { code: String(error?.code || 'UNKNOWN'), message: String(error?.message || error).slice(0, 200) } })); } catch { /* diagnostics only */ }
        // An invoked prompt can have been accepted even if its receipt was lost.
        // Only an explicit rejection or a verified terminal settles that doubt.
        if (operation.admitted && (!operation.rejected || operation.matched) && !operation.finished) {
          // A gated turn is terminal and left no output: it is not uncertain.
          if (operation.blocked) throw fail('OFFICIAL_AGENT_BLOCKED', `${error?.message || String(error)} (the session was blocked before inference)`);
          // Only a turn that actually entered the session is uncertain: `matched`
          // is set when this exact prompt's user message is observed. Without it
          // nothing ran, so a permanent lock would just break the project — this
          // is the "no model selected" path that made every first message 503.
          if (operation.matched) {
            uncertain.add(projectId);
            throw fail('OFFICIAL_AGENT_OUTCOME_UNKNOWN', `${error?.message || String(error)} (admission or turn outcome unknown; do not retry without recovery)`);
          }
          throw fail('OFFICIAL_AGENT_NOT_STARTED', `${error?.message || String(error)}`);
        }
        throw error;
      } finally {
        try { await writeFile(join(tmpdir(), 'dsh-openfilm-frames.jsonl'), trace.join('\n'), 'utf8'); } catch { /* diagnostics only */ }
        abort.abort();
        if (aborts.get(projectId) === abort) aborts.delete(projectId);
        if (iterator?.return) { try { await iterator.return(); } catch { /* stream already failed */ } }
        if (pump) await pump;
        if (active.get(projectId) === operation) active.delete(projectId);
      }
    },
    async cancel(projectId) {
      await verify(projectId);
      const operation = active.get(projectId);
      // cancel is session-wide: do not cancel before attribution or after a
      // terminal event, when the active turn could belong to another client.
      if (!operation?.matched || operation.finished || operation.conflict || operation.cancelRequested || !operation.sessionId) {
        throw fail('OFFICIAL_AGENT_NOT_RUNNING', 'No attributable turn from this window is running');
      }
      operation.cancelRequested = true;
      try {
        const receipt = await controller.cancel({ sessionId: operation.sessionId });
        if (receipt?.accepted !== true) throw fail('OFFICIAL_AGENT_CANCEL_FAILED', 'Cancellation was not confirmed');
        // Keep following until turn/end; an acknowledgement is not completion.
        return { ok: true };
      } catch (error) {
        operation.cancelRequested = false;
        throw error;
      }
    },
  });
}
