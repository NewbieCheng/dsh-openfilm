#!/usr/bin/env node
/**
 * Zero-dependency lint for dsh-openfilm.
 *
 * Why not eslint: this repository deliberately ships two runtime dependencies
 * and one dev dependency. What actually breaks here is not formatting taste —
 * it is a syntax error in a module no test imports, a merge marker left in a
 * file, a CJS `require` that nobody declared, or a secret pasted into a
 * fixture. Those checks need a file walker and `node --check`, not a plugin
 * ecosystem.
 *
 * Usage:
 *   node scripts/lint.mjs            # errors fail, warnings print
 *   node scripts/lint.mjs --strict   # warnings fail too (CI)
 */
import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { dirname, extname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)))
const STRICT = process.argv.includes('--strict')

const SKIP_DIRS = new Set(['node_modules', 'vendor', 'dist', '.git', '.upstream', '.dev', '.asr-home', '.npm-cache', '.codegraph', '.tmp-chrome', '.tmp-frames'])
const CODE_DIRS = ['src', 'scripts', 'tests']
const CODE_ROOTS = ['index.js']
/** Generated artifact: syntax-checking a bundle only checks the bundler. */
const GENERATED = new Set(['client.js'])

const errors = []
const warnings = []

function rel(file) {
  return relative(ROOT, file).replace(/\\/g, '/')
}

function walk(dir, out = []) {
  if (!existsSync(dir)) return out
  for (const name of readdirSync(dir)) {
    if (name.startsWith('.') && name !== '.github') continue
    const full = join(dir, name)
    const stat = statSync(full)
    if (stat.isDirectory()) {
      if (SKIP_DIRS.has(name)) continue
      walk(full, out)
    } else {
      out.push(full)
    }
  }
  return out
}

function codeFiles() {
  const files = []
  for (const dir of CODE_DIRS) files.push(...walk(join(ROOT, dir)))
  for (const name of CODE_ROOTS) {
    const full = join(ROOT, name)
    if (existsSync(full)) files.push(full)
  }
  return files
    .filter((file) => ['.js', '.mjs'].includes(extname(file)))
    .filter((file) => !GENERATED.has(rel(file)))
    .sort()
}

/** Strip `//` line comments so prose that mentions an API does not trip a rule. */
function stripLineComment(line) {
  const index = line.indexOf('//')
  if (index === -1) return line
  const before = line.slice(0, index)
  // Keep the part before a trailing URL scheme (http://...) intact enough for our rules.
  return before
}

// --- R1: every file must parse ------------------------------------------------
function checkSyntax(files) {
  for (const file of files) {
    const result = spawnSync(process.execPath, ['--check', file], { stdio: 'ignore' })
    if (result.status !== 0) errors.push(`${rel(file)}: does not parse (node --check)`)
  }
}

// --- R2: no merge markers -----------------------------------------------------
const MARKERS = [/^<<<<<<< /m, /^>>>>>>> /m]
function checkMergeMarkers(files) {
  const targets = files
  for (const file of targets) {
    const text = readFileSync(file, 'utf8')
    for (const marker of MARKERS) {
      if (marker.test(text)) errors.push(`${rel(file)}: merge marker left in file`)
    }
  }
  for (const name of ['package.json', 'README.md', 'CHANGELOG.md']) {
    const full = join(ROOT, name)
    if (!existsSync(full)) continue
    const text = readFileSync(full, 'utf8')
    for (const marker of MARKERS) {
      if (marker.test(text)) errors.push(`${name}: merge marker left in file`)
    }
  }
}

