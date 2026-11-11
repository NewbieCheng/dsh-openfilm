/**
 * Approval visibility for the bridged chat.
 *
 * DSH asks the person before a sensitive tool action through a waterfall event
 * (`approval/request`, see @deepseek-ai/dsh-user-approval). The OpenFilm panel
 * never saw it: a turn that needed approval simply stopped doing anything, and
 * the person in the panel had no idea the question was waiting in DSH's own
 * window. That is the "一直卡顿，没有动作" symptom.
 *
 * This bridge registers one answerer for the conversations it owns and:
 *   1. publishes the same question to the panel as an ACP `permission` event,
 *      plus a transcript `notice` so the wait is visible even when the card UI
 *      does not render;
 *   2. races the panel's answer against the deployment's own answerers
 *      (`next()`), so answering in either window settles it — whichever comes
 *      first wins.
 *
 * It never bypasses DSH policy: the `never` policy rejects before any answerer
 * runs, and an unbound conversation is delegated untouched with `next()`.
 * Grants stay one-shot; nothing here answers for the person.
 */
const DEFAULT_NOTICE = '需要你在画面这一侧确认';

/**
 * @param ctx Cordis context that owns the `approval/request` listener.
 * @param options.approvals createOfficialApprovals instance (pending + answer).
 * @param options.deliver (projectId, event) => boolean, true only when a live panel took it.
 * @param options.projectOfSession (sessionId) => projectId | undefined, from the Host binding table only.
 * @param options.keyOfProject (projectId) => OpenFilm turn key | undefined.
 * @param options.notice optional text override for the transcript line.
 * @returns dispose function.
 */
export function attachApprovalBridge(ctx, { approvals, deliver, projectOfSession, keyOfProject, notice = DEFAULT_NOTICE } = {}) {
  if (!ctx || typeof ctx.on !== 'function') throw new TypeError('A context with events is required');
  if (!approvals || typeof approvals.request !== 'function' || typeof approvals.answerRequest !== 'function') throw new TypeError('An approval coordinator is required');
  if (typeof deliver !== 'function' || typeof projectOfSession !== 'function' || typeof keyOfProject !== 'function') throw new TypeError('Delivery and binding lookups are required');

  function publishNotice(projectId, key, toolName, requestId) {
    try {
      deliver(projectId, {
        key, kind: 'update',
        update: { sessionUpdate: 'notice', title: notice, description: `${toolName}（${requestId.slice(0, 8)}）在等你决定：允许或拒绝。` },
      });
    } catch { /* the card below is the primary channel */ }
  }

  async function handle(request, next) {
    const sessionId = request?.agent?.session?.id ?? request?.agent?.id;
    const projectId = typeof sessionId === 'string' ? projectOfSession(sessionId) : undefined;
    const key = projectId ? keyOfProject(projectId) : undefined;
    if (!projectId || !key || typeof request?.toolName !== 'string') return next();

    let requestId;
    const pending = approvals.request({
      projectId, key, agentId: sessionId,
      toolName: request.toolName, callId: request.callId, signal: request.signal,
      onRequest: (id) => { requestId = id; },
    });
    // Published right after the card request: `request()` settles 'unavailable'
    // when nothing live took the event, and the notice is what still shows the
    // person why the panel stopped moving.
    if (typeof requestId === 'string') publishNotice(projectId, key, request.toolName, requestId);
    // Ask downstream once, and only once: calling next() twice would ask the
    // deployment's answerers twice for a single decision.
    let downstream;
    const ask = () => (downstream ??= Promise.resolve().then(() => next()));
    const answer = await Promise.race([pending, ask()]);
    if (answer !== 'unavailable') return answer;
    // No panel listener took the question (closed panel, no stream): the
    // deployment's own answerers still own the decision.
    return await ask();
  }

  return ctx.on('approval/request', (request, next) => {
    let settled;
    try { settled = handle(request, next); } catch { return next(); }
    return Promise.resolve(settled).catch(() => next());
  });
}
