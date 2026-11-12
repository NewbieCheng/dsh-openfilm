// The sidebar's Workspace region, replaced by a project area.
//
// Why a replacement rather than a child slot: DSH's `sidebar.workspaces` is a
// single slot, and a single slot renders the first live entry in priority order.
// Registering at a lower priority than the shipped WorkspaceBrowser shadows it,
// which is the only way to (a) put the project list where the workspace list
// was and (b) hide project conversations from the Workspace view, since DSH
// offers no per-Session hide API.
//
// It has to *look* like the shipped browser it stands in for, so the stylesheet
// below is written against the same sidebar metrics the official Rows.module.css
// uses (row heights, indent, tokens) instead of inventing a new scale.
import { areaBus } from './area-bus.mjs';
import {
  AREA_MODES, defaultMode, filterArea, parseAreaPayload, readMode, searchProjects,
  sessionTitle, sortProjects, writeMode,
} from './area-client.mjs';

const PANEL = 'no996-openfilm';
const STYLE_TAG = 'no996-openfilm-area';

const CSS = `
.nof-area{box-sizing:border-box;min-height:0;flex:1;display:flex;flex-direction:column;padding-right:var(--dsh-session-list-edge-inset,var(--dsh-sidebar-inline-padding,8px));color:var(--dsw-alias-label-primary)}
.nof-area *{box-sizing:border-box}
.nof-area-header{height:36px;display:flex;align-items:center;gap:4px;padding-left:var(--dsh-sidebar-row-padding,12px);margin-bottom:4px;color:var(--dsw-alias-label-tertiary);flex:none;overflow:hidden}
.nof-area-label{flex:1 1 auto;min-width:0;font-size:12px;line-height:20px;font-weight:500;letter-spacing:.02em;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;position:relative;left:-1px}
.nof-area-switch{flex:none;max-width:92px;height:22px;padding:0 4px;border:.5px solid var(--dsw-alias-border-l4);border-radius:var(--dsw-radius-sm);background:0 0;color:var(--dsw-alias-label-secondary);font:inherit;font-size:12px;line-height:20px;cursor:pointer}
.nof-area-switch:focus-visible{outline:var(--dsw-focus-ring-width,2px) solid var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary));outline-offset:-2px}
.nof-area-icon{width:28px;height:28px;padding:0;border:0;border-radius:var(--dsw-radius-sm);background:0 0;color:var(--dsw-alias-label-secondary);display:inline-flex;align-items:center;justify-content:center;flex:none;cursor:pointer}
.nof-area-icon:hover{background:var(--dsw-alias-interactive-bg-hover)}
.nof-area-icon:focus-visible{outline:var(--dsw-focus-ring-width,2px) solid var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary));outline-offset:-2px}
.nof-area-searchbar{height:32px;display:flex;align-items:center;gap:0;margin:0 4px 4px calc(var(--dsh-sidebar-paint-inset,0px) + 1px);padding:0 4px 0 0;border:.5px solid var(--dsw-alias-border-l4);border-radius:var(--dsw-radius-md);color:var(--dsw-alias-label-caption)}
.nof-area-input{flex:1;min-width:0;margin-left:-2px;border:0;outline:none;background:0 0;color:var(--dsw-alias-label-primary);font:inherit;font-size:13px;line-height:18px}
.nof-area-input::placeholder{color:var(--dsw-alias-label-tertiary)}
.nof-area-list{flex:1;min-height:0;overflow-y:auto;margin-left:-4px;padding:0 0 16px 4px;scrollbar-gutter:stable}
.nof-area-row{display:flex;align-items:center;gap:var(--dsh-sidebar-label-gap,6px);height:34px;padding:0 8px;padding-inline-start:calc(var(--dsh-sidebar-row-padding,12px) - var(--dsh-sidebar-paint-inset,0px) + var(--dsh-workspace-indent,0px));border-inline:var(--dsh-sidebar-paint-inset,0px) solid transparent;border-radius:var(--dsw-radius-md);background-clip:padding-box;color:var(--dsw-alias-label-primary);cursor:pointer;-webkit-user-select:none;user-select:none;position:relative;outline:none}
.nof-area-row+.nof-area-row{margin-top:2px}
.nof-area-row:hover{background-color:var(--dsw-alias-interactive-bg-hover)}
.nof-area-row:focus-visible{outline:var(--dsw-focus-ring-width,2px) solid var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary));outline-offset:-2px}
.nof-area-session{height:32px;gap:0;padding-inline-start:calc(var(--dsh-sidebar-row-padding,12px) - var(--dsh-sidebar-paint-inset,0px) + 22px)}
.nof-area-session.nof-area-current{background-color:var(--dsw-alias-interactive-bg-hover)}
.nof-area-slot{width:16px;height:20px;flex:none;display:inline-flex;align-items:center;justify-content:center;color:var(--dsw-alias-label-tertiary)}
.nof-area-arrow{display:none;transition:transform .15s var(--ds-ease-in-out, ease)}
.nof-area-arrow-open{transform:rotate(90deg)}
.nof-area-row:hover .nof-area-folder{display:none}
.nof-area-row:hover .nof-area-arrow{display:inline-flex}
.nof-area-title{min-width:0;font-size:14px;line-height:20px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.nof-area-session .nof-area-title{flex:1;margin:0 6px 0 var(--dsh-sidebar-label-gap,6px)}
.nof-area-projectText{display:flex;flex-direction:column;flex:1;min-width:0;gap:2px}
.nof-area-meta{font-size:12px;line-height:20px;color:var(--dsw-alias-label-tertiary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.nof-area-actions{flex:none;display:none;align-items:center;gap:13px}
.nof-area-row:hover .nof-area-actions,.nof-area-row.nof-area-menu-open .nof-area-actions{display:inline-flex}
.nof-area-more{width:24px;height:24px;padding:0;border:0;border-radius:var(--dsw-radius-xs);background:0 0;color:var(--dsw-alias-label-tertiary);display:inline-flex;align-items:center;justify-content:center;cursor:pointer}
.nof-area-more:hover{color:var(--dsw-alias-label-primary)}
.nof-area-menu{position:absolute;right:4px;top:30px;z-index:30;min-width:168px;padding:4px;border:1px solid var(--dsw-alias-border-l4);border-radius:var(--dsw-radius-md);background:var(--dsw-alias-bg-layer-2,var(--dsw-alias-bg-base));box-shadow:0 8px 24px #0006}
.nof-area-menu button{display:block;width:100%;padding:6px 8px;border:0;border-radius:var(--dsw-radius-sm);background:0 0;color:var(--dsw-alias-label-primary);text-align:left;font:inherit;font-size:12.5px;line-height:20px;cursor:pointer}
.nof-area-menu button:hover{background:var(--dsw-alias-interactive-bg-hover)}
.nof-area-section{padding:6px var(--dsh-sidebar-row-padding,12px) 2px;font-size:12px;line-height:20px;color:var(--dsw-alias-label-tertiary)}
.nof-area-empty{padding:12px var(--dsh-sidebar-row-padding,12px);font-size:12.5px;line-height:1.7;color:var(--dsw-alias-label-tertiary)}
.nof-area-note{padding:4px var(--dsh-sidebar-row-padding,12px) 8px;font-size:11.5px;line-height:1.6;color:var(--dsw-alias-label-tertiary)}
`;

