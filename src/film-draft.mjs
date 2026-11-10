import { readFilmFile, readFilm, filmHtml } from '../vendor/film-doc.mjs';
import { applyTimelineOperations } from './timeline-operations.mjs';
import { summarizeFilm } from './film-summary.mjs';
import { MAX_SOURCE_BYTES } from './film-source.mjs';

const fail = (message, code = 'INVALID_FILM', extra = {}) => {
  throw Object.assign(new Error(message), { code, ...extra });
};
const parse = (text) => {
  let result;
  try { result = readFilmFile(text); } catch (cause) { fail('Invalid film.html', 'INVALID_FILM', { cause }); }
  if (!result.doc || !result.layout) fail('Invalid film.html', 'INVALID_FILM', { problems: result.problems });
  return result;
};
// Comparison ignores property order, but not array order or any value.
const canonical = (value) => Array.isArray(value) ? value.map(canonical)
  : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map(k => [k, canonical(value[k])])) : value;
const equal = (a, b) => JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));

// Locate attributes in a single opening tag without interpreting or executing HTML.
function attributes(text) {
  const head = /^<[a-zA-Z][\w-]*/.exec(text);
  if (!head) fail('Cannot safely locate clip tag', 'UNSAFE_FILM');
  const result = new Map();
  let i = head[0].length;
  while (i < text.length) {
    while (/\s/.test(text[i] ?? '')) i++;
    if (text[i] === '>' || (text[i] === '/' && text[i + 1] === '>')) break;
    const match = /^[^\s"'>/=]+/.exec(text.slice(i));
    if (!match) fail('Cannot safely locate clip attributes', 'UNSAFE_FILM');
    const start = i, name = match[0].toLowerCase();
    i += match[0].length;
    let next = i;
    while (/\s/.test(text[next] ?? '')) next++;
    if (text[next] === '=') {
      i = next + 1;
      while (/\s/.test(text[i] ?? '')) i++;
      const quote = text[i];
      if (quote === '"' || quote === "'") {
        const end = text.indexOf(quote, i + 1);
        if (end < 0) fail('Unclosed clip attribute', 'UNSAFE_FILM');
        i = end + 1;
      } else {
        const value = /^[^\s>]*/.exec(text.slice(i))[0];
        i += value.length;
      }
    }
    if (result.has(name)) fail(`Duplicate clip attribute: ${name}`, 'UNSAFE_FILM');
    result.set(name, { start, end: i, text: text.slice(start, i) });
  }
  if (i >= text.length) fail('Unclosed clip tag', 'UNSAFE_FILM');
  return { attrs: result, end: i };
}

function patchClip(original, generated, oldClip, newClip) {
  const old = attributes(original), fresh = attributes(generated);
  const edits = [];
  for (const [field, attr] of [['at', 'at'], ['time', 'src']]) {
    if (equal(oldClip[field], newClip[field])) continue;
    const before = old.attrs.get(attr), after = fresh.attrs.get(attr);
    if (before) edits.push({ start: before.start, end: before.end, text: after?.text ?? '' });
    else if (after) edits.push({ start: old.end, end: old.end, text: ` ${after.text}` });
    else fail(`Cannot safely rewrite ${attr}`, 'UNSAFE_FILM');
  }
  for (const edit of edits.sort((a, b) => b.start - a.start)) {
    original = original.slice(0, edit.start) + edit.text + original.slice(edit.end);
  }
  return original;
}

/**
 * Edit a film source in memory only. Input is { source: string, operations: [...] };
 * operations are those accepted by applyTimelineOperations. Returns { text, summary }.
 * Throws on invalid source, unsupported/conflicting edits, or an unsafe round trip.
 */
export function draftFilm({ source, operations } = {}) {
  if (typeof source !== 'string') fail('source must be a film.html string');
  if (new TextEncoder().encode(source).byteLength > MAX_SOURCE_BYTES) fail('source exceeds 2 MiB', 'SOURCE_TOO_LARGE');
  if (source.includes('\0')) fail('source contains binary data');
  const before = parse(source);
  const value = applyTimelineOperations(before.value, operations);
  const expected = readFilm(structuredClone(value));
  if (!expected.doc) fail('Edited film is invalid', 'INVALID_FILM', { problems: expected.problems });
  let generated;
  try { generated = filmHtml(value, source); } catch (cause) { fail('Cannot serialize edited film', 'UNSAFE_FILM', { cause }); }
  const rendered = parse(generated);
  if (!equal(rendered.doc, expected.doc)) fail('Serialized film does not match the edit', 'UNSAFE_FILM');

  const originals = new Map();
  before.doc.tracks.forEach((track, ti) => track.clips.forEach((clip, ci) => {
    const place = before.layout.tracks[ti].clips[ci];
    originals.set(clip.id, { clip, text: source.slice(place.start, place.end) });
  }));
  const texts = rendered.doc.tracks.map((track, ti) => track.clips.map((clip, ci) => {
    const place = rendered.layout.tracks[ti].clips[ci];
    const renderedText = generated.slice(place.start, place.end);
    const previous = originals.get(clip.id);
    return previous ? patchClip(previous.text, renderedText, previous.clip, clip) : renderedText;
  }));
  const edits = [];
  before.layout.tracks.forEach((track, ti) => {
    const desired = texts[ti];
    track.clips.forEach((place, ci) => edits.push({ start: place.start, end: place.end, text: desired[ci] ?? '' }));
    if (desired.length > track.clips.length) {
      const at = track.clips.length ? track.clips.at(-1).end : track.close.start;
      edits.push({ start: at, end: at, text: `${track.clips.length ? '\n' : ''}${desired.slice(track.clips.length).join('\n')}\n` });
    }
  });
  // On equal offsets insertions precede replacements, so a replacement cannot eat an insertion.
  edits.sort((a, b) => b.start - a.start || b.end - a.end);
  let text = source;
  for (const edit of edits) text = text.slice(0, edit.start) + edit.text + text.slice(edit.end);
  const checked = parse(text);
  if (!equal(checked.doc, expected.doc)) fail('Preserved source does not match the edit', 'UNSAFE_FILM');
  return { text, summary: summarizeFilm(text) };
}
