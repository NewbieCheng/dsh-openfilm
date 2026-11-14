// Attachment bytes for the panel: a picture the agent made, served back to the
// origin that shows it. `id` must be a 64-hex digest, and the path is built from
// that digest under <DSH_HOME>/attachments — it cannot leave the object store.
import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';

export function createAssetRoutes({ ctx, register, track }) {
  // A picture the agent made, served to the panel that shows it.
  //
  // The frame tool stores what Studio drew as a DSH attachment (`sha256:<hex>` under
  // <DSH_HOME>/attachments/v1/objects). The chat transcript then points at it with
  // `![](/api/no996-openfilm/attachment?id=<hex>)`, which is this route: the panel's own origin,
  // a validated 64-hex id, and a path that cannot leave the object store.
  const unregisterAttachment = track(register({
    kind: 'exact', path: '/api/no996-openfilm/attachment',
    async handler(req, res) {
      res.setHeader('cache-control', 'private, max-age=600');
      if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405, { allow: 'GET, HEAD' }).end(); return; }
      const admission = ctx.connection.admit({ headers: req.headers });
      if ('rejection' in admission || admission.peer.id !== ctx.connection.browserPeer.id) { res.writeHead(403).end(); return; }
      const raw = String(new URL(req.url ?? '/', 'http://localhost').searchParams.get('id') ?? '').trim().toLowerCase();
      const id = raw.replace(/^sha256:/, '');
      if (!/^[a-f0-9]{64}$/.test(id)) { res.writeHead(400, { 'content-type': 'text/plain' }).end('bad attachment id'); return; }
      const home = process.env.DSH_HOME || join(homedir(), '.dsh');
      const file = join(home, 'attachments', 'v1', 'objects', id.slice(0, 2), id);
      let bytes;
      try { bytes = await readFile(file); } catch { res.writeHead(404, { 'content-type': 'text/plain' }).end('not found'); return; }
      const type = bytes[0] === 0x89 && bytes[1] === 0x50 ? 'image/png'
        : bytes[0] === 0xff && bytes[1] === 0xd8 ? 'image/jpeg'
        : bytes.subarray(0, 4).toString('latin1') === 'RIFF' ? 'image/webp' : 'application/octet-stream';
      res.writeHead(200, { 'content-type': type, 'content-length': bytes.byteLength }).end(req.method === 'HEAD' ? undefined : bytes);
    },
  }));

  return { disposers: [unregisterAttachment] };
}
