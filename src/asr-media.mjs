/**
 * The real media edge: ffmpeg in, a windowed wav reader out.
 *
 * One place resolves the executable, so the provider override, the packaged
 * binary and PATH are tried in a single order and a missing ffmpeg is reported as
 * something the person can act on rather than as an ENOENT from deep inside a tool.
 */
import { openWav } from './asr-wav.mjs';
import { probeMedia, extractPcm, resolveFfmpeg, runFfmpeg } from './asr-audio.mjs';

export function createMediaEdge({
  ffmpegPath = null,
  env = process.env,
  run = runFfmpeg,
  open = openWav,
} = {}) {
  let resolved = ffmpegPath;
  const executable = async () => {
    if (!resolved) resolved = await resolveFfmpeg({ env });
    return resolved;
  };
  return {
    get ffmpeg() { return resolved; },
    async probe(source, { workDir, signal } = {}) {
      return probeMedia(await executable(), source, { workDir, run, signal });
    },
    async extract(source, target, { workDir, signal } = {}) {
      return extractPcm(await executable(), source, target, { workDir, run, signal });
    },
    async openWav(target) {
      return open(target);
    },
  };
}
