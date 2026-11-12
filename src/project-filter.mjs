// "工作区类型" — a filter section appended to the shipped view-options menu.
//
// That menu is a primitives `Menu` whose items are a fixed array built inside the
// Workspace browser, so there is no slot for this. The narrowest addition that
// keeps every native behaviour is: clone the menu's own label/separator/item
// nodes, append one section with two mutually-exclusive options, and hide the
// rows with a stylesheet.
//
// The stylesheet is *generated*, not marked up after render: the previous
// version tagged rows as they appeared and hid the rest, which let every React
// re-render flash a row (hidden until the next tag). Here the selectors name the
// project Sessions up front, so a row is either painted or not, never both.
//
// 工作区类型 and 隐藏已归档 are independent axes and apply together; each keeps
// its own tick, which is why two ticks are visible and both are true.
const STORAGE_KEY = 'no996.openfilm.filter.type';
const LEGACY_KEY = 'no996.openfilm.filter.projects';
const STYLE_TAG = 'no996-openfilm-project-filter';
const FLAG = 'data-no996-type';

export const FILTER_ALL = 'all';
export const FILTER_PROJECTS = 'projects';

export function readProjectFilter(storage) {
  try {
    const value = storage?.getItem(STORAGE_KEY);
    if (value === FILTER_PROJECTS || value === FILTER_ALL) return value;
    return storage?.getItem(LEGACY_KEY) === '1' ? FILTER_PROJECTS : FILTER_ALL;
  } catch { return FILTER_ALL; }
}

export function writeProjectFilter(storage, type) {
  try { storage?.setItem(STORAGE_KEY, type === FILTER_PROJECTS ? FILTER_PROJECTS : FILTER_ALL); } catch { /* private mode */ }
}

/**
 * The project's conversations. The Host already computes this set: every stored
 * binding plus any catalog Session whose `cwd` is related to a project folder
 * (the folder itself, below it, or the folder the project was created in). The
 * second half is what keeps older conversations and workspaces opened on the
 * project's parent folder from disappearing.
 */
export function projectSessionIds(payload) {
  const ids = new Set();
  for (const id of payload?.hidden ?? payload?.hiddenSessionIds ?? []) {
    if (typeof id === 'string' && /^[A-Za-z0-9_-]{1,100}$/.test(id)) ids.add(id);
  }
  return ids;
}

/** The stylesheet that hides everything which is not a project conversation. */
export function buildFilterCss(type, sessionIds) {
  if (type !== FILTER_PROJECTS) return '';
  const ids = [...new Set([...sessionIds])].sort();
  const keepRows = ids.map(id => `:not([data-row-key="session:${id}"])`).join('');
  const keepSections = ids.map(id => `:not(:has([data-row-key="session:${id}"]))`).join('');
  return [
    `html[${FLAG}="projects"] [data-row-key^="session:"]${keepRows}{display:none!important}`,
    keepSections
      ? `html[${FLAG}="projects"] [class*="_groupSection"]${keepSections}{display:none!important}`
      : '',
  ].filter(Boolean).join('\n');
}

const textOf = node => (node?.textContent ?? '').trim();

/**
 * @param {object} deps
 * @param {{snapshot: () => object, subscribe: (fn: () => void) => () => void}} deps.store
 * @param {Storage} [deps.storage]
 * @param {Document} [deps.doc]
 * @param {(event: string, detail?: object) => void} [deps.report]
 * @param {{section: string, all: string, projects: string}} deps.labels
 */
