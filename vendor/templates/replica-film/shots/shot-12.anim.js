function draw(t) {
    const cue = COPY.cues;
    enter('#title', t, cue.title);
    $$('.preparation').forEach((node,i) => enter(node, t, [cue.first, cue.second, cue.giver][i], { spring: true }));
    enter('#giver', t, cue.giver, { x: -80, rotate: -13, spring: true });
    enter('#receiver', t, cue.receivers, { x: 120, rotate: 12, spring: true });
    const transfer = ease(range(t, cue.transfer, cue.arrival - cue.transfer));
    const open = range(t, cue.object, .4);
    pose('#book', { x: 426 * transfer, y: 405 * transfer - 172 * wave(transfer), scale: .7 + .3 * open - .22 * transfer, opacity: open, rotate: -17 + 32 * transfer });
    $('#route').style.strokeDashoffset = 1 - transfer;
    $('#route').style.opacity = .57 - .34 * range(t, cue.arrival + .25, .6);
    $$('.receiver-label').forEach((node,i) => enter(node, t, cue.receivers + i * .19, { spring: true, y: 14 }));
    enter('#stamp', t, cue.confirmation, { scale: 1.72, y: -36, rotate: -13, spring: true, duration: .36 });
}
