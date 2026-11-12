/**
 * `openfilm_transcribe`: the tool that turns a file on this computer into a script.
 *
 * Why a tool and not a shell recipe: the person hands over "this video" and expects
 * a script, not a two-hour tour of ffmpeg flags. The tool owns four things the model
 * would otherwise get wrong — where the model lives, that the first run downloads it,
 * where the transcript is cached, and how to present timecodes so the next step
 * (cutting on them) does not have to re-derive them.
 *
 * The first run on a fresh computer has no weights. That is stated as a normal
 * state with the bytes and the directory, and the download is started in the
 * background rather than blocking the turn, because a tool call that looks hung
 * for four minutes is worse than a clear "it is downloading, here is the progress".
 */
import { join } from 'node:path';
import { formatTimecode, truncateChars, countChars } from './asr-text.mjs';
import { assembleTranscript } from './asr-pipeline.mjs';
import { REFINE_REASONS } from './asr-refine.mjs';

const MAX_DEFAULT_CHARS = 6000;
const MAX_CHARS_LIMIT = 60000;

const mb = bytes => Math.round(Number(bytes) / 1024 / 1024);

function renderStatus(state) {
  const lines = [];
  lines.push(state.ready ? '本地语音模型：已就绪' : '本地语音模型：未就绪（首次使用需要下载）');
  lines.push('模型：' + state.label + '，约 ' + mb(state.bytesTotal) + ' MB' + (state.ready ? '（已下载）' : '（待下载）'));
  lines.push('目录：' + state.dir);
  if (state.engine && state.engine !== 'ready') lines.push('识别引擎：不可用（' + state.engine + '）');
  if (state.installing) {
    lines.push('正在下载：' + Math.round((state.progress ?? 0) * 100) + '%（' + mb(state.bytesOnDisk) + ' / ' + mb(state.bytesTotal) + ' MB）');
  } else if (!state.ready) {
    lines.push('下一步：用 setup 开始下载（约 ' + mb(state.bytesTotal) + ' MB，只下一次），或者直接给我一个视频，我会自动开始。');
  }
  lines.push('本机识别，音频不出这台电脑。');
  return lines.join('\n');
}

function renderTranscript(record, { transcriptPath = null, maxChars = MAX_DEFAULT_CHARS, refineNote = null } = {}) {
  const stats = record.stats ?? {};
  const head = [
    '本地口播文稿：' + (record.source ?? ''),
    [
      '时长 ' + formatTimecode(record.durationSec ?? 0),
      (record.segments?.length ?? 0) + ' 段',
      (record.sentences?.length ?? 0) + ' 句',
      '用时 ' + ((stats.elapsedMs ?? 0) / 1000).toFixed(1) + ' 秒'
        + (Number.isFinite(stats.rtf) ? '（RTF ' + stats.rtf + '）' : ''),
      '模型 ' + (record.model ?? 'sensevoice-small-int8'),
      record.cached ? '命中缓存' : '本次新转写',
    ].join(' · '),
  ];
  if (transcriptPath) head.push('完整 JSON（含逐句时间码）：' + transcriptPath);
  if (refineNote) head.push('校对：' + refineNote);

  const body = [];
  body.push('');
  body.push('分段：');
  for (const segment of record.segments ?? []) {
    body.push('[' + formatTimecode(segment.start) + '–' + formatTimecode(segment.end) + '] ' + segment.text);
  }

  const cut = truncateChars(record.text ?? '', maxChars);
  body.push('');
  body.push('全文' + (cut.truncated ? '（只给了前 ' + maxChars + ' 字，共 ' + countChars(record.text) + ' 字；完整版见 JSON）' : '') + '：');
  body.push(cut.text);
  return [...head, ...body].join('\n');
}

const absolute = value => typeof value === 'string' && (/^[A-Za-z]:[\\/]/.test(value) || value.startsWith('/'));

