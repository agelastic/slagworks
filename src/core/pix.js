// pix: RGBA pixel surfaces and drawing primitives. Pure JS, no DOM. Works in Node and browsers.
//
// SURFACE
//   { w, h, data: Uint8ClampedArray(w*h*4), wrap: false, atop: false }
//   surface.wrap = true   coordinates wrap around both axes in every primitive (tileable textures)
//   surface.atop = true   primitives only touch pixels that are already opaque (shade inside a silhouette)
//   createSurface(w, h, fill = null, wrap = false)
//   clone(s)   clear(s, color = transparent)
//
// COORDINATES
//   Integer (x, y) is a pixel, (0, 0) top-left. Rects cover x .. x+w-1. Circle and ellipse centres
//   may be fractional: use .5 centres for shapes that must be symmetric on an even-sized surface
//   (fillCircle(s, 31.5, 31.5, 10, c) on 64 x 64).
//
// COLOURS
//   Anywhere a colour is taken you can pass [r, g, b], [r, g, b, a], '#rgb', '#rrggbb', '#rrggbbaa'
//   or 0xRRGGBB. Channels are 0..255. Drawing with alpha < 255 blends over what is there
//   (source-over); alpha 0 draws nothing. shade() writes raw values and can erase.
//   rgb(r, g, b, a = 255)        hex('#ffae1a')        toColor(any) -> fresh [r, g, b, a]
//   mix(a, b, t)                 lighten(c, t)         darken(c, t)          (t in 0..1)
//   scaleColor(c, f)             multiply rgb by f, clamped
//   withAlpha(c, a)              hsl(hDeg, s, l, a = 255)
//   ramp(stops, t)               gradient lookup through evenly spaced colours, t in 0..1
//
// PIXELS AND SHAPES            (all return the surface unless noted)
//   setPx(s, x, y, c)            getPx(s, x, y) -> [r, g, b, a]   (out of bounds: [0, 0, 0, 0])
//   fillRect(s, x, y, w, h, c)   strokeRect(s, x, y, w, h, c)
//   bevel(s, x, y, w, h, light, dark)      1 px light top/left edge, dark bottom/right edge
//   gradRect(s, x, y, w, h, stops, dir = 'v', dither = false)   dir 'v' | 'h'; dither = hard
//                                           palette steps with an ordered-dither transition
//   line(s, x0, y0, x1, y1, c, thickness = 1)
//   fillCircle(s, cx, cy, r, c)            strokeCircle(s, cx, cy, r, c)
//   fillEllipse(s, cx, cy, rx, ry, c)      strokeEllipse(s, cx, cy, rx, ry, c)
//   fillPoly(s, [[x, y], ...], c)          strokePoly(s, points, c, closed = true)
//
// WHOLE-SURFACE HELPERS
//   blit(dst, src, dx, dy, { flipX, flipY, tint, alpha, sx, sy, sw, sh })
//                                tint multiplies rgb; sx..sh pick a source rect
//   shade(s, (x, y, [r, g, b, a]) => colour | null)     per-pixel map, null keeps the pixel
//   outline(s, c = '#0c0c10', diagonal = false)         1 px outline on transparent pixels that
//                                touch opaque ones (leave a 1 px margin in the frame for it)
//   hardenAlpha(s, cutoff = 128)                        alpha -> 0 or 255 (sprites need this)
//   mirrorX(s)                   copy the left half onto the right half, mirrored
//   shift(s, dx, dy) -> new      wrap-around scroll (seam checks, animated flats)
//   upscale(s, n) -> new         nearest-neighbour
//
// DITHER AND PALETTE
//   bayer(x, y) -> 0..1          4 x 4 ordered threshold
//   ditherPick(x, y, t) -> bool  true for a fraction t of pixels, in the ordered pattern
//   posterize(s, levels = 4, dither = true)             per-channel quantise
//   toPalette(s, palette, dither = 0)                   snap opaque pixels to the nearest palette
//                                colour; dither 0..1 adds ordered noise before snapping
//
// NOISE                          (all return 0..1, deterministic per seed)
//   hash2(ix, iy, seed = 0)      per-integer-cell random
//   valueNoise(x, y, seed = 0)   smooth lattice noise, one feature per unit
//   valueNoiseTile(x, y, px, py, seed = 0)              repeats every px, py units (integers)
//   fbm(x, y, seed = 0, octaves = 4, gain = 0.5)
//   fbmTile(x, y, px, py, seed = 0, octaves = 4, gain = 0.5)
//   noiseMap(w, h, { seed = 0, cells = 4, octaves = 4, gain = 0.5, tile = true, normalize = true })
//       -> Float32Array(w*h), index y*w+x. cells = lattice cells across the width at the base
//          octave. With tile = true the map wraps seamlessly in x and y.
//   Tileable 64 x 64 example:  fbmTile(x / 16, y / 16, 4, 4, seed)
//
// TEXT                           built-in 5 px tall font: A-Z 0-9 . , : ! ? - + / % # ( ) [ ] ' = < > * _
//   drawText(s, text, x, y, c, scale = 1) -> width in px   (x, y = top-left; '\n' starts a new line)
//   textWidth(text, scale = 1)   TEXT_HEIGHT = 5

