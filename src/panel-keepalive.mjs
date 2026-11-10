// Keeps the video panel mounted for the whole session.
//
// The shell's `main` slot is keyed by sidebar id, so switching to any other page
// unmounts its occupant — and with it the Studio iframe, which then reloads from
// scratch on the next visit. Re-parenting an iframe does not help: inserting the
// element again reloads it too. So the panel lives in an always-rendered slot and
// only its visibility follows selection; this store is the one word between the
// two halves.
export function createActivationStore() {
  let active = false;
  let seat;
  const listeners = new Set();
  const emit = () => { for (const listener of [...listeners]) { try { listener(active); } catch { /* one bad listener must not break the panel */ } } };
  return Object.freeze({
    isActive: () => active,
    seat: () => seat,
    /** Called by the small occupant of `main` while it is on screen. */
    enter(node) {
      seat = node;
      if (active) return;
      active = true;
      emit();
    },
    leave() {
      seat = undefined;
      if (!active) return;
      active = false;
      emit();
    },
    subscribe(listener) {
      if (typeof listener !== 'function') throw new TypeError('A listener is required');
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
  });
}
