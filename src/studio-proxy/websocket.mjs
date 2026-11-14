// WebSocket framing for the pinned OpenFilm 0.3.2 protocol.
//
// The 0.3.1 server sends unfragmented JSON frames and ping controls only, so the
// parser is deliberately strict: anything else closes the socket instead of being
// guessed at (a half-parsed frame turns into a confusing UI bug later).
import { randomBytes } from 'node:crypto';

export const WS_GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';
export const MAX_FRAME = 1024 * 1024;

// The 0.3.1 server sends unfragmented JSON frames and ping controls. Reject
// unsupported extensions, fragmented frames, invalid masks and oversized frames.
export function wsFrame(opcode, payload, masked) {
  const size = payload.length;
  const length = size < 126 ? Buffer.from([size]) : size < 65536
    ? Buffer.from([126, size >>> 8, size & 255])
    : Buffer.from([127, 0, 0, 0, 0, (size >>> 24) & 255, (size >>> 16) & 255, (size >>> 8) & 255, size & 255]);
  if (!masked) return Buffer.concat([Buffer.from([0x80 | opcode]), length, payload]);
  length[0] |= 0x80;
  const mask = randomBytes(4);
  const copy = Buffer.from(payload);
  for (let i = 0; i < copy.length; i++) copy[i] ^= mask[i % 4];
  return Buffer.concat([Buffer.from([0x80 | opcode]), length, mask, copy]);
}
export function frames(socket, expectMask, onMessage, close) {
  let pending = Buffer.alloc(0);
  const receive = (chunk) => {
    if (pending.length + chunk.length > MAX_FRAME + 14) return close();
    pending = Buffer.concat([pending, chunk]);
    while (pending.length >= 2) {
      const first = pending[0], second = pending[1], opcode = first & 15;
      if ((first & 0xf0) !== 0x80 || Boolean(second & 0x80) !== expectMask) return close();
      let n = second & 127, offset = 2;
      if (n === 126) { if (pending.length < 4) return; n = pending.readUInt16BE(2); offset = 4; if (n < 126) return close(); }
      else if (n === 127) {
        if (pending.length < 10) return;
        const value = pending.readBigUInt64BE(2);
        if (value < 65536n || value > BigInt(MAX_FRAME)) return close();
        n = Number(value); offset = 10;
      }
      if (n > MAX_FRAME || (opcode >= 8 && n > 125)) return close();
      const maskOffset = offset;
      if (expectMask) offset += 4;
      if (pending.length < offset + n) return;
      const data = Buffer.from(pending.subarray(offset, offset + n));
      if (expectMask) for (let i = 0; i < n; i++) data[i] ^= pending[maskOffset + i % 4];
      pending = pending.subarray(offset + n);
      if (opcode === 8) return close();
      if (opcode === 9) { socket.write(wsFrame(10, data, !expectMask)); continue; }
      if (opcode === 10) continue;
      if (opcode !== 1) return close();
      onMessage(opcode, data);
      if (socket.destroyed) return;
    }
  };
  socket.on('data', receive);
  return receive;
}
