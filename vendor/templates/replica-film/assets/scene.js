/* Helpers are shared by the pages. All motion state is derived from the requested second. */
const Scene = (() => {
  const $ = (selector) => document.querySelector(selector);
  const $$ = (selector) => [...document.querySelectorAll(selector)];
  const clamp = (value) => Math.max(0, Math.min(1, value));
  const range = (t, start, length = .5) => clamp((t - start) / length);
  const ease = (p) => 1 - (1 - p) ** 3;
  const lerp = (a, b, p) => a + (b - a) * p;
  const wave = (p) => Math.sin(p * Math.PI);
  const pop = (p) => 1 - Math.cos(p * Math.PI * 2.5) * (1 - p) ** 3;
  const target = (selector) => typeof selector === 'string' ? $(selector) : selector;

  function pose(selector, { x = 0, y = 0, scale = 1, rotate = 0, opacity = 1 } = {}) {
    const node = target(selector);
    node.style.transform = `translate(${x}px,${y}px) rotate(${rotate}deg) scale(${scale})`;
    node.style.opacity = clamp(opacity);
  }
  function enter(selector, t, start, options = {}) {
    const { duration = .5, x = 0, y = 36, scale = .93, rotate = 0, spring = false } = options;
    const p = range(t, start, duration);
    const u = spring ? pop(p) : ease(p);
    pose(selector, { x: x * (1 - u), y: y * (1 - u), scale: lerp(scale, 1, u), rotate: rotate * (1 - u), opacity: p * 2 });
  }
  function text(selector, value) {
    const node = target(selector);
    if (node.textContent !== String(value)) node.textContent = value;
  }
  function clock(t) {
    const secs = Math.floor(t);
    return `${String(Math.floor(secs / 60)).padStart(2, '0')}:${String(secs % 60).padStart(2, '0')}`;
  }
  function escape(value) {
    const html = document.createElement('span');
    html.textContent = value;
    return html.innerHTML;
  }
  const attribute = (value) => escape(value).replaceAll('"', '&quot;');
  const pills = (items) => items.map((item) => `<span class="pill">${escape(item)}</span>`).join('');

  function mount(config, duration, at, draw) {
    const stage = $('#stage');
    const presenter = config.presenter || {};
    const portrait = presenter.shape === 'portrait' ? ' portrait' : '';
    const lead = presenter.video
      ? `<video muted playsinline preload="auto" src="${attribute(presenter.video)}"></video>`
      : `<img src="${attribute(presenter.image || '../assets/presenter.svg')}" alt=""><span class="presenter-label">${escape(presenter.label || '人物位')}</span>`;
    stage.insertAdjacentHTML('afterbegin', `
      <div class="masthead"><span>05 · ${escape(config.chapter)}</span><time id="clock"></time></div>
      <div class="header-rule"></div>
      <div class="presenter${portrait}">${lead}</div>
    `);
    stage.insertAdjacentHTML('beforeend', '<div class="note" id="note"></div>');
    text('#note', config.note || '');
    const video = $('.presenter video');
    const images = $$('img');
    const ready = Promise.all([
      document.fonts.ready,
      ...images.map((image) => image.decode()),
      ...(video ? [new Promise((resolve, reject) => {
        if (video.readyState >= 2) resolve();
        else {
          video.addEventListener('loadeddata', resolve, { once: true });
          video.addEventListener('error', () => reject(new Error('人物视频加载失败')), { once: true });
        }
      })] : [])
    ]);
    function fit() {
      const scale = Math.min(innerWidth / 1080, innerHeight / 1920);
      stage.style.transform = `translate(${(innerWidth - 1080 * scale) / 2}px,${(innerHeight - 1920 * scale) / 2}px) scale(${scale})`;
    }
    addEventListener('resize', fit);
    fit();

    function frame(t) {
      const local = Math.max(0, Math.min(duration, t));
      text('#clock', clock(at + local));
      draw(local);
      if (!video || video.readyState < 2) return;
      const targetTime = Math.min(Math.max(0, video.duration - .001), local + (presenter.in || 0));
      if (Math.abs(video.currentTime - targetTime) < .005) return;
      return new Promise((resolve) => {
        const done = () => resolve();
        video.addEventListener('seeked', done, { once: true });
        video.currentTime = targetTime;
      });
    }
    window.film = { duration, width: 1080, height: 1920, ready, frame };

    if (!window.filmHost && !new URLSearchParams(location.search).has('still')) {
      ready.then(() => {
        const direct = window.top === window;
        const controls = direct ? document.createElement('div') : null;
        let paused = false;
        let start;
        let drawing = false;
        let current = 0;
        if (controls) {
          controls.className = 'preview-controls';
          controls.innerHTML = '<button type="button">暂停</button><input aria-label="镜头时间" type="range" min="0" step="0.01"><output></output>';
          document.body.append(controls);
          const button = controls.querySelector('button');
          const slider = controls.querySelector('input');
          slider.max = duration;
          button.onclick = () => {
            paused = !paused;
            button.textContent = paused ? '播放' : '暂停';
            if (!paused) start = performance.now() - current * 1000;
          };
          slider.oninput = () => {
            paused = true;
            button.textContent = '播放';
            update(Number(slider.value));
          };
        }
        function update(value) {
          current = value;
          if (controls) {
            controls.querySelector('input').value = value;
            controls.querySelector('output').textContent = value.toFixed(2) + ' s';
          }
          drawing = true;
          Promise.resolve(frame(value)).finally(() => { drawing = false; });
        }
        let visible = window.top === window;
        new IntersectionObserver(([entry]) => { visible = entry.isIntersecting; }).observe(stage);
        const play = (now) => {
          requestAnimationFrame(play);
          if (!visible || drawing || paused) return;
          start ??= now;
          update((now - start) / 1000 % duration);
        };
        requestAnimationFrame(play);
      }).catch((error) => console.error(error));
    }
    if (!video) frame(0);
  }

  // 动作库由 motion.js 提供（构建时发到本模板 assets/）。老镜头继续用上面的
  // 原语；新镜头用 Scene.motion 拿到弹簧、相机、擦除、逐字、确定性随机。
  return { $, $$, range, ease, lerp, wave, pose, enter, text, escape, pills, mount, motion: window.Motion };
})();
