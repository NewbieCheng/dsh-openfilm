export const MAX_SOURCE_BYTES = 2 * 1024 * 1024;

/** Decode one bounded Host byte response as data, never execute its markup. */
export function decodeFilmSource(value) {
  if (!value || !(value.data instanceof Uint8Array) || typeof value.eof !== 'boolean' || value.data.byteLength > MAX_SOURCE_BYTES) {
    throw new TypeError('Invalid film source response');
  }
  const text = new TextDecoder('utf-8', { fatal: value.eof }).decode(value.data);
  if (text.includes('\0')) throw new TypeError('film.html contains binary data');
  return { text, eof: value.eof, ...(typeof value.version === 'string' ? { version: value.version } : {}) };
}
