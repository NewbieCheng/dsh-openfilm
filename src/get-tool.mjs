/**
 * `openfilm_get`: media made by a service the person connected — voice-over,
 * music, sound effects, transcripts, pictures, video, translation.
 *
 * Upstream owns the policy here and this tool must not second-guess it:
 *   - nothing connected → upstream answers with the list of what makes it and
 *     where the person connects one. That is an answer for the model, not an
 *     error: the model should tell the person, not retry.
 *   - a video clip spends real money → upstream asks the person in Studio first
 *     and only runs with `yes` when no page can ask. The model may pass `yes`
 *     only when the person said to.
 * Every receipt is upstream's own text; this tool never invents success.
 */
const MAX_VERBS = 24;
const MAX_TEXT = 4000;

const text = value => (typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined);

export function createGetTool({ isProjectAgent, projectOf, http }) {
  return {
    name: 'openfilm_get',
    description: 'Make media for this film with a service the person connected in Studio: voice-over, music, sound effects, transcripts, images, video, subtitle translation. Check `list: true` first to see what is connected here. If nothing is connected it says so — tell the person where to connect it instead of retrying. Video clips cost money: only pass yes when the person told you to spend.',
    parameters: {
      type: 'object', additionalProperties: false,
      properties: {
        verb: { type: 'string', description: 'What to make (tts, music, sfx, asr, image, image-search, video, translate, cutout, web-search …).' },
        prompt: { type: 'string', description: 'What it should be or say.' },
        seconds: { type: 'integer', minimum: 1, maximum: 3600, description: 'How long, for audio or video.' },
        take: { type: 'string', description: 'For some verbs: an existing item id to bring in instead of generating.' },
        list: { type: 'boolean', description: 'Only report what can be got here now, and what is not connected.' },
        yes: { type: 'boolean', description: 'Confirm spending without asking in Studio. Only when the person said to.' },
      },
    },
    output: { schema: { type: 'object', additionalProperties: false, required: ['text'], properties: { text: { type: 'string' } } }, render: (_args, value) => [{ type: 'text', text: value?.text ?? '' }] },
    isConcurrencySafe: () => false,
    async execute(args, exec) {
      if (typeof isProjectAgent !== 'function' || isProjectAgent(exec?.agent) !== true) {
        throw new Error('This tool is available only to a conversation bound to an OpenFilm project.');
      }
      const project = projectOf?.(exec.agent);
      if (!project?.projectId || !project.path) throw new Error('This conversation is not bound to an OpenFilm project.');

      if (args?.list === true) {
        const catalog = await http().get('/api/get');
        const verbs = Array.isArray(catalog?.verbs) ? catalog.verbs : [];
        const listing = verbs.slice(0, MAX_VERBS).map(entry => {
          const verb = text(entry?.verb) ?? '?';
          const help = text(entry?.help) ?? '';
          return `${verb}${help ? ` — ${help.slice(0, 160)}` : ''}`;
        });
        const note = text(catalog?.note);
        return {
          text: [
            verbs.length > 0 ? `这台机器现在能做的：\n${listing.join('\n')}` : '这台机器现在没有连接任何生成服务。',
            note ? `\n说明：${note.slice(0, 1200)}` : '',
          ].join('').slice(0, MAX_TEXT),
        };
      }

      const verb = text(args?.verb);
      if (!verb) throw new Error('A verb is required (or list: true to see what is possible).');
      const result = await http().post('/api/get', {
        body: {
          folder: project.path,
          verb,
          args: {
            ...(text(args?.prompt) ? { prompt: text(args.prompt) } : {}),
            ...(Number.isSafeInteger(args?.seconds) ? { sec: String(args.seconds) } : {}),
            ...(text(args?.take) ? { take: text(args.take) } : {}),
          },
          ...(args?.yes === true ? { yes: true } : {}),
        },
      });
      const said = text(result?.text) ?? '';
      if (result?.ok === true) return { text: said ? `完成：${said}`.slice(0, MAX_TEXT) : `${verb} 已完成（Studio 没给更多说明）。` };
      // Not a tool failure: upstream explained why, and the model should relay it.
      const reason = text(result?.reason);
      return {
        text: [
          `${verb} 没有做成${reason === 'balance' ? '（服务账户余额不足）' : ''}。`,
          said || 'Studio 没有说明原因。',
          reason === 'balance' ? '需要人去 Studio 的 Services 里充值，这里不要重试。' : '按上面的说明处理，不要原样重试。',
        ].join(' ').slice(0, MAX_TEXT),
      };
    },
  };
}