// ---------------------------------------------------------------- colours

const hexCache = new Map();

function parseHex(str) {
  let h = str[0] === '#' ? str.slice(1) : str;
  if (h.length === 3 || h.length === 4) h = [...h].map((ch) => ch + ch).join('');
  const n = parseInt(h, 16);
  if (Number.isNaN(n) || (h.length !== 6 && h.length !== 8)) throw new Error(`pix: bad colour "${str}"`);
  return h.length === 8
    ? [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255]
    : [(n >>> 16) & 255, (n >>> 8) & 255, n & 255, 255];
}

// Internal: any colour form -> [r, g, b, a]. May return a shared array; never mutate the result.
function col(c) {
  if (typeof c === 'string') {
    let v = hexCache.get(c);
    if (!v) hexCache.set(c, (v = parseHex(c)));
    return v;
  }
  if (typeof c === 'number') return [(c >>> 16) & 255, (c >>> 8) & 255, c & 255, 255];
  if (c.length === 3) return [c[0], c[1], c[2], 255];
  return c;
}

export function rgb(r, g, b, a = 255) {
  return [r, g, b, a];
}

export function hex(str) {
  return col(str).slice();
}

export function toColor(c) {
  const v = col(c);
  return [v[0], v[1], v[2], v[3]];
}

export function mix(a, b, t) {
  const p = col(a), q = col(b);
  return [
    p[0] + (q[0] - p[0]) * t,
    p[1] + (q[1] - p[1]) * t,
    p[2] + (q[2] - p[2]) * t,
    p[3] + (q[3] - p[3]) * t,
  ];
}

export function lighten(c, t) {
  const p = col(c);
  return [p[0] + (255 - p[0]) * t, p[1] + (255 - p[1]) * t, p[2] + (255 - p[2]) * t, p[3]];
}

export function darken(c, t) {
  const p = col(c);
  return [p[0] * (1 - t), p[1] * (1 - t), p[2] * (1 - t), p[3]];
}

export function scaleColor(c, f) {
  const p = col(c);
  return [Math.min(255, p[0] * f), Math.min(255, p[1] * f), Math.min(255, p[2] * f), p[3]];
}

export function withAlpha(c, a) {
  const p = col(c);
  return [p[0], p[1], p[2], a];
}