/** Install the area stylesheet once; the shell keeps it for the page lifetime. */
export function ensureAreaStyles(doc = typeof document === 'undefined' ? undefined : document) {
  if (!doc || doc.querySelector(`style[data-no996="${STYLE_TAG}"]`)) return;
  const tag = doc.createElement('style');
  tag.dataset.no996 = STYLE_TAG;
  tag.textContent = CSS;
  doc.head.appendChild(tag);
}

function iconPaths(name) {
  if (name === 'search') {
    return [
      ['circle', { cx: 11, cy: 11, r: 6.5, stroke: 'currentColor', strokeWidth: 1.8 }],
      ['path', { d: 'm16 16 4 4', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round' }],
    ];
  }
  if (name === 'plus') return [['path', { d: 'M12 5v14M5 12h14', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round' }]];
  if (name === 'more') {
    return [
      ['circle', { cx: 5, cy: 12, r: 1.6, fill: 'currentColor' }],
      ['circle', { cx: 12, cy: 12, r: 1.6, fill: 'currentColor' }],
      ['circle', { cx: 19, cy: 12, r: 1.6, fill: 'currentColor' }],
    ];
  }
  if (name === 'folder') {
    return [['path', { d: 'M3.5 7.5a2 2 0 0 1 2-2h3l1.6 2h7.4a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2h-12a2 2 0 0 1-2-2z', stroke: 'currentColor', strokeWidth: 1.6, fill: 'none' }]];
  }
  if (name === 'arrow') {
    return [['path', { d: 'm9 6 6 6-6 6', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round', strokeLinejoin: 'round', fill: 'none' }]];
  }
  return [];
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
 */
export function createAreaBrowser(React, deps) {
  const { t, fetchArea, openProject, openSession, openPanel, storage } = deps;
  const h = React.createElement;
  const Icon = ({ name, size = 14, className }) => h('svg', {
    width: size, height: size, viewBox: '0 0 24 24', fill: 'none', 'aria-hidden': true, className,
  }, iconPaths(name).map(([tag, attrs], index) => h(tag, { key: index, ...attrs })));

  function useSessionList(props) {
    const hooks = React.useRef(null);
    if (hooks.current === null) hooks.current = { sessions: props?.useSessions, workspaces: props?.useWorkspaces };
    return hooks.current;
  }

  return function AreaBrowser(props) {
    const { sessions: useSessions, workspaces: useWorkspaces } = useSessionList(props);
    const list = typeof useSessions === 'function' ? useSessions(state => state) : null;
    const wsState = typeof useWorkspaces === 'function' ? useWorkspaces(state => state) : null;
    const [area, setArea] = React.useState(() => ({ projects: [], hidden: [] }));
    const [loading, setLoading] = React.useState(true);
    const [query, setQuery] = React.useState('');
    const [searching, setSearching] = React.useState(false);
    const [menu, setMenu] = React.useState(null);
    const [revision, setRevision] = React.useState(0);
    const [collapsed, setCollapsed] = React.useState(() => new Set());
    const activeId = React.useMemo(() => {
      if (!list?.byId) return null;
      for (const id of Object.keys(list.byId)) {
        if ((list.byId[id]?.retainedBy?.mainView ?? 0) > 0) return id;
      }
      return null;
    }, [list]);
    const isProjectSession = activeId !== null && area.hidden.includes(activeId);
    const modeKey = activeId ?? 'panel';
    // The explicit choice is remembered per Session; until there is one, the
    // area follows what the Session *is*. Defaulting on the first paint instead
    // would show the Workspace view for a project conversation, because the
    // Host payload (which names project conversations) arrives a tick later.
    const [chosen, setChosen] = React.useState(() => readMode(storage, modeKey));
    const seenKey = React.useRef(modeKey);
    if (seenKey.current !== modeKey) {
      seenKey.current = modeKey;
      setChosen(readMode(storage, modeKey));
    }
    const mode = chosen ?? defaultMode(isProjectSession);

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

    const choose = next => {
      if (!AREA_MODES.includes(next)) return;
      setChosen(next);
      writeMode(storage, modeKey, next);
    };
    const projects = sortProjects(searchProjects(area.projects, query), list);
    const sessionsById = list?.byId ?? {};
    const selectedTitle = id => sessionTitle(list, id);
    const workspaceRows = (wsState?.items && Array.isArray(wsState.items)) ? wsState.items : [];
    const filtered = filterArea({
      workspaces: workspaceRows,
      sessions: list ?? { ids: [], byId: {} },
      hidden: area.hidden,
      projectPaths: area.projects.map(project => project.path),
      archived: Array.isArray(wsState?.archivedSessionIds) ? wsState.archivedSessionIds : [],
    });
    const hiddenSet = new Set(area.hidden);
    // The service is the documented way to open a Session; the slot's `open`
    // prop is the fallback for a shell build that does not expose it.
    const activate = id => {
      let handled = false;
      try { handled = openSession(id) === true; } catch { handled = false; }
      if (!handled) { try { props?.open?.(id); } catch { /* the shell owns navigation */ } }
    };
    const onKey = action => event => {
      if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); action(); }
    };
    const isCollapsed = id => collapsed.has(id);
    const toggle = id => {
      setCollapsed(current => {
        const next = new Set(current);
        if (next.has(id)) next.delete(id); else next.add(id);
        return next;
      });
    };
    const restart = () => {
      setRevision(value => value + 1);
      fetchArea().then(payload => setArea(parseAreaPayload(payload))).catch(() => {});
    };

    const header = h('div', { className: 'nof-area-header' },
      h('span', { className: 'nof-area-label' }, mode === 'edit' ? t('areaProjects') : t('areaWorkspaces')),
      h('select', {
        className: 'nof-area-switch', value: mode, 'aria-label': t('areaSwitch'),
        onChange: event => choose(event.target.value),
      },
      h('option', { value: 'edit' }, t('areaEdit')),
      h('option', { value: 'work' }, t('areaWork'))),
      h('button', {
        type: 'button', className: 'nof-area-icon', title: t('areaSearch'), 'aria-label': t('areaSearch'),
        onClick: () => { if (searching) setQuery(''); setSearching(value => !value); },
      }, h(Icon, { name: 'search' })),
      mode === 'edit' ? h('button', {
        type: 'button', className: 'nof-area-icon', title: t('areaNew'), 'aria-label': t('areaNew'), onClick: () => openPanel(),
      }, h(Icon, { name: 'plus' })) : null);

    const searchBar = searching ? h('div', { className: 'nof-area-searchbar' },
      h('button', { type: 'button', className: 'nof-area-icon', 'aria-label': t('areaSearch'), onClick: () => { setQuery(''); setSearching(false); } }, h(Icon, { name: 'search' })),
      h('input', {
        className: 'nof-area-input', value: query, autoFocus: true, placeholder: t('areaSearchPlaceholder'),
        'aria-label': t('areaSearchPlaceholder'),
        onChange: event => setQuery(event.target.value),
        onKeyDown: event => {
          if (event.key === 'Escape') { setQuery(''); setSearching(false); }
          if (event.key === 'Enter' && projects.length > 0) { openProject(projects[0].projectId); setSearching(false); }
        },
      })) : null;

    const projectRow = project => h('div', { key: project.projectId, style: { position: 'relative' } },
      h('div', {
        className: 'nof-area-row', role: 'button', tabIndex: 0, title: project.path,
        'aria-label': project.name, onClick: () => openProject(project.projectId), onKeyDown: onKey(() => openProject(project.projectId)),
      },
      h('span', { className: 'nof-area-slot' }, h(Icon, { name: 'folder' })),
      h('span', { className: 'nof-area-projectText' },
        h('span', { className: 'nof-area-title' }, project.name),
        project.sessionTitle
          ? h('span', { className: 'nof-area-meta' }, project.sessionTitle)
          : h('span', { className: 'nof-area-meta' }, project.sessionId ? t('areaSessionUntitled') : t('areaNotStarted'))),
      h('span', { className: 'nof-area-actions' },
        h('button', {
          type: 'button', className: 'nof-area-more', title: t('areaMore'), 'aria-label': t('areaMore'),
          onClick: event => { event.stopPropagation(); setMenu(current => (current === project.projectId ? null : project.projectId)); },
        }, h(Icon, { name: 'more' })))),
      menu === project.projectId ? h('div', { className: 'nof-area-menu' },
        h('button', { type: 'button', onClick: () => { setMenu(null); openProject(project.projectId); } }, t('areaOpenPanel')),
        project.sessionId ? h('button', { type: 'button', onClick: () => { setMenu(null); activate(project.sessionId); } }, t('areaOpenSession')) : null,
        h('button', { type: 'button', onClick: () => { setMenu(null); restart(); } }, t('areaRefresh'))) : null);

    const sessionRow = (id, parentId) => h('div', {
      key: `${parentId}:${id}`, className: `nof-area-row nof-area-session${id === activeId ? ' nof-area-current' : ''}`,
      role: 'button', tabIndex: 0, 'aria-label': selectedTitle(id) || id,
      onClick: () => activate(id), onKeyDown: onKey(() => activate(id)),
    }, h('span', { className: 'nof-area-title' }, selectedTitle(id) || (sessionsById[id]?.blank ? t('areaBlankSession') : t('areaSessionUntitled'))));

    const workGroups = filtered.groups.map(group => h('div', { key: group.workspaceId },
      h('div', {
        className: 'nof-area-row', role: 'button', tabIndex: 0, 'aria-expanded': !isCollapsed(group.workspaceId),
        'aria-label': group.title || t('areaWorkspaceFallback'), onClick: () => toggle(group.workspaceId),
        onKeyDown: onKey(() => toggle(group.workspaceId)),
      },
      h('span', { className: 'nof-area-slot' },
        h(Icon, { name: 'folder', className: 'nof-area-folder' }),
        h(Icon, { name: 'arrow', className: `nof-area-arrow${isCollapsed(group.workspaceId) ? '' : ' nof-area-arrow-open'}` })),
      h('span', { className: 'nof-area-title', style: { flex: '1 1 auto' } }, group.title || t('areaWorkspaceFallback'))),
      isCollapsed(group.workspaceId) ? null : group.sessionIds.map(id => sessionRow(id, group.workspaceId))));

    const ungrouped = filtered.ungrouped.length > 0
      ? h('div', { key: '__ungrouped' },
        h('div', { className: 'nof-area-section' }, t('areaUngrouped')),
        filtered.ungrouped.map(id => sessionRow(id, 'ungrouped')))
      : null;

    const body = mode === 'edit'
      ? h('div', { className: 'nof-area-list' },
        projects.length === 0
          ? h('div', { className: 'nof-area-empty' }, loading ? t('areaLoading') : t('areaEmptyProjects'))
          : projects.map(projectRow))
      : h('div', { className: 'nof-area-list' },
        filtered.groups.length === 0 && filtered.ungrouped.length === 0
          ? h('div', { className: 'nof-area-empty' }, loading ? t('areaLoading') : t('areaEmptyWorkspaces'))
          : [workGroups, ungrouped, hiddenSet.size > 0 ? h('div', { key: '__note', className: 'nof-area-note' }, t('areaHiddenNote')) : null]);

    return h('div', { className: 'nof-area', 'data-no996-openfilm-area': mode }, header, searchBar, body);
  };
}
