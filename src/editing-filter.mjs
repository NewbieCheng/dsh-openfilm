// Pure filtering for the sidebar's editing list. Keeping it out of the DOM code
// is what makes the search rules testable: the row a person sees is the row the
// query matches — project display name, original name, path, or a conversation's
// visible title (including the `新对话` fallback).
export const SESSION_FALLBACK = '新对话';

export function sessionDisplayTitle(session) {
  const title = typeof session?.title === 'string' ? session.title.trim() : '';
  return title || SESSION_FALLBACK;
}

export function projectDisplayTitle(project) {
  const title = typeof project?.title === 'string' ? project.title.trim() : '';
  return title || (typeof project?.name === 'string' && project.name) || (typeof project?.projectId === 'string' ? project.projectId : '');
}

const lower = value => (typeof value === 'string' ? value.toLowerCase() : '');
const includes = (value, needle) => lower(value).includes(needle);

export function normalizeQuery(query) {
  return typeof query === 'string' ? query.trim().toLowerCase() : '';
}

/** Where `needle` sits in `text`, case-insensitively; null when absent. */
export function matchRange(text, query) {
  const needle = normalizeQuery(query);
  if (!needle) return null;
  const index = lower(text).indexOf(needle);
  return index < 0 ? null : { start: index, end: index + needle.length };
}

/**
 * @param {Array} projects - host rows: { projectId, name, title?, path?, sessions[] }
 * @param {{query?: string, archived?: boolean}} options
 * @returns {{project: object, sessions: object[], open: boolean}[]}
 *   A query row is always `open`: collapsed folders must not hide a hit.
 */
export function filterEditing(projects, { query = '', archived = true } = {}) {
  const needle = normalizeQuery(query);
  const rows = [];
  for (const project of Array.isArray(projects) ? projects : []) {
    if (!project || typeof project !== 'object') continue;
    if (!archived && project.archived === true) continue;
    const sessions = (Array.isArray(project.sessions) ? project.sessions : [])
      .filter(session => session && typeof session === 'object')
      .filter(session => archived || session.archived !== true);
    if (!needle) {
      rows.push({ project, sessions, open: false });
      continue;
    }
    // A project whose own name/path matches shows every conversation it has;
    // otherwise only the conversations whose visible title matches.
    const projectHit = [projectDisplayTitle(project), project.name, project.path, project.projectId]
      .some(value => includes(value, needle));
    const matched = projectHit ? sessions : sessions.filter(session => includes(sessionDisplayTitle(session), needle));
    if (!projectHit && !matched.length) continue;
    rows.push({ project, sessions: matched, open: true });
  }
  return rows;
}
