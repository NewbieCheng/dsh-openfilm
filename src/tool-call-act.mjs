/**
 * Turn one tool call into the shape the official shell actually draws.
 *
 * The shell never reads a tool's name for display. It reads three things:
 *   - `kind`: one of read / search / edit / delete / move / execute / fetch /
 *     think / other — this picks the Chinese action line ("正在读取文件" …);
 *   - `rawInput`: an OBJECT it can dig into for the detail (path, command,
 *     pattern, url). A string here is discarded, which is why every tool once
 *     read as a bare "正在处理" with no file name;
 *   - `locations[].path` / `content[].path`: the canonical file detail for
 *     read/edit kinds.
 * A per-call `title` is only consulted for the OpenFilm verb namespace
 * (`openfilm:look` → "正在预览影片"), so our own tools use that namespace where
 * the upstream verb really means the same thing.
 *
 * Everything is clamped: this text is rendered in a web page and the person
 * needs a one-line hint, not a dumped argument object.
 */
const MAX_KEYS = 12;
const MAX_TEXT = 300;
const MAX_ARRAY = 10;

const text = value => (typeof value === 'string' && value.length > 0 ? (value.length > MAX_TEXT ? `${value.slice(0, MAX_TEXT)}…` : value) : undefined);

/** Path-ish argument, whichever spelling the tool used. */
function pathOf(input) {
  for (const key of ['path', 'file_path', 'filePath', 'target', 'file']) {
    const value = text(input?.[key]);
    if (value) return value;
  }
  return undefined;
}

/** Pattern-ish argument: one string or a list of them. */
function patternOf(input) {
  const value = input?.pattern;
  if (typeof value === 'string') return text(value);
  if (Array.isArray(value)) {
    const parts = value.filter(item => typeof item === 'string').slice(0, 4).map(item => text(item) ?? '');
    return parts.length > 0 ? parts.join(' ') : undefined;
  }
  return undefined;
}

/** Shallow, printable copy of an argument object. */
function clampInput(value, depth = 0) {
  if (value === null || typeof value === 'number' || typeof value === 'boolean') return value;
  if (typeof value === 'string') return text(value) ?? '';
  if (depth >= 2) return Array.isArray(value) ? '[…]' : '{…}';
  if (Array.isArray(value)) return value.slice(0, MAX_ARRAY).map(item => clampInput(item, depth + 1));
  if (typeof value === 'object') {
    const copy = {};
    for (const [key, item] of Object.entries(value).slice(0, MAX_KEYS)) {
      if (!/^[A-Za-z0-9_.-]{1,40}$/.test(key)) continue;
      copy[key] = clampInput(item, depth + 1);
    }
    return copy;
  }
  return undefined;
}

