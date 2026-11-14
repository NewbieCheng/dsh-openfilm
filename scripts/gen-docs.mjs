#!/usr/bin/env node
/**
 * Generate the reference pages that must never be typed by hand.
 *
 * Three lists rot fastest in a repo this shape, and all three are derivable
 * from the tree:
 *   - HTTP routes          (every `path: '/api/...'` registration)
 *   - environment variables (every `process.env.X` read)
 *   - module inventory      (files, size, exports, whether a test exists)
 *
 * Usage:
 *   node scripts/gen-docs.mjs            # write docs/reference/*.md
 *   node scripts/gen-docs.mjs --check    # fail if the committed copies are stale
 */
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)))
const CHECK = process.argv.includes('--check')

function rel(file) {
  return relative(ROOT, file).replace(/\\/g, '/')
}

function lineAt(text, index) {
  return text.slice(0, index).split('\n').length
}

function sourceFiles() {
  const dir = join(ROOT, 'src')
  const files = readdirSync(dir)
    .filter((name) => /\.(mjs|js)$/.test(name))
    .map((name) => join(dir, name))
  const entry = join(ROOT, 'index.js')
  if (existsSync(entry)) files.push(entry)
  return files.sort()
}

const HEADER = (id, reader, source, rotIf) => `<!-- doc
id: ${id}
reader: ${reader}
fact-source: ${source}
checked: generated
rot-if: ${rotIf}
-->

`

// --- routes -------------------------------------------------------------------
export function collectRoutes() {
  const routes = []
  for (const file of sourceFiles()) {
    const text = readFileSync(file, 'utf8')
    for (const match of text.matchAll(/path:\s*'(\/api\/[^']+)'/g)) {
      const before = text.slice(Math.max(0, match.index - 600), match.index)
      const kind = before.match(/kind:\s*'(exact|prefix)'/)
      const after = text.slice(match.index, match.index + 3000)
      const methods = new Set()
      for (const m of after.matchAll(/\.method\s*(?:===|!==)\s*'([A-Z]+)'/g)) methods.add(m[1])
      for (const m of after.matchAll(/allow:\s*'([A-Z, ]+)'/g)) {
        for (const part of m[1].split(',')) if (part.trim()) methods.add(part.trim())
      }
      routes.push({
        path: match[1],
        kind: kind ? kind[1] : 'exact',
        methods: [...methods].sort(),
        file: rel(file),
        line: lineAt(text, match.index),
      })
    }
  }
  const seen = new Map()
  for (const route of routes) {
    const key = `${route.kind} ${route.path}`
    if (!seen.has(key)) seen.set(key, route)
  }
  return [...seen.values()].sort((a, b) => a.path.localeCompare(b.path))
}

export function renderRoutes() {
  const routes = collectRoutes()
  const groups = new Map()
  for (const route of routes) {
    const prefix = route.path.split('/')[2] ?? 'other'
    if (!groups.has(prefix)) groups.set(prefix, [])
    groups.get(prefix).push(route)
  }
  const lines = [
    HEADER(
      'reference-api-routes',
      '写/审路由的人',
      'src/*.mjs、index.js 里的 path 注册（scripts/gen-docs.mjs 生成）',
      '新增或删除任何 /api 路由（重新生成即可）',
    ).trimEnd(),
    '',
    '# HTTP 路由（自动生成）',
    '',
    `> 生成命令：\`npm run docs:gen\`。共 **${routes.length}** 条。**不要手改**——改了也会被 \`--check\` 判为过期。`,
    '> 方法列来自 handler 里的 \`request.method\` 判断，可能不完整；镜像路由（如代理）不在此表。',
    '',
  ]
  for (const [prefix, list] of [...groups].sort()) {
    lines.push(`## /api/${prefix}/`, '', '| 方法 | 路径 | 类型 | 处理位置 |', '|---|---|---|---|')
    for (const route of list) {
      lines.push(`| ${route.methods.length ? route.methods.join('/') : '—'} | \`${route.path}\` | ${route.kind} | \`${route.file}:${route.line}\` |`)
    }
    lines.push('')
  }
  return `${lines.join('\n')}\n`
}

// --- env vars -----------------------------------------------------------------
export function collectEnv() {
  const usage = new Map()
  for (const file of sourceFiles()) {
    const text = readFileSync(file, 'utf8')
    for (const match of text.matchAll(/process\.env\.([A-Z][A-Z0-9_]*)/g)) {
      const name = match[1]
      if (!usage.has(name)) usage.set(name, { files: new Set(), count: 0 })
      const entry = usage.get(name)
      entry.count += 1
      entry.files.add(rel(file))
    }
  }
  return [...usage.entries()]
    .map(([name, entry]) => ({ name, count: entry.count, files: [...entry.files].sort() }))
    .sort((a, b) => a.name.localeCompare(b.name))
}

