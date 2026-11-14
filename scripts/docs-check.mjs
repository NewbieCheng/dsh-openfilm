#!/usr/bin/env node
// Documentation hygiene for a doc set that has already rotted once.
//
// Two kinds of checks live here:
//   - structural: dead relative links, the agent manual's size budget;
//   - freshness: every doc in docs/ carries a machine-readable header
//     (`reader` / `fact-source` / `checked` / `rot-if`), `checked` tracks
//     package.json, progress words stay out of spec docs, and every
//     `npm run x` mentioned in prose actually exists.
//
// The freshness half is what stops "README 说 0.13.0、package.json 是 0.15.1"
// from happening again. It runs when `strictMeta` is set (the CLI does), so
// small fixture trees in tests keep working without headers.
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const AGENTS_LIMIT = 9 * 1024;

const REQUIRED_FIELDS = ['id', 'reader', 'fact-source', 'checked', 'rot-if'];

/** Words that describe progress; only the status lanes may use them. */
const PROGRESS_PATTERNS = [/源码完成/, /当前批/, /待真机验证/, /已实现 0\./];
const PROGRESS_ALLOWED = new Set(['STATUS.md', 'ROADMAP.md']);

/** Facts that were true two versions ago and are now actively misleading. */
const STALE_PATTERNS = [
  [/77 个插槽/, '插槽数是 116（见 dsh-ui-extension 的生成表）'],
  [/插槽全表（77/, '槽表已迁到 skill 的生成表'],
  [/当前批：0\.9\.1/, '路线图停在 0.9.1'],
  [/admit\(\{ headers/, 'admit 接受 request，不是 { headers }'],
];

export function markdownFiles(root = ROOT) {
  const found = [];
  for (const name of readdirSync(root)) {
    if (extname(name) === '.md') found.push(join(root, name));
  }
  for (const dir of ['docs', join('skills')]) {
    const base = join(root, dir);
    if (!existsSync(base)) continue;
    for (const name of readdirSync(base)) {
      if (extname(name) !== '.md') continue;
      found.push(join(base, name));
    }
    // skills/<name>/SKILL.md
    if (dir === 'skills') {
      for (const name of readdirSync(base)) {
        const nested = join(base, name, 'SKILL.md');
        if (existsSync(nested)) found.push(nested);
      }
    }
  }
  return [...new Set(found)];
}

/** Every markdown file under a directory, recursively. */
function walkMarkdown(dir, out = []) {
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walkMarkdown(full, out);
    else if (extname(name) === '.md') out.push(full);
  }
  return out;
}

/** Remove fenced code so command examples are not mistaken for links. */
export function stripFences(text) {
  return text.replace(/```[\s\S]*?```/g, '');
}

export function linksIn(text) {
  const links = [];
  const pattern = /\[[^\]]*\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g;
  for (const match of stripFences(text).matchAll(pattern)) links.push(match[1]);
  return links;
}

/** Parse the `<!-- doc ... -->` header into a flat map. */
export function docHeader(text) {
  const match = text.match(/^\s*<!--\s*doc\s*\n([\s\S]*?)-->/);
  if (!match) return null;
  const fields = {};
  // Files may be CRLF on Windows; `$` alone would not match before \r.
  for (const line of match[1].split(/\r?\n/)) {
    const pair = line.match(/^\s*([a-z-]+):\s*(.*?)\s*$/);
    if (pair) fields[pair[1]] = pair[2];
  }
  return fields;
}

function packageVersion(root) {
  const file = join(root, 'package.json');
  if (!existsSync(file)) return null;
  try {
    return JSON.parse(readFileSync(file, 'utf8')).version ?? null;
  } catch {
    return null;
  }
}

function packageScripts(root) {
  const file = join(root, 'package.json');
  if (!existsSync(file)) return null;
  try {
    return Object.keys(JSON.parse(readFileSync(file, 'utf8')).scripts ?? {});
  } catch {
    return null;
  }
}

function minorDistance(checked, current) {
  const parse = (value) => String(value).split('.').map((part) => Number.parseInt(part, 10) || 0);
  const [cMajor, cMinor] = parse(checked);
  const [rMajor, rMinor] = parse(current);
  return (rMajor - cMajor) * 12 + (rMinor - cMinor);
}

function checkFreshness(root, { problems, warnings }) {
  const docsDir = join(root, 'docs');
  if (!existsSync(docsDir)) return;
  const version = packageVersion(root);
  const scripts = packageScripts(root);

  for (const file of walkMarkdown(docsDir)) {
    const relative = file.slice(root.length).replace(/\\/g, '/');
    const text = readFileSync(file, 'utf8');
    const header = docHeader(text);
    if (!header) {
      problems.push(`${relative}: missing <!-- doc ... --> header`);
    } else {
      for (const field of REQUIRED_FIELDS) {
        if (!header[field]) problems.push(`${relative}: header field "${field}" is missing`);
      }
      const checked = header.checked ?? '';
      if (version && checked !== 'generated' && /^\d+\.\d+/.test(checked) && checked !== version) {
        const distance = minorDistance(checked, version);
        const line = `${relative}: checked ${checked}, package.json is ${version}`;
        if (distance >= 3) problems.push(`${line} (${distance} minors behind)`);
        else warnings.push(line);
      }
    }

    const base = relative.split('/').pop();
    // ADRs quote past status on purpose — history is the point.
    const isDecision = relative.startsWith('docs/decisions/');
    if (!PROGRESS_ALLOWED.has(base) && !isDecision) {
      const prose = stripFences(text);
      for (const pattern of PROGRESS_PATTERNS) {
        if (pattern.test(prose)) problems.push(`${relative}: progress wording (${pattern.source}) belongs in STATUS.md`);
      }
    }
  }

  if (scripts) {
    const known = new Set(scripts);
    const referenced = [join(root, 'README.md'), join(root, 'AGENTS.md'), ...walkMarkdown(docsDir)];
    for (const file of referenced) {
      if (!existsSync(file)) continue;
      const relative = file.slice(root.length).replace(/\\/g, '/');
      for (const match of readFileSync(file, 'utf8').matchAll(/\bnpm run ([a-z][\w:-]*)/g)) {
        if (!known.has(match[1])) problems.push(`${relative}: mentions missing script "npm run ${match[1]}"`);
      }
    }
  }
}

/**
 * Prose that names a repository file is a claim that the file exists. Prose rots by
 * pointing at things that moved (`src/studio-controller.mjs` line numbers, a renamed
 * module), and nothing else notices: a dead *link* is checked, a dead *code span* is
 * not. Only paths with a known source extension are checked, so examples and prose
 * stay free.
 */
const CODE_PATH = /`((?:src|scripts|tests|assets|brand|patches|vendor|locale|docs)\/(?:[\w.-]+\/)*[\w.-]+\.(?:mjs|js|json|css|md|yml|patch|html))(?::\d+(?:-\d+)?)?`/g;

function checkCodePaths(root, { problems }) {
  const targets = [join(root, 'README.md'), join(root, 'AGENTS.md'), ...walkMarkdown(join(root, 'docs'))];
  for (const file of targets) {
    if (!existsSync(file)) continue;
    const relative = file.slice(root.length).replace(/\\/g, '/');
    const text = stripFences(readFileSync(file, 'utf8'));
    for (const match of text.matchAll(CODE_PATH)) {
      const target = match[1];
      if (target.startsWith('dist/')) continue; // build output, not in git
      if (!existsSync(join(root, target))) problems.push(`${relative}: names missing file ${target}`);
    }
  }
}

function checkStale(root, { problems }) {
  const targets = [join(root, 'README.md'), join(root, 'AGENTS.md'), ...walkMarkdown(join(root, 'docs'))];
  for (const file of targets) {
    if (!existsSync(file)) continue;
    const relative = file.slice(root.length).replace(/\\/g, '/');
    // ADRs quote the stale claims they corrected; that is evidence, not rot.
    if (relative.startsWith('docs/decisions/')) continue;
    const text = stripFences(readFileSync(file, 'utf8'));
    for (const [pattern, why] of STALE_PATTERNS) {
      if (pattern.test(text)) problems.push(`${relative}: stale claim (${pattern.source}) — ${why}`);
    }
  }
}

export function checkDocs({ root = ROOT, agentsLimit = AGENTS_LIMIT, strictMeta = false } = {}) {
  const problems = [];
  const warnings = [];
  for (const file of markdownFiles(root)) {
    const text = readFileSync(file, 'utf8');
    for (const target of linksIn(text)) {
      if (/^(https?:|mailto:|#)/i.test(target)) continue;
      // Site-absolute routes are not files in this repo.
      if (target.startsWith('/')) continue;
      // Markdown allows <...> around a destination; placeholders use <hex>/….
      const inner = target.startsWith('<') && target.endsWith('>') ? target.slice(1, -1) : target;
      if (/[<>…]/.test(inner)) continue;
      // A bare word with no path separator or extension is prose, not a link.
      if (!inner.includes('/') && !inner.includes('.')) continue;
      const clean = decodeURI(inner.split('#')[0].split('?')[0]);
      if (!clean) continue;
      const resolved = resolve(dirname(file), clean);
      if (!existsSync(resolved)) problems.push(`${file.slice(root.length)} -> ${target}`);
    }
  }
  const agents = join(root, 'AGENTS.md');
  if (existsSync(agents)) {
    const bytes = statSync(agents).size;
    if (bytes > agentsLimit) warnings.push(`AGENTS.md is ${(bytes / 1024).toFixed(1)} KB (target <= ${(agentsLimit / 1024).toFixed(0)} KB)`);
  }
  if (strictMeta) {
    checkFreshness(root, { problems, warnings });
    checkStale(root, { problems });
    checkCodePaths(root, { problems });
  }
  return { problems, warnings };
}

function main() {
  const strict = process.argv.includes('--strict');
  const { problems, warnings } = checkDocs({ strictMeta: true });
  for (const warning of warnings) console.warn(`warning: ${warning}`);
  if (problems.length) {
    console.error(`docs-check: ${problems.length} problem(s)\n- ${problems.join('\n- ')}`);
    process.exitCode = 1;
    return;
  }
  if (strict && warnings.length) {
    console.error('docs-check: size or freshness budget exceeded');
    process.exitCode = 1;
    return;
  }
  console.log(`docs ok (${warnings.length} warning)`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) main();
