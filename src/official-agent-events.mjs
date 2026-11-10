// Pure translation of the verified live assistant-text subset of session.follow.
// The follow frames themselves carry no session ID. The caller MUST attach the
// sessionId and turnId from the trusted subscription/active-turn binding, not
// from untrusted event data, and create a fresh state for each OpenFilm turn.
// This module does not inspect or guarantee secrecy of assistant-authored text;
// credential protection remains the responsibility of the source and caller.
// Snapshot/replay, durable messages, tool data and interaction events are not
// translated here: emitting them without their full lifecycle would be unsafe.
//
// Ordering is tolerated on purpose. A strict "start frame first, then exactly
// consecutive indexes" rule silently dropped every live chunk whenever the
// subscription began mid-attempt — the person then sat in front of a running
// model that appeared to be doing nothing. Chunks are de-duplicated by index
// instead of matched against a required prefix.

const nonempty = (value) => typeof value === 'string' && value.length > 0;
const ordinal = (value) => Number.isSafeInteger(value) && value >= 0;

// Thinking is shown as thought updates so a slow first token still looks alive.
const THOUGHT = new Set(['reasoning-delta', 'thinking-delta', 'thought-delta', 'reasoning', 'thinking']);

/** Create a per-turn value; no subscriptions, global state or side effects. */
export function createOfficialAgentEventState({ sessionId, turnId, turn, key }) {
  if (!nonempty(sessionId) || !nonempty(turnId) || !ordinal(turn) || !nonempty(key)) {
    throw new TypeError('A sessionId, turnId, numeric DSH turn and OpenFilm key are required');
  }
  return { sessionId, turnId, turn, key, revision: -1, attempt: null };
}

/**
 * Translate one frame from a trusted, already-bound follow subscription.
 * Returns a new state and zero or one OpenFilm localAgents.onEvent events.
 * `sessionId` and `turnId` are supplied by that subscription's owner; neither
 * is authenticated by the frame. A wrong binding must never call this function.
 */
export function translateOfficialAgentEvent(state, { sessionId, turnId, frame } = {}) {
  const unchanged = { state, events: [] };
  if (!state || sessionId !== state.sessionId || turnId !== state.turnId ||
      frame?.type !== 'assistant-stream' || !frame.frame || typeof frame.frame !== 'object') return unchanged;

  const part = frame.frame;
  if (part.type === 'start') {
    if (state.attempt && part.attemptId === state.attempt.id) return unchanged;
    if (part.turn !== state.turn || typeof part.attemptId !== 'string') return unchanged;
    return {
      state: { ...state, revision: ordinal(part.revision) ? part.revision : state.revision,
        attempt: { id: part.attemptId, nextIndex: ordinal(part.index) ? part.index : 0 } },
      events: [],
    };
  }

  if (part.type === 'end') {
    if (part.attemptId !== state.attempt?.id && state.attempt) return unchanged;
    return { state: { ...state, attempt: null }, events: [] };
  }
  if (part.type !== 'chunk' || typeof part.attemptId !== 'string') return unchanged;

  const chunk = part.chunk;
  if (!chunk || typeof chunk !== 'object') return unchanged;

  // Adopt an unobserved attempt rather than discarding its output.
  const attempt = state.attempt?.id === part.attemptId ? state.attempt : { id: part.attemptId, nextIndex: 0 };
  const index = ordinal(part.index) ? part.index : attempt.nextIndex;
  if (index < attempt.nextIndex) return unchanged; // already delivered
  const next = {
    ...state,
    revision: ordinal(part.revision) ? Math.max(state.revision, part.revision) : state.revision,
    attempt: { id: part.attemptId, nextIndex: index + 1 },
  };

  const text = typeof chunk.text === 'string' ? chunk.text
    : typeof chunk.delta === 'string' ? chunk.delta : '';
  if (!text) return { state: next, events: [] };
  const sessionUpdate = chunk.type === 'text-delta' ? 'agent_message_chunk'
    : THOUGHT.has(chunk.type) ? 'agent_thought_chunk' : null;
  if (!sessionUpdate) return { state: next, events: [] };
  return {
    state: next,
    events: [{ key: state.key, kind: 'update', update: { sessionUpdate, content: { type: 'text', text } } }],
  };
}
