// The sidebar's Workspace header, turned into a two-way switch:
//
//   工作区（带下拉）  ──▶  工作区（默认，DSH 自己的列表）
//                 剪辑区（本项目绑定的剪辑会话）
//
// This is a narrow B2 injection, not a replacement of the shipped Workspace
// browser: it finds the section label by its text and by its parent (which holds
// the search input and the filter/add buttons), hides only that label, and puts
// a button in its place. In the editing area the shipped search field filters
// our list, the shipped list is hidden behind ours, and only the search button
// stays in the header: the view-options and add-workspace buttons step aside,
// with the view options moved into each folder row's more menu. Choosing the
// workspace area restores everything.
//
// Folder rows mirror DSH's own workspace rows: the folder glyph holds the one
// leading 16px slot and swaps to a chevron while the row is hovered, so the
// caret never occupies a second column.
//
// React re-renders this header (the label flips between "工作区" and "会话"), so
// every pass starts by removing all previously injected nodes. That is what
// keeps one trigger and one list: a stale trigger left in place is what made the
// header read "素材剪辑区 / 工作区" twice in 0.13.2.

import { areaBus } from './area-bus.mjs';
import { filterEditing, matchRange, projectDisplayTitle, sessionDisplayTitle } from './editing-filter.mjs';

const SWITCH = 'data-no996-workspace-switch';
const SWITCH_HOST = 'data-no996-switch-host';
const TOAST = 'data-no996-toast';
const POPOVER = 'data-no996-workspace-popover';
const LIST = 'data-no996-editing-list';
const VIEW_MENU = 'data-no996-view-menu';
const ROW_MENU = 'data-no996-row-menu';
const MODAL = 'data-no996-modal';
const STYLE = 'data-no996-editing-style';
const MODE_KEY = 'no996.openfilm.sidebarMode';
const VIEW_KEY = 'no996.openfilm.editingView';
const LABELS = new Set(['工作区', '会话']);
const PANEL_LABELS = new Set(['视频创作', 'Video studio']);
/** The editing area's name in the switch, its popover and its aria labels. */
export const EDITING_LABEL = '剪辑区';

const text = value => (typeof value === 'string' ? value.trim() : '');
const isId = value => typeof value === 'string' && /^[A-Za-z0-9_-]{6,40}$/.test(value);

/** Static inline icons (Lucide geometry, ISC). User text is never interpolated here. */
const ICONS = {
  chevron: '<path d="m6 9 6 6 6-6"/>',
  check: '<path d="M20 6 9 17l-5-5"/>',
  more: '<circle cx="5" cy="12" r="1.7" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="1.7" fill="currentColor" stroke="none"/><circle cx="19" cy="12" r="1.7" fill="currentColor" stroke="none"/>',
  pin: '<path d="M12 17v5"/><path d="M9 10.8a2 2 0 0 1-1.1 1.8l-1.8.9A2 2 0 0 0 5 15.2V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.8a2 2 0 0 0-1.1-1.8l-1.8-.9A2 2 0 0 1 15 10.8V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H8a2 2 0 0 0 0 4 1 1 0 0 1 1 1z"/>',
  pencil: '<path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/><path d="m15 5 4 4"/>',
  archive: '<rect x="2" y="3" width="20" height="5" rx="1"/><path d="M4 8v11a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8"/><path d="M10 12h4"/>',
  restore: '<path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v6h6"/>',
  trash: '<path d="M3 6h18"/><path d="M8 6V4h8v2"/><path d="m19 6-1 14H6L5 6"/><path d="M10 11v6M14 11v6"/>',
  eye: '<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/>',
  external: '<path d="M15 3h6v6"/><path d="M10 14 21 3"/><path d="M21 14v7H3V3h7"/>',
  refresh: '<path d="M21 12a9 9 0 1 1-3-6.7"/><path d="M21 3v6h-6"/>',
  eraser: '<path d="m7 21-4.3-4.3a2.4 2.4 0 0 1 0-3.4l9.6-9.6a2.4 2.4 0 0 1 3.4 0l5.6 5.6a2.4 2.4 0 0 1 0 3.4L13 21"/><path d="M22 21H7"/><path d="m5 11 9 9"/>',
  message: '<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/><path d="m9 10 6 6M15 10l-6 6"/>',
  sliders: '<path d="M4 8h10M18 8h2M4 16h4M12 16h8"/><circle cx="16" cy="8" r="2"/><circle cx="10" cy="16" r="2"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  type: '<path d="M4 7V4h16v3"/><path d="M9 20h6"/><path d="M12 4v16"/>',
  dot: '<circle cx="12" cy="12" r="5" fill="currentColor" stroke="none"/>',
  grid: '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>',
  clapper: '<path d="M20.2 6 3 11l-.9-2.4a2 2 0 0 1 1.3-2.5l13.5-4a2 2 0 0 1 2.5 1.3Z"/><path d="m6.2 5.3 3.1 3.9"/><path d="m12.4 3.4 3.1 4"/><path d="M3 11h18v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z"/>',
};


/** The Workspace header: a label whose parent also holds the search input and the
 *  filter/add buttons. Matching on structure keeps us off hashed CSS classes. */
function findHeader(doc) {
  for (const span of doc.querySelectorAll('span')) {
    if (!LABELS.has(text(span.textContent))) continue;
    const header = span.parentElement;
    if (!header || !header.querySelector('input')) continue;
    if (header.querySelectorAll('button').length < 2) continue;
    // The header actions (view options + add folder) are the last div child that
    // does not hold the search input.
    const actions = [...header.children].filter(element => element.tagName === 'DIV' && !element.querySelector('input')).pop() ?? null;
    return { span, header, input: header.querySelector('input'), actions };
  }
  return null;
}

function findPanelEntry(doc) {
  for (const element of doc.querySelectorAll('button, [role="button"], a')) {
    if (PANEL_LABELS.has(text(element.textContent))) return element;
  }
  return null;
}