export function createTranscribeTool({ isProjectAgent, projectOf, service, refine = null }) {
  return {
    name: 'openfilm_transcribe',
    description: 'Turn a video or audio file on this computer into a timed script, entirely on this machine (no upload, CPU only). Use it before cutting: the returned segments carry start and end times you can cut on. Accepts an absolute path. The first use downloads the speech model (~228 MB) to the DSH home and reports progress; status shows readiness, setup starts the download without waiting for it.',
    parameters: {
      type: 'object', additionalProperties: false,
      properties: {
        from: { type: 'string', description: 'Absolute path of a video or audio file (mp4/mov/mkv/webm/mp3/wav/m4a...).' },
        lang: {
          type: 'string', enum: ['auto', 'zh', 'en', 'ja', 'ko', 'yue'],
          description: 'Spoken language hint. auto lets the model decide; it handles Chinese, English, Japanese, Korean and Cantonese.',
        },
        maxChars: {
          type: 'integer', minimum: 200, maximum: MAX_CHARS_LIMIT,
          description: 'How much of the full text to return inline. Default 6000; the complete transcript is always written to JSON.',
        },
        status: { type: 'boolean', description: 'Report model readiness, directory and download progress instead of transcribing.' },
        setup: { type: 'boolean', description: 'Start the model download in the background and return immediately.' },
        refine: { type: 'boolean', description: 'After local recognition, have the session model fix homophones and product names (default on). Timings are never changed.' },
      },
    },
    output: { schema: { type: 'object', additionalProperties: false, required: ['text'], properties: { text: { type: 'string' } } }, render: (_args, value) => [{ type: 'text', text: value?.text ?? '' }] },
    isConcurrencySafe: () => false,
    async execute(args, exec) {
      if (typeof isProjectAgent !== 'function' || isProjectAgent(exec?.agent) !== true) {
        throw new Error('This tool is available only to a conversation bound to an OpenFilm project.');
      }
      if (!service || typeof service.transcribe !== 'function') throw new Error('本地转写服务没有装配');

      if (args?.status === true) return { text: renderStatus(await service.status()) };

      if (args?.setup === true) {
        const state = await service.status();
        if (state.ready) return { text: renderStatus(state) };
        // Start, do not await: a four-minute download must not look like a hung turn.
        void service.setup().catch(() => undefined);
        return {
          text: '已开始下载 ' + state.label + '（约 ' + mb(state.bytesTotal) + ' MB）到：' + state.dir
            + '\n下载在后台进行，不会卡住这一轮。稍后用 status 看进度，就绪后把同一个视频再给我一次即可。',
        };
      }

      const source = args?.from;
      if (!absolute(source)) throw new Error('from 必须是本机绝对路径，例如 C:\\clips\\talk.mp4');
      const project = projectOf?.(exec.agent);
      if (!project?.path) throw new Error('This conversation is not bound to an OpenFilm project.');
      const maxChars = Number.isFinite(args?.maxChars)
        ? Math.max(200, Math.min(MAX_CHARS_LIMIT, Math.floor(args.maxChars)))
        : MAX_DEFAULT_CHARS;
      const cacheDir = join(project.path, '.openfilm', 'transcripts');

      let record;
      try {
        record = await service.transcribe({ source: source.trim(), lang: args?.lang ?? 'auto', cacheDir });
      } catch (error) {
        if (error?.code === 'MODEL_NOT_READY') {
          // A normal first-run state, not a failure: start it and say so.
          void service.setup().catch(() => undefined);
          return {
            text: String(error.message)
              + '\n这不是错误：模型下载完就会转。稍后用 status 看进度，或者现在把视频再发我一次。',
          };
        }
        throw error;
      }

      // The polish pass is the session model's job, not the CPU's: the local engine
      // cannot know this studio's product names, and a wrong name in a script is
      // exactly the error a person would have to fix by hand.
      let refineNote = '已跳过（按要求关闭）';
      if (args?.refine !== false) {
        if (typeof refine === 'function') {
          const outcome = await refine({ segments: record.segments });
          if (outcome?.refined === true) {
            const rebuilt = assembleTranscript(outcome.segments);
            record = { ...record, segments: rebuilt.segments, sentences: rebuilt.sentences, text: rebuilt.text };
            refineNote = 'DSH 模型已校对术语与标点（改动 ' + (outcome.changed ?? 0) + ' 段，时间码未变）';
          } else {
            refineNote = REFINE_REASONS[outcome?.reason] ?? '未校对';
          }
        } else {
          refineNote = '本会话没有可用的 DSH 模型，保留原始识别结果';
        }
      }

      return {
        text: renderTranscript(record, {
          maxChars,
          refineNote,
          transcriptPath: record.key ? join(cacheDir, record.key + '.json') : null,
        }),
      };
    },
  };
}
