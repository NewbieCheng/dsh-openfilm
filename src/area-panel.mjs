// The project launcher: a page in the conversation area, not a sidebar.
//
// The sidebar stays the shipped WorkspaceBrowser — that is the only way it keeps
// its native folder buttons, spacing and menus. This page is the plugin's own
// surface for the same projects: search, one row per project with the
// conversation that belongs to it, and one action that opens the video panel on
// that project.
import { areaBus } from './area-bus.mjs';
import { parseAreaPayload, sortProjects, searchProjects, sessionTitle } from './area-client.mjs';

const STYLE_TAG = 'no996-openfilm-projects';

const CSS = `
.nof-projects{box-sizing:border-box;display:flex;flex-direction:column;min-height:0;height:100%;padding:28px 28px 12px;color:var(--dsw-alias-label-primary);overflow:hidden}
.nof-projects-head{display:flex;align-items:center;gap:10px;flex:none;flex-wrap:wrap}
.nof-projects-title{flex:1 1 auto;min-width:0;margin:0;font-size:15px;line-height:24px;font-weight:600}
.nof-projects-count{color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:20px}
.nof-projects-search{display:flex;align-items:center;gap:6px;height:32px;min-width:220px;padding:0 10px;border:.5px solid var(--dsw-alias-border-l4);border-radius:var(--dsw-radius-md);color:var(--dsw-alias-label-tertiary)}
.nof-projects-input{flex:1;min-width:0;border:0;outline:none;background:0 0;color:var(--dsw-alias-label-primary);font:inherit;font-size:13px;line-height:18px}
.nof-projects-input::placeholder{color:var(--dsw-alias-label-tertiary)}
.nof-projects-new{height:32px;padding:0 12px;border:.5px solid var(--dsw-alias-border-l4);border-radius:var(--dsw-radius-md);background:0 0;color:var(--dsw-alias-label-primary);font:inherit;font-size:13px;cursor:pointer}
.nof-projects-new:hover{background:var(--dsw-alias-interactive-bg-hover)}
.nof-projects-hint{flex:none;margin:8px 0 4px;color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:18px}
.nof-projects-list{flex:1;min-height:0;overflow-y:auto;margin:4px -8px 0;padding:0 8px 24px}
.nof-projects-row{display:flex;align-items:center;gap:10px;width:100%;box-sizing:border-box;padding:10px 10px;border:0;border-radius:var(--dsw-radius-md);background:0 0;color:var(--dsw-alias-label-primary);text-align:left;cursor:pointer;font:inherit}
.nof-projects-row:hover{background:var(--dsw-alias-interactive-bg-hover)}
.nof-projects-row:focus-visible{outline:var(--dsw-focus-ring-width,2px) solid var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary));outline-offset:-2px}
.nof-projects-icon{flex:none;width:28px;height:28px;display:inline-flex;align-items:center;justify-content:center;border-radius:var(--dsw-radius-sm);background:var(--dsw-alias-bg-layer-2,var(--dsw-alias-bg-base));color:var(--dsw-alias-label-secondary)}
.nof-projects-text{flex:1 1 auto;min-width:0;display:flex;flex-direction:column;gap:2px}
.nof-projects-name{font-size:14px;line-height:20px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.nof-projects-meta{font-size:12px;line-height:18px;color:var(--dsw-alias-label-tertiary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.nof-projects-open{flex:none;font-size:12px;line-height:20px;color:var(--dsw-alias-label-tertiary)}
.nof-projects-row:hover .nof-projects-open{color:var(--dsw-alias-label-primary)}
.nof-projects-empty{padding:24px 4px;color:var(--dsw-alias-label-tertiary);font-size:13px;line-height:1.8}
`;

