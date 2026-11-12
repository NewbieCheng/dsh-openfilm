#!/usr/bin/env node
/**
 * Prepare the local speech model, or say what is missing.
 *
 *   node scripts/asr-models.mjs status
 *   node scripts/asr-models.mjs fetch
 *
 * Kept as a script so the message a person gets from the tool ("run this") is a
 * real command rather than a paragraph of prose they have to translate.
 */
import { modelState, ensureModels, SENSE_VOICE } from '../src/asr-models.mjs';

const command = process.argv[2] ?? 'status';
const mb = bytes => (bytes / 1024 / 1024).toFixed(0) + ' MB';

if (command === 'status') {
  const state = await modelState();
  console.log(JSON.stringify({
    id: state.id, ready: state.ready, dir: state.dir,
    present: state.present, missing: state.missing.map(file => file.name),
    bytesTotal: state.bytesTotal,
  }, null, 2));
  if (!state.ready) {
    console.log('\n模型未准备好。运行： node scripts/asr-models.mjs fetch');
    process.exitCode = 1;
  }
} else if (command === 'fetch') {
  console.log('准备 ' + SENSE_VOICE.label + '，约 ' + mb(SENSE_VOICE.bytes) + '。只下载一次。');
  let last = 0;
  const state = await ensureModels({
    onProgress: ({ file, seen, total }) => {
      const now = Date.now();
      if (now - last < 1500) return;
      last = now;
      const percent = total > 0 ? Math.floor((seen / total) * 100) : 0;
      process.stderr.write('  ' + file + ' ' + percent + '% (' + mb(seen) + '/' + mb(total) + ')\r');
    },
  });
  process.stderr.write('\n');
  console.log(JSON.stringify({ ready: state.ready, dir: state.dir, downloaded: state.downloaded.map(file => file.name) }, null, 2));
} else {
  console.error('用法： node scripts/asr-models.mjs [status|fetch]');
  process.exitCode = 2;
}
