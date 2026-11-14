import { readFileSync, statSync } from 'node:fs';

/**
 * Page-side overlays for the official OpenFilm shell:
 * - `assets/shell-ui.js` — template entry (until acceptance), first-run wizard, …
 *
 * Read per page render (mtime-cached), so editing + refresh is enough.
 *
 * The login gate (`assets/shell-login.js` + `assets/login-city.js`) is no longer
 * injected: both ship inside the shell bundle (`npm run login:sync` copies them
 * into the checkout before the shell build), so they arrive with the app itself.
 */
const uiUrl = new URL('../assets/shell-ui.js', import.meta.url);

let cached = { mtime: -1, html: '' };

function mtimeOf(url) {
  try {
    return Math.round(statSync(url).mtimeMs);
  } catch {
    return 0;
  }
}

function scriptTag(url) {
  try {
    const body = readFileSync(url, 'utf8');
    // A stray </script> would end the injected block early and break the page.
    if (body.includes('</script')) return '';
    return `<script>${body}</script>`;
  } catch {
    return '';
  }
}

export function shellUiVersion() {
  const stamp = mtimeOf(uiUrl);
  return stamp > 0 ? String(stamp) : '';
}

export function shellUiInjection() {
  try {
    const stamp = mtimeOf(uiUrl);
    if (stamp !== cached.mtime) {
      cached = { mtime: stamp, html: scriptTag(uiUrl) };
    }
    return cached.html;
  } catch {
    // Missing or unreadable: the upstream page still works without overlays.
    return '';
  }
}
