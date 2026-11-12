/**
 * Workbench login gate for the video panel.
 *
 * Visual: film timeline stage + paper form (subject matter), branded with
 * workbench navy/orange and the official「不」symbol.
 * Auth UX: same as 清流/工作台 — click-captcha modal only when submitting
 * login or requesting an email code; tokens never reach this page.
 */
import { authAction } from './auth-client.mjs';
import { BRAND_SYMBOL_COLOR_SVG } from './brand-assets.mjs';
import { createCaptchaChallenge } from './captcha-challenge.mjs';

const CSS = `
.nof-login{
  --night:#05060f;--panel:#0a1224;--line:#1c2a44;--text:#f3eee4;--dim:#8d90a6;
  --brand:#051D43;--orange:#FF6400;--orange-deep:#d45500;
  --paper:#f5f0e5;--paper-2:#ebe4d2;--ink:#18171c;--ink-dim:#6d6a62;--err:#a33a2a;
  --p:0;--tlh:138px;--lab:56px;--sun-d:min(62vmin,560px);
  --hand:"Ma Shan Zheng","STKaiti","KaiTi",cursive;
  --sans:"Noto Sans SC","PingFang SC","Microsoft YaHei",sans-serif;
  position:absolute;inset:0;overflow:hidden;background:var(--night);color:var(--text);
  font-family:var(--sans);box-sizing:border-box
}
.nof-login *,.nof-login *::before,.nof-login *::after{box-sizing:border-box}
.nof-login .ic{width:18px;height:18px;flex:none;fill:none;stroke:currentColor;stroke-width:1.5;stroke-linecap:round;stroke-linejoin:round}
.nof-login .sky,.nof-login .sun,.nof-login .stars,.nof-login .grain{position:absolute;inset:0;pointer-events:none}
.nof-login .sky.day{background:linear-gradient(180deg,#051D43 0%,#0b1a33 48%,#3a2418 100%)}
.nof-login .sky.night{background:linear-gradient(180deg,#02040c 0%,#051018 70%,#0c1528 100%);opacity:calc(var(--p) * var(--p));transition:opacity 1.4s ease}
.nof-login .sun{inset:auto;left:68%;width:var(--sun-d);height:var(--sun-d);margin-left:calc(var(--sun-d) / -2);bottom:calc(var(--tlh) - var(--sun-d) * .62 + (1 - var(--p)) * (var(--sun-d) * .62 + 30vh));transition:bottom 1.4s cubic-bezier(.5,0,.2,1)}
.nof-login .sun svg{width:100%;height:100%;overflow:visible;display:block}
.nof-login .stars{opacity:calc((var(--p) - .55) * 2.2);transition:opacity 1.4s}
.nof-login .stars i{position:absolute;width:2px;height:2px;border-radius:50%;background:var(--orange);animation:nof-tw 3s infinite alternate}
@keyframes nof-tw{from{opacity:.2}to{opacity:.9}}
.nof-login .grain{opacity:.1;mix-blend-mode:overlay;background:url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='180' height='180'><filter id='n'><feTurbulence baseFrequency='.85' numOctaves='2' stitchTiles='stitch'/></filter><rect width='100%' height='100%' filter='url(%23n)'/></svg>")}
.nof-login .brand{position:absolute;top:max(18px,env(safe-area-inset-top,0px));left:clamp(18px,3vw,36px);z-index:2;display:flex;align-items:center;gap:10px;font-weight:500;font-size:17px;letter-spacing:.04em}
.nof-login .brand .mark{width:34px;height:34px;display:block;flex:none}
.nof-login .brand .mark svg{width:100%;height:100%;display:block}
.nof-login .brand small{font-weight:400;font-size:13px;color:var(--dim);letter-spacing:.02em}
.nof-login main{position:relative;z-index:1;height:100%;display:flex;align-items:center;justify-content:center;padding:64px 20px calc(var(--tlh) + 56px);overflow:auto}
.nof-login .monitor{width:min(100%,540px);position:relative}
.nof-login .paper{position:relative;padding:38px 42px 30px;border-radius:3px;color:var(--ink);background:radial-gradient(circle,#d3cab3 1px,transparent 1.3px) 0 0/16px 16px,linear-gradient(160deg,var(--paper),var(--paper-2));box-shadow:0 0 0 1px rgba(255,100,0,.28),0 40px 90px rgba(0,0,0,.55)}
.nof-login .tape{position:absolute;top:-11px;left:-16px;width:96px;height:28px;transform:rotate(-8deg);background:repeating-linear-gradient(135deg,rgba(255,255,255,.3) 0 4px,transparent 4px 9px),rgba(255,100,0,.88);z-index:2}
.nof-login h1{margin:0;font:400 clamp(34px,6vw,46px)/1.2 var(--hand);letter-spacing:.02em;overflow-wrap:anywhere;color:var(--brand)}
.nof-login .sub{margin:8px 0 26px;font-size:14px;color:var(--ink-dim)}
.nof-login .fld{display:block;margin-bottom:18px}
.nof-login .fld>span{display:block;font-size:13px;color:var(--ink-dim);margin-bottom:2px}
.nof-login .inw{position:relative;display:flex;align-items:center}
.nof-login .inw>.ic{position:absolute;left:2px;color:var(--ink-dim);transition:color .2s}
.nof-login .inw:focus-within>.ic{color:var(--orange)}
.nof-login .fld input{width:100%;font:500 18px var(--sans);color:var(--ink);background:transparent;border:0;border-bottom:1px solid rgba(24,23,28,.35);border-radius:0;padding:9px 34px 9px 30px;outline:0;caret-color:var(--orange);transition:border-color .2s,box-shadow .2s}
.nof-login .fld input:focus-visible{border-bottom-color:var(--orange);box-shadow:0 1px 0 var(--orange)}
.nof-login .fld input::placeholder{color:#a8a291}
.nof-login .eye{position:absolute;right:0;display:grid;place-items:center;width:32px;height:32px;color:var(--ink-dim);background:none;border:0;border-radius:50%;cursor:pointer}
.nof-login .eye:hover{color:var(--ink)}
.nof-login .eye .sl{display:none}.nof-login .eye[aria-pressed="true"] .sl{display:block}
.nof-login .go{width:100%;margin-top:10px;font:500 17px var(--sans);letter-spacing:.08em;padding:.9em 1em;border-radius:2px;border:0;background:var(--brand);color:#fff;cursor:pointer;transition:transform .15s,background .2s,box-shadow .2s;box-shadow:inset 0 -2px 0 rgba(255,100,0,.85)}
.nof-login .go:hover{background:#072552}.nof-login .go:active{transform:scale(.99)}.nof-login .go:disabled{opacity:.55;cursor:default}
.nof-login .go:focus-visible,.nof-login .eye:focus-visible,.nof-login .lk:focus-visible,.nof-login .otp:focus-visible{outline:2px solid var(--orange);outline-offset:3px}
.nof-login .links{display:flex;justify-content:space-between;gap:12px;margin-top:14px;font-size:14px;flex-wrap:wrap}
.nof-login .lk{color:var(--orange-deep);background:none;border:0;font:inherit;padding:2px 0;cursor:pointer;text-decoration:underline;text-underline-offset:3px}
.nof-login .aside{margin:14px 0 0;min-height:1.5em;font-size:14px;color:var(--ink-dim)}
.nof-login .aside.err{color:var(--err)}
.nof-login .shake{animation:nof-shake .4s}
@keyframes nof-shake{20%,60%{transform:translateX(-7px)}40%,80%{transform:translateX(7px)}}
.nof-login .row{display:flex;gap:10px;align-items:flex-end}
.nof-login .row .fld{flex:1;margin-bottom:18px}
.nof-login .otp{flex:none;margin-bottom:18px;font:500 13px var(--sans);padding:.7em .9em;border-radius:2px;border:1px solid rgba(5,29,67,.2);background:transparent;color:var(--orange-deep);cursor:pointer}
.nof-login .otp:disabled{opacity:.5;cursor:default}
.nof-login .tl{position:absolute;left:0;right:0;bottom:0;z-index:1;background:var(--panel);border-top:1px solid rgba(255,100,0,.22);padding-bottom:env(safe-area-inset-bottom,0px)}
.nof-login .grid{position:relative;display:grid;grid-template-columns:var(--lab) 1fr;grid-template-rows:26px 60px 46px;margin-top:4px}
.nof-login .ruler{grid-column:2;position:relative;border-bottom:1px solid var(--line)}
.nof-login .ruler span{position:absolute;bottom:4px;transform:translateX(-50%);font:10px ui-monospace,Menlo,Consolas,monospace;color:var(--dim)}
.nof-login .ruler span:first-child{transform:none;margin-left:3px}
.nof-login .ruler span:last-child{transform:translateX(-100%)}
.nof-login .lbl{display:flex;align-items:center;gap:6px;padding-left:12px;font:11px ui-monospace,Menlo,Consolas,monospace;color:var(--dim)}
.nof-login .lbl .ic{width:16px;height:16px}
.nof-login .clips{display:flex;gap:2px;padding:3px 0}
.nof-login .clip{--k:0;position:relative;flex:1;min-width:0;border-radius:3px;overflow:hidden;display:flex;flex-direction:column;background:#000;outline:1px solid transparent;outline-offset:-1px;transition:outline-color .3s}
.nof-login .clip.cur{outline-color:var(--orange)}
.nof-login .clip b{display:flex;justify-content:space-between;gap:6px;font:500 10px/16px var(--sans);padding:0 6px;background:#122038;color:#aeb0c4;white-space:nowrap;overflow:hidden}
.nof-login .clip.cur b{color:var(--orange)}
.nof-login .clip u{text-decoration:none;opacity:.6}
.nof-login .clip i{flex:1;position:relative;overflow:hidden;background:linear-gradient(180deg,color-mix(in srgb,#1a2740 calc((1 - var(--k)) * 100%),#06070f),color-mix(in srgb,#8a5f58 calc((1 - var(--k)) * 100%),#12152b))}
.nof-login .clip i::before{content:"";position:absolute;left:62%;width:12px;height:12px;margin-left:-6px;border-radius:50%;background:var(--orange);bottom:calc(42% - var(--k) * 66%);box-shadow:0 0 0 4px rgba(255,100,0,.16),0 0 0 9px rgba(255,100,0,.07)}
.nof-login .clip i::after{content:"";position:absolute;left:0;right:0;bottom:0;height:22%;background:rgba(5,6,15,.92)}
.nof-login .wave{display:flex;align-items:center;height:100%;gap:2px;padding:0 3px;border-radius:3px;background:#0d1729}
.nof-login .wave s{flex:1;min-width:1px;background:rgba(255,100,0,.34);border-radius:2px}
.nof-login .wave s.b{background:var(--orange)}
.nof-login .dim{position:absolute;top:30px;bottom:0;right:0;left:calc(var(--lab) + (100% - var(--lab)) * var(--p));background:rgba(5,6,15,.58);pointer-events:none;transition:left .8s cubic-bezier(.3,.7,.2,1)}
.nof-login .ph{position:absolute;top:0;bottom:0;width:1px;background:var(--orange);box-shadow:0 0 12px rgba(255,100,0,.7);left:calc(var(--lab) + (100% - var(--lab)) * var(--p));transition:left .8s cubic-bezier(.3,.7,.2,1)}
.nof-login .ph::before{content:"";position:absolute;top:0;left:-6px;width:13px;height:15px;background:var(--orange);clip-path:polygon(0 0,100% 0,100% 60%,50% 100%,0 60%)}
.nof-login .tcode{margin-top:14px;font:12px/1 ui-monospace,Menlo,Consolas,monospace;color:var(--dim);font-variant-numeric:tabular-nums}
@media (max-width:700px){.nof-login .ruler span:nth-child(2n):not(:last-child){display:none}.nof-login .sun{left:74%}.nof-login .paper{padding:32px 24px 24px}.nof-login .lbl span{display:none}.nof-login .lbl{padding-left:8px}.nof-login{--lab:34px}}
@media (prefers-reduced-motion:reduce){.nof-login *{animation:none!important;transition:none!important}}
`;