function readView(doc) {
  try {
    const value = JSON.parse(doc.defaultView?.localStorage?.getItem(VIEW_KEY) ?? 'null');
    if (!value || typeof value !== 'object') return { sort: 'recent', archived: true, path: true };
    return {
      sort: value.sort === 'name' ? 'name' : 'recent',
      archived: value.archived !== false,
      path: value.path !== false,
    };
  } catch { return { sort: 'recent', archived: true, path: true }; }
}

export function installWorkspaceSwitch({ document: doc, fetchSessions } = {}) {
  if (!doc || typeof doc.createElement !== 'function') return () => {};
  let mode = 'workspaces';
  try { mode = doc.defaultView?.localStorage?.getItem(MODE_KEY) === 'editing' ? 'editing' : 'workspaces'; } catch { /* private mode */ }
  let view = readView(doc);
  let query = '';
  let projects = [];
  const collapsed = new Set();
  const expanded = new Set();
  let mounted = null;
  let trigger = null;
  let list = null;
  let popover = null;
  let loading = false;
  let observer = null;
  let hidden = [];
  let style = null;
  let onDocumentClick = null;
  let onSearch = null;

  /** One inline stroke icon; sized by the caller so rows and menus align. */
  const icon = (name, size = 16) => {
    const span = doc.createElement('span');
    span.className = 'n996-icon';
    span.setAttribute('aria-hidden', 'true');
    span.style.cssText = `display:inline-flex;flex:none;align-items:center;justify-content:center;width:${size}px;height:${size}px;`;
    span.innerHTML = `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">${ICONS[name] ?? ''}</svg>`;
    return span;
  };

  const postJson = async (path, body) => {
    const response = await fetch(path, {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!response.ok) {
      // The Host answers failures with a short code; keep it so the dialog can
      // say why instead of a bare HTTP number.
      const detail = await response.text().catch(() => '');
      const error = new Error(detail || `HTTP ${response.status}`);
      error.status = response.status;
      throw error;
    }
    return response.json().catch(() => ({}));
  };

  const restoreHidden = () => {
    for (const node of hidden) { try { node.style.display = ''; } catch { /* gone */ } }
    hidden = [];
  };

  const closePopover = () => {
    if (popover) { popover.remove(); popover = null; }
    trigger?.classList.remove('n996-open');
    trigger?.setAttribute('aria-expanded', 'false');
  };

  const closeMenus = () => {
    for (const node of doc.querySelectorAll(`[${VIEW_MENU}], [${ROW_MENU}], [${MODAL}]`)) node.remove();
  };

  /** Remove every injected node and undo every hide. Idempotent and cheap. */
  const cleanup = () => {
    closePopover();
    closeMenus();
    for (const node of doc.querySelectorAll(`[${SWITCH}], [${POPOVER}], [${LIST}], [${STYLE}], [${TOAST}]`)) node.remove();
    restoreHidden();
    if (mounted?.span) mounted.span.style.display = '';
    if (mounted?.header) {
      mounted.header.removeAttribute('data-no996-editing');
      mounted.header.removeAttribute(SWITCH_HOST);
      mounted.header.style.removeProperty('--n996-switch-w');
    }
    if (mounted?.header && onSearch) { try { mounted.header.removeEventListener('input', onSearch, true); } catch { /* gone */ } }
    if (onDocumentClick) { try { doc.removeEventListener('click', onDocumentClick, true); } catch { /* gone */ } }
    trigger = null; list = null; mounted = null; style = null; onSearch = null; onDocumentClick = null;
  };

  /** Rules that keep the header readable while the shipped search expands. */
  const ensureStyle = () => {
    if (style?.isConnected) return;
    style = doc.createElement('style');
    style.setAttribute(STYLE, '');
    style.textContent = [
      '[data-no996-editing] [class*="_sectionLabelHidden"]{opacity:1!important;visibility:visible!important;max-width:45%!important;margin-right:0!important;transform:none!important}',
      '[data-no996-editing] [class*="_headerActionsHidden"]{opacity:1!important;visibility:visible!important;max-width:60px!important;transform:none!important;pointer-events:auto!important}',
      '[data-no996-editing] [data-no996-workspace-switch]{flex:none!important;min-width:max-content!important}',
      '[data-no996-editing] [class*="_searchSlot"]{min-width:0!important}',
      // One leading slot per folder row: folder at rest, chevron on hover.
      '[data-no996-editing-list] .n996-folder{display:inline-flex;flex:none;align-items:center;justify-content:center;width:16px;height:16px;color:var(--dsw-alias-label-secondary, currentColor)}',
      '[data-no996-editing-list] .n996-chevron{display:none;flex:none;align-items:center;justify-content:center;width:16px;height:16px;opacity:.62;transition:transform .16s cubic-bezier(.2,.8,.2,1),opacity .12s ease}',
      '[data-no996-editing-list] .n996-folder-toggle:hover .n996-folder{display:none}',
      '[data-no996-editing-list] .n996-folder-toggle:hover .n996-chevron{display:inline-flex}',
      '[data-no996-editing-list] .n996-folder-toggle{transition:background-color .12s ease}',
      '[data-no996-editing-list] .n996-row-open{transition:background-color .12s ease}',
      '[data-no996-editing-list] .n996-row-action{transition:opacity .12s ease,background-color .12s ease}',
      '[data-no996-workspace-switch]{transition:background-color .12s ease,color .12s ease}',
      '[data-no996-workspace-switch] .n996-trigger-chevron{transition:transform .16s cubic-bezier(.2,.8,.2,1)}',
      '[data-no996-workspace-switch].n996-open .n996-trigger-chevron{transform:rotate(180deg)}',
      // Reserve a fixed slot for the mode switch: the switch floats over the
      // header's left edge and the header starts its content after it, so an
      // expanding search cannot cover it.
      '[data-no996-switch-host]{position:relative!important;padding-left:calc(4px + var(--n996-switch-w, 56px))!important}',
      '[data-no996-switch-host] [data-no996-workspace-switch]{position:absolute;left:4px;top:50%;transform:translateY(-50%);z-index:2}',
      // Menus and dialogs arrive in place instead of flashing: one short,
      // top-anchored rise; no bounce, no per-item cascade.
      '@keyframes n996-rise{from{opacity:0;transform:translateY(-4px) scale(.985)}to{opacity:1;transform:none}}',
      '@keyframes n996-fade{from{opacity:0}to{opacity:1}}',
      '@keyframes n996-pop{from{opacity:0;transform:translateY(6px) scale(.985)}to{opacity:1;transform:none}}',
      '@keyframes n996-toast{from{opacity:0;transform:translate(-50%,10px)}to{opacity:1;transform:translate(-50%,0)}}',
      '[data-no996-row-menu],[data-no996-view-menu],[data-no996-workspace-popover]{animation:n996-rise .13s cubic-bezier(.2,.8,.2,1);transform-origin:top left}',
      '[data-no996-modal]{animation:n996-fade .12s ease-out}',
      '[data-no996-modal] > div{animation:n996-pop .16s cubic-bezier(.2,.8,.2,1)}',
      '[data-no996-toast]{animation:n996-toast .18s cubic-bezier(.2,.8,.2,1)}',
      '@media (prefers-reduced-motion: reduce){[data-no996-row-menu],[data-no996-view-menu],[data-no996-workspace-popover],[data-no996-modal],[data-no996-modal] > div,[data-no996-toast],.n996-chevron,.n996-trigger-chevron{animation:none!important;transition:none!important}}',
    ].join('');
    (doc.head ?? doc.documentElement).append(style);
  };

  const listContainer = header => {
    if (list) return list;
    list = doc.createElement('div');
    list.setAttribute(LIST, '');
    list.style.cssText = 'display:none;padding:2px 4px 6px;overflow:auto;';
    // The shipped list is a sibling after the header; ours joins the same parent
    // so it inherits the same width and scroll box.
    (header.parentElement ?? header).append(list);
    return list;
  };

  const filteredRows = () => {
    let rows = filterEditing(projects, { query, archived: view.archived });
    if (view.sort === 'name') {
      rows = [...rows].sort((left, right) => projectDisplayTitle(left.project).localeCompare(projectDisplayTitle(right.project), 'zh-CN'));
    }
    return rows;
  };

  /** Append a row label, marking the search hit in place. */
  const appendHighlight = (parent, label, needle) => {
    const range = matchRange(label, needle);
    if (!range) { parent.append(label); return; }
    parent.append(label.slice(0, range.start));
    const mark = doc.createElement('mark');
    mark.textContent = label.slice(range.start, range.end);
    mark.style.cssText = 'background:rgba(255,190,60,.28);color:inherit;border-radius:2px;padding:0 1px;';
    parent.append(mark, label.slice(range.end));
  };

  const relative = iso => {
    const time = typeof iso === 'string' ? Date.parse(iso) : NaN;
    if (!Number.isFinite(time)) return '';
    const minutes = Math.max(0, Math.round((Date.now() - time) / 60000));
    if (minutes < 1) return '刚刚';
    if (minutes < 60) return `${minutes}分钟前`;
    const hours = Math.round(minutes / 60);
    if (hours < 24) return `${hours}小时前`;
    const days = Math.round(hours / 24);
    return `${days}天前`;
  };

  const folderGlyph = open => {
    const span = doc.createElement('span');
    span.className = 'n996-folder';
    // Closed folder for a collapsed row, open folder for an expanded one: the
    // same idle signal DSH's own workspace row gives.
    span.innerHTML = open
      ? '<svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.2"><path d="M1.5 4.4A1 1 0 0 1 2.5 3.4h3l1.2 1.4h6.3a1 1 0 0 1 1 1v1.7H1.5z"/><path d="M1.8 7.5h12.9l-1.3 4.9a1 1 0 0 1-1 .7H3.6a1 1 0 0 1-1-.8z"/></svg>'
      : '<svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.2"><path d="M1.5 4.5A1 1 0 0 1 2.5 3.5h3l1.2 1.4h5.8a1 1 0 0 1 1 1v6.6a1 1 0 0 1-1 1h-10a1 1 0 0 1-1-1z"/></svg>';
    return span;
  };

  const openProject = project => {
    try { doc.defaultView?.localStorage?.setItem('no996.openfilm.lastProject', project.projectId); } catch { /* private mode */ }
    // Ask the panel to show the project; a request made before the panel is
    // mounted is queued by the bus and flushed when it becomes ready.
    areaBus.navigate(project.projectId);
    findPanelEntry(doc)?.click();
    closePopover();
    closeMenus();
  };

  const pinBadge = () => {
    const pin = icon('pin', 12);
    pin.style.cssText += ';opacity:.78;margin-right:2px;vertical-align:-1px;color:var(--dsw-alias-label-tertiary, currentColor)';
    return pin;
  };

  const rowAction = (parent, label, onClick) => {
    const button = doc.createElement('button');
    button.type = 'button';
    button.className = 'n996-row-action';
    button.setAttribute('aria-label', label);
    button.append(icon('more', 16));
    button.style.cssText = 'display:inline-flex;align-items:center;justify-content:center;flex:none;width:24px;height:24px;padding:0;border:0;border-radius:6px;background:none;color:inherit;opacity:0;cursor:pointer;font:inherit;line-height:1;';
    parent.addEventListener('mouseenter', () => { button.style.opacity = '.75'; });
    parent.addEventListener('mouseleave', () => { button.style.opacity = '0'; });
    button.addEventListener('click', event => {
      event.preventDefault();
      event.stopPropagation();
      onClick(button);
    });
    return button;
  };

  const renderRows = (container, next) => {
    projects = Array.isArray(next) ? next : [];
    container.replaceChildren();
    const rows = filteredRows();
    if (!rows.length) {
      const empty = doc.createElement('div');
      empty.textContent = query ? '没有匹配的项目或对话。' : '还没有剪辑项目：先在视频创作里建一个。';
      empty.style.cssText = 'padding:8px 10px 2px;font-size:12px;opacity:.6;';
      container.append(empty);
      // The header no longer carries the view-options button; an empty list
      // still needs a way to reveal archived projects (or hide them again).
      const viewLink = doc.createElement('button');
      viewLink.type = 'button';
      viewLink.textContent = '视图选项…';
      viewLink.style.cssText = 'display:block;margin:0 10px 4px;padding:2px 0;border:0;background:none;color:var(--dsw-alias-label-tertiary, inherit);font:inherit;font-size:12px;cursor:pointer;';
      viewLink.addEventListener('click', event => {
        event.preventDefault();
        event.stopPropagation();
        openViewMenu(viewLink);
      });
      container.append(viewLink);
      return;
    }
    for (const row of rows) {
      const project = row.project;
      const folderOpen = row.open || !collapsed.has(project.projectId);
      const sessions = row.sessions;
      const folder = doc.createElement('div');
      folder.style.cssText = 'display:flex;align-items:center;gap:2px;border-radius:6px;';
      const toggle = doc.createElement('button');
      toggle.type = 'button';
      toggle.className = 'n996-folder-toggle';
      toggle.setAttribute('aria-expanded', folderOpen ? 'true' : 'false');
      toggle.style.cssText = 'display:flex;align-items:center;gap:6px;flex:1 1 auto;min-width:0;padding:6px 8px;border:0;border-radius:6px;background:none;color:inherit;text-align:left;cursor:pointer;font:inherit;font-size:13px;';
      const chevron = doc.createElement('span');
      chevron.className = 'n996-chevron';
      chevron.setAttribute('aria-hidden', 'true');
      chevron.append(icon('chevron', 14));
      // One glyph, rotated: the resting folder icon and the hover chevron stay
      // in the same 16px slot.
      chevron.style.transform = folderOpen ? 'none' : 'rotate(-90deg)';
      const name = doc.createElement('span');
      if (project.pinned) name.append(pinBadge());
      appendHighlight(name, projectDisplayTitle(project), query);
      name.style.cssText = 'flex:1 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-weight:500;';
      const count = doc.createElement('span');
      count.textContent = String(sessions.length);
      count.style.cssText = 'flex:none;font-size:11px;opacity:.45;';
      toggle.append(folderGlyph(folderOpen), chevron, name, count);
      toggle.addEventListener('mouseenter', () => { toggle.style.background = 'var(--bg-hover, rgba(127,127,127,.12))'; });
      toggle.addEventListener('mouseleave', () => { toggle.style.background = 'none'; });
      toggle.addEventListener('click', event => {
        event.preventDefault();
        event.stopPropagation();
        // A search result is always open; collapsing it would hide the hit.
        if (query) return;
        if (collapsed.has(project.projectId)) collapsed.delete(project.projectId);
        else collapsed.add(project.projectId);
        renderRows(container, projects);
      });
      const more = rowAction(folder, '项目操作', anchor => openRowMenu(anchor, project, null));
      folder.append(toggle, more);
      container.append(folder);
      if (!folderOpen) continue;
      const shown = query ? sessions : (expanded.has(project.projectId) ? sessions : sessions.slice(0, 5));
      for (const session of shown) {
        const child = doc.createElement('div');
        child.style.cssText = 'display:flex;align-items:center;gap:2px;border-radius:6px;margin-left:26px;';
        const open = doc.createElement('button');
        open.type = 'button';
        open.style.cssText = 'display:flex;align-items:center;gap:8px;flex:1 1 auto;min-width:0;padding:5px 8px;border:0;border-radius:6px;background:none;color:inherit;text-align:left;cursor:pointer;font:inherit;font-size:13px;';
        const title = doc.createElement('span');
        if (session.pinned) title.append(pinBadge());
        if (session.archived) title.append('已归档 · ');
        appendHighlight(title, sessionDisplayTitle(session), query);
        title.style.cssText = 'flex:1 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;';
        const time = doc.createElement('span');
        time.textContent = relative(session.updatedAt);
        time.style.cssText = 'flex:none;font-size:11px;opacity:.45;';
        open.append(title, time);
        open.addEventListener('mouseenter', () => { open.style.background = 'var(--bg-hover, rgba(127,127,127,.12))'; });
        open.addEventListener('mouseleave', () => { open.style.background = 'none'; });
        open.addEventListener('click', event => {
          event.preventDefault();
          event.stopPropagation();
          openProject(project);
        });
        const childMore = rowAction(child, '对话操作', anchor => openRowMenu(anchor, project, session));
        child.append(open, childMore);
        container.append(child);
      }
      if (!query && !expanded.has(project.projectId) && sessions.length > 5) {
        const moreButton = doc.createElement('button');
        moreButton.type = 'button';
        moreButton.textContent = `展开其余 ${sessions.length - 5} 个会话`;
        moreButton.style.cssText = 'display:block;margin-left:26px;padding:4px 8px;border:0;background:none;color:var(--dsw-alias-label-tertiary, inherit);font:inherit;font-size:12px;cursor:pointer;';
        moreButton.addEventListener('click', event => {
          event.preventDefault();
          event.stopPropagation();
          expanded.add(project.projectId);
          renderRows(container, projects);
        });
        container.append(moreButton);
      }
    }
  };

  const load = async (container, { quiet = false } = {}) => {
    if (loading) return;
    loading = true;
    // A quiet reload is what every pin/rename/archive/delete uses: the current
    // rows stay on screen until the new ones are ready, so the list never
    // flashes an empty "loading" frame.
    if (!quiet) {
      const waiting = doc.createElement('div');
      waiting.textContent = '正在读取剪辑会话…';
      waiting.style.cssText = 'padding:8px 10px;font-size:12px;opacity:.6;';
      container.replaceChildren(waiting);
    }
    try {
      const data = await fetchSessions?.();
      renderRows(container, Array.isArray(data?.projects) ? data.projects : []);
    } catch (error) {
      // The Host route disappearing means the plugin is no longer serving this
      // page (stopped/disabled): put the shipped sidebar back instead of
      // leaving a dead switch behind.
      if (error?.code === 'ROUTE_MISSING') { cleanup(); return; }
      if (quiet) {
        toast('刷新失败，列表保持原样。');
        return;
      }
      const failed = doc.createElement('div');
      failed.style.cssText = 'padding:8px 10px;font-size:12px;color:#e07b5a;display:flex;align-items:center;gap:8px;';
      const message = doc.createElement('span');
      message.textContent = '读取失败，稍后再试。';
      const retry = doc.createElement('button');
      retry.type = 'button';
      retry.textContent = '重试';
      retry.style.cssText = 'border:1px solid var(--border-subtle, rgba(255,255,255,.2));border-radius:5px;background:none;color:inherit;font:inherit;padding:2px 8px;cursor:pointer;';
      retry.addEventListener('click', event => { event.preventDefault(); event.stopPropagation(); void load(container); });
      failed.append(message, retry);
      container.replaceChildren(failed);
    } finally {
      loading = false;
    }
  };

  const refresh = () => { if (list) void load(list, { quiet: true }); };

  const menuButton = (parent, label, onClick, { checked = false, danger = false, icon: iconName = '' } = {}) => {
    const button = doc.createElement('button');
    button.type = 'button';
    button.setAttribute('role', 'menuitem');
    button.style.cssText = 'display:flex;align-items:center;gap:8px;width:100%;padding:7px 9px;border:0;border-radius:6px;background:none;text-align:left;cursor:pointer;font:inherit;color:' + (danger ? 'var(--dsw-alias-state-error-primary, #e5484d)' : 'inherit') + ';transition:background-color .12s ease;';
    if (iconName) button.append(icon(iconName, 15));
    const textNode = doc.createElement('span');
    textNode.style.cssText = 'flex:1 1 auto;min-width:0;';
    textNode.textContent = label;
    button.append(textNode);
    if (checked) {
      // A radio dot reads as "this one is active" without the checkmark glyph
      // the outline menus used to draw.
      const dot = icon('dot', 10);
      dot.style.color = 'var(--dsw-alias-state-business-primary, #4b7bec)';
      button.append(dot);
    }
    button.addEventListener('mouseenter', () => { button.style.background = 'var(--bg-hover, rgba(127,127,127,.14))'; });
    button.addEventListener('mouseleave', () => { button.style.background = 'none'; });
    button.addEventListener('click', event => {
      event.preventDefault();
      event.stopPropagation();
      closeMenus();
      onClick();
    });
    parent.append(button);
  };

  const menuSeparator = parent => {
    const line = doc.createElement('div');
    line.style.cssText = 'height:1px;margin:4px 6px;background:var(--border-subtle, rgba(255,255,255,.12));';
    parent.append(line);
  };

  const openMenuAt = (anchor, attribute) => {
    const menu = doc.createElement('div');
    menu.setAttribute(attribute, '');
    menu.style.cssText = 'position:fixed;z-index:2147483000;min-width:180px;padding:4px;border-radius:8px;background:var(--bg-elevated, #232325);border:1px solid var(--border-subtle, rgba(255,255,255,.12));box-shadow:0 10px 30px rgba(0,0,0,.45);font:13px system-ui,sans-serif;color:inherit;';
    const rect = anchor.getBoundingClientRect();
    menu.style.left = `${Math.max(8, Math.min(rect.left, (doc.defaultView?.innerWidth ?? 1200) - 200))}px`;
    menu.style.top = `${Math.round(rect.bottom + 4)}px`;
    doc.body.append(menu);
    const dismiss = event => {
      if (menu.isConnected && !menu.contains(event.target) && event.target !== anchor) {
        menu.remove();
        doc.removeEventListener('pointerdown', dismiss, true);
      }
    };
    doc.addEventListener('pointerdown', dismiss, true);
    return menu;
  };

  const openViewMenu = anchor => {
    closeMenus();
    const menu = openMenuAt(anchor, VIEW_MENU);
    menu.setAttribute('role', 'menu');
    menuButton(menu, '排序：最近更新', () => { view = { ...view, sort: 'recent' }; saveView(); refresh(); }, { checked: view.sort === 'recent', icon: 'clock' });
    menuButton(menu, '排序：名称', () => { view = { ...view, sort: 'name' }; saveView(); refresh(); }, { checked: view.sort === 'name', icon: 'type' });
    menuButton(menu, '显示已归档', () => { view = { ...view, archived: !view.archived }; saveView(); refresh(); }, { checked: view.archived, icon: 'archive' });
    menuButton(menu, '显示路径', () => { view = { ...view, path: !view.path }; saveView(); refresh(); }, { checked: view.path, icon: 'eye' });
  };

  const saveView = () => {
    try { doc.defaultView?.localStorage?.setItem(VIEW_KEY, JSON.stringify(view)); } catch { /* private mode */ }
  };

  const openRowMenu = (anchor, project, session) => {
    closeMenus();
    const menu = openMenuAt(anchor, ROW_MENU);
    menu.setAttribute('role', 'menu');
    const base = { projectId: project.projectId, ...(session ? { sessionId: session.sessionId } : {}) };
    // Folder = one OpenFilm project. Its menu controls the project; a single
    // conversation's menu only ever touches that conversation.
    if (!session) {
      menuButton(menu, '视图选项…', () => { openViewMenu(anchor); }, { icon: 'sliders' });
      menuButton(menu, '刷新列表', () => { refresh(); }, { icon: 'refresh' });
      menuButton(menu, '在视频创作里打开', () => { openProject(project); }, { icon: 'external' });
      menuSeparator(menu);
    }
    const pinned = session ? session.pinned === true : project.pinned === true;
    menuButton(menu, pinned ? '取消置顶' : '置顶', async () => {
      try { await postJson('/api/no996-openfilm/editing-prefs', { ...base, pinned: !pinned }); refresh(); } catch { /* leave the row */ }
    }, { icon: 'pin' });
    menuButton(menu, '重命名…', () => openRename(project, session), { icon: 'pencil' });
    if (session) {
      const archived = session.archived === true;
      menuButton(menu, archived ? '恢复对话' : '归档对话', async () => {
        try { await postJson('/api/no996-openfilm/editing-archive', { ...base, archived: !archived }); refresh(); } catch { /* leave the row */ }
      }, { icon: archived ? 'restore' : 'archive' });
      menuButton(menu, '删除对话…', () => openConfirm(project, session), { icon: 'message', danger: true });
    } else {
      menuSeparator(menu);
      if ((project.sessions ?? []).length) menuButton(menu, '清空对话（保留项目）…', () => openConfirm(project, null), { icon: 'eraser' });
      menuButton(menu, '删除项目…', () => openDeleteProject(project), { icon: 'trash', danger: true });
    }
  };

  const openModal = (title, body, actions) => {
    const overlay = doc.createElement('div');
    overlay.setAttribute(MODAL, '');
    overlay.style.cssText = 'position:fixed;inset:0;z-index:2147483001;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,.45);';
    const card = doc.createElement('div');
    card.style.cssText = 'width:min(360px,calc(100vw - 32px));padding:16px;border-radius:10px;background:var(--bg-elevated, #232325);border:1px solid var(--border-subtle, rgba(255,255,255,.12));box-shadow:0 18px 50px rgba(0,0,0,.5);font:13px system-ui,sans-serif;color:inherit;';
    const heading = doc.createElement('div');
    heading.textContent = title;
    heading.style.cssText = 'font-weight:600;margin-bottom:8px;';
    const content = doc.createElement('div');
    content.style.cssText = 'opacity:.8;line-height:1.6;margin-bottom:12px;';
    content.append(body);
    const footer = doc.createElement('div');
    footer.style.cssText = 'display:flex;justify-content:flex-end;gap:8px;';
    const buttons = [];
    for (const [label, onClick, variant] of actions) {
      const button = doc.createElement('button');
      button.type = 'button';
      button.textContent = label;
      const solid = variant === 'primary' || variant === 'danger';
      const background = variant === 'danger'
        ? 'var(--dsw-alias-state-error-primary, #e5484d)'
        : variant === 'primary' ? 'var(--dsw-alias-state-business-primary, #4b7bec)' : 'none';
      button.style.cssText = 'padding:6px 14px;border-radius:7px;border:1px solid var(--border-subtle, rgba(255,255,255,.14));background:' + background + ';color:' + (solid ? '#fff' : 'inherit') + ';cursor:pointer;font:inherit;';
      button.addEventListener('click', event => { event.preventDefault(); event.stopPropagation(); void onClick(button); });
      footer.append(button);
      buttons.push(button);
    }
    card.append(heading, content, footer);
    overlay.append(card);
    doc.body.append(overlay);
    return { overlay, card, buttons };
  };

  const openRename = (project, session) => {
    closeMenus();
    const input = doc.createElement('input');
    input.value = session ? (session.title || '新对话') : (project.title || project.name || project.projectId);
    input.style.cssText = 'box-sizing:border-box;width:100%;padding:6px 8px;border-radius:6px;border:1px solid var(--border-subtle, rgba(255,255,255,.16));background:transparent;color:inherit;font:inherit;';
    const { overlay } = openModal(session ? '重命名对话' : '重命名项目', input, [
      ['取消', () => overlay.remove(), null],
      ['保存', async () => {
        const title = input.value.trim();
        overlay.remove();
        try {
          await postJson('/api/no996-openfilm/editing-prefs', {
            projectId: project.projectId, ...(session ? { sessionId: session.sessionId } : {}), title,
          });
          refresh();
        } catch { /* leave the row */ }
      }, 'primary'],
    ]);
    input.focus();
    input.select?.();
  };

  const openProjectId = () => {
    try {
      const id = doc.defaultView?.localStorage?.getItem('no996.openfilm.lastProject');
      return isId(id) ? id : '';
    } catch { return ''; }
  };

  const deleteMessage = error => {
    const message = String(error?.message ?? '');
    if (message.includes('PROJECT_BUSY')) return '项目正在被使用，先关掉视频创作或 Studio 再试。';
    if (message.includes('PROJECT_NOT_OPENFILM')) return '这个目录不像是 OpenFilm 项目，已取消。';
    if (message.includes('PROJECT_PATH_INVALID')) return '项目路径不合法，已取消。';
    if (message.includes('UNKNOWN_PROJECT')) return 'Studio 里找不到这个项目，也没有它的会话绑定，已取消。先刷新一次列表再试。';
    if (message.includes('DSH_SESSION_REQUIRED')) return '登录状态过期了，刷新页面再试。';
    if (message.includes('DSH_ORIGIN_REJECTED')) return '请求来源不被信任，刷新页面再试。';
    if (message.includes('DSH_BROWSER_REQUIRED')) return '这个操作只能在浏览器窗口里做，已取消。';
    if (message.includes('DELETE_FAILED')) return '删除时出错了（Host 返回 DELETE_FAILED），详情已写进 plugin.log。';
    // Never swallow the code: "删除失败，请稍后再试" cost a whole debugging round.
    const detail = message.trim().slice(0, 80) || (error?.status ? `HTTP ${error.status}` : '未知原因');
    return `删除失败（${detail}），详情已写进 plugin.log。`;
  };

  const toast = message => {
    const node = doc.createElement('div');
    node.setAttribute(TOAST, '');
    node.textContent = message;
    node.style.cssText = 'position:fixed;left:50%;bottom:24px;transform:translateX(-50%);z-index:2147483002;max-width:min(560px,calc(100vw - 32px));padding:8px 12px;border-radius:8px;background:var(--bg-elevated,#232325);border:1px solid var(--border-subtle,rgba(255,255,255,.14));box-shadow:0 10px 30px rgba(0,0,0,.4);font:12px/1.5 system-ui,sans-serif;color:inherit;word-break:break-all;';
    doc.body.append(node);
    doc.defaultView?.setTimeout?.(() => node.remove(), 8000);
  };

  const openConfirm = (project, session) => {
    closeMenus();
    const body = doc.createElement('div');
    body.textContent = session
      ? '只删除这条对话和聊天记录；项目文件夹、film 和其它对话都不动。'
      : '删除这个项目下的全部对话和聊天记录；项目文件夹和 film 会保留。';
    const { overlay } = openModal(session ? '删除对话' : '清空对话（保留项目）', body, [
      ['取消', () => overlay.remove(), null],
      ['删除', async button => {
        button.disabled = true;
        try {
          await postJson('/api/no996-openfilm/editing-delete', {
            projectId: project.projectId, ...(session ? { sessionId: session.sessionId } : {}),
          });
          overlay.remove();
          refresh();
        } catch (failure) {
          button.disabled = false;
          toast(deleteMessage(failure));
        }
      }, 'danger'],
    ]);
  };

  const openDeleteProject = project => {
    closeMenus();
    const title = projectDisplayTitle(project);
    const count = Array.isArray(project.sessions) ? project.sessions.length : 0;
    const body = doc.createElement('div');
    const details = doc.createElement('div');
    const lines = [];
    if (typeof project.path === 'string' && project.path) lines.push(`位置：${project.path}`);
    lines.push(count
      ? `将删除 ${count} 个对话和聊天记录；项目里的 film、素材、.film/.openfilm 会一起处理。`
      : '将删除这个项目的文件夹、film、素材和其中的对话记录。');
    details.textContent = lines.join('\n');
    details.style.cssText = 'white-space:pre-wrap;word-break:break-all;';
    body.append(details);
    const choice = doc.createElement('div');
    choice.style.cssText = 'display:flex;flex-direction:column;gap:6px;margin:10px 0 4px;';
    const name = `n996-delete-${Math.random().toString(36).slice(2)}`;
    const option = (value, label, checked) => {
      const line = doc.createElement('label');
      line.style.cssText = 'display:flex;align-items:center;gap:8px;cursor:pointer;';
      const input = doc.createElement('input');
      input.type = 'radio'; input.name = name; input.value = value; input.checked = checked;
      input.style.cssText = 'margin:0;';
      const textNode = doc.createElement('span');
      textNode.textContent = label;
      line.append(input, textNode);
      choice.append(line);
      return input;
    };
    option('trash', '移入回收站（可手动找回）', true);
    const permanent = option('permanent', '彻底删除，不可恢复', false);
    body.append(choice);
    const note = doc.createElement('div');
    note.hidden = true;
    note.style.cssText = 'color:var(--dsw-alias-state-error-primary, #e5484d);margin-top:8px;';
    if (openProjectId() === project.projectId) {
      note.hidden = false;
      note.textContent = '这个项目正在视频创作里打开，请先切到别的项目再删除。';
    }
    body.append(note);
    const { overlay, buttons } = openModal(`删除项目「${title}」？`, body, [
      ['取消', () => overlay.remove(), null],
      ['删除项目', async button => {
        if (button.disabled) return;
        const original = button.textContent;
        button.disabled = true;
        button.textContent = '正在删除…';
        note.hidden = true;
        try {
          const result = await postJson('/api/no996-openfilm/editing-delete-project', {
            projectId: project.projectId, permanent: permanent.checked,
          });
          overlay.remove();
          try {
            if (openProjectId() === project.projectId) doc.defaultView?.localStorage?.removeItem('no996.openfilm.lastProject');
          } catch { /* private mode */ }
          refresh();
          toast(result?.trashPath
            ? `已删除项目「${title}」，文件已移入回收站：${result.trashPath}`
            : `已彻底删除项目「${title}」。`);
        } catch (failure) {
          button.disabled = false;
          button.textContent = original;
          note.hidden = false;
          note.style.color = 'var(--dsw-alias-state-error-primary, #e5484d)';
          note.textContent = deleteMessage(failure);
        }
      }, 'danger'],
    ]);
    if (openProjectId() === project.projectId) {
      const primary = buttons[1];
      primary.disabled = true;
      primary.style.opacity = '.5';
    }
  };

  /**
   * The editing area is a list, not a workspace browser: only the shipped search
   * stays in the header. Hide the view-options and add-workspace buttons one by
   * one — the button group is not always the same element across DSH versions,
   * and React may recreate a button after the first pass.
   */
  const syncHeaderActions = () => {
    if (!mounted) return;
    const { header, actions } = mounted;
    // Query the input each pass: React may replace the search element.
    let searchRoot = header.querySelector('input');
    while (searchRoot?.parentElement && searchRoot.parentElement !== header) {
      searchRoot = searchRoot.parentElement;
    }
    const editing = mode === 'editing';
    for (const button of header.querySelectorAll('button')) {
      if (button === trigger) continue;
      if (searchRoot?.contains(button)) continue;
      button.style.display = editing ? 'none' : '';
    }
    if (actions) actions.style.display = editing ? 'none' : '';
  };

  const applyMode = () => {
    if (!mounted || !trigger) return;
    const { span, header } = mounted;
    trigger.replaceChildren();
    const triggerLabel = doc.createElement('span');
    triggerLabel.textContent = mode === 'editing' ? EDITING_LABEL : '工作区';
    const triggerCaret = icon('chevron', 12);
    triggerCaret.classList.add('n996-trigger-chevron');
    trigger.append(triggerLabel, triggerCaret);
    trigger.setAttribute('aria-haspopup', 'menu');
    trigger.setAttribute('aria-expanded', popover ? 'true' : 'false');
    trigger.setAttribute('aria-label', mode === 'editing' ? '切换到工作区列表' : `切换到${EDITING_LABEL}`);
    // A highlighted chip, not a bare label: the editing area is a mode, and the
    // box makes the current side visible at a glance.
    trigger.style.padding = '2px 6px';
    trigger.style.borderRadius = '6px';
    trigger.style.background = mode === 'editing' ? 'var(--dsw-alias-interactive-bg-hover, rgba(127,127,127,.16))' : 'none';
    // Our button carries the name in both modes; the shipped label stays hidden.
    span.style.display = 'none';
    if (mode === 'editing') header.setAttribute('data-no996-editing', '');
    else header.removeAttribute('data-no996-editing');
    // Reserve the chip's slot no matter whether the search is closed. Measure
    // after the text/padding settle, then again next frame in case a webfont
    // changed the label width.
    const measure = () => {
      const width = trigger.getBoundingClientRect().width;
      if (width > 0) header.style.setProperty('--n996-switch-w', `${Math.ceil(width) + 6}px`);
    };
    measure();
    doc.defaultView?.requestAnimationFrame?.(measure);
    syncHeaderActions();
    const container = listContainer(header);
    restoreHidden();
    if (mode === 'editing') {
      // Everything after the header is the shipped list (plus any wrappers the
      // version adds); hide all of it, then show ours as the only list.
      for (let node = header.nextElementSibling; node; node = node.nextElementSibling) {
        if (node === container) continue;
        hidden.push(node);
        node.style.display = 'none';
      }
      container.style.display = 'block';
      void load(container);
    } else {
      container.style.display = 'none';
    }
  };

  const setMode = next => {
    mode = next === 'editing' ? 'editing' : 'workspaces';
    try { doc.defaultView?.localStorage?.setItem(MODE_KEY, mode); } catch { /* private mode */ }
    applyMode();
  };

  const openPopover = () => {
    closePopover();
    if (!trigger) return;
    trigger.classList.add('n996-open');
    trigger.setAttribute('aria-expanded', 'true');
    popover = doc.createElement('div');
    popover.setAttribute(POPOVER, '');
    popover.setAttribute('role', 'menu');
    popover.style.cssText = 'position:fixed;z-index:2147483000;min-width:210px;padding:4px;border-radius:8px;background:var(--bg-elevated, #232325);border:1px solid var(--border-subtle, rgba(255,255,255,.12));box-shadow:0 10px 30px rgba(0,0,0,.45);font:13px system-ui,sans-serif;color:inherit;';
    const item = (label, value, iconName) => {
      const button = doc.createElement('button');
      button.type = 'button';
      button.setAttribute('role', 'menuitemradio');
      button.setAttribute('aria-checked', mode === value ? 'true' : 'false');
      button.style.cssText = 'display:flex;align-items:center;gap:8px;width:100%;padding:7px 9px;border:0;border-radius:6px;background:none;color:inherit;text-align:left;cursor:pointer;font:inherit;transition:background-color .12s ease;';
      if (iconName) button.append(icon(iconName, 15));
      const textNode = doc.createElement('span');
      textNode.style.cssText = 'flex:1 1 auto;min-width:0;';
      textNode.textContent = label;
      button.append(textNode);
      if (mode === value) {
        const dot = icon('dot', 10);
        dot.style.color = 'var(--dsw-alias-state-business-primary, #4b7bec)';
        button.append(dot);
      }
      button.addEventListener('mouseenter', () => { button.style.background = 'var(--bg-hover, rgba(127,127,127,.14))'; });
      button.addEventListener('mouseleave', () => { button.style.background = 'none'; });
      button.addEventListener('click', event => {
        event.preventDefault();
        event.stopPropagation();
        setMode(value);
        closePopover();
      });
      popover.append(button);
    };
    item('工作区', 'workspaces', 'grid');
    item(EDITING_LABEL, 'editing', 'clapper');
    const rect = trigger.getBoundingClientRect();
    popover.style.left = `${Math.max(8, Math.min(rect.left, (doc.defaultView?.innerWidth ?? 1200) - 230))}px`;
    popover.style.top = `${Math.round(rect.bottom + 4)}px`;
    doc.body.append(popover);
    const dismiss = event => {
      if (popover && !popover.contains(event.target) && event.target !== trigger) {
        closePopover();
        doc.removeEventListener('pointerdown', dismiss, true);
      }
    };
    doc.addEventListener('pointerdown', dismiss, true);
  };

  const mount = () => {
    const found = findHeader(doc);
    if (!found) { cleanup(); return; }
    if (mounted && mounted.header === found.header && mounted.span === found.span
      && trigger?.isConnected && list?.isConnected) {
      // A re-render may recreate a header button; keep the editing header trimmed.
      syncHeaderActions();
      return;
    }
    // A re-render may have replaced the label without removing our nodes; start
    // from a clean slate so exactly one trigger and one list exist.
    cleanup();
    ensureStyle();
    const { span, header, actions } = found;
    header.setAttribute(SWITCH_HOST, '');
    trigger = doc.createElement('button');
    trigger.type = 'button';
    trigger.setAttribute(SWITCH, '');
    trigger.style.cssText = 'display:inline-flex;align-items:center;gap:4px;flex:none;min-width:max-content;padding:0 2px;margin:0;border:0;background:none;color:inherit;font:inherit;font-size:inherit;line-height:inherit;cursor:pointer;white-space:nowrap;';
    trigger.addEventListener('click', event => {
      event.preventDefault();
      event.stopPropagation();
      if (popover) closePopover(); else openPopover();
    });
    trigger.addEventListener('mouseenter', () => {
      trigger.style.background = mode === 'editing'
        ? 'var(--dsw-alias-interactive-bg-hover, rgba(127,127,127,.22))'
        : 'var(--bg-hover, rgba(127,127,127,.12))';
    });
    trigger.addEventListener('mouseleave', () => {
      trigger.style.background = mode === 'editing' ? 'var(--dsw-alias-interactive-bg-hover, rgba(127,127,127,.16))' : 'none';
    });
    span.parentElement?.insertBefore(trigger, span);
    span.style.display = 'none';
    mounted = { span, header, actions };
    listContainer(header);
    // The shipped search filters our list while the editing area is showing.
    onSearch = event => {
      if (mode !== 'editing') return;
      const value = event.target?.value;
      if (typeof value !== 'string') return;
      query = value;
      if (list) renderRows(list, projects);
    };
    header.addEventListener('input', onSearch, true);
    // Choosing the video tab is the same intent as choosing the editing area.
    onDocumentClick = event => {
      const target = event.target?.closest?.('button, [role="button"], a');
      if (target && PANEL_LABELS.has(text(target.textContent)) && mode !== 'editing') setMode('editing');
    };
    doc.addEventListener('click', onDocumentClick, true);
    applyMode();
  };

  let scheduled = false;
  const schedule = () => {
    if (scheduled) return;
    scheduled = true;
    const run = () => { scheduled = false; mount(); };
    if (typeof doc.defaultView?.requestAnimationFrame === 'function') doc.defaultView.requestAnimationFrame(run);
    else setTimeout(run, 50);
  };
  observer = new (doc.defaultView?.MutationObserver ?? MutationObserver)(schedule);
  observer.observe(doc.body ?? doc.documentElement, { childList: true, subtree: true });
  mount();

  return () => {
    observer?.disconnect();
    cleanup();
  };
}
