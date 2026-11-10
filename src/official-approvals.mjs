import { randomUUID } from 'node:crypto';

const PROJECT_ID = /^[A-Za-z0-9_-]{6,40}$/;
const TOOL_NAME = /^[A-Za-z0-9_.:-]{1,128}$/;
const DEFAULT_TIMEOUT_MS = 120_000;
const DEFAULT_MAX_PENDING = 128;
const identity = value => typeof value === 'string' && value.length > 0 && value.length <= 512 && !/[\u0000-\u001f\u007f]/.test(value);
const binding = ({ projectId, key, agentId }) => typeof projectId === 'string' && PROJECT_ID.test(projectId) && identity(key) && identity(agentId);

/**
 * Host-only approval coordinator. The Host must authenticate the caller and
 * establish the exact project/key/DSH-agent/active-turn binding before request
 * or answer; these identifiers do not authenticate themselves. Never expose
 * this object directly to a network peer.
 *
 * deliver(projectId, event) must synchronously return true only when the event
 * was delivered to at least one authorized, live listener; false, exceptions,
 * promises and all other values mean unavailable. official-event-hub.publish
 * cannot satisfy this contract: it neither reports listeners nor delivery.
 * The Host must call disconnect for the exact binding when its last eligible
 * listener disconnects, and close on teardown. There is no replay.
 */
export function createOfficialApprovals({ deliver, timeoutMs = DEFAULT_TIMEOUT_MS, maxPending = DEFAULT_MAX_PENDING } = {}) {
  if (typeof deliver !== 'function' || !Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 2_147_483_647 ||
      !Number.isSafeInteger(maxPending) || maxPending < 1 || maxPending > DEFAULT_MAX_PENDING) {
    throw new TypeError('A synchronous delivery function and valid limits are required');
  }
  const pending = new Map();
  let closed = false;

  function settle(entry, outcome) {
    if (pending.get(entry.requestId) !== entry) return false;
    pending.delete(entry.requestId);
    clearTimeout(entry.timer);
    if (entry.signal) entry.signal.removeEventListener('abort', entry.abort);
    entry.resolve(outcome);
    return true;
  }

  return Object.freeze({
    request({ projectId, key, agentId, toolName, callId, signal } = {}) {
      if (signal?.aborted) return Promise.resolve('cancelled');
      if (closed || !binding({ projectId, key, agentId }) || typeof toolName !== 'string' || !TOOL_NAME.test(toolName) ||
          (callId !== undefined && !identity(callId)) || pending.size >= maxPending ||
          (signal !== undefined && (!signal || typeof signal.addEventListener !== 'function' || typeof signal.removeEventListener !== 'function' || typeof signal.aborted !== 'boolean'))) {
        return Promise.resolve('unavailable');
      }
      const requestId = randomUUID();
      return new Promise(resolve => {
        const entry = { projectId, key, agentId, requestId, signal, resolve, delivered: false, earlyAnswer: null };
        entry.abort = () => settle(entry, 'cancelled');
        pending.set(requestId, entry);
        entry.timer = setTimeout(() => settle(entry, 'unavailable'), timeoutMs);
        if (signal) {
          signal.addEventListener('abort', entry.abort, { once: true });
          if (signal.aborted) { settle(entry, 'cancelled'); return; }
        }
        const event = {
          key, kind: 'permission', requestId,
          params: {
            toolCall: { title: toolName },
            options: [
              { optionId: 'allow-once', name: 'Allow once', kind: 'allow_once' },
              { optionId: 'reject-once', name: 'Reject', kind: 'reject_once' },
            ],
          },
        };
        let delivered = false;
        try { delivered = deliver(projectId, event) === true; } catch { /* fail closed */ }
        if (pending.get(requestId) !== entry) return;
        if (!delivered) { settle(entry, 'unavailable'); return; }
        entry.delivered = true;
        if (entry.earlyAnswer) settle(entry, entry.earlyAnswer);
      });
    },

    // Returns whether an exact, currently pending request accepted the answer.
    answer({ projectId, key, agentId, requestId, optionId } = {}) {
      if (!binding({ projectId, key, agentId }) || typeof requestId !== 'string') return false;
      const entry = pending.get(requestId);
      if (!entry || entry.projectId !== projectId || entry.key !== key || entry.agentId !== agentId || entry.earlyAnswer) return false;
      const outcome = optionId === 'allow-once' ? 'allowed-once' : optionId === 'reject-once' ? 'rejected' : null;
      if (!outcome) return false;
      if (!entry.delivered) { entry.earlyAnswer = outcome; return true; }
      return settle(entry, outcome);
    },

    // Invoke only when no eligible listener remains for this exact binding.
    disconnect({ projectId, key, agentId } = {}) {
      if (!binding({ projectId, key, agentId })) return;
      for (const entry of pending.values()) {
        if (entry.projectId === projectId && entry.key === key && entry.agentId === agentId) settle(entry, 'unavailable');
      }
    },

    close() {
      if (closed) return;
      closed = true;
      for (const entry of pending.values()) settle(entry, 'cancelled');
    },
  });
}
