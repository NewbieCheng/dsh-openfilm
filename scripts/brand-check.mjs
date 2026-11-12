#!/usr/bin/env node
// Guard rails for the brand layer: one file to rename the product, and a check
// that catches the two ways that goes wrong — invalid data, and upstream marks
// leaking into user-visible strings.
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { getBrand } from '../src/brand.mjs';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const THEME = join(ROOT, 'assets', 'theme');
const LOCALES = join(ROOT, 'locale');

export function walkStrings(value, visit, key = '') {
  if (typeof value === 'string') return visit(value, key);
  if (Array.isArray(value)) return value.forEach((item, index) => walkStrings(item, visit, `${key}[${index}]`));
  if (value && typeof value === 'object') {
    return Object.entries(value).forEach(([name, item]) => walkStrings(item, visit, key ? `${key}.${name}` : name));
  }
}

export function checkBrand({ root = ROOT } = {}) {
  const problems = [];
  let brand;
  try {
    brand = getBrand();
  } catch (error) {
    return [`brand/brand.json: ${error.message}`];
  }
  for (const field of ['name', 'nameEn', 'slug', 'vendor', 'tagline']) {
    if (!brand[field]) problems.push(`brand.${field} is empty`);
  }
  for (const field of ['name', 'version', 'license', 'notice']) {
    if (!brand.upstream?.[field]) problems.push(`brand.upstream.${field} is missing (attribution cannot be dropped)`);
  }
  for (const file of ['tokens.css', 'shell.css', 'studio.css']) {
    const path = join(root, 'assets', 'theme', file);
    if (!existsSync(path)) problems.push(`missing assets/theme/${file}`);
    else if (!readFileSync(path, 'utf8').includes('--n996-')) problems.push(`assets/theme/${file} does not use --n996-* tokens`);
  }
  const locales = join(root, 'locale');
  if (existsSync(locales)) {
    for (const file of readdirSync(locales).filter((name) => name.endsWith('.json'))) {
      let data;
      try {
        data = JSON.parse(readFileSync(join(locales, file), 'utf8'));
      } catch {
        problems.push(`locale/${file} is not valid JSON`);
        continue;
      }
      walkStrings(data, (value, key) => {
        // Attribution belongs in README/NOTICE, not in a button or a title.
        if (/openfilm/i.test(value)) problems.push(`locale/${file}:${key} mentions the upstream product`);
      });
    }
  }
  return problems;
}

function main() {
  const problems = checkBrand();
  if (problems.length) {
    console.error(`brand-check: ${problems.length} problem(s)\n- ${problems.join('\n- ')}`);
    process.exitCode = 1;
    return;
  }
  const brand = getBrand();
  console.log(`brand ok: ${brand.name} / ${brand.nameEn} (${brand.slug})`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) main();
