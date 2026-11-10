const PROJECT_ID = /^[A-Za-z0-9_-]{6,40}$/;
const MAX_LISTENERS = 32;
const MAX_EVENT_BYTES = 1024 * 1024;

/** Host-only fan-out. The caller must authorize the project and bind events to
 * the correct DSH session before publishing; this hub does not authenticate a
 * session, retain messages, replay events or persist any user data.
 */
export function createOfficialEventHub() {
  const listeners = new Map();
  let closed = false;
  const project = id => typeof id === 'string' && PROJECT_ID.test(id);
  return Object.freeze({
    subscribe(projectId, listener) {
      if (closed || !project(projectId) || typeof listener !== 'function') throw new TypeError('A valid project and listener are required');
      let group = listeners.get(projectId);
      if (!group) listeners.set(projectId, group = new Set());
      if (group.size >= MAX_LISTENERS) throw new Error('Too many project listeners');
      group.add(listener);
      let active = true;
      return () => {
        if (!active) return;
        active = false;
        group.delete(listener);
        if (group.size === 0 && listeners.get(projectId) === group) listeners.delete(projectId);
      };
    },
    publish(projectId, event) {
      if (closed || !project(projectId)) throw new TypeError('A valid project is required');
      let data;
      try { data = JSON.stringify(event); } catch { throw new TypeError('A serializable event is required'); }
      if (typeof data !== 'string' || Buffer.byteLength(data, 'utf8') > MAX_EVENT_BYTES) throw new TypeError('Event is invalid or too large');
      let accepted = false;
      for (const listener of [...(listeners.get(projectId) || [])]) {
        try { if (listener(data) === true) accepted = true; } catch { /* one closed client cannot affect other listeners */ }
      }
      // This is only acceptance by a live transport, not proof the browser
      // rendered or acknowledged the event. There is no history replay here.
      return accepted;
    },
    close() { closed = true; listeners.clear(); },
  });
}
