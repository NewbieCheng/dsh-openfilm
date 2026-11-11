// Real registration check against the shipped openfilm 0.3.1 Studio server.
// Everything happens under a temporary OPENFILM_HOME; no user library, no server,
// no model. `openProject` is the exact function Studio's POST /api/projects calls.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import { installTemplate } from '../src/official-templates.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const templates = join(root, 'vendor', 'templates');
// openfilm does not export this subpath, so the test loads the installed file
// directly and skips when the package is not installed at the expected place.
const server = join(root, 'node_modules', 'openfilm', 'studio', 'server', 'projects.mjs');

test('each bundled template registers as a real OpenFilm project', { skip: !existsSync(server) && 'install dependencies first' }, async t => {
  const temp = mkdtempSync(join(tmpdir(), 'openfilm-register-'));
  // Set before the Studio server module is imported: it resolves these once.
  process.env.OPENFILM_HOME = join(temp, 'home');
  process.env.OPENFILM_SHARED_HOME = join(temp, 'home');
  t.after(() => rmSync(temp, { recursive: true, force: true }));

  const { openProject } = await import(pathToFileURL(server).href);
  // Guard: if this build ignores OPENFILM_HOME, the test would write into the
  // person's real Studio state. Verify isolation before touching anything.
  const locations = await import(pathToFileURL(join(root, 'node_modules', 'openfilm', 'src', 'locations.mjs')).href);
  assert.equal(locations.studioHomeDir(), process.env.OPENFILM_HOME, 'Studio home must follow OPENFILM_HOME');
  const ids = [];
  for (const id of ['replica-film', 'sketchnote', 'paper-texture']) {
    const installed = await installTemplate({
      root: templates,
      id,
      parentDir: join(temp, 'library'),
      createProject: async path => {
        const project = await openProject(path);
        return { id: project.id, path: project.path };
      },
      titleFor: () => id,
    });
    assert.match(installed.projectId, /^[A-Za-z0-9_-]{6,40}$/, `${id} project id`);
    // Studio must leave our film.html alone and record its own .film/ folder.
    assert.match(readFileSync(join(installed.path, 'film.html'), 'utf8'), /shot-01/, `${id} keeps the template film`);
    assert.equal(existsSync(join(installed.path, '.film')), true, `${id} gets .film/`);
    ids.push(installed.projectId);
  }
  // Persistence: a separate process, same OPENFILM_HOME, must find all three.
  const script = 'const m = await import("' + pathToFileURL(server).href + '");'
    + 'const listed = await m.listProjects();'
    + 'process.stdout.write(JSON.stringify(listed.map(project => project.id)));';
  const child = spawnSync(process.execPath, ['--input-type=module', '-e', script], {
    cwd: root, timeout: 60000, encoding: 'utf8',
    env: { ...process.env, OPENFILM_HOME: join(temp, 'home'), OPENFILM_SHARED_HOME: join(temp, 'home') },
  });
  assert.equal(child.status, 0, child.stderr);
  const listed = JSON.parse(child.stdout);
  for (const id of ids) assert.ok(listed.includes(id), `${id} survives a restart`);
});