const NAMES = ['上班', '开会', '改稿', '返工', '收尾', '关电脑', '下班'];
const GREET = { login: '欢迎回来，准点下班。', register: '新同事，欢迎入职。', reset: '忘了也没关系。' };
const SUB = {
  login: '登录后继续剪辑；会话保存在本机，不用反复登录。',
  register: '注册需要邮箱验证码与邀请码。',
  reset: '用邮箱验证码设置新密码。',
};

function fmt(seconds) {
  return [Math.floor(seconds / 60), Math.floor(seconds % 60), Math.floor((seconds % 1) * 30)]
    .map(n => String(n).padStart(2, '0')).join(':');
}

export function createLoginPage(React) {
  const h = React.createElement;
  const CaptchaChallenge = createCaptchaChallenge(React);

  return function LoginPage({ onAuthenticated, t }) {
    const [mode, setMode] = React.useState('login');
    const [account, setAccount] = React.useState('');
    const [password, setPassword] = React.useState('');
    const [showPassword, setShowPassword] = React.useState(false);
    const [code, setCode] = React.useState('');
    const [inviteCode, setInviteCode] = React.useState('');
    const [displayName, setDisplayName] = React.useState('');
    const [aside, setAside] = React.useState('');
    const [err, setErr] = React.useState(false);
    const [shake, setShake] = React.useState(false);
    const [busy, setBusy] = React.useState(false);
    const [otpWait, setOtpWait] = React.useState(0);
    const [timecode, setTimecode] = React.useState('00:00:00');
    const [clipIndex, setClipIndex] = React.useState(-1);
    const [challenge, setChallenge] = React.useState(null); // 'login' | 'otp' | null
    const rootRef = React.useRef(null);
    const pendingRef = React.useRef(null);

    const stars = React.useMemo(() => Array.from({ length: 46 }, (_, i) => {
      const r = n => (Math.sin(i * n) * 43758.5453) % 1;
      return { left: `${Math.abs(r(12.9)) * 100}%`, top: `${Math.abs(r(78.2)) * 55}%`, delay: `${Math.abs(r(4.1) * 3).toFixed(1)}s` };
    }), []);
    const wave = React.useMemo(() => Array.from({ length: 168 }, (_, i) => {
      const e = .3 + .16 * Math.sin(i / 13) + (i % 3 ? 0 : .28) + (i % 12 ? 0 : .12) + .12 * Math.abs(Math.sin(i * 2.7));
      return { bold: !(i % 3), height: `${Math.min(94, e * 100).toFixed(0)}%` };
    }), []);

    const seek = React.useCallback(p => {
      setTimecode(fmt(p * 28));
      setClipIndex(p > .001 ? Math.min(6, Math.floor(p * 7)) : -1);
      if (rootRef.current) rootRef.current.style.setProperty('--p', String(p));
    }, []);

    React.useEffect(() => {
      const n = account.trim();
      if (!n) seek(0);
      else if (mode === 'login') seek(password.length >= 6 ? .85 : password ? .5 : .28);
      else seek(password.length >= 6 && code ? .7 : .4);
    }, [account, password, code, mode, seek]);

    React.useEffect(() => {
      if (otpWait <= 0) return undefined;
      const timer = setTimeout(() => setOtpWait(value => Math.max(0, value - 1)), 1000);
      return () => clearTimeout(timer);
    }, [otpWait]);

    const problem = message => {
      setAside(message);
      setErr(true);
      setShake(false);
      requestAnimationFrame(() => setShake(true));
    };

    const title = account.trim() && mode === 'login'
      ? `欢迎回来，${account.trim()}。`
      : GREET[mode];

    const runLogin = async (captchaId, captchaCode) => {
      setBusy(true);
      try {
        const status = await authAction('login', {
          account: account.trim(),
          password,
          captchaId,
          captchaCode,
        });
        seek(1);
        onAuthenticated?.(status);
      } catch (error) {
        problem(error.message || '登录失败');
      } finally {
        setBusy(false);
        setChallenge(null);
        pendingRef.current = null;
      }
    };

    const runSendOtp = async (captchaId, captchaCode) => {
      setBusy(true);
      try {
        await authAction('verification-code', {
          account: account.trim(),
          purpose: mode === 'reset' ? 'reset_password' : 'register',
          captchaId,
          captchaCode,
        });
        setAside('验证码已发送，请查收邮箱');
        setErr(false);
        setOtpWait(60);
      } catch (error) {
        problem(error.message || '验证码发送失败');
      } finally {
        setBusy(false);
        setChallenge(null);
        pendingRef.current = null;
      }
    };

    const onCaptchaSolved = (captchaId, captchaCode) => {
      const kind = pendingRef.current;
      if (kind === 'login') void runLogin(captchaId, captchaCode);
      else if (kind === 'otp') void runSendOtp(captchaId, captchaCode);
      else setChallenge(null);
    };

    const askCaptcha = kind => {
      pendingRef.current = kind;
      setChallenge(kind);
    };

    const sendOtp = () => {
      if (!account.trim().includes('@')) return problem('请先填写邮箱');
      if (otpWait > 0 || busy) return;
      askCaptcha('otp');
    };

    const onSubmit = async event => {
      event.preventDefault();
      if (busy || challenge) return;
      if (!account.trim()) return problem(mode === 'login' ? '请输入账号：手机号或邮箱。' : '请输入邮箱。');

      if (mode === 'login') {
        if (password.length < 6) return problem('密码至少 6 位，请重新输入。');
        askCaptcha('login');
        return;
      }

      if (mode === 'register') {
        if (!account.trim().includes('@')) return problem('注册请使用邮箱。');
        if (password.length < 6) return problem('密码至少 6 位。');
        if (!code.trim()) return problem('请输入邮箱验证码。');
        if (!inviteCode.trim()) return problem('请输入邀请码。');
        setBusy(true);
        try {
          const status = await authAction('register', {
            account: account.trim(),
            password,
            code: code.trim(),
            inviteCode: inviteCode.trim(),
            displayName: displayName.trim() || undefined,
          });
          seek(1);
          onAuthenticated?.(status);
        } catch (error) {
          problem(error.message || '注册失败');
        } finally {
          setBusy(false);
        }
        return;
      }

      if (!account.trim().includes('@')) return problem('请使用邮箱重置密码。');
      if (!code.trim()) return problem('请输入邮箱验证码。');
      if (password.length < 6) return problem('新密码至少 6 位。');
      setBusy(true);
      try {
        await authAction('reset-password', {
          account: account.trim(),
          code: code.trim(),
          newPassword: password,
        });
        setMode('login');
        setAside('密码已更新，请登录。');
        setErr(false);
        setCode('');
      } catch (error) {
        problem(error.message || '重置失败');
      } finally {
        setBusy(false);
      }
    };

    const switchMode = next => {
      setMode(next);
      setAside('');
      setErr(false);
      setCode('');
      setChallenge(null);
      pendingRef.current = null;
    };

    return h('div', { className: 'nof-login', ref: rootRef, role: 'dialog', 'aria-label': t?.('loginTitle') || '登录' },
      h('style', null, CSS),
      h('link', { rel: 'stylesheet', href: 'https://fonts.googleapis.com/css2?family=Ma+Shan+Zheng&family=Noto+Sans+SC:wght@400;500;600&display=swap' }),
      h('svg', { width: 0, height: 0, style: { position: 'absolute' }, 'aria-hidden': true },
        h('symbol', { id: 'nof-user', viewBox: '0 0 24 24' }, h('circle', { cx: 12, cy: 8, r: 3.6 }), h('path', { d: 'M5 20c.8-4 3.6-6 7-6s6.2 2 7 6' })),
        h('symbol', { id: 'nof-lock', viewBox: '0 0 24 24' }, h('rect', { x: 5, y: 11, width: 14, height: 9, rx: 2.5 }), h('path', { d: 'M8.5 11V8.5a3.5 3.5 0 0 1 7 0V11' })),
        h('symbol', { id: 'nof-film', viewBox: '0 0 24 24' }, h('rect', { x: 4, y: 5, width: 16, height: 14, rx: 3 }), h('path', { d: 'M10.5 9.5l4 2.5-4 2.5z' })),
        h('symbol', { id: 'nof-wave', viewBox: '0 0 24 24' }, h('path', { d: 'M5 10v4M9 7v10M13 4.5v15M17 8v8M21 11v2' })),
      ),
      h('div', { className: 'sky day' }),
      h('div', { className: 'sky night' }),
      h('div', { className: 'stars' }, stars.map((star, i) => h('i', { key: i, style: { left: star.left, top: star.top, animationDelay: star.delay } }))),
      h('div', { className: 'sun', 'aria-hidden': true },
        h('svg', { viewBox: '-200 -200 400 400' },
          h('defs', null, h('radialGradient', { id: 'nof-g' },
            h('stop', { offset: '0', stopColor: '#FF6400', stopOpacity: '.28' }),
            h('stop', { offset: '1', stopColor: '#FF6400', stopOpacity: '0' }))),
          h('circle', { r: 200, fill: 'url(#nof-g)' }),
          h('circle', { r: 56, fill: '#FF6400' }),
          h('g', { fill: 'none', stroke: '#FF6400' },
            h('circle', { r: 80, strokeOpacity: '.5' }),
            h('circle', { r: 108, strokeOpacity: '.32' }),
            h('circle', { r: 140, strokeOpacity: '.18' }),
            h('circle', { r: 176, strokeOpacity: '.1' })))),
      h('div', { className: 'grain' }),
      h('div', { className: 'brand' },
        h('span', { className: 'mark', 'aria-hidden': true, dangerouslySetInnerHTML: { __html: BRAND_SYMBOL_COLOR_SVG } }),
        '不加班 ', h('small', null, 'AI 剪辑')),
      h('main', null,
        h('section', { className: 'monitor' },
          h('div', { className: 'paper' },
            h('i', { className: 'tape' }),
            h('h1', null, title),
            h('p', { className: 'sub' }, SUB[mode]),
            h('form', { className: shake ? 'shake' : undefined, onSubmit, noValidate: true },
              h('label', { className: 'fld' },
                h('span', null, mode === 'login' ? '账号' : '邮箱'),
                h('span', { className: 'inw' },
                  h('svg', { className: 'ic', 'aria-hidden': true }, h('use', { href: '#nof-user' })),
                  h('input', {
                    value: account,
                    onChange: e => { setAccount(e.target.value); setErr(false); },
                    autoComplete: 'username',
                    autoCapitalize: 'none',
                    spellCheck: false,
                    placeholder: mode === 'login' ? '手机号或邮箱' : 'name@example.com',
                  }))),
              mode === 'register' ? h('label', { className: 'fld' },
                h('span', null, '昵称（可选）'),
                h('span', { className: 'inw' },
                  h('svg', { className: 'ic', 'aria-hidden': true }, h('use', { href: '#nof-user' })),
                  h('input', {
                    value: displayName,
                    onChange: e => setDisplayName(e.target.value),
                    autoComplete: 'nickname',
                    placeholder: '怎么称呼你',
                  }))) : null,
              h('label', { className: 'fld' },
                h('span', null, mode === 'reset' ? '新密码' : '密码'),
                h('span', { className: 'inw' },
                  h('svg', { className: 'ic', 'aria-hidden': true }, h('use', { href: '#nof-lock' })),
                  h('input', {
                    type: showPassword ? 'text' : 'password',
                    value: password,
                    onChange: e => { setPassword(e.target.value); setErr(false); },
                    autoComplete: mode === 'login' ? 'current-password' : 'new-password',
                    placeholder: '至少 6 位',
                  }),
                  h('button', {
                    type: 'button',
                    className: 'eye',
                    'aria-pressed': showPassword,
                    'aria-label': showPassword ? '隐藏密码' : '显示密码',
                    onClick: () => setShowPassword(value => !value),
                  }, h('svg', { className: 'ic', viewBox: '0 0 24 24', 'aria-hidden': true },
                    h('path', { d: 'M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z' }),
                    h('circle', { cx: 12, cy: 12, r: 2.8 }),
                    h('path', { className: 'sl', d: 'M4 20L20 4' }))))),
              mode !== 'login' ? h('div', { className: 'row' },
                h('label', { className: 'fld' },
                  h('span', null, '邮箱验证码'),
                  h('span', { className: 'inw' },
                    h('svg', { className: 'ic', 'aria-hidden': true }, h('use', { href: '#nof-lock' })),
                    h('input', {
                      value: code,
                      onChange: e => setCode(e.target.value),
                      autoComplete: 'one-time-code',
                      placeholder: '6 位验证码',
                    }))),
                h('button', {
                  type: 'button',
                  className: 'otp',
                  disabled: busy || otpWait > 0 || !!challenge,
                  onClick: sendOtp,
                }, otpWait > 0 ? `${otpWait}s` : '获取验证码')) : null,
              mode === 'register' ? h('label', { className: 'fld' },
                h('span', null, '邀请码'),
                h('span', { className: 'inw' },
                  h('svg', { className: 'ic', 'aria-hidden': true }, h('use', { href: '#nof-lock' })),
                  h('input', {
                    value: inviteCode,
                    onChange: e => setInviteCode(e.target.value),
                    autoComplete: 'off',
                    placeholder: '注册邀请码',
                  }))) : null,
              h('button', { className: 'go', disabled: busy || !!challenge },
                busy ? '请稍候…' : (mode === 'login' ? '登录并继续剪辑' : mode === 'register' ? '注册并开始' : '更新密码')),
              h('div', { className: 'links' },
                mode === 'login'
                  ? h(React.Fragment, null,
                    h('button', { type: 'button', className: 'lk', onClick: () => switchMode('reset') }, '忘记密码'),
                    h('button', { type: 'button', className: 'lk', onClick: () => switchMode('register') }, '注册新账号'))
                  : h('button', { type: 'button', className: 'lk', onClick: () => switchMode('login') }, '返回登录')),
            ),
            h('p', { className: `aside${err ? ' err' : ''}`, role: 'status' },
              aside || (mode === 'login' ? '使用不加班账号登录。点登录后完成人机验证即可。' : '')),
          ),
          h('div', { className: 'tcode' }, h('span', null, timecode), ' / 00:28:00'),
        ),
      ),
      h('section', { className: 'tl', 'aria-hidden': true },
        h('div', { className: 'grid' },
          h('div'),
          h('div', { className: 'ruler' },
            Array.from({ length: 8 }, (_, i) => h('span', { key: i, style: { left: `${(i / 7 * 100).toFixed(2)}%` } }, `00:${String(i * 4).padStart(2, '0')}`))),
          h('div', { className: 'lbl' }, h('svg', { className: 'ic' }, h('use', { href: '#nof-film' })), h('span', null, 'V1')),
          h('div', { className: 'clips' },
            NAMES.map((name, i) => h('div', {
              key: name,
              className: `clip${clipIndex === i ? ' cur' : ''}`,
              style: { '--k': (i / 6).toFixed(2) },
            }, h('b', null, name, h('u', null, '4.0s')), h('i')))),
          h('div', { className: 'lbl' }, h('svg', { className: 'ic' }, h('use', { href: '#nof-wave' })), h('span', null, 'A1')),
          h('div', { className: 'wave' }, wave.map((bar, i) => h('s', { key: i, className: bar.bold ? 'b' : undefined, style: { height: bar.height } }))),
          h('div', { className: 'dim' }),
          h('div', { className: 'ph' }),
        )),
      h(CaptchaChallenge, {
        open: !!challenge,
        onCancel: () => { setChallenge(null); pendingRef.current = null; },
        onSolved: onCaptchaSolved,
      }),
    );
  };
}
