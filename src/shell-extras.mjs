import { readFileSync, statSync } from 'node:fs';

/**
 * The page-side overlay: the template picker, the 「视频复刻」 removal, the
 * recovery card.
 *
 * It lives in `assets/shell-ui.js` rather than in a template literal here, for
 * one practical reason: this file is read per page render (mtime-cached, ~14 KB),
 * so editing it and refreshing the page is enough — no build, no plugin reload,
 * no escaping rules. Anything that must happen at plugin assembly time does not
 * belong in it.
 */
const assetUrl = new URL('../assets/shell-ui.js', import.meta.url);

let cached = { mtime: -1, html: '' };

export function shellUiInjection() {
  try {
    const info = statSync(assetUrl);
    if (info.mtimeMs !== cached.mtime) {
      const body = readFileSync(assetUrl, 'utf8');
      // A stray </script> would end the injected block early and break the page,
      // so refuse to serve a body that contains one.
      cached = { mtime: info.mtimeMs, html: body.includes('</script') ? '' : `<script>${body}</script>` };
    }
    return cached.html;
  } catch {
    // Missing or unreadable: the upstream page still works, just without the
    // overlay. Never take the whole studio down for a UI nicety.
    return '';
  }
}
