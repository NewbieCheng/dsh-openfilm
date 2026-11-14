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
  // The permission row the composer menu renders. Upstream draws the model and
  // the thinking effort; one patched upstream file (vendor/official-shell/patch.diff)
  // also draws a `permission` row, and this is what the facade puts in it.
  // Two choices, because a row without a real choice is not drawn at all.
  const permissionOption = state => {
    if (!state || typeof state !== 'object') return null;
    const choices = [
      { value: 'danger-full-access', name: '完全访问（不再逐步询问）' },
      { value: 'workspace-write', name: '只用工作区（关键步骤会问）' },
    ];
    // `current` is what the Host applied. A value we do not name is still shown,
    // as itself: hiding the whole row lost the choice entirely (the row went
    // missing whenever the Host reported a preset this build did not know).
    const current = typeof state.current === 'string' ? state.current : '';
    if (!current) return null;
    const options = choices.some(choice => choice.value === current)
      ? choices
      : [...choices, { value: current, name: current }];
    return {
      id: 'permission',
      name: '权限',
      category: 'permission',
      type: 'select',
      currentValue: current,
      options,
    };
  };  const rpcAllow = new Set(['chat:load', 'chat:log', 'chat:save-sessions', 'chat:save-turn', 'chat:archive', 'chat:unarchive', 'chat:archive-state', 'editor:link', 'client:log', 'agent:prompt', 'agent:cancel', 'agent:models', 'agent:select-model', 'agent:thinking', 'agent:select-thinking', 'agent:answer-permission', 'agent:permission', 'agent:permission-set', 'agent:session', 'agent:trace', 'prefs:get', 'prefs:set', 'template:list', 'template:create', 'project:create-blank', 'account:balance', 'auth:status', 'auth:logout', 'auth:action', 'auth:remember-get', 'auth:remember-set', 'auth:remember-clear']);
  const eventAllow = new Set(['desktop:full-screen', 'desktop:toggle-chat', 'desktop:open-settings']);
  const rpc = async (channel, payload) => {
    if (!rpcAllow.has(channel) || typeof bridge.invoke !== 'function') throw unavailable(channel);
    try { return await bridge.invoke(channel, payload); }
    catch (error) {
      // Keep the Host's reason: replacing it with a bare 'unavailable' is what
      // made a 503 look like a missing capability and cost a round of diagnosis.
      const wrapped = unavailable(channel);
      const detail = error && error.message ? String(error.message).slice(0, 300) : '';
      if (detail) wrapped.message = wrapped.message + ' — ' + detail;
      if (error && typeof error.code === 'string') wrapped.code = error.code;
      throw wrapped;
    }
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
  const pendingAgentPrompts = new Map();
  const agentListeners = new Set();
  const agentSources = new Map();
  // What this window actually received, per project. Sent back once at the end
  // of every turn so `/diagnose` can separate "never published" from "published
  // and lost" from "received and ignored by the shell".
  const traceByProject = new Map();
  const traceFor = (id) => {
    let entry = traceByProject.get(id);
    if (!entry) traceByProject.set(id, entry = { seen: 0, kinds: Object.create(null) });
    return entry;
  };
  const emitAgent = (event) => { for (const listener of [...agentListeners]) { try { listener(event); } catch { /* one closed view */ } } };
  const ensureAgentSource = (id) => {
    const current = agentSources.get(id);
    if (current) return current.ready;
    if (typeof EventSource !== 'function') return Promise.reject(unavailable('agent.events'));
    let source;
    try { source = new EventSource('/__dsh/official-events?projectId=' + encodeURIComponent(id)); }
    catch { return Promise.reject(unavailable('agent.events')); }
    let resolveReady, rejectReady;
    const entry = { source, ready: new Promise((resolve, reject) => { resolveReady = resolve; rejectReady = reject; }) };
    agentSources.set(id, entry);
    let waiting = true;
    const fail = () => {
      if (agentSources.get(id) !== entry) return;
      agentSources.delete(id);
      clearTimeout(timer);
      source.close();
      if (waiting) { waiting = false; rejectReady(unavailable('agent.events')); }
      for (const pending of pendingAgentPrompts.values()) {
        if (pending.source === entry && pending.dispatched) pending.rejectTerminal(unavailable('agent.events: stream disconnected; output may be incomplete'));
      }
    };
    const timer = setTimeout(fail, 10000);
    source.addEventListener('ready', () => {
      if (!waiting || agentSources.get(id) !== entry || source.readyState !== 1) return;
      waiting = false;
      clearTimeout(timer);
      resolveReady(entry);
    });
    source.onerror = fail;
    source.onmessage = (message) => {
      if (agentSources.get(id) !== entry) return;
      let value;
      try { value = JSON.parse(message.data); } catch { fail(); return; }
      if (!value || typeof value !== 'object' || Array.isArray(value) || typeof value.key !== 'string' || typeof value.kind !== 'string') { fail(); return; }
      if (value.kind === 'done') {
        const pending = pendingAgentPrompts.get(value.key);
        if (!pending || pending.source !== entry || !pending.dispatched || value.turnId !== pending.turnId || pending.terminalSeen) return;
        if (typeof value.ok !== 'boolean' || (value.ok && !['end_turn', 'cancelled'].includes(value.stopReason)) || (!value.ok && typeof value.error !== 'string')) { fail(); return; }
        pending.terminalSeen = true;
        emitAgent(value);
        pending.resolveTerminal(value.ok ? { ok: true, stopReason: value.stopReason } : { ok: false, error: value.error });
      } else {
        const counts = traceFor(id);
        counts.seen += 1;
        const name = value.update && typeof value.update.sessionUpdate === 'string' ? value.update.sessionUpdate : '';
        if (/^[a-z_]{1,40}$/.test(name)) counts.kinds[name] = (counts.kinds[name] || 0) + 1;
        emitAgent(value);
      }
    };
    return entry.ready;
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
        // The thinking menu is a second select option; a model with no declared
        // efforts omits it rather than showing a dead control.
        try {
          const thinking = await rpc('agent:thinking', { projectId: match[1] });
          if (thinking && thinking.id === 'thinking' && Array.isArray(thinking.options) && thinking.options.length > 1) {
            info.configOptions = [...info.configOptions, thinking];
          }
        } catch { /* keep the model option alone */ }
        // Permission lives in the same menu (the one patched row): choosing there
        // is choosing the preset the video tools run under.
        try {
          const permission = permissionOption(await rpc('agent:permission', { projectId: match[1] }));
          if (permission) info.configOptions = [...info.configOptions, permission];
        } catch { /* the menu keeps its other rows */ }
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
      const key = 'dsh-' + Math.random().toString(36).slice(2) + Date.now().toString(36);
      agentKeys.set(key, id);
      // The composer's model menu reads ACP config options, so publish the Host
      // catalog here; a missing catalog leaves the menu empty instead of broken.
      // Thinking intensity rides along: without it the menu shows its built-in
      // "default" row until the model probe answers, which reads as "no choice".
      let configOptions = [];
      try {
        const option = await rpc('agent:models', { projectId: id });
        if (option && option.id === 'model' && Array.isArray(option.options)) configOptions = [option];
      } catch { configOptions = []; }
      try {
        const thinking = await rpc('agent:thinking', { projectId: id });
        if (thinking && thinking.id === 'thinking' && Array.isArray(thinking.options)) configOptions = [...configOptions, thinking];
      } catch { /* the model row alone still works */ }
      try {
        const permission = permissionOption(await rpc('agent:permission', { projectId: id }));
        if (permission) configOptions = [...configOptions, permission];
      } catch { /* the menu keeps its other rows */ }
      // The Host knows whether the stored ACP Session was reopened; only then may
      // the shell skip its "could not open the previous session" hand-over.
      let resumed = false;
      try {
        const state = await rpc('agent:session', { projectId: id });
        resumed = state && state.resumed === true;
      } catch { /* an older Host: leave it unknown rather than claiming a resume */ }
      // The shell calls start(agent, cwd, resume) and compares the answer with the
      // conversation it asked to resume: reporting our page-local key there made
      // every reload look like a failed resume. The conversation keeps its id; only
      // a fresh conversation (no resume argument) gets a new one.
      const conversationId = typeof resume === 'string' && resume ? resume : key;
      return { ok: true, key, info: { sessionId: conversationId, resumed, agentInfo: { name: 'DeepSeek Harness' }, authMethods: [], mcp: false, models: null, modes: null, configOptions } };
    },
    cancel: async (key) => {
      const id = agentKeys.get(key);
      if (!id) throw unavailable('localAgents.cancel');
      const pending = pendingAgentPrompts.get(key);
      if (pending && !pending.dispatched) {
        pending.cancelled = true;
        pending.cancelWait();
        return { ok: true };
      }
      return await rpc('agent:cancel', { projectId: id });
    },
    setOption: async (key, optionId, value) => {
      const id = agentKeys.get(key);
      if (!id) throw unavailable('localAgents.setOption');
      if (typeof value !== 'string') throw unavailable('localAgents.setOption');
      if (optionId === 'model') return await rpc('agent:select-model', { projectId: id, value });
      // Thinking intensity travels as its own option: the Host applies it through
      // the model selection, so the two can never disagree.
      if (optionId === 'thinking') return await rpc('agent:select-thinking', { projectId: id, value });
      // The permission row in the same menu sets the preset the tools run under:
      // it replaces the floating chip that used to cover the timeline.
      if (optionId === 'permission') {
        const result = await rpc('agent:permission-set', { projectId: id, preset: value });
        if (!result || result.ok !== true) throw new Error('没有应用成功，可重试或在 DSH 里改权限');
        return result;
      }
      throw unavailable('localAgents.setOption');
    },
    // Approvals are answered from either window: DSH's own panel still owns them
    // through its answerers, and this forwards the view's answer for the same
    // one-shot decision. The Host picks the winner and resolves the owning agent
    // from its own record, so the page never names a session.
    answerPermission: async (key, requestId, optionId) => {
      const match = /^\/projects\/([A-Za-z0-9_-]{6,40})\/?$/.exec(globalThis.location?.pathname || '');
      if (!match || typeof requestId !== 'string' || typeof key !== 'string' || !key ||
          (optionId !== 'allow-once' && optionId !== 'reject-once')) {
        return { ok: false, error: '这个确认无法在这里回答（缺少项目或会话信息）' };
      }
      try {
        const result = await rpc('agent:answer-permission', { projectId: match[1], key, requestId, optionId });
        return result && result.ok === true ? { ok: true } : { ok: false, error: '这个确认已经失效（可能已在别处回答或超时）' };
      } catch (error) {
        return { ok: false, error: String((error && error.message) || error).slice(0, 200) };
      }
    },
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
      if (pendingAgentPrompts.has(key)) throw unavailable('localAgents.prompt.busy');
      let cancelWait;
      const cancelled = new Promise(resolve => { cancelWait = resolve; });
      let resolveTerminal, rejectTerminal;
      const terminal = new Promise((resolve, reject) => { resolveTerminal = resolve; rejectTerminal = reject; });
      terminal.catch(() => {});
      const pending = { dispatched: false, cancelled: false, cancelWait, turnId, resolveTerminal, rejectTerminal, terminalSeen: false };
      let terminalTimer;
      let settled = false;
      pendingAgentPrompts.set(key, pending);
      try {
        const sourceEntry = await Promise.race([ensureAgentSource(id), cancelled]);
        // A cancelled pre-admission prompt must never be sent after ready arrives.
        if (pending.cancelled) return { ok: true, stopReason: 'cancelled' };
        if (agentSources.get(id) !== sourceEntry) throw unavailable('agent.events');
        if (sourceEntry.source.readyState !== 1) {
          agentSources.delete(id);
          sourceEntry.source.close();
          throw unavailable('agent.events');
        }
        pending.source = sourceEntry;
        pending.dispatched = true;
        // RPC completion is not an ordering barrier for SSE. Only the matching
        // terminal on this exact stream can finish the visible turn.
        const request = rpc('agent:prompt', { projectId: id, key, turnId, text: text || '（参考图）', ...(stills.length ? { images: stills } : {}) });
        const rpcFailure = request.then(() => new Promise((_, reject) => {
          if (!settled) terminalTimer = setTimeout(() => reject(unavailable('agent.events: terminal missing; output may be incomplete')), 15000);
        }));
        return await Promise.race([terminal, rpcFailure]);
      } finally {
        settled = true;
        if (terminalTimer !== undefined) clearTimeout(terminalTimer);
        // Report what this window received for this turn. Fire-and-forget: a
        // trace that fails must never change the turn's outcome.
        const counts = traceFor(id);
        try {
          void rpc('agent:trace', { projectId: id, seen: counts.seen, kinds: { ...counts.kinds } }).catch(() => {});
        } catch { /* unavailable channel */ }
        if (pendingAgentPrompts.get(key) === pending) pendingAgentPrompts.delete(key);
      }
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
  // Archive mutations change which writes are legal, so the local revision hint
  // is dropped: the next save re-reads the Host instead of failing on a stale one.
  const archiveChat = async (project, channel) => {
    const id = await projectId(project);
    await (writes.get(id) || Promise.resolve()).catch(() => {});
    const result = await rpc(channel, { projectId: id });
    revisions.delete(id);
    return result;
  };
  const chat = {
    ...methods('chat', ['reveal', 'saveRefImage', 'describePaths', 'unsaved', 'snapshot', 'changes', 'undo']),
    // The trace tab: what this turn called and what came back, one event a line.
    // A turn the Host never watched has no log, which the tab draws as "nothing".
    log: async (project, turnId) => {
      const id = await projectId(project);
      if (typeof turnId !== 'string' || !turnId) return null;
      const result = await rpc('chat:log', { projectId: id, turnId });
      return result && typeof result === 'object' && Array.isArray(result.events) ? result : null;
    },
    load: async (project) => {
      const id = await projectId(project);
      await (writes.get(id) || Promise.resolve()).catch(() => {});
      const result = await rpc('chat:load', { projectId: id });
      if (!Number.isSafeInteger(result?.revision) || result.revision < 0) throw unavailable('chat:load');
      revisions.set(id, result.revision);
      return result;
    },
    saveAttachment: async (project, name, bytes) => {
      if (!(bytes instanceof ArrayBuffer)) throw new Error('无法读取附件，请重新选择文件。');
      if (bytes.byteLength > 256 * 1024 * 1024) throw new Error('附件超过 256 MiB 上限，请选择较小的文件。');
      if (bytes.byteLength < 1) throw new Error('附件为空，请选择非空文件。');
      if (typeof name !== 'string' || !name) throw new Error('附件文件名无效，请重命名后重试。');
      if (typeof bridge.upload !== 'function') throw new Error('附件上传暂不可用，请稍后重试。');
      let id;
      try { id = await projectId(project); }
      catch { throw new Error('无法确认当前项目，附件未上传；请刷新后重试。'); }
      const result = await bridge.upload(id, name, bytes);
      let current;
      try { current = await projectId(project); } catch { /* project changed or is unavailable */ }
      if (current !== id || !result || typeof result.path !== 'string' || !result.path.startsWith('assets/upload/')) throw new Error('附件上传结果无法确认，文件可能已导入，请先检查项目素材。');
      return { path: result.path };
    },
    saveSessions: (project, sessions, last) => saveChat(project, 'chat:save-sessions', { sessions, last }),
    saveTurn: (project, turn, items) => saveChat(project, 'chat:save-turn', { turn, items }),
    // Archive is the same durable set the DSH sidebar edits. The Host resolves
    // the Session; the page only names a project. History is withheld while
    // archived and returns untouched after restoring.
    archiveState: async project => rpc('chat:archive-state', { projectId: await projectId(project) }),
    archive: async project => archiveChat(project, 'chat:archive'),
    unarchive: async project => archiveChat(project, 'chat:unarchive'),
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
