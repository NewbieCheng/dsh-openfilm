// The sidebar project area's reading of the Host's two sources: Studio's project
// list and the project→Session bindings. Everything here is pure so the rules
// that decide what the sidebar hides can be tested without a Studio or a Host.
//
// The rule the user asked for is blunt: a project's conversation belongs to its
// editing area, never to the Workspace list. "Project conversation" therefore
// has to be recognised without guessing, and the Host is the only place that can
// see both halves — Studio's projects and the session catalog.

const ID = /^[A-Za-z0-9_-]{6,40}$/;

/** Windows paths compare case-insensitively; POSIX ones do not. */
export function samePath(left, right) {
  if (typeof left !== 'string' || typeof right !== 'string' || !left || !right) return false;
  const trim = value => value.replace(/[\\/]+$/, '');
  if (process.platform === 'win32') {
    return trim(left).replaceAll('/', '\\').toLowerCase() === trim(right).replaceAll('/', '\\').toLowerCase();
  }
  return trim(left).replaceAll('\\', '/') === trim(right).replaceAll('\\', '/');
}

/**
 * Whether `child` is `parent` or sits below it. A Workspace often points at the
 * folder a project was created *in* (or the project folder itself), so path
 * equality alone misses the conversations the user still calls "my project".
 */
export function withinPath(child, parent) {
  if (typeof child !== 'string' || typeof parent !== 'string' || !child || !parent) return false;
  const trim = value => value.replace(/[\\/]+$/, '');
  const windows = process.platform === 'win32';
  let left = trim(child).replaceAll('\\', '/');
  let right = trim(parent).replaceAll('\\', '/');
  if (windows) { left = left.toLowerCase(); right = right.toLowerCase(); }
  return left === right || left.startsWith(right + '/');
}

/** Same folder, either direction: the Session's cwd is the project, below it,
 * or the folder the project was created in. */
export function relatedPath(left, right) {
  return samePath(left, right) || withinPath(left, right) || withinPath(right, left);
}

/** The display name of a project: its folder, which is the name the user gave it. */
export function projectName(path) {
  if (typeof path !== 'string') return '';
  const parts = path.split(/[\\/]+/).filter(Boolean);
  return parts.length ? parts[parts.length - 1] : '';
}

/** Studio's `/api/projects` rows become `{projectId, path, name}`; junk is dropped. */
export function normalizeProjects(value) {
  if (!Array.isArray(value)) return [];
  const seen = new Set();
  const projects = [];
  for (const item of value) {
    const projectId = typeof item?.projectId === 'string' ? item.projectId
      : typeof item?.id === 'string' ? item.id : '';
    const projectPath = typeof item?.path === 'string' ? item.path : '';
    if (!ID.test(projectId) || !projectPath || seen.has(projectId)) continue;
    seen.add(projectId);
    projects.push({ projectId, path: projectPath, name: projectName(projectPath) });
  }
  return projects;
}

/** Stored bindings become `{projectId, sessionId, path}`; one row per project. */
export function normalizeBindings(value) {
  if (!Array.isArray(value)) return [];
  const seen = new Set();
  const bindings = [];
  for (const item of value) {
    const projectId = typeof item?.projectId === 'string' ? item.projectId : '';
    const sessionId = typeof item?.sessionId === 'string' ? item.sessionId : '';
    if (!ID.test(projectId) || !sessionId || seen.has(projectId)) continue;
    seen.add(projectId);
    bindings.push({ projectId, sessionId, path: typeof item.path === 'string' ? item.path : '' });
  }
  return bindings;
}

function titleOf(item) {
  const projected = item?.projections && typeof item.projections === 'object' ? item.projections.values : undefined;
  if (typeof projected?.title === 'string' && projected.title.trim()) return projected.title.trim();
  return typeof item?.title === 'string' ? item.title.trim() : '';
}

/**
 * Build the one payload the sidebar draws.
 *
 * `hiddenSessionIds` is the union of every bound Session and every catalog
 * Session whose cwd is a project folder — the folder itself, a folder below it,
 * or the folder the project was created in. The second half is what catches the
 * conversations older releases left unbound (and workspaces opened on the
 * project's parent folder): they still belong to a project, so the "projects
 * only" filter must keep them.
 *
 * Projects without a binding still ship a row — that is the "未开始" state the
 * user opens from the editing area.
 *
 * @param {object} input
 * @param {Array} input.projects - Studio's project rows (`{id, path}`).
 * @param {Array} input.bindings - stored `{projectId, path, sessionId}` records.
 * @param {Array} input.sessions - session catalog items (`{sessionId, cwd, …}`).
 * @returns {{projects: Array, hiddenSessionIds: string[]}}
 */
export function buildAreaView({ projects, bindings, sessions } = {}) {
  const list = normalizeProjects(projects);
  const bound = normalizeBindings(bindings);
  const byProject = new Map();
  for (const binding of bound) if (!byProject.has(binding.projectId)) byProject.set(binding.projectId, binding);
  const catalog = Array.isArray(sessions) ? sessions : [];
  const bySession = new Map();
  for (const item of catalog) {
    if (typeof item?.sessionId === 'string' && !bySession.has(item.sessionId)) bySession.set(item.sessionId, item);
  }
  const hidden = new Set();
  for (const binding of bound) hidden.add(binding.sessionId);
  for (const item of catalog) {
    if (typeof item?.sessionId !== 'string') continue;
    if (list.some(project => relatedPath(item.cwd, project.path))) hidden.add(item.sessionId);
  }
  const rows = list.map(project => {
    const binding = byProject.get(project.projectId);
    const sessionId = binding?.sessionId ?? null;
    const item = sessionId ? bySession.get(sessionId) : undefined;
    return { ...project, sessionId, sessionTitle: titleOf(item) };
  });
  return { projects: rows, hiddenSessionIds: [...hidden].sort() };
}
