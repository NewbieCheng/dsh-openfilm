import { createStudioPanel } from './studio-panel.mjs';

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
      studioRetry: 'Try again',
      studioTitle: 'OpenFilm Studio', templates: 'Templates', templateCreate: 'Create project', templateBusy: 'Creating…', templateError: 'Unable to load the templates.', templateUncertain: 'The project may have been created. Open existing projects to check before trying again.',
      presetReady: 'Video editing mode: loaded', presetMissing: 'Video editing mode: not loaded —', templateHomeTitle: 'Start a video', templateHomeDescription: 'Choose a template to create a project, or open an existing project.', openExisting: 'Open existing projects',
    };
    const zh = {
      panel: '视频创作',
      studioLoading: '正在启动 OpenFilm 工作台…',
      studioFailed: '无法启动 OpenFilm 工作台。',
      studioRetry: '重试',
      studioTitle: 'OpenFilm 工作台', templates: '模板', templateCreate: '使用模板创建项目', templateBusy: '正在创建…', templateError: '无法加载模板。', templateUncertain: '项目可能已经创建，请先打开已有项目检查，避免重复创建。',
      presetReady: '视频剪辑模式：已加载', presetMissing: '视频剪辑模式：未加载 —', templateHomeTitle: '开始视频创作', templateHomeDescription: '选择模板创建项目，或打开已有项目。', openExisting: '打开已有项目',
    };
    const Panel = createStudioPanel(React);
    const startStudio = async signal => {
      // The Host answers with the editor origin, a desktop ticket and the mode.
      // Project resolution belongs to the official shell itself; this panel no
      // longer creates or maps DSH conversations.
      const surface = `${window.location.protocol}//${window.location.host}`;
      const response = await fetch('/api/no996-openfilm/bootstrap', { method: 'POST', credentials: 'same-origin', headers: { 'x-no996-surface': surface }, signal });
      if (!response.ok) {
        const code = await response.text();
        const known = ['DSH_ORIGIN_REJECTED', 'DSH_SESSION_REQUIRED', 'DSH_BROWSER_REQUIRED', 'STUDIO_DISPOSED'];
        throw new Error(`HTTP ${response.status}${known.includes(code) ? ` (${code})` : ''}`);
      }
      const data = await response.json();
      if (typeof data?.editorOrigin !== 'string') throw new Error('Invalid Studio response');
      return data;
    };
    const templateRequest = async body => {
      const surface = `${window.location.protocol}//${window.location.host}`;
      const response = await fetch('/api/no996-openfilm/templates', { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json', 'x-no996-surface': surface }, body: JSON.stringify(body) });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return response.json();
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
        ctx.slots.inject('main', () => ctx.slots.register({ name: 'main', key: PANEL, locale: NS, inject: () => ({ startStudio, templateRequest }) }, Panel));
        ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({ name: 'sidebar.panellist', id: PANEL, order: 21, locale: NS, label: () => t('panel') }, PanelIcon));
      },
    };
  },
});
