import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gunzipSync, gzipSync } from 'node:zlib';
import { createToolInstaller, readTarMember } from '../src/tool-installer.mjs';

function block(name, body) {
  const header = Buffer.alloc(512);
  header.write(name, 0, 'utf8');
  header.write('0000644\0', 100, 'utf8');
  header.write(String(body.length).padStart(11, '0') + '\0', 124, 'utf8');
  header[156] = '0'.charCodeAt(0);
  header.write('0000000\0', 148, 'utf8');
  header.write('0000000\0', 156, 'utf8');
  const padded = Buffer.alloc(Math.ceil(body.length / 512) * 512);
  body.copy(padded);
  return Buffer.concat([header, padded]);
}

function tarGz(members) {
  const parts = members.map(([name, body]) => block(name, Buffer.from(body)));
  parts.push(Buffer.alloc(1024));
  return gzipSync(Buffer.concat(parts));
}

const noPackages = () => null;

test('readTarMember finds one file and ignores the rest', () => {
  const tar = gzipSync(Buffer.concat([
    block('package/README.md', Buffer.from('readme')),
    block('package/bin/win32/x64/ffprobe.exe', Buffer.from('FFPROBE')),
    Buffer.alloc(1024),
  ]));
  const found = readTarMember(gunzipSync(tar), 'package/bin/win32/x64/ffprobe.exe');
  assert.equal(found.toString(), 'FFPROBE');
});

test('downloads ffprobe from the npm tarball when the package is absent', async (t) => {
  const home = mkdtempSync(join(tmpdir(), 'openfilm-tools-'));
  t.after(() => rmSync(home, { recursive: true, force: true }));
  const tarball = tarGz([['package/bin/win32/x64/ffprobe.exe', 'BINARY']]);
  const installer = createToolInstaller({
    home, platform: 'win32', arch: 'x64', resolvePackaged: noPackages,
    fetchImpl: async () => ({ ok: true, headers: new Map([['content-length', String(tarball.length)]]), arrayBuffer: async () => tarball }),
  });
  assert.equal((await installer.snapshot()).tools.ffprobe.ready, false);
  await installer.install('ffprobe');
  const snap = await installer.snapshot();
  assert.equal(snap.tools.ffprobe.ready, true);
  assert.equal(snap.tools.ffprobe.source, 'downloaded');
  assert.equal(readFileSync(join(home, 'no996-openfilm', 'tools', 'ffprobe.exe'), 'utf8'), 'BINARY');
});

test('ffmpeg gz is unpacked as a plain binary', async (t) => {
  const home = mkdtempSync(join(tmpdir(), 'openfilm-tools-'));
  t.after(() => rmSync(home, { recursive: true, force: true }));
  const gz = gzipSync(Buffer.from('FFMPEG'));
  const installer = createToolInstaller({
    home, platform: 'win32', arch: 'x64', resolvePackaged: noPackages,
    fetchImpl: async () => ({ ok: true, headers: new Map(), arrayBuffer: async () => gz }),
  });
  await installer.install('ffmpeg');
  assert.equal(readFileSync(join(home, 'no996-openfilm', 'tools', 'ffmpeg.exe'), 'utf8'), 'FFMPEG');
});

test('a failed download is reported and a retry can still succeed', async (t) => {
  const home = mkdtempSync(join(tmpdir(), 'openfilm-tools-'));
  t.after(() => rmSync(home, { recursive: true, force: true }));
  let calls = 0;
  const ok = gzipSync(Buffer.from('FFMPEG'));
  const installer = createToolInstaller({
    home, platform: 'linux', arch: 'x64', resolvePackaged: noPackages,
    fetchImpl: async () => {
      calls += 1;
      if (calls === 1) throw new Error('network down');
      return { ok: true, headers: new Map(), arrayBuffer: async () => ok };
    },
  });
  await installer.install('ffmpeg');
  let snap = await installer.snapshot();
  assert.equal(snap.tools.ffmpeg.ready, false);
  assert.match(snap.tools.ffmpeg.error, /network down/);
  await installer.install('ffmpeg');
  snap = await installer.snapshot();
  assert.equal(snap.tools.ffmpeg.ready, true);
  assert.equal(snap.tools.ffmpeg.error, '');
});

test('a packaged binary needs no network and is reported as packaged', async (t) => {
  const home = mkdtempSync(join(tmpdir(), 'openfilm-tools-'));
  t.after(() => rmSync(home, { recursive: true, force: true }));
  const installer = createToolInstaller({
    home, resolvePackaged: name => (name === 'ffmpeg-static' ? '/opt/ffmpeg' : null),
    fetchImpl: async () => { throw new Error('must not be called'); },
  });
  const snap = await installer.snapshot();
  assert.equal(snap.tools.ffmpeg.ready, true);
  assert.equal(snap.tools.ffmpeg.source, 'packaged');
  await installer.install('ffmpeg');
});
