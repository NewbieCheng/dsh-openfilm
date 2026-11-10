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
 */
export function reportPresetStatus(ctx, { file = join(tmpdir(), 'dsh-openfilm-preset.json') } = {}) {
  const done = (async () => {
    let report;
    try {
      const registry = ctx.get?.('agentPresets');
      const roster = typeof registry?.list === 'function' ? await registry.list() : [];
      const found = roster.find(item => item?.id === 'openfilm-video-editing');
      report = found
        ? { registered: true, ok: !found.error && !found.failure, detail: String(found.error ?? found.failure ?? 'ok').slice(0, 300) }
        : { registered: false, ok: false, detail: 'preset row not registered' };
      report.presets = roster.map(item => item?.id).filter(Boolean).sort();
    } catch (error) {
      report = { registered: false, ok: false, detail: String(error?.message || error).slice(0, 300) };
    }
    report.at = new Date().toISOString();
    try { await writeFile(file, JSON.stringify(report, null, 1), 'utf8'); } catch { /* best effort */ }
    return report;
  })();
  return { file, done };
}
