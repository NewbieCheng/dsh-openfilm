// GET /api/no996-openfilm/area — the one read the sidebar project area needs.
//
// Read-only by construction: it lists Studio's projects, reads the stored
// project→Session bindings and the session catalog, and computes which Sessions
// the sidebar must hide. It never opens a project and never creates a Session,
// so a page that merely renders the sidebar cannot change the library.
import { buildAreaView } from './area-view.mjs';

const EMPTY = '{"projects":[],"hiddenSessionIds":[]}';

/**
 * @param {object} deps
 * @param {string} [deps.path]
 * @param {(req: import('node:http').IncomingMessage) => boolean} deps.admit
 *   Same browser-peer admission the other local routes use.
 * @param {() => Promise<object|undefined>} [deps.conversationsOf]
 *   Lazily opened project-conversation store (may fail; the route degrades).
 * @param {() => Promise<object|undefined>} [deps.proxyOf]
 *   The live Studio proxy, which owns `listProjects`.
 * @param {() => Promise<Array|undefined>} deps.listSessions
 *   The session catalog (`{items}` already unwrapped or not).
 * @param {{warn: Function}} [deps.log]
 * @returns {{kind: 'exact', path: string, handler: Function}}
 */
export function createAreaRoute({ path = '/api/no996-openfilm/area', admit, conversationsOf, proxyOf, listSessions, log } = {}) {
  if (typeof admit !== 'function') throw new TypeError('admit is required');
  if (typeof listSessions !== 'function') throw new TypeError('listSessions is required');
  return {
    kind: 'exact',
    path,
    async handler(req, res) {
      res.setHeader('cache-control', 'no-store');
      if (req.method !== 'GET') { res.writeHead(405, { allow: 'GET' }).end(); return; }
      if (!admit(req)) { res.writeHead(403, { 'content-type': 'application/json; charset=utf-8' }).end('{}'); return; }
      const proxy = await Promise.resolve(proxyOf?.() ?? undefined).catch(() => undefined);
      // Without the official shell there is no project library to list; the
      // sidebar then keeps its own reading and this route is simply empty.
      if (!proxy || typeof proxy.listProjects !== 'function') {
        res.writeHead(503, { 'content-type': 'application/json; charset=utf-8', 'content-length': Buffer.byteLength(EMPTY) }).end(EMPTY);
        return;
      }
      const projects = await proxy.listProjects().catch(error => {
        void log?.warn?.('area-projects-failed', { detail: String(error?.message ?? error).slice(0, 120) });
        return [];
      });
      const opened = await Promise.resolve(conversationsOf?.() ?? undefined).catch(() => undefined);
      const bindings = opened && typeof opened.bindings === 'function' ? opened.bindings() : [];
      const sessions = await listSessions().catch(() => undefined);
      const view = buildAreaView({ projects, bindings, sessions: Array.isArray(sessions) ? sessions : [] });
      const body = JSON.stringify(view);
      res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'content-length': Buffer.byteLength(body) }).end(body);
    },
  };
}
