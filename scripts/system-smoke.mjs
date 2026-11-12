import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Builds the real controller against a stub DSH context and calls the two system
// routes the wizard uses. This is the closest thing to a route test without the
// desktop app: it proves route registration, admission, JSON shape and that the
// installer answers, then disposes.
process.env.DSH_HOME = mkdtempSync(join(tmpdir(), 'openfilm-smoke-'));
process.env.NO996_OPENFILM_DEBUG_PORT = '0';
process.env.NO996_OPENFILM_DEV = '1';

const { createStudioController } = await import('../src/studio-controller.mjs');

const routes = new Map();
const browser = { id: 'browser' };
const foreign = { id: 'foreign' };
let admitForeign = false;
const ctx = {
  agents: { list: () => [] },
  connection: {
    admit: () => ({ peer: admitForeign ? foreign : browser }),
    browserPeer: browser,
  },
  get: () => undefined,
  llm: {},
  agentDefaultModel: { provider: 'stub', model: 'stub' },
  systemPrompt: { context: () => () => {} },
  tools: { register: () => () => {} },
  webServer: {
    getOrigin: () => 'http://127.0.0.1:41253',
    register: route => { routes.set(route.path, route); return () => routes.delete(route.path); },
  },
};

const dispose = await createStudioController(ctx, () => { throw new Error('proxy not used'); }, { officialShell: false });

function call(path, { method = 'POST', body = '' } = {}) {
  return new Promise(resolve => {
    const chunks = body ? [Buffer.from(body)] : [];
    const req = { method, headers: {}, [Symbol.asyncIterator]: async function* () { for (const chunk of chunks) yield chunk; } };
    let status = 0;
    const res = { setHeader() {}, writeHead(code) { status = code; return res; }, end(text) { resolve({ status, body: String(text || '') }); } };
    routes.get(path).handler(req, res).catch(error => resolve({ status: 500, body: String(error) }));
  });
}

const check = await call('/api/no996-openfilm/system/check');
if (check.status !== 200) throw new Error('system/check status ' + check.status);
const snapshot = JSON.parse(check.body);
for (const key of ['platform', 'tools', 'installer', 'asr', 'ready']) {
  if (!(key in snapshot)) throw new Error('system/check is missing ' + key);
}
const install = await call('/api/no996-openfilm/system/install', { body: JSON.stringify({ tool: 'all' }) });
if (install.status !== 200) throw new Error('system/install status ' + install.status);
admitForeign = true;
const denied = await call('/api/no996-openfilm/system/check');
if (denied.status !== 403) throw new Error('a foreign peer must be refused, got ' + denied.status);
admitForeign = false;

console.log(JSON.stringify({
  routes: [...routes.keys()].filter(path => path.includes('/system/')),
  tools: snapshot.tools,
  ready: snapshot.ready,
  installer: snapshot.installer.tools,
  foreignPeerStatus: denied.status,
}));
await dispose();
process.exit(0);
