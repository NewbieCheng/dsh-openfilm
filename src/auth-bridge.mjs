/**
 * Browser → Host auth bridge.
 *
 * Tokens never leave the Host. The page may ask for status / captcha / login /
 * register / verification / reset / logout. Admission matches the archive bridge:
 * authenticated DSH browser peer + this Host's exact authority.
 */
import { parseAuthActionBody } from './workbench-auth.mjs';

const ACTIONS = new Set(['status', 'captcha', 'login', 'register', 'verification-code', 'reset-password', 'logout']);

function reply(res, status, value) {
  const body = JSON.stringify(value);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
  }).end(body);
}

function mapError(error) {
  const status = Number(error?.status) || 400;
  return {
    status: status >= 100 && status <= 599 ? status : 400,
    body: {
      error: String(error?.code || 'AUTH'),
      message: String(error?.message || '请求失败').slice(0, 200),
      ...(error?.details && typeof error.details === 'object' ? { details: error.details } : {}),
    },
  };
}

function publicStatus(result) {
  if (!result || typeof result !== 'object') return result;
  return {
    loggedIn: result.loggedIn === true,
    ...(typeof result.baseUrl === 'string' ? { baseUrl: result.baseUrl } : {}),
    ...(typeof result.userId === 'number' ? { userId: result.userId } : {}),
    ...(typeof result.account === 'string' ? { account: result.account } : {}),
    ...(typeof result.displayName === 'string' ? { displayName: result.displayName } : {}),
    ...(typeof result.expiresAt === 'string' ? { expiresAt: result.expiresAt } : {}),
    ...(result.ok === true ? { ok: true } : {}),
  };
}

export async function dispatchAuthAction(auth, value) {
  if (!auth) throw Object.assign(new Error('账号服务不可用'), { code: 'UNAVAILABLE', status: 503 });
  const action = typeof value?.action === 'string' ? value.action : '';
  if (!ACTIONS.has(action)) throw Object.assign(new Error('无效操作'), { code: 'INPUT', status: 400 });
  switch (action) {
    case 'status':
      return publicStatus(await auth.status());
    case 'captcha':
      return auth.captcha(value.type);
    case 'login':
      return publicStatus(await auth.login({
        account: value.account,
        password: value.password,
        captchaId: value.captchaId ?? value.captcha_id,
        captchaCode: value.captchaCode ?? value.captcha_code,
      }));
    case 'register':
      return publicStatus(await auth.register({
        account: value.account,
        password: value.password,
        code: value.code,
        inviteCode: value.inviteCode ?? value.invite_code,
        displayName: value.displayName ?? value.display_name,
      }));
    case 'verification-code':
      return auth.requestVerificationCode({
        account: value.account,
        purpose: value.purpose,
        captchaId: value.captchaId ?? value.captcha_id,
        captchaCode: value.captchaCode ?? value.captcha_code,
        locale: value.locale,
      });
    case 'reset-password':
      return publicStatus(await auth.resetPassword({
        account: value.account,
        code: value.code,
        newPassword: value.newPassword ?? value.new_password,
      }));
    case 'logout':
      return publicStatus(await auth.logout());
    default:
      throw Object.assign(new Error('无效操作'), { code: 'INPUT', status: 400 });
  }
}

export function registerAuthBridge(ctx, { webOrigin, auth, isDisposed }) {
  const web = new URL(webOrigin);
  return ctx.webServer.register({
    kind: 'exact',
    path: '/api/no996-openfilm/auth',
    async handler(req, res) {
      if (req.method !== 'POST') return reply(res, 405, { error: 'METHOD' });
      if (isDisposed()) return reply(res, 503, { error: 'UNAVAILABLE' });
      const admission = ctx.connection.admit({ headers: req.headers });
      if ('rejection' in admission) return reply(res, admission.rejection, { error: 'AUTH' });
      if (admission.peer.id !== ctx.connection.browserPeer.id) return reply(res, 403, { error: 'AUTH' });
      let host;
      try { host = new URL(`http://${req.headers.host}`); } catch { return reply(res, 403, { error: 'ORIGIN' }); }
      if (!['127.0.0.1', 'localhost'].includes(host.hostname) || host.port !== web.port || host.host !== req.headers.host || host.pathname !== '/') {
        return reply(res, 403, { error: 'ORIGIN' });
      }
      const surface = req.headers['x-no996-surface'];
      const desktop = surface === 'dsh-app://app' || surface === 'app://app';
      const origin = req.headers.origin;
      if (origin && origin !== host.origin && !(desktop && origin === surface)) return reply(res, 403, { error: 'ORIGIN' });
      if (!/^application\/json(?:\s*;|$)/i.test(String(req.headers['content-type'] || ''))) {
        return reply(res, 415, { error: 'CONTENT_TYPE' });
      }
      try {
        let size = 0;
        const chunks = [];
        for await (const chunk of req) {
          size += chunk.length;
          if (size > 64 * 1024) return reply(res, 413, { error: 'BODY_LIMIT' });
          chunks.push(chunk);
        }
        const value = parseAuthActionBody(Buffer.concat(chunks).toString('utf8'));
        const result = await dispatchAuthAction(auth, value);
        if (isDisposed()) return reply(res, 503, { error: 'UNAVAILABLE' });
        return reply(res, 200, result);
      } catch (error) {
        if (error?.code === 'BODY_LIMIT') return reply(res, 413, { error: 'BODY_LIMIT' });
        if (error?.code === 'INPUT') return reply(res, 400, { error: 'INPUT', message: error.message });
        const mapped = mapError(error);
        if (!res.headersSent && !res.destroyed) reply(res, mapped.status, mapped.body);
      }
    },
  });
}
