import { readFilmFile, clipSpan, clipSpeed, kindOf } from '../vendor/film-doc.mjs';

/**
 * Summarize the contents of film.html without executing it or opening any source.
 * Times are seconds. A null duration/end means that source metadata is needed (or
 * that a still/page needs an explicit end); it is never replaced by a guess.
 * Invalid film markup throws INVALID_FILM with the upstream problems when available.
 * Track and clip order are the order in the film, including disabled clips.
 *
 * @param {string} text film.html contents, not a path
 * @returns {{stage: {w: number, h: number}, duration: number|null, tracks: object[], diagnostics: object[]}}
 */
export function summarizeFilm(text) {
  if (typeof text !== 'string') {
    throw Object.assign(new TypeError('film.html contents must be a string'), { code: 'INVALID_FILM' });
  }
  let parsed;
  try {
    parsed = readFilmFile(text);
  } catch (cause) {
    throw Object.assign(new Error('Invalid film.html', { cause }), { code: 'INVALID_FILM' });
  }
  if (!parsed.doc) {
    throw Object.assign(new Error('Invalid film.html'), { code: 'INVALID_FILM', problems: parsed.problems });
  }

  const diagnostics = [];
  let duration = 0;
  let unknown = false;
  const tracks = parsed.doc.tracks.map((track, trackIndex) => ({
    index: trackIndex,
    locked: track.locked === true,
    hidden: track.hidden === true,
    muted: track.muted === true,
    ...(track.attrs ? { attrs: { ...track.attrs } } : {}),
    ...(track.captions ? { captions: { ...track.captions } } : {}),
    clips: track.clips.map((clip, clipIndex) => {
      const kind = kindOf(clip);
      const at = clip.at ?? 0;
      let span = null;
      if (clip.time?.length === 2) {
        try {
          span = clipSpan(clip, undefined, `tracks[${trackIndex}].clips[${clipIndex}]`);
        } catch (cause) {
          throw Object.assign(new Error('Invalid film clip', { cause }), { code: 'INVALID_FILM', problems: [cause.message] });
        }
      } else {
        diagnostics.push({ code: 'DURATION_UNKNOWN', trackIndex, clipIndex, clipId: clip.id,
          message: kind === 'still' ? 'Still requires an explicit end time.' : 'Duration cannot be determined from film.html alone.' });
        unknown = true;
      }
      const end = span === null ? null : at + span.length;
      if (end !== null) duration = Math.max(duration, end);
      return {
        id: clip.id, src: clip.src, kind, at,
        disabled: clip.disabled === true,
        time: clip.time ? [...clip.time] : null,
        speed: clipSpeed(clip), duration: span?.length ?? null, end,
        ...(clip.box ? { box: { ...clip.box } } : {}),
        ...(clip.size ? { size: { ...clip.size } } : {}),
      };
    }),
  }));
  return { stage: { ...parsed.doc.stage }, duration: unknown ? null : duration, tracks, diagnostics };
}
