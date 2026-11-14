#!/usr/bin/env node
/**
 * Keep the one place that states "what version is this" honest.
 *
 * The README once said 0.13.0 while package.json said 0.15.1, and the roadmap
 * said 0.9.1. Instead of trusting discipline, check the claims that are cheap
 * to check: STATUS names the current version, it names a published version,
 * and no other doc claims a different "当前 x.y.z".
 */
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)))
const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'))
const version = pkg.version
const problems = []

const statusFile = join(ROOT, 'docs', 'STATUS.md')
if (!existsSync(statusFile)) {
  problems.push('docs/STATUS.md is missing')
} else {
  const text = readFileSync(statusFile, 'utf8')
  if (!text.includes(`**${version}**`)) {
    problems.push(`docs/STATUS.md does not state the current version ${version} in bold`)
  }
  if (!/\|\s*最近发布包\s*\|/.test(text)) {
    problems.push('docs/STATUS.md is missing the "最近发布包" row')
  }
}

// The lockfile's own version fields rot exactly like the README once did: it sat at
// 0.13.4 while the package was 0.15.1. `npm ci` tolerates that, so nothing fails —
// which is why it has to be checked rather than noticed.
const lockFile = join(ROOT, 'package-lock.json')
if (existsSync(lockFile)) {
  try {
    const lock = JSON.parse(readFileSync(lockFile, 'utf8'))
    if (lock.version !== version) problems.push(`package-lock.json says ${lock.version}, package.json is ${version}`)
    if (lock.packages?.['']?.version !== version) problems.push('package-lock.json root package version is stale')
  } catch {
    problems.push('package-lock.json is not valid JSON')
  }
}

/** Any doc claiming to be "当前 <version>" must agree with package.json. */
const CLAIM = /当前\s*`?v?(\d+\.\d+\.\d+)`?/g
const targets = [
  join(ROOT, 'README.md'),
  join(ROOT, 'docs', 'STATUS.md'),
  join(ROOT, 'docs', 'DEVELOPMENT.md'),
  join(ROOT, 'AGENTS.md'),
]
for (const file of targets) {
  if (!existsSync(file)) continue
  const text = readFileSync(file, 'utf8')
  for (const match of text.matchAll(CLAIM)) {
    if (match[1] !== version) {
      problems.push(`${relative(ROOT, file)} claims 当前 ${match[1]}, package.json is ${version}`)
    }
  }
}

for (const problem of problems) process.stdout.write(`status-check: ${problem}\n`)
if (problems.length) process.exit(1)
process.stdout.write(`status ok (${version})\n`)
