#!/usr/bin/env node
// One command for "where are we against upstream, and what breaks if we move".
//
// The repository pins upstream in three places (package.json tarball,
// manifest.commit, studio-runtime's expected version). This script reads them
// together so a bump cannot start from a half-updated tree, and it replays the
// per-file patch series against a checkout instead of asking a human to eyeball
// an 80 KB diff.
import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const SHELL = join(ROOT, 'vendor', 'official-shell');
const DEFAULT_REPO = 'https://github.com/openfilm/openfilm.git';

export function versionFromTarball(url) {
  const match = /openfilm-(\d+\.\d+\.\d+)\.tgz/.exec(String(url ?? ''));
  return match ? match[1] : '';
}

export function compareVersions(left, right) {
  const a = String(left).split('.').map(Number);
  const b = String(right).split('.').map(Number);
  for (let i = 0; i < 3; i += 1) {
    const diff = (a[i] || 0) - (b[i] || 0);
    if (diff) return diff > 0 ? 1 : -1;
  }
  return 0;
}

export function readState(root = ROOT) {
  const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
  const manifest = JSON.parse(readFileSync(join(root, 'vendor', 'official-shell', 'manifest.json'), 'utf8'));
  const seriesPath = join(root, 'patches', 'series.json');
  const series = existsSync(seriesPath) ? JSON.parse(readFileSync(seriesPath, 'utf8')) : null;
  return {
    pin: {
      url: pkg?.dependencies?.openfilm ?? '',
      version: versionFromTarball(pkg?.dependencies?.openfilm),
    },
    manifest: {
      version: manifest?.version ?? '',
      commit: manifest?.commit ?? '',
      patchFiles: manifest?.patch?.files?.length ?? 0,
    },
    series: series
      ? { commit: series?.upstream?.commit ?? '', count: series?.patches?.length ?? 0 }
      : null,
  };
}

/** Three-way consistency check. The pin is the source of truth. */
export function consistency(state) {
  const problems = [];
  if (!state.pin.version) problems.push('package.json does not pin an openfilm tarball version');
  if (state.pin.version && state.manifest.version !== state.pin.version) {
    problems.push(`manifest version ${state.manifest.version || '-'} != pinned ${state.pin.version}`);
  }
  if (state.manifest.patchFiles && state.series && state.series.count !== state.manifest.patchFiles) {
    problems.push(`patch series ${state.series.count} files != manifest ${state.manifest.patchFiles}`);
  }
  if (state.series && state.manifest.commit && state.series.commit !== state.manifest.commit) {
    problems.push(`patch series commit ${state.series.commit.slice(0, 7)} != manifest ${state.manifest.commit.slice(0, 7)}`);
  }
  return problems;
}

function run(command, args, options = {}) {
  return execFileSync(command, args, { stdio: 'pipe', windowsHide: true, ...options }).toString('utf8').trim();
}

function git(dir, ...args) {
  return run('git', ['-C', dir, ...args], { maxBuffer: 64 * 1024 * 1024 });
}

export function patchFiles(root = ROOT) {
  const series = JSON.parse(readFileSync(join(root, 'patches', 'series.json'), 'utf8'));
  return series.patches.map((patch) => ({ ...patch, path: join(root, 'patches', patch.file) }));
}

function checkoutDir(args) {
  const at = args.indexOf('--dir');
  return at >= 0 ? args[at + 1] : (process.env.NO996_UPSTREAM_DIR || join(ROOT, '.upstream', 'openfilm'));
}

function requireCheckout(dir, state) {
  if (!existsSync(join(dir, '.git'))) {
    throw new Error(`no upstream checkout at ${dir}; run: npm run upstream:fetch`);
  }
  const head = git(dir, 'rev-parse', 'HEAD');
  if (state?.manifest?.commit && head !== state.manifest.commit) {
    throw new Error(`checkout HEAD ${head.slice(0, 7)} != pinned ${state.manifest.commit.slice(0, 7)}; run upstream:fetch or pass --dir`);
  }
  return head;
}

async function latestVersion() {
  try {
    const response = await fetch('https://registry.npmjs.org/openfilm/latest', {
      headers: { accept: 'application/json' },
      signal: AbortSignal.timeout(6000),
    });
    if (!response.ok) return { version: '', note: `registry HTTP ${response.status}` };
    const body = await response.json();
    return { version: String(body?.version ?? ''), note: '' };
  } catch (error) {
    return { version: '', note: `registry unavailable: ${error?.name || 'error'}` };
  }
}

