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
    // No floating controls: the Studio shell owns the whole panel. The debug
    // window is still reachable at /no996-openfilm/standalone for development.
    return h('div', { ref: containerRef, style: { position: 'relative', display: 'flex', width: '100%', height: '100%', minWidth: 0, minHeight: 0 } }, studio);
  };
}