/** Arguments arrive as a JSON string (durable events) or an object (streamed). */
export function parseArguments(input) {
  if (input && typeof input === 'object' && !Array.isArray(input)) return input;
  if (typeof input !== 'string' || input.length === 0) return {};
  try {
    const parsed = JSON.parse(input);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch { return {}; }
}

/** A shell kind plus the object the shell can take its detail from. */
function describe(kind, rawInput, locations) {
  return {
    kind,
    rawInput,
    ...(locations && locations.length > 0 ? { locations } : {}),
  };
}

/** Map our own OpenFilm tools onto the upstream verb the shell already labels. */
function describeFilmTool(name, input) {
  const verb = name.replace(/^openfilm[_:.]/, '');
  const at = Number(input?.at);
  switch (verb) {
    case 'frame':
      // `openfilm:look` + a numeric `at` is exactly the shell's "look at a frame".
      if (Number.isFinite(at) && input?.poster !== true) return { title: 'openfilm:look', ...describe('other', { at }) };
      return { title: 'openfilm:look', ...describe('other', {}) };
    case 'film':
      return { title: 'openfilm:check', ...describe('other', {}) };
    case 'library':
      return { title: 'openfilm:library', ...describe('search', { ...(text(input?.query) ? { pattern: text(input.query) } : {}) }) };
    case 'get': {
      const flavour = text(input?.kind) ?? 'image';
      const target = flavour === 'audio' || flavour === 'music' || flavour === 'voice' ? 'openfilm:audio_music'
        : flavour === 'video' ? 'openfilm:video_gen' : 'openfilm:image_gen';
      return { title: target, ...describe('other', text(input?.prompt) ? { prompt: text(input.prompt) } : {}) };
    }
    case 'export':
      return { title: 'openfilm:export', ...describe('execute', { command: ['openfilm', 'render', ...(text(input?.target) ? [text(input.target)] : [])] }) };
    case 'clip':
      return {
        title: 'openfilm:clip',
        ...describe('edit', pathOf(input) ? { path: pathOf(input) } : { path: 'film.html' },
          [{ path: pathOf(input) ?? 'film.html' }]),
      };
    case 'cli': {
      const argv = Array.isArray(input?.args) ? input.args.filter(item => typeof item === 'string').slice(0, 8) : [];
      const command = ['openfilm', ...(text(input?.verb) ? [text(input.verb)] : []), ...argv].join(' ');
      return { title: 'openfilm:cli', ...describe('execute', { command }) };
    }
    default:
      return { title: `openfilm:${verb || 'tool'}`, ...describe('other', clampInput(input)) };
  }
}

/**
 * @param call one tool call: its `name` and its raw `input` (string or object).
 * @returns `{title, kind, rawInput, locations?}` ready for a `tool_call` update.
 */
export function describeToolCall({ name, input } = {}) {
  const raw = typeof name === 'string' && name.length > 0 ? name.slice(0, 80) : 'tool';
  // Deployments prefix tool names (`ops_read_files`); the shape is the same.
  const tool = raw.replace(/^ops_/, '');
  const args = parseArguments(input);
  if (/^openfilm[_:.]/.test(tool)) return describeFilmTool(tool, args);

  const path = pathOf(args);
  const locations = path ? [{ path }] : undefined;
  switch (tool) {
    case 'read':
    case 'read_file':
    case 'read_files':
    case 'read_image':
      return { title: raw, ...describe('read', path ? { path } : clampInput(args), locations) };
    case 'write':
    case 'write_file':
    case 'write_files':
    case 'edit':
    case 'edit_file':
    case 'multi_edit':
    case 'apply_patch':
    case 'str_replace_editor':
      return { title: raw, ...describe('edit', path ? { path } : clampInput(args), locations) };
    case 'glob':
    case 'list_dir':
    case 'ls':
      return { title: raw, ...describe('search', { ...(patternOf(args) ? { pattern: patternOf(args) } : {}), ...(path ? { path } : {}) }) };
    case 'grep':
    case 'ripgrep':
      return { title: raw, ...describe('search', { ...(patternOf(args) ? { pattern: patternOf(args) } : {}), ...(path ? { path } : {}) }) };
    case 'pwsh':
    case 'bash':
    case 'shell':
    case 'terminal':
    case 'run': {
      // A command may be one string or an argv array; the shell strips a
      // `bash -lc` wrapper itself once it sees an array.
      const command = Array.isArray(args.command) ? args.command.filter(item => typeof item === 'string').slice(0, 12)
        : typeof args.command === 'string' ? args.command
          : typeof args.cmd === 'string' ? args.cmd : undefined;
      const clipped = Array.isArray(command) ? command.map(item => text(item) ?? '') : text(command);
      return {
        title: raw,
        ...describe('execute', {
          ...(clipped === undefined ? {} : { command: clipped }),
          ...(text(args.cwd) ? { cwd: text(args.cwd) } : {}),
        }),
      };
    }
    case 'web_search':
      return { title: raw, ...describe('fetch', text(args.query) ? { query: text(args.query) } : clampInput(args)) };
    case 'web_fetch':
      return { title: raw, ...describe('fetch', text(args.url) ? { url: text(args.url) } : clampInput(args)) };
    default:
      return { title: raw, ...describe('other', clampInput(args)) };
  }
}

/**
 * The plan update for a `todo_write` call, or undefined when the arguments carry
 * no list. DSH's statuses are already the shell's.
 */
export function planFromTodoWrite(input) {
  const args = parseArguments(input);
  const todos = Array.isArray(args.todos) ? args.todos : undefined;
  if (!todos) return undefined;
  const entries = [];
  for (const item of todos.slice(0, 40)) {
    const content = text(item?.content);
    if (!content) continue;
    const status = ['pending', 'in_progress', 'completed'].includes(item?.status) ? item.status : 'pending';
    entries.push({ content, status });
  }
  return entries.length > 0 ? entries : undefined;
}
