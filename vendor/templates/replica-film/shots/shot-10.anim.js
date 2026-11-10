function draw(t) {
    enter('#title', t, .10);
    enter('#meter', t, .62);
    const p = ease(range(t, .8, 2.5));
    text('#meter-text', Math.round(p * COPY.maximum) + ' / ' + COPY.maximum);
    $('.counter-progress i').style.transform = `scaleX(${p})`;
    $$('.token').forEach((node,i) => {
      const arc = range(t, 1.05 + i * .12, 1.0);
      pose(node, { opacity: Math.min(1, arc * 4) * (1 - range(t, 3.48, .36)), y: 55 - 157 * wave(arc) - i * 11, x: 37 * arc, scale: .62 + .38 * arc, rotate: i * 37 + arc * 168 });
    });
}
