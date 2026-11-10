function draw(t) {
    enter('#title', t, .10, { y: 24 });
    enter('#message', t, .70, { y: 36, spring: true });
    const letters = Array.from(COPY.message);
    text('#typed', letters.slice(0, Math.floor(letters.length * range(t, 1.05, 2.1))).join(''));
    $('#caret').style.opacity = t < 1.05 || t > 3.58 ? 0 : Number(Math.floor(t * 5) % 2 === 0);
}
