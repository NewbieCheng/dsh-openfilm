import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createLoginRememberStore } from '../src/login-remember.mjs';

test('login remember encrypts password on disk and round-trips', async () => {
  const home = await mkdtemp(join(tmpdir(), 'nof-remember-'));
  const store = createLoginRememberStore({ home });
  assert.deepEqual(await store.get(), { account: '', password: '', enabled: false });

  await store.set({ account: 'admin@no996ai.cn', password: 'secret-pass-1', enabled: true });
  const again = await store.get();
  assert.equal(again.enabled, true);
  assert.equal(again.account, 'admin@no996ai.cn');
  assert.equal(again.password, 'secret-pass-1');

  const disk = JSON.parse(await readFile(store.file, 'utf8'));
  assert.equal(disk.version, 1);
  assert.equal(disk.enabled, true);
  assert.notEqual(disk.account, 'admin@no996ai.cn');
  assert.notEqual(disk.password, 'secret-pass-1');
  assert.doesNotMatch(JSON.stringify(disk), /secret-pass-1/);

  await store.clear();
  assert.equal((await store.get()).enabled, false);
  assert.equal((await store.get()).password, '');
});

test('login remember rejects empty or short secrets', async () => {
  const home = await mkdtemp(join(tmpdir(), 'nof-remember-bad-'));
  const store = createLoginRememberStore({ home });
  await assert.rejects(() => store.set({ account: '', password: 'abcdef' }), /账号或密码无效/);
  await assert.rejects(() => store.set({ account: 'a@b.c', password: '123' }), /账号或密码无效/);
});