export function hsl(h, s, l, a = 255) {
  h = (((h % 360) + 360) % 360) / 60;
  const ch = (1 - Math.abs(2 * l - 1)) * s;
  const x = ch * (1 - Math.abs((h % 2) - 1));
  const m = l - ch / 2;
  const [r, g, b] = h < 1 ? [ch, x, 0] : h < 2 ? [x, ch, 0] : h < 3 ? [0, ch, x]
    : h < 4 ? [0, x, ch] : h < 5 ? [x, 0, ch] : [ch, 0, x];
  return [(r + m) * 255, (g + m) * 255, (b + m) * 255, a];
}

export function ramp(stops, t) {
  const n = stops.length - 1;
  if (t <= 0 || n === 0) return toColor(stops[0]);
  if (t >= 1) return toColor(stops[n]);
  const f = t * n, i = Math.floor(f);
  return mix(stops[i], stops[i + 1], f - i);
}

// ---------------------------------------------------------------- surface

export function createSurface(w, h, fill = null, wrap = false) {
  const s = { w, h, data: new Uint8ClampedArray(w * h * 4), wrap, atop: false };
  if (fill != null) clear(s, fill);
  return s;
}

export function clone(s) {
  return { w: s.w, h: s.h, data: new Uint8ClampedArray(s.data), wrap: s.wrap, atop: s.atop };
}

export function clear(s, c = null) {
  const d = s.data;
  if (c == null) {
    d.fill(0);
    return s;
  }
  const [r, g, b, a] = col(c);
  for (let i = 0; i < d.length; i += 4) {
    d[i] = r; d[i + 1] = g; d[i + 2] = b; d[i + 3] = a;
  }
  return s;
}

// Blend one pixel. x, y must be integers.
function put(s, x, y, r, g, b, a) {
  if (a <= 0) return;
  const w = s.w, h = s.h;
  if (s.wrap) {
    x = ((x % w) + w) % w;
    y = ((y % h) + h) % h;
  } else if (x < 0 || y < 0 || x >= w || y >= h) return;
  const d = s.data, i = (y * w + x) * 4;
  const da = d[i + 3];
  if (da === 0) {
    if (s.atop) return;
    d[i] = r; d[i + 1] = g; d[i + 2] = b; d[i + 3] = a;
    return;
  }
  if (a >= 255) {
    d[i] = r; d[i + 1] = g; d[i + 2] = b; d[i + 3] = 255;
    return;
  }
  const t = a / 255;
  if (da === 255) {
    d[i] += (r - d[i]) * t;
    d[i + 1] += (g - d[i + 1]) * t;
    d[i + 2] += (b - d[i + 2]) * t;
    return;
  }
  const u = (da / 255) * (1 - t), oa = t + u;
  d[i] = (r * t + d[i] * u) / oa;
  d[i + 1] = (g * t + d[i + 1] * u) / oa;
  d[i + 2] = (b * t + d[i + 2] * u) / oa;
  d[i + 3] = oa * 255;
}

export function setPx(s, x, y, c) {
  const v = col(c);
  put(s, Math.round(x), Math.round(y), v[0], v[1], v[2], v[3]);
  return s;
}

export function getPx(s, x, y) {
  x = Math.round(x);
  y = Math.round(y);
  const w = s.w, h = s.h;
  if (s.wrap) {
    x = ((x % w) + w) % w;
    y = ((y % h) + h) % h;
  } else if (x < 0 || y < 0 || x >= w || y >= h) return [0, 0, 0, 0];
  const d = s.data, i = (y * w + x) * 4;
  return [d[i], d[i + 1], d[i + 2], d[i + 3]];
}

// ---------------------------------------------------------------- shapes

export function fillRect(s, x, y, w, h, c) {
  const [r, g, b, a] = col(c);
  x = Math.round(x); y = Math.round(y); w = Math.round(w); h = Math.round(h);
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) put(s, x + i, y + j, r, g, b, a);
  return s;
}

