/**
 * The one way a Host tool talks to the Studio that is already running.
 *
 * Upstream's HTTP API needs `x-studio-key`, only answers its own loopback, and
 * reports failure as `{code, text}` bodies or bare status codes. Every OpenFilm
 * tool needs the same four things done the same way — resolve the upstream,
 * authenticate, time out, and turn a failure into something a person can read —
 * so they share this instead of each growing its own fetch.
 *
 * The key never leaves the Host: this module returns parsed data to a tool, and
 * a tool returns text to the model.
 */
const DEFAULT_TIMEOUT_MS = 30_000;

const error = (code, message) => Object.assign(new Error(message), { code });
const text = value => (typeof value === 'string' && value.length > 0 ? value : undefined);

/**
 * @param options.studio async () => ({origin, key}) — the live upstream, or nothing.
 * @param options.fetchImpl injectable for tests.
 */
export function createStudioHttp({ studio, fetchImpl = globalThis.fetch, timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  if (typeof studio !== 'function') throw new TypeError('A studio resolver is required');
  if (typeof fetchImpl !== 'function') throw new TypeError('A fetch implementation is required');

  async function upstream() {
    const live = await studio();
    if (!live?.origin || !live?.key) throw error('STUDIO_UNAVAILABLE', 'Studio is not running yet; open the video panel once so it starts');
    return live;
  }

  function url(live, path, query) {
    const target = new URL(path, live.origin);
    if (query) for (const [name, value] of Object.entries(query)) {
      if (value !== undefined && value !== null) target.searchParams.set(name, String(value));
    }
    return target;
  }

  async function send(method, path, { query, body, raw, accept = 'json', timeout = timeoutMs, type } = {}) {
    const live = await upstream();
    let response;
    try {
      response = await fetchImpl(url(live, path, query), {
        method,
        headers: {
          'x-studio-key': live.key,
          'accept-encoding': 'identity',
          ...(raw === undefined && body === undefined ? {} : { 'content-type': type ?? (raw === undefined ? 'application/json' : 'application/octet-stream') }),
        },
        redirect: 'error',
        signal: AbortSignal.timeout(timeout),
        ...(raw !== undefined ? { body: raw } : body === undefined ? {} : { body: JSON.stringify(body) }),
      });
    } catch (failure) {
      // A transport error can quote the URL, and the URL can carry the key: redact
      // before it reaches a tool's message, which a model may repeat verbatim.
      const said = String(failure?.message || failure).split(live.key).join('***').slice(0, 160);
      throw error('STUDIO_UNREACHABLE', `Studio did not answer: ${said}`);
    }
    if (!response || typeof response.ok !== 'boolean') throw error('STUDIO_UNREACHABLE', 'Studio did not answer');

    if (accept === 'bytes') {
      if (!response.ok) throw error('STUDIO_FAILED', `Studio could not draw that (HTTP ${response.status})${await detail(response)}`);
      return { bytes: new Uint8Array(await response.arrayBuffer()), type: response.headers?.get?.('content-type') ?? '' };
    }

    if (!response.ok) {
      // Upstream answers failures as {code, text} or as a bare status.
      const said = await readJson(response);
      const reason = text(said?.text) ?? text(said?.error) ?? (typeof said?.message === 'string' ? said.message : undefined);
      throw error('STUDIO_FAILED', `Studio refused ${path} (HTTP ${response.status})${reason ? `: ${reason.slice(0, 300)}` : ''}`);
    }
    const said = await readJson(response);
    if (said === undefined) throw error('STUDIO_FAILED', 'Studio answered with something that is not JSON');
    return said;
  }

  async function detail(response) {
    try {
      const said = await response.text();
      return said ? `: ${said.slice(0, 200)}` : '';
    } catch { return ''; }
  }

  async function readJson(response) {
    try { return await response.json(); } catch { return undefined; }
  }

  return Object.freeze({
    get: (path, options) => send('GET', path, options),
    post: (path, options) => send('POST', path, options),
    put: (path, options) => send('PUT', path, options),
    del: (path, options) => send('DELETE', path, options),
    picture: (path, options) => send('GET', path, { ...options, accept: 'bytes' }),
  });
}
