/**
 * Where a download may come from, and where an already-installed tool may be.
 *
 * GitHub and huggingface.co are the canonical homes, but both are routinely
 * unreachable from mainland China, which is why "装不动" is the normal first
 * experience there. npmmirror mirrors ffmpeg-static's release assets byte for
 * byte, and hf-mirror fronts HuggingFace, so each resource gets an ordered list
 * and the first source that answers wins. The caller records which one did, so
 * the UI can say "源：npmmirror" instead of pretending nothing happened.
 *
 * The ASR model has no ModelScope copy in the sherpa-onnx layout (the files are
 * model.int8.onnx + tokens.txt, not the PyTorch checkpoint ModelScope hosts),
 * so it is not listed there; NO996_OPENFILM_ASR_BASE_URL still overrides all.
 */
import { join } from 'node:path';

const FFMPEG_VERSION = 'b6.0';
const FFPROBE_VERSION = '3.1.0';
export const MODEL_REPO = 'csukuangfj/sherpa-onnx-sense-voice-zh-en-ja-ko-yue-2024-07-17';

export const TOOL_SOURCES = Object.freeze({
  ffmpeg: Object.freeze({
    package: 'ffmpeg-static',
    urls: Object.freeze([
      Object.freeze({ id: 'npmmirror', url: `https://registry.npmmirror.com/-/binary/ffmpeg-static/${FFMPEG_VERSION}/ffmpeg-{platform}-{arch}.gz` }),
      Object.freeze({ id: 'github', url: `https://github.com/eugeneware/ffmpeg-static/releases/download/${FFMPEG_VERSION}/ffmpeg-{platform}-{arch}.gz` }),
    ]),
  }),
  ffprobe: Object.freeze({
    package: 'ffprobe-static',
    urls: Object.freeze([
      Object.freeze({ id: 'npmmirror', url: `https://registry.npmmirror.com/ffprobe-static/-/ffprobe-static-${FFPROBE_VERSION}.tgz` }),
      Object.freeze({ id: 'npm', url: `https://registry.npmjs.org/ffprobe-static/-/ffprobe-static-${FFPROBE_VERSION}.tgz` }),
    ]),
  }),
});

/** The concrete URLs for one tool, in the order they are tried. */
export function toolSourceUrls(tool, { platform = process.platform, arch = process.arch } = {}) {
  const spec = TOOL_SOURCES[tool];
  if (!spec) return [];
  return spec.urls.map(source => ({
    id: source.id,
    url: source.url.replace('{platform}', platform).replace('{arch}', arch),
  }));
}

export const MODEL_BASES = Object.freeze([
  Object.freeze({ id: 'hf-mirror', base: `https://hf-mirror.com/${MODEL_REPO}/resolve/main/` }),
  Object.freeze({ id: 'huggingface', base: `https://huggingface.co/${MODEL_REPO}/resolve/main/` }),
]);

/** An explicit base URL still wins: it is how an operator points at a mirror. */
export function modelBases(env) {
  const override = env?.NO996_OPENFILM_ASR_BASE_URL;
  if (typeof override === 'string' && override.length > 0) return [{ id: 'custom', base: override }];
  return MODEL_BASES;
}

/**
 * Where a package manager may have put ffmpeg: a GUI launched from Finder or
 * the Start menu does not inherit the shell's PATH, so "已安装但没检测到" is
 * almost always this list being missing rather than the binary being absent.
 */
export function knownBinaryDirs(platform = process.platform, env = process.env) {
  if (platform === 'darwin') return ['/opt/homebrew/bin', '/usr/local/bin', '/usr/bin'];
  if (platform === 'win32') {
    const dirs = [];
    if (env.LOCALAPPDATA) dirs.push(join(env.LOCALAPPDATA, 'Microsoft', 'WinGet', 'Links'));
    if (env.USERPROFILE) dirs.push(join(env.USERPROFILE, 'scoop', 'shims'));
    if (env.ProgramData) dirs.push(join(env.ProgramData, 'chocolatey', 'bin'));
    return dirs;
  }
  return ['/usr/local/bin', '/usr/bin', '/snap/bin'];
}

/** Put those directories in front of this process's PATH, once. */
export function augmentPath({ platform = process.platform, env = process.env } = {}) {
  const current = String(env.PATH ?? env.Path ?? '');
  const parts = current.split(platform === 'win32' ? ';' : ':').filter(Boolean);
  const missing = knownBinaryDirs(platform, env).filter(dir => !parts.includes(dir));
  if (missing.length === 0) return false;
  const next = [...missing, ...parts].join(platform === 'win32' ? ';' : ':');
  if (platform === 'win32') env.Path = next; else env.PATH = next;
  return true;
}
