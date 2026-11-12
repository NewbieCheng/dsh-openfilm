(function () {
  if (globalThis.__no996StyleLab) return;
  globalThis.__no996StyleLab = 1;

  // Dev-only style workbench. Injected when NO996_OPENFILM_STYLE_LAB=1.
  // Everything lives in a shadow root: the upstream app's CSS must not move our
  // panel, and our panel must not leak styles into the app.
  var host = document.createElement('div');
  host.id = 'no996-style-lab';
  host.style.cssText = 'position:fixed;left:12px;bottom:12px;z-index:2147483646;';
  var root = host.attachShadow({ mode: 'open' });

  var style = document.createElement('style');
  style.textContent = [
    ':host{all:initial}',
    '.bar{display:flex;gap:6px;align-items:center;font:12px/1.4 system-ui,sans-serif}',
    'button{font:inherit;color:#f1eee8;background:#252321;border:1px solid #62563d;border-radius:8px;padding:6px 10px;cursor:pointer}',
    'button[aria-pressed="true"]{background:#ff6400;border-color:#ff6400;color:#fff}',
    'button:focus-visible{outline:2px solid #ff6400;outline-offset:2px}',
    '.panel{position:absolute;left:0;bottom:34px;width:min(360px,calc(100vw - 24px));max-height:60vh;overflow:auto;box-sizing:border-box;padding:12px;border:1px solid #62563d;border-radius:12px;background:#1d1b18;color:#f1eee8;box-shadow:0 8px 30px rgba(0,0,0,.45)}',
    '.panel[hidden]{display:none}',
    '.panel h2{margin:0 0 8px;font:600 12px/1.4 system-ui,sans-serif;letter-spacing:.04em;text-transform:uppercase;color:#c8bfae}',
    '.row{display:flex;gap:8px;align-items:center;margin:6px 0}',
    '.row label{flex:0 0 68px;color:#c8bfae}',
    'code,pre{font:11px/1.5 ui-monospace,Consolas,monospace}',
    'pre{margin:6px 0;padding:8px;background:#111;border-radius:8px;white-space:pre-wrap;word-break:break-all}',
    'input[type="color"]{width:32px;height:24px;padding:0;border:1px solid #62563d;background:#252321}',
    'input[type="range"]{flex:1}',
    '.hint{margin:6px 0 0;color:#8d90a6}',
  ].join('\n');
  root.appendChild(style);

  var bar = document.createElement('div');
  bar.className = 'bar';
  var toggle = document.createElement('button');
  toggle.type = 'button';
  toggle.textContent = '样式台';
  toggle.setAttribute('aria-expanded', 'false');
  bar.appendChild(toggle);
  root.appendChild(bar);

  var panel = document.createElement('section');
  panel.className = 'panel';
  panel.hidden = true;
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-label', '样式工作台');
  panel.innerHTML =
    '<h2>样式工作台</h2>' +
    '<div class="row"><button type="button" data-act="pick" aria-pressed="false">点选元素</button>' +
    '<button type="button" data-act="copy">复制说明</button>' +
    '<button type="button" data-act="close">关闭</button></div>' +
    '<div class="row"><label for="n996-accent">强调色</label><input id="n996-accent" type="color" value="#ff6400"></div>' +
    '<div class="row"><label for="n996-radius">圆角</label><input id="n996-radius" type="range" min="0" max="24" step="1" value="10"><code data-out="radius">10</code></div>' +
    '<pre data-out="target">点选一个元素，或直接改上面的 token。</pre>' +
    '<p class="hint">Esc 退出点选。改动只作用于当前页面，复制说明后交给 agent 落到 theme 文件。</p>';
  root.appendChild(panel);

  var box = document.createElement('div');
  box.style.cssText = 'position:fixed;pointer-events:none;z-index:2147483645;border:2px solid #ff6400;background:rgba(255,100,0,.12);border-radius:4px;display:none;';

  // Injected in <head>, so <body> may not exist yet. Mount on DOMContentLoaded
  // instead of appending a div directly under <html>.
  function mount() {
    var parent = document.body || document.documentElement;
    parent.appendChild(host);
    parent.appendChild(box);
  }
  if (document.body) mount();
  else document.addEventListener('DOMContentLoaded', mount, { once: true });

  var accentInput = panel.querySelector('#n996-accent');
  var radiusInput = panel.querySelector('#n996-radius');
  var targetOut = panel.querySelector('[data-out="target"]');
  var radiusOut = panel.querySelector('[data-out="radius"]');
  var target = null;
  var picking = false;

  function cssEscape(value) {
    if (globalThis.CSS && typeof globalThis.CSS.escape === 'function') return globalThis.CSS.escape(value);
    return String(value).replace(/[^A-Za-z0-9_-]/g, '\\$&');
  }

  function selectorFor(el) {
    if (!el || el.nodeType !== 1) return '';
    if (el.id) return '#' + cssEscape(el.id);
    var parts = [];
    var node = el;
    var depth = 0;
    while (node && node.nodeType === 1 && depth < 4) {
      var part = node.tagName.toLowerCase();
      var attrs = ['data-testid', 'data-tool-name', 'data-thought', 'role', 'aria-label'];
      for (var i = 0; i < attrs.length; i += 1) {
        var value = node.getAttribute(attrs[i]);
        if (value && value.length <= 40) {
          part += '[' + attrs[i] + '="' + value.replace(/"/g, '\\"') + '"]';
          break;
        }
      }
      var parent = node.parentElement;
      if (parent) {
        var same = 0;
        for (var j = 0; j < parent.children.length; j += 1) {
          if (parent.children[j].tagName === node.tagName) same += 1;
        }
        if (same > 1) part += ':nth-of-type(' + (Array.prototype.indexOf.call(parent.children, node) + 1) + ')';
      }
      parts.unshift(part);
      if (node.id) { parts[0] = '#' + cssEscape(node.id); break; }
      node = node.parentElement;
      depth += 1;
    }
    return parts.join(' > ');
  }

  function describe(el) {
    if (!el) return '';
    var computed = getComputedStyle(el);
    var vars = ['--n996-accent', '--n996-radius', '--n996-paper', '--n996-ink'].map(function (name) {
      var value = computed.getPropertyValue(name).trim();
      return value ? name + ': ' + value : '';
    }).filter(Boolean);
    return [
      'surface: ' + (document.querySelector('[data-app-menu]') ? 'shell' : 'studio'),
      'selector: ' + selectorFor(el),
      'tag: ' + el.tagName.toLowerCase(),
      'color: ' + computed.color,
      'background: ' + computed.backgroundColor,
      'font-size: ' + computed.fontSize,
      'padding: ' + computed.padding,
      vars.length ? vars.join('\n') : 'token: (none matched)',
      '层建议: token / ' + (document.querySelector('[data-app-menu]') ? 'shell.css' : 'studio.css') + ' / 源码补丁',
    ].join('\n');
  }

  function place(el) {
    if (!el) { box.style.display = 'none'; return; }
    var rect = el.getBoundingClientRect();
    box.style.display = 'block';
    box.style.left = rect.left + 'px';
    box.style.top = rect.top + 'px';
    box.style.width = rect.width + 'px';
    box.style.height = rect.height + 'px';
  }

  function stop(event) {
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();
  }

  function onPick(event) {
    if (!picking) return;
    if (host.contains(event.target)) return;
    stop(event);
    target = event.target;
    place(target);
    targetOut.textContent = describe(target);
    setPicking(false);
  }

  function onMove(event) {
    if (!picking) return;
    if (host.contains(event.target)) return;
    place(event.target);
  }

  function setPicking(value) {
    picking = value;
    var button = panel.querySelector('[data-act="pick"]');
    button.setAttribute('aria-pressed', String(value));
    button.textContent = value ? '点选中…' : '点选元素';
    if (!value) box.style.display = 'none';
  }

  function setExpanded(value) {
    panel.hidden = !value;
    toggle.setAttribute('aria-expanded', String(value));
    if (value) panel.querySelector('[data-act="pick"]').focus();
  }

  toggle.addEventListener('click', function () { setExpanded(panel.hidden); });
  panel.addEventListener('click', function (event) {
    var action = event.target && event.target.getAttribute && event.target.getAttribute('data-act');
    if (action === 'pick') setPicking(!picking);
    if (action === 'close') { setPicking(false); setExpanded(false); toggle.focus(); }
    if (action === 'copy') {
      var text = targetOut.textContent;
      function fallback() { window.prompt('复制这段说明', text); }
      try {
        if (!navigator.clipboard || typeof navigator.clipboard.writeText !== 'function') { fallback(); return; }
        navigator.clipboard.writeText(text).then(function () { targetOut.textContent = text + '\n\n(已复制)'; }, fallback);
      } catch (error) { fallback(); }
    }
  });
  accentInput.addEventListener('input', function () {
    document.documentElement.style.setProperty('--n996-accent', accentInput.value);
    if (target) targetOut.textContent = describe(target);
  });
  radiusInput.addEventListener('input', function () {
    radiusOut.textContent = radiusInput.value;
    document.documentElement.style.setProperty('--n996-radius', radiusInput.value + 'px');
  });
  document.addEventListener('click', onPick, true);
  document.addEventListener('mousemove', onMove, true);
  document.addEventListener('keydown', function (event) {
    if (event.key !== 'Escape') return;
    if (picking) { setPicking(false); return; }
    if (!panel.hidden) { setExpanded(false); toggle.focus(); }
  }, true);
  window.addEventListener('scroll', function () { if (picking && target) place(target); }, true);
  window.addEventListener('resize', function () { if (picking && target) place(target); });
})();
