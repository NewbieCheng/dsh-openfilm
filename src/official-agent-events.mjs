// Pure translation of one bound DSH Session into the official shell's ACP-style
// session updates.
//
// Two sources are translated, and they are not interchangeable:
//   * `assistant-stream` frames — live, incremental, no durable identity.
//   * durable events (`tool/call`, `tool/result`, `assistant/message`) — emitted
//     once per step and carrying the tool lifecycle the stream never exposes.
// Text that already streamed must not be repeated from the durable copy, so the
// state tracks which steps streamed which kind.
//
// The follow frames themselves carry no session ID. The caller MUST attach the
// sessionId and turnId from the trusted subscription/active-turn binding, not
// from untrusted event data, and create a fresh state for each OpenFilm turn.
// This module does not inspect or guarantee secrecy of assistant-authored text;
// credential protection remains the responsibility of the source and caller.
//
// Ordering is tolerated on purpose. A strict "start frame first, then exactly
// consecutive indexes" rule silently dropped every live chunk whenever the
// subscription began mid-attempt — the person then sat in front of a running
// model that appeared to be doing nothing. Chunks are de-duplicated by index
// instead of matched against a required prefix.

const TEXT_MAX = 8000;
const INPUT_MAX = 4000;
const nonempty = (value) => typeof value === 'string' && value.length > 0;
const ordinal = (value) => Number.isSafeInteger(value) && value >= 0;

// Thinking is shown as thought updates so a slow first token still looks alive.
// `reasoning-delta` is the name the harness actually emits.
const THOUGHT = new Set(['reasoning-delta', 'thinking-delta', 'thought-delta', 'reasoning', 'thinking']);

const clip = (value, max) => (typeof value === 'string' ? value.slice(0, max) : '');

function update(key, sessionUpdate, extra) {
  return { key, kind: 'update', update: { sessionUpdate, ...extra } };
}

/** Mark a step as streamed so its durable copy is not emitted twice. */
function withStep(list, step) {
  if (!ordinal(step) || list.includes(step)) return list;
  return [...list, step];
}

function textOf(content, type) {
  if (!Array.isArray(content)) return '';
  return content.filter(block => block?.type === type && typeof block.text === 'string').map(block => block.text).join('');
}

function toolCallEvent(state, { callId, name, input }) {
  if (typeof callId !== 'string' || !callId || state.tools[callId]) return { state, events: [] };
  const title = nonempty(name) ? clip(name, 120) : 'tool';
  const rawInput = typeof input === 'string' ? clip(input, INPUT_MAX) : undefined;
  return {
    state: { ...state, tools: { ...state.tools, [callId]: { title, done: false } } },
    events: [update(state.key, 'tool_call', {
      toolCallId: callId, title, kind: 'other', status: 'in_progress',
      ...(rawInput !== undefined ? { rawInput } : {}),
    })],
  };
}

/** Create a per-turn value; no subscriptions, global state or side effects. */
export function createOfficialAgentEventState({ sessionId, turnId, turn, key }) {
  if (!nonempty(sessionId) || !nonempty(turnId) || !ordinal(turn) || !nonempty(key)) {
    throw new TypeError('A sessionId, turnId, numeric DSH turn and OpenFilm key are required');
  }
  return { sessionId, turnId, turn, key, revision: -1, attempt: null, tools: {}, textSteps: [], thoughtSteps: [] };
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
        attempt: { id: part.attemptId, nextIndex: ordinal(part.index) ? part.index : 0, step: ordinal(part.step) ? part.step : null } },
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
  const attempt = state.attempt?.id === part.attemptId ? state.attempt : { id: part.attemptId, nextIndex: 0, step: null };
  const index = ordinal(part.index) ? part.index : attempt.nextIndex;
  if (index < attempt.nextIndex) return unchanged; // already delivered
  const next = {
    ...state,
    revision: ordinal(part.revision) ? Math.max(state.revision, part.revision) : state.revision,
    attempt: { id: part.attemptId, nextIndex: index + 1, step: attempt.step ?? null },
  };

  const text = typeof chunk.text === 'string' ? chunk.text
    : typeof chunk.delta === 'string' ? chunk.delta : '';
  if (!text) return { state: next, events: [] };
  const sessionUpdate = chunk.type === 'text-delta' ? 'agent_message_chunk'
    : THOUGHT.has(chunk.type) ? 'agent_thought_chunk' : null;
  if (!sessionUpdate) return { state: next, events: [] };
  // Remember the step so the durable `assistant/message` copy stays silent.
  const streamed = sessionUpdate === 'agent_message_chunk'
    ? { ...next, textSteps: withStep(next.textSteps, next.attempt.step) }
    : { ...next, thoughtSteps: withStep(next.thoughtSteps, next.attempt.step) };
  return {
    state: streamed,
    events: [update(state.key, sessionUpdate, { content: { type: 'text', text: clip(text, TEXT_MAX) } })],
  };
}

