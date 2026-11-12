/**
 * The model files, where they live, and getting them once.
 *
 * Weights are ~240 MB and change rarely, so they are not in the npm package: the
 * plugin stays small, and a person who never transcribes never pays for them. The
 * download is a first-use cost, reported honestly, verified by size and (when the
 * upstream publishes one) sha256, and written through a .part file so an
 * interrupted download can never be mistaken for a usable model.
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

const REPO = 'https://huggingface.co/csukuangfj/sherpa-onnx-sense-voice-zh-en-ja-ko-yue-2024-07-17/resolve/main/';

export const SENSE_VOICE = Object.freeze({
  id: 'sensevoice-small-int8',
  dir: 'sherpa-onnx-sense-voice-zh-en-ja-ko-yue-2024-07-17',
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
    else missing.push({ ...file, url: baseUrl(env) + file.name, got: size > 0 ? size : 0 });
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

function baseUrl(env) {
  const override = env?.NO996_OPENFILM_ASR_BASE_URL;
  return typeof override === 'string' && override.length > 0 ? override : REPO;
}

async function downloadOne(file, dir, { env, fetchImpl = globalThis.fetch, onProgress, signal }) {
  const target = join(dir, file.name);
  const part = target + '.part';
  const url = baseUrl(env) + file.name;
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
    if (typeof onProgress === 'function') onProgress({ file: file.name, seen, total: file.bytes, url });
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
  return { name: file.name, bytes: seen, sha256: digest };
}

/** Download whatever is missing. Resolves with the state; throws only on a real failure. */
export async function ensureModels({ env, home, fetchImpl, onProgress, signal } = {}) {
  const before = await modelState({ env, home });
  if (before.ready) return { ...before, downloaded: [] };
  const dir = before.dir;
  await mkdir(dir, { recursive: true });
  const downloaded = [];
  for (const file of before.missing) {
    if (signal?.aborted) throw Object.assign(new Error('已取消', { cause: 'ABORTED' }), { code: 'ABORTED' });
    const spec = SENSE_VOICE.files.find(candidate => candidate.name === file.name);
    downloaded.push(await downloadOne(spec, dir, { env, fetchImpl, onProgress, signal }));
  }
  const after = await modelState({ env, home });
  return { ...after, downloaded };
}
