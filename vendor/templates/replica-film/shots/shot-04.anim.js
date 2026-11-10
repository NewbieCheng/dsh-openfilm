function draw(t) {
    const symbols = '010101110001  ‧   #     ';
    const shift = Math.floor(t * 8);
    const lines = Array.from({ length: 30 }, (_, row) => Array.from({ length: 76 }, (_, col) =>
      symbols[(row * 13 + col * 7 + row * col + shift) % symbols.length]).join(''));
    text('#rain', lines.join('\n'));
    enter('#title', t, .25, { y: 24 });
    $('#circle').style.strokeDashoffset = 1 - ease(range(t, 1.2, .9));
    enter('#metric', t, 1.7, { spring: true });
    text('#value', Math.round(COPY.value * ease(range(t, 1.7, 1.0))) + '+');
}
