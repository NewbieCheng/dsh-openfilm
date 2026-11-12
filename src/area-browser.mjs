// The Workspace block, switching between two views by the active page tag:
//
//   video studio open  → 剪辑素材区: one row per project, its conversation as
//                        the secondary line, search, and a tab back
//   any other page     → 工作区: the normal Workspace list, with project
//                        conversations left out (they live in the editing area)
//
// Why the block is ours at all: DSH's `sidebar.workspaces` is a single slot and
// a single slot renders only its lowest-priority live entry, so a view that
// switches inside the block must be the occupant. Nothing is redrawn by hand
// though — the official `ui-workspace` CSS module has already published its
// classes into the document, so the class names are read back at runtime and
// reused; the icons come from `@deepseek-ai/dsh-client-ui-primitives`, the same
// components the shipped browser renders. If either lookup fails (a DSH build
// that renames things) a compact fallback stylesheet takes over instead of
// rendering unstyled rows.
import { areaBus } from './area-bus.mjs';
import {
  filterArea, parseAreaPayload, searchProjects, sessionTitle, sortProjects,
} from './area-client.mjs';

const PANEL = 'no996-openfilm';
const STYLE_TAG = 'no996-openfilm-area-fallback';

/** The hash prefix the official CSS modules were emitted with, if present. */
export function discoverPrefixes(doc = typeof document === 'undefined' ? undefined : document) {
  if (!doc) return { rows: null, browser: null };
  let css = '';
  for (const tag of doc.querySelectorAll('style[data-plugin-css*="ui-workspace"]')) css += `${tag.textContent}\n`;
  const pick = name => {
    const match = new RegExp(`\\.([A-Za-z][\\w-]*)_${name}\\b`).exec(css);
    return match ? match[1] : null;
  };
  return { rows: pick('projectRow'), browser: pick('sectionHeader') };
}

function classes(prefixes) {
  const from = (prefix, names, fallback) => names.map(name => (prefix ? `${prefix}_${name}` : `${fallback}-${name}`)).join(' ');
  const rows = name => (prefixes.rows ? `${prefixes.rows}_${name}` : `nof-${name}`);
  const browser = name => (prefixes.browser ? `${prefixes.browser}_${name}` : `nof-${name}`);
  return {
    rows, browser, from,
    row: rows('projectRow'), session: rows('sessionRow'), selected: rows('selected'),
    slot: rows('slot'), title: rows('title'), meta: rows('meta'), text: rows('projectText'),
    folder: rows('folder'), arrow: rows('arrow'), arrowOpen: rows('arrowOpen'),
    actions: rows('rowActions'), dot: rows('dot'),
    root: browser('root'), header: browser('sectionHeader'), label: browser('sectionLabel'),
    iconButton: browser('iconButton'), search: browser('search'), searchInput: browser('searchInput'),
    list: browser('list'),
  };
}

