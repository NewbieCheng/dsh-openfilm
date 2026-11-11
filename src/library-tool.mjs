/**
 * `openfilm_library`: OpenFilm's own free library — transitions, effects,
 * filters, stickers, text styles, music, sounds, templates.
 *
 * Two operations, because that is what upstream has:
 *   - search (`POST /api/get/library`) answers with lines of hits and their ids;
 *   - take (`POST /api/get` with `take`) copies one into the project, which is
 *     what makes it usable in film.html.
 * Search deliberately runs without a model: it scores the library by tags, so it
 * answers in milliseconds and costs nothing.
 */
const KINDS = ['transition', 'effect', 'filter', 'sticker', 'text', 'template', 'music', 'sound', 'sfx'];
const MAX_LINES = 40;

const text = value => (typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined);

function normaliseKind(value) {
  const kind = typeof value === 'string' ? value.trim().toLowerCase() : '';
  if (kind === 'sfx') return 'sound';
  return KINDS.includes(kind) ? kind : 'transition';
}

export function createLibraryTool({ isProjectAgent, projectOf, http }) {
  return {
    name: 'openfilm_library',
    description: 'Search OpenFilm\'s built-in free library (transitions, effects, filters, stickers, text styles, music, sounds, templates) by what you want it to feel like, then take the one you want into the project. Free, offline, no service needed. Use `take` with an id from a previous search to make that item part of the project.',
    parameters: {
      type: 'object', additionalProperties: false,
      properties: {
        query: { type: 'string', description: 'What you are looking for, in words ("柔和的淡入淡出", "energetic drum bed", "手写标题").' },
        kind: { type: 'string', enum: KINDS, description: 'Which part of the library to search (default transition).' },
        limit: { type: 'integer', minimum: 1, maximum: 20, description: 'How many hits (default 8).' },
        take: { type: 'string', description: 'An item id from a previous search: copy it into the project instead of searching.' },
        seconds: { type: 'integer', minimum: 1, maximum: 3600, description: 'Roughly how long it must last (music, sounds).' },
      },
    },
    output: { schema: { type: 'object', additionalProperties: false, required: ['text'], properties: { text: { type: 'string' } } }, render: (_args, value) => [{ type: 'text', text: value?.text ?? '' }] },
    isConcurrencySafe: () => true,
    async execute(args, exec) {
      if (typeof isProjectAgent !== 'function' || isProjectAgent(exec?.agent) !== true) {
        throw new Error('This tool is available only to a conversation bound to an OpenFilm project.');
      }
      const project = projectOf?.(exec.agent);
      if (!project?.projectId || !project.path) throw new Error('This conversation is not bound to an OpenFilm project.');
      const kind = normaliseKind(args?.kind);

      if (text(args?.take)) {
        // `take` lands the item in the project; the receipt says what to reference.
        const result = await http().post('/api/get', { body: { folder: project.path, verb: kind, args: { take: text(args.take) } } });
        return { text: `取入项目：${text(result?.text) ?? (result?.ok === true ? '已完成' : '没有说结果')}` };
      }

      const query = text(args?.query);
      if (!query) throw new Error('What to look for is required (or pass take with an id).');
      const limit = Number.isSafeInteger(args?.limit) ? Math.min(20, Math.max(1, args.limit)) : 8;
      const result = await http().post('/api/get/library', {
        body: {
          verb: kind,
          args: { prompt: query, limit, ...(Number.isSafeInteger(args?.seconds) ? { sec: String(args.seconds) } : {}) },
        },
      });
      const lines = Array.isArray(result?.lines) ? result.lines.filter(line => typeof line === 'string') : [];
      if (lines.length === 0) {
        return { text: `库里没有找到「${query}」（${kind}）。可以换个说法，或换一类试试。` };
      }
      return {
        text: `库里找到 ${lines.length} 条（${kind}，免费、离线）：\n${lines.slice(0, MAX_LINES).map(line => line.slice(0, 240)).join('\n')}\n\n想用其中一条：用 openfilm_library 传 take=<那条的 id>。`,
      };
    },
  };
}

/** The verbs this tool accepts, so the controller can describe it once. */
export const LIBRARY_KINDS = Object.freeze([...KINDS]);
