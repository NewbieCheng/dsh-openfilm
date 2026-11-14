/**
 * Click-captcha challenge — same interaction as workbench / 清流.
 * Opens only when login or "send code" needs a human check; not a form field.
 */
import { authAction } from './auth-client.mjs';

const MAX_SEQUENCE_WRONG = 2;

const ICON_LABEL = {
  fish: '鱼', cake: '蛋糕', egg: '蛋', milk: '牛奶', chili: '辣椒',
  potato: '土豆', chocolate: '巧克力', garlic: '蒜', scallion: '葱',
  mint: '薄荷', snow_lotus: '雪莲', sweet_potato: '红薯', bean: '豆子',
};

function isSequencePrompt(prompt) {
  return prompt === 'click_sequence' || prompt === 'click_size_asc' || prompt === 'click_size_desc';
}

function fillCaptchaViewport(svg) {
  return String(svg || '').replace(/<svg\b([^>]*)>/, (_tag, attributes) => {
    const next = /\spreserveAspectRatio\s*=/.test(attributes)
      ? attributes.replace(/\spreserveAspectRatio\s*=\s*(["']).*?\1/, ' preserveAspectRatio="none"')
      : `${attributes} preserveAspectRatio="none"`;
    return `<svg${next}>`;
  });
}

function promptHint(prompt, iconTarget, sequence) {
  const icon = ICON_LABEL[iconTarget] || '图标';
  switch (prompt) {
    case 'click_largest': return `请点击最大的${icon}`;
    case 'click_smallest': return `请点击最小的${icon}`;
    case 'click_second_smallest': return `请点击第二小的${icon}`;
    case 'click_icon': return `请点击图中的${icon}`;
    case 'click_sequence': return '请按提示顺序点击';
    case 'click_size_asc': return `请按从小到大点击${icon}`;
    case 'click_size_desc': return `请按从大到小点击${icon}`;
    default: return '请完成人机验证';
  }
}

const CSS = `
.nof-cap-mask{position:absolute;inset:0;z-index:80;display:flex;align-items:center;justify-content:center;padding:20px;background:rgba(5,29,67,.55);backdrop-filter:blur(2px)}
.nof-cap{width:min(100%,420px);background:#fff;color:#18171c;border-radius:10px;box-shadow:0 24px 64px rgba(0,0,0,.45);padding:18px 18px 16px;font-family:"Noto Sans SC","PingFang SC","Microsoft YaHei",sans-serif}
.nof-cap h2{margin:0 0 4px;font:600 16px/1.3 inherit;color:#051D43}
.nof-cap .hint{margin:0 0 12px;font-size:13px;color:#6d6a62}
.nof-cap .prompt{margin:0 0 10px;font:500 14px/1.4 inherit;color:#051D43}
.nof-cap .chips{display:flex;flex-wrap:wrap;gap:6px;margin:0 0 10px}
.nof-cap .chip{font-size:12px;padding:3px 8px;border-radius:999px;background:#f3f0ea;color:#6d6a62}
.nof-cap .chip.next{background:rgba(255,100,0,.12);color:#FF6400}
.nof-cap .chip.done{background:#051D43;color:#fff}
.nof-cap .row{display:flex;gap:8px;align-items:stretch}
.nof-cap .stage{position:relative;flex:1;min-height:240px;border:1px solid #e5e1d8;border-radius:8px;background:#f7f5f0;overflow:hidden;cursor:pointer}
.nof-cap .stage svg{display:block;width:100%;height:100%}
.nof-cap .stage .loading{position:absolute;inset:0;display:grid;place-items:center;font-size:13px;color:#8d90a6}
.nof-cap .pick{position:absolute;width:22px;height:22px;margin:-11px 0 0 -11px;border-radius:50%;background:#FF6400;color:#fff;display:grid;place-items:center;font:700 11px/1 inherit;pointer-events:none;box-shadow:0 0 0 2px #fff}
.nof-cap .refresh{flex:none;width:40px;border:1px solid #e5e1d8;border-radius:8px;background:#fff;color:#051D43;cursor:pointer}
.nof-cap .refresh:disabled{opacity:.5}
.nof-cap .err{min-height:1.2em;margin:8px 0 0;font-size:13px;color:#a33a2a}
.nof-cap .cancel{margin-top:12px;background:none;border:0;color:#8a6a2c;font:inherit;font-size:13px;cursor:pointer;text-decoration:underline;text-underline-offset:3px}
.nof-cap .stage :global(.is-picked),.nof-cap .stage .is-picked{outline:2px solid #FF6400;outline-offset:1px}
`;

export function createCaptchaChallenge(React) {
  const h = React.createElement;

  return function CaptchaChallenge({ open, onCancel, onSolved }) {
    const [captchaId, setCaptchaId] = React.useState('');
    const [svg, setSvg] = React.useState('');
    const [prompt, setPrompt] = React.useState('');
    const [iconTarget, setIconTarget] = React.useState('');
    const [sequence, setSequence] = React.useState([]);
    const [clicks, setClicks] = React.useState([]);
    const [markers, setMarkers] = React.useState([]);
    const [wrong, setWrong] = React.useState(0);
    const [error, setError] = React.useState('');
    const [loading, setLoading] = React.useState(false);
    const wrongRef = React.useRef(0);
    const stageRef = React.useRef(null);
    const timerRef = React.useRef(0);

    const expectedSteps = React.useMemo(() => {
      if (prompt === 'click_sequence') return sequence.length;
      if (prompt === 'click_size_asc' || prompt === 'click_size_desc') return 4;
      return 1;
    }, [prompt, sequence.length]);

    const reset = React.useCallback(() => {
      setClicks([]);
      setMarkers([]);
      wrongRef.current = 0;
      setWrong(0);
      setError('');
    }, []);

    const load = React.useCallback(async () => {
      setLoading(true);
      reset();
      try {
        const data = await authAction('captcha', { type: 'click' });
        if (!data?.id || !data?.svg) {
          setError('验证码加载失败，请重试');
          return;
        }
        setCaptchaId(data.id);
        setSvg(fillCaptchaViewport(data.svg));
        setPrompt(data.prompt || '');
        setIconTarget(data.icon_target || '');
        setSequence(Array.isArray(data.sequence) ? data.sequence : []);
      } catch (err) {
        setError(err.message || '验证码加载失败');
      } finally {
        setLoading(false);
      }
    }, [reset]);

    React.useEffect(() => {
      if (!open) return undefined;
      setCaptchaId('');
      setSvg('');
      void load();
      const onKey = event => { if (event.key === 'Escape') onCancel?.(); };
      window.addEventListener('keydown', onKey);
      return () => {
        window.removeEventListener('keydown', onKey);
        if (timerRef.current) window.clearTimeout(timerRef.current);
      };
    }, [open, load, onCancel]);

    if (!open) return null;

    const finish = code => {
      onSolved?.(captchaId, code);
      reset();
    };

    const addMarker = (target, id, order) => {
      const stage = stageRef.current;
      if (!stage) return;
      const tr = target.getBoundingClientRect();
      const sr = stage.getBoundingClientRect();
      setMarkers(prev => [...prev, {
        id, order,
        x: tr.left - sr.left + tr.width / 2,
        y: tr.top - sr.top + tr.height / 2,
      }]);
      target.classList.add('is-picked');
    };

    const sequenceWrong = () => {
      const next = wrongRef.current + 1;
      wrongRef.current = next;
      setWrong(next);
      setClicks([]);
      setMarkers([]);
      stageRef.current?.querySelectorAll('.is-picked').forEach(node => node.classList.remove('is-picked'));
      if (next >= MAX_SEQUENCE_WRONG) {
        setError('点错太多次，已刷新题目');
        void load();
        return;
      }
      setError('顺序不对，请重试');
    };

    const onStageClick = event => {
      if (loading) return;
      const target = event.target.closest?.('[data-captcha-id]');
      if (!target) return;
      const id = target.getAttribute('data-captcha-id');
      const kind = target.getAttribute('data-captcha-kind') || '';
      if (!id) return;

      if (!isSequencePrompt(prompt)) {
        addMarker(target, id, 1);
        timerRef.current = window.setTimeout(() => finish(id), 180);
        return;
      }
      if (clicks.includes(id)) return;
      if (prompt === 'click_sequence') {
        const expected = sequence[clicks.length];
        if (expected && kind !== expected) {
          sequenceWrong();
          return;
        }
      }
      const next = [...clicks, id];
      addMarker(target, id, next.length);
      setClicks(next);
      setError('');
      if (next.length >= expectedSteps) {
        timerRef.current = window.setTimeout(() => finish(next.join(',')), 220);
      }
    };

    return h('div', { className: 'nof-cap-mask', role: 'dialog', 'aria-modal': true, 'aria-label': '人机验证' },
      h('style', null, CSS),
      h('div', { className: 'nof-cap' },
        h('h2', null, '人机验证'),
        h('p', { className: 'hint' }, '与工作台相同：点选图中目标即可'),
        h('p', { className: 'prompt' }, promptHint(prompt, iconTarget, sequence)),
        prompt === 'click_sequence' && sequence.length
          ? h('div', { className: 'chips' }, sequence.map((kind, index) => h('span', {
            key: `${kind}-${index}`,
            className: `chip${index < clicks.length ? ' done' : index === clicks.length ? ' next' : ''}`,
          }, `${index + 1}. ${ICON_LABEL[kind] || kind}`)))
          : null,
        (prompt === 'click_size_asc' || prompt === 'click_size_desc')
          ? h('p', { className: 'hint' }, `已点 ${clicks.length} / ${expectedSteps}`)
          : null,
        wrong > 0 && wrong < MAX_SEQUENCE_WRONG
          ? h('p', { className: 'hint' }, `还可重试 ${MAX_SEQUENCE_WRONG - wrong} 次`)
          : null,
        h('div', { className: 'row' },
          h('div', { className: 'stage', ref: stageRef, onClick: onStageClick, role: 'presentation' },
            loading
              ? h('div', { className: 'loading' }, '加载中…')
              : h(React.Fragment, null,
                h('div', { style: { position: 'absolute', inset: 1 }, dangerouslySetInnerHTML: { __html: svg } }),
                markers.map(marker => h('span', {
                  key: `${marker.id}-${marker.order}`,
                  className: 'pick',
                  style: { left: marker.x, top: marker.y },
                  'aria-hidden': true,
                }, marker.order)))),
          h('button', {
            type: 'button',
            className: 'refresh',
            disabled: loading,
            'aria-label': '刷新验证码',
            onClick: () => { void load(); },
          }, '↻')),
        h('p', { className: 'err', role: 'status' }, error),
        h('button', { type: 'button', className: 'cancel', onClick: () => onCancel?.() }, '取消'),
      ));
  };
}
