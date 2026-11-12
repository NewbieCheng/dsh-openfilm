// The sidebar's Workspace region, replaced by the project area.
//
// Why a replacement rather than a child slot: DSH's `sidebar.workspaces` is a
// single slot, and a single slot renders the first live entry in priority order.
// Registering at a lower priority than the shipped WorkspaceBrowser shadows it,
// which is the only way to (a) put the project list where the workspace list
// was and (b) hide project conversations from the Workspace view, since DSH
// offers no per-Session hide API.
//
// What this component owns:
//   · 项目 (default) — the Studio project library, one row per project, the
//     conversation that belongs to it, and a search box.
//   · 工作区 — the shipped list minus project conversations and the folders
//     that only exist for them.
// The header dropdown switches between the two; the choice is remembered per
// Session (a project conversation defaults to 项目).
import { areaBus } from './area-bus.mjs';
import {
  AREA_MODES, defaultMode, filterArea, parseAreaPayload, readMode, searchProjects,
  sessionTitle, sortProjects, writeMode,
} from './area-client.mjs';

const PANEL = 'no996-openfilm';

const S = {
  region: { display: 'flex', flexDirection: 'column', minHeight: 0, height: '100%', overflow: 'hidden' },
  header: {
    display: 'flex', alignItems: 'center', gap: 6, padding: '6px 8px 6px 12px',
    minHeight: 32, color: 'var(--dsw-alias-label-secondary)',
  },
  title: { flex: '1 1 auto', minWidth: 0, fontSize: 12, fontWeight: 600, letterSpacing: '.02em', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' },
  select: {
    maxWidth: 96, border: '1px solid var(--dsw-alias-separator)', borderRadius: 6,
    background: 'var(--dsw-alias-bg-base)', color: 'var(--dsw-alias-label-primary)',
    fontSize: 11, padding: '2px 4px', cursor: 'pointer',
  },
  iconButton: {
    width: 24, height: 24, display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
    border: 0, borderRadius: 6, background: 'transparent', color: 'var(--dsw-alias-label-secondary)', cursor: 'pointer',
  },
  search: {
    margin: '0 8px 6px', display: 'flex', alignItems: 'center', gap: 6,
    border: '1px solid var(--dsw-alias-separator)', borderRadius: 7, padding: '4px 8px',
    background: 'var(--dsw-alias-bg-base)',
  },
  searchInput: { flex: '1 1 auto', minWidth: 0, border: 0, outline: 'none', background: 'transparent', color: 'var(--dsw-alias-label-primary)', fontSize: 12 },
  body: { flex: '1 1 auto', minHeight: 0, overflowY: 'auto', padding: '0 6px 12px' },
  section: { padding: '6px 6px 2px', fontSize: 11, color: 'var(--dsw-alias-label-tertiary)' },
  row: {
    display: 'flex', alignItems: 'center', gap: 6, width: '100%', boxSizing: 'border-box',
    padding: '5px 8px', borderRadius: 6, border: 0, background: 'transparent',
    color: 'var(--dsw-alias-label-primary)', textAlign: 'left', cursor: 'pointer', fontSize: 12.5,
  },
  rowSub: { display: 'block', color: 'var(--dsw-alias-label-tertiary)', fontSize: 11, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' },
  dot: { flex: 'none', width: 6, height: 6, borderRadius: 999, background: 'var(--dsw-alias-label-tertiary)' },
  empty: { padding: '18px 12px', fontSize: 12, lineHeight: 1.6, color: 'var(--dsw-alias-label-tertiary)' },
  menu: {
    position: 'absolute', right: 8, top: 28, zIndex: 20, minWidth: 148, padding: 4,
    borderRadius: 8, border: '1px solid var(--dsw-alias-separator)', background: 'var(--dsw-alias-bg-layer-2, var(--dsw-alias-bg-base))',
    boxShadow: '0 8px 24px #0006',
  },
  menuItem: { display: 'block', width: '100%', textAlign: 'left', border: 0, background: 'transparent', color: 'var(--dsw-alias-label-primary)', padding: '6px 8px', borderRadius: 6, cursor: 'pointer', fontSize: 12 },
};

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
    return [['path', { d: 'M3.5 7.5a2 2 0 0 1 2-2h3l1.6 2h7.4a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2h-12a2 2 0 0 1-2-2z', stroke: 'currentColor', strokeWidth: 1.6 }]];
  }
  return [];
}

