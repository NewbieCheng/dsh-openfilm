import { spawn as nodeSpawn } from 'node:child_process';

const DEFAULT_TIMEOUT_MS = 3000;
const DEFAULT_MAX_OUTPUT_BYTES = 64 * 1024;

/**
 * Create an on-demand detector. spawn has the same signature as node:child_process.spawn;
 * its environment and working directory default to those inherited by OpenFilm itself.
 * Results are { platform, tools: { ffmpeg, ffprobe } }. Status is ok, missing,
 * unusable, or timeout; unusable includes a fixed reason, never command output.
 */
export function createHostComponentDetector({
  spawn = nodeSpawn,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  maxOutputBytes = DEFAULT_MAX_OUTPUT_BYTES,
} = {}) {
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 2_147_483_647) throw new RangeError('invalid timeoutMs');
  if (!Number.isSafeInteger(maxOutputBytes) || maxOutputBytes < 1) throw new RangeError('invalid maxOutputBytes');

  function check(bin) {
    return new Promise(resolve => {
      let child;
      let timer;
      let settled = false;
      let size = 0;
      const output = [[], []];
      const finish = (result, kill = false) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (kill) {
          try { child?.kill('SIGKILL'); } catch { /* process already exited */ }
        }
        resolve(result);
      };
      const failure = error => {
        if (error?.code === 'ENOENT') return finish({ status: 'missing' });
        const reason = ['EACCES', 'EPERM', 'ENOEXEC'].includes(error?.code) ? 'not-executable' : 'spawn-error';
        finish({ status: 'unusable', reason });
      };
      try {
        child = spawn(bin, ['-version'], { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true, shell: false });
        child.on('error', failure);
        for (const [index, stream] of [child.stdout, child.stderr].entries()) {
          stream.on('data', chunk => {
            if (settled) return;
            const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
            size += bytes.length;
            if (size > maxOutputBytes) return finish({ status: 'unusable', reason: 'output-limit' }, true);
            output[index].push(bytes);
          });
          stream.on('error', () => finish({ status: 'unusable', reason: 'stream-error' }, true));
        }
        child.on('close', (code, signal) => {
          if (code !== 0 || signal) return finish({ status: 'unusable', reason: 'exit' });
          const signature = new RegExp(`^${bin} version[ \\t]+\\S+`, 'm');
          const matches = output.some(chunks => signature.test(Buffer.concat(chunks).toString('utf8')));
          finish(matches ? { status: 'ok' } : { status: 'unusable', reason: 'version-mismatch' });
        });
        timer = setTimeout(() => finish({ status: 'timeout' }, true), timeoutMs);
      } catch (error) {
        failure(error);
      }
    });
  }

  return async function detectHostComponents() {
    // Sequential probes keep the number of children per request bounded.
    const ffmpeg = await check('ffmpeg');
    const ffprobe = await check('ffprobe');
    return { platform: process.platform, tools: { ffmpeg, ffprobe } };
  };
}
