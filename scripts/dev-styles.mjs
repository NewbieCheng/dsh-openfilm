#!/usr/bin/env node
// Watch the style sources and say what to do after each save.
//
// The point is not to rebuild anything: theme files are read from disk on the
// next page render. The point is to stop guessing whether a save was noticed.
import { existsSync, statSync, watch } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const THEME = join(ROOT, 'assets', 'theme');
const BRAND = join(ROOT, 'brand', 'brand.json');

function stamp() {
  return new Date().toTimeString().slice(0, 8);
}

let pending = null;
function announce(path) {
  if (pending) clearTimeout(pending);
  pending = setTimeout(() => {
    pending = null;
    const name = path ? String(path).replace(ROOT, '') : 'styles';
    console.log(`${stamp()}  ${name} 已保存 → 刷新面板（F5）或 47821 窗口`);
  }, 120);
}

if (!existsSync(THEME)) {
  console.error(`missing ${THEME}`);
  process.exitCode = 1;
} else {
  console.log('watching assets/theme/*.css and brand/brand.json');
  console.log('refresh the panel after a save; NO996_OPENFILM_THEME=0 disables injection.');
  for (const target of [THEME, BRAND]) {
    if (!existsSync(target)) continue;
    try {
      const stat = statSync(target);
      watch(stat.isDirectory() ? target : target, { persistent: true }, (_event, filename) => {
        announce(filename ? join(target, String(filename)) : target);
      });
    } catch (error) {
      console.error(`watch ${target}: ${error.message}`);
    }
  }
}
