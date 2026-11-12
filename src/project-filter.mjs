// "Projects only" — a filter entry inside the shipped view-options menu.
//
// That menu is a primitives `Menu` whose items are a fixed array built inside
// the Workspace browser; there is no slot for it. So this is the narrowest DOM
// injection the playbook allows (B2): one cloned native item appended to the
// already-open menu, and one stylesheet that hides the Session rows which are
// not projects. The native list, its rows, menus and state are untouched — turn
// the filter off and every row is exactly where it was.
//
// Rules kept: never hide a row we cannot name, re-apply on every render (the
// menu is re-created per open), and put the whole feature behind one attribute
// on <html> so a stale stylesheet can never outlive the toggle.
const STORAGE_KEY = 'no996.openfilm.filter.projects';
const STYLE_TAG = 'no996-openfilm-project-filter';
const FLAG = 'data-no996-projects';
const MARK = 'data-no996-project';

const CSS = `
html[${FLAG}="on"] [data-row-key^="session:"]:not([${MARK}]){display:none!important}
html[${FLAG}="on"] [data-no996-empty]{display:none!important}
`;

export function readProjectFilter(storage) {
  try { return storage?.getItem(STORAGE_KEY) === '1'; } catch { return false; }
}

export function writeProjectFilter(storage, on) {
  try { storage?.setItem(STORAGE_KEY, on ? '1' : '0'); } catch { /* private mode */ }
}

/**
 * The project's conversations. The Host already computes this set: every stored
 * binding plus any catalog Session whose `cwd` is a project folder — the second
 * half is what catches a conversation that was opened before the binding
 * existed, which is exactly the row a user points at and calls "my project".
 */
export function projectSessionIds(payload) {
  const ids = new Set();
  for (const id of payload?.hidden ?? payload?.hiddenSessionIds ?? []) {
    if (typeof id === 'string' && id) ids.add(id);
  }
  return ids;
}

const sessionKey = element => (element?.getAttribute?.('data-row-key') ?? '');

/**
 * @param {object} deps
 * @param {{snapshot: () => object, subscribe: (fn: () => void) => () => void}} deps.store
 * @param {Storage} [deps.storage]
 * @param {Document} [deps.doc]
 * @param {(event: string, detail?: object) => void} [deps.report]
 * @param {string} [deps.label]
 */
export function createProjectFilter({ store, storage, doc = typeof document === 'undefined' ? undefined : document, report, label = 'Projects only' }) {
  if (!doc) return { start() {}, toggle() {}, isOn: () => false };
  let on = readProjectFilter(storage);
  let scheduled = false;
  let ids = projectSessionIds(store.snapshot());

  const style = doc.createElement('style');
  style.dataset.no996 = STYLE_TAG;
  style.textContent = CSS;
  doc.head.appendChild(style);

  const applyFlag = () => { doc.documentElement.setAttribute(FLAG, on ? 'on' : 'off'); };

  const markRows = () => {
    const rows = doc.querySelectorAll('[data-row-key^="session:"]');
    for (const row of rows) {
      const id = sessionKey(row).slice('session:'.length);
      const project = ids.has(id);
      if (project) row.setAttribute(MARK, '1');
      else row.removeAttribute(MARK);
    }
    // The shipped browser wraps each Workspace group in its own section element;
    // a group with no project conversation left is hidden whole, so the list does
    // not turn into a column of empty folders.
    for (const section of doc.querySelectorAll('[class*="_groupSection"]')) {
      const sessions = [...section.querySelectorAll('[data-row-key^="session:"]')];
      const anyProject = sessions.some(row => ids.has(sessionKey(row).slice('session:'.length)));
      if (on && sessions.length > 0 && !anyProject) section.setAttribute('data-no996-empty', '1');
      else section.removeAttribute('data-no996-empty');
    }
  };

  const sync = () => {
    scheduled = false;
    applyFlag();
    try { markRows(); } catch { /* the list re-renders underneath us */ }
  };
  const schedule = () => {
    if (scheduled) return;
    scheduled = true;
    (doc.defaultView?.requestAnimationFrame ?? (fn => setTimeout(fn, 16)))(sync);
  };

  const menuItem = () => {
    const list = doc.querySelector('[class*="viewOptionsMenu"]');
    if (!list || list.querySelector('[data-no996-filter-item]')) return;
    const items = [...list.querySelectorAll('[role="menuitem"], button')].filter(node => node.textContent?.trim());
    // The checked item carries one more icon than the rest (its tick); clone
    // that one so the injected row has the same tick slot to show or hide.
    const counts = items.map(node => node.querySelectorAll('svg').length);
    const richest = Math.max(0, ...counts);
    const selected = richest >= 2 ? items[counts.indexOf(richest)] : undefined;
    const template = selected ?? items[items.length - 1];
    if (!template) return;
    const clone = template.cloneNode(true);
    clone.setAttribute('data-no996-filter-item', '1');
    const labelNode = [...clone.querySelectorAll('span')].find(span => span.textContent?.trim());
    if (labelNode) labelNode.textContent = label;
    else clone.textContent = label;
    const svgs = clone.querySelectorAll('svg');
    const check = svgs[svgs.length - 1];
    if (check) check.style.opacity = on ? '1' : '0';
    clone.addEventListener('click', event => {
      event.preventDefault();
      event.stopPropagation();
      toggle();
      if (check) check.style.opacity = on ? '1' : '0';
    }, true);
    list.appendChild(clone);
    report?.('filter-menu', { injected: true, on });
  };

  const toggle = () => {
    on = !on;
    writeProjectFilter(storage, on);
    report?.('filter-toggle', { on });
    sync();
    const item = doc.querySelector('[data-no996-filter-item]');
    const check = item?.querySelectorAll('svg');
    if (check && check.length > 0) check[check.length - 1].style.opacity = on ? '1' : '0';
  };

  const observer = new (doc.defaultView?.MutationObserver ?? class { observe() {} disconnect() {} })(() => {
    try { menuItem(); } catch { /* a menu being torn down */ }
    schedule();
  });

  return {
    start() {
      applyFlag();
      sync();
      observer.observe(doc.body, { childList: true, subtree: true });
      store.subscribe(() => { ids = projectSessionIds(store.snapshot()); schedule(); });
      report?.('filter-installed', { on, projects: ids.size });
    },
    toggle,
    isOn: () => on,
    stop() { observer.disconnect(); style.remove(); doc.documentElement.removeAttribute(FLAG); },
  };
}
