// Packs named sprite surfaces into one power-of-two atlas.

import { SPRITE_SIZES, SPRITE_NAMES } from '../../config.js';

const ATLAS_SIZES = [[1024, 1024], [2048, 1024], [2048, 2048]];
const PAD = 1;

// Shelf packer: frames sorted tallest first, rows filled left to right. Every frame keeps
// PAD transparent pixels on all sides. Returns null when the frames do not fit.
function shelfPack(names, aw, ah) {
  const rects = {};
  let x = PAD, y = PAD, rowH = 0;
  for (const name of names) {
    const { w, h } = SPRITE_SIZES[name];
    if (x + w + PAD > aw) {
      x = PAD;
      y += rowH + PAD;
      rowH = 0;
    }
    if (x + w + PAD > aw || y + h + PAD > ah) return null;
    rects[name] = { x, y, w, h };
    x += w + PAD;
    if (h > rowH) rowH = h;
  }
  return rects;
}

// surfaces: { [frameName]: { w, h, data } } -> { atlas: { w, h, data }, frames: { [name]: { x, y, w, h } } }
// Throws when a frame of SPRITE_SIZES is missing or has the wrong size. Names that are not in
// SPRITE_SIZES are left out. Alpha is forced to 0 or 255.
export function packAtlas(surfaces) {
  const problems = [];
  for (const name of SPRITE_NAMES) {
    const s = surfaces[name], want = SPRITE_SIZES[name];
    if (!s) problems.push(`${name}: missing`);
    else if (s.w !== want.w || s.h !== want.h) problems.push(`${name}: is ${s.w}x${s.h}, expected ${want.w}x${want.h}`);
    else if (!s.data || s.data.length !== s.w * s.h * 4) problems.push(`${name}: data length does not match ${s.w}x${s.h}`);
  }
  if (problems.length) {
    throw new Error(`sprites: ${problems.length} frame(s) do not match SPRITE_SIZES:\n  ${problems.join('\n  ')}`);
  }
  const extra = Object.keys(surfaces).filter((name) => !SPRITE_SIZES[name]);
  if (extra.length) console.warn(`sprites: ignoring frames that are not in SPRITE_SIZES: ${extra.join(', ')}`);

  const order = [...SPRITE_NAMES].sort((a, b) => {
    const p = SPRITE_SIZES[a], q = SPRITE_SIZES[b];
    return q.h - p.h || q.w - p.w || (a < b ? -1 : 1);
  });
  let frames = null, aw = 0, ah = 0;
  for ([aw, ah] of ATLAS_SIZES) {
    frames = shelfPack(order, aw, ah);
    if (frames) break;
  }
  if (!frames) throw new Error('sprites: frames do not fit a 2048x2048 atlas');

  const data = new Uint8ClampedArray(aw * ah * 4);
  for (const name of SPRITE_NAMES) {
    const src = surfaces[name].data, r = frames[name];
    for (let y = 0; y < r.h; y++) {
      let i = y * r.w * 4, o = ((r.y + y) * aw + r.x) * 4;
      for (let x = 0; x < r.w; x++, i += 4, o += 4) {
        if (src[i + 3] < 128) continue;
        data[o] = src[i];
        data[o + 1] = src[i + 1];
        data[o + 2] = src[i + 2];
        data[o + 3] = 255;
      }
    }
  }
  return { atlas: { w: aw, h: ah, data }, frames };
}
