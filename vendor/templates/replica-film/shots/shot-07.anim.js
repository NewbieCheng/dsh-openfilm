function draw(t) {
    enter('#title', t, .13);
    enter('#progress', t, .58);
    const progress = ease(range(t, 1.2, 5.2));
    $('.counter-progress i').style.transform = `scaleX(${progress})`;
    text('#progress-label', `PROGRESS　${Math.round(progress * 100)}%`);
    enter('#steps', t, 1.9, { spring: true });
    $$('.step').forEach((node,i) => enter(node, t, 2.45 + i * .55, { x: -35, y: 0 }));
    enter('#check', t, 4.85, { spring: true });
    $$('.check').forEach((node,i) => enter(node, t, 5.25 + i * .55));
}
