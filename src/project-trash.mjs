// Deleting a project is the only irreversible part of the folder menu, so the
// file move lives in one small module with explicit guards and injected fs:
// tests can prove every refusal without touching a real project.
import { access, mkdir, realpath, rename, rm, stat } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, sep } from 'node:path';
import { homedir } from 'node:os';

export const TRASH_DIR = '.no996-trash';
// A directory is an OpenFilm project when it carries the Studio marker, our
// marker, or the film itself. A bare folder is never deleted.
const MARKERS = ['.openfilm', '.film', 'film.html'];

const failure = (code, message, cause) => Object.assign(new Error(message), { code, ...(cause ? { cause } : {}) });

const pad = value => String(value).padStart(2, '0');
function stamp(date) {
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
}

/**
 * @param {object} [deps]
 * @param {object} [deps.fs] - subset of node:fs/promises (tests inject failures)
 * @param {string} [deps.home]
 * @param {() => Date} [deps.now]
 * @param {() => string} [deps.suffix]
 */
export function createProjectTrash({
  fs = { access, mkdir, realpath, rename, rm, stat },
  home = homedir(),
  now = () => new Date(),
  suffix = () => Math.random().toString(36).slice(2, 8),
} = {}) {
  async function guard(rawPath) {
    if (typeof rawPath !== 'string' || !isAbsolute(rawPath)) throw failure('PROJECT_PATH_INVALID', 'Project path must be absolute');
    let path;
    try { path = await fs.realpath(rawPath); } catch (cause) { throw failure('PROJECT_PATH_INVALID', 'Project path does not exist', cause); }
    let info;
    try { info = await fs.stat(path); } catch (cause) { throw failure('PROJECT_PATH_INVALID', 'Project path is unreadable', cause); }
    if (!info.isDirectory()) throw failure('PROJECT_PATH_INVALID', 'Project path is not a directory');
    const homePath = home ? await fs.realpath(home).catch(() => home) : '';
    if (path === homePath || path === dirname(path)) throw failure('PROJECT_PATH_INVALID', 'Refusing to delete a home or root directory');
    if (path.split(sep).filter(Boolean).length < 2) throw failure('PROJECT_PATH_INVALID', 'Refusing to delete a top-level directory');
    if (path.split(sep).includes(TRASH_DIR)) throw failure('PROJECT_PATH_INVALID', 'Already inside the trash');
    let marked = false;
    for (const marker of MARKERS) {
      try { await fs.access(join(path, marker)); marked = true; break; } catch { /* keep looking */ }
    }
    if (!marked) throw failure('PROJECT_NOT_OPENFILM', 'Not an OpenFilm project directory');
    return path;
  }

  /**
   * Move the project to `<projects root>/../.no996-trash/` (same volume, atomic
   * rename) or delete it outright. A busy directory aborts without a partial
   * delete; the caller must not clean chat/bindings until this succeeds.
   */
  async function discard(rawPath, { permanent = false } = {}) {
    const path = await guard(rawPath);
    if (permanent) {
      await fs.rm(path, { recursive: true, force: false });
      return { path, permanent: true, trashPath: null };
    }
    const root = join(dirname(path), '..', TRASH_DIR);
    await fs.mkdir(root, { recursive: true });
    const target = join(root, `${basename(path)}-${stamp(now())}-${suffix()}`);
    try {
      await fs.rename(path, target);
    } catch (cause) {
      const code = cause?.code;
      if (code === 'EACCES' || code === 'EPERM' || code === 'EBUSY' || code === 'ENOTEMPTY') {
        throw failure('PROJECT_BUSY', 'Project files are in use', cause);
      }
      throw failure('PROJECT_MOVE_FAILED', 'Could not move the project into the trash', cause);
    }
    return { path, permanent: false, trashPath: target };
  }

  return { discard, guard };
}
