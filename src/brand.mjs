import { readFileSync, statSync } from 'node:fs';

/**
 * The one place our product identity lives.
 *
 * Two rules make this worth a module rather than a handful of constants:
 * - Host code must not hardcode a product name or a colour; otherwise a rename
 *   turns into a repository-wide search and half the surfaces get missed.
 * - The upstream attribution is data too. Rebranding must never delete it, so
 *   it travels with the brand instead of living in a comment somewhere.
 */
const BRAND_URL = new URL('../brand/brand.json', import.meta.url);
const HEX = /^#[0-9a-f]{6}$/i;
const NAME_MAX = 24;

let cached = null;

function invalid(reason) {
  return Object.assign(new Error(`brand/brand.json: ${reason}`), { code: 'BRAND_INVALID' });
}

function requireText(value, field, max = 120) {
  if (typeof value !== 'string' || !value.trim() || value.length > max) throw invalid(`${field} must be 1-${max} characters`);
  return value.trim();
}

/** Validate a parsed brand document. Exported so tests can pin the contract. */
export function validateBrand(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw invalid('must be an object');
  const name = requireText(raw.name, 'name', NAME_MAX);
  const nameEn = requireText(raw.nameEn, 'nameEn', NAME_MAX * 2);
  const slug = requireText(raw.slug, 'slug', 64);
  if (!/^[a-z0-9][a-z0-9-]*$/.test(slug)) throw invalid('slug must be lowercase kebab-case');
  const colors = raw.colors;
  if (!colors || typeof colors !== 'object' || Array.isArray(colors)) throw invalid('colors must be an object');
  const cleanColors = {};
  for (const [key, value] of Object.entries(colors)) {
    if (typeof value !== 'string' || !HEX.test(value)) throw invalid(`colors.${key} must be #rrggbb`);
    cleanColors[key] = value.toLowerCase();
  }
  for (const required of ['accent', 'paper', 'ink']) {
    if (!cleanColors[required]) throw invalid(`colors.${required} is required`);
  }
  const upstream = raw.upstream;
  if (!upstream || typeof upstream !== 'object') throw invalid('upstream attribution is required');
  return Object.freeze({
    name,
    nameEn,
    slug,
    vendor: requireText(raw.vendor, 'vendor', NAME_MAX),
    tagline: requireText(raw.tagline, 'tagline', 80),
    colors: Object.freeze(cleanColors),
    links: Object.freeze({ ...(raw.links ?? {}) }),
    upstream: Object.freeze({
      name: requireText(upstream.name, 'upstream.name', 40),
      version: requireText(upstream.version, 'upstream.version', 20),
      license: requireText(upstream.license, 'upstream.license', 40),
      notice: requireText(upstream.notice, 'upstream.notice', 400),
    }),
  });
}

export function getBrand() {
  if (!cached) cached = validateBrand(JSON.parse(readFileSync(BRAND_URL, 'utf8')));
  return cached;
}

/** CSS custom properties every surface inherits; the theme files build on them. */
export function brandCssVars(brand = getBrand()) {
  const pairs = Object.entries(brand.colors).map(([key, value]) => `  --n996-${key}: ${value};`);
  return `:root{\n${pairs.join('\n')}\n  --n996-font: "Inter", "PingFang SC", "Microsoft YaHei", system-ui, sans-serif;\n  --n996-radius: 10px;\n  --n996-gap: 8px;\n}\n`;
}

/** Version stamp for cache-busting; changes when the brand file does. */
export function brandVersion() {
  try {
    return String(Math.round(statSync(BRAND_URL).mtimeMs));
  } catch {
    return '';
  }
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[char]));
}

/**
 * Replace the document title of an upstream page with ours.
 *
 * The shell and the editor both ship `<title>OpenFilm</title>`. The app may
 * overwrite it at runtime, but the tab, history entry and first paint should
 * carry our name, not the upstream one.
 */
export function replaceTitle(html, brand = getBrand()) {
  return String(html).replace(/<title>[^<]*<\/title>/i, `<title>${escapeHtml(brand.name)}</title>`);
}
