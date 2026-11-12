/**
 * The optional polish pass: the local model hears, the session model corrects.
 *
 * SenseVoice is strong on Chinese but not on this studio's product names, and a
 * talking-head script is exactly where a wrong name is expensive. So the transcript
 * is handed to the DSH model with its segment numbers, and only the *text* comes
 * back: the timings stay ours. That is the whole contract — if the reply is not a
 * list of exactly the same length, it is discarded and the raw transcript stands,
 * because a shifted list would silently move every subtitle.
 */

const MAX_REFINE_SEGMENTS = 400;

export function buildRefinePrompt(segments) {
  const lines = segments.map((segment, index) => (index + 1) + '. ' + segment.text);
  return [
    '下面是一段口播视频的语音识别结果，每行一个编号。',
    '只修正明显的同音错别字、专有名词和标点；不要改写语气，不要合并或删除句子，不要补充没有说过的内容。',
    '严格返回 JSON 字符串数组：长度必须等于 ' + segments.length + '，顺序与编号一致，只含修正后的句子，不要任何解释或 Markdown。',
    '',
    lines.join('\n'),
  ].join('\n');
}

/** Strict parse: a shorter or longer array is a wrong answer, not a partial one. */
export function parseRefineReply(reply, count) {
  if (typeof reply !== 'string' || typeof count !== 'number' || count <= 0) return null;
  const start = reply.indexOf('[');
  const end = reply.lastIndexOf(']');
  if (start < 0 || end <= start) return null;
  let parsed;
  try { parsed = JSON.parse(reply.slice(start, end + 1)); } catch { return null; }
  if (!Array.isArray(parsed) || parsed.length !== count) return null;
  if (!parsed.every(item => typeof item === 'string')) return null;
  return parsed.map(item => item.trim());
}

export async function refineTranscript({ ask, segments, signal, maxSegments = MAX_REFINE_SEGMENTS } = {}) {
  const list = Array.isArray(segments) ? segments : [];
  if (typeof ask !== 'function' || list.length === 0) {
    return { segments: list, refined: false, reason: typeof ask === 'function' ? 'empty' : 'unavailable' };
  }
  if (list.length > maxSegments) return { segments: list, refined: false, reason: 'too_long' };

  let reply;
  try {
    reply = await ask(buildRefinePrompt(list), signal);
  } catch {
    return { segments: list, refined: false, reason: 'failed' };
  }
  const parsed = parseRefineReply(reply, list.length);
  if (!parsed) return { segments: list, refined: false, reason: 'bad_reply' };

  const corrected = list.map((segment, index) => (parsed[index].length > 0 ? { ...segment, text: parsed[index] } : segment));
  const changed = corrected.filter((segment, index) => segment.text !== list[index].text).length;
  return { segments: corrected, refined: true, changed };
}

export const REFINE_REASONS = Object.freeze({
  unavailable: '没有可用的 DSH 模型，跳过校对',
  empty: '没有可校对的文本',
  too_long: '段数太多，跳过校对（避免一次超长请求）',
  failed: '校对请求失败，保留原始识别结果',
  bad_reply: '校对返回的格式不对，保留原始识别结果',
});
