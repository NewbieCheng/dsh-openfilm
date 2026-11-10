function draw(t) {
    const start = COPY.cue;
    enter('#title', t, start, { y: 22, duration: .52 });
    const line = ease(range(t, start + .32, .65));
    pose('#rule', { scale: Math.max(.001, line), opacity: line });
    enter('#body', t, start + .72, { y: 18 });
    $$('.point').forEach((node,i) => enter(node, t, start + .64 + i * .42, { x: -73, y: 0, spring: true }));
    const phase = range(t, start + 1.05, .85);
    const hit = wave(range(t, start + 1.67, .31));
    const show = COPY.mode !== 'points';
    pose('#stamp', { x: 174 * (1 - phase), y: -135 * wave(phase), scale: .62 + .38 * phase + .3 * hit,
      rotate: 45 * (1 - phase) - 9 + 11 * hit, opacity: show ? phase : 0 });
}
