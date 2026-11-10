function draw(t) {
    enter('#title', t, .12);
    enter('#switch', t, .56, { spring: true });
    const p = ease(range(t, 1.12, .32));
    $('#toggle').style.background = p > .5 ? '#2ecf7b' : '#bbc1be';
    pose('#knob', { x: 34 * p });
    enter('#mic', t, 1.22, { y: 95, scale: .63, rotate: -18, spring: true });
    enter('#reply', t, 2.22, { x: -88, y: 0, spring: true });
}
