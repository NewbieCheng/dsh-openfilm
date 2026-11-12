import { mkdtempSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

/**
 * Studio 级抽帧验证：不是无头浏览器直开页面，而是让**同一个 Studio 渲染器**
 * 去画模板装成的项目。它复刻 openfilm_frame 的请求（/api/projects/:id/media），
 * 所以比"页面能打开"更接近用户看到的成片。
 *
 *   node scripts/studio-frame-check.mjs [templateId] [at]
 */

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const templateId = process.argv[2] || 'motion-styles';
const at = Number(process.argv[3] ?? 2);
const temp = mkdtempSync(join(tmpdir(), 'openfilm-studio-frame-'));
process.env.OPENFILM_HOME = join(temp, 'home');
process.env.OPENFILM_SHARED_HOME = join(temp, 'home');

let studio;
try {
  const { startStudio } = await import('openfilm/studio');
  studio = await startStudio({ port: 0, advertise: false, stays: true, openBrowser: () => {} });

  const { installTemplate } = await import('../src/official-templates.mjs');
  const { openProject } = await import(pathToFileURL(join(root, 'node_modules', 'openfilm', 'studio', 'server', 'projects.mjs')).href);
  const installed = await installTemplate({
    root: join(root, 'vendor', 'templates'),
    id: templateId,
    parentDir: join(temp, 'library'),
    createProject: async (path) => {
      const project = await openProject(path);
      return { id: project.id, path: project.path };
    },
    titleFor: () => templateId,
  });

  const url = new URL('/api/projects/' + encodeURIComponent(installed.projectId) + '/media', 'http://127.0.0.1:' + studio.port);
  url.searchParams.set('what', 'frame');
  url.searchParams.set('path', 'film.html');
  url.searchParams.set('ms', String(Math.round(at * 1000)));
  url.searchParams.set('w', '1920');
  const response = await fetch(url, { headers: { 'x-studio-key': studio.key, 'accept-encoding': 'identity' } });
  if (!response.ok) throw new Error('Studio refused frame: HTTP ' + response.status + ' ' + (await response.text()).slice(0, 200));
  const bytes = new Uint8Array(await response.arrayBuffer());
  const out = join(root, '.tmp-frames', 'studio-' + templateId + '-t' + at + '.jpg');
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, bytes);
  console.log(JSON.stringify({ templateId, projectId: installed.projectId, at, bytes: bytes.byteLength, out, type: response.headers.get('content-type') }, null, 1));
} finally {
  if (studio) await studio.close().catch(() => {});
  rmSync(temp, { recursive: true, force: true });
}
