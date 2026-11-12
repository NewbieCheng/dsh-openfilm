/**
 * The Studio's local-services list is native upstream code: the model metadata
 * lives in `studio/server/local-models.mjs` (`ABOUT`), the file list in
 * `library/local-models.json`. Both are data, so adding SenseVoice needs no UI
 * rebuild — the row is rendered by the existing component with the existing
 * style. They do live inside the installed `openfilm` package, though, which a
 * pnpm reinstall replaces, so this applies the same two edits on every Host
 * start and is idempotent.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export const SENSE_VOICE_ID = 'sensevoice-small';

export const SENSE_VOICE_ABOUT =
  "  'sensevoice-small': { kind: 'asr', name: 'SenseVoice', by: 'FunAudioLLM', site: 'github.com/FunAudioLLM/SenseVoice', license: 'FunAudioLLM Model License', memoryMb: 1200 },";

export const SENSE_VOICE_MODEL = Object.freeze({
  id: SENSE_VOICE_ID,
  files: [
    { path: 'models/sensevoice-small/model.int8.onnx', bytes: 239233841, sha256: 'c71f0ce00bec95b07744e116345e33d8cbbe08cef896382cf907bf4b51a2cd51' },
    { path: 'models/sensevoice-small/tokens.txt', bytes: 315894, sha256: 'f449eb28dc567533d7fa59be34e2abca8784f771850c78a47fb731a31429a1dc' },
  ],
});

/**
 * @param {{ packageRoot?: string, logger?: { warn?: Function } }} options
 * @returns {{ patched: boolean, models: boolean, about: boolean }}
 */
export function applyStudioLibraryPatch({ packageRoot, logger = null } = {}) {
  if (typeof packageRoot !== 'string' || !packageRoot) return { patched: false, models: false, about: false };
  let models = false;
  let about = false;

  const jsonPath = join(packageRoot, 'library', 'local-models.json');
  try {
    const parsed = JSON.parse(readFileSync(jsonPath, 'utf8'));
    const list = Array.isArray(parsed?.models) ? parsed.models : [];
    if (!list.some(model => model?.id === SENSE_VOICE_ID)) {
      parsed.models = [...list, SENSE_VOICE_MODEL];
      writeFileSync(jsonPath, JSON.stringify(parsed, null, 1) + '\n');
      models = true;
    }
  } catch (error) {
    logger?.warn?.('studio-library-patch-models', { message: String(error?.message || error).slice(0, 120) });
  }

  const serverPath = join(packageRoot, 'studio', 'server', 'local-models.mjs');
  try {
    const text = readFileSync(serverPath, 'utf8');
    if (!text.includes(`'${SENSE_VOICE_ID}'`)) {
      const start = text.indexOf('const ABOUT = {');
      const end = start >= 0 ? text.indexOf('\n};', start) : -1;
      if (start >= 0 && end > start) {
        writeFileSync(serverPath, text.slice(0, end) + '\n' + SENSE_VOICE_ABOUT + text.slice(end));
        about = true;
      }
    }
  } catch (error) {
    logger?.warn?.('studio-library-patch-about', { message: String(error?.message || error).slice(0, 120) });
  }

  return { patched: models || about, models, about };
}
