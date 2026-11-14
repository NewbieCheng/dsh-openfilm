#!/usr/bin/env node
// Package a previously built, pinned upstream desktop shell. This does not build it.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { lstatSync, mkdirSync, readFileSync, readdirSync, realpathSync, writeFileSync } from 'node:fs';
import { dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const COMMIT = '758b1a3888819bf191db191f690c4ca2fcb292af';
const VERSION = '0.3.2';
const packageRoot = fileURLToPath(new URL('../', import.meta.url));
const destination = join(packageRoot, 'vendor', 'official-shell');
const usage = 'Usage: node packages/dsh-openfilm/scripts/build-official-shell.mjs <openfilm-checkout>';

function fail(message) { throw new Error(message); }
function git(checkout, ...args) {
  return execFileSync('git', ['-C', checkout, ...args], { maxBuffer: 64 * 1024 * 1024, windowsHide: true });
}
function regularDirectory(path) {
  const stat = lstatSync(path);
  if (!stat.isDirectory() || stat.isSymbolicLink()) fail(`Expected a real directory: ${path}`);
}
function hash(content) { return createHash('sha256').update(content).digest('hex'); }

function main() {
  if (process.argv.length !== 3 || process.argv[2].startsWith('-')) fail(usage);
  const checkout = realpathSync(resolve(process.argv[2]));
  const root = realpathSync(git(checkout, 'rev-parse', '--show-toplevel').toString('utf8').trim());
  if (root !== checkout) fail('The argument must be the checkout root, not a subdirectory.');
  const head = git(checkout, 'rev-parse', 'HEAD').toString('utf8').trim();
  if (head !== COMMIT) fail(`Expected upstream HEAD ${COMMIT}, got ${head}`);
  // A matching HEAD alone does not identify the working-tree inputs used for a build.
  // dsh-openfilm keeps exactly two upstream edits: the composer menu renders the
  // permission row the Host offers (agent-menu-rows.ts), and its choices open in
  // place (ModelPopover.tsx) instead of in a panel beside it.
  // Any other tracked change is still refused, and the diff is recorded into the
  // snapshot as patch.diff so the fork stays reviewable and re-appliable.
  const PATCHED = [
    'apps/desktop/chat/src/lib/agent-menu-rows.ts',
    'apps/desktop/chat/src/components/ModelPopover.tsx',
    'apps/desktop/chat/src/components/ConversationSessionBar.tsx',
    'apps/desktop/chat/src/components/OnboardingGate.tsx',
    'apps/desktop/chat/src/components/ProjectStarters.tsx',
    'packages/openfilm/studio/ui/src/components/WorkbenchAccount.tsx',
    'packages/openfilm/studio/ui/src/components/ProjectView.tsx',
    'apps/desktop/chat/src/App.tsx',
    'apps/desktop/chat/src/lib/chat-store.ts',
    'apps/desktop/chat/src/state/local-agent-store.ts',
    'apps/desktop/chat/src/lib/agent-transcript.ts',
    'apps/desktop/chat/src/lib/local-agent-run.ts',
    'apps/desktop/chat/src/components/AgentActivityRow.tsx',
    'packages/shared/src/contract.ts',
  'packages/shared/src/markdown-blocks.ts',
    'apps/desktop/chat/src/components/Markdown.tsx',
    'apps/desktop/chat/src/i18n/locales/en-US.ts',
    'apps/desktop/chat/src/i18n/locales/es.ts',
    'apps/desktop/chat/src/i18n/locales/ja.ts',
    'apps/desktop/chat/src/i18n/locales/ko.ts',
    'apps/desktop/chat/src/i18n/locales/zh-CN.ts',
    'apps/desktop/shell/main.tsx',
    'apps/desktop/shell/RecoveryGate.tsx',
    'apps/desktop/shell/EnvironmentNotice.tsx',
  ];
  // Include staged + unstaged edits, and brand-new files on the PATCHED
  // allowlist (plain --untracked-files=no would omit OnboardingGate-style adds).
  const porcelain = git(checkout, 'status', '--porcelain', '--untracked-files=all').toString('utf8')
    .split('\n').map(line => line.replace(/\r$/, '')).filter(Boolean);
  const dirty = [];
  for (const line of porcelain) {
    const path = line.slice(3).trim().replace(/ -> /, ' ').split(/\s+/).pop();
    if (!path) continue;
    if (!PATCHED.includes(path)) fail(`Upstream has unexpected local changes: ${path}`);
    dirty.push(path);
  }
  // `git diff HEAD` covers staged new files; plain `git diff` would miss them.
  // Untracked allowlist files need intent-to-add first, or they appear in dirty
  // but contribute zero bytes to the recorded patch (manifest/files drift).
  for (const path of dirty) {
    const mark = porcelain.find(line => line.slice(3).trim().replace(/ -> /, ' ').split(/\s+/).pop() === path);
    if (mark && mark.startsWith('??')) git(checkout, 'add', '-N', '--', path);
  }
  const patch = dirty.length ? git(checkout, 'diff', 'HEAD', '--', ...dirty) : Buffer.alloc(0);
  if (dirty.length && !patch.length) fail('The upstream patch is empty; refusing to record it.');
  for (const path of dirty) {
    if (!patch.toString('utf8').includes(`b/${path}`)) fail(`Recorded patch is missing ${path} (stage new files or use git add -N)`);
  }
  const desktop = JSON.parse(readFileSync(join(checkout, 'apps/desktop/package.json'), 'utf8'));
  if (desktop.version !== VERSION || desktop.name !== '@openfilm/desktop') fail('Unexpected upstream desktop package or version.');

  // Keep the installed adapter lightweight: retain the upstream license,
  // notices and lockfile, but rebuild source from the pinned Git commit rather
  // than shipping a second editable copy of the upstream application.
  const paths = [
    'LICENSE', 'THIRD_PARTY_NOTICES.md', 'package.json', 'pnpm-lock.yaml',
    'pnpm-workspace.yaml', 'apps/desktop/package.json',
  ];
  const entries = git(checkout, 'ls-tree', '-rz', '--full-tree', COMMIT, '--', ...paths)
    .toString('utf8').split('\0').filter(Boolean);
  const files = [];
  for (const entry of entries) {
    const match = /^(\d+) blob ([0-9a-f]+)\t(.+)$/.exec(entry);
    if (!match || !['100644', '100755'].includes(match[1])) fail('Unexpected upstream tree entry; refusing links or special files.');
    const path = match[3];
    if (path.split('/').some(part => part === '..' || part === '.' || !part)) fail('Unsafe source path.');
    files.push({ path: `source/${path}`, content: git(checkout, 'cat-file', 'blob', match[2]) });
  }
  for (const required of ['source/LICENSE', 'source/THIRD_PARTY_NOTICES.md', 'source/pnpm-lock.yaml', 'source/apps/desktop/package.json']) {
    if (!files.some(file => file.path === required || (required.endsWith('/') && file.path.startsWith(required)))) fail(`Missing upstream source: ${required}`);
  }

  // The Vite output is not tracked by Git. Restrict the input to a normal dist
  // tree and expected browser assets, and record hashes without claiming provenance.
  const dist = join(checkout, 'apps/desktop/shell/dist');
  function collect(directory, prefix = '') {
    regularDirectory(directory);
    for (const name of readdirSync(directory).sort()) {
      const path = join(directory, name);
      const relative = prefix ? `${prefix}/${name}` : name;
      const stat = lstatSync(path);
      if (stat.isSymbolicLink()) fail(`Links are not accepted in dist: ${relative}`);
      if (stat.isDirectory()) collect(path, relative);
      else if (stat.isFile() && ['.html', '.js', '.css', '.woff', '.woff2', '.ttf', '.otf', '.svg', '.png', '.jpg', '.jpeg', '.webp', '.gif', '.ico', '.wasm'].includes(extname(name).toLowerCase())) {
        files.push({ path: `ui/${relative}`, content: readFileSync(path) });
      } else fail(`Unexpected dist entry: ${relative}`);
    }
  }
  collect(dist);
  if (!files.some(file => file.path === 'ui/index.html')) fail('Missing built shell/dist/index.html.');
  if (!files.some(file => /^ui\/assets\/.*\.js$/.test(file.path))) fail('Missing built shell JavaScript assets.');
  const manifest = {
    generator: 'packages/dsh-openfilm/scripts/build-official-shell.mjs',
    version: VERSION,
    commit: COMMIT,
    upstream: { project: 'OpenFilm', desktopVersion: VERSION, commit: COMMIT, license: 'MIT', licenseFile: 'source/LICENSE' },
    build: {
      input: 'apps/desktop/shell/dist',
      description: 'Prebuilt Vite shell, not built or authenticated by this script. Build separately using the pinned upstream checkout and its lockfile.',
      sourceTrees: ['apps/desktop/shell', 'apps/desktop/chat/src', 'packages/openfilm/studio/ui/src', 'packages/shared'],
      dependencies: desktop.devDependencies,
      runtimeDependencies: desktop.dependencies,
      dependencyLock: 'source/pnpm-lock.yaml',
      notice: 'Third-party dependencies, bundled fonts, trademarks and their licenses require independent review before distribution.',
    },
    patch: dirty.length ? { files: dirty, diff: 'patch.diff' } : null,
    files: Object.fromEntries(files.map(file => [file.path, hash(file.content)])),
  };
  // The fork is one file's diff; keeping it beside the build makes the snapshot
  // reviewable without the checkout (and re-appliable on the next upgrade).
  if (dirty.length) files.push({ path: 'patch.diff', content: patch });
  files.push({ path: 'manifest.json', content: Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`) });

  // Never replace any existing directory, including a previous run. This avoids
  // deleting or overwriting unrelated files and leaves partial failures visible.
  regularDirectory(join(packageRoot, 'vendor'));
  mkdirSync(destination);
  for (const file of files) {
    const output = join(destination, ...file.path.split('/'));
    mkdirSync(dirname(output), { recursive: true });
    writeFileSync(output, file.content, { flag: 'wx' });
  }
  console.log(`Created ${destination} (${files.length} files). Review licenses and build provenance before distribution.`);
}
try { main(); } catch (error) { console.error(`build-official-shell: ${error.message}`); process.exitCode = 1; }
