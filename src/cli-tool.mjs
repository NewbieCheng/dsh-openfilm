/**
 * `openfilm_cli`: the upstream CLI, as a fallback the model may *choose*.
 *
 * The Host can draw frames and read structure over HTTP, which covers almost
 * everything. Two things it cannot: `render` (the CLI is the renderer) and
 * `doctor` (what this computer actually has). `look` is here because a contact
 * sheet is sometimes what a person wants to see.
 *
 * This is a subprocess with the person's own permissions, so it is deliberately
 * narrow: three verbs, a closed set of typed flags, argv built here (never a
 * shell string), cwd pinned to the project, output bounded. Anything outside
 * that list is refused by name rather than passed through "just in case".
 */
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { dirname, join, resolve, sep } from 'node:path';

const MAX_OUTPUT = 8000;
const VERBS = ['doctor', 'look', 'render'];

/**
 * What this tool still runs.
 *
 * look and ender are gone on purpose: the kernel CLI draws frames by starting Studio and, on
 * a project Studio has never shown, by opening the person's browser (in/openfilm.mjs: open).
 * Inside DSH the film already has a window — the panel — and a second one arrives with the
 * upstream desktop-app pitch in it. openfilm_frame and openfilm_export do both jobs over HTTP.
 */
const TOOL_VERBS = ['doctor'];

/** Where the packaged CLI lives, or undefined when this install has no copy. */
export function resolveCli({ require: resolver } = {}) {
  try {
    const require = resolver ?? createRequire(import.meta.url);
    return join(dirname(require.resolve('openfilm/package.json')), 'bin', 'openfilm.mjs');
  } catch {
    return undefined;
  }
}

const num = (value, min, max) => (typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max ? value : undefined);
const within = (root, candidate) => {
  const base = resolve(root);
  const target = resolve(candidate);
  return target === base || target.startsWith(`${base}${sep}`);
};

/** argv for one verb, or a reason it cannot be built. */
export function cliArguments(verb, args, projectPath) {
  if (!VERBS.includes(verb)) return { error: `只允许 ${VERBS.join(' / ')}；${verb} 请用对应的工具或 Studio。` };
  const argv = [verb];
  if (verb === 'doctor') return { argv };
  if (verb === 'look') {
    const at = num(args?.at, 0, 60 * 60 * 24);
    const from = num(args?.from, 0, 60 * 60 * 24);
    const to = num(args?.to, 0, 60 * 60 * 24);
    if (from !== undefined && to !== undefined && to > from) argv.push(`${from}-${to}`);
    else if (at !== undefined) argv.push(String(at));
    const count = num(args?.count, 1, 60);
    if (count !== undefined) argv.push('--count', String(Math.trunc(count)));
    if (args?.full === true) argv.push('--full');
    const loudness = num(args?.loudness, -70, -5);
    if (loudness !== undefined) argv.push(`--loudness=${loudness}`);
    return { argv };
  }
  // render
  const from = num(args?.from, 0, 60 * 60 * 24);
  const to = num(args?.to, 0, 60 * 60 * 24);
  if (from !== undefined && to !== undefined && to > from) argv.push(`${from}-${to}`);
  if (typeof args?.out === 'string' && args.out) {
    if (!within(projectPath, args.out)) return { error: 'out 必须在项目文件夹里（导出到别处请用 openfilm_export）。' };
    argv.push('--out', resolve(args.out));
  }
  const fps = num(args?.fps, 1, 240);
  if (fps !== undefined) argv.push('--fps', String(fps));
  const scale = num(args?.scale, 0.1, 8);
  if (scale !== undefined) argv.push('--scale', String(scale));
  const workers = num(args?.workers, 1, 16);
  if (workers !== undefined) argv.push('--workers', String(Math.trunc(workers)));
  if (args?.alpha === true) argv.push('--alpha');
  if (args?.subtitles === true) argv.push('--subtitles');
  const loudness = num(args?.loudness, -70, -5);
  if (loudness !== undefined) argv.push(`--loudness=${loudness}`);
  return { argv };
}

