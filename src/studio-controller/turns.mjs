// Per-project turn logs for the panel's "what happened in this turn" viewer.
//
// Bounded on purpose: the panel shows recent turns, not history. The caps keep a
// long session from turning the Host into a second transcript store.
export function createTurnLog() {
const TURN_LOG_TURNS = 4;
const TURN_LOG_EVENTS = 2000;
const turnLogs = new Map();
const recordTurnEvent = (projectId, event) => {
  if (typeof projectId !== 'string' || !projectId || !event || typeof event !== 'object') return;
  const turnId = typeof event.key === 'string' ? event.key : '';
  if (!turnId) return;
  const update = event.update && typeof event.update === 'object' ? event.update : {};
  let turns = turnLogs.get(projectId);
  if (!turns) turnLogs.set(projectId, turns = new Map());
  let events = turns.get(turnId);
  if (!events) {
    turns.set(turnId, events = []);
    while (turns.size > TURN_LOG_TURNS) turns.delete(turns.keys().next().value);
  }
  const kind = typeof update.sessionUpdate === 'string' ? update.sessionUpdate
    : event.kind === 'done' ? 'done' : 'update';
  events.push({ t: Date.now(), kind, ...update });
  if (events.length > TURN_LOG_EVENTS) events.splice(0, events.length - TURN_LOG_EVENTS);
  while (turnLogs.size > 8) turnLogs.delete(turnLogs.keys().next().value);
};
const turnLogOf = (projectId, turnId) => {
  const events = turnLogs.get(projectId)?.get(turnId);
  if (!events) return null;
  // `whole` says these events are the log's, so the viewer replaces rather than appends.
  return { file: 'dsh-turn', cut: false, whole: true, events: [...events], calls: [], callsWhole: true, callsCut: false, at: { events: events.length, calls: 0, callsFile: 0 } };
};

  return { recordTurnEvent, turnLogOf };
}
