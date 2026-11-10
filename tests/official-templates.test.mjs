import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, readdir, rm, symlink, open } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { installTemplate } from '../src/official-templates.mjs';

async function fixture(t) {
  const base = await mkdtemp(join(tmpdir(), 'openfilm-template-test-'));
  t.after(() => rm(base, { recursive: true, force: true }));
  const root = join(base, 'templates');
  const source = join(root, 'sample');
  const parentDir = join(base, 'projects');
  await mkdir(source, { recursive: true });
  await mkdir(parentDir);
  const args = { root, parentDir, id: 'sample', titleFor: () => '中文 film', createProject: async path => ({ id: 'project', path }) };
  return { base, root, source, parentDir, args };
}

test('copies and counts every actual file including nested manifests', async t => {
  const { source, parentDir, args } = await fixture(t);
  await mkdir(join(source, 'nested'));
  await writeFile(join(source, 'manifest.json'), '{}');
  await writeFile(join(source, 'nested', 'manifest.json'), 'nested');
  await writeFile(join(source, 'film.html'), 'hello');
  const a = await installTemplate(args);
  const b = await installTemplate(args);
  assert.notEqual(a.path, b.path);
  assert.equal(a.projectId, 'project');
  assert.equal(a.files, 3);
  assert.equal(a.bytes, 13);
  assert.equal(await readFile(join(a.path, 'nested', 'manifest.json'), 'utf8'), 'nested');
  assert.equal((await readdir(parentDir)).length, 2);
});

test('rejects a symbolic link before registering or creating a target', async t => {
  const { source, parentDir, args, base } = await fixture(t);
  await writeFile(join(base, 'outside'), 'private');
  try { await symlink(join(base, 'outside'), join(source, 'link')); }
  catch (error) { if (['EPERM', 'EACCES', 'ENOSYS'].includes(error.code)) return t.skip('symbolic links unavailable'); throw error; }
  let called = false;
  args.createProject = async () => { called = true; };
  await assert.rejects(installTemplate(args), { code: 'TEMPLATE_INPUT' });
  assert.equal(called, false);
  assert.deepEqual(await readdir(parentDir), []);
  assert.equal(await readFile(join(base, 'outside'), 'utf8'), 'private');
});

test('counts manifest bytes toward the limit', async t => {
  const { source, parentDir, args } = await fixture(t);
  const f = await open(join(source, 'manifest.json'), 'w');
  try { await f.truncate(64 * 1024 * 1024 + 1); } finally { await f.close(); }
  await assert.rejects(installTemplate(args), { code: 'TEMPLATE_TOO_LARGE' });
  assert.deepEqual(await readdir(parentDir), []);
});

test('registration failure retains the project and reports uncertainty', async t => {
  const { source, args } = await fixture(t);
  await writeFile(join(source, 'film.html'), 'film');
  args.createProject = async path => { await writeFile(join(path, 'studio-data'), 'registered'); throw new Error('connection lost'); };
  let failure;
  await assert.rejects(installTemplate(args), error => { failure = error; return true; });
  assert.equal(failure.code, 'TEMPLATE_REGISTRATION_UNCERTAIN');
  assert.equal(failure.residual, true);
  assert.equal(failure.registrationUnknown, true);
  assert.match(failure.message, /No files were deleted/);
  assert.equal(await readFile(join(failure.targetPath, 'film.html'), 'utf8'), 'film');
  assert.equal(await readFile(join(failure.targetPath, 'studio-data'), 'utf8'), 'registered');
});

test('rejects project parents inside a template', async t => {
  const { source, args } = await fixture(t);
  args.parentDir = source;
  await assert.rejects(installTemplate(args), { code: 'TEMPLATE_INPUT' });
});
