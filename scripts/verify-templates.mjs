#!/usr/bin/env node
// What this proves without a browser: the three shipped templates enumerate,
// each installs into a fresh folder with its film.html intact, the fixed debug
// port answers with its redirect, and the fallback page is actually registered.
//
// Run after the plugin is loaded: pnpm node scripts/verify-templates.mjs
import { listTemplates, installTemplate } from '../src/official-templates.mjs';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', 'vendor', 'templates');
const port = Number(process.env.NO996_OPENFILM_DEBUG_PORT || 47821);
const dshOrigin = process.env.NO996_DSH_ORIGIN || 'http://127.0.0.1:64064';
const results = [];
const check = (name, value) => results.push([value ? 'PASS' : 'FAIL', name]);

const templates = await listTemplates(root);
check('3 个模板可枚举', templates.length === 3);
check('全部为影片模式且入口 film.html', templates.every(t => t.mode === 'film' && t.entry === 'film.html'));
check('每个模板都有 prompt', templates.every(t => t.prompt.length > 10));

const parent = mkdtempSync(join(tmpdir(), 'of-verify-'));
try {
  for (const template of templates) {
    const installed = await installTemplate({
      root, id: template.id, parentDir: parent,
      createProject: async path => ({ id: `p${template.id.replace(/-/g, '')}`, path }),
      titleFor: () => template.title,
    });
    const kept = readFileSync(join(installed.path, 'film.html'), 'utf8').includes('shot-01');
    check(`安装 ${template.id}（${installed.files} 文件，film.html 保留）`, kept && installed.files > 1);
  }
} finally { rmSync(parent, { recursive: true, force: true }); }

try {
  const redirect = await fetch(`http://127.0.0.1:${port}/`, { redirect: 'manual' });
  check(`${port} 返回 302 到 standalone`, redirect.status === 302 && String(redirect.headers.get('location')).endsWith('/no996-openfilm/standalone'));
} catch { check(`${port} 返回 302 到 standalone`, false); }

try {
  const page = await fetch(`${dshOrigin}/no996-openfilm/templates`, { redirect: 'manual' });
  check('模板兜底页已注册（401 而非 404）', page.status === 401);
} catch { check('模板兜底页已注册（401 而非 404）', false); }

for (const [status, name] of results) console.log(status.padEnd(5), name);
const failed = results.filter(([status]) => status === 'FAIL').length;
console.log(failed ? `${failed} 项失败` : '全部通过');
process.exit(failed ? 1 : 0);
