function draw(t) {
    enter('#title', t, .15, { rotate: 4 });
    enter('#hub', t, .62, { spring: true });
    $('#links').style.opacity = range(t, .76, .8);
    $$('.satellite').forEach((node, i) => enter(node, t, .95 + i * .22, { spring: true }));
    $$('.heart').forEach((node, i) => {
      const p = range(t, 1.05 + i * .28, .55);
      pose(node, { opacity: p, scale: p * (1 + .15 * wave(p)), y: 92 * (1 - p) + Math.sin(t * 2.3 + i) * 8, rotate: -12 + i * 7 });
    });
    enter('#likes', t, 2.2, { spring: true });
}
