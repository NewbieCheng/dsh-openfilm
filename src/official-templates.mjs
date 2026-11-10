import { cp, mkdir, readdir, readFile, stat } from 'node:fs/promises';
import { isAbsolute, join, resolve, sep } from 'node:path';
import { randomBytes } from 'node:crypto';

const TEMPLATE_ID = /^[a-z0-9][a-z0-9-]{1,40}$/;
const MAX_FILES = 4_000;
const MAX_BYTES = 64 * 1024 * 1024;

const failure = (code, message) => Object.assign(new Error(message), { code });

/** Template packages shipped inside the plugin: one folder per template, each
 *  with a manifest.json. Reads metadata only; file contents stay on disk until
 *  an install asks for them. */
export async function listTemplates(root) {
  if (typeof root !== 'string' || !isAbsolute(root)) throw failure('TEMPLATE_ROOT', 'A template root is required');
  let entries;
  try { entries = await readdir(root, { withFileTypes: true }); } catch { return []; }
  const templates = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || !TEMPLATE_ID.test(entry.name)) continue;
    let manifest;
    try { manifest = JSON.parse(await readFile(join(root, entry.name, 'manifest.json'), 'utf8')); } catch { continue; }
    if (!manifest || typeof manifest !== 'object' || manifest.id !== entry.name) continue;
    if (typeof manifest.title !== 'string' || typeof manifest.entry !== 'string' || typeof manifest.mode !== 'string') continue;
    templates.push({
      id: entry.name,
      title: manifest.title.slice(0, 60),
      description: typeof manifest.description === 'string' ? manifest.description.slice(0, 240) : '',
      mode: manifest.mode === 'film' ? 'film' : 'style',
      entry: manifest.entry,
      prompt: typeof manifest.prompt === 'string' ? manifest.prompt.slice(0, 600) : '',
    });
  }
  return templates.sort((a, b) => a.id.localeCompare(b.id));
}

/** Copy one shipped template into a new project folder and register it with
 *  Studio. The source is fixed (vendor/templates/<id>); only the destination
 *  name is generated here, so a template can never overwrite user files. */
export async function installTemplate({ root, id, parentDir, createProject, titleFor }) {
  if (!TEMPLATE_ID.test(String(id))) throw failure('TEMPLATE_INPUT', 'Unknown template');
  const source = resolve(root, id);
  if (!source.startsWith(resolve(root) + sep)) throw failure('TEMPLATE_INPUT', 'Template escapes its root');
  const info = await stat(source).catch(() => null);
  if (!info?.isDirectory()) throw failure('TEMPLATE_INPUT', 'Template is missing');

  let files = 0;
  let bytes = 0;
  const walk = async (dir) => {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      if (entry.name === 'manifest.json') continue;
      const full = join(dir, entry.name);
      if (entry.isDirectory()) await walk(full);
      else if (entry.isFile()) {
        files += 1;
        bytes += (await stat(full)).size;
        if (files > MAX_FILES || bytes > MAX_BYTES) throw failure('TEMPLATE_TOO_LARGE', 'Template exceeds the install limit');
      }
    }
  };
  await walk(source);

  const slug = (titleFor(id) || id).replace(/[^\p{L}\p{N}-]+/gu, '-').replace(/^-+|-+$/g, '').slice(0, 40) || id;
  const target = join(parentDir, `${slug}-${randomBytes(3).toString('hex')}`);
  await mkdir(parentDir, { recursive: true });
  await cp(source, target, { recursive: true, errorOnExist: true, force: false });

  const project = await createProject(target);
  return { projectId: project.id, path: project.path, files, bytes };
}
