function draw(t) {
    enter('#result', t, .45, { y: 75, scale: .6, spring: true });
    enter('#heart', t, .78, { x: 55, y: -57, rotate: 40, spring: true });
    const spark = range(t, .65, 1.25);
    pose('#spark', { scale: spark * 1.4, opacity: wave(spark), rotate: 41 * spark });
    $$('.button').forEach((node,i) => enter(node, t, 1.21 + i * .46, { spring: true, scale: .62 }));
}