export function strokeRect(s, x, y, w, h, c) {
  x = Math.round(x); y = Math.round(y); w = Math.round(w); h = Math.round(h);
  if (w <= 0 || h <= 0) return s;
  fillRect(s, x, y, w, 1, c);
  if (h > 1) fillRect(s, x, y + h - 1, w, 1, c);
  if (h > 2) {
    fillRect(s, x, y + 1, 1, h - 2, c);
    if (w > 1) fillRect(s, x + w - 1, y + 1, 1, h - 2, c);
  }
  return s;
}

export function bevel(s, x, y, w, h, light, dark) {
  x = Math.round(x); y = Math.round(y); w = Math.round(w); h = Math.round(h);
  if (w <= 0 || h <= 0) return s;
  fillRect(s, x, y, w, 1, light);
  fillRect(s, x, y + 1, 1, h - 1, light);
  fillRect(s, x + 1, y + h - 1, w - 1, 1, dark);
  fillRect(s, x + w - 1, y + 1, 1, h - 2, dark);
  return s;
}

export function gradRect(s, x, y, w, h, stops, dir = 'v', dither = false) {
  x = Math.round(x); y = Math.round(y); w = Math.round(w); h = Math.round(h);
  const n = stops.length - 1;
  for (let j = 0; j < h; j++) {
    for (let i = 0; i < w; i++) {
      const t = dir === 'h' ? (w > 1 ? i / (w - 1) : 0) : (h > 1 ? j / (h - 1) : 0);
      let c;
      if (dither && n > 0) {
        const f = Math.min(t * n, n - 1e-6), k = Math.floor(f);
        c = col(stops[f - k > bayer(x + i, y + j) ? k + 1 : k]);
      } else {
        c = ramp(stops, t);
      }
      put(s, x + i, y + j, c[0], c[1], c[2], c[3]);
    }
  }
  return s;
}

function bresenham(x0, y0, x1, y1, plot) {
  x0 = Math.round(x0); y0 = Math.round(y0); x1 = Math.round(x1); y1 = Math.round(y1);
  const dx = Math.abs(x1 - x0), dy = -Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
  let err = dx + dy;
  for (;;) {
    plot(x0, y0);
    if (x0 === x1 && y0 === y1) break;
    const e2 = 2 * err;
    if (e2 >= dy) { err += dy; x0 += sx; }
    if (e2 <= dx) { err += dx; y0 += sy; }
  }
}

export function line(s, x0, y0, x1, y1, c, thickness = 1) {
  const [r, g, b, a] = col(c);
  if (thickness <= 1) {
    bresenham(x0, y0, x1, y1, (x, y) => put(s, x, y, r, g, b, a));
    return s;
  }
  const lo = -Math.floor((thickness - 1) / 2), hi = Math.floor(thickness / 2);
  const seen = a < 255 ? new Set() : null;
  bresenham(x0, y0, x1, y1, (x, y) => {
    for (let j = lo; j <= hi; j++) {
      for (let i = lo; i <= hi; i++) {
        if (seen) {
          const k = (y + j) * 65536 + (x + i);
          if (seen.has(k)) continue;
          seen.add(k);
        }
        put(s, x + i, y + j, r, g, b, a);
      }
    }
  });
  return s;
}

function ellipseTest(cx, cy, rx, ry) {
  // The small pad rounds low radii into pleasant pixel shapes (r = 1 is a plus, r = 2 a 5 px disc).
  const ax = 1 / ((rx + 0.4) * (rx + 0.4)), ay = 1 / ((ry + 0.4) * (ry + 0.4));
  return (x, y) => (x - cx) * (x - cx) * ax + (y - cy) * (y - cy) * ay <= 1;
}

function ellipse(s, cx, cy, rx, ry, c, stroke) {
  if (rx < 0 || ry < 0) return s;
  const [r, g, b, a] = col(c);
  const inside = ellipseTest(cx, cy, rx, ry);
  const x0 = Math.floor(cx - rx - 1), x1 = Math.ceil(cx + rx + 1);
  const y0 = Math.floor(cy - ry - 1), y1 = Math.ceil(cy + ry + 1);
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      if (!inside(x, y)) continue;
      if (stroke && inside(x - 1, y) && inside(x + 1, y) && inside(x, y - 1) && inside(x, y + 1)) continue;
      put(s, x, y, r, g, b, a);
    }
  }
  return s;
}

