/**
 * `openfilm_assets`: what is in the project, and bringing a file into it.
 *
 * Why this is the Host's job and not the panel's: the agent produces files —
 * a TTS mp3 from `openfilm_get`, a picture written by code, something the person
 * dragged onto the chat — and a film can only use what is inside the project
 * folder. Uploading through Studio's own route (rather than copying bytes behind
 * its back) is what makes the file appear in the panel, get its poster and its
 * probe, and be safe to reference from film.html.
 */
const MAX_IMPORT_BYTES = 256 * 1024 * 1024;
const MAX_LISTED = 200;

const MIME = {
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif',
  '.mp4': 'video/mp4', '.webm': 'video/webm', '.mov': 'video/quicktime', '.mkv': 'video/x-matroska',
  '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.m4a': 'audio/mp4', '.aac': 'audio/aac', '.flac': 'audio/flac', '.ogg': 'audio/ogg',
  '.ttf': 'font/ttf', '.otf': 'font/otf', '.woff2': 'font/woff2',
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml', '.json': 'application/json', '.txt': 'text/plain; charset=utf-8', '.vtt': 'text/vtt; charset=utf-8',
};

const mimeOf = name => MIME[String(name).slice(String(name).lastIndexOf('.')).toLowerCase()] ?? 'application/octet-stream';
const basenameOf = value => String(value).split(/[\\/]/).filter(Boolean).at(-1) ?? 'file';

/** Entries of upstream's file listing, flattened, with the path to reference. */
export function flattenFiles(tree, prefix = '', out = []) {
  if (!tree || typeof tree !== 'object') return out;
  const entries = Array.isArray(tree.files) ? tree.files : Array.isArray(tree.entries) ? tree.entries : Array.isArray(tree) ? tree : [];
  for (const entry of entries) {
    if (!entry || typeof entry !== 'object') continue;
    if (out.length >= MAX_LISTED) return out;
    const name = typeof entry.name === 'string' ? entry.name : typeof entry.path === 'string' ? basenameOf(entry.path) : '';
    if (!name) continue;
    const path = prefix ? `${prefix}/${name}` : name;
    if (entry.type === 'directory' || Array.isArray(entry.files) || Array.isArray(entry.entries)) {
      flattenFiles(entry, path, out);
      continue;
    }
    out.push({
      path,
      ...(Number.isFinite(entry.size) ? { size: entry.size } : {}),
      ...(typeof entry.type === 'string' && entry.type !== 'file' ? { type: entry.type } : {}),
    });
  }
  return out;
}

export function createAssetsTool({ isProjectAgent, projectOf, http, readLocal = null }) {
  return {
    name: 'openfilm_assets',
    description: 'List the files a film can use, or bring a file into the project (through Studio, so the panel sees it and it gets a poster/probe). Importing is the only way to make a file outside the project usable by film.html.',
    parameters: {
      type: 'object', additionalProperties: false,
      properties: {
        list: { type: 'boolean', description: 'List the project\'s files (bounded).' },
        from: { type: 'string', description: 'Absolute path of a file on this computer to import.' },
        into: { type: 'string', description: 'Where it goes inside the project (default assets/<name>). No .. and no absolute paths.' },
      },
    },
    output: { schema: { type: 'object', additionalProperties: false, required: ['text'], properties: { text: { type: 'string' } } }, render: (_args, value) => [{ type: 'text', text: value?.text ?? '' }] },
    isConcurrencySafe: () => false,
    async execute(args, exec) {
      if (typeof isProjectAgent !== 'function' || isProjectAgent(exec?.agent) !== true) {
        throw new Error('This tool is available only to a conversation bound to an OpenFilm project.');
      }
      const project = projectOf?.(exec.agent);
      if (!project?.projectId) throw new Error('This conversation is not bound to an OpenFilm project.');
      const files = `/api/projects/${encodeURIComponent(project.projectId)}/files`;

      if (typeof args?.from === 'string') {
        const source = args.from.trim();
        if (!/^[A-Za-z]:[\\/]/.test(source) && !source.startsWith('/')) throw new Error('from must be an absolute path.');
        const raw = args?.into === undefined ? `assets/${basenameOf(source)}` : String(args.into).replaceAll('\\', '/');
        const target = raw.replace(/^\.?\//, '');
        if (/^[A-Za-z]:/.test(target) || target.startsWith('/') || target.split('/').some(part => part === '..' || part === '' || part === '.')) {
          throw new Error('into must be a relative path inside the project, without ..');
        }
        // Validate the destination before touching the disk: a refusal should not
        // depend on whether the source happens to exist.
        const reader = readLocal ?? (await import('node:fs/promises')).readFile;
        let bytes;
        try {
          const info = await (await import('node:fs/promises')).stat(source);
          if (!info.isFile()) throw Object.assign(new Error('not a file'), { code: 'NOT_A_FILE' });
          if (info.size > MAX_IMPORT_BYTES) throw Object.assign(new Error('too large'), { code: 'TOO_LARGE' });
          bytes = new Uint8Array(await reader(source));
        } catch (failure) {
          throw new Error(`读不到 ${source}：${failure?.code === 'ENOENT' ? '文件不存在' : String(failure?.message || failure).slice(0, 160)}`);
        }
        const landed = await http().put(files, { query: { path: target }, raw: bytes, type: mimeOf(target) });
        const where = typeof landed?.path === 'string' ? landed.path : target;
        const warning = typeof landed?.unreadable === 'string' ? `\n注意：Studio 说这个文件读不出内容（${landed.unreadable}），它会是一个空块或不播放的片段。` : '';
        return { text: `已入库：${where}（${bytes.byteLength} 字节）。在 film.html 里按这个相对路径引用。${warning}` };
      }

      const listing = await http().get(files);
      const entries = flattenFiles(listing);
      if (entries.length === 0) return { text: '这个项目里还没有素材文件。' };
      return {
        text: `项目里的文件（最多 ${MAX_LISTED} 条，路径就是 film.html 里该写的）：\n${entries.map(entry => `${entry.path}${entry.size === undefined ? '' : ` — ${entry.size} B`}`).join('\n')}`,
      };
    },
  };
}
