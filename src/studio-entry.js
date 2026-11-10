import { createStudioPanel } from './studio-panel.mjs';
import { createActivationStore } from './panel-keepalive.mjs';

window.__ModuleLoader__.load({
  id: 'dsh-openfilm',
  factory(require) {
    const React = require('react');
    const h = React.createElement;
    const NS = 'no996Openfilm';
    const PANEL = 'no996-openfilm';
    const en = {
      panel: 'Video studio',
      studioLoading: 'Starting OpenFilm Studio…',
      studioFailed: 'Unable to start OpenFilm Studio.',
      studioRetry: 'Try again', studioStopped: 'Video workspace stopped', studioStoppedHint: 'The editing service is not running. Restart it to continue; projects and media are untouched.', studioRestart: 'Restart workspace',
      studioTitle: 'OpenFilm Studio',
      presetReady: 'Video editing mode: loaded', presetMissing: 'Video editing mode: not loaded —',
      archiveBanner: 'This project conversation is archived; its messages stay hidden until restored.', archiveRestore: 'Restore conversation', archiveRebind: 'Start a new conversation',
    };
    const zh = {
      panel: '视频创作',
      studioLoading: '正在启动 OpenFilm 工作台…',
      studioFailed: '无法启动 OpenFilm 工作台。',
      studioRetry: '重试', studioStopped: '工作台已停止运行', studioStoppedHint: '视频编辑服务已断开。重新启动即可继续，项目和素材不受影响。', studioRestart: '重新启动工作台',
      studioTitle: 'OpenFilm 工作台',
      presetReady: '视频剪辑模式：已加载', presetMissing: '视频剪辑模式：未加载 —',
      archiveBanner: '这个项目的会话已归档，恢复前不显示历史消息。', archiveRestore: '恢复会话', archiveRebind: '新建会话',
    };
    const Panel = createStudioPanel(React);
    // The real panel is rendered once and then only shown or hidden; `main`
    // receives a placeholder that reports selection (see panel-keepalive.mjs).
    const activation = createActivationStore();
    function PanelSeat() {
      const ref = React.useRef(null);
      React.useEffect(() => {
        activation.enter(ref.current);
        return () => activation.leave();
      }, []);
      return h('div', { ref, style: { width: '100%', height: '100%', minWidth: 0, minHeight: 0 } });
    }
    function PanelKeepAlive(props) {
      const [shown, setShown] = React.useState(activation.isActive());
      const [mounted, setMounted] = React.useState(activation.isActive());
      const box = React.useRef(null);
      React.useEffect(() => activation.subscribe(active => { setShown(active); if (active) setMounted(true); }), []);
      React.useEffect(() => {
        if (!shown) return;
        // Follow the placeholder's rectangle so the panel tracks the sidebar and
        // zoom changes without knowing the shell's layout internals.
        const place = () => {
          const element = box.current;
          if (!element) return;
          const rect = activation.seat()?.getBoundingClientRect();
          element.style.left = `${Math.max(0, rect?.left ?? 0)}px`;
          element.style.top = `${Math.max(0, rect?.top ?? 0)}px`;
          element.style.width = `${rect?.width || window.innerWidth}px`;
          element.style.height = `${rect?.height || window.innerHeight}px`;
        };
        place();
        window.addEventListener('resize', place);
        const timer = setInterval(place, 500);
        return () => { window.removeEventListener('resize', place); clearInterval(timer); };
      }, [shown]);
      if (!mounted) return null;
      return h('div', {
        ref: box,
        style: {
          position: 'fixed', zIndex: 30, display: shown ? 'block' : 'none', overflow: 'hidden',
          background: 'var(--dsw-alias-bg-base, #fff)', borderLeft: '1px solid var(--dsw-alias-separator, #0000)',
        },
      }, h(Panel, props));
    }
    const startStudio = async signal => {
      // The Host answers with the editor origin, a desktop ticket and the mode.
      // Project resolution belongs to the official shell itself; this panel no
      // longer creates or maps DSH conversations.
      const surface = `${window.location.protocol}//${window.location.host}`;
      const response = await fetch('/api/no996-openfilm/bootstrap', { method: 'POST', credentials: 'same-origin', headers: { 'x-no996-surface': surface }, signal });
      if (!response.ok) {
        const code = await response.text();
        const known = ['DSH_ORIGIN_REJECTED', 'DSH_SESSION_REQUIRED', 'DSH_BROWSER_REQUIRED', 'STUDIO_DISPOSED'];
        // The origin is part of the message on purpose: a 404 here means the
        // request never reached this Host, and the only way to tell why without
        // a console is to see which origin the page thinks it is on.
        throw new Error(`HTTP ${response.status}${known.includes(code) ? ` (${code})` : ''} @ ${window.location.origin}`);
      }
      const data = await response.json();
      if (typeof data?.editorOrigin !== 'string') throw new Error('Invalid Studio response');
      return data;
    };
    function PanelIcon({ size }) {
      return h('svg', { width: size, height: size, viewBox: '0 0 24 24', fill: 'none', 'aria-hidden': true },
        h('rect', { x: 3, y: 5, width: 18, height: 14, rx: 3, stroke: 'currentColor', strokeWidth: 1.7 }),
        h('path', { d: 'm10 9 5 3-5 3V9Z', fill: 'currentColor' }));
    }
    return {
      inject: ['slots', 'locale'],
      apply(ctx) {
        ctx.effect(() => ctx.locale.register(NS, { en, zh }), 'openfilm: dictionaries');
        const t = ctx.locale.bind(NS);
        ctx.slots.inject('main', () => ctx.slots.register({ name: 'main', key: PANEL, locale: NS }, PanelSeat));
        ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({ name: 'sidebar.panellist', id: PANEL, order: 21, locale: NS, label: () => t('panel') }, PanelIcon));
        // `shell.overlay` is rendered for the whole frame lifetime, so the panel
        // it hosts survives page switches instead of reloading Studio each time.
        ctx.slots.inject('shell.overlay', () => ctx.slots.register({ name: 'shell.overlay', id: 'no996-openfilm-panel', order: 0, locale: NS, inject: () => ({ startStudio }) }, PanelKeepAlive));
      },
    };
  },
});
