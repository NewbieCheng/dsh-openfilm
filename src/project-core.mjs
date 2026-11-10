import { createHash, randomUUID } from 'node:crypto';
import { closeSync, fstatSync, linkSync, lstatSync, openSync, readFileSync, realpathSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { TextDecoder } from 'node:util';

// OpenFilm 0.3.1, commit a85a80a9742981f0f77f61df88a2780984f8f3fb.
// The byte-identical MIT source and its license ship in ../vendor/.
export const FILM_DOC_SHA256 = '030a3c1a8271ca47906a12af895bbbbeeb7e3c875baa98f2c8621c1837369e4a';
const REFERENCE = fileURLToPath(new URL('../vendor/film-doc.mjs', import.meta.url));
const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');
const fail = (code, message) => Object.assign(new Error(message), { code });
const decoder = new TextDecoder('utf-8', { fatal: true });

/**
 * Open a capability for one existing workspace. project is a relative existing
 * directory; no directory, HTML, scripts, or media is executed or created by it.
 * filmDocPath may be wired to a shipped, byte-identical copy of the MIT source.
 *
 * Writes serialize cooperating users of this core using an exclusive lock.
 * The final hash check + rename is NOT a filesystem CAS: uncooperative writers or
 * hostile directory renames can race it. Use only in a trusted local workspace;
 * every writer must honor the same lock for the version guarantee.
 */
export async function createProjectCore({ workspace, filmDocPath = REFERENCE }) {
  if (typeof workspace !== 'string' || !path.isAbsolute(workspace)) throw fail('WORKSPACE', 'workspace must be an absolute directory');
  const root = realpathSync(workspace);
  if (!lstatSync(root).isDirectory()) throw fail('WORKSPACE', 'workspace must be a directory');
  const bytes = readFileSync(filmDocPath);
  if (digest(bytes) !== FILM_DOC_SHA256) throw fail('DEPENDENCY', 'film-doc source does not match the pinned SHA-256');
  // Import precisely the bytes that were verified, not a mutable path.
  const film = await import(`data:text/javascript;base64,${bytes.toString('base64')}`);

  function directory(project) {
    if (typeof project !== 'string' || !project || path.isAbsolute(project) || /^[A-Za-z]:/.test(project)) throw fail('PATH', 'project must be a relative directory');
    const parts = project.split(/[\\/]/);
    if (parts.some((p) => p === '..' || p === '' || p.includes('\0'))) throw fail('PATH', 'invalid project path');
    let dir = root;
    for (const part of parts) {
      if (part === '.') continue;
      dir = path.join(dir, part);
      const info = lstatSync(dir);
      if (info.isSymbolicLink() || !info.isDirectory()) throw fail('PATH', 'project directories must not be links');
    }
    const actual = realpathSync(dir);
    const rel = path.relative(root, actual);
    if (rel === '..' || rel.startsWith(`..${path.sep}`) || path.isAbsolute(rel)) throw fail('PATH', 'project outside workspace');
    return actual;
  }
  function readAt(dir) {
    const file = path.join(dir, 'film.html');
    const info = lstatSync(file);
    if (info.isSymbolicLink() || !info.isFile()) throw fail('PATH', 'film.html must be a regular file, not a link');
    // Compare path and handle identity to reject swaps between lstat and open.
    const fd = openSync(file, 'r');
    try {
      const opened = fstatSync(fd);
      if (!opened.isFile() || opened.dev !== info.dev || opened.ino !== info.ino) throw fail('PATH', 'film.html changed while opening');
      const data = readFileSync(fd);
      const text = decoder.decode(data);
      const { value, doc, problems } = film.readFilmFile(text);
      return { text, value, doc, problems, version: digest(data) };
    } finally { closeSync(fd); }
  }
  function checked(value, before = '') {
    const copy = structuredClone(value);
    const { doc, problems } = film.readFilm(copy);
    if (!doc) throw Object.assign(fail('INVALID_FILM', 'Invalid film value'), { problems });
    const text = film.filmHtml(copy, before);
    const parsed = film.readFilmFile(text);
    if (!parsed.doc) throw Object.assign(fail('INVALID_FILM', 'Generated film.html is invalid'), { problems: parsed.problems });
    return text;
  }
  function locked(dir, action) {
    const lock = path.join(dir, '.dsh-openfilm.lock');
    let fd;
    try { fd = openSync(lock, 'wx', 0o600); }
    catch (e) { if (e.code === 'EEXIST') throw fail('LOCKED', 'project is locked by another writer'); throw e; }
    try { return action(); } finally { closeSync(fd); unlinkSync(lock); }
  }
  function temporary(dir, text, publish) {
    const temp = path.join(dir, `.dsh-openfilm-${randomUUID()}.tmp`);
    let made = false;
    try {
      const fd = openSync(temp, 'wx', 0o600);
      made = true;
      try { writeFileSync(fd, text, 'utf8'); } finally { closeSync(fd); }
      return publish(temp);
    } finally { if (made) { try { unlinkSync(temp); } catch (e) { if (e.code !== 'ENOENT') throw e; } } }
  }
  return Object.freeze({
    read(project) { return readAt(directory(project)); },
    create(project, value = { tracks: [] }) {
      const dir = directory(project);
      const text = checked(value);
      return locked(dir, () => temporary(dir, text, (temp) => {
        // link is an atomic no-replace create, including against other programs.
        linkSync(temp, path.join(dir, 'film.html'));
        return readAt(dir);
      }));
    },
    write(project, value, expectedVersion) {
      if (typeof expectedVersion !== 'string' || !/^[a-f0-9]{64}$/.test(expectedVersion)) throw fail('VERSION', 'expectedVersion must be a SHA-256 version');
      const dir = directory(project);
      return locked(dir, () => {
        const before = readAt(dir);
        if (before.version !== expectedVersion) throw fail('CONFLICT', 'film.html has changed');
        if (!before.doc) throw Object.assign(fail('INVALID_FILM', 'Existing film.html is invalid'), { problems: before.problems });
        const text = checked(value, before.text);
        return temporary(dir, text, (temp) => {
          if (readAt(dir).version !== expectedVersion) throw fail('CONFLICT', 'film.html has changed');
          renameSync(temp, path.join(dir, 'film.html'));
          return readAt(dir);
        });
      });
    },
  });
}
