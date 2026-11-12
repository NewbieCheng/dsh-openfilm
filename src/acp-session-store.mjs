// Where a project's ACP Session id is remembered between Host restarts.
//
// The ACP agent owns the Session (it is a DSH Session, persisted by DSH itself),
// so this file only maps project -> session id. Losing it is survivable: the
// service falls back to `session/list` by cwd and then to a new Session.
import { readFileSync, renameSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

const VERSION = 1;
const PROJECT_ID = /^[A-Za-z0-9_-]{6,40}$/;

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
export function createAcpSessionStore({ file, fs } = {}) {
  const api = fs ?? { readFileSync, writeFileSync, renameSync, mkdirSync };
  let data = file ? read(file, api) : empty();
  const flush = () => {
    if (!file) return;
    try {
      api.mkdirSync(dirname(file), { recursive: true });
      const temporary = `${file}.${process.pid}.tmp`;
      api.writeFileSync(temporary, JSON.stringify(data, null, 2), 'utf8');
      api.renameSync(temporary, file);
    } catch { /* a lost mapping only costs a new Session, never a broken panel */ }
  };
  return {
    get(projectId) {
      if (typeof projectId !== 'string' || !PROJECT_ID.test(projectId)) return undefined;
      const record = data.projects[projectId];
      return record && typeof record.sessionId === 'string' ? { ...record } : undefined;
    },
    set(projectId, record) {
      if (typeof projectId !== 'string' || !PROJECT_ID.test(projectId)) return;
      if (!record || typeof record.sessionId !== 'string' || !record.sessionId) return;
      data.projects[projectId] = {
        sessionId: record.sessionId,
        ...(typeof record.cwd === 'string' ? { cwd: record.cwd } : {}),
        ...(typeof record.model === 'string' ? { model: record.model } : {}),
      };
      flush();
    },
    remove(projectId) {
      if (data.projects[projectId] === undefined) return;
      delete data.projects[projectId];
      flush();
    },
    all() { return Object.entries(data.projects).map(([projectId, record]) => ({ projectId, ...record })); },
  };
}
