/**
 * Reading back the PCM that ffmpeg wrote, without ever holding the file.
 *
 * A three-hour talk is ~345 MB of 16 kHz mono — small next to the source video,
 * but still not something to put in the heap beside the model. So the reader
 * opens the file once and serves `count` samples at a time from a file offset;
 * the recognizer and the VAD only ever see one segment's worth.
 */
import { open, readFile, stat } from 'node:fs/promises';

const PCM = 1;
const FLOAT = 3;

const bad = (message, code = 'BAD_WAV') => Object.assign(new Error(message), { code });
const tag = (view, offset) => String.fromCharCode(view.getUint8(offset), view.getUint8(offset + 1), view.getUint8(offset + 2), view.getUint8(offset + 3));

/**
 * Parse a RIFF/WAVE header. Tolerates the extra chunks ffmpeg likes to write
 * (LIST, fact) by walking them instead of assuming a 44-byte layout.
 */
export function parseWavHeader(bytes) {
  const buffer = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes);
  if (buffer.length < 44) throw bad('音频文件头不完整');
  const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  if (tag(view, 0) !== 'RIFF' || tag(view, 8) !== 'WAVE') throw bad('不是 WAV 文件');

  let format = 0;
  let channels = 0;
  let sampleRate = 0;
  let bitsPerSample = 0;
  let dataOffset = -1;
  let dataBytes = -1;

  let offset = 12;
  while (offset + 8 <= buffer.length) {
    const id = tag(view, offset);
    const size = view.getUint32(offset + 4, true);
    const body = offset + 8;
    if (id === 'fmt ') {
      format = view.getUint16(body, true);
      channels = view.getUint16(body + 2, true);
      sampleRate = view.getUint32(body + 4, true);
      bitsPerSample = view.getUint16(body + 14, true);
    } else if (id === 'data') {
      dataOffset = body;
      dataBytes = size === 0xffffffff ? buffer.length - body : size;
      break;
    }
    offset = body + size + (size % 2);
  }

  if (!channels || !sampleRate) throw bad('WAV 缺少 fmt 块');
  if (dataOffset < 0) throw bad('WAV 缺少 data 块');
  if (format !== PCM && format !== FLOAT) throw bad(`不支持的 WAV 编码（format ${format}）`, 'UNSUPPORTED_CODEC');
  const bytesPerSample = bitsPerSample / 8;
  if (format === PCM && bitsPerSample !== 16) throw bad(`只接受 16 位 PCM，收到 ${bitsPerSample} 位`, 'UNSUPPORTED_CODEC');
  if (format === FLOAT && bitsPerSample !== 32) throw bad(`只接受 32 位浮点，收到 ${bitsPerSample} 位`, 'UNSUPPORTED_CODEC');

  return {
    format, channels, sampleRate, bitsPerSample, dataOffset, dataBytes,
    sampleCount: Math.floor(dataBytes / (bytesPerSample * channels)),
    durationSec: dataBytes / (bytesPerSample * channels) / sampleRate,
  };
}

/**
 * Open a wav for windowed reads. Mono or multi-channel, but multi-channel is
 * down-mixed to mono here so the recognizer has exactly one contract.
 */
export async function openWav(path) {
  const info = await stat(path);
  if (!info.isFile()) throw bad(`${path} 不是文件`, 'NOT_A_FILE');
  const handle = await open(path, 'r');
  let header;
  try {
    const head = Buffer.alloc(Math.min(info.size, 65536));
    await handle.read(head, 0, head.length, 0);
    header = parseWavHeader(head);
  } catch (failure) {
    await handle.close().catch(() => undefined);
    throw failure;
  }
  const { sampleRate, channels, bitsPerSample, dataOffset, sampleCount } = header;
  const bytesPerSample = bitsPerSample / 8;
  const isFloat = header.format === FLOAT;
  let closed = false;

  return {
    path,
    sampleRate,
    channels,
    durationSec: sampleCount / sampleRate,
    sampleCount,
    async read(startSample, count) {
      if (closed) throw bad('读取器已关闭', 'CLOSED');
      const from = Math.max(0, Math.min(sampleCount, Math.floor(startSample)));
      const want = Math.max(0, Math.min(sampleCount - from, Math.floor(count)));
      if (want === 0) return new Float32Array(0);
      const frameBytes = bytesPerSample * channels;
      const buffer = Buffer.alloc(want * frameBytes);
      // A truncated file must yield a shorter window, never silent padding: zeros
      // would be transcribed as noise or, worse, as a hallucinated sentence.
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, dataOffset + from * frameBytes);
      const frames = Math.floor(bytesRead / frameBytes);
      const out = new Float32Array(frames);
      const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
      for (let index = 0; index < frames; index += 1) {
        let sum = 0;
        for (let channel = 0; channel < channels; channel += 1) {
          const at = (index * channels + channel) * bytesPerSample;
          sum += isFloat ? view.getFloat32(at, true) : view.getInt16(at, true) / 32768;
        }
        out[index] = sum / channels;
      }
      return out;
    },
    async close() {
      if (closed) return;
      closed = true;
      await handle.close().catch(() => undefined);
    },
  };
}