/** Install the page stylesheet once; the shell keeps it for the page lifetime. */
export function ensureProjectStyles(doc = typeof document === 'undefined' ? undefined : document) {
  if (!doc || doc.querySelector(`style[data-no996="${STYLE_TAG}"]`)) return;
  const tag = doc.createElement('style');
  tag.dataset.no996 = STYLE_TAG;
  tag.textContent = CSS;
  doc.head.appendChild(tag);
}

/**
 * @param {object} React
 * @param {object} deps
 * @param {(key: string) => string} deps.t
 * @param {() => Promise<object>} deps.fetchArea
 * @param {(projectId: string) => void} deps.openProject
 * @param {() => void} deps.openPanel
 * @param {(sessionId: string) => boolean} deps.openSession
 */
export function createProjectPanel(React, deps) {
  const { t, fetchArea, openProject, openPanel } = deps;
  const h = React.createElement;
  const icon = (name, size = 16) => {
    const common = { width: size, height: size, viewBox: '0 0 24 24', fill: 'none', 'aria-hidden': true };
    if (name === 'folder') {
      return h('svg', common, h('path', { d: 'M3.5 7.5a2 2 0 0 1 2-2h3l1.6 2h7.4a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2h-12a2 2 0 0 1-2-2z', stroke: 'currentColor', strokeWidth: 1.6, fill: 'none' }));
    }
    if (name === 'search') {
      return h('svg', common,
        h('circle', { cx: 11, cy: 11, r: 6.5, stroke: 'currentColor', strokeWidth: 1.8 }),
        h('path', { d: 'm16 16 4 4', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round' }));
    }
    return null;
  };
  return function ProjectPanel(props) {
    const useSessions = props?.useSessions;
    const list = typeof useSessions === 'function' ? useSessions(state => state) : null;
    const [area, setArea] = React.useState(() => ({ projects: [], hidden: [] }));
    const [loading, setLoading] = React.useState(true);
    const [query, setQuery] = React.useState((props?.initialQuery ?? ''));
    React.useEffect(() => {
      let live = true;
      fetchArea().then(payload => {
        if (!live) return;
        setArea(parseAreaPayload(payload));
        setLoading(false);
      }).catch(() => { if (live) setLoading(false); });
      return () => { live = false; };
    }, []);
    const projects = sortProjects(searchProjects(area.projects, query), list);
    const titleOf = project => project.sessionTitle || (project.sessionId
      ? sessionTitle(list, project.sessionId) || t('areaSessionUntitled')
      : t('areaNotStarted'));
    return h('div', { className: 'nof-projects' },
      h('div', { className: 'nof-projects-head' },
        h('h1', { className: 'nof-projects-title' }, t('areaPanelTitle')),
        h('span', { className: 'nof-projects-count' }, String(projects.length)),
        h('div', { className: 'nof-projects-search' },
          icon('search'),
          h('input', {
            className: 'nof-projects-input', value: query, placeholder: t('areaPanelSearch'),
            'aria-label': t('areaPanelSearch'), onChange: event => setQuery(event.target.value),
          })),
        h('button', { type: 'button', className: 'nof-projects-new', onClick: () => openPanel() }, t('areaPanelNew'))),
      h('div', { className: 'nof-projects-hint' }, t('areaPanelHint')),
      h('div', { className: 'nof-projects-list' },
        projects.length === 0
          ? h('div', { className: 'nof-projects-empty' }, loading ? t('areaLoading') : t('areaEmptyProjects'))
          : projects.map(project => h('button', {
            key: project.projectId, type: 'button', className: 'nof-projects-row',
            title: project.path, 'aria-label': project.name,
            onClick: () => openProject(project.projectId),
          },
          h('span', { className: 'nof-projects-icon' }, icon('folder')),
          h('span', { className: 'nof-projects-text' },
            h('span', { className: 'nof-projects-name' }, project.name),
            h('span', { className: 'nof-projects-meta' }, titleOf(project))),
          h('span', { className: 'nof-projects-open' }, t('areaPanelOpen'))))));
  };
}