/**
 * @param {object} React
 * @param {object} deps
 * @param {(key: string) => string} deps.t
 * @param {() => Promise<object>} deps.fetchArea
 * @param {(projectId: string) => void} deps.openProject
 * @param {(sessionId: string) => void} deps.openSession
 * @param {() => void} deps.openPanel
 * @param {(sessionId: string) => Promise<void>} deps.archiveSession
 * @param {Storage|undefined} deps.storage
 */
export function createAreaBrowser(React, deps) {
  const { t, fetchArea, openProject, openSession, openPanel, storage } = deps;
  const h = React.createElement;
  const Icon = ({ name, size = 14 }) => h('svg', {
    width: size, height: size, viewBox: '0 0 24 24', fill: 'none', 'aria-hidden': true,
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
    const [mode, setMode] = React.useState(() => readMode(storage, modeKey) ?? defaultMode(isProjectSession));
    // Follow the active Session's memory: a project conversation defaults to the
    // editing area, an ordinary one to Workspaces.
    const seenKey = React.useRef(modeKey);
    if (seenKey.current !== modeKey) {
      seenKey.current = modeKey;
      setMode(readMode(storage, modeKey) ?? defaultMode(isProjectSession));
    }

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
      setMode(next);
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
    const rowProps = (onClick, label) => ({
      type: 'button', style: S.row, onClick, 'aria-label': label,
      onMouseEnter: event => { event.currentTarget.style.background = 'var(--dsw-alias-interactive-bg-hover)'; },
      onMouseLeave: event => { event.currentTarget.style.background = 'transparent'; },
    });
    const isCollapsed = id => collapsed.has(id);
    const toggle = id => {
      setCollapsed(current => {
        const next = new Set(current);
        if (next.has(id)) next.delete(id); else next.add(id);
        return next;
      });
    };

    const header = React.createElement('div', { style: S.header },
      React.createElement('span', { style: S.title }, mode === 'edit' ? t('areaProjects') : t('areaWorkspaces')),
      React.createElement('select', {
        style: S.select, value: mode, 'aria-label': t('areaSwitch'),
        onChange: event => choose(event.target.value),
      },
      React.createElement('option', { value: 'edit' }, t('areaEdit')),
      React.createElement('option', { value: 'work' }, t('areaWork'))),
      React.createElement('button', {
        type: 'button', style: S.iconButton, title: t('areaSearch'), 'aria-label': t('areaSearch'),
        onClick: () => { setSearching(value => !value); if (searching) setQuery(''); },
      }, React.createElement(Icon, { name: 'search' })),
      mode === 'edit' ? React.createElement('button', {
        type: 'button', style: S.iconButton, title: t('areaNew'), 'aria-label': t('areaNew'), onClick: () => openPanel(),
      }, React.createElement(Icon, { name: 'plus' })) : null);

    const searchBar = searching ? React.createElement('div', { style: S.search },
      React.createElement(Icon, { name: 'search' }),
      React.createElement('input', {
        style: S.searchInput, value: query, autoFocus: true, placeholder: t('areaSearchPlaceholder'),
        'aria-label': t('areaSearchPlaceholder'),
        onChange: event => setQuery(event.target.value),
        onKeyDown: event => {
          if (event.key === 'Escape') { setQuery(''); setSearching(false); }
          if (event.key === 'Enter' && projects.length > 0) { openProject(projects[0].projectId); setSearching(false); }
        },
      })) : null;

    const projectRow = project => React.createElement('div', { key: project.projectId, style: { position: 'relative' } },
      React.createElement('button', {
        ...rowProps(() => openProject(project.projectId), project.name),
        style: { ...S.row, alignItems: 'flex-start', paddingRight: 28 },
        title: project.path,
      },
      React.createElement('span', { style: { ...S.dot, marginTop: 6, background: project.sessionId ? 'var(--dsw-alias-brand-primary, #4c8dff)' : 'var(--dsw-alias-label-tertiary)' } }),
      React.createElement('span', { style: { minWidth: 0, flex: '1 1 auto' } },
        React.createElement('span', { style: { display: 'block', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' } }, project.name),
        React.createElement('span', { style: S.rowSub }, project.sessionTitle || (project.sessionId ? t('areaSessionUntitled') : t('areaNotStarted'))))),
      React.createElement('button', {
        type: 'button', style: { ...S.iconButton, position: 'absolute', right: 4, top: 4 },
        title: t('areaMore'), 'aria-label': t('areaMore'),
        onClick: event => { event.stopPropagation(); setMenu(current => current === project.projectId ? null : project.projectId); },
      }, React.createElement(Icon, { name: 'more' })),
      menu === project.projectId ? React.createElement('div', { style: S.menu },
        React.createElement('button', { type: 'button', style: S.menuItem, onClick: () => { setMenu(null); openProject(project.projectId); } }, t('areaOpenPanel')),
        project.sessionId ? React.createElement('button', {
          type: 'button', style: S.menuItem,
          onClick: () => { setMenu(null); activate(project.sessionId); },
        }, t('areaOpenSession')) : null,
        React.createElement('button', {
          type: 'button', style: S.menuItem,
          onClick: () => { setMenu(null); setRevision(value => value + 1); fetchArea().then(payload => setArea(parseAreaPayload(payload))).catch(() => {}); },
        }, t('areaRefresh'))) : null);

    const sessionButton = (id, paddingLeft) => React.createElement('button', {
      key: id,
      ...rowProps(() => activate(id), selectedTitle(id) || id),
      style: { ...S.row, paddingLeft, color: id === activeId ? 'var(--dsw-alias-label-primary)' : undefined },
    }, React.createElement('span', { style: { minWidth: 0, flex: '1 1 auto', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' } },
      selectedTitle(id) || (sessionsById[id]?.blank ? t('areaBlankSession') : t('areaSessionUntitled'))));

    const workGroups = filtered.groups.map(group => React.createElement('div', { key: group.workspaceId },
      React.createElement('button', {
        ...rowProps(() => toggle(group.workspaceId), group.title || t('areaWorkspaceFallback')),
        style: { ...S.row, color: 'var(--dsw-alias-label-secondary)' },
      },
      React.createElement(Icon, { name: 'folder' }),
      React.createElement('span', { style: { flex: '1 1 auto', minWidth: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' } }, group.title || t('areaWorkspaceFallback')),
      React.createElement('span', { style: { fontSize: 10, color: 'var(--dsw-alias-label-tertiary)' } }, isCollapsed(group.workspaceId) ? '▸' : '▾')),
      isCollapsed(group.workspaceId) ? null : group.sessionIds.map(id => sessionButton(id, 24))));

    const ungrouped = filtered.ungrouped.length > 0
      ? React.createElement('div', { key: '__ungrouped' },
        React.createElement('div', { style: S.section }, t('areaUngrouped')),
        filtered.ungrouped.map(id => sessionButton(id, 12)))
      : null;

    const body = mode === 'edit'
      ? React.createElement('div', { style: S.body },
        projects.length === 0
          ? React.createElement('div', { style: S.empty }, loading ? t('areaLoading') : t('areaEmptyProjects'))
          : projects.map(projectRow))
      : React.createElement('div', { style: S.body },
        filtered.groups.length === 0 && filtered.ungrouped.length === 0
          ? React.createElement('div', { style: S.empty }, loading ? t('areaLoading') : t('areaEmptyWorkspaces'))
          : [workGroups, ungrouped]);

    return React.createElement('div', { style: S.region, 'data-no996-openfilm-area': mode },
      header,
      searchBar,
      body,
      hiddenSet.size > 0 && mode === 'work'
        ? React.createElement('div', { style: { ...S.section, padding: '4px 12px 8px' } }, t('areaHiddenNote'))
        : null);
  };
}
