/**
 * The marker that says a project has been shown to the person.
 *
 * The kernel CLI writes `.film/opened` (an empty file) when `open` has started Studio on a project.
 * `look` and `render` then skip that step — and skipping it is what keeps a browser window from
 * opening behind the person's back (`bin/openfilm.mjs`: "a project Studio has never shown"). Inside
 * DSH the film already has a window: the panel. So the Host writes the same marker itself when it
 * binds a conversation to a project: Studio has shown it, the CLI has nothing left to open.
 *
 * Best-effort and idempotent: a project that cannot be marked still works, it just risks the CLI
 * opening a window, which `OPENFILM_NO_BROWSER=1` then suppresses anyway.
 */
import { mkdir, writeFile, access } from 'node:fs/promises';
import { join } from 'node:path';

/** Where the kernel keeps its per-project state. */
export const OPENED_MARKER = join('.film', 'opened');

const exists = async path => {
  try { await access(path); return true; } catch { return false; }
};

/**
 * Mark `projectPath` as shown, once.
 *
 * @param {string} projectPath absolute path of the film folder
 * @returns {Promise<boolean>} true when the marker is there afterwards
 */
export async function markProjectOpened(projectPath, { mkdirImpl = mkdir, writeImpl = writeFile, existsImpl = exists } = {}) {
  if (typeof projectPath !== 'string' || projectPath.length === 0) return false;
  const marker = join(projectPath, OPENED_MARKER);
  try {
    if (await existsImpl(marker)) return true;
    await mkdirImpl(join(projectPath, '.film'), { recursive: true });
    // The kernel writes exactly this: an empty file. Its content is never read.
    await writeImpl(marker, '');
    return true;
  } catch {
    return false;
  }
}
