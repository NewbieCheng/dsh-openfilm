// Client-side rules for the sidebar project area. Pure functions on purpose:
// the component owns rendering, these own the decisions (search, order, mode,
// which Sessions the Workspace view may list). Tests import this file directly.
//
// The rule the user chose: a project's conversation lives only in its editing
// area. `filterArea` is where the Workspace list loses those rows and the
// project-only folders around them.

export const AREA_MODES = Object.freeze(['edit', 'work']);
export const AREA_MODE_KEY = 'no996.openfilm.area';

const ID = /^[A-Za-z0-9_-]{6,40}$/;
// DSH Session IDs are `session-<uuid>` (44 chars), so they are much longer than
// a Studio project ID; a shared pattern would silently drop every binding.
const SESSION = /^[A-Za-z0-9_-]{1,100}$/;

function lastSegment(path) {
  if (typeof path !== 'string') return '';
  const parts = path.split(/[\\/]+/).filter(Boolean);
  return parts.length ? parts[parts.length - 1] : '';
}

function titleOf(sessions, sessionId) {
  const session = sessions?.byId?.[sessionId];
  if (!session) return '';
  const projected = session.projections && typeof session.projections === 'object' ? session.projections.values : undefined;
  if (typeof projected?.title === 'string' && projected.title.trim()) return projected.title.trim();
  return typeof session.title === 'string' ? session.title.trim() : '';
}

/**
 * The Host payload, made safe for rendering. Accepts an object or JSON text and
 * drops anything without a valid id or path instead of trusting the wire.
 */
export function parseAreaPayload(value) {
  let data = value;
  if (typeof value === 'string') {
    try { data = JSON.parse(value); } catch { data = null; }
  }
  const projects = [];
  const seen = new Set();
  for (const row of Array.isArray(data?.projects) ? data.projects : []) {
    const projectId = typeof row?.projectId === 'string' ? row.projectId : '';
    const projectPath = typeof row?.path === 'string' ? row.path : '';
    if (!ID.test(projectId) || !projectPath || seen.has(projectId)) continue;
    seen.add(projectId);
    projects.push({
      projectId,
      path: projectPath,
      name: typeof row.name === 'string' && row.name ? row.name : lastSegment(projectPath),
      sessionId: typeof row.sessionId === 'string' && SESSION.test(row.sessionId) ? row.sessionId : null,
      sessionTitle: typeof row.sessionTitle === 'string' ? row.sessionTitle : '',
    });
  }
  const hidden = [];
  const seenHidden = new Set();
  for (const id of Array.isArray(data?.hiddenSessionIds) ? data.hiddenSessionIds : []) {
    if (typeof id !== 'string' || !id || seenHidden.has(id)) continue;
    seenHidden.add(id);
    hidden.push(id);
  }
  return { projects, hidden };
}

/** Case-insensitive substring match used by the project search box. */
export function matchesQuery(text, query) {
  const needle = String(query ?? '').trim().toLowerCase();
  if (!needle) return true;
  return String(text ?? '').toLowerCase().includes(needle);
}

/**
 * Filter project rows by the search box. The query matches the project name and
 * its conversation title: the user types either "纸纹" or the session's name.
 */
export function searchProjects(projects, query) {
  const needle = String(query ?? '').trim();
  if (!needle) return Array.isArray(projects) ? projects : [];
  return (Array.isArray(projects) ? projects : [])
    .filter(project => matchesQuery(project.name, needle) || matchesQuery(project.sessionTitle, needle));
}

/**
 * Newest conversation first; projects that were never started keep their source
 * order at the end. Ties fall back to the name so the list never jitters.
 */
export function sortProjects(projects, sessions) {
  const list = Array.isArray(projects) ? [...projects] : [];
  const updatedAt = project => (project.sessionId ? Number(sessions?.byId?.[project.sessionId]?.updatedAt ?? 0) : 0);
  return list
    .map((project, index) => ({ project, index, at: updatedAt(project) }))
    .sort((a, b) => (b.at - a.at) || (a.index - b.index))
    .map(item => item.project);
}

