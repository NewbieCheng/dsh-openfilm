/**
 * OpenFilm's Studio fetches local models from `OPENFILM_LIBRARY_URL`
 * (default https://openfilm.dev/library). That host is not reliably reachable
 * from mainland China and does not carry SenseVoice at all, so this loopback
 * mirror answers the two SenseVoice files from hf-mirror (then huggingface.co)
 * and sends every other path — Whisper, BiRefNet — to OpenFilm's own library.
 *
 * The Studio is the client: `library.mjs` reads the env var when it fetches, so
 * pointing it here makes the native install button use these sources without
 * any change to the UI.
 */
import { createServer } from 'node:http';
import { Readable } from 'node:stream';
import { MODEL_BASES } from './download-sources.mjs';

export const SENSE_VOICE_PATHS = Object.freeze([
  'models/sensevoice-small/model.int8.onnx',
  'models/sensevoice-small/tokens.txt',
]);

const UPSTREAM = 'https://openfilm.dev/library';

let mirror = null;

/**
 * One mirror for the Host's lifetime. Never throws: a Host without a mirror
 * still starts the Studio, which then uses OpenFilm's own library as before.
 */
export async function ensureStudioLibraryMirror({ fetchImpl = globalThis.fetch, log = null } = {}) {
  if (mirror) return mirror;
  const server = createServer((req, res) => { void handle(req, res); });

  async function handle(req, res) {
    try {
      if (req.method !== 'GET' && req.method !== 'HEAD') {
        res.writeHead(405, { 'cache-control': 'no-store' });
        res.end();
        return;
      }
      const url = new URL(req.url, 'http://mirror.invalid');
      if (!url.pathname.startsWith('/library/')) {
        res.writeHead(404, { 'cache-control': 'no-store' });
        res.end();
        return;
      }
      const rel = decodeURIComponent(url.pathname.slice('/library/'.length));
      if (SENSE_VOICE_PATHS.includes(rel)) {
        await proxy(rel, res);
        return;
      }
      // Everything else is OpenFilm's library: a redirect keeps this mirror from
      // becoming a second copy of the whole catalogue.
      const target = `${UPSTREAM}/${rel.split('/').map(encodeURIComponent).join('/')}`;
      res.writeHead(302, { location: target, 'cache-control': 'no-store' });
      res.end();
    } catch (error) {
      log?.warn?.('library-mirror-request', { message: String(error?.message || error).slice(0, 120) });
      if (!res.headersSent) res.writeHead(502, { 'cache-control': 'no-store' });
      res.end();
    }
  }

  async function proxy(rel, res) {
    const file = rel.split('/').pop();
    let last = null;
    for (const source of MODEL_BASES) {
      try {
        const response = await fetchImpl(source.base + file, { redirect: 'follow' });
        if (!response.ok) throw new Error('HTTP ' + response.status);
        const length = response.headers?.get?.('content-length');
        res.writeHead(200, {
          'content-type': 'application/octet-stream',
          'cache-control': 'no-store',
          ...(length ? { 'content-length': length } : {}),
        });
        await new Promise((resolve, reject) => {
          const body = Readable.fromWeb(response.body);
          body.once('error', reject);
          res.once('close', resolve);
          res.once('finish', resolve);
          body.pipe(res);
        });
        return;
      } catch (error) {
        last = error;
      }
    }
    log?.warn?.('library-mirror-failed', { rel, message: String(last?.message || last).slice(0, 120) });
    if (!res.headersSent) res.writeHead(502, { 'cache-control': 'no-store' });
    res.end();
  }

  const port = await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve(server.address().port));
  });
  // The mirror must not keep the Host process alive by itself.
  server.unref();
  mirror = Object.freeze({
    origin: `http://127.0.0.1:${port}`,
    close: () => new Promise(resolve => server.close(() => resolve())),
  });
  return mirror;
}
