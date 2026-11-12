// Two additive entries on the shipped Workspace browser:
//
//   sidebar.workspaces.session.row.action  → a hover button on a project's row
//   sidebar.workspaces.session.menu.item   → the same action in its ⋯ menu
//
// Nothing here replaces a row or the list; a Session that is not a project
// renders nothing at all, and an ordinary Session keeps every native affordance
// (pin, rename, archive, running state) untouched.
const STYLE_TAG = 'no996-openfilm-session-action';

const CSS = `
.nof-session-action{width:20px;height:20px;padding:0;border:0;border-radius:var(--dsw-radius-sm);background:0 0;color:var(--dsw-alias-label-tertiary);display:inline-flex;align-items:center;justify-content:center;cursor:pointer}
.nof-session-action:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}
.nof-session-action:focus-visible{outline:var(--dsw-focus-ring-width,2px) solid var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary));outline-offset:-2px}
.nof-session-action-menu{display:block;width:100%;padding:6px 8px;border:0;border-radius:var(--dsw-radius-sm);background:0 0;color:var(--dsw-alias-label-primary);text-align:left;font:inherit;font-size:12.5px;line-height:20px;cursor:pointer}
.nof-session-action-menu:hover{background:var(--dsw-alias-interactive-bg-hover)}
`;

export function ensureSessionActionStyles(doc = typeof document === 'undefined' ? undefined : document) {
  if (!doc || doc.querySelector(`style[data-no996="${STYLE_TAG}"]`)) return;
  const tag = doc.createElement('style');
  tag.dataset.no996 = STYLE_TAG;
  tag.textContent = CSS;
  doc.head.appendChild(tag);
}

/** The shipped row's icon-button class, read back from its own stylesheet. */
export function discoverRowButtonClass(doc = typeof document === 'undefined' ? undefined : document) {
  if (!doc) return null;
  const tag = doc.querySelector('style[data-plugin-css$="Rows.module.css"]');
  const text = tag?.textContent ?? '';
  const match = /\.([A-Za-z][\w-]*)_iconButton\b/.exec(text);
  return match ? `${match[1]}_iconButton` : null;
}

/**
 * @param {object} React
 * @param {object} deps
 * @param {(key: string) => string} deps.t
 * @param {{projectOf: (id: string) => object|null, subscribe: (fn: () => void) => () => void}} deps.store
 * @param {(projectId: string) => void} deps.openInEditing
 * @param {object} [deps.primitives]
 */
export function createSessionActions(React, deps) {
  const { t, store, openInEditing, primitives } = deps;
  const h = React.createElement;
  const MenuItemButton = primitives?.MenuItemButton ?? null;
  const buttonClass = discoverRowButtonClass() ?? 'nof-session-action';
  ensureSessionActionStyles();
  const icon = () => h('svg', {
    width: 14, height: 14, viewBox: '0 0 24 24', fill: 'none', 'aria-hidden': true,
  },
  h('rect', { x: 3.5, y: 5, width: 17, height: 13, rx: 2.5, stroke: 'currentColor', strokeWidth: 1.6 }),
  h('path', { d: 'm10.5 9 4.5 2.6-4.5 2.6V9Z', fill: 'currentColor' }));

  const useProject = sessionId => {
    const [, bump] = React.useState(0);
    React.useEffect(() => store.subscribe(() => bump(value => value + 1)), []);
    return store.projectOf(sessionId);
  };

  function RowAction({ sessionId }) {
    const project = useProject(sessionId);
    if (!project) return null;
    const label = t('openInEditing');
    return h('button', {
      type: 'button', className: buttonClass, title: label, 'aria-label': label,
      onClick: event => { event.stopPropagation(); openInEditing(project.projectId); },
    }, icon());
  }

  function MenuItem({ sessionId, useMenuOpenState }) {
    const project = useProject(sessionId);
    const setMenuOpen = typeof useMenuOpenState === 'function' ? useMenuOpenState()[1] : () => {};
    if (!project) return null;
    const label = t('openInEditing');
    if (MenuItemButton) {
      return h(MenuItemButton, {
        separatorBefore: true,
        onSelect: () => { setMenuOpen(false); openInEditing(project.projectId); },
      }, label);
    }
    return h('button', {
      type: 'button', className: 'nof-session-action-menu',
      onClick: () => { setMenuOpen(false); openInEditing(project.projectId); },
    }, label);
  }

  return { RowAction, MenuItem };
}
