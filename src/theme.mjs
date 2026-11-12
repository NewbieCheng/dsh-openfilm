import { readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { brandCssVars, getBrand } from './brand.mjs';

/**
 * One stylesheet pipeline for every surface we do not own the source of.
 *
 * Why a module instead of appending CSS in the proxy:
 * - The same files are the release artefact. Development injects them; packaging
 *   can bake them into the vendored build, so "injection" never becomes the
 *   permanent answer for a style that should ship inside the product.
 * - The surface list is a registry. Adding a surface is one row, not another
 *   string concatenation in a 900-line proxy.
 *
 * Failure policy: a missing file or an unreadable brand degrades to no
 * injection (the page must still work), while an unknown surface is a
 * programmer error and throws.
 */
export const THEME_SURFACES = Object.freeze({
  shell: Object.freeze(['tokens.css', 'shell.css']),
  studio: Object.freeze(['tokens.css', 'studio.css']),
});

/**
 * Which stylesheet a document gets.
 *
 * The shell and the editor are served from the same origin: when the official
 * shell is on, `/` is the shell and `/projects/<id>` is the editor; when it is
 * off, `/` is the editor. Route it here so the proxy stays a one-line call.
 */
export function themeSurfaceFor(pathname, officialShell) {
  return officialShell && pathname === '/' ? 'shell' : 'studio';
}

const DEFAULT_DIR = fileURLToPath(new URL('../assets/theme/', import.meta.url));

export function createTheme({ dir = DEFAULT_DIR, brand = getBrand, env = process.env } = {}) {
  const cache = new Map();

  function read(name) {
    const path = join(dir, name);
    const mtime = Math.round(statSync(path).mtimeMs);
    const hit = cache.get(path);
    if (hit && hit.mtime === mtime) return hit.css;
    const css = readFileSync(path, 'utf8');
    cache.set(path, { mtime, css });
    return css;
  }

  function injection(surface) {
    if (env.NO996_OPENFILM_THEME === '0') return '';
    const files = THEME_SURFACES[surface];
    if (!files) throw new TypeError(`unknown theme surface: ${surface}`);
    try {
      let css = brandCssVars(brand());
      for (const name of files) css += read(name);
      // A stray </style> would close the injected block and turn the rest of the
      // stylesheet into page markup. Refuse the whole surface instead.
      if (/<\/style/i.test(css)) return '';
      return `<style data-no996-theme="${surface}">${css}</style>`;
    } catch {
      return '';
    }
  }

  function version() {
    try {
      let stamp = Math.round(statSync(join(dir, 'tokens.css')).mtimeMs);
      for (const name of Object.values(THEME_SURFACES).flat()) {
        stamp = Math.max(stamp, Math.round(statSync(join(dir, name)).mtimeMs));
      }
      return String(stamp);
    } catch {
      return '';
    }
  }

  return Object.freeze({ injection, version, surfaces: THEME_SURFACES });
}

export const theme = createTheme();