export function fillEllipse(s, cx, cy, rx, ry, c) {
  return ellipse(s, cx, cy, rx, ry, c, false);
}

export function strokeEllipse(s, cx, cy, rx, ry, c) {
  return ellipse(s, cx, cy, rx, ry, c, true);
}

export function fillCircle(s, cx, cy, r, c) {
  return ellipse(s, cx, cy, r, r, c, false);
}

export function strokeCircle(s, cx, cy, r, c) {
  return ellipse(s, cx, cy, r, r, c, true);
}

export function fillPoly(s, pts, c) {
  const n = pts.length;
  if (n === 0) return s;
  const [r, g, b, a] = col(c);
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const [x, y] of pts) {
    if (x < x0) x0 = x;
    if (x > x1) x1 = x;
    if (y < y0) y0 = y;
    if (y > y1) y1 = y;
  }
  x0 = Math.floor(x0); y0 = Math.floor(y0); x1 = Math.ceil(x1); y1 = Math.ceil(y1);
  const mw = x1 - x0 + 1, mh = y1 - y0 + 1;
  // Coverage mask so edge pixels are blended exactly once.
  const mask = new Uint8Array(mw * mh);
  const xs = [];
  for (let y = y0; y <= y1; y++) {
    xs.length = 0;
    for (let i = 0; i < n; i++) {
      const [ax, ay] = pts[i], [bx, by] = pts[(i + 1) % n];
      if ((ay <= y && by > y) || (by <= y && ay > y)) xs.push(ax + ((y - ay) / (by - ay)) * (bx - ax));
    }
    xs.sort((p, q) => p - q);
    for (let k = 0; k + 1 < xs.length; k += 2) {
      for (let x = Math.ceil(xs[k]); x <= Math.floor(xs[k + 1]); x++) mask[(y - y0) * mw + (x - x0)] = 1;
    }
  }
  for (let i = 0; i < n; i++) {
    const p = pts[i], q = pts[(i + 1) % n];
    bresenham(p[0], p[1], q[0], q[1], (x, y) => { mask[(y - y0) * mw + (x - x0)] = 1; });
  }
  for (let j = 0; j < mh; j++) {
    for (let i = 0; i < mw; i++) if (mask[j * mw + i]) put(s, x0 + i, y0 + j, r, g, b, a);
  }
  return s;
}

export function strokePoly(s, pts, c, closed = true) {
  const n = pts.length;
  for (let i = 0; i < (closed ? n : n - 1); i++) {
    const p = pts[i], q = pts[(i + 1) % n];
    line(s, p[0], p[1], q[0], q[1], c);
  }
  return s;
}

// ---------------------------------------------------------------- whole-surface helpers

export function blit(dst, src, dx, dy, opts = {}) {
  const { flipX = false, flipY = false, tint = null, alpha = 1, sx = 0, sy = 0 } = opts;
  const sw = opts.sw ?? src.w - sx, sh = opts.sh ?? src.h - sy;
  const t = tint ? col(tint) : null;
  const sd = src.data;
  dx = Math.round(dx); dy = Math.round(dy);
  for (let j = 0; j < sh; j++) {
    const py = sy + (flipY ? sh - 1 - j : j);
    if (py < 0 || py >= src.h) continue;
    for (let i = 0; i < sw; i++) {
      const px = sx + (flipX ? sw - 1 - i : i);
      if (px < 0 || px >= src.w) continue;
      const k = (py * src.w + px) * 4;
      const a = sd[k + 3] * alpha;
      if (a <= 0) continue;
      if (t) put(dst, dx + i, dy + j, (sd[k] * t[0]) / 255, (sd[k + 1] * t[1]) / 255, (sd[k + 2] * t[2]) / 255, a);
      else put(dst, dx + i, dy + j, sd[k], sd[k + 1], sd[k + 2], a);
    }
  }
  return dst;
}

