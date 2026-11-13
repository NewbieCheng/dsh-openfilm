// The sidebar's Workspace header, turned into a two-way switch:
//
//   工作区 ▾  ──▶  工作区（默认，DSH 自己的列表）
//                 OpenFilm 素材剪辑区（本项目绑定的剪辑会话）
//
// This is a narrow B2 injection, not a replacement of the shipped Workspace
// browser: it finds the section label by its text and by its parent (which holds
// the search input and the filter/add buttons), hides only that label, and puts
// a button in its place. The search field, the view-options menu and the add
// button are never touched. Choosing the editing area hides every sibling after
// the header (the shipped list container) and shows our list of projects that
// already have an ACP Session; clicking one asks the video panel to open that
// project, and the panel resumes the Session the Host has bound to it.
//
// React re-renders this header (the label flips between "工作区" and "会话"), so
// every pass starts by removing all previously injected nodes. That is what
// keeps one trigger and one list: a stale trigger left in place is what made the
// header read "素材剪辑区 ▾ 工作区 ▾" in 0.13.2.

import { areaBus } from './area-bus.mjs';

const SWITCH = 'data-no996-workspace-switch';
const POPOVER = 'data-no996-workspace-popover';
const LIST = 'data-no996-editing-list';
const MODE_KEY = 'no996.openfilm.sidebarMode';
const LABELS = new Set(['工作区', '会话']);
const PANEL_LABELS = new Set(['视频创作', 'Video studio']);

const text = value => (typeof value === 'string' ? value.trim() : '');

/** The Workspace header: a label whose parent also holds the search input and the
 *  filter/add buttons. Matching on structure keeps us off hashed CSS classes. */
function findHeader(doc) {
  for (const span of doc.querySelectorAll('span')) {
    if (!LABELS.has(text(span.textContent))) continue;
    const header = span.parentElement;
    if (!header || !header.querySelector('input')) continue;
    if (header.querySelectorAll('button').length < 2) continue;
    return { span, header };
  }
  return null;
}

function findPanelEntry(doc) {
  for (const element of doc.querySelectorAll('button, [role="button"], a')) {
    if (PANEL_LABELS.has(text(element.textContent))) return element;
  }
  return null;
}

export function installWorkspaceSwitch({ document: doc, fetchSessions } = {}) {
  if (!doc || typeof doc.createElement !== 'function') return () => {};
  let mode = 'workspaces';
  try { mode = doc.defaultView?.localStorage?.getItem(MODE_KEY) === 'editing' ? 'editing' : 'workspaces'; } catch { /* private mode */ }
  let mounted = null;
  let trigger = null;
  let list = null;
  let popover = null;
  let loading = false;
  let observer = null;
  /** Elements hidden by the editing mode, restored when the workspace returns. */
  let hidden = [];

  const restoreHidden = () => {
    for (const node of hidden) { try { node.style.display = ''; } catch { /* gone */ } }
    hidden = [];
  };

  const closePopover = () => {
    if (popover) { popover.remove(); popover = null; }
  };

  /** Remove every injected node and undo every hide. Idempotent and cheap. */
  const cleanup = () => {
    closePopover();
    for (const node of doc.querySelectorAll(`[${SWITCH}], [${POPOVER}], [${LIST}]`)) node.remove();
    restoreHidden();
    if (mounted?.span) mounted.span.style.display = '';
    trigger = null; list = null; mounted = null;
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

  const renderRows = (container, projects) => {
    container.replaceChildren();
    if (!projects.length) {
      const empty = doc.createElement('div');
      empty.textContent = '还没有剪辑会话：先在视频创作里打开一个项目。';
      empty.style.cssText = 'padding:8px 10px;font-size:12px;opacity:.6;';
      container.append(empty);
      return;
    }
    for (const project of projects) {
      const row = doc.createElement('button');
      row.type = 'button';
      row.style.cssText = 'display:flex;flex-direction:column;align-items:flex-start;gap:2px;width:100%;padding:7px 10px;border:0;border-radius:6px;background:none;color:inherit;text-align:left;cursor:pointer;font:inherit;';
      const name = doc.createElement('span');
      name.textContent = (project.archived ? '已归档 · ' : '') + (project.name || project.projectId);
      name.style.cssText = 'font-size:13px;line-height:1.3;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:100%;';
      const path = doc.createElement('span');
      path.textContent = project.path || '';
      path.style.cssText = 'font-size:11px;opacity:.5;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:100%;';
      row.append(name, path);
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
      });
      container.append(row);
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

  const applyMode = () => {
    if (!mounted || !trigger) return;
    const { span, header } = mounted;
    trigger.textContent = mode === 'editing' ? '素材剪辑区 ▾' : '工作区 ▾';
    trigger.setAttribute('aria-label', mode === 'editing' ? '切换到工作区列表' : '切换到 OpenFilm 素材剪辑区');
    // Our button carries the name in both modes; the shipped label stays hidden.
    span.style.display = 'none';
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
    const { span, header } = found;
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
    mounted = { span, header };
    listContainer(header);
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
