#!/usr/bin/env node
// Keep the shell's copy of the login gate identical to ours.
//
// The gate and its city backdrop are still written as DOM code (they mount on
// documentElement, outside React's root, so a re-render cannot wipe them). What
// changes here is only *delivery*: they ship inside the shell bundle instead of
// being injected as <script> tags per page. The canonical files stay in
// assets/ — CI has no upstream checkout, so that is what tests read.
//
// Usage: node scripts/sync-shell-login.mjs [--check]
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const TARGET = join(ROOT, '.upstream', 'openfilm', 'apps', 'desktop', 'shell');

const PAIRS = [
  ['assets/login-city.js', 'login-city.js'],
  ['assets/shell-login.js', 'login-gate.js'],
];

function sync({ check }) {
  if (!existsSync(TARGET)) {
    // Nothing to sync against (CI, or a fresh clone without .upstream).
    console.log('sync-shell-login: no upstream checkout, skipped');
    return 0;
  }
  let stale = 0;
  for (const [from, name] of PAIRS) {
    const source = readFileSync(join(ROOT, from), 'utf8');
    const target = join(TARGET, name);
    const current = existsSync(target) ? readFileSync(target, 'utf8') : null;
    if (current === source) {
      console.log(`sync-shell-login: ${name} is current`);
      continue;
    }
    if (check) {
      console.error(`sync-shell-login: ${name} is stale — run "npm run login:sync"`);
      stale += 1;
      continue;
    }
    writeFileSync(target, source);
    console.log(`sync-shell-login: wrote ${name}`);
  }
  return stale ? 1 : 0;
}

process.exitCode = sync({ check: process.argv.includes('--check') });
