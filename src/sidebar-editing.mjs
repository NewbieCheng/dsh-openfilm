// The sidebar's Workspace header, turned into a two-way switch:
//
//   工作区 ▾  ──▶  工作区（默认，DSH 自己的列表）
//                 OpenFilm 素材剪辑区（本项目绑定的剪辑会话）
//
// This is a narrow B2 injection, not a replacement of the shipped Workspace
// browser: it finds the section label by its text and by its parent (which holds
// the search input and the filter/add buttons), hides only that label, and puts
// a button in its place. In the editing area the shipped search field filters
// our list, the shipped view-options button opens our own menu, and the shipped
// list is hidden behind ours. Choosing the workspace area restores everything.
//
// React re-renders this header (the label flips between "工作区" and "会话"), so
// every pass starts by removing all previously injected nodes. That is what
// keeps one trigger and one list: a stale trigger left in place is what made the
// header read "素材剪辑区 ▾ 工作区 ▾" in 0.13.2.

import { areaBus } from './area-bus.mjs';

const SWITCH = 'data-no996-workspace-switch';
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

const text = value => (typeof value === 'string' ? value.trim() : '');
const isId = value => typeof value === 'string' && /^[A-Za-z0-9_-]{6,40}$/.test(value);

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
  let mounted = null;
  let trigger = null;
  let list = null;
  let popover = null;
  let loading = false;
  let observer = null;
  let hidden = [];
  let folderButton = null;
  let style = null;
  let onDocumentClick = null;
  let onSearch = null;

  const postJson = async (path, body) => {
    const response = await fetch(path, {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return response.json().catch(() => ({}));
  };

  const restoreHidden = () => {
    for (const node of hidden) { try { node.style.display = ''; } catch { /* gone */ } }
    hidden = [];
    if (folderButton) { try { folderButton.style.display = ''; } catch { /* gone */ } }
  };

  const closePopover = () => {
    if (popover) { popover.remove(); popover = null; }
  };

  const closeMenus = () => {
    for (const node of doc.querySelectorAll(`[${VIEW_MENU}], [${ROW_MENU}], [${MODAL}]`)) node.remove();
  };

  /** Remove every injected node and undo every hide. Idempotent and cheap. */
  const cleanup = () => {
    closePopover();
    closeMenus();
    for (const node of doc.querySelectorAll(`[${SWITCH}], [${POPOVER}], [${LIST}], [${STYLE}]`)) node.remove();
    restoreHidden();
    if (mounted?.span) mounted.span.style.display = '';
    if (mounted?.header) mounted.header.removeAttribute('data-no996-editing');
    if (mounted?.header && onSearch) { try { mounted.header.removeEventListener('input', onSearch, true); } catch { /* gone */ } }
    if (onDocumentClick) { try { doc.removeEventListener('click', onDocumentClick, true); } catch { /* gone */ } }
    trigger = null; list = null; mounted = null; style = null; folderButton = null; onSearch = null; onDocumentClick = null;
  };

  /** Rules that keep the header readable while the shipped search expands. */
  const ensureStyle = () => {
    if (style?.isConnected) return;
    style = doc.createElement('style');
    style.setAttribute(STYLE, '');
    style.textContent = [
      '[data-no996-editing] [class*="_sectionLabelHidden"]{opacity:1!important;visibility:visible!important;max-width:45%!important;margin-right:0!important;transform:none!important}',
      '[data-no996-editing] [class*="_headerActionsHidden"]{opacity:1!important;visibility:visible!important;max-width:60px!important;transform:none!important;pointer-events:auto!important}',
      '[data-no996-editing] [data-no996-workspace-switch]{flex:none}',
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

  const filtered = () => {
    const needle = query.trim().toLowerCase();
    let rows = projects.filter(project => {
      if (!view.archived && project.archived) return false;
      if (!needle) return true;
      const title = project.title || project.name || project.projectId;
      return [title, project.name, project.path, project.sessionId, project.projectId]
        .some(value => typeof value === 'string' && value.toLowerCase().includes(needle));
    });
    if (view.sort === 'name') {
      rows = [...rows].sort((left, right) => (left.title || left.name || '').localeCompare(right.title || right.name || '', 'zh-CN'));
    }
    return rows;
  };

  const renderRows = (container, next) => {
    projects = Array.isArray(next) ? next : [];
    container.replaceChildren();
    const rows = filtered();
    if (!rows.length) {
      const empty = doc.createElement('div');
      empty.textContent = query ? '没有匹配的会话。' : '还没有剪辑会话：先在视频创作里打开一个项目。';
      empty.style.cssText = 'padding:8px 10px;font-size:12px;opacity:.6;';
      container.append(empty);
      return;
    }
    for (const project of rows) {
      const wrapper = doc.createElement('div');
      wrapper.style.cssText = 'display:flex;align-items:stretch;gap:2px;border-radius:6px;';
      const row = doc.createElement('button');
      row.type = 'button';
      row.style.cssText = 'display:flex;flex-direction:column;align-items:flex-start;gap:2px;flex:1 1 auto;min-width:0;padding:7px 8px;border:0;border-radius:6px;background:none;color:inherit;text-align:left;cursor:pointer;font:inherit;';
      const name = doc.createElement('span');
      name.textContent = (project.pinned ? '📌 ' : '') + (project.archived ? '已归档 · ' : '') + (project.title || project.name || project.projectId);
      name.style.cssText = 'font-size:13px;line-height:1.3;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:100%;';
      row.append(name);
      if (view.path && project.path) {
        const path = doc.createElement('span');
        path.textContent = project.path;
        path.style.cssText = 'font-size:11px;opacity:.5;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:100%;';
        row.append(path);
      }
      row.addEventListener('mouseenter', () => { row.style.background = 'var(--bg-hover, rgba(127,127,127,.12))'; });
      row.addEventListener('mouseleave', () => { row.style.background = 'none'; });
      row.addEventListener('click', event => {
        event.preventDefault();
        event.stopPropagation();
        try { doc.defaultView?.localStorage?.setItem('no996.openfilm.lastProject', project.projectId); } catch { /* private mode */ }
        // Ask the panel to show the project; a request made before the panel is
        // mounted is queued by the bus and flushed when it becomes ready.
        areaBus.navigate(project.projectId);
        findPanelEntry(doc)?.click();
        closePopover();
        closeMenus();
      });
      const more = doc.createElement('button');
      more.type = 'button';
      more.textContent = '⋯';
      more.setAttribute('aria-label', '会话操作');
      more.style.cssText = 'flex:none;width:24px;border:0;border-radius:6px;background:none;color:inherit;opacity:0;cursor:pointer;font:inherit;font-size:15px;line-height:1;';
      wrapper.addEventListener('mouseenter', () => { more.style.opacity = '.75'; });
      wrapper.addEventListener('mouseleave', () => { more.style.opacity = '0'; });
      more.addEventListener('click', event => {
        event.preventDefault();
        event.stopPropagation();
        openRowMenu(more, project);
      });
      wrapper.append(row, more);
      container.append(wrapper);
    }
  };

  const load = async container => {
    if (loading) return;
    loading = true;
    const waiting = doc.createElement('div');
    waiting.textContent = '正在读取剪辑会话…';
    waiting.style.cssText = 'padding:8px 10px;font-size:12px;opacity:.6;';
    container.replaceChildren(waiting);
    try {
      const data = await fetchSessions?.();
      renderRows(container, Array.isArray(data?.projects) ? data.projects : []);
    } catch {
      const failed = doc.createElement('div');
      failed.textContent = '读取失败，稍后再试。';
      failed.style.cssText = 'padding:8px 10px;font-size:12px;color:#e07b5a;';
      container.replaceChildren(failed);
    } finally {
      loading = false;
    }
  };

  const refresh = () => { if (list) void load(list); };

  const menuButton = (parent, label, onClick, checked) => {
    const button = doc.createElement('button');
    button.type = 'button';
    button.style.cssText = 'display:flex;align-items:center;justify-content:space-between;gap:10px;width:100%;padding:7px 10px;border:0;border-radius:6px;background:none;color:inherit;text-align:left;cursor:pointer;font:inherit;';
    button.textContent = label;
    if (checked) {
      const check = doc.createElement('span');
      check.textContent = '✓';
      check.style.cssText = 'opacity:.8;';
      button.append(check);
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
    menuButton(menu, '排序：最近更新', () => { view = { ...view, sort: 'recent' }; saveView(); refresh(); }, view.sort === 'recent');
    menuButton(menu, '排序：名称', () => { view = { ...view, sort: 'name' }; saveView(); refresh(); }, view.sort === 'name');
    menuButton(menu, '显示已归档', () => { view = { ...view, archived: !view.archived }; saveView(); refresh(); }, view.archived);
    menuButton(menu, '显示路径', () => { view = { ...view, path: !view.path }; saveView(); refresh(); }, view.path);
  };

  const saveView = () => {
    try { doc.defaultView?.localStorage?.setItem(VIEW_KEY, JSON.stringify(view)); } catch { /* private mode */ }
  };

  const openRowMenu = (anchor, project) => {
    closeMenus();
    const menu = openMenuAt(anchor, ROW_MENU);
    menuButton(menu, project.pinned ? '取消置顶' : '置顶', async () => {
      try { await postJson('/api/no996-openfilm/editing-prefs', { projectId: project.projectId, pinned: !project.pinned }); refresh(); } catch { /* leave the row */ }
    });
    menuButton(menu, '重命名…', () => openRename(project));
    menuButton(menu, project.archived ? '恢复会话' : '归档会话', async () => {
      try { await postJson('/api/no996-openfilm/editing-archive', { projectId: project.projectId, archived: !project.archived }); refresh(); } catch { /* leave the row */ }
    });
    menuButton(menu, '删除会话…', () => openConfirm(project));
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
    for (const [label, onClick, primary] of actions) {
      const button = doc.createElement('button');
      button.type = 'button';
      button.textContent = label;
      button.style.cssText = 'padding:6px 14px;border-radius:7px;border:1px solid var(--border-subtle, rgba(255,255,255,.14));background:' + (primary ? 'var(--dsw-alias-state-business-primary, #4b7bec)' : 'none') + ';color:inherit;cursor:pointer;font:inherit;';
      button.addEventListener('click', event => { event.preventDefault(); event.stopPropagation(); onClick(); });
      footer.append(button);
    }
    card.append(heading, content, footer);
    overlay.append(card);
    doc.body.append(overlay);
    return { overlay, card };
  };

  const openRename = project => {
    closeMenus();
    const input = doc.createElement('input');
    input.value = project.title || project.name || project.projectId;
    input.style.cssText = 'box-sizing:border-box;width:100%;padding:6px 8px;border-radius:6px;border:1px solid var(--border-subtle, rgba(255,255,255,.16));background:transparent;color:inherit;font:inherit;';
    const { overlay } = openModal('重命名会话', input, [
      ['取消', () => overlay.remove(), false],
      ['保存', async () => {
        const title = input.value.trim();
        overlay.remove();
        try { await postJson('/api/no996-openfilm/editing-prefs', { projectId: project.projectId, title }); refresh(); } catch { /* leave the row */ }
      }, true],
    ]);
    input.focus();
    input.select?.();
  };

  const openConfirm = project => {
    closeMenus();
    const body = doc.createElement('div');
    body.textContent = '只删除这条会话和聊天记录，项目文件夹和 film 会保留。';
    const { overlay } = openModal('删除会话', body, [
      ['取消', () => overlay.remove(), false],
      ['删除', async () => {
        overlay.remove();
        try { await postJson('/api/no996-openfilm/editing-delete', { projectId: project.projectId }); refresh(); } catch { /* leave the row */ }
      }, true],
    ]);
  };

  const applyMode = () => {
    if (!mounted || !trigger) return;
    const { span, header, actions } = mounted;
    trigger.textContent = mode === 'editing' ? '素材剪辑区 ▾' : '工作区 ▾';
    trigger.setAttribute('aria-label', mode === 'editing' ? '切换到工作区列表' : '切换到 OpenFilm 素材剪辑区');
    // Our button carries the name in both modes; the shipped label stays hidden.
    span.style.display = 'none';
    if (mode === 'editing') header.setAttribute('data-no996-editing', '');
    else header.removeAttribute('data-no996-editing');
    ensureStyle();
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
      // The add-folder button groups shipped sessions; the editing area has no
      // folder concept, so it stays out of the way while we are showing it.
      folderButton = actions?.querySelectorAll('button')?.[1] ?? null;
      if (folderButton) folderButton.style.display = 'none';
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
    popover = doc.createElement('div');
    popover.setAttribute(POPOVER, '');
    popover.style.cssText = 'position:fixed;z-index:2147483000;min-width:210px;padding:4px;border-radius:8px;background:var(--bg-elevated, #232325);border:1px solid var(--border-subtle, rgba(255,255,255,.12));box-shadow:0 10px 30px rgba(0,0,0,.45);font:13px system-ui,sans-serif;color:inherit;';
    const item = (label, value) => {
      const button = doc.createElement('button');
      button.type = 'button';
      button.style.cssText = 'display:flex;align-items:center;justify-content:space-between;gap:10px;width:100%;padding:7px 10px;border:0;border-radius:6px;background:none;color:inherit;text-align:left;cursor:pointer;font:inherit;';
      button.textContent = label;
      if (mode === value) {
        const check = doc.createElement('span');
        check.textContent = '✓';
        check.style.cssText = 'opacity:.8;';
        button.append(check);
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
    item('工作区', 'workspaces');
    item('OpenFilm 素材剪辑区', 'editing');
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
      && trigger?.isConnected && list?.isConnected) return;
    // A re-render may have replaced the label without removing our nodes; start
    // from a clean slate so exactly one trigger and one list exist.
    cleanup();
    const { span, header, actions } = found;
    trigger = doc.createElement('button');
    trigger.type = 'button';
    trigger.setAttribute(SWITCH, '');
    trigger.style.cssText = 'display:inline-flex;align-items:center;gap:4px;padding:0 2px;margin:0;border:0;background:none;color:inherit;font:inherit;font-size:inherit;line-height:inherit;cursor:pointer;white-space:nowrap;';
    trigger.addEventListener('click', event => {
      event.preventDefault();
      event.stopPropagation();
      if (popover) closePopover(); else openPopover();
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
    // The shipped view-options button opens our menu for the editing list.
    const viewButton = actions?.querySelector('button') ?? null;
    if (viewButton) {
      viewButton.addEventListener('click', event => {
        if (mode !== 'editing') return;
        event.preventDefault();
        event.stopPropagation();
        openViewMenu(viewButton);
      }, true);
    }
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