export function shade(s, fn) {
  const d = s.data;
  for (let y = 0, i = 0; y < s.h; y++) {
    for (let x = 0; x < s.w; x++, i += 4) {
      const out = fn(x, y, [d[i], d[i + 1], d[i + 2], d[i + 3]]);
      if (out == null) continue;
      const c = col(out);
      d[i] = c[0]; d[i + 1] = c[1]; d[i + 2] = c[2]; d[i + 3] = c[3];
    }
  }
  return s;
}

export function outline(s, c = '#0c0c10', diagonal = false) {
  const [r, g, b] = col(c);
  const { w, h, data: d } = s;
  const opaque = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) opaque[i] = d[i * 4 + 3] >= 128 ? 1 : 0;
  const at = (x, y) => {
    if (s.wrap) {
      x = (x + w) % w;
      y = (y + h) % h;
    } else if (x < 0 || y < 0 || x >= w || y >= h) return 0;
    return opaque[y * w + x];
  };
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (opaque[y * w + x]) continue;
      let hit = at(x - 1, y) || at(x + 1, y) || at(x, y - 1) || at(x, y + 1);
      if (!hit && diagonal) hit = at(x - 1, y - 1) || at(x + 1, y - 1) || at(x - 1, y + 1) || at(x + 1, y + 1);
      if (!hit) continue;
      const i = (y * w + x) * 4;
      d[i] = r; d[i + 1] = g; d[i + 2] = b; d[i + 3] = 255;
    }
  }
  return s;
}

export function hardenAlpha(s, cutoff = 128) {
  const d = s.data;
  for (let i = 0; i < d.length; i += 4) {
    if (d[i + 3] >= cutoff) d[i + 3] = 255;
    else d[i] = d[i + 1] = d[i + 2] = d[i + 3] = 0;
  }
  return s;
}

export function mirrorX(s) {
  const { w, h, data: d } = s;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w >> 1; x++) {
      const a = (y * w + x) * 4, b = (y * w + (w - 1 - x)) * 4;
      d[b] = d[a]; d[b + 1] = d[a + 1]; d[b + 2] = d[a + 2]; d[b + 3] = d[a + 3];
    }
  }
  return s;
}

export function shift(s, dx, dy) {
  const { w, h } = s;
  const out = createSurface(w, h, null, s.wrap);
  dx = Math.round(dx); dy = Math.round(dy);
  for (let y = 0; y < h; y++) {
    const ty = (((y + dy) % h) + h) % h;
    for (let x = 0; x < w; x++) {
      const tx = (((x + dx) % w) + w) % w;
      const a = (y * w + x) * 4, b = (ty * w + tx) * 4;
      out.data[b] = s.data[a]; out.data[b + 1] = s.data[a + 1];
      out.data[b + 2] = s.data[a + 2]; out.data[b + 3] = s.data[a + 3];
    }
  }
  return out;
}

export function upscale(s, n) {
  const out = createSurface(s.w * n, s.h * n);
  const src = new Uint32Array(s.data.buffer, s.data.byteOffset, s.w * s.h);
  const dst = new Uint32Array(out.data.buffer);
  for (let y = 0; y < out.h; y++) {
    const sy = Math.floor(y / n) * s.w, row = y * out.w;
    for (let x = 0; x < out.w; x++) dst[row + x] = src[sy + Math.floor(x / n)];
  }
  return out;
}

// ---------------------------------------------------------------- dither and palette

const BAYER4 = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];

export function bayer(x, y) {
  return (BAYER4[(y & 3) * 4 + (x & 3)] + 0.5) / 16;
}

