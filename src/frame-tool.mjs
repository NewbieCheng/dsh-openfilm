/**
 * `openfilm_frame`: draw one moment of the bound project's film with the
 * Studio that is already running, and hand the picture to the model.
 *
 * Why this exists: the upstream CLI (`openfilm look`) draws frames by starting
 * its own Chromium and writing PNGs. Inside a DSH session that means a second
 * browser process, a second Studio, and — on this machine — a sandbox denial
 * (named pipes). Studio already owns a renderer for exactly this purpose
 * (`GET /api/projects/:id/media?what=frame|poster`, see upstream
 * studio/server/server.mjs), so the Host asks that one over loopback with its
 * own key: no child process, no new port, no extra permission.
 *
 * The caller must authorize the agent/project binding before executing; the
 * project ID comes from the Host's binding table, never from the model.
 */
const FILM_PAGE = 'film.html';
const MIN_WIDTH = 160;
const MAX_WIDTH = 1920;
const DEFAULT_WIDTH = 960;
const MAX_PICTURE_BYTES = 12 * 1024 * 1024;
const TIMEOUT_MS = 30_000;

const imageValueSchema = {
  type: 'object', additionalProperties: false, required: ['attachmentId', 'mediaType', 'bytes', 'width', 'height'],
  properties: {
    attachmentId: { type: 'string' },
    mediaType: { type: 'string', enum: ['image/png', 'image/jpeg', 'image/webp', 'image/gif'] },
    bytes: { type: 'integer' },
    width: { type: 'integer' },
    height: { type: 'integer' },
    name: { type: 'string' },
  },
};

/** Width and height of a JPEG from its SOF marker, or undefined when unreadable. */
function jpegSize(bytes) {
  if (!(bytes instanceof Uint8Array) || bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return undefined;
  let at = 2;
  while (at + 9 < bytes.length) {
    if (bytes[at] !== 0xff) { at += 1; continue; }
    const marker = bytes[at + 1];
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) { at += 2; continue; }
    const length = (bytes[at + 2] << 8) | bytes[at + 3];
    if (length < 2) return undefined;
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      return { height: (bytes[at + 5] << 8) | bytes[at + 6], width: (bytes[at + 7] << 8) | bytes[at + 8] };
    }
    at += 2 + length;
  }
  return undefined;
}

/** Whether the calling model route declares image input; undefined when unknown. */
async function routeTakesImages(llm, exec) {
  if (!llm) return undefined;
  try {
    const routed = exec?.agent?.session?.requestHeader?.()?.config;
    const provider = routed?.provider ?? exec?.agent?.options?.provider;
    const model = routed?.model ?? exec?.agent?.options?.model;
    if (typeof provider !== 'string' || typeof model !== 'string') return undefined;
    const info = await llm.resolveModelInfo(provider, model, exec?.signal);
    if (!Array.isArray(info?.inputModalities)) return undefined;
    return info.inputModalities.includes('image');
  } catch { return undefined; }
}

