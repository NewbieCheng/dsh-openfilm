import { readFileSync, statSync } from 'node:fs';

/**
 * Page-side overlays for the official OpenFilm shell:
 * - `assets/shell-ui.js` — template picker, recovery card, account chip, …
 * - `assets/login-city.js` — generated city background for the login gate
 * - `assets/shell-login.js` — full-screen login gate (paper card + timeline)
 *
 * All three are read per page render (mtime-cached), so editing + refresh is enough.
 * The city script must come before the login script: login mounts it synchronously.
 * Anything that must happen at plugin assembly time does not belong here.
 */
const uiUrl = new URL('../assets/shell-ui.js', import.meta.url);
const loginUrl = new URL('../assets/shell-login.js', import.meta.url);
const cityUrl = new URL('../assets/login-city.js', import.meta.url);

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
  const stamp = Math.max(mtimeOf(uiUrl), mtimeOf(loginUrl), mtimeOf(cityUrl));
  return stamp > 0 ? String(stamp) : '';
}

export function shellUiInjection() {
  try {
    const stamp = Math.max(mtimeOf(uiUrl), mtimeOf(loginUrl), mtimeOf(cityUrl));
    if (stamp !== cached.mtime) {
      cached = {
        mtime: stamp,
        // Login after UI so the account chip can listen for auth events.
        html: `${scriptTag(uiUrl)}${scriptTag(cityUrl)}${scriptTag(loginUrl)}`,
      };
    }
    return cached.html;
  } catch {
    // Missing or unreadable: the upstream page still works without overlays.
    return '';
  }
}
