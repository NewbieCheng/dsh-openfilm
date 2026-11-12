import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

/**
 * 动效风格页面的组装器。
 *
 * 风格样片是上游的「整片单文件」：给定 t 画一帧（window.renderAt）。它们跑在
 * DrawAI 的开发服务器里，所以会 fetch 自己的 cues.json、引用 /assets 字体，
 * 也可能依赖 /node_modules。这里只做三件事，其余源码逐字保留：
 *
 *   1. 把样片要 fetch 的 cues.json 内联进来（file:// 下 fetch 会被拒绝）；
 *   2. 去掉 /assets 字体链接（模板必须自包含，字体缺失时走系统回退）；
 *   3. 包上 OpenFilm 的影片契约：window.film = { duration, width, height, ready, frame }。
 *
 * 不做的事：不改样片的绘制逻辑、不抽帧重画、不引入构建器。改画面请改样片源码，
 * 这样「模板画出来的」和「作者看到的」永远是同一份实现。
 */

const motionRoot = fileURLToPath(new URL('../../../motion/styles/', import.meta.url));

const escapeHtml = (value) => String(value)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const stripExternalLinks = (html) => html.replace(/\s*<link[^>]*href="\/assets\/[^"]*"[^>]*>/g, '');

/** fetch 垫片：只回答样片自己的 cues.json，其它一律拒绝（模板不允许联网）。 */
function fetchShim(cues) {
  return [
    '<script>',
    'window.fetch = function (input) {',
    '  var url = String(input && input.url ? input.url : input);',
    '  if (url.indexOf("cues.json") === -1) return Promise.reject(new Error("blocked by film page: " + url));',
    '  var body = ' + JSON.stringify(cues) + ';',
    '  return Promise.resolve({ ok: true, status: 200, json: function () { return Promise.resolve(body); }, text: function () { return Promise.resolve(JSON.stringify(body)); } });',
    '};',
    '</script>',
  ].join('\n');
}

/** 影片契约 + 视口适配。样片按 1920x1080 排版，缩放到当前 iframe。 */
function filmContract(spec) {
  return [
    '<script>',
    '(function () {',
    '  var W = ' + spec.width + ', H = ' + spec.height + ', DURATION = ' + spec.duration + ';',
    '  function fit() {',
    '    var scale = Math.min(window.innerWidth / W, window.innerHeight / H);',
    '    document.body.style.transformOrigin = "0 0";',
    '    document.body.style.transform = "translate(" + ((window.innerWidth - W * scale) / 2) + "px,"',
    '      + ((window.innerHeight - H * scale) / 2) + "px) scale(" + scale + ")";',
    '  }',
    '  fit();',
    '  window.addEventListener("resize", fit);',
    '  var ready = new Promise(function (resolve) {',
    '    var tick = function () {',
    '      if (window.__ready === true && typeof window.renderAt === "function") resolve();',
    '      else setTimeout(tick, 16);',
    '    };',
    '    tick();',
    '  });',
    '  window.film = {',
    '    duration: DURATION, width: W, height: H, ready: ready,',
    '    frame: function (t) { return typeof window.renderAt === "function" ? window.renderAt(t) : undefined; },',
    '  };',
    '})();',
    '</script>',
  ].join('\n');
}

/** 自写场景的契约：DURATION 与 draw 由场景脚本声明，这里只做缩放与转发。 */
function authoredContract(spec) {
  return [
    '<script>',
    '(function () {',
    '  var W = ' + spec.width + ', H = ' + spec.height + ';',
    '  function fit() {',
    '    var scale = Math.min(window.innerWidth / W, window.innerHeight / H);',
    '    var stage = document.getElementById("stage");',
    '    stage.style.transform = "translate(" + ((window.innerWidth - W * scale) / 2) + "px,"',
    '      + ((window.innerHeight - H * scale) / 2) + "px) scale(" + scale + ")";',
    '  }',
    '  fit();',
    '  window.addEventListener("resize", fit);',
    '  window.film = {',
    '    duration: DURATION, width: W, height: H, ready: Promise.resolve(),',
    '    frame: function (t) { return draw(t); },',
    '  };',
    '})();',
    '</script>',
  ].join('\n');
}

function authoredShell(shot, templateDir) {
  const body = readFileSync(join(templateDir, 'shots', shot.scene), 'utf8');
  const width = 1920;
  const height = 1080;
  return [
    '<!doctype html>',
    '<html lang="zh-CN">',
    '<head>',
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=' + width + ', height=' + height + '">',
    '<title>' + escapeHtml(shot.pageTitle || shot.title) + '</title>',
    '<style>html,body{margin:0;background:#111;overflow:hidden}#stage{position:relative;width:' + width + 'px;height:' + height + 'px;transform-origin:0 0}</style>',
    // 动作库必须在场景脚本之前执行：场景脚本在 body 里，经典脚本按文档顺序跑。
    '<script src="../assets/motion.js"></script>',
    '</head>',
    '<body>',
    '<main id="stage">',
    body,
    '</main>',
    authoredContract({ width: width, height: height }),
    '</body>',
    '</html>',
    '',
  ].join('\n');
}

export function render(shot, _catalog, options) {
  if (shot.scene) return authoredShell(shot, options.templateDir);
  const demoDir = join(motionRoot, 'demos', shot.style);
  let html = readFileSync(join(demoDir, 'index.html'), 'utf8');
  const cues = JSON.parse(readFileSync(join(demoDir, 'cues.json'), 'utf8'));

  html = stripExternalLinks(html);
  html = html.replace(/<title>[^<]*<\/title>/, '<title>' + escapeHtml(shot.pageTitle || shot.title) + '</title>');
  // 垫片必须比样片的 module 脚本先执行：module 是 deferred，head 里的经典脚本先跑。
  html = html.replace('</head>', '<style>html,body{overflow:hidden!important}</style>\n' + fetchShim(cues) + '\n</head>');
  html = html.replace('</body>', filmContract({ width: 1920, height: 1080, duration: shot.duration }) + '\n</body>');
  return html;
}