/** Build the tool. Every dependency is injected so the module stays testable. */
export function createFrameTool({ isProjectAgent, projectOf, http, attachments, llm } = {}) {
  return {
    name: 'openfilm_frame',
    description: 'Draw one moment of this OpenFilm film — or its poster — with the Studio that is already running, and return the picture itself. Use it to check what a shot actually looks like before and after an edit. Needs no local Chrome, no ffmpeg and no openfilm CLI; it renders in Studio\'s own window and costs a few seconds.',
    parameters: {
      type: 'object', additionalProperties: false,
      properties: {
        at: { type: 'number', minimum: 0, description: 'Film second to draw (default 0). Ignored when poster is true.' },
        poster: { type: 'boolean', description: 'Draw the film poster (its middle moment) instead of `at`.' },
        width: { type: 'integer', minimum: MIN_WIDTH, maximum: MAX_WIDTH, description: `Picture width in CSS pixels (default ${DEFAULT_WIDTH}).` },
        probe: { type: 'boolean', description: 'Ask for the film page facts (size and duration) instead of a picture.' },
      },
    },
    output: {
      schema: {
        type: 'object', additionalProperties: false, required: ['text'],
        properties: { text: { type: 'string' }, image: imageValueSchema, at: { type: 'number' } },
      },
      render: (_args, value) => (value?.image
        ? [{ type: 'text', text: value.text }, { type: 'image', attachment: { ...value.image } }]
        : [{ type: 'text', text: value.text }]),
    },
    isConcurrencySafe: () => true,
    async execute(args, exec) {
      if (typeof isProjectAgent !== 'function' || isProjectAgent(exec?.agent) !== true) {
        throw new Error('This renderer is available only to a conversation bound to an OpenFilm project.');
      }
      const project = projectOf?.(exec.agent);
      if (!project?.projectId) throw new Error('This conversation is not bound to an OpenFilm project; open its project in the video panel first.');
      if (typeof http !== 'function') throw new Error('This Host mounts no Studio client.');

      const probe = args?.probe === true;
      const poster = args?.poster === true;
      const at = Number(args?.at ?? 0);
      if (!Number.isFinite(at) || at < 0) throw new Error('at must be a film second, 0 or more.');
      const width = Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, Math.trunc(Number(args?.width ?? DEFAULT_WIDTH)) || DEFAULT_WIDTH));
      const query = { path: FILM_PAGE };
      let label;
      if (probe) {
        query.what = 'probe';
        label = '项目页面信息';
      } else if (poster) {
        query.what = 'poster';
        label = '整片封面（中部一帧）';
      } else {
        query.what = 'frame';
        query.ms = Math.round(at * 1000);
        query.w = width;
        label = `第 ${at} 秒`;
      }
      const media = `/api/projects/${encodeURIComponent(project.projectId)}/media`;
      if (probe) {
        const facts = await http().get(media, { query });
        return { text: `项目页面信息：${JSON.stringify(facts).slice(0, 1200)}` };
      }
      let drawn;
      try {
        drawn = await http().picture(media, { query, timeout: TIMEOUT_MS });
      } catch (failure) {
        throw new Error(`Studio 画不出${label}：${String(failure?.message || failure).slice(0, 240)}`);
      }
      const bytes = drawn.bytes;
      if (!bytes || bytes.byteLength < 1) throw new Error('Studio returned an empty picture.');
      if (bytes.byteLength > MAX_PICTURE_BYTES) throw new Error('The rendered picture is larger than this tool accepts.');

      const store = attachments?.();
      if (!store || typeof store.saveImage !== 'function') throw new Error('No attachment store is mounted, so the picture cannot reach the model.');
      const size = jpegSize(bytes);
      const ref = await store.saveImage({
        data: bytes, mediaType: 'image/jpeg',
        name: `${project.projectId}-${poster ? 'poster' : `${Math.round(at * 1000)}ms`}.jpg`,
      });
      const takesImages = await routeTakesImages(llm?.(), exec);
      const where = poster ? '封面' : `第 ${at} 秒`;
      if (takesImages === false) {
        return { text: `已用 Studio 渲染${where}的画面（${ref.width ?? size?.width ?? '?'}×${ref.height ?? size?.height ?? '?'} px），但当前模型不支持读图，你看不到这张画面。需要人亲眼看，或换成支持图像输入的模型再渲染一次。` };
      }
      return {
        at: poster ? 0 : at,
        text: `Studio 渲染的${where}画面（${ref.width ?? size?.width ?? '?'}×${ref.height ?? size?.height ?? '?'} px）。这是影片此刻真实的样子：据此判断位置、遮挡与文字是否可读，不要凭 film.html 猜。`,
        image: {
          attachmentId: String(ref.attachmentId),
          mediaType: 'image/jpeg',
          bytes: Number(ref.bytes ?? bytes.byteLength),
          width: Number(ref.width ?? size?.width ?? 0),
          height: Number(ref.height ?? size?.height ?? 0),
          name: `${project.projectId}-${poster ? 'poster' : `${Math.round(at * 1000)}ms`}.jpg`,
        },
      };
    },
  };
}
