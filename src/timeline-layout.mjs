// Fixed upper bounds keep both output size and work predictable, even when callers
// supply their own limits. No source URLs or media objects are used by this module.
const MAX_TRACKS = 100;
const MAX_CLIPS_PER_TRACK = 200;

const nonNegative = value => typeof value === 'number' && Number.isFinite(value) && value >= 0;
const limit = (value, max) => Number.isSafeInteger(value) && value >= 0 ? Math.min(value, max) : max;
const percent = (value, duration) => Math.min(1, value / duration) * 100;

/**
 * Build a read-only view model from summarizeFilm's result (seconds).
 *
 * @param {object|null} summary Film summary, not HTML or a path.
 * @param {{maxTracks?: number, maxClipsPerTrack?: number}} [options]
 * @returns {{duration: number|null, durationStatus: 'known'|'unknown', scaleStatus: 'known'|'unknown'|'zero', tracks: object[], truncated: boolean, omittedTracks: number}}
 *
 * Percentages are numbers in [0,100], or null when they cannot be calculated.
 * A zero duration is known, but has no usable scale. An unknown clip may still
 * have a known leftPercent if its start and the film scale are known. Clip bars
 * are clipped to the known film range; out-of-range input never creates NaN or
 * an overflow. Missing/invalid durations are unknown, not inferred from clips.
 * Track and clip order is preserved, including disabled clips. `truncated` is
 * true when tracks or clips were omitted; each track reports `omittedClips`.
 * Limits default to, and cannot exceed, 100 tracks and 200 clips per track.
 * The input is never mutated and the result does not contain media sources.
 */
export function layoutTimeline(summary, options = {}) {
  const duration = nonNegative(summary?.duration) ? summary.duration : null;
  const durationStatus = duration === null ? 'unknown' : 'known';
  const scaleStatus = duration === null ? 'unknown' : duration === 0 ? 'zero' : 'known';
  const sourceTracks = Array.isArray(summary?.tracks) ? summary.tracks : [];
  const maxTracks = limit(options?.maxTracks, MAX_TRACKS);
  const maxClips = limit(options?.maxClipsPerTrack, MAX_CLIPS_PER_TRACK);
  const omittedTracks = Math.max(0, sourceTracks.length - maxTracks);
  const tracks = Array.from(sourceTracks.slice(0, maxTracks), (track, index) => {
    const sourceClips = Array.isArray(track?.clips) ? track.clips : [];
    const omittedClips = Math.max(0, sourceClips.length - maxClips);
    const clips = Array.from(sourceClips.slice(0, maxClips), (clip, clipIndex) => {
      const at = nonNegative(clip?.at) ? clip.at : null;
      const validEnd = nonNegative(clip?.end) && at !== null && clip.end >= at;
      const clipDuration = nonNegative(clip?.duration) && validEnd ? clip.duration : null;
      const leftPercent = scaleStatus === 'known' && at !== null ? percent(at, duration) : null;
      const widthPercent = leftPercent !== null && clipDuration !== null
        ? Math.max(0, percent(clip.end, duration) - leftPercent) : null;
      return {
        index: clipIndex,
        id: typeof clip?.id === 'string' ? clip.id : null,
        kind: typeof clip?.kind === 'string' ? clip.kind : null,
        disabled: clip?.disabled === true,
        at,
        duration: clipDuration,
        durationStatus: clipDuration === null ? 'unknown' : 'known',
        leftPercent,
        widthPercent,
      };
    });
    return {
      index,
      locked: track?.locked === true,
      hidden: track?.hidden === true,
      muted: track?.muted === true,
      clips,
      omittedClips,
      truncated: omittedClips > 0,
    };
  });
  return {
    duration, durationStatus, scaleStatus, tracks, omittedTracks,
    truncated: omittedTracks > 0 || tracks.some(track => track.truncated),
  };
}
