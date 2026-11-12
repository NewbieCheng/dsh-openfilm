// The Agent Client Protocol side of the panel: one `dsh --profile acp` child
// speaks ACP over newline-delimited JSON on stdio, exactly as the official shell
// does (apps/desktop/src/agents.mjs uses `acp.ndJsonStream` with the same args).
//
// Why a child process and not an in-process bridge: ACP is the contract the shell
// already implements (thinking deltas, tool cards, permissions, resume, model and
// effort options). Driving that protocol means the panel and the sidebar share one
// Session, and every capability the shell draws is one we forward, not one we
// re-invent. See docs/ARCHITECTURE.md.
//
// This module is transport only: it correlates requests, forwards notifications,
// answers permission requests through a handler, and stops the child. It never
// interprets agent semantics.
import { spawn as nodeSpawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';

const CAPABILITIES = Object.freeze({ protocolVersion: 1, clientCapabilities: {}, clientInfo: { name: 'no996-openfilm', version: '1' } });

/** Vendor-neutral failure codes so the panel can name the failing stage. */
function fail(code, detail) {
  return Object.assign(new Error(detail ? `${code}: ${detail}` : code), { code });
}

/**
 * Where the ACP agent comes from. An explicit override wins (tests, other hosts);
 * otherwise the `dsh` command the official shell itself expects. On Windows a
 * `.cmd` shim can only run through the shell, and the arguments are constants.
 */
export function resolveAcpCommand({ env = process.env, platform = process.platform, execPath = process.execPath, exists = existsSync } = {}) {
  const override = typeof env.NO996_OPENFILM_ACP_COMMAND === 'string' ? env.NO996_OPENFILM_ACP_COMMAND.trim() : '';
  if (override) {
    const [command, ...args] = override.split(/\s+/);
    return { command, args: [...args, '--profile', 'acp'], shell: platform === 'win32' && /\.(cmd|bat)$/i.test(command) };
  }
  // The Host may not inherit the CLI on PATH (the desktop app starts it from its
  // own runtime). Prefer the shim that ships beside the running executable.
  if (platform === 'win32') {
    const home = dirname(execPath);
    // The desktop app ships the CLI under resources/ and a shim beside the exe;
    // a dev checkout puts it one level up. Try all three, cheapest first.
    for (const shipped of [
      join(home, 'resources', 'runtime', 'cli', 'bin', 'dsh.cmd'),
      join(home, 'dsh.cmd'),
      join(home, '..', 'runtime', 'cli', 'bin', 'dsh.cmd'),
    ]) {
      if (exists(shipped)) return { command: shipped, args: ['--profile', 'acp'], shell: true };
    }
  }
  return { command: 'dsh', args: ['--profile', 'acp'], shell: platform === 'win32' };
}

/**
 * @param {object} [deps]
 * @param {() => {command: string, args: string[], shell?: boolean}} [deps.resolve] - how to start the agent
 * @param {NodeJS.ProcessEnv} [deps.env]
 * @param {number} [deps.requestTimeoutMs] - a first turn can think for minutes; this is a hung-process guard
 * @param {Function} [deps.spawnChild] - injectable for tests
 * @param {Function} [deps.log] - optional `(event, fields)` sink
 */
export function createAcpClient({ resolve = resolveAcpCommand, env = process.env, requestTimeoutMs = 180000, promptTimeoutMs = 30 * 60_000, spawnChild = nodeSpawn, log, args: extraArgs = [] } = {}) {
  let child = null;
  let state = 'idle';
  let buffer = '';
  let sequence = 0;
  let capabilities = null;
  const pending = new Map();
  const listeners = new Map();
  let onPermission = null;

  const emit = (event, payload) => {
    for (const listener of listeners.get(event) ?? []) {
      try { listener(payload); } catch { /* a broken listener must not kill the transport */ }
    }
  };
  const settle = (id, error, result) => {
    const entry = pending.get(id);
    if (!entry) return;
    pending.delete(id);
    clearTimeout(entry.timer);
    if (error) entry.reject(error);
    else entry.resolve(result);
  };
  const rejectAll = error => {
    for (const [id, entry] of [...pending]) {
      pending.delete(id);
      clearTimeout(entry.timer);
      entry.reject(error);
    }
  };
  const handleLine = line => {
    let message;
    try { message = JSON.parse(line); } catch { void log?.('acp-bad-line', { length: line.length }); return; }
    if (message?.id !== undefined && message?.method) {
      // Agent -> client request. Only permission is advertised, so answer it or
      // refuse loudly; an unanswered request would stall the turn forever.
      if (message.method === 'session/request_permission') {
        Promise.resolve()
          .then(() => (onPermission ? onPermission(message.params) : null))
          .then(optionId => {
            const outcome = optionId ? { outcome: 'selected', optionId } : { outcome: 'cancelled' };
            child?.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: message.id, result: { outcome } }) + '\n');
          })
          .catch(() => {
            child?.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: message.id, error: { code: -32603, message: 'permission handler failed' } }) + '\n');
          });
        return;
      }
      child?.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: message.id, error: { code: -32601, message: `unsupported client method ${message.method}` } }) + '\n');
      return;
    }
    if (message?.method && message.id === undefined) {
      emit(message.method, message.params);
      return;
    }
    if (message?.id !== undefined) {
      if (message.error) {
        // The agent's own error is the only description a failed session/new gets;
        // its data field carries the stack that names the real stage.
        void log?.('acp-request-failed', { code: String(message.error.code ?? ''), data: JSON.stringify(message.error.data ?? '').slice(0, 300) });
        settle(message.id, fail('ACP_REQUEST_FAILED', `${message.error.code} ${message.error.message ?? ''}`.trim()));
      }
      else settle(message.id, null, message.result);
    }
  };

  // The wire call itself: used by start() for `initialize` (the child is not
  // "ready" yet by definition) and, behind the state check, by every other request.
  const wire = (method, params, { timeoutMs = requestTimeoutMs } = {}) => {
    const id = ++sequence;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(fail('ACP_TIMEOUT', method));
      }, timeoutMs);
      timer.unref?.();
      pending.set(id, { resolve, reject, timer });
      try {
        child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
      } catch (error) {
        pending.delete(id);
        clearTimeout(timer);
        reject(fail('ACP_WRITE', String(error?.message ?? error)));
      }
    });
  };

  const request = (method, params, options) => (state === 'ready'
    ? wire(method, params, options)
    : Promise.reject(fail('ACP_NOT_READY', `${method} while ${state}`)));

  const notify = (method, params) => {
    if (state !== 'ready') return false;
    try { child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method, params }) + '\n'); return true; } catch { return false; }
  };

  return {
    get state() { return state; },
    get capabilities() { return capabilities; },

    async start() {
      if (state === 'ready') return capabilities;
      if (state === 'starting') throw fail('ACP_STARTING');
      if (state === 'closed') throw fail('ACP_CLOSED');
      state = 'starting';
      const { command, args, shell = false } = resolve();
      // Extra flags (a per-spawn --patch overlay) ride after the launcher's own.
      if (Array.isArray(extraArgs) && extraArgs.length > 0) args.push(...extraArgs);
      // Through a shell Node joins argv with spaces without quoting, so a path with
      // a space (a temp dir under a user profile that has one) would split in two.
      // Quote those tokens here; a plain spawn keeps the raw argument.
      const spawnArgs = shell ? args.map(value => (/\s/.test(value) ? '"' + value + '"' : value)) : args;
      child = spawnChild(command, spawnArgs, {
        cwd: env.NO996_OPENFILM_ACP_CWD || process.cwd(),
        env: { ...env },
        stdio: ['pipe', 'pipe', 'pipe'],
        windowsHide: true,
        ...(shell ? { shell: true } : {}),
      });
      child.stdout.setEncoding('utf8');
      child.stdout.on('data', chunk => {
        buffer += chunk;
        let index;
        while ((index = buffer.indexOf('\n')) >= 0) {
          const line = buffer.slice(0, index).trim();
          buffer = buffer.slice(index + 1);
          if (line) handleLine(line);
        }
      });
      // A write into a pipe whose process just died surfaces as an 'error' event
      // on stdin, not as a throw. Without this listener that event is unhandled and
      // takes the whole Host down.
      child.stdin.on('error', error => void log?.('acp-stdin-error', { reason: String(error?.code ?? error?.message ?? error) }));
      child.stderr.setEncoding('utf8');
      let stderrSeen = 0;
      child.stderr.on('data', chunk => {
        if (stderrSeen >= 2000) return;
        stderrSeen += chunk.length;
        void log?.('acp-stderr', { text: String(chunk).slice(0, 400) });
      });
      child.on('error', error => {
        state = 'closed';
        rejectAll(fail('ACP_SPAWN', String(error?.message ?? error)));
      });
      child.on('exit', (code, signal) => {
        state = 'closed';
        rejectAll(fail('ACP_EXITED', `code ${code ?? 'null'} signal ${signal ?? 'none'}`));
        emit('exit', { code, signal });
      });
      try {
        capabilities = await wire('initialize', CAPABILITIES);
        state = 'ready';
        void log?.('acp-ready', { agent: capabilities?.agentInfo?.name, version: capabilities?.agentInfo?.version });
        return capabilities;
      } catch (error) {
        state = 'closed';
        try { child?.kill(); } catch { /* already gone */ }
        throw error;
      }
    },

    newSession({ cwd, mcpServers = [] }) { return request('session/new', { cwd, mcpServers }); },
    resumeSession({ sessionId, cwd, mcpServers = [] }) { return request('session/resume', { sessionId, cwd, mcpServers }); },
    listSessions() { return request('session/list', {}); },
    // A real editing turn can legitimately run for many minutes (transcode, frame
    // analysis); the transport's hung-process guard must not cut it short.
    prompt({ sessionId, blocks }) { return request('session/prompt', { sessionId, prompt: blocks }, { timeoutMs: promptTimeoutMs }); },
    setConfigOption({ sessionId, configId, value }) { return request('session/set_config_option', { sessionId, configId, value }); },
    cancel(sessionId) { return notify('session/cancel', { sessionId }); },

    /** ACP `session/update` payloads, already scoped by session. */
    onUpdate(listener) { return this.on('session/update', listener); },
    /** `(params) => optionId | null | Promise<...>` for `session/request_permission`. */
    setPermissionHandler(handler) { onPermission = typeof handler === 'function' ? handler : null; },
    on(event, listener) {
      if (!listeners.has(event)) listeners.set(event, new Set());
      listeners.get(event).add(listener);
      return () => listeners.get(event)?.delete(listener);
    },

    async close() {
      state = 'closed';
      rejectAll(fail('ACP_CLOSED'));
      const current = child;
      child = null;
      if (!current) return;
      try { current.stdin.end(); } catch { /* already closed */ }
      try { current.kill(); } catch { /* already gone */ }
    },
  };
}
