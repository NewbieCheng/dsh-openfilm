function draw(t) {
    const inView = ease(range(t, .24, .65));
    const zoom = ease(range(t, 3.25, 1.25));
    pose('#code', { y: 72 * (1 - inView) - 70 * zoom, x: -62 * zoom, scale: .82 + .18 * inView + .36 * zoom, opacity: inView });
    $$('.code-line').forEach((node,i) => enter(node, t, .5 + i * .18, { y: 9 }));
    enter('#title', t, .95);
    enter('#metric', t, 3.85);
    const n = Math.round(lerp(COPY.from, COPY.to, ease(range(t, 4.0, 1.9))));
    text('#counter', n.toLocaleString('en-US'));
    enter('#wrench', t, 4.25, { rotate: 36, spring: true });
}
