import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * 复刻影片的页面组装器。
 *
 * 这个模板的"可复用素材"分三种，各自放在该放的地方：
 *   - 视觉与动效词汇（.hero/.card/.pill/.chip-row/.page-list…）在 assets/scene.css + scene.js；
 *   - 内容（COPY）在 shots/<id>.json，一段文案对象，改文案只动这一处；
 *   - 每个镜头自己的画面块是 shots/<id>.content.html，动效是 shots/<id>.anim.js。
 *
 * 页面本身不再手写：头部、舞台、脚本装配、mount 调用都由这里生成，19 个镜头
 * 因此不可能再出现"某个页面忘了 mount、或者 DURATION 和镜头墙对不上"这种漂移。
 */
export function render(shot, _catalog, { templateDir }) {
  const shots = join(templateDir, 'shots');
  const content = readFileSync(join(shots, `${shot.id}.content.html`), 'utf8').replace(/[\s\n]+$/, '');
  const anim = readFileSync(join(shots, `${shot.id}.anim.js`), 'utf8').replace(/\n$/, '');
  const copy = JSON.stringify(shot.copy, null, 2).split('\n').join('\n  ');
  const inlineStyle = shot.style ? `  <style>${shot.style}</style>\n` : '';

  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${shot.pageTitle}</title>
  <link rel="stylesheet" href="../assets/scene.css">
${inlineStyle}</head>
<body>
<main id="stage" class="${shot.theme}">
  <div class="content" id="content">
${content}
  </div>
</main>
<script src="../assets/motion.js"></script>
<script src="../assets/scene.js"></script>
<script>
  // 本镜头的可替换内容。配色在上方 stage 类名和本页 CSS 中修改。
  const COPY = ${copy};
  const DURATION = ${shot.duration};
  const START = ${shot.start};
  const { ${shot.helpers.join(', ')} } = Scene;

  // t 是镜头内的秒数，任意顺序调用都会重建同一画面。
  ${anim.replace(/\n/g, '\n  ')}
  mount(COPY, DURATION, START, draw);
</script>
</body>
</html>
`;
}
