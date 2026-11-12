/**
 * Project files, reached from the transcript.
 *
 * The official chat cannot load a project image and cannot open a product file by
 * itself: a markdown path resolves against the editor page (`/projects/...`), which
 * Studio does not serve, and a link is handed to the system browser, where the
 * proxy refuses it because that browser has no panel session (OF_SESSION_REQUIRED).
 *
 * So the page asks the Host instead of resolving the path itself. Two operations,
 * both fenced by the same rules:
 *
 *   read({ projectId, path })  -- image bytes for an inline picture, capped and
 *                                 limited to raster images so this is not a file
 *                                 server;
 *   open({ projectId, path })  -- hand a real file or folder to the operating
 *                                 system (default application, or reveal).
 *
 * A relative path is data from the renderer, never authority: the project root
 * comes from Studio's live project list (through `resolveProject`), the joined
 * path must stay inside it after realpath, and nothing outside is ever opened.
 */
import { spawn as nodeSpawn } from 'node:child_process';
import { readFile as readFileImpl, realpath as realpathImpl, stat as statImpl } from 'node:fs/promises';
import path from 'node:path';

export const PROJECT_ID = /^[A-Za-z0-9_-]{6,40}$/;

/** Raster images only: SVG can carry script, and this route is same-origin. */
const IMAGE_TYPES = Object.freeze({
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.avif': 'image/avif',
  '.bmp': 'image/bmp',
});

const MAX_IMAGE_BYTES = 24 * 1024 * 1024;
const MAX_RELATIVE_LENGTH = 400;

export function projectFileError(code, message) {
  return Object.assign(new Error(message), { code });
}

/**
 * A project-relative path, or null.
 *
 * Accepts what a transcript actually contains: forward or backward slashes, a
 * leading `./`, the angle brackets markdown allows around a destination. Refuses
 * drive letters, absolute paths, traversal, empty segments and control characters,
 * so the caller never has to trust the string.
 */
export function relativeProjectPath(value) {
  if (typeof value !== 'string') return null;
  let text = value.trim();
  if (!text || text.length > MAX_RELATIVE_LENGTH) return null;
  text = text.replace(/^<+/, '').replace(/>+$/, '').trim();
  if (!text) return null;
  if (/^[A-Za-z]:/.test(text) || text.startsWith('/') || text.startsWith('\\')) return null;
  text = text.replace(/\\/g, '/').replace(/^\.\//, '');
  if (!text) return null;
  const parts = text.split('/');
  for (const part of parts) {
    if (!part || part === '.' || part === '..') return null;
    if (/[\u0000-\u001f\u007f]/.test(part)) return null;
  }
  return parts.join('/');
}

/** True when `absolute` is strictly inside `root` (both already resolved). */
function inside(root, absolute) {
  const relative = path.relative(root, absolute);
  return Boolean(relative) && !relative.startsWith('..') && !path.isAbsolute(relative);
}

export function projectFilePath(root, relative) {
  const parts = relativeProjectPath(relative);
  if (!parts) throw projectFileError('PROJECT_FILE_PATH', 'A project-relative path is required');
  return path.resolve(root, ...parts.split('/'));
}

/** The command a desktop uses to hand a file to its owner. */
export function openCommand(platform, absolute, reveal) {
  if (platform === 'win32') {
    // Explorer, not `start`: one program, no shell quoting rules, and a folder is
    // opened as a folder. Reveal uses Explorer's own /select switch.
    return reveal ? { command: 'explorer.exe', args: ['/select,' + absolute] } : { command: 'explorer.exe', args: [absolute] };
  }
  if (platform === 'darwin') {
    return reveal ? { command: 'open', args: ['-R', absolute] } : { command: 'open', args: [absolute] };
  }
  return reveal ? { command: 'xdg-open', args: [path.dirname(absolute)] } : { command: 'xdg-open', args: [absolute] };
}

/**
 * Host-only. `resolveProject(projectId)` must verify the ID against the running
 * Studio and return its canonical path; that is the only place a path enters here.
 */
export function createProjectFiles({
  resolveProject,
  spawn = nodeSpawn,
  platform = process.platform,
  readFile = readFileImpl,
  realpath = realpathImpl,
  stat = statImpl,
} = {}) {
  if (typeof resolveProject !== 'function') throw new TypeError('resolveProject is required');

  async function locate(projectId, relative) {
    if (typeof projectId !== 'string' || !PROJECT_ID.test(projectId)) {
      throw projectFileError('PROJECT_FILE_INPUT', 'A project id is required');
    }
    const project = await resolveProject(projectId);
    if (!project || typeof project.path !== 'string') throw projectFileError('PROJECT_FILE_INPUT', 'Project unavailable');
    const root = await realpath(project.path);
    const absolute = projectFilePath(root, relative);
    if (!inside(root, absolute)) throw projectFileError('PROJECT_FILE_PATH', 'Path leaves the project');
    let info;
    let real;
    try {
      info = await stat(absolute);
      real = await realpath(absolute);
    } catch {
      throw projectFileError('PROJECT_FILE_MISSING', 'File not found');
    }
    // A symlink may point anywhere; the resolved target has to stay inside too.
    if (!inside(root, real)) throw projectFileError('PROJECT_FILE_PATH', 'Path leaves the project');
    return { root, absolute: real, info };
  }

  /** Image bytes for an inline picture. */
  async function read({ projectId, path: relative } = {}) {
    const file = await locate(projectId, relative);
    const type = IMAGE_TYPES[path.extname(file.absolute).toLowerCase()];
    if (!type) throw projectFileError('PROJECT_FILE_TYPE', 'Only images can be shown in the transcript');
    if (!file.info.isFile()) throw projectFileError('PROJECT_FILE_TYPE', 'Not a file');
    if (file.info.size > MAX_IMAGE_BYTES) throw projectFileError('PROJECT_FILE_SIZE', 'Image is too large');
    const bytes = await readFile(file.absolute);
    return { bytes, type };
  }

  /** Hand a file (or its folder) to the operating system. Never waits for it. */
  async function open({ projectId, path: relative, reveal = false } = {}) {
    const file = await locate(projectId, relative);
    const folder = file.info.isDirectory();
    if (!folder && !file.info.isFile()) throw projectFileError('PROJECT_FILE_TYPE', 'Not a file');
    const { command, args } = openCommand(platform, file.absolute, reveal === true || folder);
    try {
      const child = spawn(command, args, { detached: true, stdio: 'ignore', windowsHide: true });
      if (child && typeof child.on === 'function') child.on('error', () => {});
      if (child && typeof child.unref === 'function') child.unref();
    } catch {
      // The page only shows a failed toast; a spawn error must not fail a turn.
      throw projectFileError('PROJECT_FILE_OPEN_FAILED', 'The system refused to open this file');
    }
    return { opened: true, folder };
  }

  return Object.freeze({ read, open });
}
