// The sidebar list is a projection of Studio projects + Host bindings. Kept
// pure so the important rule is testable: a project without a conversation is
// still a row (otherwise its folder could never be deleted from the list).
import { basename } from 'node:path';

export function buildEditingProjects(projects, { bound = new Map(), prefs = {}, isArchived = () => false } = {}) {
  const items = [];
  for (const project of Array.isArray(projects) ? projects : []) {
    if (!project || typeof project.id !== 'string') continue;
    const record = bound.get(project.id);
    const sessionId = typeof record?.sessionId === 'string' ? record.sessionId : '';
    const archived = sessionId && typeof isArchived === 'function' ? isArchived(sessionId) === true : false;
    const pref = prefs[project.id];
    items.push({
      projectId: project.id,
      ...(sessionId ? { sessionId } : {}),
      archived,
      pinned: pref?.pinned === true,
      ...(typeof pref?.title === 'string' && pref.title ? { title: pref.title } : {}),
      name: typeof project.name === 'string' && project.name
        ? project.name
        : (typeof project.title === 'string' && project.title ? project.title : basename(String(project.path ?? '')) || project.id),
      path: typeof project.path === 'string' ? project.path : '',
    });
  }
  // Pinned rows lead; the rest keep Studio's own order.
  items.sort((left, right) => (right.pinned ? 1 : 0) - (left.pinned ? 1 : 0));
  return items;
}
