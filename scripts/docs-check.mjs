#!/usr/bin/env node
// Documentation hygiene: no dead relative links, and the agent manual stays
// short enough to be read in one pass.
//
// A doc set rots by accumulating links to files that were deleted "later" and
// numbers that were true two versions ago. The link check is the cheap half of
// that; the size check keeps AGENTS.md from turning back into an archive.
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const AGENTS_LIMIT = 9 * 1024;

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

export function checkDocs({ root = ROOT, agentsLimit = AGENTS_LIMIT } = {}) {
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
  return { problems, warnings };
}

function main() {
  const strict = process.argv.includes('--strict');
  const { problems, warnings } = checkDocs();
  for (const warning of warnings) console.warn(`warning: ${warning}`);
  if (problems.length) {
    console.error(`docs-check: ${problems.length} dead link(s)\n- ${problems.join('\n- ')}`);
    process.exitCode = 1;
    return;
  }
  if (strict && warnings.length) {
    console.error('docs-check: size budget exceeded');
    process.exitCode = 1;
    return;
  }
  console.log(`docs ok${warnings.length ? ` (${warnings.length} warning)` : ''}`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) main();