// --- R3: ESM files may only use require() when they declared createRequire ----
function checkRequire(files) {
  for (const file of files) {
    if (extname(file) !== '.mjs') continue
    const text = readFileSync(file, 'utf8')
    if (!/\brequire\(/.test(text)) continue
    if (/\bcreateRequire\(/.test(text)) continue
    // Only prose mentioning require() may be left once comments are stripped.
    const line = text.split('\n').findIndex((raw) => /\brequire\(/.test(stripLineComment(raw)))
    if (line === -1) continue
    errors.push(`${rel(file)}:${line + 1}: require() without createRequire()`)
  }
}

// --- R4: no console statements in host code (logging goes through plugin-log) -
function checkConsole(files) {
  for (const file of files) {
    const relPath = rel(file)
    if (!relPath.startsWith('src/') && relPath !== 'index.js') continue
    const lines = readFileSync(file, 'utf8').split('\n')
    lines.forEach((raw, index) => {
      if (/^\s*console\.(log|error|warn|info|debug)\(/.test(raw)) {
        errors.push(`${relPath}:${index + 1}: console statement (use plugin-log)`)
      }
    })
  }
}

// --- R5: no credentials in the working tree -----------------------------------
const SECRETS = [
  { name: 'openai-style key', re: /sk-[A-Za-z0-9]{20,}/ },
  { name: 'aws access key', re: /AKIA[0-9A-Z]{16}/ },
  { name: 'private key block', re: /-----BEGIN (?:RSA |OPENSSH |EC )?PRIVATE KEY-----/ },
  { name: 'github token', re: /gh[pousr]_[A-Za-z0-9]{30,}/ },
]
function checkSecrets(files) {
  const scan = [...files, join(ROOT, 'package.json'), join(ROOT, 'cordis.patch.yml')].filter((file) => existsSync(file))
  for (const file of scan) {
    const text = readFileSync(file, 'utf8')
    for (const secret of SECRETS) {
      if (secret.re.test(text)) errors.push(`${rel(file)}: looks like a committed ${secret.name}`)
    }
  }
}

// --- R6: package manifest stays loadable by DSH -------------------------------
function checkManifest() {
  const file = join(ROOT, 'package.json')
  const pkg = JSON.parse(readFileSync(file, 'utf8'))
  if (pkg.type !== 'module') errors.push('package.json: "type" must be "module"')
  if (!/^\d+\.\d+\.\d+/.test(pkg.version ?? '')) errors.push('package.json: version is not semver')
  if (!pkg.engines?.node) errors.push('package.json: engines.node is required')
  const patch = pkg.dsh?.bundle?.patch
  if (typeof patch !== 'string') errors.push('package.json: dsh.bundle.patch is required')
  else if (!existsSync(join(ROOT, patch))) errors.push(`package.json: dsh.bundle.patch points at missing ${patch}`)
  const files = pkg.files ?? []
  for (const required of ['index.js', 'client.js', 'cordis.patch.yml']) {
    if (!files.includes(required)) errors.push(`package.json: files[] is missing ${required}`)
  }
  if (!pkg.dsh?.client?.platform) errors.push('package.json: dsh.client.platform is required')
}

// --- R7: report oversized modules (a refactor target, never a failure) --------
const SIZE_INFO = 600
function reportSizes(files) {
  const sizes = files
    .filter((file) => rel(file).startsWith('src/'))
    .map((file) => ({ file: rel(file), lines: readFileSync(file, 'utf8').split('\n').length }))
    .sort((a, b) => b.lines - a.lines)
  return sizes
}

const files = codeFiles()
checkSyntax(files)
checkMergeMarkers(files)
checkRequire(files)
checkConsole(files)
checkSecrets(files)
checkManifest()
const sizes = reportSizes(files)

const totalLines = sizes.reduce((sum, entry) => sum + entry.lines, 0)
for (const entry of sizes) {
  if (entry.lines > SIZE_INFO) process.stdout.write(`info  ${entry.file}: ${entry.lines} lines (split target >${SIZE_INFO})\n`)
}
for (const warning of warnings) process.stdout.write(`warn  ${warning}\n`)
for (const error of errors) process.stdout.write(`error ${error}\n`)
process.stdout.write(
  `lint: ${files.length} files (${sizes.length} in src, ${totalLines} lines), ` +
    `${errors.length} error(s), ${warnings.length} warning(s)${STRICT ? ' [strict]' : ''}\n`,
)

if (errors.length > 0 || (STRICT && warnings.length > 0)) process.exit(1)
