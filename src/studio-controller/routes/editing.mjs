import { basename } from 'node:path';

import { buildEditingProjects } from '../../editing-sessions.mjs';
import { readJsonBody } from '../http-body.mjs';

// Editing routes: the sidebar's project list, per-project preferences, archive,
// delete and the recycle-bin flow.
//
// These handlers are read-mostly, but the delete path moves a real folder, so the
// admission checks and the bounded wait for `proxy` are kept exactly as they were
// inside the controller. `getLastProxy` and `getAcpAgentService` are functions
// because both are replaced when Studio restarts; `officialStore` and
// `deleteEditingProject` stay in the controller because they own the Host's
// lifetime and logging.
export function createEditingRoutes({
  ctx,
  register,
  track,
  acpSessions,
  archive,
  editingPrefs,
  verifyOfficialProject,
  listTemplates,
  templatesRoot,
  getLastProxy,
  officialStore,
  deleteEditingProject,
  getAcpAgentService,
}) {
  track(register({
    kind: 'exact', path: '/api/no996-openfilm/editing-sessions',
    async handler(req, res) {
      res.setHeader('cache-control', 'no-store');
      if (req.method !== 'GET') { res.writeHead(405, { allow: 'GET' }).end(); return; }
      const admission = ctx.connection.admit({ headers: req.headers });
      if ('rejection' in admission) {
        res.writeHead(admission.rejection).end(admission.rejection === 403 ? 'DSH_ORIGIN_REJECTED' : 'DSH_SESSION_REQUIRED');
        return;
      }
      if (admission.peer.id !== ctx.connection.browserPeer.id) { res.writeHead(403).end('DSH_BROWSER_REQUIRED'); return; }
      try {
        // The proxy is created during Host startup; a sidebar refresh can arrive
        // before it resolves. Waiting forever left the list stuck on "正在读取"
        // (and a restart "fixed" it). Bound the wait, then fall back to the
        // projects this Host already has a bound Session for.
        let proxy;
        try {
          proxy = await Promise.race([
            Promise.resolve(getLastProxy()).catch(() => undefined),
            new Promise(resolve => setTimeout(() => resolve(undefined), 2500)),
          ]);
        } catch { proxy = undefined; }
        const bound = new Map(acpSessions.all().map(record => [record.projectId, record]));
        const prefs = editingPrefs.all();
        const studioProjects = proxy && typeof proxy.listProjects === 'function'
          ? await proxy.listProjects().catch(() => [])
          : [];
        const projects = studioProjects.length
          ? studioProjects
          : [...bound.values()].map(record => ({
            id: record.projectId,
            name: basename(String(record.cwd ?? '')) || record.projectId,
            path: typeof record.cwd === 'string' ? record.cwd : '',
          }));
        // An archived conversation stays listed: it is where the project's
        // history lives, and the panel opens it read-only with a restore
        // action (hiding it made the whole area look empty). Pinned rows lead.
        const items = buildEditingProjects(projects, {
          bound,
          prefs,
          isArchived: sessionId => archive && typeof archive.isArchived === 'function' ? archive.isArchived(sessionId) : false,
        });
        // Each project is a folder whose conversations are the Studio chat's
        // own sessions. The ACP binding is one session; the chat store is the
        // authority on which conversations exist in the panel.
        let store = null;
        try { store = await officialStore(); } catch { store = null; }
        for (const item of items) {
          let sessions = [];
          if (store) {
            try {
              const data = await store.load(item.projectId);
              sessions = (Array.isArray(data?.sessions) ? data.sessions : [])
                .map(session => ({
                  sessionId: String(session?.id ?? ''),
                  title: typeof session?.title === 'string' ? session.title : '',
                  updatedAt: typeof session?.updatedAt === 'string' ? session.updatedAt : '',
                  archived: session?.archived === true,
                }))
                .filter(session => /^[A-Za-z0-9_-]{6,60}$/.test(session.sessionId));
            } catch { /* fall back to the ACP binding */ }
          }
          if (!sessions.length && item.sessionId) {
            sessions = [{ sessionId: item.sessionId, title: '', updatedAt: '', archived: item.archived }];
          }
          for (const session of sessions) {
            const pref = editingPrefs.getSession(item.projectId, session.sessionId);
            session.pinned = pref?.pinned === true;
            if (typeof pref?.title === 'string' && pref.title) session.title = pref.title;
          }
          sessions.sort((left, right) => (right.pinned ? 1 : 0) - (left.pinned ? 1 : 0)
            || String(right.updatedAt).localeCompare(String(left.updatedAt)));
          item.sessions = sessions;
        }
        res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' }).end(JSON.stringify({ projects: items }));
      } catch {
        res.writeHead(503).end('EDITING_SESSIONS_UNAVAILABLE');
      }
    },
  }));
  // Pin / display name of one editing row. Cosmetic only: the project, its film
  // and the DSH Session title are untouched.
  track(register({
    kind: 'exact', path: '/api/no996-openfilm/editing-prefs',
    async handler(req, res) {
      res.setHeader('cache-control', 'no-store');
      if (req.method !== 'POST') { res.writeHead(405, { allow: 'POST' }).end(); return; }
      const admission = ctx.connection.admit({ headers: req.headers });
      if ('rejection' in admission) { res.writeHead(admission.rejection).end(admission.rejection === 403 ? 'DSH_ORIGIN_REJECTED' : 'DSH_SESSION_REQUIRED'); return; }
      if (admission.peer.id !== ctx.connection.browserPeer.id) { res.writeHead(403).end('DSH_BROWSER_REQUIRED'); return; }
      const body = await readJsonBody(req);
      const projectId = typeof body.projectId === 'string' ? body.projectId : '';
      if (!/^[A-Za-z0-9_-]{6,40}$/.test(projectId)) { res.writeHead(400).end('BAD_PROJECT'); return; }
      try { await verifyOfficialProject(projectId); } catch { res.writeHead(404).end('UNKNOWN_PROJECT'); return; }
      const patch = {};
      if (body.pinned !== undefined) patch.pinned = body.pinned === true;
      if (body.title !== undefined) patch.title = typeof body.title === 'string' ? body.title : '';
      if (typeof body.sessionId === 'string' && /^[A-Za-z0-9_-]{6,60}$/.test(body.sessionId)) {
        editingPrefs.setSession(projectId, body.sessionId, patch);
        res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' }).end(JSON.stringify({ ok: true, pref: editingPrefs.getSession(projectId, body.sessionId) ?? { pinned: false } }));
        return;
      }
      editingPrefs.set(projectId, patch);
      res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' }).end(JSON.stringify({ ok: true, pref: editingPrefs.get(projectId) ?? { pinned: false } }));
    },
  }));
  // Archive / restore the project's bound conversation from the editing list.
  track(register({
    kind: 'exact', path: '/api/no996-openfilm/editing-archive',
    async handler(req, res) {
      res.setHeader('cache-control', 'no-store');
      if (req.method !== 'POST') { res.writeHead(405, { allow: 'POST' }).end(); return; }
      const admission = ctx.connection.admit({ headers: req.headers });
      if ('rejection' in admission) { res.writeHead(admission.rejection).end(admission.rejection === 403 ? 'DSH_ORIGIN_REJECTED' : 'DSH_SESSION_REQUIRED'); return; }
      if (admission.peer.id !== ctx.connection.browserPeer.id) { res.writeHead(403).end('DSH_BROWSER_REQUIRED'); return; }
      const body = await readJsonBody(req);
      const projectId = typeof body.projectId === 'string' ? body.projectId : '';
      if (!/^[A-Za-z0-9_-]{6,40}$/.test(projectId)) { res.writeHead(400).end('BAD_PROJECT'); return; }
      const archived = body.archived === true;
      try { await verifyOfficialProject(projectId); } catch { res.writeHead(404).end('UNKNOWN_PROJECT'); return; }
      const record = acpSessions.get(projectId);
      // A conversation row archives that chat session in the Studio store; the
      // project folder row archives the ACP binding (the DSH Session).
      if (typeof body.sessionId === 'string' && /^[A-Za-z0-9_-]{6,60}$/.test(body.sessionId)) {
        try {
          const store = await officialStore();
          const data = await store.load(projectId);
          const sessions = (Array.isArray(data?.sessions) ? data.sessions : [])
            .map(session => (session?.id === body.sessionId ? { ...session, archived } : session));
          if (Number.isSafeInteger(data?.revision)) await store.saveSessions(projectId, { sessions, last: data.last ?? null, expectedRevision: data.revision });
        } catch { res.writeHead(503).end('ARCHIVE_FAILED'); return; }
        res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' }).end(JSON.stringify({ ok: true, archived }));
        return;
      }
      if (!record || typeof record.sessionId !== 'string') { res.writeHead(409).end('NO_BINDING'); return; }
      if (!archive.available) { res.writeHead(503).end('ARCHIVE_UNAVAILABLE'); return; }
      try {
        if (archived) await archive.archive(record.sessionId, { stopActivity: true });
        else await archive.unarchive(record.sessionId);
      } catch { res.writeHead(503).end('ARCHIVE_FAILED'); return; }
      res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' }).end(JSON.stringify({ ok: true, archived }));
    },
  }));
  // Delete the conversation (binding + Studio chat history + archive the DSH
  // Session). The project folder and its film are never touched — deleting a
  // project is a separate Studio action that says so.
  track(register({
    kind: 'exact', path: '/api/no996-openfilm/editing-delete',
    async handler(req, res) {
      res.setHeader('cache-control', 'no-store');
      if (req.method !== 'POST') { res.writeHead(405, { allow: 'POST' }).end(); return; }
      const admission = ctx.connection.admit({ headers: req.headers });
      if ('rejection' in admission) { res.writeHead(admission.rejection).end(admission.rejection === 403 ? 'DSH_ORIGIN_REJECTED' : 'DSH_SESSION_REQUIRED'); return; }
      if (admission.peer.id !== ctx.connection.browserPeer.id) { res.writeHead(403).end('DSH_BROWSER_REQUIRED'); return; }
      const body = await readJsonBody(req);
      const projectId = typeof body.projectId === 'string' ? body.projectId : '';
      if (!/^[A-Za-z0-9_-]{6,40}$/.test(projectId)) { res.writeHead(400).end('BAD_PROJECT'); return; }
      try { await verifyOfficialProject(projectId); } catch { res.writeHead(404).end('UNKNOWN_PROJECT'); return; }
      const record = acpSessions.get(projectId);
      const one = typeof body.sessionId === 'string' && /^[A-Za-z0-9_-]{6,60}$/.test(body.sessionId) ? body.sessionId : null;
      // A conversation row deletes one Studio chat session (and unbinds the ACP
      // Session only when it is that same conversation). The folder row deletes
      // every conversation of the project; the project folder and film stay.
      try { await getAcpAgentService()?.reset?.(projectId); } catch { /* the binding still goes */ }
      let remaining = 0;
      try {
        const store = await officialStore();
        const data = await store.load(projectId);
        const sessions = Array.isArray(data?.sessions)
          ? data.sessions.filter(item => (one === null ? false : item?.id !== one))
          : [];
        remaining = sessions.length;
        const last = (one === null || data?.last === one) ? (sessions[0]?.id ?? null) : (data?.last ?? null);
        if (Number.isSafeInteger(data?.revision)) await store.saveSessions(projectId, { sessions, last, expectedRevision: data.revision });
      } catch { /* a stale transcript is cosmetic; the binding still goes */ }
      if (one === null || !record || record.sessionId === one) acpSessions.remove(projectId);
      if (record && typeof record.sessionId === 'string' && (one === null || record.sessionId === one)) {
        // Archive the DSH Session rather than deleting its files: DSH keeps its
        // own index, and an archived Session is recoverable.
        try {
          if (archive.available && archive.isArchived(record.sessionId) !== true) await archive.archive(record.sessionId, { stopActivity: true });
        } catch { /* best effort */ }
      }
      res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' }).end(JSON.stringify({ ok: true, remaining }));
    },
  }));
  // Delete the project itself: its OpenFilm folder (default: a recoverable trash
  // beside the projects root), every Studio conversation it has, the ACP binding,
  // pins/titles, and archive the bound DSH Sessions. The folder move is the
  // irreversible step, so it runs first and aborts the whole request on failure:
  // chat records are never dropped for a project that stayed on disk.
  track(register({
    kind: 'exact', path: '/api/no996-openfilm/editing-delete-project',
    async handler(req, res) {
      res.setHeader('cache-control', 'no-store');
      if (req.method !== 'POST') { res.writeHead(405, { allow: 'POST' }).end(); return; }
      const admission = ctx.connection.admit({ headers: req.headers });
      if ('rejection' in admission) { res.writeHead(admission.rejection).end(admission.rejection === 403 ? 'DSH_ORIGIN_REJECTED' : 'DSH_SESSION_REQUIRED'); return; }
      if (admission.peer.id !== ctx.connection.browserPeer.id) { res.writeHead(403).end('DSH_BROWSER_REQUIRED'); return; }
      const body = await readJsonBody(req);
      const projectId = typeof body.projectId === 'string' ? body.projectId : '';
      if (!/^[A-Za-z0-9_-]{6,40}$/.test(projectId)) { res.writeHead(400).end('BAD_PROJECT'); return; }
      const permanent = body.permanent === true;
      let result;
      try { result = await deleteEditingProject(projectId, { permanent }); }
      catch (error) {
        const code = String(error?.code ?? '');
        if (code === 'UNKNOWN_PROJECT') { res.writeHead(404).end('UNKNOWN_PROJECT'); return; }
        if (code === 'PROJECT_BUSY') { res.writeHead(409).end('PROJECT_BUSY'); return; }
        if (code === 'PROJECT_NOT_OPENFILM' || code === 'PROJECT_PATH_INVALID') { res.writeHead(422).end(code); return; }
        res.writeHead(500).end('DELETE_FAILED');
        return;
      }
      res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' }).end(JSON.stringify({ ok: true, ...result }));
    },
  }));

  return { disposers: [] };
}
