function draw(t) {
    enter('#title', t, .12);
    enter('#brain', t, .82, { y: 35, rotate: 9, spring: true });
    const inView = ease(range(t, .7, .46));
    const absorb = ease(range(t, 3.8, .82));
    pose('#prompt', { x: absorb * 570, y: (1 - inView) * 55 + absorb * 110, scale: 1 - absorb * .84, opacity: inView * (1 - absorb) });
    $('#brain').style.filter = `drop-shadow(0 0 ${8 + wave(absorb) * 35}px #ffd27f90)`;
    enter('#result', t, 4.62, { spring: true });
}
