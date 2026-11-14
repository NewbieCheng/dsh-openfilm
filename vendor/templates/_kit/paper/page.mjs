import { page, renderUnits } from '../render.mjs';

/**
 * 纸纹讲堂的页面组装器。
 *
 * 两个镜头共用同一套单元，差异只有两处：底部字幕的高度、标题的字号与字距。
 * 这些都写进 `shot.vars`，由生成的 `:root` 块落成 CSS 变量——不在页面里写
 * "给镜头 01 用 92px"这种只对人有效的注释。
 *
 * 影片页是一个 DOM 快照：同一本地时间始终画出同一画面（`frame` 为空函数）。
 */
export function render(shot, catalog) {
  const scope = { shot, copy: shot.copy ?? {} };
  const body = renderUnits(shot.units, catalog, scope);
  // 单元样式由 build 合并成 `assets/kit.css`（模板目录必须自包含：安装模板是把
  // 整个目录复制进项目，指向模板目录之外的相对路径在项目里会 404）。
  const vars = Object.entries(shot.vars ?? {})
    .map(([key, value]) => `  --${key}: ${value};`)
    .join('\n');
  const style = [
    `:root {\n${vars}\n}`,
    shot.backdrop ? `body { background: ${shot.backdrop};${shot.relative ? ' position: relative;' : ''} }` : '',
  ].filter(Boolean).join('\n');
  const script = `  // A still page has the same DOM picture at every local time.
  window.film = { width: 1080, height: 1920, duration: ${shot.duration}, ready: document.fonts.ready, frame(_t) {} };`;
  return page({
    title: shot.pageTitle,
    styles: ['../assets/kit.css'],
    style,
    body,
    script,
    size: [1080, 1920],
  });
}