/**
 * Translate one durable Session event of the current turn.
 *
 * `tool/call` and `tool/result` are the only complete tool lifecycle DSH
 * publishes; `assistant/message` carries the committed thinking/text blocks and
 * any tool call the stream did not report. Everything is scoped to
 * `state.turn`: a late result from an earlier turn must never appear in this
 * turn's transcript.
 */
export function translateSessionEvent(state, { sessionId, turnId, event } = {}) {
  const unchanged = { state, events: [] };
  if (!state || sessionId !== state.sessionId || turnId !== state.turnId || !event || typeof event !== 'object') return unchanged;
  const data = event.data;
  if (!data || !ordinal(data.turn) || data.turn !== state.turn) return unchanged;

  if (event.type === 'tool/call') {
    const callId = typeof data.callId === 'string' ? data.callId : '';
    if (!callId) return unchanged;
    return toolCallEvent(state, { callId, name: data.name, input: data.arguments });
  }

  if (event.type === 'tool/result') {
    const callId = typeof data.toolCallId === 'string' ? data.toolCallId
      : typeof data.message?.toolCallId === 'string' ? data.message.toolCallId : '';
    if (!callId || state.tools[callId]?.done) return unchanged;
    const text = textOf(data.message?.content, 'text');
    const failed = data.message?.isError === true || Boolean(data.message?.error) || Boolean(data.error);
    const tools = { ...state.tools, [callId]: { ...(state.tools[callId] ?? { title: 'tool' }), done: true } };
    return {
      state: { ...state, tools },
      events: [update(state.key, 'tool_call_update', {
        toolCallId: callId,
        status: failed ? 'failed' : 'completed',
        ...(text ? { content: [{ type: 'text', text: clip(text, TEXT_MAX) }], rawOutput: clip(text, TEXT_MAX) } : {}),
      })],
    };
  }

  if (event.type !== 'assistant/message') return unchanged;

  const content = Array.isArray(data.message?.content) ? data.message.content : [];
  const step = ordinal(data.step) ? data.step : null;
  let next = state;
  const events = [];
  // Thinking first, then text: the shell closes a thought section when ordinary
  // text follows, so the order of the blocks matters.
  if (!(step !== null && next.thoughtSteps.includes(step))) {
    const thought = textOf(content, 'reasoning');
    if (thought) events.push(update(next.key, 'agent_thought_chunk', { content: { type: 'text', text: clip(thought, TEXT_MAX) } }));
  }
  if (!(step !== null && next.textSteps.includes(step))) {
    const text = textOf(content, 'text');
    if (text) events.push(update(next.key, 'agent_message_chunk', { content: { type: 'text', text: clip(text, TEXT_MAX) } }));
  }
  for (const block of content) {
    if (block?.type !== 'tool-call') continue;
    const input = typeof block.arguments === 'string' ? block.arguments
      : block.arguments === undefined ? undefined : JSON.stringify(block.arguments);
    const call = toolCallEvent(next, { callId: block.id, name: block.name, input: clip(input ?? '', INPUT_MAX) });
    next = call.state;
    events.push(...call.events);
  }
  return { state: next, events };
}