const FALLBACK_CSS = `
.nof-root{box-sizing:border-box;min-height:0;flex:1;display:flex;flex-direction:column;padding-right:var(--dsh-session-list-edge-inset,var(--dsh-sidebar-inline-padding,8px));color:var(--dsw-alias-label-primary)}
.nof-sectionHeader{height:36px;display:flex;align-items:center;gap:4px;padding-left:var(--dsh-sidebar-row-padding,12px);margin-bottom:4px;color:var(--dsw-alias-label-tertiary);flex:none}
.nof-sectionLabel{flex:1;min-width:0;font-size:12px;line-height:20px;font-weight:500;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.nof-iconButton{width:28px;height:28px;border:0;border-radius:var(--dsw-radius-sm);background:0 0;color:var(--dsw-alias-label-secondary);display:inline-flex;align-items:center;justify-content:center;flex:none;cursor:pointer}
.nof-iconButton:hover{background:var(--dsw-alias-interactive-bg-hover)}
.nof-search{height:32px;display:flex;align-items:center;gap:4px;margin:0 4px 4px;padding:0 4px 0 8px;border:.5px solid var(--dsw-alias-border-l4);border-radius:var(--dsw-radius-md);color:var(--dsw-alias-label-caption)}
.nof-searchInput{flex:1;min-width:0;border:0;outline:none;background:0 0;color:var(--dsw-alias-label-primary);font:inherit;font-size:13px;line-height:18px}
.nof-list{flex:1;min-height:0;overflow-y:auto;margin-left:-4px;padding:0 0 16px 4px;scrollbar-gutter:stable}
.nof-projectRow{display:flex;align-items:center;gap:var(--dsh-sidebar-label-gap,6px);height:34px;padding:0 8px;padding-inline-start:calc(var(--dsh-sidebar-row-padding,12px) - var(--dsh-sidebar-paint-inset,0px));border-radius:var(--dsw-radius-md);color:var(--dsw-alias-label-primary);cursor:pointer;-webkit-user-select:none;user-select:none;position:relative}
.nof-projectRow:hover{background:var(--dsw-alias-interactive-bg-hover)}
.nof-sessionRow{display:flex;align-items:center;height:32px;padding:0 8px;padding-inline-start:calc(var(--dsh-sidebar-row-padding,12px) - var(--dsh-sidebar-paint-inset,0px) + 22px);border-radius:var(--dsw-radius-md);cursor:pointer}
.nof-sessionRow:hover{background:var(--dsw-alias-interactive-bg-hover)}
.nof-sessionRow.nof-selected{background:var(--dsw-alias-interactive-bg-hover)}
.nof-slot{width:16px;height:20px;flex:none;display:inline-flex;align-items:center;justify-content:center;color:var(--dsw-alias-label-tertiary)}
.nof-projectText{display:flex;flex-direction:column;flex:1;min-width:0;gap:2px}
.nof-title{font-size:14px;line-height:20px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.nof-sessionRow .nof-title{flex:1;margin-left:var(--dsh-sidebar-label-gap,6px)}
.nof-meta{font-size:12px;line-height:20px;color:var(--dsw-alias-label-tertiary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.nof-arrow{transition:transform .15s var(--ds-ease-in-out,ease)}
.nof-arrowOpen{transform:rotate(90deg)}
.nof-rowActions{flex:none;display:none;align-items:center;gap:13px}
.nof-projectRow:hover .nof-rowActions,.nof-menuOpen .nof-rowActions{display:inline-flex}
.nof-section{padding:6px var(--dsh-sidebar-row-padding,12px) 2px;font-size:12px;line-height:20px;color:var(--dsw-alias-label-tertiary)}
.nof-empty{padding:12px var(--dsh-sidebar-row-padding,12px);font-size:12.5px;line-height:1.7;color:var(--dsw-alias-label-tertiary)}
.nof-menu{position:absolute;right:4px;top:30px;z-index:30;min-width:168px;padding:4px;border:1px solid var(--dsw-alias-border-l4);border-radius:var(--dsw-radius-md);background:var(--dsw-alias-bg-layer-2,var(--dsw-alias-bg-base));box-shadow:0 8px 24px #0006}
.nof-menu button{display:block;width:100%;padding:6px 8px;border:0;border-radius:var(--dsw-radius-sm);background:0 0;color:var(--dsw-alias-label-primary);text-align:left;font:inherit;font-size:12.5px;line-height:20px;cursor:pointer}
.nof-menu button:hover{background:var(--dsw-alias-interactive-bg-hover)}
`;

/** Always injected: it styles our own bits (menu, section label, empty state)
 * and covers a DSH build whose class prefixes cannot be found. */
export function ensureFallbackStyles(doc = typeof document === 'undefined' ? undefined : document) {
  if (!doc || doc.querySelector(`style[data-no996="${STYLE_TAG}"]`)) return;
  const tag = doc.createElement('style');
  tag.dataset.no996 = STYLE_TAG;
  tag.textContent = FALLBACK_CSS;
  doc.head.appendChild(tag);
}

/**
 * @param {object} React
 * @param {object} deps
 * @param {(key: string) => string} deps.t
 * @param {() => Promise<object>} deps.fetchArea
 * @param {(projectId: string) => void} deps.openProject
 * @param {(sessionId: string) => boolean} deps.openSession
 * @param {() => void} deps.openPanel
 * @param {Storage|undefined} deps.storage
 * @param {object} [deps.primitives] icon components from @deepseek-ai/dsh-client-ui-primitives
 */
