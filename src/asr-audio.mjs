/**
 * The ffmpeg edge: probe, then extract, and never let the source enter Node's heap.
 *
 * Two hard constraints shaped this file.
 *
 * 1. A file-backed stdio. Under the desktop sandbox a child process may not have
 *    piped stdio, so stderr goes to a file descriptor we opened ourselves and is
 *    read back afterwards. That also means a crashed ffmpeg leaves a readable
 *    reason instead of an EPIPE.
 * 2. Probe before extract. Refusing a four-hour file after decoding four hours of
 *    audio is a bug the person pays for, so duration and stream layout are read
 *    from ffmpeg's banner first and only then is any PCM written.
 */
import { spawn } from 'node:child_process';
import { open, readFile, unlink } from 'node:fs/promises';
import { join } from 'node:path';

export const TARGET = Object.freeze({ sampleRate: 16000, channels: 1, format: 'pcm_s16le' });

const fail = (message, code) => Object.assign(new Error(message), { code });

/**
 * Where the executable is. Explicit override, then the packaged ffmpeg-static,
 * then PATH. The order matters for a packaged build: a system ffmpeg can be an
 * ancient distro build without the demuxers the person's phone produces.
 */
export async function resolveFfmpeg({ env = process.env, importer = specifier => import(specifier) } = {}) {
  const explicit = env.NO996_OPENFILM_FFMPEG;
  if (typeof explicit === 'string' && explicit.length > 0) return explicit;
  try {
    const mod = await importer('ffmpeg-static');
    const candidate = mod?.default ?? mod;
    if (typeof candidate === 'string' && candidate.length > 0) return candidate;
  } catch { /* not installed: fall through to PATH */ }
  return 'ffmpeg';
}

/** Run ffmpeg with file-backed stderr; resolves with code+stderr, never throws on a non-zero exit. */
export async function runFfmpeg(ffmpeg, args, { workDir, timeoutMs = 120_000, signal } = {}) {
  const stamp = `${process.pid}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
  const stderrPath = join(workDir, `ffmpeg-${stamp}.log`);
  let handle;
  try {
    handle = await open(stderrPath, 'w');
  } catch (failure) {
    throw fail('临时目录不可写（' + workDir + '），没法运行 ffmpeg', 'WORKDIR_UNWRITABLE');
  }
  let child;
  try {
    child = spawn(ffmpeg, args, { windowsHide: true, stdio: ['ignore', 'ignore', handle.fd] });
  } catch (failure) {
    await handle.close().catch(() => undefined);
    await unlink(stderrPath).catch(() => undefined);
    throw fail(`无法启动 ffmpeg（${String(failure?.message || failure).slice(0, 120)}）`, 'FFMPEG_MISSING');
  }
  try {
    const code = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        child.kill('SIGKILL');
        reject(fail(`ffmpeg 超过 ${Math.round(timeoutMs / 1000)} 秒没有结束`, 'FFMPEG_TIMEOUT'));
      }, timeoutMs);
      const abort = () => { child.kill('SIGKILL'); reject(fail('已取消', 'ABORTED')); };
      signal?.addEventListener?.('abort', abort, { once: true });
      child.once('error', error => {
        clearTimeout(timer);
        signal?.removeEventListener?.('abort', abort);
        reject(fail(`无法运行 ffmpeg（${String(error?.code || error?.message || error).slice(0, 120)}）`, error?.code === 'ENOENT' ? 'FFMPEG_MISSING' : 'FFMPEG_FAILED'));
      });
      child.once('exit', value => {
        clearTimeout(timer);
        signal?.removeEventListener?.('abort', abort);
        resolve(value);
      });
    });
    const stderr = await readFile(stderrPath, 'utf8').catch(() => '');
    return { code, stderr };
  } finally {
    await handle.close().catch(() => undefined);
    await unlink(stderrPath).catch(() => undefined);
  }
}

/**
 * Duration and stream layout from ffmpeg's banner. `-i` with no output exits 1
 * and writes everything to stderr; that is the documented, stable way to ask.
 */
export function parseProbeOutput(stderr) {
  const text = String(stderr ?? '');
  const duration = /Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/.exec(text);
  const durationSec = duration
    ? Number(duration[1]) * 3600 + Number(duration[2]) * 60 + Number(duration[3])
    : null;
  const audioLine = /Stream #\d+:\d+[^\n]*?:\s*Audio:\s*([^\n]*)/.exec(text);
  const hasAudio = Boolean(audioLine);
  let audioSampleRate = null;
  let audioChannels = null;
  if (audioLine) {
    const rate = /(\d+)\s*Hz/.exec(audioLine[1]);
    if (rate) audioSampleRate = Number(rate[1]);
    if (/\bmono\b/.test(audioLine[1])) audioChannels = 1;
    else if (/\bstereo\b/.test(audioLine[1])) audioChannels = 2;
    else {
      const channels = /(\d+)\s*channels/.exec(audioLine[1]);
      if (channels) audioChannels = Number(channels[1]);
    }
  }
  return { durationSec, hasAudio, audioSampleRate, audioChannels, unreadable: /Invalid data found|moov atom not found|could not find codec parameters/i.test(text) };
}

export async function probeMedia(ffmpeg, source, { workDir, timeoutMs = 60_000, signal, run = runFfmpeg } = {}) {
  const { code, stderr } = await run(ffmpeg, ['-nostdin', '-hide_banner', '-i', source], { workDir, timeoutMs, signal });
  const probe = parseProbeOutput(stderr);
  if (probe.unreadable) {
    throw fail(`读不了这个文件（格式不支持或已损坏）：${source}`, 'UNREADABLE_MEDIA');
  }
  if (code !== 0 && probe.durationSec === null && !probe.hasAudio) {
    const said = stderr.trim().split('\n').filter(Boolean).slice(-1)[0] ?? '';
    throw fail(`ffmpeg 读不出这个文件${said ? `：${said.slice(0, 200)}` : ''}`, 'UNREADABLE_MEDIA');
  }
  if (!probe.hasAudio) throw fail(`这个文件没有音轨：${source}`, 'NO_AUDIO');
  return probe;
}

/** Write the ASR-ready wav: mono, 16 kHz, signed 16-bit, first audio stream only. */
export async function extractPcm(ffmpeg, source, target, { workDir, timeoutMs = 1_800_000, signal, run = runFfmpeg } = {}) {
  const args = [
    '-nostdin', '-hide_banner', '-loglevel', 'error', '-y',
    '-i', source,
    '-vn', '-map', '0:a:0',
    '-ac', String(TARGET.channels), '-ar', String(TARGET.sampleRate),
    '-c:a', TARGET.format,
    '-f', 'wav', target,
  ];
  const { code, stderr } = await run(ffmpeg, args, { workDir, timeoutMs, signal });
  if (code === 0) return { target, stderr };
  const said = String(stderr ?? '').trim();
  if (/matches no streams|does not contain any stream/i.test(said)) throw fail(`这个文件没有音轨：${source}`, 'NO_AUDIO');
  if (/No space left/i.test(said)) throw fail('磁盘空间不足，抽音轨失败', 'NO_SPACE');
  throw fail(`抽音轨失败${said ? `：${said.split('\n').slice(-1)[0].slice(0, 200)}` : `（ffmpeg 退出码 ${code}）`}`, 'EXTRACT_FAILED');
}
