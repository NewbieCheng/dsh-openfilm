import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createProjectFiles, openCommand, projectFilePath, relativeProjectPath } from '../src/project-files.mjs';

const ID = 'film123';
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

async function project() {
  const root = await mkdtemp(join(tmpdir(), 'dsh-openfilm-files-'));
  await mkdir(join(root, 'assets', 'music'), { recursive: true });
  await writeFile(join(root, 'assets', 'contact.png'), PNG);
  await writeFile(join(root, 'assets', 'music', 'beat-120.mp3'), Buffer.from('ID3'));
  await writeFile(join(root, 'film.mp4'), Buffer.from('mp4'));
  return root;
}

test('a transcript path is accepted in the forms markdown writes', () => {
  assert.equal(relativeProjectPath('assets/contact.png'), 'assets/contact.png');
  assert.equal(relativeProjectPath('<.film/cache/look/sheet.png>'), '.film/cache/look/sheet.png');
  assert.equal(relativeProjectPath('./film.mp4'), 'film.mp4');
  assert.equal(relativeProjectPath('assets\\music\\beat-120.mp3'), 'assets/music/beat-120.mp3');
  assert.equal(relativeProjectPath('  film.mp4  '), 'film.mp4');
});

test('a path that could leave the project is refused', () => {
  for (const value of ['', ' ', '/etc/passwd', '../secret.png', 'assets/../../x.png', 'C:/Users/x.png',
    '\\\\server\\share\\x.png', 'a//b.png', './', 'assets/./x.png', undefined, null, 42,
    'a\u0000b.png', 'x'.repeat(500)]) {
    assert.equal(relativeProjectPath(value), null, String(value));
  }
});

test('the joined path stays under the root', () => {
  const root = 'C:\\work\\project';
  assert.equal(projectFilePath(root, 'assets/a.png'), 'C:\\work\\project\\assets\\a.png');
  assert.throws(() => projectFilePath(root, '../a.png'), { code: 'PROJECT_FILE_PATH' });
});

test('the desktop command hands the file to its owner', () => {
  const file = 'C:\\work\\project\\film.mp4';
  assert.deepEqual(openCommand('win32', file, false), { command: 'explorer.exe', args: [file] });
  assert.deepEqual(openCommand('win32', file, true), { command: 'explorer.exe', args: ['/select,' + file] });
  assert.deepEqual(openCommand('darwin', file, false), { command: 'open', args: [file] });
  assert.deepEqual(openCommand('darwin', file, true), { command: 'open', args: ['-R', file] });
  assert.deepEqual(openCommand('linux', file, false), { command: 'xdg-open', args: [file] });
});

test('an image is read from the project, and only an image', async (t) => {
  const root = await project();
  t.after(() => rm(root, { recursive: true, force: true }));
  const files = createProjectFiles({ resolveProject: async () => ({ projectId: ID, path: root }) });
  const image = await files.read({ projectId: ID, path: 'assets/contact.png' });
  assert.equal(image.type, 'image/png');
  assert.deepEqual(image.bytes, PNG);
  await assert.rejects(files.read({ projectId: ID, path: 'film.mp4' }), { code: 'PROJECT_FILE_TYPE' });
  await assert.rejects(files.read({ projectId: ID, path: 'assets/missing.png' }), { code: 'PROJECT_FILE_MISSING' });
  await assert.rejects(files.read({ projectId: ID, path: '../x.png' }), { code: 'PROJECT_FILE_PATH' });
});

test('a file is handed to the operating system without waiting for it', async (t) => {
  const root = await project();
  t.after(() => rm(root, { recursive: true, force: true }));
  const calls = [];
  const files = createProjectFiles({
    resolveProject: async () => ({ projectId: ID, path: root }),
    platform: 'win32',
    spawn: (command, args, options) => { calls.push({ command, args, options }); return { on() {}, unref() {} }; },
  });
  assert.deepEqual(await files.open({ projectId: ID, path: 'film.mp4' }), { opened: true, folder: false });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].command, 'explorer.exe');
  assert.deepEqual(calls[0].options, { detached: true, stdio: 'ignore', windowsHide: true });
  // The service hands over the resolved path, so a short (8.3) temp root becomes its long form.
  assert.equal(calls[0].args[0], await realpath(join(root, 'film.mp4')));

  await files.open({ projectId: ID, path: 'assets', reveal: true });
  assert.deepEqual(calls[1].args, ['/select,' + await realpath(join(root, 'assets'))]);
});

test('a project Studio no longer lists opens nothing', async (t) => {
  const root = await project();
  t.after(() => rm(root, { recursive: true, force: true }));
  const calls = [];
  const files = createProjectFiles({
    resolveProject: async () => { throw new Error('Project unavailable'); },
    spawn: (...args) => { calls.push(args); return { on() {}, unref() {} }; },
  });
  await assert.rejects(files.open({ projectId: ID, path: 'film.mp4' }), /Project unavailable/);
  await assert.rejects(files.read({ projectId: ID, path: 'assets/contact.png' }), /Project unavailable/);
  assert.equal(calls.length, 0);
});

test('an oversized picture is refused instead of read', async () => {
  const files = createProjectFiles({
    resolveProject: async () => ({ projectId: ID, path: 'C:\\work\\project' }),
    realpath: async (value) => value,
    stat: async () => ({ isFile: () => true, isDirectory: () => false, size: 25 * 1024 * 1024 }),
    readFile: async () => { throw new Error('must not read'); },
  });
  await assert.rejects(files.read({ projectId: ID, path: 'assets/big.png' }), { code: 'PROJECT_FILE_SIZE' });
});