export function ditherPick(x, y, t) {
  return t > bayer(x, y);
}

export function posterize(s, levels = 4, dither = true) {
  const d = s.data, n = levels - 1;
  for (let y = 0, i = 0; y < s.h; y++) {
    for (let x = 0; x < s.w; x++, i += 4) {
      const th = dither ? bayer(x, y) : 0.5;
      for (let k = 0; k < 3; k++) {
        const f = (d[i + k] / 255) * n, lo = Math.floor(f);
        d[i + k] = ((f - lo > th ? lo + 1 : lo) / n) * 255;
      }
    }
  }
  return s;
}

export function toPalette(s, palette, dither = 0) {
  const pal = palette.map(col);
  const d = s.data;
  for (let y = 0, i = 0; y < s.h; y++) {
    for (let x = 0; x < s.w; x++, i += 4) {
      if (d[i + 3] === 0) continue;
      const o = dither ? (bayer(x, y) - 0.5) * dither * 64 : 0;
      const r = d[i] + o, g = d[i + 1] + o, b = d[i + 2] + o;
      let best = pal[0], bd = Infinity;
      for (const p of pal) {
        const e = (p[0] - r) * (p[0] - r) + (p[1] - g) * (p[1] - g) + (p[2] - b) * (p[2] - b);
        if (e < bd) { bd = e; best = p; }
      }
      d[i] = best[0]; d[i + 1] = best[1]; d[i + 2] = best[2];
    }
  }
  return s;
}

// ---------------------------------------------------------------- noise

export function hash2(ix, iy, seed = 0) {
  let h = (Math.imul(ix, 374761393) + Math.imul(iy, 668265263) + Math.imul(seed, 1442695041)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h = Math.imul(h ^ (h >>> 16), 2246822519);
  return ((h ^ (h >>> 15)) >>> 0) / 4294967296;
}

function lattice(x, y, px, py, seed) {
  const xi = Math.floor(x), yi = Math.floor(y);
  const xf = x - xi, yf = y - yi;
  let x0 = xi, x1 = xi + 1, y0 = yi, y1 = yi + 1;
  if (px > 0) {
    x0 = ((x0 % px) + px) % px;
    x1 = ((x1 % px) + px) % px;
    y0 = ((y0 % py) + py) % py;
    y1 = ((y1 % py) + py) % py;
  }
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
  const a = hash2(x0, y0, seed), b = hash2(x1, y0, seed);
  const c = hash2(x0, y1, seed), d = hash2(x1, y1, seed);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}

export function valueNoise(x, y, seed = 0) {
  return lattice(x, y, 0, 0, seed);
}

export function valueNoiseTile(x, y, px, py, seed = 0) {
  return lattice(x, y, px, py, seed);
}

function fbmCore(x, y, px, py, seed, octaves, gain) {
  let sum = 0, amp = 1, norm = 0, f = 1;
  for (let o = 0; o < octaves; o++) {
    sum += amp * lattice(x * f, y * f, px * f, py * f, seed + o * 101);
    norm += amp;
    amp *= gain;
    f *= 2;
  }
  return sum / norm;
}

export function fbm(x, y, seed = 0, octaves = 4, gain = 0.5) {
  return fbmCore(x, y, 0, 0, seed, octaves, gain);
}

export function fbmTile(x, y, px, py, seed = 0, octaves = 4, gain = 0.5) {
  return fbmCore(x, y, px, py, seed, octaves, gain);
}

export function noiseMap(w, h, opts = {}) {
  const { seed = 0, cells = 4, octaves = 4, gain = 0.5, tile = true, normalize = true } = opts;
  const cx = Math.max(1, Math.round(cells));
  const cy = Math.max(1, Math.round((cells * h) / w));
  const out = new Float32Array(w * h);
  let lo = Infinity, hi = -Infinity;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const v = fbmCore((x / w) * cx, (y / h) * cy, tile ? cx : 0, tile ? cy : 0, seed, octaves, gain);
      out[y * w + x] = v;
      if (v < lo) lo = v;
      if (v > hi) hi = v;
    }
  }
  if (normalize && hi > lo) {
    const k = 1 / (hi - lo);
    for (let i = 0; i < out.length; i++) out[i] = (out[i] - lo) * k;
  }
  return out;
}

