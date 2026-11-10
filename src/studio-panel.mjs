/** The video panel: the official OpenFilm desktop shell, full width.
 *
 * The official shell carries its own Studio, its own chat column and its own
 * resizer, so this panel renders nothing beside it. The earlier embedded DSH
 * conversation and its project-session mapping were removed: they duplicated
 * the official chat and their two-phase registry could dead-end in a state the
 * page could not recover from.
 */
export function createStudioPanel(React) {
  const h = React.createElement;
  return function StudioPanel({ t, startStudio }) {
    const [state, setState] = React.useState({ status: 'loading' });
    const [attempt, setAttempt] = React.useState(0);
    const [silent, setSilent] = React.useState(false);
    const [diag, setDiag] = React.useState(null);
    const [boot, setBoot] = React.useState(null);
    const [debugError, setDebugError] = React.useState(null);
    const [menu, setMenu] = React.useState(false);
    const containerRef = React.useRef(null);
    const iframeRef = React.useRef(null);
    const heardRef = React.useRef(false);

    React.useEffect(() => {
      const controller = new AbortController();
      setState({ status: 'loading' });
      heardRef.current = false;
      Promise.resolve().then(() => startStudio(controller.signal)).then(result => {
        if (controller.signal.aborted) return;
        const target = new URL(result.editorOrigin);
        const desktop = window.location.hostname === 'app' && ['dsh-app:', 'app:'].includes(window.location.protocol);
        const hostAllowed = desktop ? target.hostname === '127.0.0.2' : ['127.0.0.1', 'localhost'].includes(target.hostname) && target.hostname === window.location.hostname;
        if (target.protocol !== 'http:' || !hostAllowed || !target.port || target.username || target.password || target.pathname !== '/' || target.search || target.hash) {
          throw new Error(`Invalid local Studio address (${window.location.hostname || 'none'} → ${target.hostname || 'none'})`);
        }
        if (desktop && (typeof result.ticket !== 'string' || !/^[A-Za-z0-9_-]{32,128}$/.test(result.ticket))) throw new Error('Invalid Studio desktop ticket');
        const url = desktop ? `${target.origin}/__dsh/open#${result.ticket}` : `${target.origin}/`;
        // Remember the project the user was editing so coming back from another
        // page reopens it instead of the project list. Studio keeps the film on
        // disk; this only restores where they were.
        let start = url;
        try {
          const last = localStorage.getItem('no996.openfilm.lastProject');
          if (!desktop && typeof last === 'string' && /^[A-Za-z0-9_-]{6,40}$/.test(last)) start = `${target.origin}/projects/${last}`;
        } catch { /* no stored project */ }
        setState({ status: 'ready', url: start, webOrigin: typeof result.webOrigin === 'string' ? result.webOrigin : '' });
      }).catch(error => {
        if (!controller.signal.aborted) setState({ status: 'error', message: String(error?.message || error) });
      });
      return () => controller.abort();
    }, [attempt, startStudio]);

    React.useEffect(() => {
      if (state.status !== 'ready') return undefined;
      const editorOrigin = new URL(state.url).origin;
      const receive = event => {
        if (event.origin !== editorOrigin || event.source !== iframeRef.current?.contentWindow) return;
        const data = event.data;
        if (data && typeof data === 'object' && data.type === 'no996-openfilm:boot' && data.version === 1) {
          heardRef.current = true;
          setBoot({ hasNative: data.hasNative === true, rendered: data.rendered === true });
        }
        if (data && typeof data === 'object' && data.type === 'no996-openfilm:project' && data.version === 1 && typeof data.projectId === 'string') {
          try {
            if (/^[A-Za-z0-9_-]{6,40}$/.test(data.projectId)) localStorage.setItem('no996.openfilm.lastProject', data.projectId);
            else localStorage.removeItem('no996.openfilm.lastProject');
          } catch { /* private mode */ }
        }
      };
      window.addEventListener('message', receive);
      // A frame that never boots cannot report its own failure; surface silence.
      const timer = setTimeout(() => { if (!heardRef.current) setSilent(true); }, 20000);
      return () => { clearTimeout(timer); window.removeEventListener('message', receive); };
    }, [state.status, state.url, attempt]);

    React.useEffect(() => {
      if (!silent || state.status !== 'ready') return undefined;
      let live = true;
      fetch('/api/no996-openfilm/diagnose', { method: 'POST', credentials: 'same-origin' })
        .then(response => (response.ok ? response.json() : { httpStatus: response.status }))
        .then(value => { if (live) setDiag(value); })
        .catch(error => { if (live) setDiag({ error: String((error && error.message) || error) }); });
      return () => { live = false; };
    }, [silent, state.status, attempt]);

    const retry = () => { setSilent(false); setAttempt(value => value + 1); };
    // Ask the Host for a browser URL. In desktop mode that URL carries a
    // one-time ticket, because a real browser has no DSH cookie; the ticket is
    // the same credential the embedded frame already uses.
    const openDebug = async (copyOnly) => {
      void (async () => {
        try {
          const response = await fetch('/api/no996-openfilm/debug-url', {
            method: 'POST', credentials: 'same-origin',
            headers: { 'x-no996-surface': `${window.location.protocol}//${window.location.host}` },
          });
          if (!response.ok) throw new Error(`HTTP ${response.status}`);
          const data = await response.json();
          if (typeof data?.url !== 'string' || !/^http:\/\/127\.0\.0\.\d:\d+\//.test(data.url)) throw new Error('Invalid debug URL');
          if (copyOnly) {
            try { await navigator.clipboard.writeText(data.url); setDebugError('调试地址已复制，粘贴到右侧浏览器的地址栏即可'); } catch { setDebugError(data.url); }
            return;
          }
          window.open(data.url, 'no996-openfilm-browser', 'popup,width=1440,height=900');
        } catch (error) {
          setDebugError(`打开调试窗口失败：${String((error && error.message) || error)}`);
        }
      })();
    };
    let studio;
    if (state.status === 'loading') {
      studio = h('div', { role: 'status', style: { padding: 24, color: 'var(--dsw-alias-label-secondary)' } }, t('studioLoading'));
    } else if (state.status === 'error') {
      studio = h('section', { style: { padding: 24, color: 'var(--dsw-alias-label-primary)' } },
        h('p', { role: 'alert' }, t('studioFailed'), ' ', state.message),
        h('button', { type: 'button', onClick: retry }, t('studioRetry')));
    } else if (silent) {
      studio = h('section', { style: { padding: 24, color: 'var(--dsw-alias-label-primary)' } },
        h('p', { role: 'alert' }, t('studioFailed'), ' 官方界面 20 秒内没有回应。请把下面这段诊断文字发给我。'),
        h('pre', { style: { whiteSpace: 'pre-wrap', fontSize: 12, overflow: 'auto', maxHeight: '50vh', background: 'var(--dsw-alias-bg-layer-1, #0002)', padding: 8, borderRadius: 6 } },
          JSON.stringify({ boot, diag: diag ?? { note: 'diagnose 尚未返回' } }, null, 1)),
        h('button', { type: 'button', onClick: retry }, t('studioRetry')));
    } else {
      studio = h('iframe', {
        ref: iframeRef, title: t('studioTitle'), src: state.url,
        sandbox: 'allow-scripts allow-same-origin allow-forms allow-downloads allow-popups allow-modals',
        allow: 'clipboard-read; clipboard-write',
        referrerPolicy: 'no-referrer',
        style: { display: 'block', width: '100%', height: '100%', border: 0, background: 'var(--dsw-alias-bg-base)' },
      });
    }
    return h('div', { ref: containerRef, style: { position: 'relative', display: 'flex', width: '100%', height: '100%', minWidth: 0, minHeight: 0 } }, studio,
      debugError ? h('pre', { role: 'alert', style: { position: 'absolute', right: 12, bottom: 50, zIndex: 6, maxWidth: 520, margin: 0, padding: '8px 10px', fontSize: 12, color: '#fff', background: '#7a1d1d', borderRadius: 6, whiteSpace: 'pre-wrap' } }, debugError) : null,
      h('div', { style: { position: 'absolute', left: 8, bottom: 8, zIndex: 6 }, onMouseEnter: () => setMenu(true), onMouseLeave: () => setMenu(false) },
        h('button', {
          type: 'button', title: '在独立窗口打开',
          style: { padding: '4px 8px', borderRadius: 5, cursor: 'pointer', border: '1px solid var(--dsw-alias-border-default, #555)', background: 'var(--dsw-alias-bg-layer-1, #000000aa)', color: 'var(--dsw-alias-label-secondary)', fontSize: 11, opacity: menu ? 1 : 0.45, transition: 'opacity .15s', whiteSpace: 'nowrap' },
        }, '↗ 独立窗口'),
        menu ? h('div', { role: 'menu', style: { position: 'absolute', left: 0, bottom: 26, minWidth: 176, padding: 4, borderRadius: 6, border: '1px solid var(--dsw-alias-border-default, #444)', background: 'var(--dsw-alias-bg-layer-1, #1e1e1e)', color: 'var(--dsw-alias-label-primary)', boxShadow: '0 6px 20px #0008' } },
          h('button', {
            type: 'button', role: 'menuitem',
            onClick: () => { setMenu(false); void openDebug(false); },
            style: { display: 'block', width: '100%', textAlign: 'left', padding: '6px 8px', fontSize: 12, border: 'none', borderRadius: 4, background: 'transparent', color: 'inherit', cursor: 'pointer' },
          }, '在独立窗口打开'),
          h('button', {
            type: 'button', role: 'menuitem',
            onClick: () => { setMenu(false); void openDebug(true); },
            style: { display: 'block', width: '100%', textAlign: 'left', padding: '6px 8px', fontSize: 12, border: 'none', borderRadius: 4, background: 'transparent', color: 'inherit', cursor: 'pointer' },
          }, '复制调试地址（粘贴到右侧浏览器）')) : null));
  };
}
