import { summarizeFilm } from './film-summary.mjs'
import { decodeFilmSource, MAX_SOURCE_BYTES } from './film-source.mjs'
import { layoutTimeline } from './timeline-layout.mjs'
import { startDraft, appendDraft, undoDraft } from './draft-session.mjs'

window.__ModuleLoader__.load({
  id: 'dsh-openfilm',
  factory(require) {
    const React = require('react')
    const h = React.createElement
    const NS = 'no996Openfilm'
    const PANEL = 'no996-openfilm'
    const en = {
      panel: 'Video studio', eyebrow: 'VIDEO STUDIO', title: 'A place for your films',
      subtitle: 'Browse the workspace where your OpenFilm project lives.',
      label: 'Workspace session', choose: 'Choose a session', browse: 'Browse workspace',
      root: 'Workspace files', empty: 'This workspace is empty.', loading: 'Loading…',
      error: 'Unable to read this workspace.', truncated: 'This list is incomplete.',
      note: 'Move, trim and split are available in an unsaved draft; saving, preview and export are not connected yet.',
      next: 'Select a session and browse its workspace to get started.', back: 'Back', directory: 'Folder', film: 'OpenFilm project file', inspect: 'Inspect film.html', close: 'Close source', source: 'Source (not executed)', partial: 'Only the first 2 MiB is shown; summary needs the complete file.', summary: 'Film overview', tracks: 'Tracks', seconds: 'seconds', unknown: 'Unknown', invalid: 'This is not a valid OpenFilm project.', sourceShort: 'The source display is limited to 200,000 characters.', timeline: 'Timeline', track: 'Track', more: 'Some tracks or clips are omitted.', unscaled: 'Timing is unknown; clips are listed without a scale.', draft: 'Edit a clip (unsaved draft)', selectClip: 'Choose a clip', operation: 'Operation', move: 'Move', trim: 'Trim', split: 'Split', start: 'Film time (seconds)', sourceStart: 'Source start (seconds)', sourceEnd: 'Source end (seconds)', apply: 'Apply to draft', undo: 'Undo last edit', reset: 'Discard draft', unsaved: 'Unsaved draft: the project file has not changed. Copy the source below to save it through an authorized file tool.',
    }
    const zh = {
      panel: '视频创作', eyebrow: 'VIDEO STUDIO', title: '让想法成为影片',
      subtitle: '选择一个会话，查看 OpenFilm 工程所在的工作区。',
      label: '工作区会话', choose: '选择一个会话', browse: '查看工作区',
      root: '工作区文件', empty: '这个工作区是空的。', loading: '正在读取…',
      error: '无法读取该工作区。', truncated: '列表未完整显示。',
      note: '支持在未保存草稿中移动、裁剪和拆分片段；保存、预览和导出尚未接入。',
      next: '选择会话并查看其工作区，开始管理影片。', back: '返回上级', directory: '文件夹', film: 'OpenFilm 工程文件', inspect: '查看 film.html', close: '关闭源码', source: '工程源码（不会执行）', partial: '仅显示前 2 MiB；工程摘要需要完整文件。', summary: '影片概览', tracks: '轨道', seconds: '秒', unknown: '未知', invalid: '不是有效的 OpenFilm 工程。', sourceShort: '源码显示限制为前 200,000 个字符。', timeline: '时间线', track: '轨道', more: '部分轨道或片段未显示。', unscaled: '时长未知，片段未按时间比例显示。', draft: '编辑片段（未保存草稿）', selectClip: '选择片段', operation: '操作', move: '移动', trim: '裁剪', split: '拆分', start: '影片时间（秒）', sourceStart: '素材起点（秒）', sourceEnd: '素材终点（秒）', apply: '应用到草稿', undo: '撤销上一步', reset: '放弃草稿', unsaved: '这是未保存的草稿，原工程文件没有改变。可复制下方源码，通过有权限的文件工具保存。',
    }
    function PanelIcon({ size }) {
      return h('svg', { width: size, height: size, viewBox: '0 0 24 24', fill: 'none', 'aria-hidden': true },
        h('rect', { x: 3, y: 5, width: 18, height: 14, rx: 3, stroke: 'currentColor', strokeWidth: 1.7 }),
        h('path', { d: 'm10 9 5 3-5 3V9Z', fill: 'currentColor' }))
    }
    function Studio({ t, useSessions, listWorkspace, readWorkspace }) {
      const sessions = useSessions(s => s)
      const [sessionId, setSessionId] = React.useState('')
      const [state, setState] = React.useState(null)
      const [clipId, setClipId] = React.useState('')
      const [start, setStart] = React.useState('')
      const [end, setEnd] = React.useState('')
      const [operation, setOperation] = React.useState('move')
      const request = React.useRef(null)
      React.useEffect(() => () => request.current?.abort(), [])
      const choices = sessions.ids.map(id => sessions.byId[id]).filter(s => s?.cwd && s.origin !== 'subagent')
      const selected = choices.find(s => s.id === sessionId)
      async function browse(parts = []) {
        if (!selected || !Array.isArray(parts) || parts.some(part => typeof part !== 'string' || !part || part === '.' || part === '..' || /[\\/:\u0000]/.test(part))) return
        request.current?.abort()
        const controller = new AbortController()
        request.current = controller
        setState({ sessionId, parts, loading: true })
        try {
          const result = await listWorkspace(sessionId, parts.join('/') || '.', controller.signal)
          if (controller.signal.aborted) return
          if (!result?.ok) setState({ sessionId, parts, error: result?.error?.message || result?.error?.code || t('error') })
          else setState({ sessionId, parts, entries: result.value.entries, truncated: result.value.truncated })
        } catch (err) {
          if (!controller.signal.aborted) setState({ sessionId, parts, error: String(err?.message || err) })
        }
      }
      async function inspectFilm() {
        if (!selected || !state || state.sessionId !== sessionId || !state.entries?.some(entry => entry.type === 'file' && entry.name === 'film.html')) return
        request.current?.abort()
        const controller = new AbortController()
        request.current = controller
        const previous = state
        setState({ ...previous, reading: true, source: null, sourceError: null })
        try {
          const path = [...previous.parts, 'film.html'].join('/')
          const result = await readWorkspace(sessionId, path, controller.signal)
          if (controller.signal.aborted) return
          if (!result?.ok) setState({ ...previous, sourceError: result?.error?.message || result?.error?.code || t('error') })
          else {
            const source = decodeFilmSource(result.value)
            setClipId('')
            setStart('')
            setEnd('')
            setOperation('move')
            const draft = source.eof && source.version ? startDraft(source.text, source.version) : null
            setState({ ...previous, source, draft, dirty: false, draftError: null })
          }
        } catch (err) {
          if (!controller.signal.aborted) setState({ ...previous, sourceError: String(err?.message || err) })
        }
      }
      const visible = selected && state?.sessionId === sessionId ? state : null
      const source = visible?.source
      const { summary, invalid } = React.useMemo(() => {
        if (!source?.eof) return { summary: null, invalid: false }
        try { return { summary: summarizeFilm(source.text), invalid: false } }
        catch { return { summary: null, invalid: true } }
      }, [source])
      const timeline = React.useMemo(() => summary ? layoutTimeline(summary, { maxTracks: 25, maxClipsPerTrack: 40 }) : null, [summary])
      function editDraft() {
        if (!visible?.source?.eof || !visible.draft || visible.source.text.length > 200000 || !clipId || start.trim() === '' || (operation === 'trim' && end.trim() === '')) return
        try {
          const edit = operation === 'trim'
            ? { op: 'trim', clip: clipId, start: Number(start), end: Number(end) }
            : { op: operation, clip: clipId, at: Number(start) }
          const draft = appendDraft(visible.draft, edit)
          if (draft.text.length > 200000) throw new Error(t('sourceShort'))
          setState({ ...visible, draft, source: { text: draft.text, eof: true }, dirty: true, draftError: null })
        } catch (err) {
          setState({ ...visible, draftError: String(err?.message || err) })
        }
      }
      const button = { border: '1px solid var(--dsw-alias-border-l2)', background: 'var(--dsw-alias-bg-layer-1)', color: 'var(--dsw-alias-label-primary)', padding: '10px 14px', borderRadius: 8, fontSize: 13 }
      return h('main', { style: { height: '100%', overflow: 'auto', background: 'var(--dsw-alias-bg-base)', color: 'var(--dsw-alias-label-primary)' } },
        h('div', { style: { maxWidth: 980, margin: '0 auto', padding: 'clamp(24px, 5vw, 60px)' } },
          h('p', { style: { fontSize: 11, letterSpacing: '.16em', color: 'var(--dsw-alias-label-secondary)' } }, t('eyebrow')),
          h('h1', { style: { fontSize: 'clamp(30px, 4vw, 46px)', letterSpacing: '-.03em', margin: '16px 0 12px' } }, t('title')),
          h('p', { style: { color: 'var(--dsw-alias-label-secondary)', lineHeight: 1.6 } }, t('subtitle')),
          h('p', { role: 'status', style: { borderLeft: '3px solid var(--dsw-alias-state-warn-primary)', padding: '8px 14px', margin: '30px 0', color: 'var(--dsw-alias-label-secondary)' } }, t('note')),
          h('section', { style: { border: '1px solid var(--dsw-alias-border-l1)', borderRadius: 12, padding: 24, background: 'var(--dsw-alias-bg-layer-1)' } },
            h('label', { htmlFor: 'no996-openfilm-session', style: { display: 'block', fontSize: 13, marginBottom: 10 } }, t('label')),
            h('div', { style: { display: 'flex', flexWrap: 'wrap', gap: 10 } },
              h('select', { id: 'no996-openfilm-session', value: selected?.id ?? '', disabled: !!visible?.dirty, style: { ...button, minWidth: 220 }, onChange: e => { request.current?.abort(); setState(null); setSessionId(e.target.value) } },
                h('option', { value: '' }, t('choose')),
                ...choices.map(s => h('option', { key: s.id, value: s.id }, s.displayTitle || s.cwd))),
              h('button', { type: 'button', style: button, disabled: !selected || !!visible?.loading || !!visible?.dirty, onClick: () => browse([]) }, t('browse'))),
            !selected ? h('p', { style: { color: 'var(--dsw-alias-label-secondary)', fontSize: 13, marginTop: 20 } }, t('next')) : null,
            visible?.loading ? h('p', { role: 'status' }, t('loading')) : null,
            visible?.error ? h('p', { role: 'alert', style: { color: 'var(--dsw-alias-state-error-primary)' } }, t('error'), ' ', visible.error) : null,
            visible?.entries ? h('div', { style: { marginTop: 24 } },
              h('h2', { style: { fontSize: 14 } }, t('root'), visible.parts.length ? ` / ${visible.parts.join(' / ')}` : ''),
              visible.parts.length ? h('button', { type: 'button', style: button, disabled: !!visible.dirty, onClick: () => browse(visible.parts.slice(0, -1)) }, t('back')) : null,
              visible.entries.length ? h('ul', { style: { listStyle: 'none', padding: 0, margin: 0 } },
                ...visible.entries.map(entry => h('li', { key: entry.name, style: { padding: '10px 0', borderBottom: '1px solid var(--dsw-alias-border-l1)', fontSize: 13 } },
                  entry.type === 'directory'
                    ? h('button', { type: 'button', style: button, disabled: !!visible.dirty, onClick: () => browse([...visible.parts, entry.name]) }, `${entry.name}/`)
                    : entry.type === 'file' && entry.name === 'film.html'
                      ? h('button', { type: 'button', style: button, disabled: !!visible.reading || !!visible.dirty, onClick: inspectFilm }, t('inspect'))
                      : h('span', null, entry.name)))) : h('p', null, t('empty')),
              visible.truncated ? h('p', { role: 'status' }, t('truncated')) : null,
              visible.reading ? h('p', { role: 'status' }, t('loading')) : null,
              visible.sourceError ? h('p', { role: 'alert' }, visible.sourceError) : null,
              visible.source ? h('section', null,
                h('h3', null, t('source')),
                h('button', { type: 'button', style: button, disabled: !!visible.dirty, onClick: () => setState({ ...visible, source: null }) }, t('close')),
                visible.source.eof ? null : h('p', { role: 'status' }, t('partial')),
                invalid ? h('p', { role: 'alert' }, t('invalid')) : null,
                summary ? h('section', { 'aria-label': t('summary') },
                  h('h4', null, t('summary')),
                  h('p', null, `${summary.stage.w} × ${summary.stage.h} · ${summary.duration === null ? t('unknown') : summary.duration} ${t('seconds')} · ${summary.tracks.length} ${t('tracks')}`),
                  h('h4', null, t('timeline')),
                  timeline.scaleStatus !== 'known' ? h('p', { role: 'status' }, t('unscaled')) : null,
                  timeline.truncated ? h('p', { role: 'status' }, t('more')) : null,
                  h('ol', { style: { paddingLeft: 20 } }, ...timeline.tracks.map(track => h('li', { key: track.index, style: { marginBottom: 12 } },
                    h('span', null, `${t('track')} ${track.index + 1}`),
                    timeline.scaleStatus === 'known' ? h('div', { style: { position: 'relative', height: 24, marginTop: 4, background: 'var(--dsw-alias-bg-layer-2)', borderRadius: 4 }, 'aria-hidden': true },
                      ...track.clips.filter(clip => clip.leftPercent !== null && clip.widthPercent !== null).map(clip => h('span', { key: clip.index, style: { position: 'absolute', left: `${clip.leftPercent}%`, width: `${clip.widthPercent}%`, height: 24, background: 'var(--dsw-alias-brand-primary)', opacity: clip.disabled ? 0.35 : 0.75 } }))) : null,
                    h('ul', { style: { paddingLeft: 20, fontSize: 12, color: 'var(--dsw-alias-label-secondary)' } }, ...track.clips.map(clip => h('li', { key: clip.index }, `${clip.id ?? '—'} (${clip.kind ?? '—'}) · ${clip.at ?? t('unknown')} / ${clip.duration ?? t('unknown')} ${t('seconds')}`))))))) : null,
                summary && visible.draft && visible.source.text.length <= 200000 ? h('section', { 'aria-label': t('draft') },
                  h('h4', null, t('draft')),
                  visible.dirty ? h('p', { role: 'status' }, t('unsaved')) : null,
                  visible.draftError ? h('p', { role: 'alert' }, visible.draftError) : null,
                  h('label', { htmlFor: 'no996-openfilm-clip' }, t('selectClip')),
                  h('select', { id: 'no996-openfilm-clip', value: clipId, style: button, onChange: e => setClipId(e.target.value) },
                    h('option', { value: '' }, t('selectClip')),
                    ...timeline.tracks.flatMap(track => track.clips.filter(clip => clip.id).map(clip => h('option', { key: `${track.index}-${clip.index}`, value: clip.id }, `${clip.id} · ${t('track')} ${track.index + 1}`)))),
                  h('label', { htmlFor: 'no996-openfilm-operation' }, t('operation')),
                  h('select', { id: 'no996-openfilm-operation', value: operation, style: button, onChange: e => { setOperation(e.target.value); setStart(''); setEnd('') } },
                    ...['move', 'trim', 'split'].map(op => h('option', { key: op, value: op }, t(op)))),
                  h('label', { htmlFor: 'no996-openfilm-start' }, t(operation === 'trim' ? 'sourceStart' : 'start')),
                  h('input', { id: 'no996-openfilm-start', type: 'number', min: 0, step: '0.001', value: start, style: button, onChange: e => setStart(e.target.value) }),
                  operation === 'trim' ? h('label', { htmlFor: 'no996-openfilm-end' }, t('sourceEnd')) : null,
                  operation === 'trim' ? h('input', { id: 'no996-openfilm-end', type: 'number', min: 0, step: '0.001', value: end, style: button, onChange: e => setEnd(e.target.value) }) : null,
                  h('button', { type: 'button', style: button, disabled: !clipId || start.trim() === '' || (operation === 'trim' && end.trim() === ''), onClick: editDraft }, t('apply')),
                  visible.dirty ? h('button', { type: 'button', style: button, onClick: () => {
                    const draft = undoDraft(visible.draft)
                    setState({ ...visible, draft, source: { text: draft.text, eof: true }, dirty: draft.operations.length > 0, draftError: null })
                  } }, t('undo')) : null,
                  visible.dirty ? h('button', { type: 'button', style: button, onClick: () => setState({ ...visible, draft: startDraft(visible.draft.originalText, visible.draft.originalVersion), source: { text: visible.draft.originalText, eof: true }, dirty: false, draftError: null }) }, t('reset')) : null) : null,
                visible.source.text.length > 200000 ? h('p', { role: 'status' }, t('sourceShort')) : null,
                h('pre', { style: { whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', maxHeight: 400, overflow: 'auto', fontSize: 12 } }, visible.source.text.slice(0, 200000))) : null) : null)))
    }
    return {
      inject: ['slots', 'locale', 'sessions', 'remote', 'remote.workspaceFiles'],
      apply(ctx) {
        ctx.effect(() => ctx.locale.register(NS, { en, zh }), 'openfilm: dictionaries')
        const t = ctx.locale.bind(NS)
        ctx.slots.inject('main', () => ctx.slots.register({
          name: 'main', key: PANEL, locale: NS,
          inject: () => ({
            listWorkspace: (sessionId, path, signal) => ctx.remote.workspaceFiles.list(sessionId, path, signal),
            readWorkspace: (sessionId, path, signal) => ctx.remote.workspaceFiles.readBytes(sessionId, path, { range: { offset: 0, length: MAX_SOURCE_BYTES } }, signal),
          }),
        }, Studio))
        ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({
          name: 'sidebar.panellist', id: PANEL, order: 21, locale: NS, label: () => t('panel'),
        }, PanelIcon))
      },
    }
  },
})
