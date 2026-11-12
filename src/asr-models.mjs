/**
 * The model files, where they live, and getting them once.
 *
 * Weights are ~240 MB and change rarely, so they are not in the npm package: the
 * plugin stays small, and a person who never transcribes never pays for them. The
 * download is a first-use cost, reported honestly, verified by size and (when the
 * upstream publishes one) sha256, and written through a .part file so an
 * interrupted download can never be mistaken for a usable model.
 *
 * Two sources are tried in order: hf-mirror (reachable from mainland China) and
 * huggingface.co itself. NO996_OPENFILM_ASR_BASE_URL still overrides both.
 *
 * SenseVoice-small int8 for recognising, and nothing else: its own ITN head
 * restores Chinese punctuation, so there is no second punctuation model to ship.
 */
import { createHash } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { mkdir, rename, stat, unlink } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { MODEL_REPO, modelBases } from './download-sources.mjs';

export const SENSE_VOICE = Object.freeze({
  id: 'sensevoice-small-int8',
  dir: MODEL_REPO.split('/')[1],
  label: 'SenseVoice-small (int8)',
  bytes: 239233841 + 315894,
  files: [
    { name: 'model.int8.onnx', bytes: 239233841, sha256: 'c71f0ce00bec95b07744e116345e33d8cbbe08cef896382cf907bf4b51a2cd51' },
    { name: 'tokens.txt', bytes: 315894, sha256: null },
  ],
});

/** $DSH_HOME/no996-openfilm/models — the same home the account file already uses. */
export function modelsRoot({ env = process.env, home = homedir() } = {}) {
  const base = env.DSH_HOME && env.DSH_HOME.length > 0 ? env.DSH_HOME : join(home, '.dsh');
  return join(base, 'no996-openfilm', 'models');
}

export function senseVoiceDir({ env, home } = {}) {
  return join(modelsRoot({ env, home }), SENSE_VOICE.dir);
}

/**
 * What is on disk right now. Never throws for a missing model: "not prepared yet"
 * is the normal first state, and the tool turns it into an instruction.
 */
export async function modelState({ env, home } = {}) {
  const dir = senseVoiceDir({ env, home });
  const model = join(dir, 'model.int8.onnx');
  const tokens = join(dir, 'tokens.txt');
  const missing = [];
  const present = [];
  for (const file of SENSE_VOICE.files) {
    const path = join(dir, file.name);
    let size = -1;
    try { size = (await stat(path)).size; } catch { /* absent */ }
    if (size === file.bytes) present.push(file.name);
    else missing.push({ ...file, url: modelBases(env)[0].base + file.name, got: size > 0 ? size : 0 });
  }
  return {
    id: SENSE_VOICE.id,
    label: SENSE_VOICE.label,
    dir,
    model,
    tokens,
    ready: missing.length === 0,
    present,
    missing,
    bytesTotal: SENSE_VOICE.bytes,
  };
}

async function downloadOne(file, dir, { base, source, fetchImpl = globalThis.fetch, onEvent, signal }) {
  const target = join(dir, file.name);
  const part = target + '.part';
  const url = base + file.name;
  const response = await fetchImpl(url, { redirect: 'follow', signal });
  if (!response || !response.ok) {
    throw Object.assign(new Error('下载模型失败（HTTP ' + (response?.status ?? '?') + '）：' + url), { code: 'MODEL_DOWNLOAD_FAILED' });
  }
  const hash = createHash('sha256');
  let seen = 0;
  const body = Readable.fromWeb(response.body);
  body.on('data', chunk => {
    seen += chunk.length;
    hash.update(chunk);
    if (typeof onEvent === 'function') onEvent({ phase: 'downloading', source, file: file.name, seen, total: file.bytes });
  });
  await pipeline(body, createWriteStream(part));
  if (file.bytes > 0 && seen !== file.bytes) {
    await unlink(part).catch(() => undefined);
    throw Object.assign(new Error('下载不完整：' + file.name + ' 收到 ' + seen + ' 字节，应为 ' + file.bytes), { code: 'MODEL_DOWNLOAD_INCOMPLETE' });
  }
  const digest = hash.digest('hex');
  if (file.sha256 && digest !== file.sha256) {
    await unlink(part).catch(() => undefined);
    throw Object.assign(new Error('模型校验失败：' + file.name + ' 的 sha256 是 ' + digest.slice(0, 12) + '…，应为 ' + file.sha256.slice(0, 12) + '…'), { code: 'MODEL_CHECKSUM' });
  }
  await rename(part, target);
  return { name: file.name, bytes: seen, sha256: digest, source };
}

/** Download whatever is missing. Resolves with the state; throws only on a real failure. */
export async function ensureModels({ env, home, fetchImpl, onEvent, signal } = {}) {
  const before = await modelState({ env, home });
  if (before.ready) return { ...before, downloaded: [] };
  const dir = before.dir;
  await mkdir(dir, { recursive: true });
  const bases = modelBases(env);
  const downloaded = [];
  for (const file of before.missing) {
    if (signal?.aborted) throw Object.assign(new Error('已取消', { cause: 'ABORTED' }), { code: 'ABORTED' });
    const spec = SENSE_VOICE.files.find(candidate => candidate.name === file.name);
    const failures = [];
    let done = null;
    for (const source of bases) {
      if (signal?.aborted) throw Object.assign(new Error('已取消', { cause: 'ABORTED' }), { code: 'ABORTED' });
      if (typeof onEvent === 'function') onEvent({ phase: 'connecting', source: source.id, file: file.name });
      try {
        done = await downloadOne(spec, dir, { base: source.base, source: source.id, fetchImpl, onEvent, signal });
        break;
      } catch (error) {
        if (error?.code === 'ABORTED') throw error;
        failures.push(source.id + ': ' + String(error?.message || error).slice(0, 120));
      }
    }
    if (!done) {
      throw Object.assign(new Error('所有下载源都失败（' + failures.join('；') + '）'), { code: 'MODEL_DOWNLOAD_FAILED' });
    }
    if (typeof onEvent === 'function') onEvent({ phase: 'done', source: done.source, file: file.name });
    downloaded.push(done);
  }
  const after = await modelState({ env, home });
  return { ...after, downloaded };
}
