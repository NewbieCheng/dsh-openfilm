/**
 * `openfilm_clip`: the tool that actually changes the film on disk.
 *
 * Everything else in this Host only reads. This one writes film.html, so it is
 * built backwards from the failure it must never cause: clobbering an edit the
 * person made in Studio while the model was thinking. Hence, in order:
 *
 *   1. the baseline is identified by content hash, not by a timestamp alone —
 *      mtime has coarse resolution and a rewrite can keep it;
 *   2. the file is read twice, and the second read must still match, so a write
 *      that lands in the middle of our own read is detected rather than merged;
 *   3. the new text is produced by the same in-memory editor the draft tool uses,
 *      which patches clip tags in place and re-parses the result, so a change
 *      that cannot be expressed safely is refused instead of rewritten;
 *   4. it lands through write-to-temp + rename, so the film is never half-written;
 *   5. locked tracks are refused by the editor itself, not by a check here.
 *
 * A refusal always names what changed and the hash to retry from, because "conflict"
 * without a number is a dead end for the model.
 */
import { createHash } from 'node:crypto';
import { open, readFile, rename, stat, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { draftFilm } from './film-draft.mjs';
import { TimelineEditError } from './timeline-operations.mjs';

export const MAX_CLIP_BYTES = 2 * 1024 * 1024;
export const MAX_CLIP_OPERATIONS = 100;
const FILM = 'film.html';

const hashOf = bytes => createHash('sha256').update(bytes).digest('hex').slice(0, 16);
const show = value => (typeof value === 'number' && Number.isFinite(value) ? value : String(value ?? ''));

/** Read the film together with the identity used for conflict detection. */
async function readBaseline(path) {
  const before = await stat(path);
  if (!before.isFile()) throw Object.assign(new Error(`${FILM} is not a regular file`), { code: 'NOT_A_FILE' });
  if (before.size > MAX_CLIP_BYTES) throw Object.assign(new Error(`${FILM} 超过 2 MiB，拒绝读写`), { code: 'TOO_LARGE' });
  const bytes = await readFile(path);
  const after = await stat(path);
  if (after.size !== before.size || after.mtimeMs !== before.mtimeMs) {
    throw Object.assign(new Error(`${FILM} 正在被改写，这次没有动它；请重新读一遍再改`), { code: 'CHANGED_WHILE_READING' });
  }
  return { text: bytes.toString('utf8'), hash: hashOf(bytes), mtimeMs: Math.round(after.mtimeMs), size: after.size };
}

/** Write through a sibling temp file, then rename: a reader never sees half a film. */
async function writeAtomic(path, text) {
  const temp = `${path}.${process.pid}.${Date.now().toString(36)}.tmp`;
  let handle;
  try {
    handle = await open(temp, 'wx');
    await handle.writeFile(text, 'utf8');
    await handle.sync().catch(() => undefined);
    await handle.close();
    handle = undefined;
    await rename(temp, path);
  } catch (failure) {
    await handle?.close().catch(() => undefined);
    await unlink(temp).catch(() => undefined);
    throw failure;
  }
}

export function createClipTool({ isProjectAgent, projectOf }) {
  return {
    name: 'openfilm_clip',
    description: 'Change the timeline on disk: move, trim or split clips in the project\'s film.html, then save it atomically. Reads the current film first and refuses if it changed since your baseline (pass expect with the hash from a previous call when you have one). Locked tracks are refused. Unsaved work in Studio is overwritten by this write — prefer telling the person to save first, or use it when Studio is closed.',
    parameters: {
      type: 'object', additionalProperties: false, required: ['operations'],
      properties: {
        operations: {
          type: 'array', minItems: 1, maxItems: MAX_CLIP_OPERATIONS,
          description: 'In order, applied atomically. move uses film seconds; trim uses source seconds; split uses film seconds.',
          items: {
            type: 'object', additionalProperties: false, required: ['op', 'clip'],
            properties: {
              op: { type: 'string', enum: ['move', 'trim', 'split'] },
              clip: { type: 'string', description: 'Clip id.' },
              at: { type: 'number', minimum: 0, description: 'move: film seconds; split: film seconds.' },
              start: { type: 'number', minimum: 0, description: 'trim: source seconds.' },
              end: { type: 'number', minimum: 0, description: 'trim: source seconds.' },
              track: { type: 'integer', minimum: 0, description: 'move: destination track index.' },
              rightId: { type: 'string', description: 'split: id for the right-hand clip.' },
            },
          },
        },
        expect: {
          type: 'object', additionalProperties: false,
          description: 'The baseline you edited from. Omit on the first edit; pass the hash a previous call returned to chain edits safely.',
          properties: {
            hash: { type: 'string', description: 'sha256 prefix returned by openfilm_clip.' },
          },
        },
        dryRun: { type: 'boolean', description: 'Report what would change without saving.' },
      },
    },
    output: { schema: { type: 'object', additionalProperties: false, required: ['text'], properties: { text: { type: 'string' } } }, render: (_args, value) => [{ type: 'text', text: value?.text ?? '' }] },
    isConcurrencySafe: () => false,
    async execute(args, exec) {
      if (typeof isProjectAgent !== 'function' || isProjectAgent(exec?.agent) !== true) {
        throw new Error('This tool is available only to a conversation bound to an OpenFilm project.');
      }
      const project = projectOf?.(exec.agent);
      if (!project?.path) throw new Error('This conversation is not bound to an OpenFilm project.');
      const operations = Array.isArray(args?.operations) ? args.operations : [];
      if (operations.length === 0) throw new Error('At least one operation is required.');
      if (operations.length > MAX_CLIP_OPERATIONS) throw new Error(`At most ${MAX_CLIP_OPERATIONS} operations in one call.`);

      const path = join(project.path, FILM);
      let baseline;
      try { baseline = await readBaseline(path); } catch (failure) {
        if (failure?.code === 'ENOENT') throw new Error(`这个项目还没有 ${FILM}；先在 Studio 里建一个空草稿再改。`);
        throw new Error(String(failure?.message || failure));
      }

      const asked = typeof args?.expect?.hash === 'string' ? args.expect.hash.trim() : '';
      if (asked && asked !== baseline.hash) {
        throw new Error(`没有动文件：${FILM} 已经变了（现在是 ${baseline.hash}，你手上是 ${asked}）。重新读一遍，再按新的内容改。`);
      }

      let drafted;
      try {
        drafted = draftFilm({ source: baseline.text, operations });
      } catch (failure) {
        // The editor refuses what it cannot keep true (locked tracks, overlaps,
        // dependent state). Say its reason; do not dress it up as success.
        if (failure instanceof TimelineEditError) {
          throw new Error(`没有改动：${failure.kind === 'conflict' ? '冲突' : '这个编辑不成立'}——${failure.message}`);
        }
        throw new Error(`没有改动：${String(failure?.message || failure)}`);
      }

      if (drafted.text === baseline.text) return { text: '这几步操作没有改变影片（结果与原来一致），文件没动。' };

      const nextHash = hashOf(Buffer.from(drafted.text, 'utf8'));
      const bytesDelta = Buffer.byteLength(drafted.text, 'utf8') - baseline.size;
      const report = [
        `已${args?.dryRun === true ? '试算（未保存）' : '保存'}：${operations.length} 步`,
        `· 变化：${bytesDelta >= 0 ? '+' : ''}${bytesDelta} 字节`,
        `· 新基线：${args?.dryRun === true ? baseline.hash : nextHash}`,
      ];
      if (args?.dryRun === true) {
        return { text: `${report.join('\n')}\n（试算没有写盘；确定要保存就去掉 dryRun，并带上 expect.hash = ${baseline.hash}）` };
      }

      // Last look before the rename: if Studio (or a person) wrote while we were
      // drafting, drop this edit and say so. Its write is newer than ours.
      const again = await readFile(path).catch(() => null);
      if (!again || hashOf(again) !== baseline.hash) {
        throw new Error(`没有保存：${FILM} 在我准备写入的过程中被改动了。重新读一遍再改。`);
      }
      try {
        await writeAtomic(path, drafted.text);
      } catch (failure) {
        throw new Error(`保存失败：${String(failure?.message || failure)}`);
      }
      return { text: `${report.join('\n')}\n· 结构：${drafted.summary ? String(drafted.summary).slice(0, 600) : '已更新'}` };
    },
  };
}

/** Exported for tests: the conflict identity of a film file. */
export async function filmIdentity(path) {
  const bytes = await readFile(path);
  return { hash: hashOf(bytes), size: bytes.byteLength, show };
}
