/** The video panel: the official OpenFilm desktop shell, full width.
 *
 * The official shell carries its own Studio, its own chat column and its own
 * resizer, so this panel renders nothing beside it. The earlier embedded DSH
 * conversation and its project-session mapping were removed: they duplicated
 * the official chat and their two-phase registry could dead-end in a state the
 * page could not recover from.
 */
export function templateProjectUrl(editorOrigin, projectId) {
  if (typeof projectId !== 'string' || !/^[A-Za-z0-9_-]{6,40}$/.test(projectId)) throw new Error('Invalid project');
  return `${new URL(editorOrigin).origin}/projects/${projectId}`;
}

export function createStudioPanel(React) {
  const h = React.createElement;
  return function StudioPanel({ t, startStudio, templateRequest }) {
    const [state, setState] = React.useState({ status: 'loading' });
    const [attempt, setAttempt] = React.useState(0);
    const [silent, setSilent] = React.useState(false);
    const [diag, setDiag] = React.useState(null);
    const [boot, setBoot] = React.useState(null);
    const [templates, setTemplates] = React.useState([]);
    const [view, setView] = React.useState('home');
    const [templateError, setTemplateError] = React.useState(false);
    const [creationUncertain, setCreationUncertain] = React.useState(false);
    const [preset, setPreset] = React.useState(null);
    const [creating, setCreating] = React.useState(false);
    // Archive state of the project whose editor is open. It is read from the
    // Host, which owns DSH's durable archive set; this panel keeps no copy.
    const [projectId, setProjectId] = React.useState(null);
    const [archive, setArchive] = React.useState(null);
    const [archiveBusy, setArchiveBusy] = React.useState(false);
    const containerRef = React.useRef(null);
    const iframeRef = React.useRef(null);
    const heardRef = React.useRef(false);
    const creatingRef = React.useRef(false);
    const viewRef = React.useRef(view);
    viewRef.current = view;

    React.useEffect(() => {
      let live = true;
      // Read the Host's own view of the video preset so a silent activation
      // failure is visible here instead of surfacing later as a broken chat.
      fetch('/api/no996-openfilm/diagnose', { method: 'POST', credentials: 'same-origin' })
        .then(response => (response.ok ? response.json() : null))
        .then(data => { if (live && data?.preset) setPreset(data.preset); })
        .catch(() => {});
      return () => { live = false; };
    }, []);

    React.useEffect(() => {
      let live = true;
      Promise.resolve().then(() => templateRequest({ action: 'list' })).then(result => {
        if (live && Array.isArray(result?.templates)) setTemplates(result.templates.filter(item => item && typeof item.id === 'string' && typeof item.title === 'string'));
      }).catch(() => { if (live) setTemplateError(true); });
      return () => { live = false; };
    }, [templateRequest]);

    React.useEffect(() => {
      const controller = new AbortController();
      setState({ status: 'loading' });
      setBoot(null);
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
        setState({ status: 'ready', url, webOrigin: typeof result.webOrigin === 'string' ? result.webOrigin : '' });
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
        if (viewRef.current === 'editor' && data && typeof data === 'object' && data.type === 'no996-openfilm:project' && data.version === 1 && typeof data.projectId === 'string') {
          try {
            if (/^[A-Za-z0-9_-]{6,40}$/.test(data.projectId)) {
              localStorage.setItem('no996.openfilm.lastProject', data.projectId);
              setProjectId(data.projectId);
            } else localStorage.removeItem('no996.openfilm.lastProject');
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
    // Poll while the editor is open: archiving in the DSH sidebar has no channel
    // into this frame, and a stalled send is the symptom we are removing.
    React.useEffect(() => {
      if (!projectId || state.status !== 'ready') { setArchive(null); return undefined; }
      let live = true;
      const read = async () => {
        try {
          const response = await fetch('/api/no996-openfilm/archive', {
            method: 'POST', credentials: 'same-origin',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ action: 'state', projectId }),
          });
          const data = await response.json().catch(() => null);
          if (live && response.ok && data) setArchive({ available: data.available !== false, archived: data.archived === true });
        } catch { /* keep the last known state; the banner is not a source of truth */ }
      };
      read();
      const timer = setInterval(read, 5000);
      return () => { live = false; clearInterval(timer); };
    }, [projectId, state.status]);
    const changeArchive = async action => {
      if (!projectId || archiveBusy) return;
      setArchiveBusy(true);
      try {
        const response = await fetch('/api/no996-openfilm/archive', {
          method: 'POST', credentials: 'same-origin',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ action, projectId }),
        });
        const data = await response.json().catch(() => null);
        if (response.ok && data) setArchive({ available: data.available !== false, archived: data.archived === true });
      } catch { /* the next poll reconciles */ }
      finally { setArchiveBusy(false); }
    };
    const createTemplate = async id => {
      if (creatingRef.current || creationUncertain || !iframeRef.current || state.status !== 'ready') return;
      const frame = iframeRef.current;
      creatingRef.current = true;
      setCreating(true);
      setTemplateError(false);
      try {
        const result = await templateRequest({ action: 'create', templateId: id });
        const url = templateProjectUrl(state.url, result?.projectId);
        // Keep React's source of truth aligned while preserving the iframe node.
        if (iframeRef.current === frame) {
          setState(current => current.status === 'ready' ? { ...current, url } : current);
          setView('editor');
        }
      } catch {
        // A lost response can follow successful registration. Do not offer an
        // immediate retry that may create a second project.
        setCreationUncertain(true);
        setTemplateError(true);
      }
      finally { creatingRef.current = false; setCreating(false); }
    };
    const openExisting = () => {
      // The frame has already redeemed the desktop ticket. Restore a known
      // project only in response to this explicit action; otherwise show Studio.
      try {
        const last = localStorage.getItem('no996.openfilm.lastProject');
        if (typeof last === 'string' && /^[A-Za-z0-9_-]{6,40}$/.test(last)) {
          const url = templateProjectUrl(state.url, last);
          setState(current => current.status === 'ready' ? { ...current, url } : current);
        }
      } catch { /* Studio's own project list remains available */ }
      setView('editor');
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
        'aria-hidden': view === 'home' ? true : undefined, tabIndex: view === 'home' ? -1 : undefined,
        sandbox: 'allow-scripts allow-same-origin allow-forms allow-downloads allow-popups allow-modals',
        allow: 'clipboard-read; clipboard-write',
        referrerPolicy: 'no-referrer',
        style: { display: 'block', width: '100%', height: '100%', border: 0, background: 'var(--dsw-alias-bg-base)', visibility: view === 'home' ? 'hidden' : 'visible' },
      });
    }
    const ready = state.status === 'ready' && !!boot && !silent;
    const home = h('main', { style: { position: 'absolute', inset: 0, overflow: 'auto', padding: 'clamp(24px, 5vw, 64px)', color: 'var(--dsw-alias-label-primary)', background: 'var(--dsw-alias-bg-base)' } },
      h('div', { style: { maxWidth: 960, margin: '0 auto' } },
        h('h1', { style: { margin: '0 0 8px', fontSize: 28 } }, t('templateHomeTitle')),
        h('p', { style: { margin: '0 0 28px', color: 'var(--dsw-alias-label-secondary)' } }, t('templateHomeDescription')),
        h('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 230px), 1fr))', gap: 12 } },
          ...templates.map(item => h('button', { key: item.id, type: 'button', disabled: creating || creationUncertain || !ready, onClick: () => createTemplate(item.id), style: { textAlign: 'left', minHeight: 150, padding: 20, border: '1px solid var(--dsw-alias-separator, #8886)', borderRadius: 8, background: 'var(--dsw-alias-bg-layer-1, transparent)', color: 'inherit', cursor: 'pointer' } },
            h('strong', { style: { display: 'block', fontSize: 17, marginBottom: 8 } }, item.title),
            h('span', { style: { display: 'block', color: 'var(--dsw-alias-label-secondary)', marginBottom: 20 } }, item.description || ''),
            h('span', null, creating ? t('templateBusy') : t('templateCreate'))))),
        templateError ? h('p', { role: 'alert' }, t(creationUncertain ? 'templateUncertain' : 'templateError')) : null,
        h('button', { type: 'button', disabled: creating || !ready, onClick: openExisting, style: { marginTop: 28 } }, t('openExisting')),
        // Preset status: a silent activation failure would otherwise show up much
        // later as a chat that cannot send.
        preset ? h('p', { role: 'status', style: { marginTop: 12, fontSize: 12, opacity: 0.75 } },
          preset.ok ? t('presetReady') : `${t('presetMissing')} ${String(preset.detail || '').slice(0, 120)}`) : null,
        !ready ? h('div', { style: { marginTop: 16 } }, state.status === 'ready' && !silent ? t('studioLoading') : studio) : null));
    const archived = archive?.available !== false && archive?.archived === true;
    const banner = archived
      ? h('div', {
        role: 'status',
        style: {
          position: 'absolute', top: 0, left: 0, right: 0, zIndex: 40, display: 'flex', flexWrap: 'wrap',
          gap: 8, alignItems: 'center', padding: '8px 12px', fontSize: 12,
          background: 'var(--dsw-alias-bg-layer-2, #2a2a2a)', color: 'var(--dsw-alias-label-primary)',
          borderBottom: '1px solid var(--dsw-alias-separator, #8886)',
        },
      },
      h('span', { style: { flex: '1 1 240px' } }, t('archiveBanner')),
      h('button', { type: 'button', disabled: archiveBusy, onClick: () => changeArchive('unarchive') }, t('archiveRestore')),
      h('button', { type: 'button', disabled: archiveBusy, onClick: () => changeArchive('rebind') }, t('archiveRebind')))
      : null;
    return h('div', { ref: containerRef, style: { position: 'relative', width: '100%', height: '100%', minWidth: 0, minHeight: 0 } },
      state.status === 'ready' && !silent ? studio : view === 'editor' ? studio : null,
      view === 'home' ? home : null,
      banner);
  };
}
