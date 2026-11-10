import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/**
 * Template kit: turn a shot description (JSON) into a page (HTML).
 *
 * Why a build step at all: OpenFilm renders these pages as plain static HTML —
 * no bundler, no module loader, no fetch. Keeping the *source* small (one JSON
 * per shot, one HTML file per reusable unit) and generating the page keeps the
 * runtime untouched while making the template editable by a person or an agent.
 *
 * The rules are deliberately small:
 *   - a unit is an HTML file with `{{name}}` slots (escaped) and `{{{name}}}` slots (raw HTML);
 *   - a shot lists units in order; later units are appended, never repositioned;
 *   - the composer never reformats a unit's own markup — indentation inside a
 *     unit file is preserved, so diffs stay readable.
 */

const kitRoot = fileURLToPath(new URL('.', import.meta.url));

export function readCatalog() {
  return JSON.parse(readFileSync(new URL('catalog.json', import.meta.url), 'utf8'));
}

export function unitPath(id, catalog) {
  const unit = catalog.units[id];
  if (!unit) throw new Error(`unknown unit "${id}" (add it to _kit/catalog.json)`);
  return new URL(unit.file, import.meta.url);
}

export function readUnit(id, catalog) {
  return readFileSync(unitPath(id, catalog), 'utf8').replace(/\n$/, '');
}

const escapeHtml = value => String(value)
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;');

/** Resolve `{{a.b}}` against `{ copy: {...}, shot: {...} }`; missing values throw. */
export function lookup(path, scope) {
  const parts = path.split('.');
  let value = scope;
  for (const part of parts) {
    if (value === null || value === undefined) break;
    value = value[part];
  }
  if (value === undefined) throw new Error(`missing value for "{{${path}}}"`);
  return value;
}

/**
 * Fill a unit's slots. `{{x}}` is escaped, `{{{x}}}` is inserted as HTML, and
 * `{{x}}` with an undefined value is an error rather than an empty string: a
 * silently missing title is exactly the kind of template bug nobody notices
 * until the page renders blank.
 */
export function fill(template, scope) {
  return template
    .replace(/\{\{\{\s*([\w.]+)\s*\}\}\}/g, (_, path) => String(lookup(path, scope)))
    .replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_, path) => escapeHtml(lookup(path, scope)));
}

/**
 * A prop value is either literal text or one marker that points into the shot
 * (`{{copy.title}}` escaped, `{{{copy.title}}}` raw). Resolving props before the
 * unit is filled is what lets a unit say "I want raw HTML here" while the same
 * unit still escapes user text everywhere else.
 */
export function resolveProp(value, scope) {
  if (typeof value !== 'string') return { text: String(value ?? ''), raw: false };
  const trimmed = value.trim();
  const raw = /^\{\{\{\s*([\w.]+)\s*\}\}\}$/.exec(trimmed);
  if (raw) return { text: String(lookup(raw[1], scope)), raw: true };
  const escaped = /^\{\{\s*([\w.]+)\s*\}\}$/.exec(trimmed);
  if (escaped) return { text: String(lookup(escaped[1], scope)), raw: false };
  return { text: fill(value, scope), raw: false };
}

function fillUnit(template, props, scope) {
  // One directive only: `{{#if props.x}}…{{/if}}` keeps or drops a block. No
  // nesting — a unit that needs branching this deep should be two units.
  const resolvedOnce = template.replace(/\{\{#if\s+props\.([\w.]+)\s*\}\}([\s\S]*?)\{\{\/if\}\}/g, (_, key, body) => {
    const prop = props[key];
    return prop && prop.text ? body : '';
  });
  return resolvedOnce
    .replace(/\{\{\{\s*props\.([\w.]+)\s*\}\}\}/g, (_, key) => {
      const prop = props[key];
      if (!prop) throw new Error(`missing prop "${key}"`);
      return prop.text;
    })
    .replace(/\{\{\s*props\.([\w.]+)\s*\}\}/g, (_, key) => {
      const prop = props[key];
      if (!prop) throw new Error(`missing prop "${key}"`);
      return promoteText(prop);
    })
    .replace(/\{\{\{\s*([\w.]+)\s*\}\}\}/g, (_, path) => String(lookup(path, scope)))
    .replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_, path) => escapeHtml(lookup(path, scope)));
}

/** A raw prop inserted into an escaped slot keeps its markup only if it opts in. */
function promoteText(prop) {
  return prop.raw ? prop.text : escapeHtml(prop.text);
}

