import { draftFilm } from './film-draft.mjs';
import { MAX_SOURCE_BYTES } from './film-source.mjs';

const fail = (code, message) => Object.assign(new Error(message), { code });
const bytes = text => new TextEncoder().encode(text).byteLength;

/**
 * Trusted Host caller supplies ctx and agent, never values deserialized from a client.
 * Publication and the version guard are provider guarantees: single-file publication
 * is atomic, but the provider contract does not promise cross-process atomic CAS.
 * lstat/contains checks cannot prevent concurrent directory or symlink replacement;
 * a provider with directory-handle confinement is needed to close that race. The bare
 * provider ignores sandboxPolicy, so isolation from hostile filesystem writers cannot
 * be claimed. This function is not an authorization boundary for an untrusted caller.
 */
export async function saveSessionFilm(ctx, agent, { project, expectedVersion, operations } = {}) {
  if (!agent?.session || !ctx?.fs || !ctx?.sandboxPolicy || !ctx?.workingDirectory) {
    throw fail('AUTHORITY', 'A trusted agent session and Host services are required');
  }
  const { fs } = ctx;
  const session = agent.session;
  const policy = ctx.sandboxPolicy.resolve({ session });
  if (!policy || !['read-only', 'workspace-write', 'danger-full-access'].includes(policy.mode) || typeof policy.workspaceRoot !== 'string' || !policy.workspaceRoot) throw fail('AUTHORITY', 'Invalid session policy');
  if (policy.mode === 'read-only') throw fail('READ_ONLY', 'The session policy does not allow writes');
  if (typeof expectedVersion !== 'string' || !expectedVersion) throw fail('VERSION', 'expectedVersion is required');
  if (typeof project !== 'string' || !project || project.includes('\0') || /^[\\/]/.test(project) || /^[a-z]:/i.test(project) || project.split(/[\\/]/).some(p => !p || p === '.' || p === '..' || p.includes(':'))) throw fail('PATH', 'project must be a relative directory without traversal');
  const cwd = ctx.workingDirectory.get(session);
  if (typeof cwd !== 'string' || !cwd) throw fail('AUTHORITY', 'Session working directory is unavailable');
  const workspace = await fs.resolve(cwd);
  const workspaceInfo = await fs.stat(workspace);
  if (!workspaceInfo || workspaceInfo.type !== 'directory') throw fail('PATH', 'Session working directory must exist');
  if (policy.mode === 'workspace-write') {
    const root = await fs.resolve(policy.workspaceRoot);
    if (!await fs.contains(root, workspace)) throw fail('PATH', 'Session working directory is outside its policy root');
  }
  const base = fs.processPath(workspace);
  if (typeof base !== 'string' || !base) throw fail('AUTHORITY', 'Workspace has no provider process path');
  let rel = '';
  for (const part of project.split(/[\\/]/)) {
    rel = rel ? `${rel}/${part}` : part;
    const info = await fs.lstat(rel, { cwd: base });
    if (!info || info.type !== 'directory') throw fail('PATH', 'Project directories must exist and not be links');
    const dir = await fs.resolve(rel, { cwd: base });
    if (!await fs.contains(workspace, dir)) throw fail('PATH', 'Project is outside workspace');
  }
  const path = `${rel}/film.html`;
  const entry = await fs.lstat(path, { cwd: base });
  if (!entry) throw fail('FS_NOT_FOUND', 'film.html does not exist');
  if (entry.type !== 'file') throw fail('PATH', 'film.html must be a regular file, not a link');
  const target = await fs.resolve(path, { cwd: base });
  if (!await fs.contains(workspace, target)) throw fail('PATH', 'film.html is outside workspace');
  const before = await fs.stat(target);
  if (!before || before.type !== 'file') throw fail('PATH', 'film.html must be an existing regular file');
  if (typeof before.version !== 'string' || !before.version || before.version !== expectedVersion) throw fail('FS_STALE_VERSION', 'film.html has changed');
  if (!Number.isSafeInteger(before.size) || before.size < 0 || before.size > MAX_SOURCE_BYTES) throw fail('FS_TOO_LARGE', 'film.html size is unknown or exceeds limit');
  const data = await fs.readBytes(target, undefined, MAX_SOURCE_BYTES);
  if (!(data instanceof Uint8Array) || data.byteLength > MAX_SOURCE_BYTES) throw fail('FS_TOO_LARGE', 'Invalid or oversized film.html response');
  let source;
  try { source = new TextDecoder('utf-8', { fatal: true }).decode(data); } catch { throw fail('INVALID_FILM', 'film.html is not UTF-8'); }
  const after = await fs.stat(target);
  if (!after || after.type !== 'file' || after.version !== expectedVersion) throw fail('FS_STALE_VERSION', 'film.html changed while reading');
  const draft = draftFilm({ source, operations });
  if (bytes(draft.text) > MAX_SOURCE_BYTES) throw fail('FS_TOO_LARGE', 'Edited film.html exceeds limit');
  const result = await fs.writeText(target, draft.text, { kind: 'replaceIfVersion', version: expectedVersion }, undefined, policy);
  return { ...draft, version: result.version };
}
