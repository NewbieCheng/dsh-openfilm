import { readFileSync, statSync } from 'node:fs';

/**
 * The style workbench is a development tool, not a product surface.
 *
 * It is injected only when NO996_OPENFILM_STYLE_LAB=1 so a shipped build never
 * carries a panel that edits CSS variables in someone's editor. The asset is
 * read per page render (mtime cache), so iterating on the toolbar itself is
 * save + refresh, like the other overlays.
 */
const assetUrl = new URL('../assets/style-lab.js', import.meta.url);

let cached = { mtime: -1, html: '' };

export function styleLabInjection(env = process.env) {
  if (env.NO996_OPENFILM_STYLE_LAB !== '1') return '';
  try {
    const mtime = Math.round(statSync(assetUrl).mtimeMs);
    if (mtime !== cached.mtime) {
      const body = readFileSync(assetUrl, 'utf8');
      // A stray </script> would end the injected block early.
      cached = { mtime, html: body.includes('</script') ? '' : `<script data-no996-style-lab>${body}</script>` };
    }
    return cached.html;
  } catch {
    return '';
  }
}

export function styleLabVersion() {
  try {
    return String(Math.round(statSync(assetUrl).mtimeMs));
  } catch {
    return '';
  }
}