/** Render one unit instance: `{ unit, id?, props?, repeat? }`. */
export function renderUnit(unitSpec, catalog, scope) {
  const { unit, id } = unitSpec;
  const template = readUnit(unit, catalog);
  const props = { ...(unitSpec.props ?? {}) };
  if (id !== undefined) props.id = id;
  // A repeated block is one unit rendered N times and spliced into a parent
  // slot, so the parent stays a single readable file instead of a loop in HTML.
  if (unitSpec.repeat) {
    const { unit: childUnit, items = [], as = 'items' } = unitSpec.repeat;
    props[as] = items
      .map(item => renderUnit({ unit: childUnit, props: item }, catalog, scope))
      .join('');
  }
  const resolved = {};
  for (const [key, value] of Object.entries(props)) resolved[key] = resolveProp(value, scope);
  return fillUnit(template, resolved, scope);
}

/** Render a shot's units in order. */
export function renderUnits(units, catalog, scope) {
  return (units ?? []).map(unitSpec => renderUnit(unitSpec, catalog, scope)).join('\n');
}

export function page({ title, styles = [], style = '', body, script = '', size = [1080, 1920] }) {
  const links = styles.map(href => `<link rel="stylesheet" href="${href}">`).join('\n');
  const inlineStyle = style.trim() ? `<style>\n${style.trim()}\n</style>\n` : '';
  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=${size[0]}, height=${size[1]}">
<title>${title}</title>
${links}
${inlineStyle}</head>
<body>
${body}
${script.trim() ? `<script>\n${script.trim()}\n</script>\n` : ''}</body>
</html>
`;
}

/**
 * Styles a shot needs, in use order and without duplicates. A unit owns its
 * declarations next to its markup, so dropping a unit from a shot also drops its
 * CSS — the two cannot drift apart the way a shared stylesheet and a template
 * usually do.
 */
export function collectUnitStyles(units, catalog) {
  const seen = new Set();
  const blocks = [];
  const walk = (list) => {
    for (const spec of list ?? []) {
      const unit = catalog.units[spec.unit];
      if (!unit) throw new Error(`unknown unit "${spec.unit}"`);
      if (unit.css && !seen.has(unit.css)) {
        seen.add(unit.css);
        blocks.push(readFileSync(new URL(unit.css, import.meta.url), 'utf8').trim());
      }
      if (spec.repeat) walk((spec.repeat.items ?? []).map(props => ({ unit: spec.repeat.unit, props })));
    }
  };
  walk(units);
  return blocks.join('\n');
}

/**
 * The shot wall. Generated rather than hand-written so `at` and the per-shot
 * `#t=` range can never drift from the shot's own duration — that drift is
 * silent (the film plays, just out of sync) and was the reason for this file.
 */
export function shotWall({ title, size = [1080, 1920], shots, backdrop = '#1d1b18', sectionTitle }) {
  const frames = shots.map(shot => {
    const wallTitle = `${shot.order ?? ''}${shot.order ? ' · ' : ''}${shot.title}`;
    return `    <iframe id="${shot.id}" title="${escapeHtml(wallTitle)}" src="pages/${shot.id}.html#t=0,${trim(shot.duration)}" at="${fixed(shot.start, 3)}"></iframe>`;
  });
  const landscape = size[0] > size[1];
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=${size[0]}, height=${size[1]}">
  <title>${escapeHtml(title)}</title>
  <style>
    /* 本机直开时显示镜头墙；OpenFilm 读取下方 iframe 的 at 与 #t 时间。 */
    body > #shots { display: grid; grid-template-columns: repeat(auto-fit, minmax(${landscape ? 290 : 170}px, 1fr)); gap: ${landscape ? 14 : 12}px; }
    body:has(> #shots) { margin: ${landscape ? 18 : 16}px; background: ${backdrop}; }
    #shots > iframe { display: block; width: 100%; aspect-ratio: ${landscape ? '16 / 9' : '9 / 16'}; height: auto; border: 0; }
  </style>
</head>
<body>
  <section id="shots" title="${escapeHtml(sectionTitle ?? `${title} · ${shots.length} 组`)}">
${frames.join('\n')}
  </section>
</body>
</html>
`;
}

/** `6` for whole seconds, `5.233` otherwise: matches how the wall was written. */
function trim(value) {
  const rounded = Math.round(value * 1000) / 1000;
  return Number.isInteger(rounded) ? String(rounded) : String(rounded);
}

function fixed(value, digits) {
  return (Math.round(value * 10 ** digits) / 10 ** digits).toFixed(digits);
}

export { kitRoot, escapeHtml };
