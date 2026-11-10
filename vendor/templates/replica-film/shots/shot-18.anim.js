function draw(t) {
    const cue = COPY.cues;
    enter('#title', t, cue.title);
    const merge = ease(range(t, cue.merge, .66));
    $$('.feedback').forEach((node,i) => {
      const visible = range(t, cue.labels[i], .35);
      pose(node, { opacity: visible * (1 - merge), scale: 1 - merge * .8, x: ([365,-53,320][i]) * merge, y: (1 - visible) * 51 + ([489,345,218][i]) * merge, rotate: (i - 1) * 6 * (1 - visible) });
    });
    const appear = ease(range(t, cue.container, .4));
    const pulse = wave(range(t, cue.update, .55));
    pose('#box', { opacity: appear, y: 42 * (1 - appear), scale: .91 + .09 * appear + .055 * pulse });
    text('#version', COPY.versions[t < cue.update ? 0 : 1]);
    const burst = range(t, cue.update, .9);
    pose('#burst', { scale: burst * 1.28, opacity: wave(burst), rotate: 35 * burst });
}