async function main() {
  const [command = 'status', ...args] = process.argv.slice(2);
  const state = readState();
  const problems = consistency(state);

  if (command === 'status') {
    const online = args.includes('--online');
    const latest = online ? await latestVersion() : null;
    const payload = { ...state, problems, latest };
    if (args.includes('--json')) {
      console.log(JSON.stringify(payload, null, 2));
    } else {
      console.log(`pinned     ${state.pin.version || '?'}  (${state.pin.url || 'no tarball'})`);
      console.log(`snapshot   ${state.manifest.version || '?'} @ ${state.manifest.commit.slice(0, 7) || '?'}`);
      console.log(`patches    ${state.series ? `${state.series.count} files` : 'missing series.json'}`);
      if (latest) console.log(`npm latest ${latest.version || '-'}${latest.note ? `  (${latest.note})` : ''}`);
      if (latest?.version && state.pin.version) {
        const order = compareVersions(latest.version, state.pin.version);
        console.log(order > 0 ? 'state      upstream has a newer release' : 'state      pinned is current');
      }
      console.log(problems.length ? `problems   ${problems.join('; ')}` : 'problems   none');
    }
    if (problems.length) process.exitCode = 1;
    return;
  }

  if (command === 'fetch') {
    const dir = checkoutDir(args);
    const commit = state.manifest.commit;
    if (!commit) throw new Error('manifest has no upstream commit');
    const repoAt = args.indexOf('--repo');
    const repo = repoAt >= 0 ? args[repoAt + 1] : DEFAULT_REPO;
    if (!existsSync(join(dir, '.git'))) {
      mkdirSync(join(dir, '..'), { recursive: true });
      run('git', ['clone', '--filter=blob:none', '--no-checkout', repo, dir], { stdio: 'inherit' });
    }
    run('git', ['-C', dir, 'fetch', '--depth=1', 'origin', commit], { stdio: 'inherit' });
    git(dir, 'checkout', '--force', commit);
    console.log(`checkout ${dir} @ ${commit.slice(0, 7)}`);
    console.log('next: npm run upstream:verify');
    return;
  }

  if (command === 'verify' || command === 'bump') {
    const dir = checkoutDir(args);
    requireCheckout(dir, state);
    const patches = patchFiles();
    const failed = [];
    for (const patch of patches) {
      try {
        git(dir, 'apply', '--check', '--whitespace=nowarn', patch.path);
        console.log(`ok       ${patch.file}`);
      } catch (error) {
        const detail = String(error?.stderr ?? error?.message ?? '').split('\n').filter(Boolean).slice(0, 3).join(' | ');
        failed.push({ file: patch.file, source: patch.source, detail });
        console.log(`conflict ${patch.file}  ${detail}`);
      }
    }
    if (failed.length) {
      console.error(`\n${failed.length}/${patches.length} patches do not apply. Fix by hand in the checkout, then re-run split-patch.`);
      process.exitCode = 1;
      return;
    }
    console.log(`\nall ${patches.length} patches apply cleanly.`);
    return;
  }

  if (command === 'shell:dev') {
    const dir = checkoutDir(args);
    requireCheckout(dir, state);
    for (const patch of patchFiles()) git(dir, 'apply', '--whitespace=nowarn', patch.path);
    const pnpm = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm';
    run(pnpm, ['--filter', '@openfilm/desktop', 'build:shell'], { cwd: dir, stdio: 'inherit', shell: process.platform === 'win32' });
    const dist = join(dir, 'apps', 'desktop', 'shell', 'dist');
    if (!existsSync(dist)) throw new Error(`build produced no dist at ${dist}`);
    const dev = join(ROOT, '.dev', 'shell');
    rmSync(dev, { recursive: true, force: true });
    cpSync(dist, dev, { recursive: true });
    console.log(`\ndev shell at ${dev}`);
    console.log('run DSH with NO996_OPENFILM_DEV_SHELL=1, then refresh the panel.');
    return;
  }

  throw new Error(`unknown command: ${command} (status|fetch|verify|bump|shell:dev)`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main().catch((error) => {
    console.error(`upstream: ${error.message}`);
    process.exitCode = 1;
  });
}