export function renderEnv() {
  const vars = collectEnv()
  const lines = [
    HEADER(
      'reference-env-vars',
      '部署者、排查问题的人',
      'src/*.mjs、index.js 里的 process.env 读取（scripts/gen-docs.mjs 生成）',
      '新增/删除环境变量（重新生成即可）',
    ).trimEnd(),
    '',
    '# 环境变量（自动生成）',
    '',
    `> 生成命令：\`npm run docs:gen\`。共 **${vars.length}** 个。表格只列"代码读了什么"，用途以 AGENTS.md §6 与各模块注释为准。`,
    '',
    '| 变量 | 读取次数 | 位置 |',
    '|---|---|---|',
  ]
  for (const entry of vars) {
    lines.push(`| \`${entry.name}\` | ${entry.count} | ${entry.files.map((f) => `\`${f}\``).join('、')} |`)
  }
  lines.push('')
  return `${lines.join('\n')}\n`
}

// --- modules ------------------------------------------------------------------
function exportsOf(text) {
  const names = new Set()
  for (const match of text.matchAll(/export\s+(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/g)) names.add(match[1])
  for (const match of text.matchAll(/export\s+(?:const|let|class)\s+([A-Za-z_$][\w$]*)/g)) names.add(match[1])
  for (const match of text.matchAll(/export\s*\{([^}]+)\}/g)) {
    for (const part of match[1].split(',')) {
      const name = part.trim().split(/\s+as\s+/).pop()
      if (name) names.add(name.trim())
    }
  }
  return [...names].sort()
}

function testFiles() {
  const dir = join(ROOT, 'tests')
  return existsSync(dir) ? readdirSync(dir).filter((name) => name.endsWith('.test.mjs')) : []
}

export function collectModules() {
  const tests = testFiles()
  return sourceFiles()
    .map((file) => {
      const text = readFileSync(file, 'utf8')
      const base = rel(file).replace(/^src\//, '').replace(/\.(mjs|js)$/, '')
      const reasons = []
      const byName = tests.filter((name) => name.includes(base))
      if (byName.length) reasons.push(...byName)
      if (base === 'index') {
        const entry = tests.filter((name) => name.includes('entry') || name.includes('plugin'))
        reasons.push(...entry)
      }
      return {
        file: rel(file),
        lines: text.split('\n').length - 1,
        exports: exportsOf(text),
        tests: [...new Set(reasons)],
      }
    })
    .sort((a, b) => b.lines - a.lines)
}

export function renderModules() {
  const modules = collectModules()
  const total = modules.reduce((sum, m) => sum + m.lines, 0)
  const untested = modules.filter((m) => m.tests.length === 0)
  const lines = [
    HEADER(
      'reference-modules',
      '接手代码的人、reviewer',
      'src/*.mjs、index.js 的文件与 export 扫描（scripts/gen-docs.mjs 生成）',
      '新增/删除模块或测试（重新生成即可）',
    ).trimEnd(),
    '',
    '# 模块清单（自动生成）',
    '',
    `> 生成命令：\`npm run docs:gen\`。${modules.length} 个模块、${total} 行。`,
    `> **无同名测试**的模块：${untested.length} 个 —— 这是待补清单，不是失败项。`,
    '> "同名测试"按 `tests/*<模块名>*.test.mjs` 匹配，只说明"有测试提到它"，不保证覆盖。',
    '',
    '| 模块 | 行数 | 导出 | 同名测试 |',
    '|---|---|---|---|',
  ]
  for (const module of modules) {
    const exports = module.exports.length ? module.exports.slice(0, 6).join(', ') + (module.exports.length > 6 ? '…' : '') : '—'
    lines.push(`| \`${module.file}\` | ${module.lines} | ${exports} | ${module.tests.length ? module.tests.map((t) => `\`${t}\``).join('、') : '**无**'} |`)
  }
  lines.push('', '## 无同名测试', '')
  for (const module of untested) lines.push(`- \`${module.file}\`（${module.lines} 行）`)
  lines.push('')
  return `${lines.join('\n')}\n`
}

// --- run ----------------------------------------------------------------------
const targets = [
  ['docs/reference/api-routes.md', renderRoutes],
  ['docs/reference/env-vars.md', renderEnv],
  ['docs/reference/modules.md', renderModules],
]

function main() {
let stale = 0
for (const [target, render] of targets) {
  const full = join(ROOT, target)
  const next = render()
  const current = existsSync(full) ? readFileSync(full, 'utf8') : null
  if (CHECK) {
    if (current !== next) {
      process.stdout.write(`stale  ${target}\n`)
      stale += 1
    }
    continue
  }
  if (current === next) {
    process.stdout.write(`same   ${target}\n`)
    continue
  }
  writeFileSync(full, next)
  process.stdout.write(`wrote  ${target}\n`)
}

if (CHECK) {
  if (stale) {
    process.stdout.write(`gen-docs: ${stale} file(s) out of date — run npm run docs:gen\n`)
    process.exit(1)
  }
  process.stdout.write('generated docs are current\n')
}
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) main()
