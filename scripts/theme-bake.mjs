#!/usr/bin/env node
// Bake the theme into the vendored shell instead of injecting it at runtime.
//
// Development injects the same CSS (src/theme.mjs) so iteration is save+refresh.
// A release must not depend on that: the shipped artifact gets one extra
// stylesheet and one <link>, recorded in the manifest like every other file.
// This step is idempotent and does not need the upstream checkout.
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { brandCssVars, getBrand } from '../src/brand.mjs';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const SHELL = join(ROOT, 'vendor', 'official-shell');
const THEME = join(ROOT, 'assets', 'theme');
const LINK = '<link rel="stylesheet" data-no996-baked href="/assets/no996-theme.css">';
const FILE = 'ui/assets/no996-theme.css';
const MARK = 'data-no996-baked';

const sha = (value) => createHash('sha256').update(value).digest('hex');

export function composeThemeCss({ themeDir = THEME, brand = getBrand } = {}) {
  let css = brandCssVars(brand());
  for (const name of ['tokens.css', 'shell.css']) css += readFileSync(join(themeDir, name), 'utf8');
  return css;
}

export function bake({ shellRoot = SHELL, themeDir = THEME, brand = getBrand } = {}) {
  const index = join(shellRoot, 'ui', 'index.html');
  const manifestPath = join(shellRoot, 'manifest.json');
  const html = readFileSync(index, 'utf8');
  const css = composeThemeCss({ themeDir, brand });
  if (/<\/style/i.test(css)) throw new Error('theme CSS contains </style>; refusing to bake');

  // Insert once, immediately after the first upstream stylesheet so our rules
  // keep the cascade order they have in development.
  const next = html.includes(MARK)
    ? html
    : html.replace(/(<link[^>]*rel="stylesheet"[^>]*>)/i, (match) => match + LINK);
  if (!next.includes(MARK)) throw new Error('no stylesheet link found in ui/index.html');
  writeFileSync(index, next);
  writeFileSync(join(shellRoot, ...FILE.split('/')), css);

  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  manifest.files = { ...(manifest.files ?? {}) };
  manifest.files['ui/index.html'] = sha(next);
  manifest.files[FILE] = sha(css);
  manifest.overrides = {
    ...(manifest.overrides ?? {}),
    theme: {
      file: FILE,
      sha256: sha(css),
      sources: ['assets/theme/tokens.css', 'assets/theme/shell.css', 'brand/brand.json'],
      note: 'Baked from this repository; the rest of ui/ is the pinned upstream build.',
    },
  };
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  return { index, cssFile: join(shellRoot, ...FILE.split('/')), manifest };
}

function main() {
  const check = process.argv.includes('--check');
  if (check) {
    const manifest = JSON.parse(readFileSync(join(SHELL, 'manifest.json'), 'utf8'));
    const css = composeThemeCss();
    const index = readFileSync(join(SHELL, 'ui', 'index.html'), 'utf8');
    const problems = [];
    if (!index.includes(MARK)) problems.push('ui/index.html has no baked theme link');
    if (manifest.files?.[FILE] !== sha(css)) problems.push('ui/assets/no996-theme.css is stale');
    if (problems.length) {
      console.error(`theme-bake: ${problems.join('; ')}`);
      process.exitCode = 1;
      return;
    }
    console.log('baked theme is current.');
    return;
  }
  const { cssFile } = bake();
  console.log(`baked ${cssFile}`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  try { main(); } catch (error) { console.error(`theme-bake: ${error.message}`); process.exitCode = 1; }
}
