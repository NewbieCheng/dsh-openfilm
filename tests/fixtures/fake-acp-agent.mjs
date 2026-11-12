// A stand-in for `dsh --profile acp`: the same newline-delimited JSON-RPC the
// real agent speaks, without a model. Used by tests/acp-client.test.mjs so the
// transport can be exercised without spending a turn.
const mode = process.env.FAKE_ACP_MODE || 'normal';
const imageEnabled = process.env.FAKE_ACP_IMAGE === '1';

let buffer = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', chunk => {
  buffer += chunk;
  let index;
  while ((index = buffer.indexOf('\n')) >= 0) {
    const line = buffer.slice(0, index).trim();
    buffer = buffer.slice(index + 1);
    if (line) handle(JSON.parse(line));
  }
});

const send = message => process.stdout.write(JSON.stringify(message) + '\n');
const result = (id, value) => send({ jsonrpc: '2.0', id, result: value });

let permissionWait = null;
let modelValue = '["p","m1"]';
let effortValue = 'high';
let sendResume = false;
let pendingPrompt = null;
let mcpNames = [];
const queued = [];
const configState = () => [
  { id: 'model', name: 'Model', category: 'model', type: 'select', currentValue: modelValue, options: [
    { group: 'p', name: 'P Group', options: [{ value: '["p","m1"]', name: 'm1' }, { value: '["p","m2"]', name: 'm2' }] },
    { group: 'q', name: 'Q Group', options: [{ value: '["q","q1"]', name: 'q1' }] },
  ] },
  { id: 'reasoning_effort', name: 'Reasoning effort', category: 'thought_level', type: 'select', currentValue: effortValue, options: [{ value: 'off', name: 'Off' }, { value: 'high', name: 'High' }] },
];

function handle(message) {
  if (message.method === undefined && permissionWait !== null && message.id === permissionWait.id) {
    permissionWait.resolve(message.result);
    permissionWait = null;
    return;
  }
  switch (message.method) {
    case 'initialize':
      return result(message.id, {
        protocolVersion: 1,
        agentInfo: { name: 'fake-acp', version: '1' },
        agentCapabilities: { promptCapabilities: { image: imageEnabled, audio: false, embeddedContext: false }, sessionCapabilities: { resume: {}, close: {}, list: {} } },
        authMethods: [],
      });
    case 'session/new':
    case 'session/resume':
      mcpNames = (message.params?.mcpServers ?? []).map(server => server.name);
      sendResume = false;
      return result(message.id, { sessionId: message.params?.sessionId || 'session-fake-1', configOptions: configState() });
    case 'session/list':
      if (process.env.FAKE_ACP_EMPTY_LIST === '1') return result(message.id, { sessions: [] });
      return result(message.id, { sessions: [{ sessionId: 'session-fake-1', cwd: 'C:\\fake' }, { sessionId: 'session-fake-2', cwd: 'C:\\fake' }] });
    case 'session/set_config_option': {
      const { configId, value } = message.params;
      if (configId === 'model') modelValue = value;
      if (configId === 'reasoning_effort') effortValue = value;
      return result(message.id, { configOptions: configState() });
    }
    case 'session/cancel':
      send({ jsonrpc: '2.0', method: 'session/update', params: { sessionId: message.params.sessionId, update: { sessionUpdate: 'usage_update', used: 0 } } });
      if (pendingPrompt !== null) { result(pendingPrompt, { stopReason: 'cancelled' }); pendingPrompt = null; queued.forEach(id => result(id, { stopReason: 'cancelled' })); queued.length = 0; }
      return;
    case 'session/prompt': {
      if (mode === 'exit-on-prompt') { process.exit(7); }
      if (mode === 'hang-on-prompt') { pendingPrompt = message.id; return; }
      const sessionId = message.params.sessionId;
      send({ jsonrpc: '2.0', method: 'session/update', params: { sessionId, update: { sessionUpdate: 'agent_thought_chunk', content: { type: 'text', text: 'thinking…' } } } });
      const kinds = (message.params.prompt ?? []).map(block => block.type).join(',');
      send({ jsonrpc: '2.0', method: 'session/update', params: { sessionId, update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'blocks:' + kinds + (process.env.FAKE_ACP_MCP === '1' ? ' mcp:' + mcpNames.join(',') : '') } } } });
      const permission = new Promise(resolve => { permissionWait = { id: 9001, resolve }; });
      send({ jsonrpc: '2.0', id: 9001, method: 'session/request_permission', params: { sessionId, toolCall: { title: 'write' }, options: [{ optionId: 'allow', name: 'Allow', kind: 'allow_once' }, { optionId: 'deny', name: 'Deny', kind: 'reject_once' }] } });
      pendingPrompt = message.id;
      permission.then(answer => {
        if (pendingPrompt === message.id) pendingPrompt = null;
        result(message.id, { stopReason: answer?.outcome?.outcome === 'selected' ? 'end_turn' : 'cancelled' });
      });
      return;
    }
    default:
      if (message.id !== undefined) send({ jsonrpc: '2.0', id: message.id, error: { code: -32601, message: 'unknown method' } });
  }
}
