// System capability: what this machine already has, what is downloading, and the
// ASR weights the panel can start without a chat turn.
//
// The Host RPC (`system:*`) and the panel's HTTP routes must answer from the same
// snapshot — a person watching the wizard and the panel must not see two different
// progress bars — so both call the functions this module returns.
export function createSystemRoutes({ ctx, register, transcribeService, toolInstaller, detectHostComponents }) {
  const unregisterTranscribeRoute = register({
    kind: 'exact', path: '/api/no996-openfilm/asr',
    async handler(req, res) {
      res.setHeader('cache-control', 'no-store');
      res.setHeader('content-type', 'application/json; charset=utf-8');
      if (req.method !== 'POST') { res.writeHead(405, { allow: 'POST' }).end('{}'); return; }
      const admission = ctx.connection.admit({ headers: req.headers });
      if ('rejection' in admission || admission.peer.id !== ctx.connection.browserPeer.id) { res.writeHead(403).end('{}'); return; }
      let action = 'status';
      try {
        const chunks = [];
        for await (const chunk of req) { chunks.push(chunk); if (Buffer.concat(chunks).byteLength > 4096) break; }
        const parsed = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
        if (parsed?.action === 'install') action = 'install';
      } catch { /* a body we cannot read is a status request */ }
      try {
        const state = await transcribeService.status();
        if (action === 'install' && !state.ready) void transcribeService.setup().catch(() => undefined);
        res.writeHead(200).end(JSON.stringify({
          ready: state.ready, dir: state.dir, bytesTotal: state.bytesTotal,
          bytesOnDisk: state.bytesOnDisk, progress: state.progress,
          installing: state.installing || (action === 'install' && !state.ready), engine: state.engine,
        }));
      } catch (error) {
        res.writeHead(500).end(JSON.stringify({ error: String(error?.message || error).slice(0, 200) }));
      }
    },
  });
  // One view for the wizard: what is installed, what is downloading, what is
  // already usable. The detector answers "can it run"; the installer answers
  // "is something arriving and what went wrong".
  const systemSnapshot = async () => {
    const [components, installer, asrState] = await Promise.all([
      detectHostComponents(),
      toolInstaller.snapshot(),
      transcribeService.status().catch(() => ({ ready: false })),
    ]);
    const asr = {
      ready: asrState.ready === true,
      bytesTotal: Number(asrState.bytesTotal) || 0,
      bytesOnDisk: Number(asrState.bytesOnDisk) || 0,
      progress: Number(asrState.progress) || 0,
      installing: asrState.installing === true,
      engine: typeof asrState.engine === 'string' ? asrState.engine : '',
      phase: typeof asrState.phase === 'string' ? asrState.phase : '',
      source: typeof asrState.source === 'string' ? asrState.source : '',
      speed: Number(asrState.speed) || 0,
      error: typeof asrState.error === 'string' ? asrState.error : '',
    };
    return {
      platform: components.platform,
      tools: components.tools,
      installer,
      asr,
      ready: components.tools.ffmpeg.status === 'ok' && components.tools.ffprobe.status === 'ok' && asr.ready,
    };
  };
  const startSystemInstall = tool => {
    if (tool === 'asr') { void transcribeService.setup().catch(() => undefined); return; }
    const wanted = tool === 'ffmpeg' || tool === 'ffprobe' ? [tool] : ['ffmpeg', 'ffprobe'];
    for (const item of wanted) void toolInstaller.install(item).catch(() => undefined);
  };
  const unregisterSystemCheck = register({
    kind: 'exact', path: '/api/no996-openfilm/system/check',
    async handler(req, res) {
      res.setHeader('cache-control', 'no-store');
      res.setHeader('content-type', 'application/json; charset=utf-8');
      if (req.method !== 'POST') { res.writeHead(405, { allow: 'POST' }).end('{}'); return; }
      const admission = ctx.connection.admit({ headers: req.headers });
      if ('rejection' in admission || admission.peer.id !== ctx.connection.browserPeer.id) { res.writeHead(403).end('{}'); return; }
      try { res.writeHead(200).end(JSON.stringify(await systemSnapshot())); }
      catch (error) { res.writeHead(500).end(JSON.stringify({ error: String(error?.message || error).slice(0, 200) })); }
    },
  });
  const unregisterSystemInstall = register({
    kind: 'exact', path: '/api/no996-openfilm/system/install',
    async handler(req, res) {
      res.setHeader('cache-control', 'no-store');
      res.setHeader('content-type', 'application/json; charset=utf-8');
      if (req.method !== 'POST') { res.writeHead(405, { allow: 'POST' }).end('{}'); return; }
      const admission = ctx.connection.admit({ headers: req.headers });
      if ('rejection' in admission || admission.peer.id !== ctx.connection.browserPeer.id) { res.writeHead(403).end('{}'); return; }
      let tool = 'all';
      try {
        const chunks = [];
        for await (const chunk of req) { chunks.push(chunk); if (Buffer.concat(chunks).byteLength > 4096) break; }
        const parsed = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
        if (typeof parsed?.tool === 'string') tool = parsed.tool;
      } catch { /* an unreadable body installs everything */ }
      try { startSystemInstall(tool); res.writeHead(200).end(JSON.stringify(await systemSnapshot())); }
      catch (error) { res.writeHead(500).end(JSON.stringify({ error: String(error?.message || error).slice(0, 200) })); }
    },
  });

  return {
    snapshot: systemSnapshot,
    install: startSystemInstall,
    disposers: [unregisterTranscribeRoute, unregisterSystemCheck, unregisterSystemInstall],
  };
}
