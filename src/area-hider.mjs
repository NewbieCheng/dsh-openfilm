// Hide project conversations in the shipped Workspace browser without
// replacing it.
//
// The sidebar must stay the shipped component: that is what keeps its folder
// buttons, spacing and menus native. DSH gives no per-Session hide API, but the
// rows it draws carry `data-row-key="session:<id>"`, so a stylesheet can remove
// exactly the project conversations while the rest of the browser is untouched.
//
// This is a behavior injection (UI-PLAYBOOK §6): declare it, keep it to one
// rule per Session, and remove it the day DSH grows a real hide.
const TAG = 'no996-openfilm-hide';

/** Session IDs are `session-<uuid>`; anything else is not a row key. */
export function rowKeys(sessionIds) {
  const keys = [];
  const seen = new Set();
  for (const id of Array.isArray(sessionIds) ? sessionIds : []) {
    if (typeof id !== 'string' || !/^[A-Za-z0-9_-]{1,100}$/.test(id) || seen.has(id)) continue;
    seen.add(id);
    keys.push(id);
  }
  return keys;
}

/** The stylesheet text for a set of hidden Session IDs. */
export function hideCss(sessionIds) {
  return rowKeys(sessionIds)
    .map(id => `[data-row-key="session:${id}"]{display:none!important}`)
    .join('\n');
}

export function createAreaHider(doc = typeof document === 'undefined' ? undefined : document) {
  if (!doc) return { apply() { return false; } };
  const tag = doc.createElement('style');
  tag.dataset.no996 = TAG;
  doc.head.appendChild(tag);
  let last = '';
  return {
    /** Replace the hidden set; returns whether the stylesheet changed. */
    apply(sessionIds) {
      const css = hideCss(sessionIds);
      if (css === last) return false;
      last = css;
      tag.textContent = css;
      return true;
    },
    /** Count how many hidden rows the browser currently draws (diagnostics). */
    matched() {
      return tag.sheet?.cssRules?.length ?? 0;
    },
    remove() { tag.remove(); },
  };
}
