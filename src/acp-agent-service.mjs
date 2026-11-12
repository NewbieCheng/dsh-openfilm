// The panel's conversation, driven over ACP.
//
// One `dsh --profile acp` child per project. The child owns the Session (a real
// DSH Session, persisted by DSH), so the panel and the sidebar show the same
// conversation: thinking, tool cards, permissions and resume all travel as ACP
// `session/update`s instead of being re-invented here. See docs/ARCHITECTURE.md.
//
// This module is the Host-side half of that contract. It keeps the outward shape
// the RPC layer already expects (send/cancel/modelCatalog/selectModel/
// thinkingOption/selectThinking/answerPermission/activeKey) so the facade, the
// event stream and the shell's model menu stay unchanged.
import { mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { createAcpClient } from './acp-client.mjs';

const PROJECT_ID = /^[A-Za-z0-9_-]{6,40}$/;
const TOOL_NAME = /^[A-Za-z0-9_.:-]{1,128}$/;
// ACP resumes ids it issued at session/new (uuids). `session/list` also shows
// DSH-side ids that ACP answers "invalid params" for, so only ours are resumed.
const RESUMABLE = /^[A-Za-z0-9][A-Za-z0-9._:-]{7,199}$/;
const failure = (code, detail) => Object.assign(new Error(detail ? `${code}: ${detail}` : code), { code });
const text = value => typeof value === 'string' && value.length > 0;

/** Windows paths compare case-insensitively; POSIX ones do not. */
function samePath(left, right) {
  if (typeof left !== 'string' || typeof right !== 'string' || !left || !right) return false;
  const trim = value => value.replace(/[\\/]+$/, '');
  if (process.platform === 'win32') {
    return trim(left).replaceAll('/', '\\').toLowerCase() === trim(right).replaceAll('/', '\\').toLowerCase();
  }
  return trim(left).replaceAll('\\', '/') === trim(right).replaceAll('\\', '/');
}

/** ACP model option values are provider/model pairs; be liberal about their form. */
function parseChoice(value) {
  if (typeof value !== 'string' || !value) return undefined;
  try {
    const parsed = JSON.parse(value);
    if (Array.isArray(parsed) && parsed.length === 2 && text(parsed[0]) && text(parsed[1])) {
      return { provider: parsed[0], model: parsed[1] };
    }
  } catch { /* not JSON: fall through */ }
  const slash = value.indexOf('/');
  if (slash > 0 && slash < value.length - 1) return { provider: value.slice(0, slash), model: value.slice(slash + 1) };
  return undefined;
}

/**
 * ACP advertises model choices as free-form option entries: either flat
 * `{value,name}` rows or `{group,name,options:[…]}` groups. The shell's menu wants
 * the DSH catalog shape `{groups:[{id,name,models}], default}`, so flatten it here.
 */
export function catalogFromConfigOptions(configOptions = []) {
  const option = configOptions.find(item => item && (item.category === 'model' || item.id === 'model'));
  if (!option) return { groups: [] };
  const groups = new Map();
  const add = (groupId, groupName, entry) => {
    const choice = parseChoice(entry?.value);
    if (!choice || !text(entry?.name)) return;
    if (!groups.has(groupId)) groups.set(groupId, { id: groupId, name: groupName || groupId, models: [] });
    const models = groups.get(groupId).models;
    if (models.some(item => item.id === choice.model)) return;
    models.push({
      id: choice.model,
      name: entry.name,
      ...(text(entry.description) ? { description: entry.description } : {}),
    });
  };
  for (const entry of Array.isArray(option.options) ? option.options : []) {
    if (Array.isArray(entry?.options)) {
      const groupId = typeof entry.group === 'string' && entry.group ? entry.group : String(entry.name ?? 'models');
      const groupName = text(entry.name) ? entry.name : groupId;
      for (const child of entry.options) add(groupId, groupName, child);
    } else {
      const choice = parseChoice(entry?.value);
      add(choice?.provider ?? 'models', choice?.provider ?? 'models', entry);
    }
  }
  const current = parseChoice(option.currentValue);
  return {
    groups: [...groups.values()].filter(group => group.models.length > 0),
    ...(current ? { default: current } : {}),
  };
}

/** The ACP value that selects this provider/model, as advertised by the agent. */
function valueForChoice(configOptions, choice) {
  const option = configOptions.find(item => item && (item.category === 'model' || item.id === 'model'));
  const entries = [];
  for (const entry of Array.isArray(option?.options) ? option.options : []) {
    if (Array.isArray(entry?.options)) entries.push(...entry.options);
    else entries.push(entry);
  }
  const match = entries.find(entry => {
    const parsed = parseChoice(entry?.value);
    return parsed && parsed.provider === choice.provider && parsed.model === choice.model;
  });
  return match ? match.value : JSON.stringify([choice.provider, choice.model]);
}

function thinkingFromConfigOptions(configOptions = []) {
  const option = configOptions.find(item => item && (item.category === 'thought_level' || item.id === 'reasoning_effort'));
  if (!option || !Array.isArray(option.options) || option.options.length === 0) return null;
  return {
    id: 'thinking',
    name: 'Thinking',
    category: 'thought_level',
    type: 'select',
    ...(text(option.currentValue) ? { currentValue: option.currentValue } : {}),
    options: option.options
      .filter(entry => text(entry?.value) && text(entry?.name))
      .slice(0, 32)
      .map(entry => ({ value: entry.value, name: entry.name, ...(text(entry.description) ? { description: entry.description } : {}) })),
  };
}

/**
 * @param {object} deps
 * @param {(projectId: string) => Promise<{projectId: string, path: string}>} deps.verifier
 * @param {{get: Function, set: Function}} deps.store - project -> ACP session id
 * @param {(projectId: string, event: object) => Promise<boolean>|boolean} deps.emit - SSE publish
 * @param {object} [deps.approvals] - createOfficialApprovals instance
 * @param {(event: string, fields?: object) => void} [deps.log]
 * @param {Function} [deps.createClient] - injectable for tests
 * @param {string} [deps.imageDir] - where unsupported inline images are materialised
 */
export function createAcpAgentService({ verifier, store, emit, approvals, log, createClient = options => createAcpClient(options), imageDir = join(tmpdir(), 'no996-openfilm-chat-images'), defaultSelection = () => undefined, permissionMode = () => undefined, mcpServers, onClosed, prepareProject }) {
  if (typeof verifier !== 'function' || typeof emit !== 'function' || !store || typeof store.get !== 'function' || typeof store.set !== 'function') {
    throw new TypeError('verifier, store and emit are required');
  }
  const projects = new Map();
  let closed = false;

  const entryOf = projectId => {
    if (!PROJECT_ID.test(projectId)) throw failure('OFFICIAL_AGENT_INPUT', 'invalid project');
    let entry = projects.get(projectId);
    if (entry) return entry;
    entry = {
      projectId,
      client: undefined,
      sessionId: undefined,
      configOptions: [],
      key: undefined,
      imageEnabled: false,
      inflight: undefined,
      ready: undefined,
      lastUsed: Date.now(),
    };
    projects.set(projectId, entry);
    return entry;
  };

  function attach(entry) {
    const { client, projectId } = entry;
    client.onUpdate(params => {
      const update = params?.update;
      if (entry.sessionId && params?.sessionId !== entry.sessionId) return;
      if (update && update.sessionUpdate === 'config_option_update' && Array.isArray(update.configOptions)) entry.configOptions = update.configOptions;
      void Promise.resolve(emit(projectId, { key: entry.key ?? 'acp', kind: 'update', update })).catch(() => {});
    });
    client.on('exit', ({ code }) => {
      void log?.('acp-exited', { projectId, code });
      if (projects.get(projectId) === entry) projects.delete(projectId);
      try { onClosed?.(projectId); } catch { /* nothing left to clean */ }
    });
  }

  /** The approved preset for this project; DSH spells it as a mode name. */
  async function modeOf(projectId) {
    try {
      const mode = await permissionMode(projectId);
      return mode === 'read-only' || mode === 'workspace-write' || mode === 'danger-full-access' ? mode : undefined;
    } catch { return undefined; }
  }

  async function ensure(projectId) {
    if (closed) throw failure('OFFICIAL_AGENT_CLOSED');
    const entry = entryOf(projectId);
    if (entry.ready) return entry.ready;
    entry.ready = (async () => {
      const project = await verifier(projectId);
      if (!project || !text(project.path)) throw failure('OFFICIAL_AGENT_UNAVAILABLE', 'project has no folder');
      // The ACP agent gets its editing instructions from the project folder, not
      // from our preset. Best effort: a project that cannot be written stays usable.
      try { await prepareProject?.(projectId, project.path); } catch (error) { void log?.('prepare-project-failed', { projectId, reason: String(error?.code ?? error).slice(0, 60) }); }
      // The approval preset is the child's sandbox + approval policy too, so it is
      // chosen at spawn: DSH itself reads DSH_PERMISSION_MODE.
      const mode = await modeOf(projectId);
      // A fresh process means fresh MCP credentials: the endpoint is this Host,
      // and only the child holding the token may call the film tools.
      const servers = typeof mcpServers === 'function' ? await mcpServers(projectId, project.path) : undefined;
      const wiring = Array.isArray(servers) && servers.length > 0 ? { mcpServers: servers } : {};
      entry.client = createClient({ env: { ...process.env, ...(mode ? { DSH_PERMISSION_MODE: mode } : {}) } });
      attach(entry);
      const capabilities = await entry.client.start();
      entry.imageEnabled = capabilities?.agentCapabilities?.promptCapabilities?.image === true;
      entry.client.setPermissionHandler(params => askPermission(entry, params));
      const known = store.get(projectId);
      if (known?.sessionId && RESUMABLE.test(known.sessionId)) {
        try {
          const resumed = await entry.client.resumeSession({ sessionId: known.sessionId, cwd: project.path, ...wiring });
          entry.sessionId = known.sessionId;
          entry.configOptions = resumed?.configOptions ?? [];
          await adoptDefaultSelection(entry);
          return entry;
        } catch (error) {
          void log?.('acp-resume-failed', { projectId, reason: String(error?.code ?? error).slice(0, 80) });
        }
      }
      const created = await entry.client.newSession({ cwd: project.path, ...wiring });
      if (!created || !text(created.sessionId)) throw failure('OFFICIAL_AGENT_UNAVAILABLE', 'agent returned no session');
      entry.sessionId = created.sessionId;
      entry.configOptions = created.configOptions ?? [];
      store.set(projectId, { sessionId: created.sessionId, cwd: project.path });
      void log?.('acp-session', { projectId, created: true });
      await adoptDefaultSelection(entry);
      return entry;
    })();
    try { return await entry.ready; } catch (error) { entry.ready = undefined; throw error; }
  }

  async function discover(entry, projectPath) {
    // Discovery cannot resume (those ids are DSH-side), but it can tell us the
    // folder already holds conversations, which is worth a line in the log.

    try {
      const list = await entry.client.listSessions();
      const matches = (list?.sessions ?? []).filter(item => samePath(item?.cwd, projectPath));
      if (matches.length > 0) void log?.('acp-folder-has-sessions', { projectId: entry.projectId, count: matches.length });
      return undefined;
    } catch { return undefined; }
  }

  /**
   * The panel should start on the same model the sidebar uses. The acp profile has
   * its own default, so the Host's current selection is applied right after the
   * Session opens (best effort: a stale or unadvertised selection is ignored).
   */
  async function adoptDefaultSelection(entry) {
    let selection;
    try { selection = defaultSelection(); } catch { selection = undefined; }
    if (!selection || !text(selection.provider) || !text(selection.model)) return;
    const catalog = catalogFromConfigOptions(entry.configOptions);
    if (!catalog.groups.some(group => group.id === selection.provider && group.models.some(item => item.id === selection.model))) return;
    const option = entry.configOptions.find(item => item && (item.category === 'model' || item.id === 'model'));
    if (!option || option.currentValue === valueForChoice(entry.configOptions, selection)) return;
    try {
      const updated = await entry.client.setConfigOption({
        sessionId: entry.sessionId,
        configId: option.id ?? 'model',
        value: valueForChoice(entry.configOptions, selection),
      });
      if (Array.isArray(updated?.configOptions) && updated.configOptions.length > 0) entry.configOptions = updated.configOptions;
      void log?.('acp-default-model', { projectId: entry.projectId, provider: selection.provider, model: selection.model });
    } catch (error) {
      void log?.('acp-default-model-failed', { projectId: entry.projectId, reason: String(error?.code ?? error).slice(0, 80) });
    }
  }

  async function askPermission(entry, params) {
    if (!approvals || typeof approvals.request !== 'function') return 'allow-once';
    const title = text(params?.toolCall?.title) && TOOL_NAME.test(params.toolCall.title) ? params.toolCall.title : 'tool';
    const outcome = await approvals.request({
      projectId: entry.projectId,
      key: entry.key ?? 'acp',
      agentId: entry.sessionId,
      toolName: title,
      ...(typeof params?.toolCall?.toolCallId === 'string' && params.toolCall.toolCallId.length > 0 ? { callId: params.toolCall.toolCallId.slice(0, 200) } : {}),
    });
    if (outcome === 'allowed-once') return 'allow-once';
    if (outcome === 'rejected') return 'reject-once';
    return null;
  }

  /** Inline pictures the route cannot take become paths the agent can read. */
  function materialise(projectId, images) {
    const kept = [];
    for (const [index, image] of (Array.isArray(images) ? images : []).slice(0, 8).entries()) {
      if (!image || typeof image.data !== 'string' || typeof image.mediaType !== 'string') continue;
      const extension = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/gif': 'gif' }[image.mediaType];
      if (!extension) continue;
      try {
        mkdirSync(imageDir, { recursive: true });
        const file = join(imageDir, `${projectId}-${Date.now()}-${index}.${extension}`);
        writeFileSync(file, Buffer.from(image.data, 'base64'));
        kept.push(file);
      } catch { /* an unreadable picture must not fail the turn */ }
    }
    return kept;
  }

  return Object.freeze({
    /** Adopt the panel's key and send one turn. `emit` carries every update. */
    async send(projectId, { key, turnId, text: promptText, images } = {}) {
      if (typeof promptText !== 'string' || promptText.length > 200000) throw failure('OFFICIAL_AGENT_INPUT', 'bad prompt');
      const entry = await ensure(projectId);
      if (entry.inflight) {
        // One active turn per Session, as ACP allows. The panel names this state
        // instead of hanging; the person can cancel and resend.
        throw failure('OFFICIAL_AGENT_BUSY', 'a turn is already running');
      }
      entry.key = typeof key === 'string' && key ? key : entry.key;
      entry.lastUsed = Date.now();
      const blocks = [];
      const pictures = (Array.isArray(images) ? images : []).slice(0, 8);
      if (entry.imageEnabled) {
        for (const image of pictures) {
          if (typeof image?.data === 'string' && typeof image?.mediaType === 'string' && image.mediaType.startsWith('image/')) {
            blocks.push({ type: 'image', mimeType: image.mediaType, data: image.data });
          }
        }
      }
      const references = entry.imageEnabled ? [] : materialise(projectId, pictures);
      const body = [promptText, ...references.map(file => `[reference image] ${file}`)].filter(part => typeof part === 'string' && part.trim()).join('\n\n');
      if (body) blocks.push({ type: 'text', text: body });
      if (blocks.length === 0) throw failure('OFFICIAL_AGENT_INPUT', 'empty prompt');
      entry.inflight = { turnId, cancelled: false };
      try {
        let result;
        try {
          result = await entry.client.prompt({ sessionId: entry.sessionId, blocks });
        } catch (error) {
          const saidImage = /image|content/i.test(String(error?.message ?? ''));
          if (!entry.imageEnabled || !saidImage || !blocks.some(block => block.type === 'image')) throw error;
          // The route advertised pictures but the turn still failed on them: fall
          // back to paths so the conversation continues instead of dying.
          const retryBlocks = [];
          const fallback = await Promise.resolve(materialise(projectId, pictures));
          const retryBody = [promptText, ...fallback.map(file => `[reference image] ${file}`)]
            .filter(part => typeof part === 'string' && part.trim()).join('\n\n');
          if (retryBody) retryBlocks.push({ type: 'text', text: retryBody });
          void log?.('acp-image-fallback', { projectId });
          result = await entry.client.prompt({ sessionId: entry.sessionId, blocks: retryBlocks });
        }
        const stopReason = result?.stopReason === 'cancelled' ? 'cancelled' : 'end_turn';
        // The page ends the visible turn only on this terminal event; without a
        // live stream the honest answer is a named failure, not a 15 s silence.
        if (await emit(projectId, { key: entry.key, kind: 'done', turnId, ok: true, stopReason }) === false) {
          throw failure('OFFICIAL_AGENT_STREAM_LOST', 'no live event stream accepted the terminal event');
        }
        return { ok: true, stopReason };
      } catch (error) {
        const reason = String(error?.code ?? error?.message ?? error).slice(0, 120);
        void log?.('acp-prompt-failed', { projectId, reason });
        await emit(projectId, { key: entry.key, kind: 'done', turnId, ok: false, error: reason }).catch(() => {});
        throw failure('OFFICIAL_AGENT_FAILED', reason);
      } finally {
        entry.inflight = undefined;
      }
    },

    async cancel(projectId) {
      const entry = projects.get(projectId);
      if (!entry || !entry.sessionId || !entry.inflight) throw failure('OFFICIAL_AGENT_NOT_RUNNING');
      entry.inflight.cancelled = true;
      entry.client.cancel(entry.sessionId);
      return { ok: true };
    },

    async modelCatalog(projectId) {
      const entry = await ensure(projectId);
      const catalog = catalogFromConfigOptions(entry.configOptions);
      if (catalog.groups.length === 0) throw failure('OFFICIAL_AGENT_MODEL_UNAVAILABLE', 'agent advertised no models');
      return catalog;
    },

    async selectModel(projectId, selection) {
      const entry = await ensure(projectId);
      const provider = selection?.provider;
      const model = selection?.model;
      if (!text(provider) || !text(model)) throw failure('OFFICIAL_AGENT_INPUT', 'provider and model are required');
      const catalog = catalogFromConfigOptions(entry.configOptions);
      const listed = catalog.groups.some(group => group.id === provider && group.models.some(item => item.id === model));
      if (!listed) throw failure('OFFICIAL_AGENT_MODEL_UNAVAILABLE', 'model is not advertised by the agent');
      const value = valueForChoice(entry.configOptions, { provider, model });
      const updated = await entry.client.setConfigOption({ sessionId: entry.sessionId, configId: entry.configOptions.find(item => item.category === 'model' || item.id === 'model')?.id ?? 'model', value });
      if (Array.isArray(updated?.configOptions) && updated.configOptions.length > 0) entry.configOptions = updated.configOptions;
      store.set(projectId, { sessionId: entry.sessionId, model: value });
      return { ok: true, currentValue: value };
    },

    async thinkingOption(projectId) {
      const entry = await ensure(projectId);
      return thinkingFromConfigOptions(entry.configOptions);
    },

    async selectThinking(projectId, value) {
      const entry = await ensure(projectId);
      const option = entry.configOptions.find(item => item && (item.category === 'thought_level' || item.id === 'reasoning_effort'));
      if (!option) throw failure('OFFICIAL_AGENT_MODEL_UNAVAILABLE', 'model declares no reasoning levels');
      if (!Array.isArray(option.options) || !option.options.some(entryOption => entryOption?.value === value)) {
        throw failure('OFFICIAL_AGENT_INPUT', 'unknown reasoning level');
      }
      const updated = await entry.client.setConfigOption({ sessionId: entry.sessionId, configId: option.id, value });
      if (Array.isArray(updated?.configOptions) && updated.configOptions.length > 0) entry.configOptions = updated.configOptions;
      return { ok: true, currentValue: value };
    },

    answerPermission(projectId, { key, requestId, optionId } = {}) {
      if (!approvals || typeof approvals.answerRequest !== 'function') return { ok: false };
      const accepted = approvals.answerRequest({ projectId, key, requestId, optionId });
      return { ok: accepted === true };
    },

    /**
     * Forget a project's child so the next turn spawns one under the new preset.
     * Called when the person changes the permission row, the only setting that
     * cannot be changed inside a running child.
     */
    async reset(projectId) {
      const entry = projects.get(projectId);
      if (!entry) return { ok: true };
      projects.delete(projectId);
      try { await entry.client?.close?.(); } catch { /* already gone */ }
      try { onClosed?.(projectId); } catch { /* nothing left to clean */ }
      return { ok: true };
    },

    activeKey(projectId) {
      return projects.get(projectId)?.key ?? null;
    },

    diagnose(projectId) {
      const entry = projects.get(projectId);
      return {
        sessionId: entry?.sessionId ?? null,
        key: entry?.key ?? null,
        inflight: Boolean(entry?.inflight),
        imageEnabled: entry?.imageEnabled === true,
        configOptions: entry ? entry.configOptions.map(option => ({ id: option.id, category: option.category, options: Array.isArray(option.options) ? option.options.length : 0 })) : [],
      };
    },

    async close() {
      closed = true;
      const entries = [...projects.values()];
      projects.clear();
      await Promise.allSettled(entries.map(entry => entry.client?.close?.()));
      approvals?.close?.();
    },

    /** Test seam: the ACP session id chosen for a project, once ensured. */
    sessionOf(projectId) { return projects.get(projectId)?.sessionId; },
    randomId: () => randomUUID(),
  });
}
