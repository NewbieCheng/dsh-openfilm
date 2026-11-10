import { readFilm, readFilmFile, filmHtml } from '../vendor/film-doc.mjs';

export const MAX_FILM_BYTES = 2 * 1024 * 1024;
const fail = (code, message, extra = {}) => Object.assign(new Error(message), { code, ...extra });
const bytes = (text) => new TextEncoder().encode(text).byteLength;

/**
 * Create an async film service. The trusted caller MUST supply an already-authorized
 * workspace FsTarget from this fs provider and its sandboxPolicy; neither browser
 * input nor containment checks grant authority. The provider owns write guards and
 * sandbox enforcement. Path checks cannot prevent concurrent directory replacement.
 * @param {{fs: object, workspace: object, sandboxPolicy: object}} options
 */
export function createFilmOperations({ fs, workspace, sandboxPolicy } = {}) {
  if (!fs || !workspace || typeof workspace.targetKey !== 'string' || typeof workspace.displayPath !== 'string'
      || !sandboxPolicy || typeof sandboxPolicy !== 'object' || Array.isArray(sandboxPolicy)
      || !['read-only', 'workspace-write', 'danger-full-access'].includes(sandboxPolicy.mode)
      || typeof sandboxPolicy.workspaceRoot !== 'string' || !sandboxPolicy.workspaceRoot) {
    throw fail('AUTHORITY', 'An authorized workspace FsTarget and sandboxPolicy are required');
  }
  const cwd = fs.processPath(workspace);
  if (typeof cwd !== 'string' || !cwd) throw fail('AUTHORITY', 'Workspace must have a provider process path');

  async function target(project, allowAbsent) {
    if (typeof project !== 'string' || !project || /^[a-z]:/i.test(project) || /^[\\/]/.test(project)
        || project.includes('\0') || project.split(/[\\/]/).some(p => !p || p === '.' || p === '..' || p.includes(':'))) {
      throw fail('PATH', 'project must be a relative directory without traversal');
    }
    const parts = project.split(/[\\/]/);
    const rootInfo = await fs.stat(workspace);
    if (!rootInfo || rootInfo.type !== 'directory') throw fail('PATH', 'workspace must be an existing directory');
    let rel = '';
    for (const part of parts) {
      rel = rel ? `${rel}/${part}` : part;
      const info = await fs.lstat(rel, { cwd });
      if (!info || info.type !== 'directory') throw fail('PATH', 'project directories must exist and not be links');
      const dir = await fs.resolve(rel, { cwd });
      if (!await fs.contains(workspace, dir)) throw fail('PATH', 'project outside workspace');
    }
    const filePath = `${rel}/film.html`;
    const entry = await fs.lstat(filePath, { cwd });
    if (entry && entry.type !== 'file') throw fail('PATH', 'film.html must be a regular file, not a link');
    if (!entry && !allowAbsent) throw fail('FS_NOT_FOUND', 'film.html does not exist');
    const file = await fs.resolve(filePath, { cwd });
    if (!await fs.contains(workspace, file)) throw fail('PATH', 'film.html outside workspace');
    return file;
  }

  function parse(text) {
    if (typeof text !== 'string' || bytes(text) > MAX_FILM_BYTES) throw fail('FS_TOO_LARGE', 'film.html exceeds size limit');
    let result;
    try { result = readFilmFile(text); } catch (cause) { throw fail('INVALID_FILM', 'Invalid film.html', { cause }); }
    if (!result.doc) throw fail('INVALID_FILM', 'Invalid film.html', { problems: result.problems });
    return { text, value: result.value, doc: result.doc, problems: result.problems };
  }

  async function readTarget(file) {
    const info = await fs.stat(file);
    if (!info) throw fail('FS_NOT_FOUND', 'film.html does not exist');
    if (info.type !== 'file') throw fail('PATH', 'film.html must be a regular file');
    if (!Number.isSafeInteger(info.size) || info.size < 0 || info.size > MAX_FILM_BYTES) throw fail('FS_TOO_LARGE', 'film.html size is unknown or exceeds limit');
    const data = await fs.readBytes(file, undefined, MAX_FILM_BYTES);
    let text;
    try { text = new TextDecoder('utf-8', { fatal: true }).decode(data); }
    catch (cause) { throw fail('INVALID_FILM', 'film.html is not valid UTF-8', { cause }); }
    const after = await fs.stat(file);
    if (!after || after.type !== 'file' || after.version !== info.version) throw fail('FS_STALE_VERSION', 'film.html changed while reading');
    return { ...parse(text), version: info.version };
  }

  function serialize(value, before = '') {
    let copy, checked, text;
    try {
      copy = structuredClone(value);
      checked = readFilm(copy);
      if (!checked.doc) throw fail('INVALID_FILM', 'Invalid film value', { problems: checked.problems });
      text = filmHtml(copy, before);
    } catch (cause) {
      if (cause.code === 'INVALID_FILM') throw cause;
      throw fail('INVALID_FILM', 'Invalid film value', { cause });
    }
    return parse(text);
  }

  function requireWrite() {
    if (sandboxPolicy.mode === 'read-only') throw fail('READ_ONLY', 'The session policy does not allow writes');
  }

  return Object.freeze({
    async read(project) { return readTarget(await target(project, false)); },
    async create(project, value = { tracks: [] }) {
      requireWrite();
      const file = await target(project, true);
      const result = serialize(value);
      const outcome = await fs.writeText(file, result.text, { kind: 'createIfAbsent' }, undefined, sandboxPolicy);
      return { ...result, version: outcome.version };
    },
    async edit(project, value, expectedVersion) {
      requireWrite();
      if (typeof expectedVersion !== 'string' || !expectedVersion) throw fail('VERSION', 'expectedVersion is required');
      const file = await target(project, false);
      const before = await readTarget(file);
      if (before.version !== expectedVersion) throw fail('FS_STALE_VERSION', 'film.html has changed');
      const result = serialize(value, before.text);
      const outcome = await fs.writeText(file, result.text, { kind: 'replaceIfVersion', version: expectedVersion }, undefined, sandboxPolicy);
      return { ...result, version: outcome.version };
    },
  });
}
