/**
 * The panel's chat runs `dsh --profile acp`, a separate DSH profile that ships
 * only the built-in providers. The person's own channels live in the profile
 * that hosts this plugin (the desktop one), so that child never sees them: the
 * model menu shows two built-in entries and our default selection is refused,
 * which is why the panel silently falls back to its own `deepseek-v4-flash`.
 *
 * This copies the provider entries (`llm-pi-ai`) from the active profile's
 * `cordis.patch.yml` into the `acp` profile's patch, idempotently. Keys are not
 * copied: entries reference `apiKeyEnv`, and DSH resolves those from the shared
 * credentials file. Only the desktop profile is read; the web profile is left
 * alone.
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { homedir } from 'node:os';

const BEGIN = '# no996-openfilm:begin (model providers copied from the active profile)';
const END = '# no996-openfilm:end';
const ACP_PROFILE = 'acp';

/** The profile this plugin runs in: the one whose bundle list names dsh-openfilm. */
export function activeProfileDir({ env = process.env, home = homedir() } = {}) {
  const explicit = env.DSH_PROFILE_DIR;
  if (typeof explicit === 'string' && explicit && existsSync(join(explicit, 'package.json'))) return explicit;
  const root = join(env.DSH_HOME && env.DSH_HOME.length > 0 ? env.DSH_HOME : join(home, '.dsh'), 'profiles');
  let names = [];
  try { names = readdirSync(root); } catch { return null; }
  for (const name of names) {
    try {
      const pkg = JSON.parse(readFileSync(join(root, name, 'package.json'), 'utf8'));
      if ((pkg?.dsh?.profile?.bundles ?? []).includes('dsh-openfilm')) return join(root, name);
    } catch { /* not a profile */ }
  }
  return null;
}

/** Top-level `- id:` blocks of a loader patch file, filtered to the provider entries. */
export function providerBlocks(text) {
  const blocks = [];
  let current = null;
  for (const line of String(text).split('\n')) {
    if (/^- id: /.test(line)) {
      if (current !== null) blocks.push(current);
      current = line;
    } else if (current !== null) current += '\n' + line;
  }
  if (current !== null) blocks.push(current);
  return blocks
    .filter(block => /^- id: llm-pi-ai\b/m.test(block))
    .map(block => block.replace(/\s+$/, ''));
}

function stripManaged(text) {
  const start = text.indexOf(BEGIN);
  if (start < 0) return text;
  const end = text.indexOf(END, start);
  if (end < 0) return text.slice(0, start);
  return text.slice(0, start) + text.slice(end + END.length).replace(/^\n+/, '');
}

/**
 * @param {{ env?: NodeJS.ProcessEnv, home?: string, logger?: { info?: Function, warn?: Function } }} [options]
 * @returns {{ patched: boolean, providers?: number, reason?: string }}
 */
export function applyAcpModelProviders({ env = process.env, home = homedir(), logger = null } = {}) {
  const active = activeProfileDir({ env, home });
  if (!active) return { patched: false, reason: 'no-active-profile' };
  const targetDir = join(dirname(active), ACP_PROFILE);
  const targetPath = join(targetDir, 'cordis.patch.yml');
  let source = '';
  try { source = readFileSync(join(active, 'cordis.patch.yml'), 'utf8'); } catch { return { patched: false, reason: 'no-profile-patch' }; }
  const blocks = providerBlocks(source);
  if (blocks.length === 0) return { patched: false, reason: 'no-providers' };

  let target = '';
  try { target = readFileSync(targetPath, 'utf8'); } catch { /* created below */ }
  const stripped = stripManaged(target);
  // The default acp patch is an empty YAML array (`[]`); our entries replace it.
  const body = stripped.replace(/^\s*\[\]\s*$/m, '').replace(/\n{3,}/g, '\n\n').trim();
  const next = `${body ? `${body}\n\n` : ''}${BEGIN}\n${blocks.join('\n')}\n${END}\n`;
  if (next === target) return { patched: false, reason: 'current' };
  try {
    mkdirSync(targetDir, { recursive: true });
    writeFileSync(targetPath, next);
  } catch (error) {
    logger?.warn?.('acp-model-providers', { message: String(error?.message || error).slice(0, 120) });
    return { patched: false, reason: 'write-failed' };
  }
  return { patched: true, providers: blocks.length };
}

/**
 * The model the person uses in the sidebar, read from the profile that hosts this
 * plugin: `<profile>/cordis.patch.yml` → the `agent-default-model` entry.
 *
 * Why read the file: `ctx.agentDefaultModel.currentSelection()` is not present in
 * every Host build, and when it is missing the child keeps its own retired
 * default (`deepseek-official/deepseek-v4-flash`), which answers nothing — the
 * turn sits on "still working" forever. A file read costs nothing and the value
 * is the same one the sidebar shows.
 *
 * @returns {{ provider: string, model: string, reasoningEffort?: string } | null}
 */
export function readProfileDefaultModel({ env = process.env, home = homedir() } = {}) {
  const active = activeProfileDir({ env, home });
  if (!active) return null;
  let source = '';
  try { source = readFileSync(join(active, 'cordis.patch.yml'), 'utf8'); } catch { return null; }
  const blocks = [];
  let current = null;
  for (const line of source.split('\n')) {
    if (/^- id: /.test(line)) { if (current !== null) blocks.push(current); current = line; }
    else if (current !== null) current += '\n' + line;
  }
  if (current !== null) blocks.push(current);
  const block = blocks.find(value => /^- id: agent-default-model\b/m.test(value));
  if (!block) return null;
  const field = name => {
    const match = new RegExp(`^\\s+${name}:\\s*(\\S+)\\s*$`, 'm').exec(block);
    return match ? match[1].replace(/^['"]|['"]$/g, '') : undefined;
  };
  const provider = field('provider');
  const model = field('model');
  if (!provider || !model) return null;
  const reasoningEffort = field('reasoningEffort');
  return reasoningEffort ? { provider, model, reasoningEffort } : { provider, model };
}
