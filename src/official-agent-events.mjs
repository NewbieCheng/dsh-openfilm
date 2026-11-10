// Pure translation of the verified live assistant-text subset of session.follow.
// The follow frames themselves carry no session ID. The caller MUST attach the
// sessionId and turnId from the trusted subscription/active-turn binding, not
// from untrusted event data, and create a fresh state for each OpenFilm turn.
// This module does not inspect or guarantee secrecy of assistant-authored text;
// credential protection remains the responsibility of the source and caller.
// Snapshot/replay, durable messages, tool data and interaction events are not
// translated here: emitting them without their full lifecycle would be unsafe.

const nonempty = (value) => typeof value === 'string' && value.length > 0;
const ordinal = (value) => Number.isSafeInteger(value) && value >= 0;

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
 * Only attempts whose start was observed are accepted; snapshots are ignored.
 */
export function translateOfficialAgentEvent(state, { sessionId, turnId, frame } = {}) {
  const unchanged = { state, events: [] };
  if (!state || sessionId !== state.sessionId || turnId !== state.turnId ||
      frame?.type !== 'assistant-stream' || !frame.frame || typeof frame.frame !== 'object') return unchanged;

  const part = frame.frame;
  if (part.type === 'start') {
    if (state.attempt || part.turn !== state.turn || !ordinal(part.step) ||
        !nonempty(part.attemptId) || !ordinal(part.revision) || part.revision <= state.revision) return unchanged;
    return { state: { ...state, revision: part.revision, attempt: { id: part.attemptId, nextIndex: 0, revision: part.revision } }, events: [] };
  }

  const attempt = state.attempt;
  if (!attempt || part.attemptId !== attempt.id || !ordinal(part.revision) ||
      part.revision <= attempt.revision || !ordinal(part.index) || part.index !== attempt.nextIndex) return unchanged;

  if (part.type === 'end') {
    return { state: { ...state, revision: part.revision, attempt: null }, events: [] };
  }
  if (part.type !== 'chunk') return unchanged;

  const next = { ...state, revision: part.revision, attempt: { ...attempt, nextIndex: attempt.nextIndex + 1, revision: part.revision } };
  const chunk = part.chunk;
  if (!chunk || typeof chunk !== 'object' || chunk.type !== 'text-delta' ||
      !ordinal(chunk.index) || typeof chunk.text !== 'string' || chunk.text.length === 0) {
    return { state: next, events: [] };
  }
  return {
    state: next,
    events: [{ key: state.key, kind: 'update', update: {
      sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: chunk.text },
    } }],
  };
}