// ---------------------------------------------------------------- text

export const TEXT_HEIGHT = 5;

const GLYPH_ROWS = {
  A: '010/101/111/101/101', B: '110/101/110/101/110', C: '011/100/100/100/011',
  D: '110/101/101/101/110', E: '111/100/110/100/111', F: '111/100/110/100/100',
  G: '011/100/101/101/011', H: '101/101/111/101/101', I: '111/010/010/010/111',
  J: '001/001/001/101/010', K: '101/101/110/101/101', L: '100/100/100/100/111',
  M: '10001/11011/10101/10001/10001', N: '1001/1101/1011/1001/1001',
  O: '010/101/101/101/010', P: '110/101/110/100/100', Q: '010/101/101/110/011',
  R: '110/101/110/101/101', S: '011/100/010/001/110', T: '111/010/010/010/010',
  U: '101/101/101/101/111', V: '101/101/101/101/010',
  W: '10001/10001/10101/11011/10001', X: '101/101/010/101/101',
  Y: '101/101/010/010/010', Z: '111/001/010/100/111',
  0: '111/101/101/101/111', 1: '010/110/010/010/111', 2: '110/001/010/100/111',
  3: '110/001/010/001/110', 4: '101/101/111/001/001', 5: '111/100/110/001/110',
  6: '011/100/111/101/111', 7: '111/001/010/010/010', 8: '111/101/111/101/111',
  9: '111/101/111/001/110',
  ' ': '00/00/00/00/00', '.': '0/0/0/0/1', ',': '00/00/00/01/10', ':': '0/1/0/1/0',
  '!': '1/1/1/0/1', '?': '110/001/010/000/010', '-': '000/000/111/000/000',
  '+': '000/010/111/010/000', '/': '001/001/010/100/100', '%': '101/001/010/100/101',
  '#': '101/111/101/111/101', '(': '01/10/10/10/01', ')': '10/01/01/01/10',
  '[': '11/10/10/10/11', ']': '11/01/01/01/11', "'": '1/1/0/0/0',
  '=': '000/111/000/111/000', '<': '001/010/100/010/001', '>': '100/010/001/010/100',
  '*': '000/101/010/101/000', _: '000/000/000/000/111',
};

const GLYPHS = {};
for (const [ch, rows] of Object.entries(GLYPH_ROWS)) GLYPHS[ch] = rows.split('/');

function glyph(ch) {
  return GLYPHS[ch] || GLYPHS[ch.toUpperCase()] || GLYPHS[' '];
}

export function textWidth(text, scale = 1) {
  let best = 0;
  for (const ln of String(text).split('\n')) {
    let w = 0;
    for (const ch of ln) w += glyph(ch)[0].length + 1;
    best = Math.max(best, w - 1);
  }
  return Math.max(0, best) * scale;
}

export function drawText(s, text, x, y, c, scale = 1) {
  x = Math.round(x); y = Math.round(y);
  let cx = x, cy = y;
  for (const ch of String(text)) {
    if (ch === '\n') {
      cx = x;
      cy += (TEXT_HEIGHT + 1) * scale;
      continue;
    }
    const g = glyph(ch);
    for (let j = 0; j < TEXT_HEIGHT; j++) {
      for (let i = 0; i < g[j].length; i++) {
        if (g[j][i] === '1') fillRect(s, cx + i * scale, cy + j * scale, scale, scale, c);
      }
    }
    cx += (g[0].length + 1) * scale;
  }
  return textWidth(text, scale);
}
