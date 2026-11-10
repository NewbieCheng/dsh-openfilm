/* Canvas helpers adapted from the supplied MotionGit core. See licenses/TEMPLATE-LICENSE.txt. */
function createDrawingTools(canvas) {
  const K = { W: canvas.width, H: canvas.height, ctx: canvas.getContext('2d') };
  if (!K.ctx) throw new Error('Canvas 2D is unavailable');

  // ---------- math ----------
  K.clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
  K.lerp = (a, b, t) => a + (b - a) * t;
  K.map = (t, a, b) => K.clamp((t - a) / (b - a)); // 0..1 progress of t through [a,b]
  K.mix2 = (p, q, t) => [K.lerp(p[0], q[0], t), K.lerp(p[1], q[1], t)];
  K.dist = (p, q) => Math.hypot(q[0] - p[0], q[1] - p[1]);

  const bez = (x1, y1, x2, y2) => (x) => {
    // cubic-bezier timing, solved by bisection (deterministic, fast enough)
    let lo = 0, hi = 1, s = x;
    for (let i = 0; i < 24; i++) {
      s = (lo + hi) / 2;
      const bx = 3 * x1 * s * (1 - s) ** 2 + 3 * x2 * s * s * (1 - s) + s ** 3;
      if (bx < x) lo = s; else hi = s;
    }
    return 3 * y1 * s * (1 - s) ** 2 + 3 * y2 * s * s * (1 - s) + s ** 3;
  };
  K.ease = {
    linear: (t) => t,
    in: (t) => t * t * t,
    out: (t) => 1 - (1 - t) ** 3,
    inOut: (t) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2),
    sine: (t) => -(Math.cos(Math.PI * t) - 1) / 2,
    expoOut: (t) => (t >= 1 ? 1 : 1 - 2 ** (-10 * t)),
    expoIn: (t) => (t <= 0 ? 0 : 2 ** (10 * t - 10)),
    quintOut: (t) => 1 - (1 - t) ** 5,
    smooth: (t) => t * t * t * (t * (6 * t - 15) + 10),
    backOut: (t, s = 1.7) => 1 + (s + 1) * (t - 1) ** 3 + s * (t - 1) ** 2,
    // damped spring settling to 1; f = oscillations/sec feel, d = damping
    spring: (t, f = 2.2, d = 6) => (t <= 0 ? 0 : 1 - Math.exp(-d * t) * Math.cos(2 * Math.PI * f * t)),
    bezier: bez,
    swift: bez(0.65, 0, 0.35, 1),
    emph: bez(0.2, 0, 0, 1),
  };
  // eased progress through window [a,b]
  K.p = (t, a, b, e = K.ease.out) => e(K.map(t, a, b));
  // 0→1 in, hold, 1→0 out (for elements with a life span)
  K.life = (t, a, b, fin = 0.4, fout = 0.3, e = K.ease.out) =>
    Math.min(e(K.map(t, a, a + fin)), 1 - K.ease.in(K.map(t, b - fout, b)));
  // stepped time for "on twos" animation (fps of the element, not the camera)
  K.step = (t, fps = 12) => Math.floor(t * fps) / fps;

  // ---------- deterministic randomness ----------
  K.rng = (seed = 1) => {
    let a = seed >>> 0;
    return () => {
      a |= 0; a = (a + 0x6d2b79f5) | 0;
      let r = Math.imul(a ^ (a >>> 15), 1 | a);
      r = (r + Math.imul(r ^ (r >>> 7), 61 | r)) ^ r;
      return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
    };
  };
  const hash = (i, s) => {
    let h = (i * 374761393 + s * 668265263) | 0;
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
  };
  K.noise = (x, seed = 0) => {
    const i = Math.floor(x), f = x - i, u = f * f * (3 - 2 * f);
    return K.lerp(hash(i, seed), hash(i + 1, seed), u) * 2 - 1;
  };

  // ---------- polylines ----------
  K.cum = (pts) => {
    const c = [0];
    for (let i = 1; i < pts.length; i++) c.push(c[i - 1] + K.dist(pts[i - 1], pts[i]));
    return c;
  };
  K.pointAt = (pts, frac, cum = K.cum(pts)) => {
    const L = cum[cum.length - 1] * K.clamp(frac);
    let i = 1;
    while (i < cum.length - 1 && cum[i] < L) i++;
    const seg = cum[i] - cum[i - 1] || 1, u = (L - cum[i - 1]) / seg;
    return K.mix2(pts[i - 1], pts[i], K.clamp(u));
  };
  // stroke the first `frac` of a polyline; returns the pen tip
  K.partial = (ctx, pts, frac, cum = K.cum(pts)) => {
    if (frac <= 0 || pts.length < 2) return null;
    const L = cum[cum.length - 1] * Math.min(1, frac);
    ctx.beginPath();
    ctx.moveTo(pts[0][0], pts[0][1]);
    let tip = pts[0];
    for (let i = 1; i < pts.length; i++) {
      if (cum[i] <= L) { ctx.lineTo(pts[i][0], pts[i][1]); tip = pts[i]; continue; }
      const u = (L - cum[i - 1]) / (cum[i] - cum[i - 1]);
      tip = K.mix2(pts[i - 1], pts[i], u);
      ctx.lineTo(tip[0], tip[1]);
      break;
    }
    ctx.stroke();
    return tip;
  };
  K.line = (a, b, n = 24) => Array.from({ length: n + 1 }, (_, i) => K.mix2(a, b, i / n));
  K.arc = (cx, cy, rx, ry, a0, a1, n = 64) =>
    Array.from({ length: n + 1 }, (_, i) => {
      const a = K.lerp(a0, a1, i / n);
      return [cx + Math.cos(a) * rx, cy + Math.sin(a) * ry];
    });
  K.quad = (a, c, b, n = 40) =>
    Array.from({ length: n + 1 }, (_, i) => {
      const s = i / n, m = 1 - s;
      return [m * m * a[0] + 2 * m * s * c[0] + s * s * b[0], m * m * a[1] + 2 * m * s * c[1] + s * s * b[1]];
    });
  // hand-made wobble: low-frequency offset along the normal
  K.wobble = (pts, amp = 2, seed = 1, freq = 0.012) => {
    const cum = K.cum(pts);
    return pts.map((p, i) => {
      const a = pts[Math.max(0, i - 1)], b = pts[Math.min(pts.length - 1, i + 1)];
      const dx = b[0] - a[0], dy = b[1] - a[1], l = Math.hypot(dx, dy) || 1;
      const n = K.noise(cum[i] * freq, seed) * amp;
      return [p[0] - (dy / l) * n, p[1] + (dx / l) * n];
    });
  };

  // ---------- text ----------
  K.font = (size, family, weight = 400, style = '') => `${style} ${weight} ${size}px ${family}`.trim();
  K.text = (ctx, s, x, y, o = {}) => {
    ctx.save();
    ctx.font = K.font(o.size || 40, o.family || 'KX-Sans', o.weight || 500, o.style || '');
    ctx.fillStyle = o.color || '#111';
    ctx.textAlign = o.align || 'left';
    ctx.textBaseline = o.baseline || 'alphabetic';
    if (o.ls) ctx.letterSpacing = o.ls + 'px';
    if (o.alpha != null) ctx.globalAlpha *= o.alpha;
    ctx.fillText(s, x, y);
    const w = ctx.measureText(s).width;
    ctx.restore();
    return w;
  };
  K.measure = (ctx, s, o = {}) => {
    ctx.save();
    ctx.font = K.font(o.size || 40, o.family || 'KX-Sans', o.weight || 500, o.style || '');
    if (o.ls) ctx.letterSpacing = o.ls + 'px';
    const w = ctx.measureText(s).width;
    ctx.restore();
    return w;
  };
  // ---------- camera ----------
  // cam = { x, y, z, r } : world point (x,y) at screen centre, zoom z, rotation r
  K.camApply = (ctx, cam) => {
    ctx.translate(K.W / 2, K.H / 2);
    if (cam.r) ctx.rotate(cam.r);
    ctx.scale(cam.z, cam.z);
    ctx.translate(-cam.x, -cam.y);
  };
  // keyframed camera; zoom interpolated in log space so every frame scales by the same ratio
  K.camAt = (t, keys, e = K.ease.swift) => {
    if (t <= keys[0].t) return { ...keys[0] };
    for (let i = 1; i < keys.length; i++) {
      const k0 = keys[i - 1], k1 = keys[i];
      if (t < k1.t) {
        const ht = k0.hold ? k0.t + k0.hold : k0.t;
        if (t < ht) return { ...k0 };
        const u = (k1.e || e)(K.map(t, ht, k1.t));
        return {
          x: K.lerp(k0.x, k1.x, u), y: K.lerp(k0.y, k1.y, u),
          z: Math.exp(K.lerp(Math.log(k0.z), Math.log(k1.z), u)),
          r: K.lerp(k0.r || 0, k1.r || 0, u),
        };
      }
    }
    return { ...keys[keys.length - 1] };
  };

  // cached offscreen layers (paper grain, static backgrounds)
  const cache = {};
  K.cached = (key, w, h, fn) => {
    if (!cache[key]) {
      const c = document.createElement('canvas');
      c.width = w; c.height = h;
      fn(c.getContext('2d'), w, h);
      cache[key] = c;
    }
    return cache[key];
  };
  K.grain = (key, w, h, amt = 10, seed = 7, mono = true) =>
    K.cached('grain:' + key, w, h, (g) => {
      const im = g.createImageData(w, h), r = K.rng(seed);
      for (let i = 0; i < im.data.length; i += 4) {
        const v = (r() - 0.5) * amt;
        im.data[i] = 128 + v;
        im.data[i + 1] = 128 + (mono ? v : (r() - 0.5) * amt);
        im.data[i + 2] = 128 + (mono ? v : (r() - 0.5) * amt);
        im.data[i + 3] = 255;
      }
      g.putImageData(im, 0, 0);
    });

  return K;
}
