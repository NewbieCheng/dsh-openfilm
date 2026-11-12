#!/usr/bin/env node
// Split the vendored upstream diff into one patch per file.
//
// Why per file: on an upstream bump the only question that matters is "which
// file conflicts". A single 80 KB blob answers it with a line number in a file
// nobody can map back to a feature. One patch per source file keeps replay,
// review and conflict reporting honest without pretending we know the feature
// boundary better than the diff does.
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const DIFF = join(ROOT, 'vendor', 'official-shell', 'patch.diff');
// Our edits are source, not part of the upstream snapshot: keep them outside
// vendor/official-shell so regenerating the snapshot cannot delete them.
const OUT = join(ROOT, 'patches');
const MANIFEST = join(ROOT, 'vendor', 'official-shell', 'manifest.json');

const hash = (value) => createHash('sha256').update(value).digest('hex');

/** Coarse tags only. A wrong feature label is worse than an honest file name. */
export function groupOf(source) {
  if (source.includes('/i18n/locales/')) return 'i18n';
  if (source.startsWith('packages/shared/')) return 'shared';
  if (/(agent-menu-rows\.ts|ModelPopover\.tsx)$/.test(source)) return 'menus';
  if (/(OnboardingGate\.tsx|ProjectStarters\.tsx)$/.test(source)) return 'onboarding';
  return 'chat';
}

/** Parse a unified diff into per-file chunks, preserving bytes. */
export function splitDiff(text) {
  const chunks = text.replace(/\r\n/g, '\n').split(/^(?=diff --git )/m).filter((chunk) => chunk.trim());
  return chunks.map((chunk) => {
    const match = /^diff --git a\/(\S+) b\/(\S+)\n/.exec(chunk);
    if (!match) throw new Error('diff chunk without a file header');
    if (match[1] !== match[2]) throw new Error(`rename diffs are not supported: ${match[1]} -> ${match[2]}`);
    return { source: match[1], body: chunk };
  });
}

function idFor(index, source) {
  const name = basename(source).replace(/[^A-Za-z0-9._-]/g, '-');
  return `${String((index + 1) * 10).padStart(3, '0')}-${name.replace(/\.(tsx?|jsx?|mjs)$/, '')}`;
}

export function plan(text, { commit = '', version = '' } = {}) {
  const chunks = splitDiff(text);
  const patches = chunks.map((chunk, index) => {
    const id = idFor(index, chunk.source);
    return {
      id,
      file: `${id}.patch`,
      source: chunk.source,
      group: groupOf(chunk.source),
      sha256: hash(chunk.body),
      bytes: Buffer.byteLength(chunk.body),
    };
  });
  return {
    upstream: { commit, version },
    generatedFrom: { file: 'patch.diff', sha256: hash(text.replace(/\r\n/g, '\n')) },
    patches,
  };
}

export function write(planValue, chunks, { check = false } = {}) {
  const series = `${JSON.stringify(planValue, null, 2)}\n`;
  const byId = new Map(planValue.patches.map((patch) => [patch.id, patch]));
  const expected = new Map();
  for (const chunk of chunks) {
    const patch = planValue.patches.find((item) => item.source === chunk.source);
    if (!patch) throw new Error(`no series entry for ${chunk.source}`);
    expected.set(patch.file, chunk.body);
  }
  const problems = [];
  if (check) {
    for (const [file, body] of expected) {
      const path = join(OUT, file);
      if (!existsSync(path)) problems.push(`missing ${file}`);
      else if (readFileSync(path, 'utf8') !== body) problems.push(`stale ${file}`);
    }
    const seriesPath = join(OUT, 'series.json');
    if (!existsSync(seriesPath)) problems.push('missing series.json');
    else if (readFileSync(seriesPath, 'utf8') !== series) problems.push('stale series.json');
    return problems;
  }
  mkdirSync(OUT, { recursive: true });
  for (const [file, body] of expected) writeFileSync(join(OUT, file), body);
  writeFileSync(join(OUT, 'series.json'), series);
  return problems;
}

function main() {
  const check = process.argv.includes('--check');
  const text = readFileSync(DIFF, 'utf8');
  const manifest = JSON.parse(readFileSync(MANIFEST, 'utf8'));
  const value = plan(text, {
    commit: manifest?.upstream?.commit ?? '',
    version: manifest?.version ?? '',
  });
  const expectedSources = new Set(manifest?.patch?.files ?? []);
  const planned = new Set(value.patches.map((patch) => patch.source));
  const missing = [...expectedSources].filter((source) => !planned.has(source));
  const extra = [...planned].filter((source) => !expectedSources.has(source));
  if (missing.length || extra.length) {
    const detail = `series does not match manifest.patch.files (missing: ${missing.join(', ') || '-'}; extra: ${extra.join(', ') || '-'})`;
    // --force is for an in-flight snapshot: write what the diff actually says
    // and let patches:check keep reporting the mismatch until it is fixed.
    if (!process.argv.includes('--force')) throw new Error(detail);
    console.warn(`split-patch: ${detail} (forced)`);
  }
  const problems = write(value, splitDiff(text), { check });
  if (check) {
    if (problems.length) {
      console.error(`patch series is stale:\n- ${problems.join('\n- ')}`);
      process.exitCode = 1;
      return;
    }
    console.log(`patch series is current (${value.patches.length} files).`);
    return;
  }
  console.log(`wrote ${value.patches.length} patches to ${OUT}`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  try { main(); } catch (error) { console.error(`split-patch: ${error.message}`); process.exitCode = 1; }
}