export function createProjectFilter({ store, storage, doc = typeof document === 'undefined' ? undefined : document, report, labels }) {
  if (!doc) return { start() {}, choose() {}, getType: () => FILTER_ALL };
  let type = readProjectFilter(storage);
  let ids = projectSessionIds(store.snapshot());

  const style = doc.createElement('style');
  style.dataset.no996 = STYLE_TAG;
  doc.head.appendChild(style);

  const apply = () => {
    doc.documentElement.setAttribute(FLAG, type === FILTER_PROJECTS ? 'projects' : 'all');
    style.textContent = buildFilterCss(type, ids);
  };

  /** Cloned native nodes: [separator?, label, option(all), option(projects)]. */
  const section = list => {
    const children = [...list.children];
    const items = children.filter(node => node.getAttribute('role') === 'menuitem');
    const labels_ = children.filter(node => node.getAttribute('role') !== 'menuitem' && textOf(node));
    const separators = children.filter(node => node.getAttribute('role') !== 'menuitem' && !textOf(node));
    if (items.length === 0) return null;
    const ticks = items.map(node => node.querySelectorAll('svg').length);
    const richest = Math.max(0, ...ticks);
    const checked = richest >= 2 ? items[ticks.indexOf(richest)] : undefined;
    const template = checked ?? items[0];
    const labelNode = labels_.length > 0 ? labels_[labels_.length - 1].cloneNode(true) : null;
    const separatorNode = separators.length > 0 ? separators[separators.length - 1].cloneNode(true) : null;
    if (labelNode) labelNode.textContent = labels.section;
    const option = text => {
      const clone = template.cloneNode(true);
      clone.setAttribute('data-no996-option', text);
      const spans = [...clone.querySelectorAll('span')];
      const target = spans.find(span => textOf(span)) ?? null;
      if (target) target.textContent = text;
      else clone.textContent = text;
      const svgs = clone.querySelectorAll('svg');
      const tick = svgs.length >= 2 ? svgs[svgs.length - 1] : null;
      if (tick) tick.style.opacity = '0';
      return { clone, tick };
    };
    return { labelNode, separatorNode, all: option(labels.all), projects: option(labels.projects) };
  };

  const paintTicks = () => {
    for (const [node, on] of [
      [allItem, type === FILTER_ALL],
      [projectsItem, type === FILTER_PROJECTS],
    ]) {
      if (node?.tick) node.tick.style.opacity = on ? '1' : '0';
    }
  };

  let allItem;
  let projectsItem;
  const inject = () => {
    const list = doc.querySelector('[class*="viewOptionsMenu"]');
    if (!list || list.querySelector('[data-no996-section]')) return;
    const built = section(list);
    if (!built) return;
    const wrap = doc.createElement('div');
    wrap.setAttribute('data-no996-section', '1');
    wrap.style.display = 'contents';
    const nodes = [built.separatorNode, built.labelNode, built.all.clone, built.projects.clone].filter(Boolean);
    for (const node of nodes) wrap.appendChild(node);
    allItem = built.all;
    projectsItem = built.projects;
    const choose = (value) => {
      type = value;
      writeProjectFilter(storage, type);
      report?.('filter-toggle', { type, sessions: ids.size });
      apply();
      paintTicks();
      doc.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    };
    built.all.clone.addEventListener('click', event => { event.preventDefault(); event.stopPropagation(); choose(FILTER_ALL); }, true);
    built.projects.clone.addEventListener('click', event => { event.preventDefault(); event.stopPropagation(); choose(FILTER_PROJECTS); }, true);
    list.appendChild(wrap);
    paintTicks();
    report?.('filter-menu', { type, sessions: ids.size });
  };

  const observer = new (doc.defaultView?.MutationObserver ?? class { observe() {} disconnect() {} })(() => {
    try { inject(); } catch { /* the menu is being torn down */ }
  });

  return {
    start() {
      apply();
      observer.observe(doc.body, { childList: true, subtree: true });
      store.subscribe(() => {
        ids = projectSessionIds(store.snapshot());
        apply();
      });
      report?.('filter-installed', { type, sessions: ids.size });
    },
    choose(value) {
      type = value === FILTER_PROJECTS ? FILTER_PROJECTS : FILTER_ALL;
      writeProjectFilter(storage, type);
      apply();
      paintTicks();
    },
    getType: () => type,
    stop() { observer.disconnect(); style.remove(); doc.documentElement.removeAttribute(FLAG); },
  };
}
