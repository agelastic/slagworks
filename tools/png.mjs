// PNG read/write for RGBA pixel buffers, no dependencies.
//
//   encodePNG(rgba, w, h) -> Buffer
//   writePNG(path, surface)            surface = { w, h, data }
//   writePNG(path, rgba, w, h)         creates parent directories
//   decodePNG(buffer) -> { w, h, data: Uint8ClampedArray }   8-bit RGB/RGBA/grey, non-interlaced
//   readPNG(path) -> surface
//   upscale(surface, n) -> surface     nearest-neighbour
//   onChecker(surface, cell = 8) -> surface   composite over a mid-grey checker (shows transparency)

import zlib from 'node:zlib';
import fs from 'node:fs';
import path from 'node:path';
import { upscale, createSurface, blit } from '../src/core/pix.js';

export { upscale };

const CRC = new Uint32Array(256);
for (let n = 0; n < 256; n++) {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  CRC[n] = c >>> 0;
}

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC[(c ^ buf[i]) & 255] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, body) {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(body.length, 0);
  head.write(type, 4, 'latin1');
  const tail = Buffer.alloc(4);
  tail.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), body])), 0);
  return Buffer.concat([head, body, tail]);
}

const SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

export function encodePNG(rgba, w, h) {
  if (rgba.length !== w * h * 4) throw new Error(`encodePNG: expected ${w * h * 4} bytes for ${w}x${h}, got ${rgba.length}`);
  const stride = w * 4;
  const raw = Buffer.alloc((stride + 1) * h);
  const src = Buffer.from(rgba.buffer, rgba.byteOffset, rgba.length);
  for (let y = 0; y < h; y++) src.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;  // bit depth
  ihdr[9] = 6;  // RGBA
  return Buffer.concat([
    SIGNATURE,
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 6 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

export function writePNG(file, surfaceOrRgba, w, h) {
  const s = surfaceOrRgba.data ? surfaceOrRgba : { data: surfaceOrRgba, w, h };
  fs.mkdirSync(path.dirname(path.resolve(file)), { recursive: true });
  fs.writeFileSync(file, encodePNG(s.data, s.w, s.h));
  return file;
}

export function decodePNG(buf) {
  if (!buf.subarray(0, 8).equals(SIGNATURE)) throw new Error('decodePNG: not a PNG');
  let w = 0, h = 0, depth = 0, type = 0, interlace = 0;
  const idat = [];
  for (let p = 8; p < buf.length;) {
    const len = buf.readUInt32BE(p), kind = buf.toString('latin1', p + 4, p + 8);
    const body = buf.subarray(p + 8, p + 8 + len);
    if (kind === 'IHDR') {
      w = body.readUInt32BE(0); h = body.readUInt32BE(4);
      depth = body[8]; type = body[9]; interlace = body[12];
    } else if (kind === 'IDAT') idat.push(body);
    else if (kind === 'IEND') break;
    p += 12 + len;
  }
  const ch = { 0: 1, 2: 3, 4: 2, 6: 4 }[type];
  if (depth !== 8 || !ch || interlace) throw new Error(`decodePNG: unsupported format (depth ${depth}, type ${type}, interlace ${interlace})`);
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const stride = w * ch;
  const px = Buffer.alloc(stride * h);
  for (let y = 0; y < h; y++) {
    const f = raw[y * (stride + 1)];
    const row = y * stride, src = y * (stride + 1) + 1;
    for (let i = 0; i < stride; i++) {
      const a = i >= ch ? px[row + i - ch] : 0;
      const b = y > 0 ? px[row - stride + i] : 0;
      const c = i >= ch && y > 0 ? px[row - stride + i - ch] : 0;
      let v = raw[src + i];
      if (f === 1) v += a;
      else if (f === 2) v += b;
      else if (f === 3) v += (a + b) >> 1;
      else if (f === 4) {
        const pa = Math.abs(b - c), pb = Math.abs(a - c), pc = Math.abs(a + b - 2 * c);
        v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      }
      px[row + i] = v;
    }
  }
  const data = new Uint8ClampedArray(w * h * 4);
  for (let i = 0, o = 0; i < w * h; i++, o += 4) {
    const k = i * ch;
    if (ch >= 3) { data[o] = px[k]; data[o + 1] = px[k + 1]; data[o + 2] = px[k + 2]; }
    else data[o] = data[o + 1] = data[o + 2] = px[k];
    data[o + 3] = ch === 4 ? px[k + 3] : ch === 2 ? px[k + 1] : 255;
  }
  return { w, h, data };
}

export function readPNG(file) {
  return decodePNG(fs.readFileSync(file));
}

export function onChecker(s, cell = 8) {
  const out = createSurface(s.w, s.h);
  const d = out.data;
  for (let y = 0, i = 0; y < s.h; y++) {
    for (let x = 0; x < s.w; x++, i += 4) {
      const v = (Math.floor(x / cell) + Math.floor(y / cell)) & 1 ? 112 : 136;
      d[i] = d[i + 1] = d[i + 2] = v;
      d[i + 3] = 255;
    }
  }
  return blit(out, s, 0, 0);
}
