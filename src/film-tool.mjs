/**
 * `openfilm_film`: the film as Studio parses it, plus what this machine can
 * export.
 *
 * The agent needs two things it cannot get from reading film.html: what the film
 * actually *is* after Studio's own resolution (tracks, clip ids, durations,
 * locked tracks), and whether an export is even possible here (encoder support).
 * Knowing the second before promising "I exported it" is the difference between
 * an honest answer and a lie.
 */
const MAX_TRACKS = 12;
const MAX_CLIPS = 24;
const MAX_FIELDS = 16;

const text = value => (typeof value === 'string' ? (value.length > 200 ? `${value.slice(0, 200)}…` : value) : undefined);
const scalar = value => (typeof value === 'number' || typeof value === 'boolean' ? value : text(value));

/** Scalars of one object, bounded: enough to identify it, not a data dump. */
function shape(value, depth = 0) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const out = {};
  let used = 0;
  for (const [key, item] of Object.entries(value)) {
    if (used >= MAX_FIELDS) break;
    if (!/^[A-Za-z0-9_.-]{1,40}$/.test(key)) continue;
    if (item && typeof item === 'object' && !Array.isArray(item)) continue;
    if (Array.isArray(item)) {
      // A short list of scalars is informative; a list of objects is not.
      const flat = item.filter(entry => entry === null || typeof entry !== 'object').slice(0, 6);
      if (flat.length === 0) continue;
      out[key] = flat.map(entry => scalar(entry) ?? null);
    } else {
      const value2 = scalar(item);
      if (value2 === undefined) continue;
      out[key] = value2;
    }
    used += 1;
  }
  return depth > 2 ? undefined : out;
}

/** One readable summary of the parsed film document. */
export function summarizeFilm(document) {
  if (!document || typeof document !== 'object') return { tracks: [], clips: 0 };
  const tracks = Array.isArray(document.tracks) ? document.tracks : [];
  const summary = { clips: 0, tracks: [] };
  for (const track of tracks.slice(0, MAX_TRACKS)) {
    if (!track || typeof track !== 'object') continue;
    const clips = Array.isArray(track.clips) ? track.clips : [];
    summary.clips += clips.length;
    summary.tracks.push({
      ...shape(track),
      clips: clips.slice(0, MAX_CLIPS).map(clip => shape(clip)).filter(Boolean),
      ...(clips.length > MAX_CLIPS ? { moreClips: clips.length - MAX_CLIPS } : {}),
    });
  }
  const extra = shape(document);
  if (extra) {
    delete extra.tracks;
    if (Object.keys(extra).length > 0) summary.film = extra;
  }
  return summary;
}

/** Which encoder capabilities matter to an honest answer about exporting. */
export function exportReadiness(can) {
  if (!can || typeof can !== 'object') return { known: false };
  const readiness = { known: true };
  for (const [name, value] of Object.entries(can).slice(0, MAX_FIELDS)) {
    if (!/^[A-Za-z0-9_.-]{1,40}$/.test(name)) continue;
    readiness[name] = typeof value === 'boolean' || typeof value === 'string' ? value : Boolean(value);
  }
  return readiness;
}

export function createFilmTool({ isProjectAgent, projectOf, http }) {
  return {
    name: 'openfilm_film',
    description: 'Read the film as Studio parses it: tracks, clip ids, durations, locked flags — plus what this machine can export. Use it before promising an edit or an export, and after a change to confirm what the film now is. Reading it costs nothing and changes nothing.',
    parameters: {
      type: 'object', additionalProperties: false,
      properties: {
        detail: { type: 'string', enum: ['summary', 'exports'], description: 'summary (default): the film; exports: encoder support and where exports land.' },
      },
    },
    output: { schema: { type: 'object', additionalProperties: false, required: ['text'], properties: { text: { type: 'string' } } }, render: (_args, value) => [{ type: 'text', text: value?.text ?? '' }] },
    isConcurrencySafe: () => true,
    async execute(args, exec) {
      if (typeof isProjectAgent !== 'function' || isProjectAgent(exec?.agent) !== true) {
        throw new Error('This tool is available only to a conversation bound to an OpenFilm project.');
      }
      const project = projectOf?.(exec.agent);
      if (!project?.projectId) throw new Error('This conversation is not bound to an OpenFilm project.');
      const path = `/api/projects/${encodeURIComponent(project.projectId)}`;
      if (args?.detail === 'exports') {
        const result = await http().get(`${path}/exports`);
        return {
          text: `导出能力与落点（Studio 自己报的）：\n${JSON.stringify({
            can: exportReadiness(result?.can),
            folder: text(result?.folder),
            subtitles: typeof result?.subtitles === 'number' ? result.subtitles : undefined,
            project: shape(result?.project),
            running: Array.isArray(result?.exports) ? result.exports.length : undefined,
          }, null, 1).slice(0, 4000)}`,
        };
      }
      const result = await http().get(path);
      const summary = summarizeFilm(result?.doc);
      return {
        text: `影片结构（Studio 解析 film.html 的结果）${result?.filmMissing === true ? '——注意：film.html 现在不存在，Studio 按空片读' : ''}：\n${JSON.stringify({
          ...summary,
          ...(text(result?.folder) ? { folder: text(result.folder) } : {}),
          ...(result?.outer ? { outerProject: true } : {}),
        }, null, 1).slice(0, 6000)}`,
      };
    },
  };
}
