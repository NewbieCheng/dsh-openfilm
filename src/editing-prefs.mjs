// Per-project display preferences for the sidebar's editing area: a pin and a
// display title. They are deliberately NOT the project's real name or the DSH
// Session title: renaming here only changes how this list labels the row, and a
// pin only changes its order, so nothing a person sees in Studio or DSH moves.
//
// The file is small and rewritten atomically; a lost file costs the pins and
// display names, never a project or a conversation.
import { readFileSync, writeFileSync, renameSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

const VERSION = 1;
const PROJECT_ID = /^[A-Za-z0-9_-]{6,40}$/;
const SESSION_ID = /^[A-Za-z0-9_-]{6,60}$/;
const MAX_TITLE = 120;

function empty() { return { version: VERSION, projects: {} }; }

function read(file, fs) {
  try {
    const value = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (!value || value.version !== VERSION || typeof value.projects !== 'object' || value.projects === null) return empty();
    return value;
  } catch { return empty(); }
}

/**
 * @param {object} [deps]
 * @param {string} [deps.file] - JSON file; without it the store lives in memory (tests)
 * @param {typeof import('node:fs')} [deps.fs]
 */
export function createEditingPrefs({ file, fs } = {}) {
  const api = fs ?? { readFileSync, writeFileSync, renameSync, mkdirSync };
  let data = file ? read(file, api) : empty();
  const flush = () => {
    if (!file) return;
    try {
      api.mkdirSync(dirname(file), { recursive: true });
      const temporary = `${file}.${process.pid}.tmp`;
      api.writeFileSync(temporary, JSON.stringify(data, null, 2), 'utf8');
      api.renameSync(temporary, file);
    } catch { /* pins and display names are cosmetic; a write failure must not break the list */ }
  };
  return {
    get(projectId) {
      if (typeof projectId !== 'string' || !PROJECT_ID.test(projectId)) return undefined;
      const record = data.projects[projectId];
      if (!record || typeof record !== 'object') return undefined;
      return {
        pinned: record.pinned === true,
        ...(typeof record.title === 'string' && record.title ? { title: record.title } : {}),
      };
    },
    set(projectId, patch) {
      if (typeof projectId !== 'string' || !PROJECT_ID.test(projectId)) return undefined;
      if (!patch || typeof patch !== 'object') return undefined;
      const next = { ...(data.projects[projectId] ?? {}) };
      if (patch.pinned !== undefined) {
        if (patch.pinned) next.pinned = true; else delete next.pinned;
      }
      if (patch.title !== undefined) {
        const title = typeof patch.title === 'string' ? patch.title.trim().slice(0, MAX_TITLE) : '';
        if (title) next.title = title; else delete next.title;
      }
      if (Object.keys(next).length === 0) delete data.projects[projectId];
      else data.projects[projectId] = next;
      flush();
      return this.get(projectId) ?? { pinned: false };
    },
    all() {
      return Object.fromEntries(Object.entries(data.projects).map(([projectId, record]) => [projectId, {
        pinned: record?.pinned === true,
        ...(typeof record?.title === 'string' && record.title ? { title: record.title } : {}),
      }]));
    },
    getSession(projectId, sessionId) {
      if (typeof projectId !== 'string' || !PROJECT_ID.test(projectId)) return undefined;
      if (typeof sessionId !== 'string' || !SESSION_ID.test(sessionId)) return undefined;
      const record = data.sessions?.[`${projectId}:${sessionId}`];
      if (!record || typeof record !== 'object') return undefined;
      return {
        pinned: record.pinned === true,
        ...(typeof record.title === 'string' && record.title ? { title: record.title } : {}),
      };
    },
    setSession(projectId, sessionId, patch) {
      if (typeof projectId !== 'string' || !PROJECT_ID.test(projectId)) return undefined;
      if (typeof sessionId !== 'string' || !SESSION_ID.test(sessionId)) return undefined;
      if (!patch || typeof patch !== 'object') return undefined;
      data.sessions ??= {};
      const key = `${projectId}:${sessionId}`;
      const next = { ...(data.sessions[key] ?? {}) };
      if (patch.pinned !== undefined) {
        if (patch.pinned) next.pinned = true; else delete next.pinned;
      }
      if (patch.title !== undefined) {
        const title = typeof patch.title === 'string' ? patch.title.trim().slice(0, MAX_TITLE) : '';
        if (title) next.title = title; else delete next.title;
      }
      if (Object.keys(next).length === 0) delete data.sessions[key];
      else data.sessions[key] = next;
      flush();
      return this.getSession(projectId, sessionId) ?? { pinned: false };
    },
  };
}
