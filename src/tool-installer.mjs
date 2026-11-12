/**
 * Getting ffmpeg and ffprobe onto a machine that does not have them.
 *
 * Two sources, checked in this order:
 *   1. the optional packages (`ffmpeg-static`, `ffprobe-static`) that ship with
 *      a normal install — the common case, no network needed;
 *   2. a downloaded executable under <DSH_HOME>/no996-openfilm/tools, for the
 *      machine where optional dependencies were skipped or their postinstall
 *      could not reach GitHub.
 *
 * install() is single-flight and never awaited by the UI: 75 MB is a download,
 * not a request. status() reports bytes, errors and the retry state so the
 * wizard can show progress instead of pretending.
 */
import { chmod, mkdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { gunzipSync } from 'node:zlib';
import { homedir } from 'node:os';

const EXE = { win32: '.exe', darwin: '', linux: '' };

function packaged(name) {
  try {
    const loaded = createRequire(import.meta.url)(name);
    const candidate = loaded?.path ?? loaded?.default ?? loaded;
    return typeof candidate === 'string' ? candidate : null;
  } catch {
    return null;
  }
}

async function existsFile(path) {
  try { return (await stat(path)).isFile(); } catch { return false; }
}

/** Minimal ustar reader: enough for one binary out of an npm tarball. */
export function readTarMember(tar, wanted) {
  let offset = 0;
  while (offset + 512 <= tar.length) {
    const header = tar.subarray(offset, offset + 512);
    if (header.every(byte => byte === 0)) break;
    const rawName = header.subarray(0, 100).toString('utf8').replace(/\0.*$/s, '');
    const size = parseInt(header.subarray(124, 136).toString('utf8').trim() || '0', 8);
    const type = String.fromCharCode(header[156] || 48);
    const name = rawName;
    const body = tar.subarray(offset + 512, offset + 512 + size);
    if (name === wanted && (type === '0' || type === '\u0000')) return body;
    offset += 512 + Math.ceil(size / 512) * 512;
  }
  return null;
}

export const TOOL_SOURCES = Object.freeze({
  ffmpeg: Object.freeze({ package: 'ffmpeg-static', url: 'https://github.com/eugeneware/ffmpeg-static/releases/download/b6.0/ffmpeg-{platform}-{arch}.gz' }),
  ffprobe: Object.freeze({ package: 'ffprobe-static', url: 'https://registry.npmjs.org/ffprobe-static/-/ffprobe-static-3.1.0.tgz' }),
});

export function createToolInstaller({
  home = process.env.DSH_HOME || join(homedir(), '.dsh'),
  platform = process.platform,
  arch = process.arch,
  fetchImpl = globalThis.fetch,
  resolvePackaged = packaged,
  now = Date.now,
} = {}) {
  const dir = join(home, 'no996-openfilm', 'tools');
  const suffix = EXE[platform] ?? '';
  const state = new Map();

  const local = tool => join(dir, tool + suffix);
  const entry = tool => {
    if (!state.has(tool)) state.set(tool, { installing: false, received: 0, total: 0, error: '', startedAt: 0, done: false });
    return state.get(tool);
  };

  function resolve(tool) {
    const shipped = resolvePackaged(TOOL_SOURCES[tool]?.package);
    if (shipped) return shipped;
    return null;
  }

  async function localReady(tool) {
    return existsFile(local(tool));
  }

  async function snapshot() {
    const tools = {};
    for (const tool of Object.keys(TOOL_SOURCES)) {
      const current = entry(tool);
      const packed = resolve(tool);
      const localFile = await localReady(tool);
      tools[tool] = {
        ready: Boolean(packed) || localFile,
        local: localFile ? local(tool) : '',
        source: packed ? 'packaged' : localFile ? 'downloaded' : '',
        installing: current.installing,
        received: current.received,
        total: current.total,
        error: current.error,
      };
    }
    return { dir, tools };
  }

  function memberFor(tool) {
    if (tool === 'ffmpeg') {
      return `package/ffmpeg${suffix}`;
    }
    const archName = arch === 'arm64' ? 'arm64' : 'x64';
    return `package/bin/${platform}/${archName}/ffprobe${suffix}`;
  }

  async function download(tool, onBytes) {
    const spec = TOOL_SOURCES[tool];
    const url = spec.url.replace('{platform}', platform).replace('{arch}', arch);
    if (typeof fetchImpl !== 'function') throw new Error('没有可用的网络请求');
    const response = await fetchImpl(url, { redirect: 'follow' });
    if (!response.ok) throw new Error('下载失败：HTTP ' + response.status);
    const chunks = [];
    let received = 0;
    if (response.body && typeof response.body.getReader === 'function') {
      const reader = response.body.getReader();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(Buffer.from(value));
        received += value.byteLength;
        onBytes(received, Number(response.headers?.get?.('content-length')) || 0);
      }
    } else {
      const buffer = Buffer.from(await response.arrayBuffer());
      chunks.push(buffer);
      received = buffer.byteLength;
      onBytes(received, received);
    }
    const gz = Buffer.concat(chunks);
    const raw = gunzipSync(gz);
    if (tool === 'ffmpeg') return raw;
    const member = readTarMember(raw, memberFor(tool));
    if (!member) throw new Error('压缩包里没有 ffprobe');
    return member;
  }

  async function runInstall(tool) {
    const current = entry(tool);
    current.installing = true;
    current.error = '';
    current.received = 0;
    current.total = 0;
    current.startedAt = now();
    try {
      if (resolve(tool)) { current.done = true; return; }
      if (await localReady(tool)) { current.done = true; return; }
      const binary = await download(tool, (received, total) => {
        current.received = received;
        current.total = total;
      });
      await mkdir(dir, { recursive: true });
      const target = local(tool);
      const temp = target + '.part';
      await writeFile(temp, binary);
      await rename(temp, target);
      if (platform !== 'win32') await chmod(target, 0o755);
      current.done = true;
      current.received = binary.byteLength;
      current.total = binary.byteLength;
    } catch (error) {
      current.error = String(error?.message || error).slice(0, 200);
      current.done = false;
    } finally {
      current.installing = false;
    }
  }

  const flights = new Map();

  /** Start (or join) an install. The UI polls status(); it never awaits this. */
  function install(tool) {
    if (!TOOL_SOURCES[tool]) return Promise.reject(new Error('未知组件：' + tool));
    if (flights.has(tool)) return flights.get(tool);
    const flight = runInstall(tool).finally(() => flights.delete(tool));
    flights.set(tool, flight);
    return flight;
  }

  return { dir, resolve, localReady, snapshot, install, memberFor };
}