/** Run one command, bounded in time and output. Never throws on a non-zero exit. */
function runNode(cli, argv, cwd, { timeoutMs = 300_000, spawnImpl = spawn } = {}) {
  return new Promise(resolvePromise => {
    let child;
    try {
      child = spawnImpl(process.execPath, [cli, ...argv], {
        cwd,
        // The CLI talks to Studio over loopback only; it never needs a shell.
        shell: false,
        windowsHide: true,
        // OPENFILM_NO_BROWSER=1 is the kernel's own documented switch (open --help): Studio
      // starts, nothing opens in the person's browser.
      env: { ...process.env, NO_COLOR: '1', NO996_OPENFILM_CLI: '0', OPENFILM_NO_BROWSER: '1' },
        stdio: ['ignore', 'pipe', 'pipe'],
      });
    } catch (failure) {
      resolvePromise({ code: null, text: `启动失败：${String(failure?.message || failure)}`, timedOut: false });
      return;
    }
    let output = '';
    let settled = false;
    const collect = chunk => {
      if (output.length >= MAX_OUTPUT) return;
      output += String(chunk);
    };
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      try { child.kill(); } catch { /* already gone */ }
      resolvePromise({ code: null, text: `${output.slice(0, MAX_OUTPUT)}\n（超时，已停止：${Math.round(timeoutMs / 1000)} 秒）`, timedOut: true });
    }, timeoutMs);
    child.stdout?.on('data', collect);
    child.stderr?.on('data', collect);
    child.on('error', failure => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolvePromise({ code: null, text: `运行失败：${String(failure?.message || failure)}`, timedOut: false });
    });
    child.on('close', code => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolvePromise({ code, text: output.slice(0, MAX_OUTPUT), timedOut: false });
    });
  });
}

export function createCliTool({ isProjectAgent, projectOf, cliPath, spawnImpl, timeoutMs } = {}) {
  return {
    name: 'openfilm_cli',
    description: 'Run the bundled OpenFilm command in this project: `doctor` (what this computer has), `look` (contact sheet of the film, or one frame), `render` (write the MP4 beside film.html). Prefer the other openfilm_* tools; use this for rendering and diagnosis. It runs with the person\'s own permissions and only these three verbs.',
    parameters: {
      type: 'object', additionalProperties: false, required: ['verb'],
      properties: {
        verb: { type: 'string', enum: TOOL_VERBS, description: 'doctor（这台机器有什么）。看画面用 openfilm_frame，导出用 openfilm_export。' },
        at: { type: 'number', minimum: 0, description: 'look: one frame at this second.' },
        from: { type: 'number', minimum: 0, description: 'look/render: range start in seconds.' },
        to: { type: 'number', minimum: 0, description: 'look/render: range end in seconds.' },
        count: { type: 'integer', minimum: 1, maximum: 60, description: 'look: frames in a sheet (12).' },
        full: { type: 'boolean', description: 'look: watch every rendered frame (white flashes, stills, black).' },
        out: { type: 'string', description: 'render: output file, inside the project folder.' },
        fps: { type: 'number', minimum: 1, maximum: 240, description: 'render: frame rate.' },
        scale: { type: 'number', minimum: 0.1, maximum: 8, description: 'render: device pixel ratio.' },
        workers: { type: 'integer', minimum: 1, maximum: 16, description: 'render: parallel browsers.' },
        alpha: { type: 'boolean', description: 'render: transparent background (.webm/.mov).' },
        subtitles: { type: 'boolean', description: 'render: burn in the project\'s subtitles.' },
        loudness: { type: 'number', minimum: -70, maximum: -5, description: 'look/render: bring the sound to this LUFS.' },
      },
    },
    output: { schema: { type: 'object', additionalProperties: false, required: ['text'], properties: { text: { type: 'string' } } }, render: (_args, value) => [{ type: 'text', text: value?.text ?? '' }] },
    isConcurrencySafe: () => false,
    async execute(args, exec) {
      if (typeof isProjectAgent !== 'function' || isProjectAgent(exec?.agent) !== true) {
        throw new Error('This tool is available only to a conversation bound to an OpenFilm project.');
      }
      const project = projectOf?.(exec.agent);
      if (!project?.path) throw new Error('This conversation is not bound to an OpenFilm project.');
      if (process.env.NO996_OPENFILM_CLI === '1') throw new Error('这个进程被标记为不许调用 CLI（NO996_OPENFILM_CLI=1）。');
      const cli = cliPath ?? resolveCli();
      if (!cli) throw new Error('这个插件里没带 openfilm CLI（找不到 openfilm/package.json）。用 openfilm_film / openfilm_frame / openfilm_export 代替。');
      const verb = String(args?.verb ?? '');
    if (!TOOL_VERBS.includes(verb)) {
      throw new Error(`openfilm_cli 只保留 ${TOOL_VERBS.join(' / ')}：${verb || '（空）'} 会启动 Studio 并可能弹出浏览器窗口。看某一秒的画面用 openfilm_frame，导出成片用 openfilm_export。`);
    }
    const built = cliArguments(verb, args, project.path);
      if (built.error) throw new Error(built.error);
      const result = await runNode(cli, built.argv, project.path, { timeoutMs, spawnImpl });
      const head = `openfilm ${built.argv.join(' ')} → 退出码 ${result.code === null ? '（没有正常结束）' : result.code}`;
      if (result.code === 0) return { text: `${head}\n${result.text || '（没有输出）'}` };
      return { text: `${head}\n${result.text || '（没有输出）'}\n按上面的输出处理；不要原样重试。` };
    },
  };
}
