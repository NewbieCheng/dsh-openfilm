import { createRequire } from 'node:module';
import { isAbsolute } from 'node:path';

const require = createRequire(import.meta.url);
const dependency = require('../package.json').dependencies?.openfilm;
const match = typeof dependency === 'string'
  ? /^https:\/\/registry\.npmjs\.org\/openfilm\/-\/openfilm-(\d+\.\d+\.\d+)\.tgz$/.exec(dependency)
  : null;
if (!match) throw new Error('OpenFilm dependency must be an exact official npm release URL');
/** The pinned release is declared once in package.json. */
export const OPENFILM_VERSION = match[1];
const failure = (code, message) => Object.assign(new Error(message), { code });

/**
 * Load the published Studio export lazily. No network installation, workspace
 * lookup, or local .codex checkout is involved. The installed package must match
 * the exact official release URL declared in this plugin's package.json.
 */
export async function loadPinnedStudio() {
  let version;
  try { version = require('openfilm/package.json').version; }
  catch { throw failure('STUDIO_DEPENDENCY', `Install openfilm@${OPENFILM_VERSION} in the Host dependency tree`); }
  if (version !== OPENFILM_VERSION) throw failure('STUDIO_DEPENDENCY', `OpenFilm Studio must be version ${OPENFILM_VERSION}`);
  try {
    const studio = await import('openfilm/studio');
    if (typeof studio.startStudio !== 'function') throw new Error();
    return studio.startStudio;
  } catch {
    throw failure('STUDIO_DEPENDENCY', `Cannot load the openfilm@${OPENFILM_VERSION} Studio export`);
  }
}

async function studioHealthy(instance) {
  try {
    if (typeof instance.filmOrigin !== 'string' || !instance.filmOrigin) return false;
    const response = await fetch(`http://127.0.0.1:${instance.port}/api/health`, { signal: AbortSignal.timeout(2000), redirect: 'error' });
    if (!response.ok) return false;
    const health = await response.json();
    return health.product === 'openfilm-studio' && health.version === OPENFILM_VERSION
      && health.app === true && health.filmOrigin === instance.filmOrigin;
  } catch { return false; }
}

/**
 * Host-only lifecycle, not a Client API or a UI gateway. loadStudio is an
 * injectable async function returning the upstream startStudio function.
 * Optional editorDir or resolveEditorDir supplies a trusted Host-only absolute
 * path to a matching built desktop shell, never a renderer-provided path.
 * Optional attach(instance) is a trusted Host-only hook: it can see secrets and
 * must never log or expose them. It may return an async or sync disposer. If it
 * throws, it must clean up any resources it created before throwing.
 * Creation does not start anything. ensureStarted() checks a cached instance and
 * replaces it after a failed health check; health() only checks and reports it.
 * Both return non-secret status; status() is the last observed state. close()
 * waits for an in-flight start. Both can be called again after a successful
 * close or a failed start.
 *
 * Upstream puts its key in Studio URLs and API responses; its server must not
 * be exposed to a Client until a separately designed security bridge handles
 * that behavior and the Host/workspace isolation boundary. Even with advertise
 * disabled, upstream itself may read/write its normal HOME and make network
 * requests. This wrapper never changes HOME or writes there itself.
 */
export function createStudioRuntime({ loadStudio = loadPinnedStudio, attach, askAgent, editorDir, resolveEditorDir, port = 0, checkHealth = studioHealthy } = {}) {
  if (typeof loadStudio !== 'function') throw new TypeError('loadStudio must be a function');
  if (typeof checkHealth !== 'function') throw new TypeError('checkHealth must be a function');
  if (attach !== undefined && typeof attach !== 'function') throw new TypeError('attach must be a function');
  if (askAgent !== undefined && typeof askAgent !== 'function') throw new TypeError('askAgent must be a function');
  if (editorDir !== undefined && (typeof editorDir !== 'string' || !isAbsolute(editorDir))) throw new TypeError('editorDir must be an absolute path');
  if (resolveEditorDir !== undefined && (typeof resolveEditorDir !== 'function' || editorDir !== undefined)) throw new TypeError('resolveEditorDir must be a function and cannot be combined with editorDir');
  if (!Number.isInteger(port) || port < 0 || port > 65534) throw new RangeError('port must be between 0 and 65534');

  let instance = null;
  let disposer = null;
  let ready = false;
  let stale = false;
  let starting = null;
  let closing = null;
  const status = () => Object.freeze({ running: ready, port: ready ? instance.port : null });

  function ensureStarted() {
    if (closing) return closing.then(() => ensureStarted());
    if (starting) return starting;
    starting = Promise.resolve().then(async () => {
      if (ready) {
        await health();
        if (ready) return status();
      }
      if (stale) {
        stale = false;
        await cleanup();
      }
      if (instance || disposer) throw failure('STUDIO_CLOSE', 'OpenFilm Studio cleanup is required before restart');
      try {
        const startStudio = await loadStudio();
        if (typeof startStudio !== 'function') throw new Error();
        const resolvedEditorDir = resolveEditorDir ? await resolveEditorDir() : editorDir;
        if (resolvedEditorDir !== undefined && (typeof resolvedEditorDir !== 'string' || !isAbsolute(resolvedEditorDir))) throw new TypeError('Resolved editorDir must be an absolute path');
        // No machine-wide persistent key, run.json advertisement or browser launch.
        const result = await startStudio({ port, advertise: false, stays: true, openBrowser: () => {}, ...(askAgent ? { askAgent } : {}), ...(resolvedEditorDir ? { editorDir: resolvedEditorDir } : {}) });
        if (!result || typeof result.close !== 'function') throw new Error();
        instance = result;
        try {
          const attached = attach ? await attach(result) : undefined;
          if (attached != null && typeof attached !== 'function') throw new TypeError();
          disposer = attached ?? null;
        } catch {
          // If teardown itself fails, retain the handle for an explicit close retry.
          try { await instance.close(); instance = null; } catch { /* close() may retry */ }
          throw new Error();
        }
        ready = true;
        return status();
      } catch {
        // Never propagate upstream errors: they may contain a key or keyed URL.
        throw failure('STUDIO_START', 'OpenFilm Studio could not start');
      }
    }).finally(() => { starting = null; });
    return starting;
  }

  async function health() {
    const checked = instance;
    if (!ready || !checked || closing) return status();
    let healthy = false;
    try { healthy = await checkHealth(checked); } catch { /* do not expose probe errors */ }
    if (!healthy && instance === checked && ready) {
      ready = false;
      stale = true;
    }
    return status();
  }

  async function cleanup() {
    let failed = false;
    if (disposer) {
      try { await disposer(); disposer = null; }
      catch { failed = true; }
    }
    if (instance) {
      try { await instance.close(); instance = null; }
      catch { failed = true; }
    }
    if (failed) throw failure('STUDIO_CLOSE', 'OpenFilm Studio could not close');
  }

  function close() {
    if (closing) return closing;
    closing = Promise.resolve().then(async () => {
      try {
        if (starting) await starting.catch(() => {});
        ready = false;
        stale = false;
        // Always attempt both cleanups, even if the proxy disposer fails.
        await cleanup();
      } finally {
        closing = null;
      }
    });
    return closing;
  }

  return Object.freeze({ ensureStarted, close, status, health });
}
