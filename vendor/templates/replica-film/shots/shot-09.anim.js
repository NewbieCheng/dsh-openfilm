function draw(t) {
    enter('#title', t, .10);
    $$('.layer').forEach((node,i) => enter(node, t, .48 + i * .25, { x: -84, y: 0, spring: true }));
    $$('.tile').forEach((node,i) => enter(node, t, 1.02 + i * .24, {
      x: (i % 3 - 1) * 420, y: 150 + i * 18, rotate: (i % 2 ? 1 : -1) * 28, scale: .5, spring: true, duration: .63
    }));
}
