import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

/**
 * Startup self-report for the video-editing preset.
 *
 * The roster's activation diagnostics are only reachable inside the Host, and
 * every HTTP route needs the person's session, so there is no way to read this
 * state from outside. Writing one small file into the temp directory makes the
 * same facts inspectable without opening a browser, and never contains project
 * data, paths or credentials.
 *
 * The preset row mounts after the plugin that reports on it, so a single early
 * read says "not registered" for a preset that is simply not mounted yet. It is
 * retried for a bounded window; only the window's end is reported as absent.
 */
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

async function collect(ctx) {
  let report;
  try {
    const registry = ctx.get?.('agentPresets');
    const roster = typeof registry?.list === 'function' ? await registry.list() : [];
    const found = roster.find(item => item?.id === 'openfilm-video-editing');
    report = found
      ? {
        registered: true,
        // The roster item shape is only partly documented, so every field that
        // can carry an activation problem is kept: reporting success just
        // because two guessed key names were absent is how a failed preset
        // looked healthy.
        // `broken` is the roster's own failure text; `problems`/`status` are
        // the other shapes seen. Any of them means the preset cannot run.
        ok: !found.broken && !found.error && !found.failure && !found.problems?.length && !['failed', 'error'].includes(String(found.status)),
        detail: String(found.broken ?? found.error ?? found.failure ?? found.problems?.join?.('; ') ?? found.status ?? 'ok').slice(0, 300),
        raw: JSON.stringify(found, (key, value) => (typeof value === 'function' ? '[fn]' : value)).slice(0, 4000),
      }
      : { registered: false, ok: false, detail: 'preset row not registered' };
    report.presets = roster.map(item => item?.id).filter(Boolean).sort();
    // The child rows that failed to mount explain a failed preset far better
    // than the preset row itself does.
    try {
      const loader = ctx.get?.('loader');
      const scope = loader?.entries ?? loader?.scope?.entries;
      const rows = [];
      const visit = entry => {
        for (const child of entry?.entries ?? entry?.children ?? []) visit(child);
        const name = entry?.name ?? entry?.options?.name;
        const id = entry?.id ?? entry?.options?.id;
        const problem = entry?.error ?? entry?.fiber?.error ?? entry?.fiber?.status;
        if (name && String(name).match(/openfilm|dsh-tool|dsh-skill|dsh-agent-instructions/i)) {
          rows.push({ id: String(id ?? '').slice(0, 60), name: String(name).slice(0, 80), problem: String(problem?.message ?? problem ?? entry?.fiber?.status ?? '').slice(0, 200) });
        }
      };
      for (const entry of Array.isArray(scope) ? scope : [...(scope?.values?.() ?? [])]) visit(entry);
      if (rows.length) report.children = rows.slice(0, 40);
    } catch { /* the Loader shape is not a public contract */ }
  } catch (error) {
    report = { registered: false, ok: false, detail: String(error?.message || error).slice(0, 300) };
  }
  return report;
}

export function reportPresetStatus(ctx, { file = join(tmpdir(), 'dsh-openfilm-preset.json'), attempts = 20, delayMs = 500 } = {}) {
  const done = (async () => {
    let report;
    let attempt = 0;
    for (; attempt < attempts; attempt++) {
      report = await collect(ctx);
      if (report.registered) break;
      if (attempt + 1 < attempts) await sleep(delayMs);
    }
    report.attempt = attempt + 1;
    report.at = new Date().toISOString();
    try { await writeFile(file, JSON.stringify(report, null, 1), 'utf8'); } catch { /* best effort */ }
    return report;
  })();
  return { file, done };
}
