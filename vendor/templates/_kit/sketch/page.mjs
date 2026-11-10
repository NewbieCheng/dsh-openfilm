/**
 * 手绘笔记的页面组装器。
 *
 * 这个模板的模型和另外两个不一样：**只有一场戏**。七个镜头是同一块 1920×1080
 * 纸面上的七个时间窗（`notebook.js` 按绝对时间绘制），页面只负责把窗口的
 * `START` / `DURATION` 交给它。所以这里的"素材"是三样东西，缺一不可：
 *
 *   - `assets/drawing-tools.js` —— 笔触原语（线、圈、箭头、便利贴、荧光笔…）；
 *   - `assets/notebook.js`      —— 把 NOTEBOOK 数据画成那一场戏；
 *   - `assets/notebook-config.js` —— 内容（标题、四步、便签），改字只动这里。
 *
 * 页面本身由本文件生成，七个窗口不会再把 `#t=` 和 `at` 写错。
 */
export function render(shot) {
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${shot.pageTitle}</title>
  <link rel="stylesheet" href="../assets/fonts.css">
  <link rel="stylesheet" href="../assets/page.css">
</head>
<body>
  <canvas id="paper" width="1920" height="1080" aria-label="${shot.title}"></canvas>
  <script src="../assets/notebook-config.js"></script>
  <script src="../assets/drawing-tools.js"></script>
  <script src="../assets/notebook.js"></script>
  <script src="../assets/preview.js"></script>
  <script>
    const START = ${shot.start.toFixed(3)};
    const DURATION = ${shot.duration.toFixed(3)};
    const notebook = createNotebook(document.querySelector('#paper'), NOTEBOOK);

    // The page's local time maps to the same shared paper and camera as every other shot.
    window.film = {
      width: 1920,
      height: 1080,
      duration: DURATION,
      ready: notebook.ready,
      frame(t) {
        const local = Math.max(0, Math.min(DURATION, t));
        notebook.draw(toSourceTime(START + local));
      },
    };
    previewShot(window.film);
  </script>
</body>
</html>
`;
}
