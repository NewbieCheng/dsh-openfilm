/* Canvas scene adapted from the supplied Dot-Grid Sketchnote source.
   Drawing order, pen paths, camera keys and fixed scene units are preserved.
   Source attribution and use scope are described in licenses/TEMPLATE-LICENSE.txt. */
function createNotebook(canvas, copy) {
  const K = createDrawingTools(canvas);
  const E = K.ease;
  const C = copy.palette;
  const KAI = 'SK-Kai', BRUSH = 'SK-Brush', NUM = 'SK-Num', MONO = 'SK-Mono';
  const PW = 3500, PH = 1600, DOT = 40;
  const DUR = 16;
  const STEP_TIMES = [2.5, 5.2, 7.9, 10.6];

  // camera: title drift → four steps (sine pans ~0.26–0.35 screen width, heavy overlap) → pull back + settle
  const CAM = [
    { t: 0, x: 790, y: 430, z: 1.34 },
    { t: 2.35, x: 800, y: 425, z: 1.3, e: E.linear },
    { t: 3.45, x: 790, y: 835, z: 1.2, e: E.sine, hold: 4.95 - 3.45 },
    { t: 6.15, x: 1440, y: 965, z: 1.2, e: E.sine, hold: 7.65 - 6.15 },
    { t: 8.85, x: 2170, y: 835, z: 1.2, e: E.sine, hold: 10.35 - 8.85 },
    { t: 11.55, x: 2640, y: 965, z: 1.2, e: E.sine, hold: 13.1 - 11.55 },
    { t: 14.5, x: 1750, y: 940, z: 0.524, e: E.sine },
    { t: 16.0, x: 1750, y: 942, z: 0.531, e: E.linear },
  ];

  // ---------- geometry helpers ----------
  const densify = (pts, step = 5) => {
    const out = [pts[0]];
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1], b = pts[i], n = Math.max(1, Math.ceil(K.dist(a, b) / step));
      for (let j = 1; j <= n; j++) out.push(K.mix2(a, b, j / n));
    }
    return out;
  };
  let SEED = 11;
  const wob = (pts, amp = 1.6) => K.wobble(densify(pts), amp, SEED++, 0.018);
  const tr = (pts, dx, dy) => pts.map((p) => [p[0] + dx, p[1] + dy]);
  const arcPts = (cx, cy, r, a0, a1, n = 48) => K.arc(cx, cy, r, r, a0, a1, n);
  const head = (tip, ang, len = 26, sp = 0.46) => [
    [tip[0] - len * Math.cos(ang - sp), tip[1] - len * Math.sin(ang - sp)], tip,
    [tip[0] - len * Math.cos(ang + sp), tip[1] - len * Math.sin(ang + sp)],
  ];
  const rrOpen = (x0, y0, x1, y1, r, ga, gb) => {
    const P = [[gb, y1], [x1 - r, y1]];
    const arc = (cx, cy, a0, a1) => { for (let i = 0; i <= 8; i++) { const a = a0 + (a1 - a0) * i / 8; P.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]); } };
    arc(x1 - r, y1 - r, Math.PI / 2, 0); arc(x1 - r, y0 + r, 0, -Math.PI / 2);
    arc(x0 + r, y0 + r, -Math.PI / 2, -Math.PI); arc(x0 + r, y1 - r, Math.PI, Math.PI / 2);
    P.push([ga, y1]);
    return P;
  };
  const polyPath = (pts) => { const p = new Path2D(); pts.forEach((q, i) => (i ? p.lineTo(q[0], q[1]) : p.moveTo(q[0], q[1]))); p.closePath(); return p; };
  const blobPath = (cx, cy, r, seed, ry = r) => {
    const pts = [];
    for (let i = 0; i < 40; i++) {
      const a = (i / 40) * Math.PI * 2, k = 1 + 0.06 * K.noise(i * 0.35, seed);
      pts.push([cx + Math.cos(a) * r * k, cy + Math.sin(a) * ry * k]);
    }
    return polyPath(pts);
  };

  // ---------- timeline of drawing ops ----------
  const ops = [];
  const nibOps = []; // ops the nib physically draws: {t0,t1,start,end,tip(t)}

  const addLine = (pts, t0, t1, o = {}) => {
    const op = { kind: 'line', pts, cum: K.cum(pts), t0, t1, w: o.w || 4.6, color: o.color || C.ink, dash: o.dash };
    op.start = pts[0]; op.end = pts[pts.length - 1];
    op.tip = (t) => K.pointAt(pts, E.sine(K.map(t, t0, t1)), op.cum);
    ops.push(op); nibOps.push(op);
    return op;
  };
  // split [t0,t1] across strokes by length, small pen-lifts in between
  const addStrokes = (list, t0, t1, o = {}, gap = 0.035) => {
    const L = list.map((p) => K.cum(p).pop()), S = L.reduce((a, b) => a + b, 0);
    const T = t1 - t0 - gap * (list.length - 1);
    let t = t0;
    list.forEach((p, i) => { const d = Math.max(0.05, (T * L[i]) / S); addLine(p, t, t + d, o); t += d + gap; });
    return t - gap;
  };
  const addText = (str, x, y, t0, t1, o = {}) => {
    if (!str) return { range: () => null };
    const ctx = K.ctx, f = { size: o.size || 40, family: o.family || KAI, weight: o.weight || 500 };
    if (o.center) x -= K.measure(ctx, str, f) / 2;
    const chars = [...str], wts = chars.map((c) => (/[，。、：；“”（）·\s]/.test(c) ? 0.45 : 1));
    const W = wts.reduce((a, b) => a + b, 0), dur = t1 - t0;
    let acc = 0, pre = '';
    const cs = chars.map((ch, i) => {
      const cx = x + K.measure(ctx, pre, f), w = K.measure(ctx, ch, f);
      const a = t0 + (acc / W) * dur; acc += wts[i];
      const b = t0 + (acc / W) * dur - 0.012;
      pre += ch;
      return { ch, x: cx, w, a, b };
    });
    const op = { kind: 'text', str, chars: cs, x, y, f, color: o.color || C.ink, t0, t1, rot: o.rot || 0 };
    const sz = f.size, sl = sz * 0.18;
    op.front = (c, u) => c.x + u * (c.w + 2 * sl) - sl;
    op.tip = (t) => {
      const c = cs.find((q) => t <= q.b) || cs[cs.length - 1];
      const u = K.map(t, c.a, c.b);
      return [op.front(c, u), y - sz * 0.36 + sz * 0.3 * Math.sin(u * Math.PI * 5)];
    };
    op.start = [x, y - sz * 0.36];
    op.end = [cs[cs.length - 1].x + cs[cs.length - 1].w, y - sz * 0.36];
    op.range = (phrase) => {
      if (!phrase || !str.includes(phrase)) return null;
      const first = [...str.slice(0, str.indexOf(phrase))].length;
      const last = first + [...phrase].length - 1;
      return [cs[first].x, cs[last].x + cs[last].w];
    };
    ops.push(op); nibOps.push(op);
    return op;
  };
  // marker / wash: a Path2D revealed by a sweeping (chisel-slanted) clip, multiply blend
  const addWash = (path, box, color, t0, t1, o = {}) => {
    const op = { kind: 'wash', path, box, color, t0, t1, alpha: o.alpha || 0.9, streaks: o.streaks };
    ops.push(op);
    return op;
  };
  const addHL = (x0, x1, yc, h, color, t0, t1, seed) => {
    const r = K.rng(seed), top = [], bot = [];
    const tilt = (r() - 0.5) * 0.012;
    for (let i = 0; i <= 14; i++) {
      const x = K.lerp(x0, x1, i / 14);
      top.push([x, yc - h / 2 + K.noise(i * 0.6, seed) * 2.2 + tilt * (x - x0)]);
      bot.unshift([x, yc + h / 2 + K.noise(i * 0.6, seed + 3) * 2.2 + tilt * (x - x0)]);
    }
    // chisel ends: slanted, slightly ragged
    const pts = [[x0 + 7, top[0][1]], ...top.slice(1), [x1 + 9 + r() * 4, top[14][1] + 2], [x1 + 2, yc + 2], [x1 + 5, bot[0][1]], ...bot.slice(1), [x0 - 8, bot[14][1]], [x0 - 3, yc]];
    return addWash(polyPath(pts), [x0 - 14, yc - h, x1 + 20, yc + h], color, t0, t1, { alpha: 0.88, streaks: { x0, x1, yc, h } });
  };
  const addPop = (t0, draw) => { const op = { kind: 'pop', t0, draw }; ops.push(op); return op; };
  const addSticky = (o) => { ops.push({ kind: 'sticky', ...o }); };
  const addTape = (o) => { ops.push({ kind: 'tape', ...o }); };

  // ---------- icons (strokes around a centre) ----------
  const iconBulb = (cx, cy) => {
    const c = [cx, cy - 30], r = 78, d2r = Math.PI / 180;
    const bulb = [[cx - 34, cy + 62], ...arcPts(c[0], c[1], r, 135 * d2r, 405 * d2r, 60), [cx + 34, cy + 62]];
    const fil = [[cx - 18, cy + 58], [cx - 18, cy + 12], [cx - 9, cy - 4], [cx, cy + 12], [cx + 9, cy - 4], [cx + 18, cy + 12], [cx + 18, cy + 58]];
    const base = [[cx - 38, cy + 74], [cx + 38, cy + 74]];
    const base2 = [[cx - 32, cy + 90], [cx + 32, cy + 90]];
    const tip = K.quad([cx - 18, cy + 102], [cx, cy + 120], [cx + 18, cy + 102], 16);
    const rays = [-155, -122, -90, -58, -25].map((a) => [
      [c[0] + Math.cos(a * d2r) * 102, c[1] + Math.sin(a * d2r) * 102],
      [c[0] + Math.cos(a * d2r) * 128, c[1] + Math.sin(a * d2r) * 128],
    ]);
    return { strokes: [bulb, fil, base, base2, tip].map((p) => wob(p, 1.5)).concat(rays.map((p) => wob(p, 0.8))), fill: blobPath(c[0] + 8, c[1] + 7, 68, 41) };
  };
  const iconTalk = (cx, cy) => {
    const big = rrOpen(cx - 150, cy - 105, cx + 50, cy + 12, 30, cx - 104, cx - 70);
    big.push([cx - 132, cy + 62], [cx - 70, cy + 12]);
    const l1 = [[cx - 120, cy - 70], [cx + 20, cy - 70]], l2 = [[cx - 120, cy - 44], [cx - 4, cy - 44]], l3 = [[cx - 120, cy - 18], [cx - 40, cy - 18]];
    const d2r = Math.PI / 180, lc = [cx + 98, cy + 66], lr = 42;
    const small = [...arcPts(lc[0], lc[1], lr, 62 * d2r, 380 * d2r, 50), [cx + 150, cy + 122], [lc[0] + Math.cos(62 * d2r) * lr, lc[1] + Math.sin(62 * d2r) * lr]];
    return { strokes: [big, l1, l2, l3, small].map((p) => wob(p, 1.4)), fill: blobPath(lc[0] + 6, lc[1] + 5, 39, 52), q: lc };
  };
  const iconLoop = (cx, cy) => {
    const L = [[cx, cy + 48], [cx, cy - 20], [cx - 76, cy - 38], [cx - 76, cy + 32], [cx, cy + 48]];
    const R = [[cx, cy - 20], [cx + 76, cy - 38], [cx + 76, cy + 32], [cx, cy + 48]];
    const pl = [[[cx - 62, cy - 18], [cx - 14, cy - 8]], [[cx - 62, cy], [cx - 14, cy + 10]], [[cx + 14, cy - 8], [cx + 62, cy - 18]], [[cx + 14, cy + 10], [cx + 50, cy + 2]]];
    const d2r = Math.PI / 180, r = 120, a1 = 498 * d2r;
    const arc = arcPts(cx, cy + 4, r, 205 * d2r, a1, 70);
    const end = arc[arc.length - 1], ang = a1 + Math.PI / 2;
    const fill = new Path2D();
    fill.addPath(polyPath(tr([[cx, cy + 48], [cx, cy - 20], [cx - 76, cy - 38], [cx - 76, cy + 32]], 6, 5)));
    fill.addPath(polyPath(tr([[cx, cy - 20], [cx + 76, cy - 38], [cx + 76, cy + 32], [cx, cy + 48]], 6, 5)));
    return { strokes: [wob(L, 1.2), wob(R, 1.2), ...pl.map((p) => wob(p, 0.6)), wob(arc, 2.2), wob(head(end, ang, 30), 0.6)], fill };
  };
  const iconSimplify = (cx, cy) => {
    const coil = [];
    for (let i = 0; i <= 120; i++) {
      const u = i / 120;
      coil.push([cx - 150 + 118 * u + 24 * Math.cos(9 * Math.PI * u + Math.PI), cy - 34 * Math.sin(9 * Math.PI * u) + 8 * Math.sin(u * 11)]);
    }
    const ar = [[cx - 16, cy], [cx + 30, cy]];
    const clean = [[cx + 54, cy + 2], [cx + 160, cy - 2]];
    const sp = [cx + 112, cy - 50], st = [];
    for (let i = 0; i <= 8; i++) { const a = -Math.PI / 2 + (i * Math.PI) / 4, r = i % 2 ? 6 : 22; st.push([sp[0] + Math.cos(a) * r, sp[1] + Math.sin(a) * r]); }
    const s1 = st, s2 = [[sp[0] + 30, sp[1] - 22], [sp[0] + 38, sp[1] - 30]];
    return { strokes: [wob(coil, 1), wob(ar, 0.6), wob(head([cx + 32, cy], 0, 18), 0.4), wob(clean, 1), wob(s1, 0.4), wob(s2, 0.4)], hl: [cx + 50, cx + 162, cy] };
  };

  // ---------- page content ----------
  const STEPS = [
    { bx: 300, by: 620, col: C.mint, icon: iconBulb },
    { bx: 1020, by: 760, col: C.butter, icon: iconTalk },
    { bx: 1740, by: 620, col: C.mint, icon: iconLoop },
    { bx: 2460, by: 760, col: C.butter, icon: iconSimplify, noteDx: 420, iconDx: 175 },
  ].map((layout, i) => ({ ...layout, n: String(i + 1), ...copy.steps[i] }));
  const ARROWS = [
    null,
    { a: [826, 670], c: [940, 630], b: [1002, 780] },
    { a: [1540, 812], c: [1640, 630], b: [1732, 670] },
    { a: [2254, 670], c: [2380, 630], b: [2440, 780] },
  ];

  const build = () => {
    // title
    addText(copy.title, 220, 330, 0.45, 1.35, { family: BRUSH, size: 180, weight: 400 });
    addLine(wob(K.quad([236, 372], [640, 352], [1060, 366], 40), 1.6), 1.36, 1.5, { w: 5 });
    const sub = addText(copy.subtitle, 232, 462, 1.52, 2.1, { size: 66 });
    const subtitleMark = sub.range(copy.subtitleHighlight);
    if (subtitleMark) addHL(...subtitleMark, 462 - 20, 38, C.butter, 2.12, 2.34, 5);

    STEPS.forEach((S, i) => {
      const a = STEP_TIMES[i], bx = S.bx, by = S.by;
      if (ARROWS[i]) {
        const A = ARROWS[i], shaft = K.quad(A.a, A.c, A.b, 30);
        const n = shaft.length, ang = Math.atan2(shaft[n - 1][1] - shaft[n - 3][1], shaft[n - 1][0] - shaft[n - 3][0]);
        addStrokes([wob(shaft, 1.8), wob(head(A.b, ang, 24), 0.5)], a + 0.1, a + 0.48);
      }
      // badge
      const bc = [bx + 48, by + 52], d2r = Math.PI / 180;
      addLine(wob(arcPts(bc[0], bc[1], 42, -100 * d2r, 278 * d2r, 56), 1.3), a + 0.52, a + 0.76, { w: 4 });
      addWash(blobPath(bc[0] + 5, bc[1] + 4, 39, 70 + i), [bc[0] - 50, bc[1] - 50, bc[0] + 56, bc[1] + 56], S.col, a + 0.76, a + 0.9);
      addPop(a + 0.78, (ctx, tt) => {
        const s = E.backOut(K.clamp(tt / 0.28), 2.2);
        ctx.save(); ctx.translate(bc[0], bc[1]); ctx.scale(s, s);
        K.text(ctx, S.n, 0, 19, { family: NUM, size: 54, weight: 560, color: C.ink, align: 'center' });
        ctx.restore();
      });
      // heading + marker swipe behind the key word
      const nh = [...S.head].length, ht1 = a + 0.82 + nh * 0.105;
      const H = addText(S.head, bx + 112, by + 78, a + 0.82, ht1, { size: 70 });
      const headingMark = H.range(S.highlight);
      if (headingMark) addHL(...headingMark, by + 78 - 21, 40, S.col, ht1 + 0.02, ht1 + 0.26, 20 + i);
      // icon
      const ic = S.icon(bx + (S.iconDx || 190), by + 290);
      const ie = addStrokes(ic.strokes, a + 1.5, a + 2.08);
      if (ic.fill) addWash(ic.fill, [bx + 40, by + 120, bx + 360, by + 440], S.col, ie, ie + 0.2);
      if (ic.hl) addHL(ic.hl[0], ic.hl[1], ic.hl[2], 30, S.col, ie - 0.02, ie + 0.2, 31);
      if (ic.q) addText('?', ic.q[0], ic.q[1] + 20, ie - 0.1, ie + 0.05, { size: 58, center: true, weight: 500 });
      // side note or sticky
      if (S.note) {
        const nt = a + 2.14;
        const l1 = [...S.note[0]].length, l2 = [...S.note[1]].length, cps = 0.058;
        addText(S.note[0], bx + (S.noteDx || 352), by + 252, nt, nt + l1 * cps, { size: 38, color: C.ink2 });
        addText(S.note[1], bx + (S.noteDx || 352), by + 304, nt + l1 * cps + 0.04, nt + (l1 + l2) * cps + 0.04, { size: 38, color: C.ink2 });
      }
      if (S.sticky) {
        addSticky({ x: bx + 342, y: by + 172, w: 300, h: 196, rot: 0.05, color: C.stickyMint, lines: S.sticky, size: 33, t0: a + 2.05 });
        addTape({ cx: bx + 342 + 150, cy: by + 166, w: 150, h: 40, rot: -0.09, color: C.butter, t0: a + 2.3, seed: 9 });
      }
    });

    // the loop back: ④ → ②  (pen leads the pull-back)
    const loop = K.quad([2700, 1180], [2020, 1500], [1262, 1220], 60);
    const n = loop.length, ang = Math.atan2(loop[n - 1][1] - loop[n - 3][1], loop[n - 1][0] - loop[n - 3][0]);
    addLine(wob(loop, 2.4), 13.12, 13.86, { dash: [18, 14] });
    addLine(wob(head(loop[n - 1], ang, 30), 0.5), 13.9, 14.0);
    addText(copy.returnLabel, 1990, 1440, 14.02, 14.45, { size: 50, center: true, color: C.ink });

    // final sticky slaps on top-right
    addSticky({ x: 2330, y: 150, w: 620, h: 370, rot: -0.045, color: C.stickyButter, lines: copy.conclusion, size: 70, t0: 14.55, check: true });
    addTape({ cx: 2640, cy: 150, w: 210, h: 50, rot: 0.06, color: C.mint, t0: 14.82, seed: 4 });

    ops.sort((p, q) => p.t0 - q.t0);
    nibOps.sort((p, q) => p.t0 - q.t0);
  };

  // ---------- draw ops ----------
  let Z = 1;
  const drawLine = (ctx, o, t) => {
    const u = t >= o.t1 ? 1 : E.sine(K.map(t, o.t0, o.t1));
    ctx.save();
    ctx.strokeStyle = o.color; ctx.lineWidth = o.w; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    if (o.dash) ctx.setLineDash(o.dash);
    K.partial(ctx, o.pts, u, o.cum);
    ctx.restore();
  };
  const drawText = (ctx, o, t) => {
    ctx.save();
    ctx.font = K.font(o.f.size, o.f.family, o.f.weight);
    ctx.fillStyle = o.color; ctx.textBaseline = 'alphabetic';
    const sz = o.f.size, sl = sz * 0.18, top = o.y - sz * 1.15, bot = o.y + sz * 0.4;
    for (const c of o.chars) {
      if (t < c.a) break;
      if (t >= c.b) { ctx.fillText(c.ch, c.x, o.y); continue; }
      const fx = o.front(c, K.map(t, c.a, c.b));
      ctx.save();
      ctx.beginPath();
      ctx.moveTo(c.x - sz * 0.3, top); ctx.lineTo(fx + sl, top); ctx.lineTo(fx - sl, bot); ctx.lineTo(c.x - sz * 0.3, bot);
      ctx.clip();
      ctx.fillText(c.ch, c.x, o.y);
      ctx.restore();
    }
    ctx.restore();
  };
  const drawWash = (ctx, o, t) => {
    const u = t >= o.t1 ? 1 : E.inOut(K.map(t, o.t0, o.t1));
    const [x0, y0, x1, y1] = o.box, xe = K.lerp(x0, x1, u), sk = (y1 - y0) * 0.25;
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(x0 - sk, y0); ctx.lineTo(xe + sk, y0); ctx.lineTo(xe - sk, y1); ctx.lineTo(x0 - sk, y1); ctx.clip();
    ctx.globalCompositeOperation = 'multiply';
    ctx.globalAlpha = o.alpha;
    ctx.fillStyle = o.color;
    ctx.fill(o.path);
    if (o.streaks) { // marker overlap streaks + ink pooling at both ends
      const s = o.streaks;
      ctx.globalAlpha = 0.16;
      ctx.fillRect(s.x0, s.yc - s.h * 0.08, s.x1 - s.x0, s.h * 0.12);
      ctx.fillRect(s.x0, s.yc + s.h * 0.28, s.x1 - s.x0, s.h * 0.1);
      ctx.globalAlpha = 0.3;
      ctx.fillRect(s.x0 - 6, s.yc - s.h / 2 + 2, 7, s.h - 3);
      ctx.fillRect(s.x1 - 1, s.yc - s.h / 2 + 3, 7, s.h - 4);
    }
    ctx.restore();
  };
  const drawSticky = (ctx, o, t) => {
    const tt = t - o.t0;
    if (tt < 0) return;
    const sp = E.spring(tt, 2.4, 7.5), lift = K.clamp(1 - sp, -0.25, 1), sc = 1 + 0.16 * (1 - sp);
    const w = o.w, h = o.h;
    ctx.save();
    ctx.translate(o.x + w / 2, o.y + h / 2);
    ctx.rotate(o.rot + (1 - sp) * 0.07);
    ctx.scale(sc, sc);
    ctx.globalAlpha = K.clamp(tt / 0.05);
    const shape = new Path2D();
    shape.moveTo(-w / 2, -h / 2); shape.lineTo(w / 2, -h / 2); shape.lineTo(w / 2, h / 2 - 30);
    shape.quadraticCurveTo(w / 2 - 6, h / 2 - 5, w / 2 - 34, h / 2); shape.lineTo(-w / 2, h / 2); shape.closePath();
    // curl shadow under the lifted corner
    ctx.save();
    ctx.filter = `blur(${Math.max(1, 7 * Z)}px)`;
    ctx.fillStyle = 'rgba(30,34,48,0.28)';
    ctx.beginPath(); ctx.moveTo(w / 2 - 60, h / 2 - 4); ctx.lineTo(w / 2 + 4, h / 2 + 8); ctx.lineTo(w / 2 + 2, h / 2 - 50); ctx.closePath(); ctx.fill();
    ctx.restore();
    ctx.save();
    const lz = Math.max(0, lift);
    ctx.shadowColor = `rgba(28,32,46,${0.22 + 0.1 * lz})`;
    ctx.shadowBlur = (10 + 46 * lz) * Z; ctx.shadowOffsetX = (3 + 16 * lz) * Z; ctx.shadowOffsetY = (6 + 34 * lz) * Z;
    ctx.fillStyle = o.color; ctx.fill(shape);
    ctx.restore();
    const g = ctx.createLinearGradient(0, -h / 2, 0, h / 2);
    g.addColorStop(0, 'rgba(0,0,0,0.035)'); g.addColorStop(0.14, 'rgba(0,0,0,0)'); g.addColorStop(0.8, 'rgba(0,0,0,0)'); g.addColorStop(1, 'rgba(60,40,0,0.06)');
    ctx.fillStyle = g; ctx.fill(shape);
    const gc = ctx.createLinearGradient(w / 2 - 40, h / 2 - 40, w / 2 - 10, h / 2 - 10);
    gc.addColorStop(0, 'rgba(255,255,255,0)'); gc.addColorStop(1, 'rgba(255,255,255,0.45)');
    ctx.fillStyle = gc; ctx.fill(shape);
    const lh = o.size * 1.34, y0 = -((o.lines.length - 1) * lh) / 2 + o.size * 0.36 + (o.check ? -6 : 0);
    o.lines.forEach((ln, i) => K.text(ctx, ln, 0, y0 + i * lh, { family: KAI, size: o.size, color: C.ink, align: 'center' }));
    ctx.restore();
  };
  const drawTape = (ctx, o, t) => {
    const u = E.out(K.map(t, o.t0, o.t0 + 0.18));
    if (u <= 0) return;
    const r = K.rng(o.seed), w = o.w, h = o.h;
    ctx.save();
    ctx.translate(o.cx, o.cy); ctx.rotate(o.rot);
    ctx.beginPath(); ctx.rect(-w / 2 - 10, -h, (w + 20) * u, h * 2); ctx.clip();
    const pts = [];
    const zig = (x, down) => { for (let i = 0; i <= 6; i++) pts.push([x + (i % 2 ? 5 : -2) * (r() + 0.4), (down ? -1 : 1) * (-h / 2 + (h * i) / 6)]); };
    zig(-w / 2, false);
    zig(w / 2, true);
    const p = polyPath(pts);
    ctx.globalAlpha = 0.78;
    ctx.fillStyle = o.color; ctx.fill(p);
    ctx.clip(p);
    ctx.globalAlpha = 0.4; ctx.strokeStyle = '#FFFFFF'; ctx.lineWidth = 7;
    for (let x = -w; x < w; x += 18) { ctx.beginPath(); ctx.moveTo(x, h); ctx.lineTo(x + h * 1.2, -h); ctx.stroke(); }
    ctx.restore();
  };

  // ---------- the nib (just the fineliner/fountain nib, no hand) ----------
  const AWAY = [170, -230];
  const nibAt = (t) => {
    let prev = null, next = null;
    for (const o of nibOps) {
      if (t >= o.t0 && t <= o.t1) return { p: o.tip(t), lift: 0, a: 1 };
      if (o.t1 < t) prev = o; else if (o.t0 > t && !next) next = o;
    }
    if (prev && next && next.t0 - prev.t1 <= 0.75) {
      const g = next.t0 - prev.t1, u = E.sine(K.map(t, prev.t1, next.t0));
      return { p: K.mix2(prev.end, next.start, u), lift: Math.sin(Math.PI * u) * Math.min(1, g / 0.3), a: 1 };
    }
    if (prev && t - prev.t1 < 0.35) {
      const u = E.in(K.map(t, prev.t1, prev.t1 + 0.35));
      return { p: [prev.end[0] + AWAY[0] * u, prev.end[1] + AWAY[1] * u], lift: u, a: 1 - u };
    }
    if (next && next.t0 - t < 0.35) {
      const u = E.out(K.map(t, next.t0 - 0.35, next.t0));
      return { p: [next.start[0] + AWAY[0] * (1 - u), next.start[1] + AWAY[1] * (1 - u)], lift: 1 - u, a: u };
    }
    return null;
  };
  const NIB = [[0, 0], [14, -3.6], [30, -9], [41, -13], [54, -14.6], [70, -15.2], [70, 15.2], [54, 14.6], [41, 13], [30, 9], [14, 3.6]];
  const nibPath = polyPath(NIB);
  const drawNib = (ctx, t) => {
    const s = nibAt(t);
    if (!s || s.a <= 0.01) return;
    const ang = -0.98 + K.noise(t * 3, 77) * 0.04, L = s.lift;
    ctx.save();
    ctx.globalAlpha = s.a;
    // shadow on paper
    ctx.save();
    ctx.translate(s.p[0] + 5 + L * 34, s.p[1] + 7 + L * 40); ctx.rotate(ang);
    ctx.filter = `blur(${Math.max(1, (2 + L * 5) * Z)}px)`;
    ctx.fillStyle = `rgba(31,42,68,${0.2 - 0.08 * L})`;
    ctx.fill(nibPath); ctx.fillRect(70, -17, 60, 34);
    ctx.restore();
    ctx.translate(s.p[0] + L * 14, s.p[1] - L * 20); ctx.rotate(ang);
    // section (barrel end) fading out — we only ever see the tip
    const gs = ctx.createLinearGradient(68, 0, 132, 0);
    gs.addColorStop(0, C.ink); gs.addColorStop(0.55, 'rgba(31,42,68,0.9)'); gs.addColorStop(1, 'rgba(31,42,68,0)');
    ctx.fillStyle = gs;
    ctx.beginPath(); ctx.moveTo(66, -17); ctx.lineTo(132, -20); ctx.lineTo(132, 20); ctx.lineTo(66, 17); ctx.closePath(); ctx.fill();
    const gh = ctx.createLinearGradient(66, 0, 132, 0);
    gh.addColorStop(0, 'rgba(255,255,255,0.35)'); gh.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = gh; ctx.fillRect(68, -12, 64, 5);
    // steel nib
    const g = ctx.createLinearGradient(0, -15, 0, 15);
    g.addColorStop(0, '#F1F3F6'); g.addColorStop(0.45, '#B9C0CA'); g.addColorStop(0.62, '#8E97A5'); g.addColorStop(1, '#CDD2DA');
    ctx.fillStyle = g; ctx.fill(nibPath);
    ctx.strokeStyle = 'rgba(31,42,68,0.55)'; ctx.lineWidth = 1.2; ctx.stroke(nibPath);
    ctx.strokeStyle = C.ink; ctx.lineWidth = 1.3;
    ctx.beginPath(); ctx.moveTo(1.5, 0); ctx.lineTo(37, 0); ctx.stroke();
    ctx.beginPath(); ctx.arc(40, 0, 2.6, 0, Math.PI * 2); ctx.fillStyle = C.ink; ctx.fill();
    ctx.strokeStyle = 'rgba(31,42,68,0.35)'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.arc(56, 0, 8, -1.2, 1.2); ctx.stroke();
    // wet ink bead at the tip while touching
    if (L < 0.2) { ctx.fillStyle = C.ink; ctx.beginPath(); ctx.arc(0.5, 0, 2.4, 0, Math.PI * 2); ctx.fill(); }
    ctx.restore();
  };

  // ---------- page ----------
  const drawPage = (ctx, cam) => {
    ctx.save();
    ctx.shadowColor = 'rgba(10,12,20,0.45)'; ctx.shadowBlur = 60 * Z; ctx.shadowOffsetY = 26 * Z;
    ctx.fillStyle = C.stack2; ctx.fillRect(14, 12, PW, PH);
    ctx.restore();
    ctx.fillStyle = C.stack1; ctx.fillRect(7, 6, PW, PH);
    ctx.fillStyle = C.paper; ctx.fillRect(0, 0, PW, PH);
    // dot grid, only what the camera sees
    const hw = K.W / 2 / cam.z, hh = K.H / 2 / cam.z;
    const gx0 = Math.max(DOT, Math.ceil((cam.x - hw) / DOT) * DOT), gx1 = Math.min(PW - DOT, cam.x + hw);
    const gy0 = Math.max(DOT, Math.ceil((cam.y - hh) / DOT) * DOT), gy1 = Math.min(PH - DOT, cam.y + hh);
    ctx.fillStyle = C.dot;
    ctx.beginPath();
    const r = 1.9;
    for (let x = gx0; x <= gx1; x += DOT) for (let y = gy0; y <= gy1; y += DOT) { ctx.moveTo(x + r, y); ctx.arc(x, y, r, 0, Math.PI * 2); }
    ctx.fill();
    // pre-printed journal details
    K.text(ctx, copy.pageLabel, PW - 160, 96, { family: KAI, size: 30, color: C.ink2, align: 'right', alpha: 0.85 });
    K.text(ctx, copy.pageNumber, PW / 2, PH - 52, { family: MONO, size: 24, weight: 400, color: C.ink2, align: 'center', alpha: 0.7 });
    drawTape(ctx, { cx: 150, cy: 96, w: 230, h: 46, rot: -0.14, color: C.mint, t0: -1, seed: 2 }, 0);
  };
  const drawRibbon = (ctx) => {
    ctx.save();
    ctx.shadowColor = 'rgba(10,12,20,0.3)'; ctx.shadowBlur = 8 * Z; ctx.shadowOffsetX = 3 * Z; ctx.shadowOffsetY = 4 * Z;
    ctx.fillStyle = C.ribbon;
    ctx.beginPath(); ctx.moveTo(3402, -2); ctx.lineTo(3438, -2); ctx.lineTo(3442, PH + 96); ctx.lineTo(3424, PH + 74); ctx.lineTo(3406, PH + 98); ctx.closePath(); ctx.fill();
    ctx.restore();
  };

  let grainPat;
  let vignette;
  const ready = Promise.all([
    document.fonts.load('500 32px SK-Kai', copy.title + copy.subtitle),
    document.fonts.load('400 32px SK-Brush', copy.title),
    document.fonts.load('560 32px SK-Num', '1234'),
    document.fonts.load('400 24px SK-Mono', copy.pageNumber),
  ]).then((faces) => {
    if (faces.some((list) => !list.length)) throw new Error('A notebook font did not load');
    build();
    grainPat = K.ctx.createPattern(K.grain('sk', 256, 256, 22, 13), 'repeat');
    vignette = K.cached('sk-vig', K.W, K.H, (g, w, h) => {
      const gr = g.createRadialGradient(w / 2, h / 2, h * 0.45, w / 2, h / 2, h * 1.05);
      gr.addColorStop(0, 'rgba(70,50,20,0)');
      gr.addColorStop(1, 'rgba(70,50,20,0.12)');
      g.fillStyle = gr;
      g.fillRect(0, 0, w, h);
    });
  });

  // Render the complete state of the one shared paper at any original scene time.
  function draw(sourceTime) {
    const t = K.clamp(sourceTime, 0, DUR - .001);
    const ctx = K.ctx;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
    ctx.filter = 'none';
    const cam = K.camAt(t, CAM);
    Z = cam.z;
    ctx.fillStyle = C.desk; ctx.fillRect(0, 0, K.W, K.H);
    ctx.save();
    K.camApply(ctx, cam);
    drawPage(ctx, cam);
    for (const o of ops) {
      if (t < o.t0) break;
      if (o.kind === 'line') drawLine(ctx, o, t);
      else if (o.kind === 'text') drawText(ctx, o, t);
      else if (o.kind === 'wash') drawWash(ctx, o, t);
      else if (o.kind === 'pop') o.draw(ctx, t - o.t0);
      else if (o.kind === 'sticky') drawSticky(ctx, o, t);
      else if (o.kind === 'tape') drawTape(ctx, o, t);
    }
    drawRibbon(ctx);
    drawNib(ctx, t);
    ctx.restore();
    // paper grain follows the pan only (screen space), then the vignette
    ctx.save();
    const ox = -((cam.x * cam.z) % 256), oy = -((cam.y * cam.z) % 256);
    ctx.translate(ox, oy);
    ctx.globalCompositeOperation = 'soft-light'; ctx.globalAlpha = 0.55;
    ctx.fillStyle = grainPat; ctx.fillRect(-ox, -oy, K.W, K.H);
    ctx.restore();
    ctx.drawImage(vignette, 0, 0);
  }

  return { ready, draw };
}
