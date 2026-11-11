import { createHash } from 'node:crypto';
import { readFile, lstat } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { OPENFILM_VERSION } from './studio-runtime.mjs';

// The shell and Studio must be released together. Change this pin alongside the
// packaging script and the official npm dependency, not in response to UI input.
const OFFICIAL_COMMIT = '758b1a3888819bf191db191f690c4ca2fcb292af';
const shellRoot = fileURLToPath(new URL('../vendor/official-shell/', import.meta.url));
const fail = () => Object.assign(new Error('The matching OpenFilm desktop shell is unavailable or damaged'), { code: 'OFFICIAL_SHELL_UNAVAILABLE' });

/** Resolve the separately built official shell without accepting a browser path.
 * The manifest detects version mismatch and accidental corruption; it is not a
 * signature or a substitute for validating the upstream build or package origin.
 */
export async function resolveOfficialShell() {
  try {
    const manifestBytes = await readFile(join(shellRoot, 'manifest.json'));
    if (manifestBytes.length > 128 * 1024) throw fail();
    const manifest = JSON.parse(manifestBytes.toString('utf8'));
    if (manifest?.version !== OPENFILM_VERSION || manifest.commit !== OFFICIAL_COMMIT ||
        !manifest.files || typeof manifest.files !== 'object' || Array.isArray(manifest.files)) throw fail();
    const assets = Object.entries(manifest.files).filter(([name]) => name.startsWith('ui/'));
    if (assets.length < 2 || assets.length > 256 || !assets.some(([name]) => name === 'ui/index.html') ||
        !assets.some(([name]) => /^ui\/assets\/[A-Za-z0-9._-]+\.js$/.test(name))) throw fail();
    for (const [name, digest] of assets) {
      if (!/^ui\/(?:[A-Za-z0-9_-]+\/)*[A-Za-z0-9._-]+$/.test(name) ||
          !/^[a-f0-9]{64}$/.test(digest) || name.split('/').some(part => part === '.' || part === '..')) throw fail();
      const path = join(shellRoot, ...name.split('/'));
      const stat = await lstat(path);
      if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 32 * 1024 * 1024) throw fail();
      const bytes = await readFile(path);
      if (createHash('sha256').update(bytes).digest('hex') !== digest) throw fail();
    }
    return join(shellRoot, 'ui');
  } catch {
    throw fail();
  }
}
