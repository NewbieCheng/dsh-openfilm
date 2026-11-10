function draw(t) {
    const burst = range(t, COPY.impact, .42);
    const halo = ease(range(t, 1.25, 3.4));
    pose('#rings', { scale: .73 + halo * .27 + .08 * wave(burst), opacity: halo * (1 - burst * .8), rotate: t * 2 });
    $('#glow-ring').style.opacity = halo * (.4 + .18 * Math.sin(t * 4)) * (1 - burst);
    $$('.word').forEach((node, i) => {
      const p = range(t, COPY.cues[i], .4);
      const focus = i === COPY.cues.findLastIndex((cue) => t >= cue);
      pose(node, { x: (1 - ease(p)) * -47, opacity: p * (focus ? 1 : .26) * (1 - burst), scale: .9 + p * .1 });
    });
    enter('#conclusion', t, COPY.impact, { scale: .7, y: 10, spring: true, duration: .48 });
}
