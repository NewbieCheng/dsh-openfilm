/**
 * `openfilm_export`: the film as a file.
 *
 * Order matters here, because an export is the one promise a person will check:
 * capabilities are read *before* a job is queued, so a machine without ffmpeg
 * gets "this machine cannot encode H.264" instead of a job that fails silently
 * minutes later. Jobs are named, cancellable, and their outputs are the only
 * proof an export worked — never "started successfully".
 */
const KINDS = ['video', 'gif', 'audio', 'stills', 'poster', 'subtitles', 'slides', 'nle'];

const scalarKeys = [
  'frame', 'fill', 'shortEdge', 'fps', 'quality', 'codec', 'format', 'clip', 'preset', 'sidecar', 'loudness',
  'mix', 'stems', 'as', 'width', 'scale',
];

/** Copy only the fields upstream documents, and only when they carry a value. */
export function exportAsk(args) {
  const ask = { kind: args?.kind };
  for (const key of scalarKeys) {
    const value = args?.[key];
    if (value === undefined || value === null || value === '') continue;
    ask[key] = value;
  }
  if (Array.isArray(args?.at)) {
    const seconds = args.at.filter(value => typeof value === 'number' && Number.isFinite(value) && value >= 0).slice(0, 50);
    if (seconds.length > 0) ask.at = seconds;
  }
  return ask;
}

/** Why a job cannot run here, or undefined when nothing is known to block it. */
export function blockedBy(can, kind) {
  if (!can || typeof can !== 'object') return undefined;
  if (kind === 'video' && can.h264 !== true) return '这台机器的 ffmpeg 编不了 H.264（也就是导不了视频）';
  if (kind === 'gif' && can.h264 !== true) return '这台机器没有可用的 ffmpeg，导不了 GIF';
  if (kind === 'audio' && can.mp3 === false) return undefined; // wav/m4a may still work; the job says so itself
  return undefined;
}



export function createExportTool({ isProjectAgent, projectOf, http }) {
  return {
    name: 'openfilm_export',
    description: 'Export the film with Studio, or check and cancel exports. Reads encoder support first: if this machine cannot encode the format, it says so instead of queueing a doomed job. Files land in the exports folder (or beside the film). Always report the real output paths from status, never that an export "started".',
    parameters: {
      type: 'object', additionalProperties: false,
      properties: {
        action: { type: 'string', enum: ['start', 'status', 'cancel'], description: 'start (default): queue an export; status: what happened; cancel: stop one by id.' },
        kind: { type: 'string', enum: KINDS, description: 'What to export (start).' },
        job: { type: 'string', description: 'The export id (cancel).' },
        codec: { type: 'string', description: 'video: h264 (default) | hevc | vp9 | prores422hq | prores4444 | hevc_alpha | png.' },
        frame: { type: 'string', description: 'A delivery frame such as 16:9, 9:16, 4:5, 2.39:1.' },
        fill: { type: 'string', enum: ['contain', 'cover'], description: 'How the film fits that frame.' },
        shortEdge: { type: 'integer', minimum: 16, maximum: 4096, description: 'The picture\'s short side in pixels.' },
        fps: { type: 'number', minimum: 1, maximum: 240, description: 'Frame rate.' },
        at: { type: 'array', items: { type: 'number', minimum: 0 }, maxItems: 50, description: 'stills/poster/slides: which seconds.' },
        format: { type: 'string', description: 'audio: wav|m4a|mp3; stills: png|jpg; subtitles: srt|vtt|txt; slides: pptx|pdf; nle: xml|fcpxml|jianying|capcut.' },
        mix: { type: 'boolean', description: 'audio: the mix.' },
        stems: { type: 'boolean', description: 'audio: one file per stem.' },
        sidecar: { type: 'string', enum: ['srt', 'vtt'], description: 'video: write the subtitles beside the video too.' },
        loudness: { type: 'number', minimum: -70, maximum: -5, description: 'Bring the sound to this LUFS.' },
        clip: { type: 'string', description: 'video: only this clip id.' },
        preset: { type: 'string', description: 'video: a platform name for the file name.' },
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
      const base = `/api/projects/${encodeURIComponent(project.projectId)}/exports`;
      const action = args?.action ?? 'start';

      if (action === 'status') {
        const result = await http().get(base);
        const jobs = Array.isArray(result?.exports) ? result.exports : [];
        if (jobs.length === 0) return { text: '这个项目还没有导出任务。' };
        const described = jobs.slice(0, 10).map(job => {
          const outputs = Array.isArray(job?.outputs) ? job.outputs.filter(item => typeof item === 'string').slice(0, 5) : [];
          return `${job?.id} · ${job?.kind ?? '?'} · ${job?.status ?? '?'}${job?.error ? ` · ${String(job.error).slice(0, 160)}` : ''}${outputs.length ? `\n   ${outputs.join('\n   ')}` : ''}`;
        });
        return { text: `导出任务（新的在前）：\n${described.join('\n')}` };
      }

      if (action === 'cancel') {
        const id = typeof args?.job === 'string' ? args.job : '';
        if (!id) throw new Error('Which export? Pass job with its id (see action: status).');
        await http().del(`${base}/${encodeURIComponent(id)}`);
        return { text: `已取消导出 ${id}（已开始的编码会尽快停下）。` };
      }

      if (!KINDS.includes(args?.kind)) throw new Error(`kind must be one of: ${KINDS.join(', ')}`);
      const before = await http().get(base);
      const blocked = blockedBy(before?.can, args.kind);
      if (blocked) throw new Error(`没有导出：${blocked}。先让它在 Studio 里跑通预览，或装 ffmpeg 后再试。`);
      const ask = exportAsk(args);
      const started = await http().post(base, { body: ask });
      const job = started?.export ?? started;
      const folder = typeof before?.folder === 'string' ? before.folder : undefined;
      return {
        text: [
          `已排队：${job?.kind ?? ask.kind} 导出${job?.id ? `（${job.id}）` : ''}。`,
          job?.status ? `状态：${job.status}` : '',
          folder ? `文件会落在：${folder}` : '文件会落在导出文件夹（或影片旁边）。',
          '真实结果用 action: status 查它的 outputs；没看到文件之前不要说"已经导出好了"。',
        ].filter(Boolean).join('\n'),
      };
    },
  };
}
