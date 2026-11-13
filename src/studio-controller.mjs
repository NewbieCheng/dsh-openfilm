import { createStudioRuntime } from './studio-runtime.mjs';
import { createHostComponentDetector } from './host-components.mjs';
import { installTemplate, listTemplates } from './official-templates.mjs';
import {
  balanceCachePatch,
  balanceFromPrefs,
  clearBalanceCachePatch,
  createPreferencesStore,
  onboardingCopy,
  productMeta,
} from './preferences.mjs';
import { createToolInstaller } from './tool-installer.mjs';
import { augmentPath } from './download-sources.mjs';
import { applyStudioLibraryPatch } from './studio-library-patch.mjs';
import { applyAcpModelProviders } from './acp-profile-models.mjs';
import { readFileSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { basename, dirname, join } from 'node:path';
import { homedir, tmpdir } from 'node:os';
import { randomBytes } from 'node:crypto';

// The running Host's own build identity. A plugin reload that re-imports this
// module rewrites the marker; a stale marker proves the process kept old code.
// Read fresh on every evaluation: require() caches JSON, which made this
// report the version from the first load after a hot reload.
const HOST_VERSION = (() => { try { return String(JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version); } catch { return 'unknown'; } })();

const templatesRoot = fileURLToPath(new URL('../vendor/templates/', import.meta.url));

/** The ACP path is the default; an explicit 0 is the escape hatch. */
/** Page events the Host will record; anything else is refused. */
const CLIENT_EVENTS = new Set(['recovery-shown', 'restart-click', 'picker-placed', 'session-expired', 'permission-shown', 'permission-chosen']);
import { redeemStudioSession, startStudioDebug } from './studio-debug.mjs';
import { startLocalConsole } from './studio-debug-redirect.mjs';
import { createDshAskAgent } from './dsh-ai.mjs';
import { reportPresetStatus } from './preset-report.mjs';
import { createGuideTool } from './guide-tool.mjs';
import { createStudioHttp } from './studio-http.mjs';
import { createFrameTool } from './frame-tool.mjs';
import { createFilmTool } from './film-tool.mjs';
import { createLibraryTool } from './library-tool.mjs';
import { createGetTool } from './get-tool.mjs';
import { createClipTool } from './clip-tool.mjs';
import { createAssetsTool } from './assets-tool.mjs';
import { createExportTool } from './export-tool.mjs';
import { createCliTool } from './cli-tool.mjs';
import { createTranscribeTool } from './transcribe-tool.mjs';
import { createTranscribeService } from './transcribe-service.mjs';
import { refineTranscript } from './asr-refine.mjs';
import { resolveOfficialShell } from './official-shell.mjs';
import { openOfficialChatStore } from './official-chat-store.mjs';
import { createOfficialChatRpc } from './official-chat-rpc.mjs';
import { createOfficialEventHub } from './official-event-hub.mjs';
import { createOfficialApprovals } from './official-approvals.mjs';
import { createAcpAgentService } from './acp-agent-service.mjs';
import { createAcpSessionStore } from './acp-session-store.mjs';
import { ensureProjectInstructions } from './project-instructions.mjs';
import { createMcpEndpoint, createMcpTokens, mcpServerEntry } from './mcp-server.mjs';
import { attachOfficialEventStream } from './official-event-stream.mjs';
import { z } from 'zod';
import { realpath } from 'node:fs/promises';
import { registerTemplateBridge } from './template-bridge.mjs';
import { registerArchiveBridge } from './archive-bridge.mjs';
import { registerAuthBridge, dispatchAuthAction } from './auth-bridge.mjs';
import { createWorkbenchAuth, parseAuthActionBody } from './workbench-auth.mjs';
import { createLoginRememberStore } from './login-remember.mjs';
import { createArchiveWatcher } from './workspace-archive.mjs';
import { createPluginLog } from './plugin-log.mjs';
import { createBridgeTrace } from './bridge-trace.mjs';
import { openProjectPermissions, FULL_ACCESS, WORKSPACE_WRITE } from './official-permission.mjs';
import { createProjectFiles } from './project-files.mjs';

/**
 * Host-only route and Studio lifecycle. `createProxy` receives the private
 * upstream instance; only its key-free editor origin may reach the browser.
 * The proxy must enforce its own cookie, Host, Origin and WebSocket checks.
 * This is a localhost integration, not an OS or network sandbox.
 */
export function createStudioController(ctx, createProxy, { officialShell = false } = {}) {
  const log = createPluginLog();
  // What the bridge actually published to the panel, and what the page reported
  // receiving. Read through /diagnose; never exposed as user content.
  const bridgeTrace = createBridgeTrace();
  const openedAt = Date.now();
  if (!ctx?.connection || !ctx?.webServer || typeof createProxy !== 'function') throw new TypeError('Connection, webServer and proxy are required');
  if (typeof officialShell !== 'boolean') throw new TypeError('officialShell must be a boolean');
  const webOrigin = ctx.webServer.getOrigin();
  const origin = new URL(webOrigin);
  if (origin.protocol !== 'http:' || origin.hostname !== '127.0.0.1' || !origin.port || ctx.connection.allowsRemoteAuthorities) {
    throw new Error('OpenFilm integration requires a local HTTP DSH origin');
  }
  let upstream;
  let disposed = false;
  let lastHealthRunning;
  // The one live view of DSH's durable archive set. Optional: a profile without
  // the Workspace registry reports `available: false` instead of guessing.
  const archive = createArchiveWatcher(ctx);
  const workbenchAuth = createWorkbenchAuth({ dev: process.env.NO996_OPENFILM_DEV === '1' });
  const loginRemember = createLoginRememberStore();
  let permissionsPromise;
  let httpClient;
  let officialStorePromise;
  let lastProxy;
  let debugBridge;
  // The installer's resolved path wins over PATH so a downloaded or packaged
  // binary is what actually gets probed and, later, invoked.
  // A GUI launched from Finder or the Start menu does not inherit the shell's
  // PATH; without this a brew/WinGet ffmpeg is "already installed but missing".
  augmentPath();
  // The local-services list is native Studio data, but it lives inside the
  // installed openfilm package; re-apply our two data edits on every start so a
  // reinstall cannot silently drop SenseVoice.
  const studioPackageRoot = (() => {
    try { return fileURLToPath(new URL('.', import.meta.resolve('openfilm/package.json'))); } catch { return null; }
  })();
  const libraryPatch = applyStudioLibraryPatch({ packageRoot: studioPackageRoot, logger: log });
  if (libraryPatch.patched) log.info('studio-library-patch', libraryPatch);
  // The panel's `dsh --profile acp` child only knows the built-in providers, so
  // the person's own channels are copied there; without this the default model
  // is refused and the panel falls back to its own v4-flash.
  const providerSync = applyAcpModelProviders({ logger: log });
  if (providerSync.patched) log.info('acp-model-providers', providerSync);
  const toolInstaller = createToolInstaller({ home: process.env.DSH_HOME || join(homedir(), '.dsh') });
  const detectHostComponents = createHostComponentDetector({ resolve: name => toolInstaller.resolveAny(name)?.path ?? null });
  let componentCheck;
  // Write the preset activation result once per Host start so it can be checked
  // without a browser session (see preset-report.mjs).
  const presetReport = reportPresetStatus(ctx);
  // Prove which Host build is actually running, without a browser session.
  // Written on every controller construction, so a plugin reload overwrites it.
  void writeFile(join(tmpdir(), 'dsh-openfilm-host.json'), JSON.stringify({
    version: HOST_VERSION,
    pid: process.pid,
    startedAt: new Date().toISOString(),
    injected: true,
  }, null, 1), 'utf8').catch(() => { /* diagnostics only */ });
  presetReport.done.catch(() => {});
  // A stable address the person can type into the right-side browser without
  // opening the panel first. That browser does not share DSH's cookie, so DSH
  // routes answer 401 there; this listener serves the template console itself and
  // does the Studio work in the Host. Disable with NO996_OPENFILM_DEBUG_PORT=0.
  if (process.env.NO996_OPENFILM_DEBUG_PORT !== '0') {
    debugBridge = startLocalConsole({
      templates: () => listTemplates(templatesRoot),
      // The right-side browser has no DSH cookie, so /editor hands it a one-use
      // ticket instead of a cookie-gated URL. Minted in-process, never logged.
      // Desktop panel asks this before any Host bootstrap. Warm the Studio and
      // mint a ticket here — returning null just because warm finished late is
      // what produced `HTTP 503 @ dsh-app://app (console)` after login.
      editorUrl: async () => {
        if (disposed) return null;
        try {
          await runtime.ensureStarted();
          if (disposed || !upstream) return null;
          const proxy = await proxyFor(webOrigin);
          return proxy?.issueTicket?.()?.url ?? null;
        } catch { return null; }
      },
      // Desktop panel (`dsh-app://app`) cannot reach Host /api routes; auth goes
      // through this loopback console. Tokens stay on the Host.
      authHandler: async raw => {
        if (disposed) return { status: 503, body: { error: 'UNAVAILABLE' } };
        try {
          const value = parseAuthActionBody(raw);
          const result = await dispatchAuthAction(workbenchAuth, value);
          return { status: 200, body: result };
        } catch (error) {
          const status = Number(error?.status) || 400;
          return {
            status: status >= 100 && status <= 599 ? status : 400,
            body: {
              error: String(error?.code || 'AUTH'),
              message: String(error?.message || '请求失败').slice(0, 200),
            },
          };
        }
      },
    });
    debugBridge.catch(() => { debugBridge = undefined; });
  }
  const proxies = new Map();
  // Resolve project IDs against the active Studio, never a renderer path. The
  // store calls this on every operation so a removed project loses access.
  async function verifyOfficialProject(projectId) {
    const studio = upstream;
    if (disposed || !studio || !/^[A-Za-z0-9_-]{6,40}$/.test(projectId)) throw new Error('Project unavailable');
    const response = await fetch(new URL('/api/projects', studio.origin), {
      headers: { 'x-studio-key': studio.key, 'accept-encoding': 'identity' },
      redirect: 'error', signal: AbortSignal.timeout(10000),
    });
    if (!response.ok || Number(response.headers.get('content-length')) > 4 * 1024 * 1024) throw new Error('Project unavailable');
    const body = await response.text();
    if (Buffer.byteLength(body) > 4 * 1024 * 1024) throw new Error('Project unavailable');
    const data = JSON.parse(body);
    const project = Array.isArray(data?.projects) ? data.projects.find(item => item?.id === projectId && !item.missing) : null;
    if (!project || typeof project.path !== 'string') throw new Error('Project unavailable');
    const path = await realpath(project.path);
    if (disposed || upstream !== studio) throw new Error('Project unavailable');
    return { projectId, path };
  }
  // Transcript files: an inline picture is read from a project Studio still lists,
  // and a product is handed to the operating system instead of the browser. Both
  // resolve the project through verifyOfficialProject, so a stale ID opens nothing.
  const projectFiles = createProjectFiles({ resolveProject: verifyOfficialProject });
  const preferences = createPreferencesStore();
  const projectParentDir = async (proxy) => {
    const projects = await proxy.listProjects().catch(() => []);
    return projects.length ? dirname(projects[0].path) : join(homedir(), 'OpenFilm');
  };
  const createBlankOfficialProject = async (proxy) => {
    const parentDir = await projectParentDir(proxy);
    await mkdir(parentDir, { recursive: true });
    const target = join(parentDir, `自定义-${randomBytes(3).toString('hex')}`);
    await mkdir(target);
    const project = await proxy.createProject(target);
    if (!project || typeof project.id !== 'string' || typeof project.path !== 'string') {
      throw Object.assign(new Error('Studio returned an invalid project'), { code: 'TEMPLATE_REGISTRATION_UNCERTAIN' });
    }
    return { projectId: project.id, path: project.path };
  };
  const finishOnboardingProject = async (templateId, created, presets) => {
    const extra = {};
    if (presets && presets.ratio !== undefined) extra.customRatio = presets.ratio;
    if (presets && presets.seconds !== undefined) extra.customSeconds = Number(presets.seconds);
    if (presets && presets.language !== undefined) extra.customLanguage = presets.language;
    const prefs = await preferences.set({
      onboardingCompleted: true,
      defaultTemplateId: templateId,
      lastProjectId: created.projectId,
      ...extra,
    });
    return { ...created, prefs, onboarding: onboardingCopy(templateId, presets) };
  };
  const officialStore = () => {
    if (disposed) throw new Error('Studio disposed');
    if (!officialStorePromise) {
      officialStorePromise = openOfficialChatStore(ctx, { z, requireVerifiedProject: verifyOfficialProject });
      officialStorePromise.catch(() => { officialStorePromise = undefined; });
    }
    return officialStorePromise;
  };
  // Declared here, assigned once the ACP service is built below, so the host RPC
  // handlers can tell the two paths apart without reading a const before its
  // initialization (the bone this repo has broken twice).
  let acpAgentService = null;
  // A failure reason for the log, never a filesystem path (the log is shared).
  const safeDetail = error => String(error?.message ?? '').replace(/[A-Za-z]:[\\/][^\s"']*/g, '[path]').slice(0, 160);
  const officialRpc = async (channel, payload) => {
    if (disposed) throw new Error('Studio disposed');
    if (channel === 'agent:prompt') {
      if (!agentService) throw new Error('Agent bridge unavailable');
      return agentService.send(payload?.projectId, { key: payload?.key, turnId: payload?.turnId, text: payload?.text, images: payload?.images });
    }
    if (channel === 'agent:session') {
      // Read-only: never opens a Session just to answer a question about one.
      const projectId = typeof payload?.projectId === 'string' ? payload.projectId : '';
      if (!/^[A-Za-z0-9_-]{6,40}$/.test(projectId)) throw Object.assign(new Error('unknown project'), { code: 'PERMISSION_INPUT' });
      const state = agentService?.sessionState?.(projectId);
      return state ? { ok: true, ...state } : { ok: true, sessionId: null, resumed: false };
    }
    if (channel === 'agent:permission') {
      // What the panel needs to decide whether to ask: the decision remembered
      // for this project and the preset DSH itself reports as in force.
      const projectId = typeof payload?.projectId === 'string' ? payload.projectId : '';
      if (!/^[A-Za-z0-9_-]{6,40}$/.test(projectId)) throw Object.assign(new Error('unknown project'), { code: 'PERMISSION_INPUT' });
      // The proxy resolved this project for this very request. Repeat it as
      // defence in depth, but never let a second lookup cost the menu its row:
      // a vanished row is indistinguishable from "no permission" in the page.
      try { await verifyOfficialProject(projectId); }
      catch (error) { void log.warn('permission-project-unverified', { code: String(error?.code ?? error?.name ?? 'NONE').slice(0, 40), detail: safeDetail(error) }); }
      let store = null;
      try { store = await permissions(); }
      catch (error) { void log.warn('permission-store-failed', { code: String(error?.code ?? error?.name ?? 'NONE').slice(0, 40), detail: safeDetail(error) }); }
      const remembered = store ? store.remembered(projectId) ?? null : null;
      // The menu only draws the row when it has a value, so "no Session yet" (or
      // a Session that DSH reports nothing for) must not read as "no permission":
      // fall back to the decision and then to the default the bridge applies.
      const current = remembered ?? FULL_ACCESS;
      return {
        available: store ? store.available() : false, decided: remembered !== null, remembered, current,
        names: store ? store.names() : [], fullAccess: FULL_ACCESS, workspace: WORKSPACE_WRITE,
      };
    }
    if (channel === 'agent:permission-set') {
      const projectId = typeof payload?.projectId === 'string' ? payload.projectId : '';
      const preset = payload?.preset;
      if (!/^[A-Za-z0-9_-]{6,40}$/.test(projectId)) throw Object.assign(new Error('unknown project'), { code: 'PERMISSION_INPUT' });
      if (preset !== FULL_ACCESS && preset !== WORKSPACE_WRITE) throw Object.assign(new Error('unknown preset'), { code: 'PERMISSION_INPUT' });
      let store;
      try {
        await verifyOfficialProject(projectId);
        store = await permissions();
      } catch (error) {
        // A structured failure the page can show beats a bare 503: the row is
        // there, so the person who clicks it deserves a reason.
        void log.warn('permission-set-unavailable', { code: String(error?.code ?? error?.name ?? 'NONE').slice(0, 40), detail: safeDetail(error) });
        return { ok: false, preset: null, applied: false, error: String(error?.code ?? 'PERMISSION_STORE_UNAVAILABLE'), message: safeDetail(error) };
      }
      try {
        // The child cannot change its sandbox while running, so stop it: the next
        // turn spawns under the preset just chosen, read back from the decision.
        await acpAgentService?.reset?.(projectId);
        await store.decide(projectId, preset);
        return { ok: true, preset, applied: false };
      } catch (error) {
        return { ok: false, preset: null, applied: false, error: String(error?.code ?? 'PERMISSION_FAILED'), message: String(error?.message ?? '') };
      }
    }
    if (channel === 'agent:cancel') {
      if (!agentService) throw new Error('Agent bridge unavailable');
      return agentService.cancel(payload?.projectId);
    }
    if (channel === 'agent:trace') {
      // The page's own count of what it received. Counters only: no text, no
      // paths, no keys — this exists so `/diagnose` can say whether a published
      // envelope reached the panel, not to log what the model said.
      const projectId = typeof payload?.projectId === 'string' ? payload.projectId : '';
      if (!/^[A-Za-z0-9_-]{6,40}$/.test(projectId)) throw Object.assign(new Error('unknown project'), { code: 'TRACE_INPUT' });
      return { ok: bridgeTrace.panel(projectId, { seen: payload?.seen, kinds: payload?.kinds }) };
    }
    if (channel === 'client:log') {
      const event = typeof payload?.event === 'string' ? payload.event : '';
      if (!CLIENT_EVENTS.has(event)) throw Object.assign(new Error('unknown client event'), { code: 'CLIENT_EVENT_UNKNOWN' });
      log.info(`page-${event}`, { anchor: typeof payload?.anchor === 'string' ? payload.anchor.slice(0, 16) : undefined });
      return { ok: true };
    }
    if (channel === 'editor:link') {
      // One-use ticket for the local Studio page, minted only after the Host has
      // authenticated this call. Never cached, never logged.
      const proxy = await lastProxy;
      if (!proxy || typeof proxy.issueTicket !== 'function') throw Object.assign(new Error('Studio is not ready'), { code: 'EDITOR_LINK_UNAVAILABLE' });
      return proxy.issueTicket();
    }
    if (channel === 'environment:check') {
      if (!payload || typeof payload !== 'object' || Array.isArray(payload) || Object.keys(payload).length !== 0) {
        throw Object.assign(new Error('Invalid environment check'), { code: 'ENVIRONMENT_INPUT' });
      }
      // Coalesce simultaneous requests but always probe again after completion.
      if (!componentCheck) componentCheck = detectHostComponents().finally(() => { componentCheck = undefined; });
      return componentCheck;
    }
    if (
      channel === 'auth:status' || channel === 'auth:logout' || channel === 'auth:action' || channel === 'account:balance'
      || channel === 'auth:remember-get' || channel === 'auth:remember-set' || channel === 'auth:remember-clear'
    ) {
      // Login + account panel live inside the official shell. Tokens stay on Host.
      if (channel === 'auth:remember-get') {
        const remembered = await loginRemember.get();
        return {
          enabled: remembered.enabled === true && Boolean(remembered.account),
          account: remembered.account || '',
          // Password only for autofill on this machine's login form; never log it.
          password: remembered.enabled ? (remembered.password || '') : '',
        };
      }
      if (channel === 'auth:remember-set') {
        const body = payload && typeof payload === 'object' ? payload : {};
        if (body.enabled === false || body.clear === true) return loginRemember.clear();
        await loginRemember.set({
          account: body.account,
          password: body.password,
          enabled: body.enabled !== false,
        });
        return { ok: true, enabled: true, account: String(body.account || '').trim().slice(0, 160) };
      }
      if (channel === 'auth:remember-clear') {
        return loginRemember.clear();
      }
      if (channel === 'auth:status') {
        const status = await workbenchAuth.status();
        const wallet = balanceFromPrefs(await preferences.get());
        return {
          loggedIn: status.loggedIn === true,
          dev: status.dev === true,
          account: typeof status.account === 'string' ? status.account : '',
          displayName: typeof status.displayName === 'string' ? status.displayName : '',
          // Chip uses cached available points (permanent + period). Fresh pull is account:balance.
          credits: wallet.available_points,
          balance: wallet,
        };
      }
      if (channel === 'account:balance') {
        const refresh = !(payload && typeof payload === 'object' && payload.refresh === false);
        const cached = balanceFromPrefs(await preferences.get());
        if (!refresh) return { ...cached, stale: false, source: 'cache' };
        if (workbenchAuth.dev) {
          const live = await workbenchAuth.balance();
          await preferences.set(balanceCachePatch(live));
          return { ...balanceFromPrefs(await preferences.get()), stale: false, source: 'dev', dev: true };
        }
        try {
          const live = await workbenchAuth.balance();
          await preferences.set(balanceCachePatch(live));
          return { ...balanceFromPrefs(await preferences.get()), stale: false, source: 'live' };
        } catch (error) {
          return {
            ...cached,
            stale: true,
            source: cached.cached_at ? 'cache' : 'none',
            error: String(error?.code || 'BALANCE'),
            message: String(error?.message || '积分暂不可用').slice(0, 200),
          };
        }
      }
      if (channel === 'auth:logout') {
        // A dev session has nothing to log out of; clearing it would only bounce
        // the person back to a gate that accepts nothing.
        if (workbenchAuth.dev) return { loggedIn: true, dev: true };
        await workbenchAuth.logout();
        await preferences.set(clearBalanceCachePatch());
        return { loggedIn: false };
      }
      if (workbenchAuth.dev) return { ok: true, dev: true };
      const action = payload && typeof payload === 'object' ? payload : {};
      try {
        return await dispatchAuthAction(workbenchAuth, action);
      } catch (error) {
        // Page needs the workbench message, not a bare 503. Tokens never leave Host.
        return {
          ok: false,
          error: String(error?.code || 'AUTH'),
          message: String(error?.message || '请求失败').slice(0, 200),
          ...(error?.details && typeof error.details === 'object' ? { details: error.details } : {}),
        };
      }
    }
    if (channel === 'system:check') return systemSnapshot();
    if (channel === 'system:install') {
      const tool = payload && typeof payload === 'object' && typeof payload.tool === 'string' ? payload.tool : 'all';
      startSystemInstall(tool);
      return systemSnapshot();
    }
    if (channel === 'asr:status' || channel === 'asr:install') {
      // Same service as /api/no996-openfilm/asr, exposed over the one bridge the
      // overlays are allowed to use. Install starts once and joins the download.
      const state = await transcribeService.status();
      if (channel === 'asr:install' && !state.ready) void transcribeService.setup().catch(() => undefined);
      return {
        ready: state.ready, dir: state.dir, bytesTotal: state.bytesTotal, bytesOnDisk: state.bytesOnDisk,
        progress: state.progress, installing: state.installing || (channel === 'asr:install' && !state.ready),
        engine: state.engine,
      };
    }
    if (channel === 'prefs:get') {
      return { prefs: await preferences.get() };
    }
    if (channel === 'prefs:set') {
      const prefs = await preferences.set(payload && typeof payload === 'object' ? payload : {});
      return { prefs };
    }
    if (channel === 'template:list') {
      const templates = await listTemplates(templatesRoot);
      const prefs = await preferences.get();
      const cards = templates.map((item) => {
        const meta = productMeta(item.id);
        return meta ? { ...item, ...meta } : item;
      });
      const custom = productMeta('custom');
      cards.push({
        id: 'custom',
        title: custom.productTitle,
        description: custom.productBlurb,
        mode: 'blank',
        entry: '',
        prompt: '',
        ...custom,
      });
      return { templates: cards, prefs };
    }
    if (channel === 'template:create' || channel === 'project:create-blank') {
      const proxy = await lastProxy;
      if (!proxy || typeof proxy.createProject !== 'function') throw Object.assign(new Error('Studio is not ready'), { code: 'TEMPLATE_UNAVAILABLE' });
      const templateId = channel === 'project:create-blank' ? 'custom' : payload?.templateId;
      if (templateId === 'custom') {
        const presets = payload && typeof payload === 'object'
          ? { ratio: payload.ratio, seconds: payload.seconds, language: payload.language }
          : undefined;
        return finishOnboardingProject('custom', await createBlankOfficialProject(proxy), presets);
      }
      const chosen = (await listTemplates(templatesRoot)).find(item => item.id === templateId);
      if (!chosen) throw Object.assign(new Error('Unknown template'), { code: 'TEMPLATE_INPUT' });
      // New films live beside the user's existing ones; with no project yet, a
      // folder under the home directory keeps the same one-project-one-folder shape.
      const parentDir = await projectParentDir(proxy);
      const created = await installTemplate({
        root: templatesRoot,
        id: chosen.id,
        parentDir,
        createProject: target => proxy.createProject(target),
        titleFor: () => chosen.title,
      });
      return { ...(await finishOnboardingProject(chosen.id, created)), prompt: chosen.prompt };
    }
    // chat:load/save and the archive channels share the same Host-side state:
    // an archived project withholds history and refuses writes, and both
    // surfaces (DSH sidebar, this panel) mutate the same durable set.
    return createOfficialChatRpc(await officialStore(), agentService, {
      state: archiveState,
      archive: async projectId => { const current = await archiveState(projectId); await archive.archive(current.sessionId, { stopActivity: true }); },
      unarchive: async projectId => { const current = await archiveState(projectId); await archive.unarchive(current.sessionId); },
      // The trace tab's reading: what this turn called and what came back.
      turnLog: turnLogOf,
      // A degraded optional surface (the thinking menu) says why here instead of
      // raising a 503 the person has to read.
      log: (event, fields) => { void log.info(event, fields); },
    })(channel, payload);
  };
  // Stage 1 trust model: the editor origin is the official OpenFilm window for
  // this local DSH user (the same trust upstream's desktop app gives its own
  // window). A project ID is still checked against Studio's live project list,
  // so a stale or invented ID is refused. Cross-project reading inside that
  // trusted window matches upstream, not a new privilege; a signed per-frame
  // scope can replace this later without changing the page.
  const authorizeOfficialProject = async (_req, projectId) => {
    try { await verifyOfficialProject(projectId); return true; } catch { return false; }
  };
  // Session permission for a project's conversation. Resolved lazily: a page
  // that never opens a project never touches the permission domain.
  const permissions = () => {
    if (!permissionsPromise) {
      permissionsPromise = openProjectPermissions(ctx, { z, onFailure: (event, fields) => { void log.warn(event, fields); } });
      permissionsPromise.catch(error => {
        void log.warn('permission-store-open-failed', { code: String(error?.code ?? error?.name ?? 'NONE').slice(0, 40), detail: safeDetail(error) });
        permissionsPromise = undefined;
      });
    }
    return permissionsPromise;
  };
  const acpSessions = createAcpSessionStore({ file: join(process.env.DSH_HOME || join(homedir(), '.dsh'), 'no996-openfilm', 'acp-sessions.json') });
  // Archive state of a project's bound conversation. Always resolved in the
  // Host: the page supplies a project ID and never a Session ID. This never
  // creates a Session — reading chat history must not have that side effect.
  const archiveState = async projectId => {
    await verifyOfficialProject(projectId);
    // The child owns the Session; this Host only knows the id it recorded when the
    // child created it, and that id is what the archive set is asked about.
    const acp = acpSessions.get(projectId);
    if (!acp || typeof acp.sessionId !== 'string') return { sessionId: null, archived: false, available: archive.available };
    return { sessionId: acp.sessionId, archived: archive.isArchived(acp.sessionId) === true, available: archive.available };
  };
  // The project's folder is also its conversation's workspace; a live watcher
  // keeps Windows from moving it to the Recycle Bin. Stop that conversation
  // first. Best effort: a missing registry must not block the delete itself.
  const beforeProjectDelete = async projectId => {
    // The ACP child is standing in this folder; close it before the folder goes.
    try { await acpAgentService?.reset?.(projectId); } catch { /* the delete still has to run */ }
    try {
      const current = await archiveState(projectId);
      if (current.sessionId && !current.archived) await archive.archive(current.sessionId, { stopActivity: true });
    } catch { /* the delete still has to run */ }
  };
  // The ACP child is a different process, so its film-tool calls arrive over MCP.
  // These records are the only synthetic agents in the Host: minted here, checked
  // here, and resolved by the same `projectOfAgent` every tool already uses.
  const mcpTokens = createMcpTokens({ randomBytes });
  const mcpAgents = new Map();
  const mcpAgentFor = (projectId, path) => ({ id: `mcp:${projectId}`, path, projectId });
  // Only the ACP child's synthetic MCP record grants tool visibility.
  const isProjectAgent = agent => Boolean(agent && !disposed && mcpAgents.get(agent.id) === agent);
  // One project-scoped event fan-out feeds the official chat's stream.
  const eventHub = createOfficialEventHub();
  // Every envelope that goes to the panel is also kept, per project and turn, as
  // the trace tab's reading: the tab renders one line per event, so what the turn
  // called (tool name, arguments, result) is finally visible instead of only the
  // chat's three-word action rows. Bounded: a long turn keeps its last events.
  const TURN_LOG_TURNS = 4;
  const TURN_LOG_EVENTS = 2000;
  const turnLogs = new Map();
  const recordTurnEvent = (projectId, event) => {
    if (typeof projectId !== 'string' || !projectId || !event || typeof event !== 'object') return;
    const turnId = typeof event.key === 'string' ? event.key : '';
    if (!turnId) return;
    const update = event.update && typeof event.update === 'object' ? event.update : {};
    let turns = turnLogs.get(projectId);
    if (!turns) turnLogs.set(projectId, turns = new Map());
    let events = turns.get(turnId);
    if (!events) {
      turns.set(turnId, events = []);
      while (turns.size > TURN_LOG_TURNS) turns.delete(turns.keys().next().value);
    }
    const kind = typeof update.sessionUpdate === 'string' ? update.sessionUpdate
      : event.kind === 'done' ? 'done' : 'update';
    events.push({ t: Date.now(), kind, ...update });
    if (events.length > TURN_LOG_EVENTS) events.splice(0, events.length - TURN_LOG_EVENTS);
    while (turnLogs.size > 8) turnLogs.delete(turnLogs.keys().next().value);
  };
  const turnLogOf = (projectId, turnId) => {
    const events = turnLogs.get(projectId)?.get(turnId);
    if (!events) return null;
    // `whole` says these events are the log's, so the viewer replaces rather than appends.
    return { file: 'dsh-turn', cut: false, whole: true, events: [...events], calls: [], callsWhole: true, callsCut: false, at: { events: events.length, calls: 0, callsFile: 0 } };
  };
  // Approval questions travel the same stream as transcript updates. `publish`
  // reports whether a live transport accepted the write, which is exactly the
  // coordinator's delivery contract (acceptance, not proof of rendering).
  const deliverToPanel = (projectId, event) => {
    const delivered = eventHub.publish(projectId, event);
    bridgeTrace.emit(projectId, event, delivered);
    recordTurnEvent(projectId, event);
    return delivered;
  };
  const approvals = createOfficialApprovals({ deliver: deliverToPanel });
  // The panel's conversation is an ACP child. The agent owns the Session, so the
  // panel and the sidebar share one conversation and the shell's own ACP surface
  // (thinking, tools, resume, model menu) is exactly what the page draws.
  acpAgentService = createAcpAgentService({
    verifier: verifyOfficialProject,
    store: acpSessions,
    emit: async (projectId, event) => deliverToPanel(projectId, event),
    approvals,
    // The panel starts on the model the person already chose for DSH, not on the
    // acp profile's own default.
    defaultSelection: () => { try { return ctx.agentDefaultModel?.currentSelection?.(); } catch { return undefined; } },
    // The panel's permission row is the child's sandbox too: DSH reads the mode
    // from the environment at boot, so the child is spawned with the preset the
    // person chose here.
    // The acp profile boots with its own model, and the ACP bridge decides
    // "may this session carry images?" from it at initialize. Overlay the
    // person's current DSH model so a vision route is not silently downgraded
    // to a text-only one before the first turn.
    spawnArgs: async () => {
      try {
        const selection = ctx.agentDefaultModel?.currentSelection?.();
        const provider = typeof selection?.provider === 'string' ? selection.provider : '';
        const model = typeof selection?.model === 'string' ? selection.model : '';
        if (!provider || !model) return [];
        const safe = value => value.replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 60);
        const file = join(tmpdir(), `dsh-openfilm-acp-${safe(provider)}-${safe(model)}.yml`);
        await writeFile(file, `- id: acp\n  config:\n    provider: ${JSON.stringify(provider)}\n    model: ${JSON.stringify(model)}\n`, 'utf8');
        return ['--patch', file];
      } catch { return []; }
    },
    permissionMode: async projectId => {
      // A project with no recorded decision starts the way the bridge always
      // started: full access. The menu's own default must not disagree with the
      // sandbox the child actually boots with.
      try {
        const store = await permissions();
        return store?.remembered?.(projectId) ?? store?.defaultPreset?.() ?? 'danger-full-access';
      } catch { return undefined; }
    },
    // A fresh child gets a fresh bearer token for this Host's MCP endpoint, so
    // the film tools travel with the conversation (they live here, not there).
    mcpServers: async (projectId, projectPath) => {
      const agent = mcpAgentFor(projectId, projectPath);
      mcpAgents.set(agent.id, agent);
      const token = mcpTokens.mint({ projectId, path: projectPath, agent });
      return [mcpServerEntry({ url: `${webOrigin}/api/no996-openfilm/mcp`, token })];
    },
    // The ACP profile has no OpenFilm preset, but its agent reads AGENTS.md from
    // the workspace — which is the project folder. Written once, never overwritten.
    prepareProject: async (projectId, projectPath) => {
      const result = ensureProjectInstructions({ root: projectPath });
      if (result.created) void log.info('project-instructions', { projectId });
    },
    onClosed: projectId => {
      mcpTokens.revokeProject(projectId);
      mcpAgents.delete(`mcp:${projectId}`);
    },
    log: (event, fields) => void log.info(event, fields),
  });
  // The panel's conversation is the ACP child; nothing is created for a host that
  // has no official shell to drive.
  const agentService = officialShell ? acpAgentService : null;
  const guideTool = createGuideTool(isProjectAgent);
  const unregisterGuide = ctx.tools.register(guideTool, { when: ({ agent }) => isProjectAgent(agent) });
  // One Studio client for every project tool: it resolves the live upstream, adds
  // the key the page must never see, and turns a failure into readable text.
  const studioHttp = () => {
    if (!httpClient) {
      httpClient = createStudioHttp({
        studio: async () => {
          // A closed panel is not a reason to refuse: starting Studio here is what
          // the panel would have done, and it is the same process.
          try { await runtime.ensureStarted(); } catch { /* fall through: the tool reports it */ }
          return upstream ? { origin: upstream.origin, key: upstream.key } : undefined;
        },
      });
    }
    return httpClient;
  };
  // Studio shows its own "what's new" dialog once after every version bump, which
  // for a bundled Studio means every time this plugin upgrades. The dialog is
  // gated by `prefs.seenVersion` (components/WhatsNew.tsx: it shows only when the
  // saved version is older than the running one), so keeping that value ahead of
  // any release retires the dialog without touching the page.
  const WHATS_NEW_SEEN = '9999.0.0';
  let whatsNewSettled = false;
  const suppressWhatsNew = async () => {
    if (whatsNewSettled || disposed) return;
    try {
      const client = studioHttp();
      const prefs = await client.get('/api/prefs');
      if (!prefs || typeof prefs !== 'object') return;
      whatsNewSettled = true;
      if (prefs.seenVersion === WHATS_NEW_SEEN) return;
      await client.patch('/api/prefs', { body: { seenVersion: WHATS_NEW_SEEN } });
      log.info('whats-new-suppressed', { from: typeof prefs.seenVersion === 'string' ? prefs.seenVersion : null });
    } catch { /* prefs are a convenience: the dialog is not worth failing a turn over */ }
  };
  // The project an agent may edit, resolved from the Host's own record. Never from
  // a renderer-supplied id.
  const projectOfAgent = agent => (mcpAgents.get(agent?.id) === agent ? { projectId: agent.projectId, path: agent.path, available: true } : undefined);
  const filmTools = [
    createFrameTool({ isProjectAgent, projectOf: projectOfAgent, http: studioHttp, attachments: () => ctx.get('attachments'), llm: ctx.llm }),
    createFilmTool({ isProjectAgent, projectOf: projectOfAgent, http: studioHttp }),
    createLibraryTool({ isProjectAgent, projectOf: projectOfAgent, http: studioHttp }),
    createGetTool({ isProjectAgent, projectOf: projectOfAgent, http: studioHttp }),
    createClipTool({ isProjectAgent, projectOf: projectOfAgent }),
    createAssetsTool({ isProjectAgent, projectOf: projectOfAgent, http: studioHttp }),
    createExportTool({ isProjectAgent, projectOf: projectOfAgent, http: studioHttp }),
    createCliTool({ isProjectAgent, projectOf: projectOfAgent }),
  ];
  const unregisterFilmTools = filmTools.map(tool => ctx.tools.register(tool, { when: ({ agent }) => isProjectAgent(agent) }));
  // Hydration is intentionally lazy: nothing claims a persisted Session on
  // startup. Opening a project in the video panel resolves or creates its
  // conversation, so a missing hint can never block the UI.
  const askAgent = createDshAskAgent({ llm: ctx.llm, agentDefaultModel: ctx.agentDefaultModel });

  // Local transcription. The engine that hears runs on this CPU; the model that
  // polishes product names is the session's. Registered here rather than with the
  // other tools because that polish pass needs askAgent, which is built above the
  // Studio runtime and below the tool list.
  const transcribeService = createTranscribeService({ logger: log });
  const transcribeTool = createTranscribeTool({
    isProjectAgent,
    projectOf: projectOfAgent,
    service: transcribeService,
    refine: ({ segments, signal }) => refineTranscript({ ask: askAgent, segments, signal }),
  });
  const unregisterTranscribe = ctx.tools.register(transcribeTool, { when: ({ agent }) => isProjectAgent(agent) });
  // The install path the panel can use without a chat turn: a fresh machine needs
  // 228 MB of weights, and the person should be able to start that from the UI.
  // The film tools, for the ACP child. No cookie admission: the caller is the
  // child process and proves itself with the per-Session bearer token above.
  const mcpEndpoint = createMcpEndpoint({
    tools: [guideTool, ...filmTools, transcribeTool],
    resolveToken: token => mcpTokens.resolve(token),
    log: (event, fields) => void log.info(event, fields),
  });
  const unregisterTranscribeRoute = registerRoute({
    kind: 'exact', path: '/api/no996-openfilm/asr',
    async handler(req, res) {
      res.setHeader('cache-control', 'no-store');
      res.setHeader('content-type', 'application/json; charset=utf-8');
      if (req.method !== 'POST') { res.writeHead(405, { allow: 'POST' }).end('{}'); return; }
      const admission = ctx.connection.admit({ headers: req.headers });
      if ('rejection' in admission || admission.peer.id !== ctx.connection.browserPeer.id) { res.writeHead(403).end('{}'); return; }
      let action = 'status';
      try {
        const chunks = [];
        for await (const chunk of req) { chunks.push(chunk); if (Buffer.concat(chunks).byteLength > 4096) break; }
        const parsed = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
        if (parsed?.action === 'install') action = 'install';
      } catch { /* a body we cannot read is a status request */ }
      try {
        const state = await transcribeService.status();
        if (action === 'install' && !state.ready) void transcribeService.setup().catch(() => undefined);
        res.writeHead(200).end(JSON.stringify({
          ready: state.ready, dir: state.dir, bytesTotal: state.bytesTotal,
          bytesOnDisk: state.bytesOnDisk, progress: state.progress,
          installing: state.installing || (action === 'install' && !state.ready), engine: state.engine,
        }));
      } catch (error) {
        res.writeHead(500).end(JSON.stringify({ error: String(error?.message || error).slice(0, 200) }));
      }
    },
  });
  // One view for the wizard: what is installed, what is downloading, what is
  // already usable. The detector answers "can it run"; the installer answers
  // "is something arriving and what went wrong".
  const systemSnapshot = async () => {
    const [components, installer, asrState] = await Promise.all([
      detectHostComponents(),
      toolInstaller.snapshot(),
      transcribeService.status().catch(() => ({ ready: false })),
    ]);
    const asr = {
      ready: asrState.ready === true,
      bytesTotal: Number(asrState.bytesTotal) || 0,
      bytesOnDisk: Number(asrState.bytesOnDisk) || 0,
      progress: Number(asrState.progress) || 0,
      installing: asrState.installing === true,
      engine: typeof asrState.engine === 'string' ? asrState.engine : '',
      phase: typeof asrState.phase === 'string' ? asrState.phase : '',
      source: typeof asrState.source === 'string' ? asrState.source : '',
      speed: Number(asrState.speed) || 0,
      error: typeof asrState.error === 'string' ? asrState.error : '',
    };
    return {
      platform: components.platform,
      tools: components.tools,
      installer,
      asr,
      ready: components.tools.ffmpeg.status === 'ok' && components.tools.ffprobe.status === 'ok' && asr.ready,
    };
  };
  const startSystemInstall = tool => {
    if (tool === 'asr') { void transcribeService.setup().catch(() => undefined); return; }
    const wanted = tool === 'ffmpeg' || tool === 'ffprobe' ? [tool] : ['ffmpeg', 'ffprobe'];
    for (const item of wanted) void toolInstaller.install(item).catch(() => undefined);
  };
  const unregisterSystemCheck = registerRoute({
    kind: 'exact', path: '/api/no996-openfilm/system/check',
    async handler(req, res) {
      res.setHeader('cache-control', 'no-store');
      res.setHeader('content-type', 'application/json; charset=utf-8');
      if (req.method !== 'POST') { res.writeHead(405, { allow: 'POST' }).end('{}'); return; }
      const admission = ctx.connection.admit({ headers: req.headers });
      if ('rejection' in admission || admission.peer.id !== ctx.connection.browserPeer.id) { res.writeHead(403).end('{}'); return; }
      try { res.writeHead(200).end(JSON.stringify(await systemSnapshot())); }
      catch (error) { res.writeHead(500).end(JSON.stringify({ error: String(error?.message || error).slice(0, 200) })); }
    },
  });
  const unregisterSystemInstall = registerRoute({
    kind: 'exact', path: '/api/no996-openfilm/system/install',
    async handler(req, res) {
      res.setHeader('cache-control', 'no-store');
      res.setHeader('content-type', 'application/json; charset=utf-8');
      if (req.method !== 'POST') { res.writeHead(405, { allow: 'POST' }).end('{}'); return; }
      const admission = ctx.connection.admit({ headers: req.headers });
      if ('rejection' in admission || admission.peer.id !== ctx.connection.browserPeer.id) { res.writeHead(403).end('{}'); return; }
      let tool = 'all';
      try {
        const chunks = [];
        for await (const chunk of req) { chunks.push(chunk); if (Buffer.concat(chunks).byteLength > 4096) break; }
        const parsed = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
        if (typeof parsed?.tool === 'string') tool = parsed.tool;
      } catch { /* an unreadable body installs everything */ }
      try { startSystemInstall(tool); res.writeHead(200).end(JSON.stringify(await systemSnapshot())); }
      catch (error) { res.writeHead(500).end(JSON.stringify({ error: String(error?.message || error).slice(0, 200) })); }
    },
  });
  const runtime = createStudioRuntime({ askAgent, ...(officialShell ? { resolveEditorDir: resolveOfficialShell } : {}), attach: async studio => {
    upstream = studio;
    return async () => {
      upstream = undefined;
      const pending = [...proxies.values()];
      proxies.clear();
      const settled = await Promise.allSettled(pending);
      await Promise.all(settled.filter(item => item.status === 'fulfilled').map(item => item.value.close()));
    };
  } });
  const attachOfficialEvents = ({ projectId, res }) => {
    if (disposed) { res.destroy(); return; }
    attachOfficialEventStream({ hub: eventHub, projectId, response: res });
  };
  function proxyFor(browserOrigin, desktop = false) {
    const existing = proxies.get(browserOrigin);
    if (existing) return existing;
    const browser = new URL(browserOrigin);
    // The proxy validates its own Host and Origin before this callback. DSH's
    // cookie is bound to the browser's actual authority, not the bind address.
    const authenticateBrowser = req => {
      if (disposed) return false;
      const headers = { ...req.headers, host: browser.host, origin: browserOrigin };
      const admission = ctx.connection.admit({ headers });
      return !('rejection' in admission) && admission.peer.id === ctx.connection.browserPeer.id;
    };
    const pending = Promise.resolve().then(() => createProxy({ upstream, webOrigin: browserOrigin, authenticateBrowser, desktop, officialShell, log, beforeProjectDelete, ...(officialShell ? { officialRpc, authorizeOfficialProject, attachOfficialEvents, readProjectFile: projectFiles.read, openProjectFile: projectFiles.open } : {}) })).then(async next => {
      if (!next || typeof next.bootstrap !== 'function' || typeof next.close !== 'function' || typeof next.editorOrigin !== 'string' || disposed) {
        await next?.close?.();
        throw new Error('Studio proxy is unavailable');
      }
      return next;
    });
    proxies.set(browserOrigin, pending);
    lastProxy = pending;
    pending.catch(() => { if (proxies.get(browserOrigin) === pending) proxies.delete(browserOrigin); });
    return pending;
  }
  // DSH webServer.register accepts ONE route and throws on duplicate path. If
  // setup fails after a route is mounted, Cordis never gets a disposer and the
  // path leaks — the next enable then fails with "duplicate exact route".
  // Registering the same exact path twice throws inside the web registry; a
  // management toggle can re-run this block in a Host that already has it, and a
  // throw here would mark the whole plugin as failed to activate. Declared as a
  // function so the routes registered earlier in this body can call it.
  function registerRoute(route) {
    try { return ctx.webServer.register(route); } catch (error) {
      void log.warn('route-already-mounted', { path: route?.path, detail: String(error?.message ?? error).slice(0, 160) });
      return () => {};
    }
  }
  // Track every route disposer and roll back on throw; dispose sync-unregisters
  // routes before any await so a re-enable cannot race a leftover path.
  const routeDisposers = [];
  const trackRoute = dispose => {
    routeDisposers.push(dispose);
    return dispose;
  };
  const rollbackRoutes = () => {
    while (routeDisposers.length) {
      try { routeDisposers.pop()(); } catch { /* already gone */ }
    }
  };
  let unregisterTemplateBridge;
  let unregisterAuthBridge;
  let unregisterArchiveBridge;
  let unregister;
  let unregisterAttachment;
  let unregisterClientLog;
  let unregisterBootstrap;
  let unregisterEditingSessions;
  let unregisterStandalone;
  let unregisterTemplatesPage;
  let unregisterDebugUrl;
  let unregisterMcp;
  try {
  unregisterTemplateBridge = trackRoute(registerTemplateBridge(ctx, {
    webOrigin,
    list: () => listTemplates(templatesRoot),
    create: templateId => officialRpc('template:create', { templateId }),
    isDisposed: () => disposed,
  }));
  unregisterAuthBridge = trackRoute(registerAuthBridge(ctx, {
    webOrigin,
    auth: workbenchAuth,
    isDisposed: () => disposed,
  }));
  unregisterArchiveBridge = trackRoute(registerArchiveBridge(ctx, {
    webOrigin,
    state: archiveState,
    archive: async projectId => {
      const current = await archiveState(projectId);
      if (!current.sessionId) return current; // nothing bound yet, nothing to hide
      await archive.archive(current.sessionId, { stopActivity: true });
      return { sessionId: current.sessionId, archived: true, available: archive.available };
    },
    unarchive: async projectId => {
      const current = await archiveState(projectId);
      if (!current.sessionId) return current;
      await archive.unarchive(current.sessionId);
      return { sessionId: current.sessionId, archived: false, available: archive.available };
    },
    // Under ACP there is no Host-side binding to repair: forgetting the recorded
    // Session makes the next turn open a fresh one in the (possibly moved) folder.
    rebind: async projectId => {
      await verifyOfficialProject(projectId);
      acpSessions.remove(projectId);
      await acpAgentService?.reset?.(projectId);
      return { sessionId: null, archived: false, available: archive.available };
    },
    isDisposed: () => disposed,
  }));
  unregister = trackRoute(registerRoute({
    kind: 'exact', path: '/api/no996-openfilm/diagnose',
    async handler(req, res) {
      res.setHeader('cache-control', 'no-store');
      if (req.method !== 'POST') { res.writeHead(405, { allow: 'POST' }).end(); return; }
      const admission = ctx.connection.admit({ headers: req.headers });
      if ('rejection' in admission || admission.peer.id !== ctx.connection.browserPeer.id) { res.writeHead(403).end('{}'); return; }
      const proxy = await lastProxy?.catch(() => undefined);
      // Which project the page is asking about, if it named one. Both the turn
      // record and the grouping state are per project.
      const diagnoseProject = await (async () => {
        try {
          const chunks = [];
          for await (const chunk of req) { chunks.push(chunk); if (Buffer.concat(chunks).byteLength > 4096) return ''; }
          const parsed = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
          const id = typeof parsed?.projectId === 'string' ? parsed.projectId : '';
          return /^[A-Za-z0-9_-]{6,40}$/.test(id) ? id : '';
        } catch { return ''; }
      })();
      // Whether the video-editing preset actually activated, not just whether its
      // row exists: the roster carries each preset's activation diagnostic.
      let preset = null;
      try {
        const registry = ctx.get?.('agentPresets');
        const roster = typeof registry?.list === 'function' ? await registry.list() : [];
        const found = roster.find(item => item?.id === 'openfilm-video-editing');
        preset = found ? { id: 'openfilm-video-editing', ok: !found.error && !found.failure, detail: String(found.error ?? found.failure ?? 'ok').slice(0, 200) } : { id: 'openfilm-video-editing', ok: false, detail: 'not registered' };
      } catch (error) { preset = { id: 'openfilm-video-editing', ok: false, detail: String(error?.message || error).slice(0, 200) }; }
      const studio = await runtime.health();
      if (studio.running !== lastHealthRunning) {
        log.info('studio-health', { running: studio.running });
        lastHealthRunning = studio.running;
      }
      const body = JSON.stringify({
        mode: officialShell ? 'official' : 'dsh',
        studio,
        preset,
        proxy: proxy?.diagnostics?.() ?? null,
        // Whether this Host can see DSH's archive set, and how many Sessions it
        // currently hides. A zero count on an available watcher means "none".
        archive: { available: archive.available, archivedCount: archive.archivedIds().length },
        // The three-link evidence for "the panel shows nothing": what the bridge
        // published, whether a live stream took it, and what the page counted.
        bridge: bridgeTrace.snapshot(),
        // Whether this build can switch a Session's permission at all, and what it
        // offers — the first thing to check when the consent card stays silent.
        permission: await (async () => {
          try {
            const store = await permissions();
            return { available: store.available(), names: store.names() };
          } catch (error) { return { available: false, error: String(error?.code ?? 'PERMISSION_UNAVAILABLE') }; }
        })(),
        // Per-turn evidence for "the panel shows nothing": frames received, updates
        // emitted, and which frames died in translation. Without this, exhausted
        // agent output and dropped events look identical.
        turns: agentService ? agentService.diagnose(diagnoseProject) : null,
        // Whether the conversation is really grouped under the project's folder.
        grouping: 'acp',
        // The last few events, so a support message can carry the history that
        // explains the symptom without asking for a file path.
        log: { file: log.file, tail: log.tail(12) },
      });
      res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'content-length': Buffer.byteLength(body) }).end(body);
    },
  }));
  // A picture the agent made, served to the panel that shows it.
  //
  // The frame tool stores what Studio drew as a DSH attachment (`sha256:<hex>` under
  // <DSH_HOME>/attachments/v1/objects). The chat transcript then points at it with
  // `![](/api/no996-openfilm/attachment?id=<hex>)`, which is this route: the panel's own origin,
  // a validated 64-hex id, and a path that cannot leave the object store.
  unregisterAttachment = trackRoute(registerRoute({
    kind: 'exact', path: '/api/no996-openfilm/attachment',
    async handler(req, res) {
      res.setHeader('cache-control', 'private, max-age=600');
      if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405, { allow: 'GET, HEAD' }).end(); return; }
      const admission = ctx.connection.admit({ headers: req.headers });
      if ('rejection' in admission || admission.peer.id !== ctx.connection.browserPeer.id) { res.writeHead(403).end(); return; }
      const raw = String(new URL(req.url ?? '/', 'http://localhost').searchParams.get('id') ?? '').trim().toLowerCase();
      const id = raw.replace(/^sha256:/, '');
      if (!/^[a-f0-9]{64}$/.test(id)) { res.writeHead(400, { 'content-type': 'text/plain' }).end('bad attachment id'); return; }
      const home = process.env.DSH_HOME || join(homedir(), '.dsh');
      const file = join(home, 'attachments', 'v1', 'objects', id.slice(0, 2), id);
      let bytes;
      try { bytes = await readFile(file); } catch { res.writeHead(404, { 'content-type': 'text/plain' }).end('not found'); return; }
      const type = bytes[0] === 0x89 && bytes[1] === 0x50 ? 'image/png'
        : bytes[0] === 0xff && bytes[1] === 0xd8 ? 'image/jpeg'
        : bytes.subarray(0, 4).toString('latin1') === 'RIFF' ? 'image/webp' : 'application/octet-stream';
      res.writeHead(200, { 'content-type': type, 'content-length': bytes.byteLength }).end(req.method === 'HEAD' ? undefined : bytes);
    },
  }));
  // Page-side events worth keeping when a person reports "it broke": the
  // recovery card appeared, the button was pressed. Enum-only, 512 bytes, and
  // only from the authenticated DSH browser — this is not a general log sink.
  // DSH register() takes one route only; client-log and bootstrap must be separate.
  unregisterClientLog = trackRoute(registerRoute({
    kind: 'exact', path: '/api/no996-openfilm/client-log',
    async handler(req, res) {
      res.setHeader('cache-control', 'no-store');
      if (req.method !== 'POST') { res.writeHead(405, { allow: 'POST' }).end(); return; }
      const admission = ctx.connection.admit({ headers: req.headers });
      if ('rejection' in admission || admission.peer.id !== ctx.connection.browserPeer.id) { res.writeHead(403).end(); return; }
      const chunks = [];
      let size = 0;
      const finish = (status) => { if (!res.writableEnded) res.writeHead(status).end(); };
      req.on('data', (chunk) => {
        size += chunk.length;
        if (size > 512) { finish(413); req.destroy(); return; }
        chunks.push(chunk);
      });
      req.on('end', () => {
        if (res.writableEnded) return;
        let value;
        try { value = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { return finish(400); }
        const event = typeof value?.event === 'string' ? value.event : '';
        if (!CLIENT_EVENTS.has(event)) return finish(400);
        log.info(`page-${event}`, { anchor: typeof value.anchor === 'string' ? value.anchor.slice(0, 16) : undefined });
        finish(204);
      });
    },
  }));
  unregisterBootstrap = trackRoute(registerRoute({
    kind: 'exact', path: '/api/no996-openfilm/bootstrap',
    async handler(req, res) {
      res.setHeader('cache-control', 'no-store');
      if (disposed) { res.writeHead(503).end('STUDIO_DISPOSED'); return; }
      if (req.method !== 'POST') { res.writeHead(405, { allow: 'POST' }).end(); return; }
      // Use DSH's own Host/Origin and authenticated-peer fence. It intentionally
      // accepts a missing Origin when the authenticated request is otherwise
      // trusted; requiring an Origin here rejects valid local browser requests.
      const admission = ctx.connection.admit({ headers: req.headers });
      if ('rejection' in admission) {
        res.writeHead(admission.rejection).end(admission.rejection === 403 ? 'DSH_ORIGIN_REJECTED' : 'DSH_SESSION_REQUIRED'); return;
      }
      if (admission.peer.id !== ctx.connection.browserPeer.id) {
        res.writeHead(403).end('DSH_BROWSER_REQUIRED'); return;
      }
      const bootStarted = Date.now();
      let stage = 'validate';
      try {
        // Desktop serves its UI from a privileged app scheme and forwards this
        // already-authenticated call to the Host. It does not share DSH's
        // browser cookie with loopback frames, so the proxy uses a one-time
        // desktop bootstrap instead. Normal browser mode keeps its own origin.
        const surface = req.headers['x-no996-surface'];
        const desktop = surface === 'dsh-app://app' || surface === 'app://app';
        const browser = desktop ? null : new URL(req.headers.origin || `http://${req.headers.host}`);
        if (!desktop && (browser.protocol !== 'http:' || !['127.0.0.1', 'localhost'].includes(browser.hostname) || browser.port !== origin.port)) {
          res.writeHead(403).end('DSH_ORIGIN_REJECTED'); return;
        }
        log.info('bootstrap-start', { desktop });
        stage = 'studio';
        await runtime.ensureStarted();
        if (disposed || !upstream) { log.warn('bootstrap-unavailable', { stage, disposed }); res.writeHead(503).end(); return; }
        stage = 'proxy';
        const proxy = await proxyFor(desktop ? surface : browser.origin, desktop);
        if (disposed) { log.warn('bootstrap-unavailable', { stage, disposed }); res.writeHead(503).end(); return; }
        stage = 'response';
        await proxy.bootstrap(res);
        log.info('bootstrap-finish', { status: res.statusCode, ms: Date.now() - bootStarted, desktop });
      } catch (error) {
        // Log only a bounded allowlisted error code: messages may contain bearer keys.
        // OFFICIAL_SHELL_UNAVAILABLE belongs here: it is the one failure a person can
        // act on (the bundled shell does not match the pinned OpenFilm kernel), and
        // without it the log only ever said "OTHER".
        const allowed = ['STUDIO_START', 'STUDIO_CLOSE', 'STUDIO_DEPENDENCY', 'OFFICIAL_SHELL_UNAVAILABLE'];
        const code = allowed.includes(error?.code) ? error.code : 'OTHER';
        log.warn('bootstrap-failed', { stage, code, ms: Date.now() - bootStarted });
        if (!res.headersSent) res.writeHead(503, { 'content-type': 'text/plain; charset=utf-8' });
        // The panel shows this body beside the status: naming the code is the
        // difference between "broken" and "the shell and the kernel disagree".
        if (!res.writableEnded) res.end(`Studio is unavailable (${code})`);
      }
    },
  }));
  // The sidebar's "OpenFilm 素材剪辑区" dropdown: which projects have an editing
  // conversation, and which DSH Session it is bound to. Read-only and cheap: the
  // project list comes from Studio, the binding from the ACP session store. No
  // Session is created and no model is called.
  unregisterEditingSessions = trackRoute(registerRoute({
    kind: 'exact', path: '/api/no996-openfilm/editing-sessions',
    async handler(req, res) {
      res.setHeader('cache-control', 'no-store');
      if (req.method !== 'GET') { res.writeHead(405, { allow: 'GET' }).end(); return; }
      const admission = ctx.connection.admit({ headers: req.headers });
      if ('rejection' in admission) {
        res.writeHead(admission.rejection).end(admission.rejection === 403 ? 'DSH_ORIGIN_REJECTED' : 'DSH_SESSION_REQUIRED');
        return;
      }
      if (admission.peer.id !== ctx.connection.browserPeer.id) { res.writeHead(403).end('DSH_BROWSER_REQUIRED'); return; }
      try {
        let proxy;
        try { proxy = await lastProxy; } catch { proxy = undefined; }
        const projects = proxy && typeof proxy.listProjects === 'function'
          ? await proxy.listProjects().catch(() => [])
          : [];
        const bound = new Map(acpSessions.all().map(record => [record.projectId, record]));
        const items = [];
        for (const project of projects) {
          if (!project || typeof project.id !== 'string') continue;
          const record = bound.get(project.id);
          if (!record || typeof record.sessionId !== 'string') continue;
          // An archived conversation stays listed: it is where the project's
          // history lives, and the panel opens it read-only with a restore
          // action (hiding it made the whole area look empty).
          const archived = archive && typeof archive.isArchived === 'function'
            ? archive.isArchived(record.sessionId) === true
            : false;
          items.push({
            projectId: project.id,
            sessionId: record.sessionId,
            archived,
            name: typeof project.name === 'string' && project.name
              ? project.name
              : (typeof project.title === 'string' && project.title ? project.title : basename(String(project.path ?? '')) || project.id),
            path: typeof project.path === 'string' ? project.path : '',
          });
        }
        res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' }).end(JSON.stringify({ projects: items }));
      } catch {
        res.writeHead(503).end('EDITING_SESSIONS_UNAVAILABLE');
      }
    },
  }));
  unregisterStandalone = trackRoute(registerRoute({
    kind: 'exact', path: '/no996-openfilm/standalone',
    async handler(req, res) {
      // A plain browser window for layout work. Same DSH origin, so it uses the
      // same authenticated session; it opens no new listener and shares no key.
      if (req.method !== 'GET') { res.writeHead(405, { allow: 'GET' }).end(); return; }
      const admission = ctx.connection.admit({ headers: req.headers });
      if ('rejection' in admission) { res.writeHead(admission.rejection).end('DSH_SESSION_REQUIRED'); return; }
      const page = '<!doctype html><html lang="zh-CN"><head><meta charset="utf-8">'
        + '<meta name="viewport" content="width=device-width,initial-scale=1"><title>OpenFilm 视频创作</title>'
        + '<style>html,body{margin:0;height:100%;background:#111;color:#eee;font:13px system-ui,sans-serif}'
        + '#bar{display:flex;gap:12px;align-items:center;padding:6px 10px;border-bottom:1px solid #333}'
        + '#bar label{display:flex;gap:6px;align-items:center}#frame{display:block;width:100%;height:calc(100% - 37px);border:0;background:#000}'
        + '#err{padding:16px;color:#f88;white-space:pre-wrap}</style></head><body>'
        + '<div id="bar"><strong>OpenFilm 视频创作</strong>'
        + '<label>对话侧 <select id="side"><option value="right">右侧</option><option value="left">左侧</option></select></label>'
        + '<label>宽度 <input id="width" type="range" min="240" max="800" step="20" value="420"><span id="wv">420</span></label>'
        + '<button id="reload">重新载入</button><span id="status">正在启动…</span></div>'
        + '<iframe id="frame" allow="clipboard-read; clipboard-write"></iframe><pre id="err" hidden></pre>'
        + '<script>(function(){var f=document.getElementById("frame"),status=document.getElementById("status"),err=document.getElementById("err");'
        + 'var side=document.getElementById("side"),width=document.getElementById("width"),wv=document.getElementById("wv");'
        + 'function post(){var w=Number(width.value);wv.textContent=w;try{f.contentWindow.postMessage({type:"no996-openfilm:layout",version:1,side:side.value,width:w},"*")}catch(e){}}'
        + 'function fail(m){err.hidden=false;err.textContent=String(m);status.textContent="启动失败"}'
        + 'function start(){status.textContent="正在启动…";fetch("/api/no996-openfilm/bootstrap",{method:"POST",credentials:"same-origin"})'
        + '.then(function(r){if(!r.ok)throw new Error("bootstrap HTTP "+r.status);return r.json()})'
        + '.then(function(d){var u=new URL(d.editorOrigin);f.src=u.origin+"/";status.textContent="已连接 "+u.origin;f.onload=post})'
        + '.catch(function(e){fail(e&&e.message||e)})}'
        + 'side.onchange=post;width.oninput=post;document.getElementById("reload").onclick=function(){err.hidden=true;start()};start();})();</script>'
        + '</body></html>';
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'content-length': Buffer.byteLength(page) }).end(page);
    },
  }));
  unregisterTemplatesPage = trackRoute(registerRoute({
    kind: 'exact', path: '/no996-openfilm/templates',
    async handler(req, res) {
      res.setHeader('cache-control', 'no-store');
      if (req.method !== 'GET') { res.writeHead(405, { allow: 'GET' }).end(); return; }
      const admission = ctx.connection.admit({ headers: req.headers });
      if ('rejection' in admission) { res.writeHead(admission.rejection).end(); return; }
      if (admission.peer.id !== ctx.connection.browserPeer.id) { res.writeHead(403).end('DSH_BROWSER_REQUIRED'); return; }
      let items = [];
      try { items = await listTemplates(templatesRoot); } catch { /* an empty page still explains itself */ }
      const escape = value => String(value).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]);
      const cards = items.map(item => `<li><strong>${escape(item.title)}</strong> <small>${escape(item.mode)}</small><p>${escape(item.description)}</p><button type=\"button\" data-id=\"${escape(item.id)}\">用这个模板建项目</button></li>`).join('');
      const html = `<!doctype html><meta charset=\"utf-8\"><title>OpenFilm 模板</title><style>body{font:14px system-ui,sans-serif;background:#171717;color:#e8e8e8;margin:24px}li{margin:16px 0;padding:12px;border:1px solid #333;border-radius:8px;list-style:none}button{margin-top:8px;padding:6px 12px;border-radius:6px;border:1px solid #555;background:#2a2a2a;color:inherit;cursor:pointer}p{margin:6px 0;opacity:.8}#msg{margin-top:16px;color:#f88}</style><h1>OpenFilm 模板</h1><ul>${cards || '<li>没有可用模板</li>'}</ul><div id=\"msg\"></div><script>document.addEventListener('click',async e=>{const b=e.target.closest('button[data-id]');if(!b)return;b.disabled=true;b.textContent='创建中…';try{const r=await fetch('/__dsh/official-rpc',{method:'POST',credentials:'same-origin',headers:{'content-type':'application/json'},body:JSON.stringify({channel:'template:create',payload:{templateId:b.dataset.id}})});const d=await r.json();if(!d||!d.projectId)throw new Error((d&&d.error)||('HTTP '+r.status));if(d.prompt){try{localStorage.setItem('no996.openfilm.templatePrompt',d.prompt)}catch(_){}}location.href='/projects/'+d.projectId}catch(err){document.getElementById('msg').textContent='创建失败：'+(err&&err.message||err);b.disabled=false;b.textContent='用这个模板建项目'}})</script>`;
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'content-length': Buffer.byteLength(html) }).end(html);
    },
  }));
  unregisterMcp = trackRoute(registerRoute({
    kind: 'exact', path: '/api/no996-openfilm/mcp',
    async handler(req, res) {
      res.setHeader('cache-control', 'no-store');
      if (disposed) { res.writeHead(503).end('{}'); return; }
      if (req.method !== 'POST') { res.writeHead(405, { allow: 'POST' }).end('{}'); return; }
      const chunks = [];
      let size = 0;
      for await (const chunk of req) {
        size += chunk.byteLength;
        if (size > 4 * 1024 * 1024) { res.writeHead(413).end('{}'); return; }
        chunks.push(chunk);
      }
      let answer;
      try {
        answer = await mcpEndpoint.handle({ headers: req.headers, body: Buffer.concat(chunks).toString('utf8') });
      } catch (error) {
        void log.warn('mcp-failed', { code: String(error?.code ?? error?.name ?? 'NONE').slice(0, 40) });
        answer = { status: 500, body: { error: 'mcp failed' } };
      }
      if (answer.body === undefined) { res.writeHead(answer.status).end(); return; }
      const body = JSON.stringify(answer.body);
      res.writeHead(answer.status, { 'content-type': 'application/json; charset=utf-8', 'content-length': Buffer.byteLength(body) }).end(body);
    },
  }));
  unregisterDebugUrl = trackRoute(registerRoute({
    kind: 'exact', path: '/api/no996-openfilm/debug-url',
    async handler(req, res) {
      res.setHeader('cache-control', 'no-store');
      if (req.method !== 'POST') { res.writeHead(405, { allow: 'POST' }).end(); return; }
      const admission = ctx.connection.admit({ headers: req.headers });
      if ('rejection' in admission || admission.peer.id !== ctx.connection.browserPeer.id) { res.writeHead(403).end('DSH_BROWSER_REQUIRED'); return; }
      try {
        await runtime.ensureStarted();
        if (disposed || !upstream) { res.writeHead(503).end(); return; }
        const surface = req.headers['x-no996-surface'];
        const desktop = surface === 'dsh-app://app' || surface === 'app://app';
        const browser = desktop ? null : new URL(req.headers.origin || `http://${req.headers.host}`);
        const proxy = await proxyFor(desktop ? surface : browser.origin, desktop);
        const data = proxy.bootstrapData();
        if (!data) { res.writeHead(503).end(); return; }
        // A browser cannot hold Studio's Secure/Partitioned cookie, so the debug
        // listener holds it instead and gates the window with its own token.
        let url;
        if (data.ticket) {
          if (!debugBridge) {
            debugBridge = redeemStudioSession(data.editorOrigin, data.ticket)
              .then(cookie => startStudioDebug({ editorOrigin: data.editorOrigin, sessionCookie: cookie, officialShell }));
            debugBridge.catch(() => { debugBridge = undefined; });
          }
          url = (await debugBridge).url;
        } else url = `${data.webOrigin}/no996-openfilm/standalone`;
        const body = JSON.stringify({ url });
        res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'content-length': Buffer.byteLength(body) }).end(body);
      } catch {
        if (!res.headersSent) res.writeHead(503, { 'content-type': 'text/plain; charset=utf-8' }).end('Studio is unavailable');
      }
    },
  }));
  } catch (error) {
    rollbackRoutes();
    throw error;
  }
  log.info('host-start', { version: HOST_VERSION, officialShell, editorPort: Number(process.env.NO996_OPENFILM_EDITOR_PORT || 47822) });
  // Warm the editor port at assembly. Otherwise the proxy only exists after the
  // first bootstrap, so opening http://<host>:47822 directly (or pasting the
  // address from the docs) reads as a dead port even though the plugin is fine.
  // A failed first attempt is retried: a plugin reload can arrive while the
  // previous Studio child is still releasing its ports, and that failure is
  // instant and transient. Failures stay non-fatal: the panel bootstraps lazily.
  void (async () => {
    const delays = [1000, 3000, 8000];
    for (let attempt = 1; attempt <= delays.length + 1; attempt += 1) {
      const started = Date.now();
      try {
        await runtime.ensureStarted();
        if (!disposed && upstream) await proxyFor(webOrigin);
        log.info('studio-warm', { ms: Date.now() - started, attempt });
        void suppressWhatsNew();
        return;
      } catch (error) {
        // A code, never the message: upstream messages may carry keys or paths.
        const code = String(error?.code || 'OTHER');
        log.warn('studio-warm-failed', { code, attempt, message: String(error?.message || error) });
        if (disposed || attempt > delays.length) return;
        await new Promise(resolve => {
          const timer = setTimeout(resolve, delays[attempt - 1]);
          // Never keep the Host process alive just to retry a warm-up.
          if (typeof timer.unref === 'function') timer.unref();
        });
      }
    }
  })();
  return async () => {
    const closingAt = Date.now();
    disposed = true;
    // Stop the ACP children before the routes go away: a child that outlives the
    // Host keeps holding the project's Session open.
    try { await acpAgentService?.close?.(); } catch { /* already closed */ }
    // Drop exact routes synchronously first. An async disposer that awaits
    // Studio shutdown before unregister would let a re-enable collide on
    // `/api/no996-openfilm/templates` (and siblings).
    rollbackRoutes();
    try { unregisterTranscribe(); } catch { /* already gone */ }
    try { unregisterTranscribeRoute(); } catch { /* already gone */ }
    try { unregisterMcp(); } catch { /* already gone */ }
    mcpAgents.clear();
    try { unregisterSystemCheck(); } catch { /* already gone */ }
    try { unregisterSystemInstall(); } catch { /* already gone */ }
    try { unregisterGuide(); } catch { /* already gone */ }
    for (const unregisterTool of unregisterFilmTools) {
      try { unregisterTool(); } catch { /* already removed */ }
    }
    // Stop answering approval questions before the stream that carries them goes
    // away, so nothing is left waiting on a listener that can never reply.
    try { approvals.close(); } catch { /* already closed */ }
    try { archive.close(); } catch { /* already closed */ }
    const closingDebug = debugBridge;
    debugBridge = undefined;
    closingDebug?.then(bridge => bridge.close()).catch(() => {});
    try { eventHub.close(); } catch { /* already closed */ }
    try { bridgeTrace.close(); } catch { /* already closed */ }
    const chat = await officialStorePromise?.catch(() => undefined);
    try { await chat?.close(); }
    finally { await runtime.close(); }
    log.info('host-stop', { uptimeMs: closingAt - openedAt, events: log.count });
    await log.flush().catch(() => {});
  };
}
