/**
 * Remember last workbench login on this machine (Host only).
 * Account + password live under `$DSH_HOME/no996-openfilm/` with AES-256-GCM
 * and a local key file (mode 0o600). Never log the password; the browser only
 * receives plaintext over same-origin official-rpc when filling the login form.
 */
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { homedir } from 'node:os';

const VERSION = 1;
const ACCOUNT_MAX = 160;
const PASSWORD_MAX = 128;

function dshHome(home) {
  return home || process.env.DSH_HOME || join(homedir(), '.dsh');
}

function publicError(code, message, status = 400) {
  const error = new Error(message || code);
  error.code = code;
  error.status = status;
  return error;
}

export function createLoginRememberStore({ home } = {}) {
  const root = join(dshHome(home), 'no996-openfilm');
  const keyFile = join(root, 'login-remember.key');
  const dataFile = join(root, 'login-remember.json');
  let keyPromise = null;

  async function ensureKey() {
    if (keyPromise) return keyPromise;
    keyPromise = (async () => {
      await mkdir(root, { recursive: true });
      try {
        const raw = await readFile(keyFile);
        if (raw.length === 32) return raw;
      } catch { /* create */ }
      const key = randomBytes(32);
      const tmp = `${keyFile}.${process.pid}.tmp`;
      await writeFile(tmp, key, { mode: 0o600 });
      await rename(tmp, keyFile);
      return key;
    })();
    try {
      return await keyPromise;
    } catch (error) {
      keyPromise = null;
      throw error;
    }
  }

  function encrypt(key, plaintext) {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', key, iv);
    const enc = Buffer.concat([cipher.update(String(plaintext), 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return Buffer.concat([iv, tag, enc]).toString('base64');
  }

  function decrypt(key, payload) {
    const buf = Buffer.from(String(payload || ''), 'base64');
    if (buf.length < 12 + 16 + 1) throw publicError('REMEMBER_CORRUPT', '本机记住的登录信息已损坏', 400);
    const iv = buf.subarray(0, 12);
    const tag = buf.subarray(12, 28);
    const data = buf.subarray(28);
    const decipher = createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8');
  }

  async function writeAtomic(path, content) {
    await mkdir(dirname(path), { recursive: true });
    const tmp = `${path}.${process.pid}.tmp`;
    await writeFile(tmp, content, { encoding: 'utf8', mode: 0o600 });
    await rename(tmp, path);
  }

  return {
    file: dataFile,
    async get() {
      try {
        const key = await ensureKey();
        const raw = JSON.parse(await readFile(dataFile, 'utf8'));
        if (!raw || raw.version !== VERSION || typeof raw.account !== 'string' || typeof raw.password !== 'string') {
          return { account: '', password: '', enabled: false };
        }
        const account = decrypt(key, raw.account).slice(0, ACCOUNT_MAX);
        const password = decrypt(key, raw.password).slice(0, PASSWORD_MAX);
        return {
          account,
          password,
          enabled: raw.enabled !== false,
        };
      } catch {
        return { account: '', password: '', enabled: false };
      }
    },
    async set({ account, password, enabled = true } = {}) {
      const acc = String(account || '').trim().slice(0, ACCOUNT_MAX);
      const pass = String(password || '').slice(0, PASSWORD_MAX);
      if (!acc || pass.length < 6) throw publicError('REMEMBER_INPUT', '账号或密码无效', 400);
      if (enabled === false) return this.clear();
      const key = await ensureKey();
      const payload = {
        version: VERSION,
        enabled: true,
        account: encrypt(key, acc),
        password: encrypt(key, pass),
        updatedAt: new Date().toISOString(),
      };
      await writeAtomic(dataFile, `${JSON.stringify(payload)}\n`);
      return { ok: true, account: acc, enabled: true };
    },
    async clear() {
      try {
        await writeAtomic(dataFile, `${JSON.stringify({ version: VERSION, enabled: false })}\n`);
      } catch { /* ignore */ }
      return { ok: true, enabled: false };
    },
  };
}
