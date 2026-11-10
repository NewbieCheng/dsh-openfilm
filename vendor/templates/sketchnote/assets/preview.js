/* Browser-only playback controls. OpenFilm drives its own clock when present. */
function previewShot(film) {
  if (window.filmHost) return;
  film.ready.then(() => {
    let start = performance.now();
    let current = 0;
    let playing = true;
    let visible = true;
    let button;
    let scrub;
    let counter;
    const standalone = window.top === window;
    if (standalone) {
      const bar = document.createElement('div');
      bar.className = 'preview-bar';
      bar.innerHTML = '<button type="button">暂停</button><input type="range" min="0" step=".001" aria-label="镜头时间"><output></output>';
      document.body.append(bar);
      [button, scrub, counter] = bar.children;
      scrub.max = film.duration;
      button.onclick = () => {
        playing = !playing;
        button.textContent = playing ? '暂停' : '播放';
        if (playing) start = performance.now() - 1000 * current;
      };
      scrub.oninput = () => {
        playing = false;
        button.textContent = '播放';
        draw(Number(scrub.value));
      };
    } else {
      new IntersectionObserver(([entry]) => {
        visible = entry.isIntersecting;
      }).observe(document.querySelector('canvas'));
    }

    function draw(t) {
      current = t;
      film.frame(t);
      if (standalone) {
        scrub.value = t;
        counter.textContent = t.toFixed(2) + ' s';
      }
    }
    function tick(now) {
      if (visible && playing) draw((now - start) / 1000 % film.duration);
      requestAnimationFrame(tick);
    }
    draw(0);
    requestAnimationFrame(tick);
  }).catch((error) => {
    console.error(error);
    const message = document.createElement('p');
    message.textContent = error.message;
    message.style.cssText = 'position:fixed;bottom:1rem;color:#fff;font:16px system-ui';
    document.body.append(message);
  });
}