/** The per-Session mode memory. Unknown or unreadable values read as `null`. */
export function readMode(storage, sessionId) {
  if (typeof sessionId !== 'string' || !sessionId) return null;
  try {
    const raw = storage?.getItem?.(AREA_MODE_KEY);
    const table = raw ? JSON.parse(raw) : null;
    const value = table && typeof table === 'object' ? table[sessionId] : undefined;
    return AREA_MODES.includes(value) ? value : null;
  } catch { return null; }
}

/** Store one Session's mode without disturbing the others (private mode is fine). */
export function writeMode(storage, sessionId, mode) {
  if (typeof sessionId !== 'string' || !sessionId || !AREA_MODES.includes(mode)) return false;
  try {
    const raw = storage?.getItem?.(AREA_MODE_KEY);
    const table = raw ? JSON.parse(raw) : {};
    if (!table || typeof table !== 'object' || Array.isArray(table)) return false;
    table[sessionId] = mode;
    storage.setItem(AREA_MODE_KEY, JSON.stringify(table));
    return true;
  } catch { return false; }
}

/** A project conversation defaults to the editing area; everything else to Workspaces. */
export function defaultMode(isProjectSession) {
  return isProjectSession === true ? 'edit' : 'work';
}

/**
 * The Workspace view the sidebar may draw.
 *
 * Sessions in `hidden` (project conversations) and archived Sessions never
 * render. A Workspace whose folder is a project's folder disappears when it has
 * nothing left to show; a Workspace that still holds an ordinary Session stays,
 * with only the visible rows.
 *
 * @param {object} input
 * @param {Array<{workspaceId: string, title: string, path?: string, sessionIds?: string[]}>} input.workspaces
 * @param {{ids?: string[], byId?: Record<string, object>}} input.sessions
 * @param {string[]} input.hidden - session IDs the project area owns.
 * @param {string[]} input.projectPaths - project folders, for hiding empty groups.
 * @param {string[]} [input.archived] - archived Session IDs (already hidden).
 * @returns {{groups: Array, ungrouped: string[], hiddenCount: number}}
 */
export function filterArea({ workspaces, sessions, hidden, projectPaths, archived } = {}) {
  const hiddenSet = new Set(Array.isArray(hidden) ? hidden : []);
  const archivedSet = new Set(Array.isArray(archived) ? archived : []);
  const visible = id => typeof id === 'string' && !hiddenSet.has(id) && !archivedSet.has(id);
  const projectFolders = (Array.isArray(projectPaths) ? projectPaths : []).map(folderKey).filter(Boolean);
  const groups = [];
  const accounted = new Set();
  for (const workspace of Array.isArray(workspaces) ? workspaces : []) {
    if (!workspace || typeof workspace.workspaceId !== 'string') continue;
    const sessionIds = Array.isArray(workspace.sessionIds) ? workspace.sessionIds : [];
    for (const id of sessionIds) if (typeof id === 'string') accounted.add(id);
    const rows = sessionIds.filter(visible);
    const projectFolder = projectFolders.includes(folderKey(workspace.path));
    if (rows.length === 0 && projectFolder) continue;
    groups.push({
      workspaceId: workspace.workspaceId,
      title: typeof workspace.title === 'string' ? workspace.title : '',
      sessionIds: rows,
    });
  }
  const ids = Array.isArray(sessions?.ids) ? sessions.ids : Object.keys(sessions?.byId ?? {});
  const ungrouped = ids.filter(id => visible(id) && !accounted.has(id));
  return { groups, ungrouped, hiddenCount: hiddenSet.size };
}

function folderKey(path) {
  if (typeof path !== 'string' || !path) return '';
  // One comparison for both platforms: separators normalized, case folded. A
  // UI-only match may be looser than the filesystem, and being loose here only
  // hides a folder that the project area already represents.
  return path.replace(/[\\/]+$/, '').replaceAll('/', '\\').toLowerCase();
}

export function sessionTitle(sessions, sessionId) {
  return titleOf(sessions, sessionId);
}
