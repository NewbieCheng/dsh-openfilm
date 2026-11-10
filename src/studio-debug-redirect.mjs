import { createServer } from 'node:http';

/**
 * The same fixed debug port, for the case where this host runs inside DSH's own
 * browser surface: there is no Studio ticket to redeem, so the listener cannot
 * hold Studio's session cookie itself. Instead it points the window at the DSH
 * origin's standalone route, which the person's browser is already signed in to.
 *
 * Loopback only, same port as the ticketed listener, so one bookmark works in
 * whichever mode the host was started.
 */
export function startStudioRedirect({ target, port = Number(process.env.NO996_OPENFILM_DEBUG_PORT || 47821) }) {
  const destination = new URL(target);
  if (destination.protocol !== 'http:' || !['127.0.0.1', 'localhost'].includes(destination.hostname)) {
    throw new TypeError('Invalid redirect target');
  }
  const server = createServer((req, res) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405, { allow: 'GET, HEAD' }).end(); return; }
    res.writeHead(302, { location: destination.href, 'cache-control': 'no-store' }).end();
  });
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => {
      server.off('error', reject);
      server.on('error', () => {});
      resolve({
        url: `http://127.0.0.1:${server.address().port}/`,
        close: () => new Promise(done => server.close(() => done())),
      });
    });
  });
}
