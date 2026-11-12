#!/usr/bin/env node
/**
 * Real-engine smoke test: one file in, a transcript and its numbers out.
 *
 *   DSH_HOME=<home> node scripts/asr-smoke.mjs C:\clips\talk.mp4
 *
 * This is the check the unit tests deliberately cannot be: they use a stub
 * recognizer, so only this script can tell whether the engine loads, how long the
 * first decode takes, and whether the text is actually right. Its output is what
 * belongs in docs/TEST-CHECKLIST.md.
 */
import { stat } from 'node:fs/promises';
import { createTranscribeService } from '../src/transcribe-service.mjs';

const source = process.argv[2];
if (!source) {
  console.error('用法： node scripts/asr-smoke.mjs <本机绝对路径>');
  process.exit(2);
}
const size = (await stat(source)).size;

const cacheDir = process.argv[3] ?? null;
const service = createTranscribeService({});
const status = await service.status();
console.log('模型：' + (status.ready ? '已就绪' : '未就绪') + ' · ' + status.dir);
if (!status.ready) process.exit(1);

const started = Date.now();
const record = await service.transcribe({
  source,
  cacheDir,
  onProgress: event => {
    if (event.phase === 'transcribe') process.stderr.write('  识别 ' + event.done + '/' + event.total + '\r');
  },
});
process.stderr.write('\n');

const payload = {
  source, sourceMB: Math.round(size / 1024 / 1024 * 10) / 10,
  wallMs: Date.now() - started,
  modelLoadMs: record.modelLoadMs,
  durationSec: record.durationSec,
  stats: record.stats,
  cached: record.cached,
  segments: record.segments.slice(0, 6),
  text: record.text.slice(0, 400),
};
console.log(JSON.stringify(payload, null, 2));