export function createAreaBrowser(React, deps) {
  const { t, fetchArea, openProject, openSession, openPanel, primitives, panelSnapshot } = deps;
  const h = React.createElement;
  const C = classes(discoverPrefixes());
  const prim = primitives ?? {};
  const icon = (name, size = 14) => {
    const Component = prim[name];
    return Component ? h(Component, { size }) : null;
  };

  return function AreaBrowser(props) {
    const useSessions = props?.useSessions;
    const useWorkspaces = props?.useWorkspaces;
    const usePanelInfo = props?.usePanelInfo;
    const list = typeof useSessions === 'function' ? useSessions(state => state) : null;
    const wsState = typeof useWorkspaces === 'function' ? useWorkspaces(state => state) : null;
    const usePanel = typeof usePanelInfo === 'function' ? usePanelInfo : null;
    const [polled, setPolled] = React.useState(null);
    // The shell hands the sidebar its own `usePanelInfo`; if a build ever stops
    // doing that, follow the layout store directly rather than freezing on
    // "Workspaces" forever.
    React.useEffect(() => {
      if (usePanel || typeof panelSnapshot !== 'function') return undefined;
      const read = () => setPolled(panelSnapshot());
      read();
      const timer = setInterval(read, 600);
      return () => clearInterval(timer);
    }, []);
    const activePanel = usePanel ? usePanel(info => info?.activePanelId ?? null) : polled;
    const videoActive = activePanel === PANEL;
    const [area, setArea] = React.useState(() => ({ projects: [], hidden: [] }));
    const [loading, setLoading] = React.useState(true);
    const [query, setQuery] = React.useState('');
    const [searching, setSearching] = React.useState(false);
    const [menu, setMenu] = React.useState(null);
    const [collapsed, setCollapsed] = React.useState(() => new Set());
    const [override, setOverride] = React.useState(null);
    const [revision, setRevision] = React.useState(0);
    // The block follows the page tag; a manual choice lasts until the tag
    // changes again, then the automatic behaviour comes back.
    const taggedVideo = React.useRef(videoActive);
    if (taggedVideo.current !== videoActive) {
      taggedVideo.current = videoActive;
      setOverride(null);
    }
    const activeId = React.useMemo(() => {
      if (!list?.byId) return null;
      for (const id of Object.keys(list.byId)) {
        if ((list.byId[id]?.retainedBy?.mainView ?? 0) > 0) return id;
      }
      return null;
    }, [list]);
    const mode = override ?? (videoActive ? 'edit' : 'work');

    React.useEffect(() => {
      let live = true;
      const load = () => {
        fetchArea().then(payload => {
          if (!live) return;
          setArea(parseAreaPayload(payload));
          setLoading(false);
        }).catch(() => { if (live) setLoading(false); });
      };
      load();
      const timer = setInterval(load, 15000);
      const off = areaBus.subscribe(event => { if (event.type === 'project') load(); });
      const focus = () => load();
      window.addEventListener('focus', focus);
      return () => { live = false; clearInterval(timer); off(); window.removeEventListener('focus', focus); };
    }, [revision]);

    const choose = () => {
      const next = mode === 'edit' ? 'work' : 'edit';
      setOverride(next);
      if (next === 'edit') openPanel();
    };
    const projects = sortProjects(searchProjects(area.projects, query), list);
    const workspaceRows = Array.isArray(wsState?.items) ? wsState.items : [];
    const filtered = filterArea({
      workspaces: workspaceRows,
      sessions: list ?? { ids: [], byId: {} },
      hidden: area.hidden,
      projectPaths: area.projects.map(project => project.path),
      archived: Array.isArray(wsState?.archivedSessionIds) ? wsState.archivedSessionIds : [],
    });
    const sessionsById = list?.byId ?? {};
    const titleOf = id => sessionTitle(list, id);
    const activate = id => {
      let handled = false;
      try { handled = openSession(id) === true; } catch { handled = false; }
      if (!handled) { try { props?.open?.(id); } catch { /* the shell owns navigation */ } }
    };
    const onKey = action => event => {
      if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); action(); }
    };
    const toggle = id => setCollapsed(current => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
    const restart = () => {
      setRevision(value => value + 1);
      fetchArea().then(payload => setArea(parseAreaPayload(payload))).catch(() => {});
    };

    const switchTitle = mode === 'edit' ? t('areaSwitchWork') : t('areaSwitchEdit');
    const header = h('div', { className: C.header },
      h('span', { className: C.label, style: { marginRight: 'auto' } }, mode === 'edit' ? t('areaEditTitle') : t('areaWorkTitle')),
      h('button', {
        type: 'button', className: C.iconButton, title: switchTitle, 'aria-label': switchTitle,
        onClick: () => choose(),
      }, icon('IconWorkspaceTreeOutlineRegular', 14)),
      mode === 'edit' ? h('button', {
        type: 'button', className: C.iconButton, title: t('areaSearch'), 'aria-label': t('areaSearch'),
        onClick: () => { if (searching) setQuery(''); setSearching(value => !value); },
      }, icon('IconSearchOutlineRegular', 14)) : null,
      h('button', {
        type: 'button', className: C.iconButton, title: t('areaNew'), 'aria-label': t('areaNew'), onClick: () => openPanel(),
      }, icon('IconPlusOutlineRegular', 14)));

    const searchBar = searching ? h('div', { className: C.search },
      icon('IconSearchOutlineRegular', 13),
      h('input', {
        className: C.searchInput, value: query, autoFocus: true, placeholder: t('areaSearchPlaceholder'),
        'aria-label': t('areaSearchPlaceholder'),
        onChange: event => setQuery(event.target.value),
        onKeyDown: event => {
          if (event.key === 'Escape') { setQuery(''); setSearching(false); }
          if (event.key === 'Enter' && projects.length > 0) { openProject(projects[0].projectId); setSearching(false); }
        },
      }),
      h('button', {
        type: 'button', className: C.iconButton, 'aria-label': t('areaClear'),
        onClick: () => { setQuery(''); setSearching(false); },
      }, icon('IconCloseFillRegular', 12))) : null;

    const projectRow = project => h('div', { key: project.projectId, style: { position: 'relative' } },
      h('div', {
        className: C.row, role: 'button', tabIndex: 0, title: project.path,
        'aria-label': project.name, onClick: () => openProject(project.projectId),
        onKeyDown: onKey(() => openProject(project.projectId)),
      },
      h('span', { className: C.slot }, icon('IconFolderCloseRegular', 16)),
      h('span', { className: C.text },
        h('span', { className: C.title }, project.name),
        h('span', { className: C.meta }, project.sessionTitle || (project.sessionId ? t('areaSessionUntitled') : t('areaNotStarted')))),
      h('span', { className: C.actions },
        h('button', {
          type: 'button', className: C.iconButton, title: t('areaMore'), 'aria-label': t('areaMore'),
          onClick: event => { event.stopPropagation(); setMenu(current => (current === project.projectId ? null : project.projectId)); },
        }, icon('IconEllipsisOutlineRegular', 14)))),
      menu === project.projectId ? h('div', { className: 'nof-menu' },
        h('button', { type: 'button', onClick: () => { setMenu(null); openProject(project.projectId); } }, t('areaOpenPanel')),
        project.sessionId ? h('button', { type: 'button', onClick: () => { setMenu(null); activate(project.sessionId); } }, t('areaOpenSession')) : null,
        h('button', { type: 'button', onClick: () => { setMenu(null); restart(); } }, t('areaRefresh'))) : null);

    const sessionRow = (id, parentId) => h('div', {
      key: `${parentId}:${id}`,
      className: `${C.session}${id === activeId && activePanel === null ? ` ${C.selected}` : ''}`,
      role: 'button', tabIndex: 0, 'aria-label': titleOf(id) || id,
      onClick: () => activate(id), onKeyDown: onKey(() => activate(id)),
    },
    h('span', { className: C.slot }, h('span', { className: C.dot })),
    h('span', { className: C.title }, titleOf(id) || (sessionsById[id]?.blank ? t('areaBlankSession') : t('areaSessionUntitled'))));

    const workRows = filtered.groups.map(group => h('div', { key: group.workspaceId },
      h('div', {
        className: C.row, role: 'button', tabIndex: 0, 'aria-expanded': !collapsed.has(group.workspaceId),
        'aria-label': group.title || t('areaWorkspaceFallback'),
        onClick: () => toggle(group.workspaceId), onKeyDown: onKey(() => toggle(group.workspaceId)),
      },
      h('span', { className: C.slot }, icon(collapsed.has(group.workspaceId) ? 'IconFolderCloseRegular' : 'IconFolderOpenRegular', 16)),
      h('span', { className: C.text },
        h('span', { className: C.title }, group.title || t('areaWorkspaceFallback')),
        h('span', { className: C.meta }, `${group.sessionIds.length} ${t('areaSessions')}`))),
      collapsed.has(group.workspaceId) ? null : group.sessionIds.map(id => sessionRow(id, group.workspaceId))));

    const ungrouped = filtered.ungrouped.length > 0
      ? h('div', { key: '__ungrouped' },
        h('div', { className: 'nof-section' }, t('areaUngrouped')),
        filtered.ungrouped.map(id => sessionRow(id, 'ungrouped')))
      : null;

    const body = mode === 'edit'
      ? h('div', { className: C.list, role: 'tree' },
        projects.length === 0
          ? h('div', { className: 'nof-empty' }, loading ? t('areaLoading') : t('areaEmptyProjects'))
          : projects.map(projectRow))
      : h('div', { className: C.list, role: 'tree' },
        filtered.groups.length === 0 && filtered.ungrouped.length === 0
          ? h('div', { className: 'nof-empty' }, loading ? t('areaLoading') : t('areaEmptyWorkspaces'))
          : [workRows, ungrouped]);

    return h('div', { className: C.root, 'data-no996-openfilm-area': mode }, header, searchBar, body);
  };
}
