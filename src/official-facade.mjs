/**
 * Source for an injectable expression, not an installed bridge. Evaluating it
 * produces a factory: factory({ invoke, on, platform }). The host must supply
 * these capabilities from a trusted isolated context, never from the page.
 * invoke(channel) and on(channel, listener) are optional; on returns an
 * unsubscribe function. No URL, credential, or project path is embedded here.
 *
 * The UI-only preferences and layout last for this facade instance only. All
 * agent, history, file, permission, tab and installation operations fail closed
 * unless their specific capability is supplied by an authenticated host bridge.
 */
function officialFacadeFactory(bridge) {
  bridge = bridge && typeof bridge === 'object' ? bridge : {};
  const unavailable = (operation) => {
    const error = new Error('OpenFilm capability unavailable: ' + operation);
    error.code = 'OPENFILM_UNAVAILABLE';
    return error;
  };
  const denied = (operation) => () => Promise.reject(unavailable(operation));
  const methods = (prefix, names) => Object.fromEntries(names.map((name) => [name, denied(prefix + '.' + name)]));
  const emitters = new Map();
  const listenLocal = (name) => (listener) => {
    if (typeof listener !== 'function') return () => {};
    let listeners = emitters.get(name);
    if (!listeners) emitters.set(name, listeners = new Set());
    listeners.add(listener);
    let active = true;
    return () => { if (active) { active = false; listeners.delete(listener); } };
  };
  const emit = (name, value) => {
    for (const listener of [...(emitters.get(name) || [])]) listener(value);
  };

  // Only these fixed RPC and event channels may reach the supplied bridge.
  // The Host must independently authorize project IDs and validate all payloads.
  const rpcAllow = new Set(['chat:load', 'chat:save-sessions', 'chat:save-turn', 'agent:prompt', 'agent:cancel', 'agent:models', 'agent:select-model']);
  const eventAllow = new Set(['desktop:full-screen', 'desktop:toggle-chat', 'desktop:open-settings']);
  const rpc = async (channel, payload) => {
    if (!rpcAllow.has(channel) || typeof bridge.invoke !== 'function') throw unavailable(channel);
    try { return await bridge.invoke(channel, payload); } catch { throw unavailable(channel); }
  };
  // Do not forward the path supplied by a page. Match it to the official
  // shell's current project and send only the opaque ID; the Host must also
  // authorize that ID against Studio's project registry on every request.
  const projectId = async (projectPath) => {
    const match = /^\/projects\/([A-Za-z0-9_-]{6,40})\/?$/.exec(globalThis.location?.pathname || '');
    if (!match || typeof projectPath !== 'string' || typeof globalThis.openfilmDesktop?.hello !== 'function') throw unavailable('project');
    const current = (await globalThis.openfilmDesktop.hello())?.project;
    // The chat may address a project before the shell reports it as current
    // (or with a re-cased path), so fall back to Studio's own registry instead
    // of refusing: the ID still has to match the page and an existing project.
    let known = current && current.id === match[1] && current.path === projectPath ? current : null;
    if (!known) {
      try {
        const listed = await (await fetch('/api/projects', { credentials: 'same-origin' })).json();
        const items = Array.isArray(listed) ? listed : (Array.isArray(listed?.projects) ? listed.projects : []);
        known = items.find(item => item && item.id === match[1] &&
          (item.path === projectPath || String(item.path || '').replace(/[\\/]+$/, '') === projectPath.replace(/[\\/]+$/, ''))) || null;
      } catch { known = null; }
    }
    if (!known) throw unavailable('project');
    return match[1];
  };
  const remoteEvent = (channel, convert) => (listener) => {
    if (typeof listener !== 'function' || !eventAllow.has(channel) || typeof bridge.on !== 'function') return () => {};
    let active = true;
    let stop;
    try {
      stop = bridge.on(channel, (value) => { if (active) listener(convert(value)); });
    } catch { return () => {}; }
    return () => {
      if (!active) return;
      active = false;
      if (typeof stop === 'function') stop();
    };
  };
  const silentEvent = () => () => {};
  let prefs = { developer: false, changes: true, notify: true };
  let layout = { chatOpen: true, chatWidth: 420 };
  // Studio's layout editor saves the whole workspace arrangement through
  // saveLayout; keeping every field is what makes a docked-right chat stick.
  try {
    const saved = JSON.parse(localStorage.getItem('no996.openfilm.layout') || 'null');
    if (saved && typeof saved === 'object' && !Array.isArray(saved)) layout = { ...layout, ...saved };
  } catch { /* no stored layout */ }
  let theme = 'light';
  let language = 'en';
  const prefView = () => ({ ...prefs });
  // One DSH-backed agent in the official roster: the composer can pick it and
  // send; every turn still goes through the Host's own session and policy.
  const DSH_AGENT_ID = 'deepseek';
  const roster = [{ id: DSH_AGENT_ID, name: 'DeepSeek Harness', shown: true, status: 'ready', configurationRevision: 1 }];
  const agents = {
    ...methods('agents', ['connect', 'cancelSignIn', 'disconnect', 'switchAccount', 'usage', 'setShown', 'saveOpenFilmModels', 'locate', 'useAutomatic', 'install', 'diagnose', 'openSetup', 'report', 'copyReport', 'saveOwnModel', 'removeOwnModel', 'mcp', 'skills', 'allowSkill', 'allowMcp']),
    list: async () => roster,
    refresh: async () => roster,
    onChange: silentEvent,
  };
  // Studio treats a host that exposes `tabs` as a tabbed app: its "open project"
  // then goes through tabs.open and never routes the page, and its project cards
  // await tabs.list without a catch. This window has one document and no tab
  // bar, so the shape must be absent rather than present-but-rejecting.
  const tabs = undefined;
  const agentKeys = new Map();
  const agentListeners = new Set();
  const agentSources = new Map();
  const emitAgent = (event) => { for (const listener of [...agentListeners]) { try { listener(event); } catch { /* one closed view */ } } };
  const ensureAgentSource = (id) => {
    if (agentSources.has(id) || typeof EventSource !== 'function') return;
    try {
      const source = new EventSource('/__dsh/official-events?projectId=' + encodeURIComponent(id));
      source.onmessage = (message) => {
        try { const value = JSON.parse(message.data); if (value && typeof value === 'object') emitAgent(value); } catch { /* ignore bad frame */ }
      };
      agentSources.set(id, source);
    } catch { /* the composer will report the failed send */ }
  };
  const localAgents = {
    ...methods('localAgents', ['signIn', 'disconnect', 'probe', 'running', 'ack', 'steer', 'adopt', 'cancel', 'setOption', 'answerPermission', 'answerQuestion', 'close']),
    list: async () => [],
    ack: async () => ({ ok: true }),
    probe: async () => {
      // The model menu calls probe() and reads `info.configOptions`; returning a
      // bare {ok} crashed it with "cannot read properties of undefined".
      const info = { sessionId: 'probe', agentInfo: { name: 'DeepSeek Harness' }, authMethods: [], mcp: false, models: null, modes: null, configOptions: [] };
      const match = /^\/projects\/([A-Za-z0-9_-]{6,40})\/?$/.exec(globalThis.location?.pathname || '');
      if (match) {
        try {
          const option = await rpc('agent:models', { projectId: match[1] });
          if (option && option.id === 'model' && Array.isArray(option.options)) info.configOptions = [option];
        } catch { /* keep the empty list */ }
      }
      return { ok: true, info };
    },
    running: async () => [],
    adopt: async () => ({ ok: true }),
    close: async () => ({ ok: true }),
    onEvent: (listener) => {
      if (typeof listener !== 'function') return () => {};
      agentListeners.add(listener);
      return () => { agentListeners.delete(listener); };
    },
    start: async (agent, cwd, resume, meta) => {
      // The chat's bridge contract is a result object, not a throw: `{ok:false}`
      // is what turns into a readable error bubble.
      if (typeof agent !== 'string' || !agent) return { ok: false, error: 'No agent selected' };
      let id;
      try {
        id = (meta && typeof meta.projectId === 'string' && /^[A-Za-z0-9_-]{6,40}$/.test(meta.projectId)) ? meta.projectId : await projectId(cwd);
      } catch (error) {
        return { ok: false, error: `Cannot resolve project: ${String((error && error.message) || error)}` };
      }
      ensureAgentSource(id);
      const key = 'dsh-' + Math.random().toString(36).slice(2) + Date.now().toString(36);
      agentKeys.set(key, id);
      // The composer's model menu reads ACP config options, so publish the Host
      // catalog here; a missing catalog leaves the menu empty instead of broken.
      let configOptions = [];
      try {
        const option = await rpc('agent:models', { projectId: id });
        if (option && option.id === 'model' && Array.isArray(option.options)) configOptions = [option];
      } catch { configOptions = []; }
      return { ok: true, key, info: { sessionId: key, resumed: false, agentInfo: { name: 'DeepSeek Harness' }, authMethods: [], mcp: false, models: null, modes: null, configOptions } };
    },
    cancel: async (key) => {
      const id = agentKeys.get(key);
      if (!id) throw unavailable('localAgents.cancel');
      const result = await rpc('agent:cancel', { projectId: id });
      emitAgent({ key, kind: 'done', turnId: '', ok: false, stopReason: 'cancelled' });
      return result;
    },
    setOption: async (key, optionId, value) => {
      const id = agentKeys.get(key);
      if (!id) throw unavailable('localAgents.setOption');
      if (optionId !== 'model' || typeof value !== 'string') throw unavailable('localAgents.setOption');
      return await rpc('agent:select-model', { projectId: id, value });
    },
    // Approvals fail closed with a readable answer: the DSH approval service is
    // not exposed to this plugin yet, and pretending to allow would be worse.
    answerPermission: async () => ({ ok: false, error: '当前会话没有可审批的请求（DSH 审批服务尚未接入）' }),
    answerQuestion: async () => ({ ok: false, error: '当前会话没有待回答的问题' }),
    prompt: async (key, text, meta, images) => {
      const id = agentKeys.get(key);
      if (!id) throw unavailable('localAgents.prompt');
      if (typeof text !== 'string' || text.length > 200000) throw unavailable('localAgents.prompt');
      // The official composer hands over reference pictures as ACP image parts;
      // forward only well-formed inline images and let the Host re-validate.
      const stills = Array.isArray(images) ? images.filter(image => image && typeof image === 'object' &&
        typeof image.data === 'string' && typeof image.mediaType === 'string' && image.mediaType.startsWith('image/')).slice(0, 4)
        .map(image => ({ mediaType: image.mediaType, data: image.data, ...(typeof image.name === 'string' ? { name: image.name.slice(0, 120) } : {}) })) : [];
      if (!text.trim() && stills.length === 0) throw unavailable('localAgents.prompt');
      const turnId = typeof meta?.turnId === 'string' ? meta.turnId : '';
      const result = await rpc('agent:prompt', { projectId: id, key, turnId, text: text || '（参考图）', ...(stills.length ? { images: stills } : {}) });
      emitAgent({ key, kind: 'done', turnId, ok: result?.ok === true, ...(result?.stopReason ? { stopReason: result.stopReason } : {}) });
      return { ok: true };
    },
  };
  const revisions = new Map();
  const writes = new Map();
  const saveChat = async (project, channel, payload) => {
    // Capture the component's value before another render can mutate it.
    const copy = JSON.parse(JSON.stringify(payload));
    const id = await projectId(project);
    const previous = writes.get(id) || Promise.resolve();
    const pending = previous.then(async () => {
      let expectedRevision = revisions.get(id);
      if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0) {
        // A save can arrive before any load (a reloaded page finishing a turn, a
        // composer that writes immediately). Read the current revision instead of
        // failing the write, or that message silently disappears from history.
        const loaded = await rpc('chat:load', { projectId: id });
        if (Number.isSafeInteger(loaded?.revision) && loaded.revision >= 0) revisions.set(id, loaded.revision);
        expectedRevision = revisions.get(id);
      }
      if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0) throw unavailable('chat:reload-required');
      const result = await rpc(channel, { projectId: id, ...copy, expectedRevision });
      if (!result || result.ok !== true || result.revision !== expectedRevision + 1) throw unavailable('chat:save');
      revisions.set(id, result.revision);
      return result;
    }).catch(error => {
      // Never overwrite a second view's changes after an unknown or stale write.
      revisions.delete(id);
      try { globalThis.dispatchEvent(new CustomEvent('no996-openfilm:chat-save-failed', { detail: { projectId: id } })); } catch {}
      throw error;
    });
    writes.set(id, pending);
    try { return await pending; }
    finally { if (writes.get(id) === pending) writes.delete(id); }
  };
  const chat = {
    ...methods('chat', ['log', 'reveal', 'saveRefImage', 'describePaths', 'unsaved', 'snapshot', 'changes', 'undo']),
    load: async (project) => {
      const id = await projectId(project);
      await (writes.get(id) || Promise.resolve()).catch(() => {});
      const result = await rpc('chat:load', { projectId: id });
      if (!Number.isSafeInteger(result?.revision) || result.revision < 0) throw unavailable('chat:load');
      revisions.set(id, result.revision);
      return result;
    },
    saveAttachment: async (project, name, bytes) => {
      if (typeof bridge.upload !== 'function' || typeof name !== 'string' || !(bytes instanceof ArrayBuffer) || bytes.byteLength < 1 || bytes.byteLength > 256 * 1024 * 1024) throw unavailable('chat:saveAttachment');
      const id = await projectId(project);
      const result = await bridge.upload(id, name, bytes);
      if (await projectId(project) !== id || !result || typeof result.path !== 'string' || !result.path.startsWith('assets/upload/')) throw unavailable('chat:saveAttachment');
      return { path: result.path };
    },
    saveSessions: (project, sessions, last) => saveChat(project, 'chat:save-sessions', { sessions, last }),
    saveTurn: (project, turn, items) => saveChat(project, 'chat:save-turn', { turn, items }),
  };
  const skills = methods('skills', ['list', 'texts', 'allow', 'changed', 'preview', 'previewFolder', 'commit', 'discard', 'reveal']);
  return {
    platform: ['darwin', 'win32', 'linux'].includes(bridge.platform) ? bridge.platform : 'unknown',
    hello: async () => ({ flavor: 'dsh', version: '0.3.1', ffmpeg: null, update: null, ...layout, chatMin: 340, studioMin: 640, fullScreen: false }),
    // Browsers cannot reveal an OS path for a File. The official composer will
    // use its upload path and report an explicit error until that is connected.
    pathForFile: () => '',
    revealPath: denied('revealPath'), pickFolder: denied('pickFolder'), capture: denied('capture'),
    tabs, agents, localAgents, chat, skills,
    prefs: {
      get: async () => prefView(),
      set: async (next) => {
        if (!next || typeof next !== 'object' || Array.isArray(next)) throw new TypeError('Invalid preferences');
        for (const key of ['developer', 'changes', 'notify']) if (typeof next[key] === 'boolean') prefs[key] = next[key];
        emit('prefs', prefView());
        return prefView();
      },
      onChange: listenLocal('prefs'),
    },
    saveLayout: (next) => {
      if (!next || typeof next !== 'object' || Array.isArray(next)) return;
      layout = { ...layout, ...next };
      try { localStorage.setItem('no996.openfilm.layout', JSON.stringify(layout)); } catch { /* private mode */ }
    },
    setTheme: (next) => { theme = next === 'dark' ? 'dark' : 'light'; },
    setLanguage: (next) => { if (typeof next === 'string' && /^[a-zA-Z0-9-]{1,35}$/.test(next)) language = next; },
    onFullScreen: remoteEvent('desktop:full-screen', (value) => value === true),
    onToggleChat: remoteEvent('desktop:toggle-chat', () => undefined),
    onOpenSettings: remoteEvent('desktop:open-settings', () => undefined),
    onStudioBrowser: silentEvent, onFfmpeg: silentEvent, onUpdate: silentEvent,
    restartToUpdate: denied('restartToUpdate'),
    updateState: async () => ({ status: 'disabled', availableVersion: null, error: null }),
    checkForUpdate: denied('checkForUpdate'),
  };
}

/** JavaScript expression yielding the factory; it does not install itself. */
export const officialFacadeSource = `(${officialFacadeFactory.toString()})`;
export default officialFacadeSource;
