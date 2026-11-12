/*
 * 动作库（Motion）—— 所有状态都是「给定秒数 t 的纯函数」。
 *
 * 为什么必须是纯函数：OpenFilm 导出时逐帧调用 frame(t)，可能并行、可能重跑、
 * 也可能乱序取帧。任何用 Math.random / Date.now / 上一帧状态算出来的画面，都会
 * 让同一秒出现两种结果，导出时表现为闪烁（复刻说明里那条「乱序一致性检查」就是
 * 为这个存在的）。所以这里只允许闭式解：输入 t，输出画面。
 *
 * 词汇来自 dsh-drawai 的 scene-kit（MIT），但重写成无依赖的浏览器脚本：
 * 模板是静态 HTML，没有打包器、没有模块加载、没有 fetch，只有 <script>。
 */
(function (root, factory) {
  const api = factory();
  root.Motion = api;
  if (typeof module === 'object' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  /* ---------------------------------------------------------------- 时间 */

  const clamp01 = (value) => (value < 0 ? 0 : value > 1 ? 1 : value);
  const clamp = (value, min, max) => (value < min ? min : value > max ? max : value);

  /** 从 start 秒起算、长 duration 秒的进度，夹在 0..1。 */
  const seg = (t, start, duration = 0.5) => clamp01((t - start) / (duration || 0.001));

  const lerp = (from, to, p) => from + (to - from) * p;

  /** 第 index 个元素的起始偏移：错峰是 MG 的基本呼吸，不是可选项。 */
  const stagger = (index, step = 0.04) => index * step;

  /* ---------------------------------------------------------------- 缓动 */

  const cubicOut = (p) => 1 - Math.pow(1 - clamp01(p), 3);
  const quintOut = (p) => 1 - Math.pow(1 - clamp01(p), 5);
  const expoOut = (p) => (p >= 1 ? 1 : 1 - Math.pow(2, -10 * clamp01(p)));
  const inOutCubic = (p) => {
    const t = clamp01(p);
    return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
  };

  /** 过冲曲线：overshoot 1.70158 ≈ 10% 出头，是「有生命但不卡通」的默认档。 */
  const backOut = (p, overshoot = 1.70158) => {
    const t = clamp01(p) - 1;
    return 1 + (overshoot + 1) * t * t * t + overshoot * t * t;
  };

  /**
   * 阻尼弹簧的闭式解（秒）。zeta 0.61 → 过冲约 9%：
   *   e^(-pi*zeta/sqrt(1-zeta^2)) ≈ 0.089
   * 这是 scene-kit 里实测「刚好」的一档；更弹就降 zeta，更硬就升。
   * duration 是「基本落定」的时间尺度，不是精确的停止时刻。
   */
  function spring(t, duration = 0.6, zeta = 0.61) {
    if (t <= 0) return 0;
    // zeta = 1 是临界阻尼：wd 会变成 0，公式里的 (zeta*wn)/wd 直接除零。
    // 夹到 0.98 既保留"几乎不弹"的手感，也让这个函数对任意入参都安全。
    const damping = Math.min(Math.max(zeta, 0.05), 0.98);
    const wn = 10 / Math.max(duration, 0.01);
    const wd = wn * Math.sqrt(1 - damping * damping);
    return 1 - Math.exp(-damping * wn * t)
      * (Math.cos(wd * t) + ((damping * wn) / wd) * Math.sin(wd * t));
  }

  /**
   * 落体：加速下坠，触地一帧内挤压回弹（sy 从 0.7 弹回 1，40 rad/s 的快振）。
   * 返回的是「相对量」：y 1→0，sy 1→0.7→1，交给调用方组合。
   */
  function drop(t, duration = 0.3) {
    if (t <= 0) return { y: 1, sy: 1, landed: false };
    if (t < duration) {
      const x = clamp01(t / duration);
      return { y: 1 - x * x, sy: 1, landed: false };
    }
    const tau = t - duration;
    return { y: 0, sy: 1 - 0.3 * Math.exp(-tau / 0.05) * Math.cos(40 * tau), landed: true };
  }

  /** 立面：底座先落位，之后 scaleY 从 base 拉到 1。 */
  function wallScale(t, base = 0.1, duration = 0.6) {
    if (t <= 0) return 0;
    return base + (1 - base) * spring(t, duration);
  }

  /* ------------------------------------------------------------ 确定性随机 */

  /** 32 位整数散列 → [0,1)。同一个种子永远同一结果。 */
  function hash32(seed) {
    let x = seed | 0;
    x = (x ^ 61) ^ (x >>> 16);
    x = x + (x << 3);
    x = x ^ (x >>> 4);
    x = Math.imul(x, 0x27d4eb2d);
    x = x ^ (x >>> 15);
    return (x >>> 0) / 4294967296;
  }

  /** 按 (frame, salt, index) 取的确定随机数。 */
  const det = (frame, salt = 0, index = 0) =>
    hash32(Math.imul(frame + 1, 73856093) ^ Math.imul(salt + 1, 19349663) ^ Math.imul(index + 1, 83492791));

  const detBetween = (frame, salt, index, min, max) => min + (max - min) * det(frame, salt, index);

  /** 低差异序列：累积采样用 Halton(2,3)，均匀随机会让样本扎堆。 */
  function halton(index, base) {
    let result = 0;
    let fraction = 1 / base;
    let i = index + 1;
    while (i > 0) {
      result += (i % base) * fraction;
      i = Math.floor(i / base);
      fraction /= base;
    }
    return result;
  }

  /** 亚像素抖动，居中在 [-0.5, 0.5]。 */
  const jitter = (sample, index) => [halton(index, 2) - 0.5, halton(index, 3) - 0.5];

  /* ------------------------------------------------------------------ DOM */

  const resolve = (target) => (typeof target === 'string' ? document.querySelector(target) : target);

  /**
   * 合成一次姿态。用 translate3d 而非 translate：GPU 合成路径更稳，
   * 大量图层同时动时不会把主线程拖死。
   */
  function pose(target, options) {
    const node = resolve(target);
    if (!node) return;
    const opts = options || {};
    const x = opts.x || 0;
    const y = opts.y || 0;
    const z = opts.z || 0;
    const scale = opts.scale === undefined ? 1 : opts.scale;
    const rotate = opts.rotate || 0;
    const rotateX = opts.rotateX || 0;
    const rotateY = opts.rotateY || 0;
    const opacity = opts.opacity === undefined ? 1 : opts.opacity;
    const blur = opts.blur || 0;

    const parts = ['translate3d(' + x.toFixed(3) + 'px,' + y.toFixed(3) + 'px,' + z.toFixed(3) + 'px)'];
    if (rotate) parts.push('rotate(' + rotate.toFixed(3) + 'deg)');
    if (rotateX) parts.push('rotateX(' + rotateX.toFixed(3) + 'deg)');
    if (rotateY) parts.push('rotateY(' + rotateY.toFixed(3) + 'deg)');
    if (scale !== 1) parts.push('scale(' + scale.toFixed(4) + ')');

    node.style.transform = parts.join(' ');
    node.style.opacity = String(clamp01(opacity).toFixed(4));
    if ('filter' in node.style) node.style.filter = blur > 0.01 ? 'blur(' + blur.toFixed(2) + 'px)' : '';
    if (opts.origin) node.style.transformOrigin = opts.origin;
  }

  /**
   * 入场。默认值与旧 scene.js 的 enter 完全一致（y36 / scale.93 / .5s / cubic-out），
   * 所以老镜头换到这个实现也不会跳；需要弹簧时传 spring: true 或 spring: {zeta}。
   */
  function enter(target, t, start, options) {
    const opts = options || {};
    const duration = opts.duration === undefined ? 0.5 : opts.duration;
    const p = seg(t, start, duration);
    const useSpring = Boolean(opts.spring);
    const zeta = typeof opts.spring === 'object' && opts.spring ? opts.spring.zeta || 0.61 : 0.61;
    const u = useSpring ? spring(Math.max(0, t - start), duration, zeta) : (opts.easing || cubicOut)(p);
    const from = {
      x: opts.x === undefined ? 0 : opts.x,
      y: opts.y === undefined ? 36 : opts.y,
      scale: opts.scale === undefined ? 0.93 : opts.scale,
      rotate: opts.rotate === undefined ? 0 : opts.rotate,
      blur: opts.blur === undefined ? 0 : opts.blur,
    };
    pose(target, {
      x: from.x * (1 - u),
      y: from.y * (1 - u),
      scale: lerp(from.scale, 1, u),
      rotate: from.rotate * (1 - u),
      blur: from.blur * (1 - u),
      opacity: p * 2,
      origin: opts.origin,
    });
  }

  /** 出场。start 是开始离开的时刻，duration 内收干净。 */
  function exit(target, t, start, options) {
    const opts = options || {};
    const duration = opts.duration === undefined ? 0.3 : opts.duration;
    const p = seg(t, start, duration);
    const e = inOutCubic(p);
    pose(target, {
      x: (opts.x || 0) * e,
      y: (opts.y === undefined ? -24 : opts.y) * e,
      scale: lerp(1, opts.scale === undefined ? 0.96 : opts.scale, e),
      rotate: (opts.rotate || 0) * e,
      blur: (opts.blur === undefined ? 6 : opts.blur) * e,
      opacity: 1 - e,
    });
  }

  /** 擦除揭示：方向 x 从左、y 从上；p=0 全遮，p=1 全显。 */
  function reveal(target, p, options) {
    const node = resolve(target);
    if (!node) return;
    const opts = options || {};
    const q = clamp01(p) * 100;
    const hidden = 100 - q;
    const from = opts.from || 'left';
    const inset = from === 'right' ? '0 0 0 ' + hidden + '%'
      : from === 'top' ? hidden + '% 0 0 0'
      : from === 'bottom' ? '0 0 ' + hidden + '% 0'
      : '0 ' + hidden + '% 0 0';
    node.style.clipPath = 'inset(' + inset + ')';
  }

  /**
   * 相机：把整层当作世界，镜头推/摇/转。和「元素动」的区别是
   * 画面里所有东西一起走——这是「电影感」与「幻灯片」的分界。
   */
  function camera(target, options) {
    const node = resolve(target);
    if (!node) return;
    const opts = options || {};
    const zoom = opts.zoom === undefined ? 1 : opts.zoom;
    const rotate = opts.rotate || 0;
    node.style.transformOrigin = opts.origin || '50% 50%';
    node.style.transform = 'translate3d(' + (opts.x || 0).toFixed(3) + 'px,'
      + (opts.y || 0).toFixed(3) + 'px,0) rotate(' + rotate.toFixed(3) + 'deg) scale(' + zoom.toFixed(5) + ')';
  }

  /**
   * 相机取逆：卡片自己写在 world 里的 pose，镜头要抵消它才能对齐。
   * 顺序必须与正变换相反（scale → rotate → translate），否则多轴站会歪。
   */
  function inversePose(options) {
    const opts = options || {};
    const s = opts.scale === undefined ? 1 : opts.scale;
    const z = opts.z || 0;
    return {
      zoom: 1 / (s || 1),
      rotate: -(opts.rotate || 0),
      x: -(opts.x || 0),
      y: -(opts.y || 0),
      z: -z,
    };
  }

  /** 把文字拆成可单独动的单元。重复调用不会重拆（幂等）。 */
  function split(target, mode) {
    const node = resolve(target);
    if (!node || node.getAttribute('data-split') === (mode || 'chars')) return node;
    const unit = mode === 'words' ? /(\s+)/ : /()/;
    const parts = String(node.textContent || '').split(unit).filter((part) => part !== '');
    node.textContent = '';
    for (const part of parts) {
      if (/^\s+$/.test(part)) { node.appendChild(document.createTextNode(part)); continue; }
      const span = document.createElement('span');
      span.className = 'm-unit';
      span.style.display = 'inline-block';
      span.textContent = part;
      node.appendChild(span);
    }
    node.setAttribute('data-split', mode || 'chars');
    return node;
  }

  /** 逐字/逐词入场：配合 split 使用。 */
  function unitsIn(target, t, start, options) {
    const node = resolve(target);
    if (!node) return;
    const opts = options || {};
    const step = opts.step === undefined ? 0.03 : opts.step;
    const duration = opts.duration === undefined ? 0.42 : opts.duration;
    const rise = opts.y === undefined ? 22 : opts.y;
    [...node.querySelectorAll('.m-unit')].forEach((span, index) => {
      const p = seg(t, start + stagger(index, step), duration);
      const u = backOut(p, opts.overshoot === undefined ? 1.2 : opts.overshoot);
      span.style.transform = 'translate3d(0,' + (rise * (1 - u)).toFixed(2) + 'px,0)';
      span.style.opacity = String(clamp01(p * 1.6).toFixed(3));
    });
  }

  /** 数字滚动：从 from 到 to，带千分位与小数位。 */
  function count(target, t, options) {
    const node = resolve(target);
    if (!node) return;
    const opts = options || {};
    const from = opts.from === undefined ? 0 : opts.from;
    const to = opts.to === undefined ? 100 : opts.to;
    const start = opts.start === undefined ? 0 : opts.start;
    const duration = opts.duration === undefined ? 1.2 : opts.duration;
    const e = cubicOut(seg(t, start, duration));
    const value = lerp(from, to, e);
    const decimals = opts.decimals || 0;
    const fixed = value.toFixed(decimals);
    const grouped = opts.group === false ? fixed
      : fixed.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    const next = (opts.prefix || '') + grouped + (opts.suffix || '');
    if (node.textContent !== next) node.textContent = next;
  }

  /* ---------------------------------------------------------------- 画布 */

  /**
   * 画布尺寸与坐标：CSS 像素负责排版，物理像素负责清晰。
   * scale 2 = 两倍超采样再让浏览器缩回去，这是最便宜的 SSAA。
   */
  function surface(canvas, options) {
    const opts = options || {};
    const scale = opts.scale || 2;
    const rect = canvas.getBoundingClientRect ? canvas.getBoundingClientRect() : { width: 0, height: 0 };
    const width = Math.max(1, Math.round(rect.width || canvas.clientWidth || canvas.width || 1));
    const height = Math.max(1, Math.round(rect.height || canvas.clientHeight || canvas.height || 1));
    const pixelWidth = Math.round(width * scale);
    const pixelHeight = Math.round(height * scale);
    if (canvas.width !== pixelWidth) canvas.width = pixelWidth;
    if (canvas.height !== pixelHeight) canvas.height = pixelHeight;
    const ctx = canvas.getContext('2d');
    if (ctx) ctx.setTransform(scale, 0, 0, scale, 0, 0);
    return { ctx, width, height, scale };
  }

  /** 确定性颗粒：AV1/H.264 也压不掉的那种「胶片底噪」。 */
  function grain(ctx, t, options) {
    const opts = options || {};
    const width = opts.width || 1080;
    const height = opts.height || 1920;
    const frame = Math.floor(t * (opts.fps || 30));
    const density = opts.density === undefined ? 0.00012 : opts.density;
    const total = Math.max(1, Math.round(width * height * density));
    ctx.save();
    ctx.globalAlpha = opts.alpha === undefined ? 0.05 : opts.alpha;
    ctx.fillStyle = opts.color || '#ffffff';
    for (let i = 0; i < total; i += 1) {
      const x = det(frame, 11, i) * width;
      const y = det(frame, 12, i) * height;
      const s = 0.6 + det(frame, 13, i) * 1.4;
      ctx.fillRect(x, y, s, s);
    }
    ctx.restore();
  }

  /* ---------------------------------------------------------------- 杂项 */

  function text(target, value) {
    const node = resolve(target);
    if (node && node.textContent !== String(value)) node.textContent = String(value);
  }

  /** 把 0..1 映射到两个数值之间，保留给「参数化镜头」。 */
  const between = (p, from, to) => lerp(from, to, clamp01(p));

  return {
    clamp, clamp01, seg, lerp, between, stagger,
    cubicOut, quintOut, expoOut, inOutCubic, backOut, spring, drop, wallScale,
    hash32, det, detBetween, halton, jitter,
    pose, enter, exit, reveal, camera, inversePose,
    split, unitsIn, count, surface, grain, text,
  };
});
