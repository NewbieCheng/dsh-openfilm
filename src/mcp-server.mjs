/**
 * The Host's MCP endpoint, so an ACP child can use this plugin's own film tools.
 *
 * Why this exists: the panel talks to `dsh --profile acp`, a separate DSH process.
 * Our `openfilm_*` tools live in *this* Host, and ACP has no way to hand tools to
 * an agent except MCP. `session/new` accepts `mcpServers` entries, DSH's ACP server
 * turns each into a streamable-HTTP MCP client, and that client calls back here.
 *
 * The protocol surface is deliberately small: initialize, tools/list, tools/call
 * and ping. Auth is a per-project bearer token the Host minted for exactly one
 * ACP Session; a missing or unknown token is a plain 401 and never a tool error.
 */
export const MCP_PROTOCOL_VERSION = '2025-11-25';
const TOKENS = /^[A-Za-z0-9_-]{16,120}$/;
const MAX_TOOL_TEXT = 200_000;

const textOf = (tool, args, value) => {
  try {
    if (typeof tool.output?.render === 'function') {
      const parts = tool.output.render(args, value);
      const text = (Array.isArray(parts) ? parts : []).filter(part => part && part.type === 'text' && typeof part.text === 'string')
        .map(part => part.text).join('\n\n');
      if (text) return text;
    }
  } catch { /* fall through to JSON: a renderer bug must not lose the result */ }
  try { return JSON.stringify(value ?? null); } catch { return String(value); }
};

const bounded = value => (typeof value === 'string' && value.length > MAX_TOOL_TEXT ? `${value.slice(0, MAX_TOOL_TEXT)}\n…(truncated)` : value);
const errorResult = (id, code, message) => ({ jsonrpc: '2.0', id, error: { code, message } });
const okResult = (id, result) => ({ jsonrpc: '2.0', id, result });

/**
 * @param {object} deps
 * @param {Array<{name: string, description?: string, parameters?: object, execute: Function, output?: object}>} deps.tools
 * @param {(token: string) => {projectId: string, path: string, agent: object}|undefined} deps.resolveToken
 * @param {{name: string, version: string}} [deps.serverInfo]
 * @param {(event: string, fields?: object) => void} [deps.log]
 */
export function createMcpEndpoint({ tools, resolveToken, serverInfo = { name: 'no996-openfilm', version: '0.13.0' }, log }) {
  if (!Array.isArray(tools) || typeof resolveToken !== 'function') throw new TypeError('tools and resolveToken are required');
  const listed = new Map();
  const catalog = [];
  for (const tool of tools) {
    if (!tool || typeof tool.name !== 'string' || listed.has(tool.name) || typeof tool.execute !== 'function') continue;
    listed.set(tool.name, tool);
    catalog.push({
      name: tool.name,
      ...(typeof tool.description === 'string' && tool.description ? { description: tool.description } : {}),
      inputSchema: tool.parameters && typeof tool.parameters === 'object' ? tool.parameters : { type: 'object', properties: {} },
    });
  }

  const tokenFrom = headers => {
    const raw = headers?.authorization ?? headers?.Authorization;
    if (typeof raw !== 'string') return undefined;
    const match = /^Bearer\s+([A-Za-z0-9_-]{16,120})$/.exec(raw.trim());
    return match && TOKENS.test(match[1]) ? match[1] : undefined;
  };

  const callTool = async (session, name, args) => {
    const tool = listed.get(name);
    if (!tool) return { content: [{ type: 'text', text: `Unknown tool: ${name}` }], isError: true };
    if (args !== undefined && (typeof args !== 'object' || args === null || Array.isArray(args))) {
      return { content: [{ type: 'text', text: 'Tool arguments must be an object' }], isError: true };
    }
    try {
      const value = await tool.execute(args ?? {}, { agent: session.agent, signal: undefined });
      return { content: [{ type: 'text', text: bounded(textOf(tool, args, value)) }] };
    } catch (error) {
      // Tool failures are model-visible results, never transport errors.
      void log?.('mcp-tool-failed', { tool: name, code: String(error?.code ?? error?.name ?? 'NONE').slice(0, 40) });
      return { content: [{ type: 'text', text: bounded(String(error?.message ?? 'The tool failed')) }], isError: true };
    }
  };

  const handleOne = async (session, message) => {
    if (!message || typeof message !== 'object' || Array.isArray(message) || message.jsonrpc !== '2.0') {
      return errorResult(null, -32600, 'Invalid Request');
    }
    const { id, method, params } = message;
    if (typeof method !== 'string') return errorResult(id ?? null, -32600, 'Invalid Request');
    const isNotification = id === undefined || id === null;
    if (isNotification) {
      // notifications/initialized and friends need no answer.
      return undefined;
    }
    if (method === 'initialize') {
      const requested = typeof params?.protocolVersion === 'string' ? params.protocolVersion : '';
      return okResult(id, {
        protocolVersion: /^\d{4}-\d{2}-\d{2}$/.test(requested) ? requested : MCP_PROTOCOL_VERSION,
        capabilities: { tools: {} },
        serverInfo,
      });
    }
    if (method === 'ping') return okResult(id, {});
    if (method === 'tools/list') return okResult(id, { tools: catalog });
    if (method === 'tools/call') {
      const name = params?.name;
      if (typeof name !== 'string') return errorResult(id, -32602, 'Invalid params: tool name is required');
      return okResult(id, await callTool(session, name, params?.arguments));
    }
    return errorResult(id, -32601, `Method not found: ${method}`);
  };

  return Object.freeze({
    catalog,
    /** @returns {Promise<{status: number, body?: object}>} */
    async handle({ headers, body } = {}) {
      const token = tokenFrom(headers);
      const session = token ? resolveToken(token) : undefined;
      if (!session) return { status: 401, body: { error: 'unauthorized' } };
      let payload;
      try { payload = typeof body === 'string' ? JSON.parse(body) : body; } catch { return { status: 400, body: { error: 'invalid json' } }; }
      if (Array.isArray(payload)) {
        const answers = [];
        for (const message of payload) {
          const answer = await handleOne(session, message);
          if (answer) answers.push(answer);
        }
        return answers.length === 0 ? { status: 202 } : { status: 200, body: answers };
      }
      const answer = await handleOne(session, payload);
      return answer ? { status: 200, body: answer } : { status: 202 };
    },
  });
}

/** The `mcpServers` entry an ACP Session needs to reach this endpoint. */
export function mcpServerEntry({ url, token }) {
  return { type: 'http', name: 'no996-openfilm', url, headers: [{ name: 'Authorization', value: `Bearer ${token}` }] };
}

/** Tokens are minted per Session and never reused. */
export function createMcpTokens({ randomBytes, now = Date.now, ttlMs = 12 * 60 * 60 * 1000 }) {
  const table = new Map();
  const mint = (record) => {
    const token = randomBytes(24).toString('base64url');
    table.set(token, { ...record, at: now() });
    return token;
  };
  return Object.freeze({
    mint,
    resolve(token) {
      const entry = table.get(token);
      if (!entry) return undefined;
      if (now() - entry.at > ttlMs) { table.delete(token); return undefined; }
      return entry;
    },
    revoke(token) { table.delete(token); },
    revokeProject(projectId) {
      for (const [token, entry] of table) if (entry.projectId === projectId) table.delete(token);
    },
    size() { return table.size; },
  });
}
