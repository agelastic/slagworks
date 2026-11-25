// Procedural wall, flat and sky textures. Pure and deterministic (no DOM, no Math.random).
//
//   buildTextures() -> { [name]: { w, h, frames: Uint8ClampedArray[], fps, fullbright } }
//
// Conventions used by the art:
//   - light comes from the top left
//   - wall textures are drawn with image row 63 at the floor; one-off features (switch box,
//     exit sign, furnace mouth, door lock) sit in the upper half so a wall taller than one
//     unit repeats plain plating above them, not half a feature
//   - every 64 x 64 texture tiles in both axes, the sky tiles horizontally

import {
  createSurface, clone, fillRect, strokeRect, bevel, gradRect, line, fillCircle, strokeCircle,
  fillPoly, setPx, mix, lighten, darken, ramp, withAlpha, toColor, hash2, fbm, fbmTile, noiseMap,
  bayer, drawText, textWidth,
} from '../core/pix.js';
import {
  TEXTURE_SIZE, SKY, SKY_W, SKY_H, KEY_COLORS, TEXTURE_FULLBRIGHT,
} from '../config.js';

const S = TEXTURE_SIZE;

// ---------------------------------------------------------------- palette

const INK = '#0b0d11';
const ST = ['#151921', '#232b36', '#35414f', '#4b5a6a', '#647688', '#8194a6', '#a3b4c3', '#ccd8e1'];
const RU = ['#2e1610', '#4d2415', '#74371b', '#9c4e22', '#c26a2c', '#e08e42', '#f2b872'];
const CO = ['#2d2c2a', '#45433f', '#5f5c56', '#7c7870', '#9a958a', '#b7b2a5', '#d2cdbf'];
const BR = ['#2a1512', '#4a2018', '#6e3020', '#93432a', '#b45c36', '#cf7e4a', '#e2a56c'];
const RK = ['#17161c', '#27252f', '#3a3745', '#514d5c', '#6c6877', '#8a8794', '#aaa8b2'];
const HZ = ['#6b5210', '#a8841a', '#e0b422', '#f6d85a'];
const HZ_DARK = ['#17171a', '#2b2b30'];
const SL = ['#200a06', '#4a1208', '#8a1f0a', '#c93a0c', '#f26a12', '#ff9a22', '#ffc94a', '#ffeb96', '#fffbe0'];
const CL = ['#04201f', '#073a36', '#0b5c50', '#12866c', '#22b488', '#4fe0a4', '#9cf8c8', '#e4fff0'];
const GN = ['#0d3a1c', '#1c7a34', '#3fd45a', '#b4ffb0'];
const RD = ['#3a0d0d', '#7a1c1a', '#d43a2c', '#ff9a80'];
const TEAL = ['#06262a', '#0f4f55', '#1c868a', '#59c4c0', '#b0eee6'];

// ---------------------------------------------------------------- helpers

const tile = (fill = INK) => createSurface(S, S, fill, true);
const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
const smooth = (a, b, v) => {
  const t = clamp01((v - a) / (b - a));
  return t * t * (3 - 2 * t);
};

// Multiply brightness by quantised low-frequency noise: chunky blotches, no per-pixel fuzz.
function mottle(s, seed, amount, cells = 4, steps = 6) {
  const n = noiseMap(s.w, s.h, { seed, cells, octaves: 3 });
  const d = s.data;
  for (let k = 0, i = 0; k < n.length; k++, i += 4) {
    const q = Math.round(n[k] * (steps - 1)) / (steps - 1);
    const f = 1 + (q - 0.5) * 2 * amount;
    d[i] *= f; d[i + 1] *= f; d[i + 2] *= f;
  }
  return s;
}

// Raised plate: soft vertical gradient, light top/left edge, dark bottom/right edge.
function panel(s, x, y, w, h, c, lip = 0.34, shadow = 0.5) {
  gradRect(s, x, y, w, h, [lighten(c, 0.08), c, darken(c, 0.1)]);
  bevel(s, x, y, w, h, lighten(c, lip), darken(c, shadow));
}

// Recess: dark top/left edge, light bottom/right edge.
function inset(s, x, y, w, h, c, depth = 0.5, lip = 0.25) {
  fillRect(s, x, y, w, h, c);
  bevel(s, x, y, w, h, darken(c, depth), lighten(c, lip));
}

// 2 x 2 rivet head with a highlight and a shadow to the lower right.
function rivet(s, x, y, c) {
  setPx(s, x, y, lighten(c, 0.6));
  setPx(s, x + 1, y, lighten(c, 0.22));
  setPx(s, x, y + 1, lighten(c, 0.22));
  setPx(s, x + 1, y + 1, darken(c, 0.2));
  const sh = withAlpha(INK, 150);
  setPx(s, x + 2, y + 1, sh);
  setPx(s, x + 1, y + 2, sh);
  setPx(s, x + 2, y + 2, sh);
}

function drip(s, x, y, len, c, a = 0.4, w = 1) {
  for (let j = 0; j < len; j++) fillRect(s, x, y + j, w, 1, withAlpha(c, 255 * a * (1 - j / len)));
}

function drips(s, seed, y, count, c, a, minLen, maxLen) {
  for (let k = 0; k < count; k++) {
    const x = Math.floor(hash2(k, 1, seed) * S);
    const len = minLen + Math.floor(hash2(k, 2, seed) * (maxLen - minLen + 1));
    drip(s, x, y, len, c, a * (0.6 + 0.4 * hash2(k, 3, seed)), hash2(k, 4, seed) < 0.3 ? 2 : 1);
  }
}

// Soft additive-looking tint that falls off with distance.
function glow(s, cx, cy, r, c, strength) {
  for (let y = Math.floor(cy - r); y <= Math.ceil(cy + r); y++) {
    for (let x = Math.floor(cx - r); x <= Math.ceil(cx + r); x++) {
      const t = 1 - Math.hypot(x - cx, y - cy) / r;
      if (t > 0) setPx(s, x, y, withAlpha(c, 255 * strength * t * t));
    }
  }
}

// Diagonal warning stripes; period divides 64 so they tile.
function hazard(s, x, y, w, h, period = 16, flip = false) {
  const half = period / 2;
  for (let j = 0; j < h; j++) {
    for (let i = 0; i < w; i++) {
      const px = x + i, py = y + j;
      const k = ((((flip ? px - py : px + py) % period) + period) % period);
      let c;
      if (k < half) c = k === 0 ? HZ[3] : k === half - 1 ? HZ[1] : HZ[2];
      else c = k === half ? HZ_DARK[1] : HZ_DARK[0];
      setPx(s, px, py, c);
    }
  }
}

// Chipped paint: small flakes where fine noise peaks, showing what is underneath.
function wear(s, seed, x, y, w, h, under, level = 0.66) {
  for (let j = 0; j < h; j++) {
    for (let i = 0; i < w; i++) {
      const px = x + i, py = y + j;
      const n = fbmTile(px / 4, py / 4, 16, 16, seed, 2) * 0.75 + fbmTile(px / 16, py / 16, 4, 4, seed + 1, 2) * 0.25;
      if (n > level) setPx(s, px, py, n > level + 0.035 ? under : withAlpha(under, 140));
    }
  }
}

// Thin scratch with a bright upper edge.
function scratch(s, x0, y0, x1, y1, dark, light) {
  line(s, x0, y0 + 1, x1, y1 + 1, withAlpha(dark, 110));
  line(s, x0, y0, x1, y1, withAlpha(light, 90));
}

// Vertical cylinder shaded from the left.
function pipeV(s, x, w, stops, y = 0, h = S) {
  for (let i = 0; i < w; i++) {
    const t = (i + 0.5) / w;
    const l = Math.max(0, 1 - Math.pow(Math.abs(t - 0.3) / 0.72, 1.6));
    fillRect(s, x + i, y, 1, h, ramp(stops, 0.06 + 0.94 * l));
  }
}

// Horizontal cylinder shaded from the top.
function pipeH(s, y, h, stops, x = 0, w = S) {
  for (let j = 0; j < h; j++) {
    const t = (j + 0.5) / h;
    const l = Math.max(0, 1 - Math.pow(Math.abs(t - 0.3) / 0.72, 1.6));
    fillRect(s, x, y + j, w, 1, ramp(stops, 0.06 + 0.94 * l));
  }
}

const STEEL_PIPE = [ST[0], ST[2], ST[4], ST[6], ST[7]];
const DARK_PIPE = [ST[0], ST[1], ST[3], ST[5]];
const RUST_PIPE = [RU[0], RU[2], RU[4], RU[5], RU[6]];
const TEAL_PIPE = [TEAL[0], TEAL[1], TEAL[2], TEAL[3], TEAL[4]];

// Tileable cellular noise: nearest and second nearest feature point per pixel.
function worley(n, seed, jitter = 0.85, wobble = null) {
  const cs = S / n;
  const pts = [];
  for (let cy = 0; cy < n; cy++) {
    for (let cx = 0; cx < n; cx++) {
      let px = (cx + 0.5 + (hash2(cx, cy, seed) - 0.5) * jitter) * cs;
      let py = (cy + 0.5 + (hash2(cx, cy, seed + 1) - 0.5) * jitter) * cs;
      if (wobble) {
        const ph = hash2(cx, cy, seed + 2) * Math.PI * 2;
        px += Math.cos(wobble.angle + ph) * wobble.radius;
        py += Math.sin(wobble.angle + ph) * wobble.radius;
      }
      pts.push([px, py]);
    }
  }
  const f1 = new Float32Array(S * S), f2 = new Float32Array(S * S);
  const id = new Uint16Array(S * S), dx = new Float32Array(S * S), dy = new Float32Array(S * S);
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const gx = Math.floor(x / cs), gy = Math.floor(y / cs);
      let a = 1e9, b = 1e9, ai = 0, ax = 0, ay = 0;
      for (let j = -1; j <= 1; j++) {
        for (let i = -1; i <= 1; i++) {
          const c = ((gy + j + n) % n) * n + ((gx + i + n) % n);
          let ex = x - pts[c][0], ey = y - pts[c][1];
          ex -= S * Math.round(ex / S);
          ey -= S * Math.round(ey / S);
          const dd = Math.hypot(ex, ey);
          if (dd < a) { b = a; a = dd; ai = c; ax = ex; ay = ey; } else if (dd < b) b = dd;
        }
      }
      const k = y * S + x;
      f1[k] = a; f2[k] = b; id[k] = ai; dx[k] = ax; dy[k] = ay;
    }
  }
  return { f1, f2, id, dx, dy, cs };
}

// ---------------------------------------------------------------- walls

function plateWall() {
  const s = tile(ST[4]);
  const hi = mix(ST[4], ST[5], 0.6);
  panel(s, 0, 0, 64, 40, hi);
  panel(s, 32, 40, 64, 24, ST[4]);
  // pressed rib across the upper plate
  fillRect(s, 1, 17, 62, 1, withAlpha(ST[7], 120));
  fillRect(s, 1, 18, 62, 3, withAlpha(ST[6], 60));
  fillRect(s, 1, 21, 62, 1, withAlpha(ST[1], 160));
  mottle(s, 5, 0.09, 3);
  drips(s, 11, 41, 9, ST[0], 0.42, 4, 15);
  drips(s, 12, 1, 7, ST[0], 0.36, 4, 12);
  drips(s, 13, 22, 5, ST[0], 0.26, 3, 9);
  for (let x = 4; x < 64; x += 8) {
    rivet(s, x, 3, hi);
    rivet(s, x, 35, hi);
  }
  for (let x = 36; x < 96; x += 8) {
    rivet(s, x, 43, ST[4]);
    rivet(s, x, 59, ST[4]);
  }
  drip(s, 21, 38, 10, RU[2], 0.55);
  drip(s, 52, 6, 8, RU[2], 0.45);
  drip(s, 45, 62, 7, RU[3], 0.4);
  return s;
}

// Rust eats steel plates: blotches plus vertical runs, heavier along plate edges and bottoms.
// tones = [rim, body, body light, flake]
function rustOver(s, seed, level, plates, tones = [RU[1], RU[2], RU[3], RU[4]]) {
  for (const [x0, y0, w, h] of plates) {
    for (let j = 0; j < h; j++) {
      for (let i = 0; i < w; i++) {
        const x = x0 + i, y = y0 + j;
        const blot = fbmTile(x / 16, y / 16, 4, 4, seed, 3);
        const run = fbmTile(x / 3.2, y / 32, 20, 2, seed + 9, 2);
        const ed = Math.min(i, j, w - 1 - i, h - 1 - j);
        const r = blot * 0.6 + run * 0.4 + Math.max(0, 1 - ed / 5) * 0.09 + (j / h) * 0.05;
        if (r > level + 0.08) {
          const f = fbmTile(x / 4, y / 4, 16, 16, seed + 3, 2);
          setPx(s, x, y, f < 0.4 ? tones[1] : f < 0.62 ? tones[2] : tones[3]);
        } else if (r > level + 0.045) setPx(s, x, y, tones[1]);
        else if (r > level + 0.015) setPx(s, x, y, tones[0]);
        else if (r > level - 0.04) setPx(s, x, y, withAlpha(tones[1], 110));
      }
    }
  }
}

function rustWall() {
  const s = tile(ST[4]);
  const base = mix(ST[4], CO[3], 0.2);
  const plates = [[0, 0, 32, 44], [0, 44, 32, 20], [32, 0, 32, 20], [32, 20, 32, 44]];
  for (const [x, y, w, h] of plates) panel(s, x, y, w, h, base);
  mottle(s, 21, 0.1, 3);
  rustOver(s, 31, 0.56, plates);
  drips(s, 32, 0, 8, RU[2], 0.45, 6, 18);
  drips(s, 33, 44, 6, RU[1], 0.4, 5, 14);
  // seams and bolts stay readable through the rust
  for (const [x, y, w, h] of plates) {
    fillRect(s, x, y, w, 1, withAlpha(lighten(base, 0.3), 150));
    fillRect(s, x, y + h - 1, w, 1, withAlpha(INK, 190));
    fillRect(s, x + w - 1, y, 1, h, withAlpha(INK, 170));
    fillRect(s, x, y + 1, 1, h - 2, withAlpha(lighten(base, 0.3), 110));
    for (const [bx, by] of [[x + 3, y + 3], [x + w - 6, y + 3], [x + 3, y + h - 6], [x + w - 6, y + h - 6]]) {
      rivet(s, bx, by, RU[4]);
    }
  }
  return s;
}

function bricks(s, seed) {
  fillRect(s, 0, 0, S, S, '#1b1310');
  for (let row = 0; row < 8; row++) {
    const off = row & 1 ? 8 : 0;
    for (let col = 0; col < 4; col++) {
      const x = col * 16 + off, y = row * 8;
      const h = hash2(col, row, seed), h2 = hash2(col, row, seed + 1);
      let c = h < 0.14 ? BR[2] : h < 0.5 ? BR[3] : h < 0.86 ? BR[4] : BR[5];
      if (h2 < 0.13) c = mix(c, '#221816', 0.6);
      fillRect(s, x, y, 15, 7, c);
      fillRect(s, x, y, 15, 1, lighten(c, 0.25));
      fillRect(s, x, y + 1, 1, 6, lighten(c, 0.12));
      fillRect(s, x, y + 6, 15, 1, darken(c, 0.32));
      fillRect(s, x + 14, y + 1, 1, 5, darken(c, 0.2));
      // pits and a chipped corner
      const px = x + 2 + Math.floor(hash2(col, row, seed + 2) * 10);
      const py = y + 2 + Math.floor(hash2(col, row, seed + 3) * 3);
      fillRect(s, px, py, 2, 1, darken(c, 0.3));
      setPx(s, px, py + 1, lighten(c, 0.15));
      if (h2 > 0.8) fillRect(s, x + 13, y, 2, 2, '#1b1310');
      if (h2 > 0.55 && h2 < 0.65) fillRect(s, x + 5, y + 3, 4, 1, darken(c, 0.25));
    }
  }
}

function brickWall() {
  const s = tile();
  bricks(s, 41);
  mottle(s, 42, 0.1, 3);
  drips(s, 43, 0, 8, '#120c0a', 0.4, 10, 28);
  drips(s, 44, 30, 6, '#120c0a', 0.35, 8, 22);
  return s;
}

function collar(s, x, w, y, h, stops) {
  fillRect(s, x - 1, y + h, w + 2, 2, withAlpha(INK, 130));
  pipeV(s, x - 1, w + 2, stops, y, h);
  fillRect(s, x - 1, y, w + 2, 1, withAlpha(ST[7], 110));
  fillRect(s, x - 1, y + h - 1, w + 2, 1, withAlpha(INK, 150));
}

function pipeWall() {
  const s = tile('#12151b');
  // backing wall with horizontal ties
  for (let x = 0; x < S; x += 4) fillRect(s, x, 0, 1, S, '#181c24');
  for (const y of [8, 40]) {
    fillRect(s, 0, y, S, 4, ST[2]);
    fillRect(s, 0, y, S, 1, ST[4]);
    fillRect(s, 0, y + 3, S, 1, ST[0]);
    fillRect(s, 0, y + 4, S, 2, withAlpha(INK, 140));
  }
  const pipes = [[3, 13, STEEL_PIPE], [20, 6, RUST_PIPE], [29, 9, DARK_PIPE], [41, 5, TEAL_PIPE], [49, 12, STEEL_PIPE]];
  for (const [x, w, stops] of pipes) {
    fillRect(s, x + w, 0, 2, S, withAlpha(INK, 170));
    pipeV(s, x, w, stops);
  }
  // rust patches on the big right pipe
  for (let y = 0; y < S; y++) {
    for (let x = 49; x < 61; x++) {
      const n = fbmTile(x / 8, y / 16, 8, 4, 55, 3);
      if (n > 0.6) setPx(s, x, y, withAlpha(n > 0.66 ? RU[3] : RU[2], 200));
    }
  }
  collar(s, 3, 13, 7, 6, STEEL_PIPE);
  collar(s, 3, 13, 39, 6, STEEL_PIPE);
  collar(s, 49, 12, 22, 5, STEEL_PIPE);
  collar(s, 49, 12, 54, 5, STEEL_PIPE);
  collar(s, 29, 9, 39, 6, STEEL_PIPE);
  collar(s, 20, 6, 8, 4, RUST_PIPE);
  collar(s, 41, 5, 8, 4, TEAL_PIPE);
  collar(s, 41, 5, 40, 4, TEAL_PIPE);
  for (const [x, y] of [[5, 9], [12, 9], [5, 41], [12, 41], [51, 23], [57, 23], [51, 55], [57, 55]]) rivet(s, x, y, ST[5]);
  // valve wheel on the rust pipe
  fillRect(s, 19, 29, 8, 2, RU[0]);
  fillCircle(s, 22.5, 30, 4, RD[1]);
  strokeCircle(s, 22.5, 30, 4, RD[2]);
  fillRect(s, 20, 27, 3, 1, RD[3]);
  fillRect(s, 22, 29, 2, 2, ST[6]);
  setPx(s, 23, 30, ST[2]);
  // gauge on the dark pipe
  fillCircle(s, 33, 20, 4, ST[1]);
  fillCircle(s, 33, 20, 3, CO[6]);
  strokeCircle(s, 33, 20, 4, ST[5]);
  line(s, 33, 20, 35, 18, RD[2]);
  setPx(s, 33, 20, INK);
  drips(s, 51, 13, 6, INK, 0.4, 5, 14);
  drips(s, 52, 45, 6, INK, 0.4, 5, 14);
  drip(s, 23, 34, 12, RU[1], 0.6);
  return s;
}

function grateWall() {
  const s = tile(ST[3]);
  panel(s, 0, 0, 64, 64, ST[4]);
  inset(s, 4, 4, 56, 56, '#0d0f13', 0.3, 0.0);
  bevel(s, 3, 3, 58, 58, ST[1], ST[6]);
  // louvres: lit top edge, body, underside, gap
  for (let y = 6; y + 5 < 60; y += 6) {
    fillRect(s, 5, y, 54, 1, ST[6]);
    fillRect(s, 5, y + 1, 54, 1, ST[5]);
    fillRect(s, 5, y + 2, 54, 1, ST[3]);
    fillRect(s, 5, y + 3, 54, 1, ST[1]);
  }
  // centre mullion
  fillRect(s, 30, 4, 4, 56, ST[4]);
  fillRect(s, 30, 4, 1, 56, ST[6]);
  fillRect(s, 33, 4, 1, 56, ST[1]);
  fillRect(s, 34, 5, 1, 54, withAlpha(INK, 150));
  for (const [x, y] of [[1, 1], [61, 1], [1, 61], [61, 61]]) {
    setPx(s, x, y, ST[7]);
    setPx(s, x + 1, y + 1, ST[1]);
    setPx(s, x + 1, y, ST[5]);
    setPx(s, x, y + 1, ST[5]);
  }
  for (const y of [14, 32, 50]) rivet(s, 31, y, ST[5]);
  mottle(s, 61, 0.08, 3);
  drips(s, 62, 8, 8, INK, 0.35, 4, 10);
  drips(s, 63, 38, 8, INK, 0.35, 4, 10);
  drip(s, 14, 44, 9, RU[2], 0.5);
  drip(s, 47, 20, 7, RU[2], 0.45);
  return s;
}

function hazardWall() {
  const s = tile(ST[3]);
  hazard(s, 0, 6, 64, 52, 32);
  wear(s, 71, 0, 6, 64, 52, ST[3], 0.66);
  scratch(s, 6, 40, 24, 30, INK, HZ[3]);
  scratch(s, 38, 22, 58, 14, INK, HZ[3]);
  mottle(s, 72, 0.1, 3);
  drips(s, 73, 6, 9, INK, 0.4, 6, 20);
  for (const y of [0, 58]) {
    panel(s, 0, y, 64, 6, ST[4]);
    for (let x = 3; x < 64; x += 8) rivet(s, x, y + 2, ST[4]);
  }
  fillRect(s, 0, 6, 64, 1, withAlpha(INK, 170));
  fillRect(s, 0, 57, 64, 1, withAlpha(INK, 120));
  return s;
}

// Hairline crack running mostly downward; slope changes only now and then.
function crack(s, seed, x, y, len, slope = 1) {
  for (let k = 0; k < len; k++) {
    setPx(s, x, y, CO[1]);
    setPx(s, x + 1, y, withAlpha(CO[6], 90));
    if (hash2(k, seed, 7) < 0.22) slope = Math.floor(hash2(k, seed, 8) * 3) - 1;
    if (hash2(k, seed, 9) < 0.6) x += slope;
    y += 1;
  }
}

function concreteBase(seed) {
  const s = tile(CO[4]);
  mottle(s, seed, 0.16, 3, 7);
  mottle(s, seed + 1, 0.07, 9, 4);
  for (let k = 0; k < 12; k++) {
    const x = Math.floor(hash2(k, 0, seed + 2) * S), y = Math.floor(hash2(k, 1, seed + 2) * S);
    setPx(s, x, y, withAlpha(CO[1], 200));
    setPx(s, x + 1, y + 1, withAlpha(CO[6], 120));
  }
  return s;
}

function concreteWall() {
  const s = concreteBase(81);
  // formwork seams
  fillRect(s, 0, 0, 64, 1, CO[1]);
  fillRect(s, 0, 1, 64, 1, withAlpha(CO[6], 130));
  fillRect(s, 0, 0, 1, 64, CO[1]);
  fillRect(s, 1, 2, 1, 62, withAlpha(CO[6], 110));
  fillRect(s, 0, 32, 64, 1, withAlpha(CO[1], 150));
  fillRect(s, 0, 33, 64, 1, withAlpha(CO[6], 70));
  // tie holes
  for (const [x, y] of [[15, 15], [47, 15], [15, 47], [47, 47]]) {
    fillRect(s, x, y, 3, 3, CO[1]);
    fillRect(s, x, y, 2, 2, CO[0]);
    fillRect(s, x + 1, y + 3, 3, 1, withAlpha(CO[6], 160));
    setPx(s, x + 3, y + 2, withAlpha(CO[6], 160));
  }
  // faded wayfinding stripe
  fillRect(s, 0, 40, 64, 5, withAlpha(RU[4], 170));
  fillRect(s, 0, 40, 64, 1, withAlpha(RU[5], 150));
  fillRect(s, 0, 44, 64, 1, withAlpha(RU[2], 150));
  wear(s, 83, 0, 40, 64, 5, CO[4], 0.6);
  crack(s, 84, 40, 2, 30, -1);
  crack(s, 85, 9, 46, 16, 1);
  drips(s, 86, 2, 8, CO[0], 0.3, 8, 26);
  drips(s, 87, 34, 5, CO[0], 0.25, 6, 14);
  return s;
}

function led(s, x, y, c, lit = true) {
  fillRect(s, x - 1, y - 1, 5, 5, INK);
  if (lit) {
    glow(s, x + 1, y + 1, 5, c[2], 0.35);
    fillRect(s, x, y, 3, 3, c[2]);
    setPx(s, x, y, c[3]);
    setPx(s, x + 1, y, c[3]);
    setPx(s, x, y + 1, c[3]);
  } else {
    fillRect(s, x, y, 3, 3, c[0]);
    setPx(s, x, y, c[1]);
  }
}

const AMBER = [darken(KEY_COLORS.amber, 0.72), darken(KEY_COLORS.amber, 0.4), KEY_COLORS.amber, lighten(KEY_COLORS.amber, 0.55)];
const CYAN = [darken(KEY_COLORS.cyan, 0.72), darken(KEY_COLORS.cyan, 0.4), KEY_COLORS.cyan, lighten(KEY_COLORS.cyan, 0.6)];

function techPanel() {
  const s = tile(ST[2]);
  panel(s, 0, 0, 64, 64, mix(ST[3], ST[4], 0.5));
  // readout strip
  inset(s, 4, 5, 36, 16, '#081a1c', 0.5, 0.0);
  bevel(s, 3, 4, 38, 18, ST[1], ST[5]);
  for (let r = 0; r < 4; r++) {
    const w = 8 + Math.floor(hash2(r, 0, 91) * 20);
    fillRect(s, 7, 8 + r * 3, w, 1, r === 2 ? AMBER[2] : CYAN[1]);
    fillRect(s, 7, 8 + r * 3, 3, 1, r === 2 ? AMBER[3] : CYAN[2]);
  }
  // indicator lights
  inset(s, 44, 4, 16, 18, ST[1], 0.5, 0.3);
  led(s, 47, 7, GN);
  led(s, 54, 7, AMBER);
  led(s, 47, 15, RD, false);
  led(s, 54, 15, CYAN);
  // key row
  inset(s, 4, 26, 56, 12, ST[1], 0.5, 0.3);
  for (let k = 0; k < 7; k++) {
    const c = k === 5 ? RU[4] : ST[5];
    panel(s, 6 + k * 7, 28, 6, 8, c, 0.4, 0.5);
  }
  panel(s, 55, 28, 4, 8, RD[2], 0.4, 0.5);
  // vent and service hatch
  inset(s, 4, 42, 26, 18, ST[1], 0.5, 0.3);
  for (let y = 45; y < 58; y += 4) {
    fillRect(s, 6, y, 22, 2, INK);
    fillRect(s, 6, y + 2, 22, 1, ST[4]);
  }
  panel(s, 34, 42, 26, 18, ST[4]);
  for (const [x, y] of [[36, 44], [56, 44], [36, 56], [56, 56]]) rivet(s, x, y, ST[5]);
  drawText(s, 'A7', 43, 49, ST[1]);
  hazard(s, 34, 57, 26, 3, 8);
  mottle(s, 92, 0.07, 3);
  return s;
}

function crateWall() {
  const s = tile(RU[4]);
  // corrugation, 8 px pitch
  const prof = [0.3, 0.12, 0, 0, -0.14, -0.38, -0.46, -0.3];
  for (let x = 0; x < S; x++) {
    const p = prof[x % 8];
    fillRect(s, x, 0, 1, S, p >= 0 ? lighten(RU[4], p) : darken(RU[4], -p));
  }
  mottle(s, 101, 0.1, 3);
  // stencil
  const label = 'SW-07';
  drawText(s, label, 32 - Math.floor(textWidth(label, 2) / 2), 13, withAlpha(CO[6], 235), 2);
  fillRect(s, 10, 31, 20, 2, withAlpha(CO[6], 215));
  fillRect(s, 10, 35, 13, 2, withAlpha(CO[6], 215));
  // placard
  fillRect(s, 40, 29, 14, 12, INK);
  hazard(s, 41, 30, 12, 10, 8);
  wear(s, 102, 0, 6, 64, 52, RU[2], 0.66);
  drips(s, 103, 8, 7, RU[1], 0.4, 8, 22);
  drips(s, 104, 44, 5, RU[0], 0.35, 6, 12);
  // rails and corner posts
  for (const y of [0, 58]) {
    panel(s, 0, y, 64, 6, ST[3]);
    for (let x = 6; x < 64; x += 16) rivet(s, x, y + 2, ST[4]);
  }
  fillRect(s, 0, 6, 64, 2, withAlpha(INK, 150));
  fillRect(s, 0, 0, 3, 64, ST[2]);
  fillRect(s, 0, 0, 1, 64, ST[5]);
  fillRect(s, 61, 0, 3, 64, ST[2]);
  fillRect(s, 61, 0, 1, 64, ST[4]);
  fillRect(s, 63, 0, 1, 64, ST[0]);
  fillRect(s, 3, 6, 1, 52, withAlpha(INK, 170));
  return s;
}

const RK_RGB = RK.map((c) => toColor(c));

function rock(seed, n, relief, bright, flecks) {
  const s = tile();
  const w = worley(n, seed, 0.9);
  const big = noiseMap(S, S, { seed: seed + 7, cells: 2, octaves: 2 });
  const d = s.data;
  for (let k = 0, i = 0; k < S * S; k++, i += 4) {
    const h = hash2(w.id[k], 3, seed);
    let l = bright + (h - 0.5) * 0.3 - ((w.dx[k] + w.dy[k]) / w.cs) * relief + (big[k] - 0.5) * 0.3;
    const edge = w.f2[k] - w.f1[k];
    if (edge < 1.1) l = 0.02;
    else if (edge < 2.3) l -= 0.18;
    const v = RK_RGB[Math.round(clamp01(l) * (RK_RGB.length - 1))];
    d[i] = v[0]; d[i + 1] = v[1]; d[i + 2] = v[2]; d[i + 3] = 255;
  }
  for (let k = 0; k < flecks; k++) {
    const x = Math.floor(hash2(k, 0, seed + 5) * S), y = Math.floor(hash2(k, 1, seed + 5) * S);
    const c = hash2(k, 2, seed + 5) < 0.5 ? RU[4] : RU[5];
    fillRect(s, x, y, 2, 1, c);
    setPx(s, x, y + 1, RU[2]);
  }
  return s;
}

function furnaceWall() {
  const s = tile();
  bricks(s, 41);
  mottle(s, 42, 0.1, 3);
  // soot above and around the mouth
  for (let y = 0; y < 40; y++) {
    for (let x = 4; x < 60; x++) {
      const dxm = Math.abs(x - 31.5) / 30, t = clamp01(1 - dxm) * clamp01(1 - Math.abs(y - 14) / 28);
      setPx(s, x, y, withAlpha('#0e0907', 200 * t * (0.6 + 0.4 * hash2(x >> 1, y >> 1, 9))));
    }
  }
  const inside = (x, y) => {
    if (x < 15 || x > 48 || y > 31 || y < 6) return false;
    if (y >= 16) return true;
    const ex = (x - 31.5) / 17.5, ey = (16 - y) / 10.5;
    return ex * ex + ey * ey <= 1;
  };
  const near = (x, y, r) => {
    for (let j = -r; j <= r; j++) for (let i = -r; i <= r; i++) if (inside(x + i, y + j)) return true;
    return false;
  };
  // iron frame, then the fire
  for (let y = 0; y < 38; y++) {
    for (let x = 8; x < 56; x++) {
      if (inside(x, y)) {
        const dxm = (x - 31.5) / 17, dym = (31 - y) / 26;
        const heat = clamp01(1.08 - Math.hypot(dxm * 0.95, dym) + (fbm(x / 5, y / 4, 7, 2) - 0.5) * 0.3);
        setPx(s, x, y, SL[2 + Math.round(heat * 6)]);
      } else if (near(x, y, 4)) {
        const edge = !near(x, y, 3);
        const lit = near(x, y, 1);
        setPx(s, x, y, lit ? RU[5] : edge ? ST[0] : ST[2]);
      }
    }
  }
  // frame highlights and rivets
  for (let x = 11; x <= 52; x++) if (!near(x, 3, 4) || true) setPx(s, x, 34, ST[4]);
  for (const [x, y] of [[12, 12], [12, 22], [12, 31], [50, 12], [50, 22], [50, 31], [22, 3], [31, 2], [40, 3]]) rivet(s, x, y, ST[4]);
  // grate bars
  for (const x of [20, 28, 36, 44]) {
    for (let y = 6; y <= 31; y++) {
      if (!inside(x, y) || !inside(x + 1, y)) continue;
      setPx(s, x, y, '#2a0d08');
      setPx(s, x + 1, y, '#120605');
      if (inside(x - 1, y)) setPx(s, x - 1, y, withAlpha(SL[7], 90));
    }
  }
  // ash ledge
  panel(s, 9, 36, 46, 4, ST[2]);
  fillRect(s, 10, 40, 44, 2, withAlpha(INK, 150));
  glow(s, 31.5, 36, 14, SL[5], 0.5);
  glow(s, 31.5, 44, 18, SL[4], 0.3);
  glow(s, 8, 20, 9, SL[4], 0.25);
  glow(s, 55, 20, 9, SL[4], 0.25);
  return s;
}

function screenWall(frame) {
  const s = tile(ST[2]);
  panel(s, 0, 0, 64, 64, mix(ST[3], ST[4], 0.5));
  // bezel and tube
  panel(s, 3, 3, 58, 38, ST[2]);
  inset(s, 6, 6, 52, 32, '#041c1e', 0.4, 0.0);
  bevel(s, 5, 5, 54, 34, INK, ST[5]);
  for (let y = 7; y < 37; y += 2) fillRect(s, 7, y, 50, 1, '#062a2b');
  const hi = CYAN[3], mid = CYAN[2], dim = CYAN[1];
  drawText(s, 'CORE', 9, 9, mid);
  fillRect(s, 28, 9, 27, 5, '#0a3d40');
  fillRect(s, 28, 9, frame ? 19 : 14, 5, dim);
  fillRect(s, 28, 9, frame ? 19 : 14, 1, mid);
  // bar graph
  const bars = frame ? [5, 9, 12, 7, 10, 4, 8] : [7, 6, 11, 10, 8, 6, 5];
  bars.forEach((h, i) => {
    fillRect(s, 9 + i * 4, 34 - h, 3, h, dim);
    fillRect(s, 9 + i * 4, 34 - h, 3, 1, hi);
  });
  fillRect(s, 8, 35, 29, 1, mid);
  // alert box blinks
  strokeRect(s, 40, 18, 15, 17, frame ? AMBER[2] : AMBER[0]);
  if (frame) {
    fillRect(s, 41, 19, 13, 15, AMBER[0]);
    fillPoly(s, [[47, 21], [42, 31], [52, 31]], AMBER[2]);
    fillRect(s, 47, 24, 1, 4, INK);
    setPx(s, 47, 29, INK);
    glow(s, 47, 26, 12, AMBER[2], 0.18);
  } else {
    fillPoly(s, [[47, 21], [42, 31], [52, 31]], AMBER[0]);
  }
  // glass glint
  line(s, 8, 12, 12, 8, withAlpha('#ffffff', 60));
  // console below
  inset(s, 3, 44, 58, 17, ST[1], 0.5, 0.3);
  for (let k = 0; k < 8; k++) panel(s, 6 + k * 5, 47, 4, 4, ST[5], 0.4, 0.5);
  for (let k = 0; k < 8; k++) panel(s, 6 + k * 5, 53, 4, 4, k === 7 ? RU[4] : ST[4], 0.4, 0.5);
  led(s, 50, 48, GN, frame === 0);
  led(s, 55, 48, RD, frame === 1);
  fillRect(s, 48, 55, 11, 1, INK);
  fillRect(s, 48, 57, 11, 1, INK);
  return s;
}

// ---------------------------------------------------------------- doors

// Two stacked chevrons pointing up (the door lifts), apex columns cx and cx + 1.
function chevrons(s, cx, c, c2) {
  for (const y of [22, 28]) {
    for (let k = 0; k <= 6; k++) {
      for (const x of [cx - k, cx + 1 + k]) {
        setPx(s, x, y + k, c);
        setPx(s, x, y + k + 1, c2);
      }
    }
  }
}

function door(key) {
  const s = tile(ST[3]);
  const kc = key ? KEY_COLORS[key] : null;
  const leaf = mix(ST[4], ST[5], 0.35);
  // two leaves and the centre seam
  for (const lx of [5, 33]) {
    panel(s, lx, 6, 26, 50, leaf);
    inset(s, lx + 3, 9, 20, 7, ST[3], 0.45, 0.35);
    inset(s, lx + 3, 40, 20, 13, ST[3], 0.45, 0.35);
    for (let y = 43; y < 52; y += 3) {
      fillRect(s, lx + 5, y, 16, 1, ST[1]);
      fillRect(s, lx + 5, y + 1, 16, 1, ST[5]);
    }
    for (const [x, y] of [[lx + 2, 18], [lx + 22, 18], [lx + 2, 36], [lx + 22, 36]]) rivet(s, x, y, leaf);
  }
  fillRect(s, 31, 6, 2, 50, INK);
  fillRect(s, 30, 6, 1, 50, ST[2]);
  fillRect(s, 33, 6, 1, 50, ST[6]);
  mottle(s, 111, 0.07, 3);
  drips(s, 112, 7, 7, INK, 0.35, 5, 14);

  // band at eye level
  if (kc) {
    const kr = [darken(kc, 0.6), darken(kc, 0.28), kc, lighten(kc, 0.5)];
    fillRect(s, 5, 20, 54, 16, kr[2]);
    fillRect(s, 5, 20, 54, 1, kr[3]);
    fillRect(s, 5, 21, 54, 1, lighten(kc, 0.2));
    fillRect(s, 5, 34, 54, 2, kr[1]);
    fillRect(s, 5, 19, 54, 1, INK);
    fillRect(s, 5, 36, 54, 1, INK);
    chevrons(s, 12, kr[0], kr[1]);
    chevrons(s, 50, kr[0], kr[1]);
    wear(s, 113, 5, 20, 54, 16, kr[1], 0.75);
  } else {
    inset(s, 5, 20, 54, 16, ST[1], 0.5, 0.3);
    chevrons(s, 14, ST[7], ST[5]);
    chevrons(s, 48, ST[7], ST[5]);
  }

  // guide rails, header, threshold
  for (const x of [0, 59]) {
    fillRect(s, x, 0, 5, 64, ST[2]);
    fillRect(s, x, 0, 1, 64, ST[4]);
    fillRect(s, x + 4, 0, 1, 64, ST[0]);
    if (kc) {
      fillRect(s, x + 1, 6, 3, 50, kc);
      fillRect(s, x + 1, 6, 1, 50, lighten(kc, 0.4));
      for (let y = 12; y < 56; y += 10) fillRect(s, x + 1, y, 3, 2, darken(kc, 0.6));
    } else {
      for (let y = 10; y < 56; y += 10) rivet(s, x + 1, y, ST[3]);
    }
  }
  panel(s, 0, 0, 64, 6, ST[3]);
  for (let x = 6; x < 64; x += 12) rivet(s, x, 2, ST[4]);
  fillRect(s, 0, 6, 64, 1, withAlpha(INK, 170));
  fillRect(s, 0, 56, 64, 8, ST[1]);
  fillRect(s, 0, 56, 64, 1, ST[5]);
  for (let x = 1; x < 64; x += 8) panel(s, x, 58, 6, 5, ST[3], 0.4, 0.6);
  fillRect(s, 0, 63, 64, 1, INK);

  if (kc) {
    // lock plate
    const kr = [darken(kc, 0.65), darken(kc, 0.3), kc, lighten(kc, 0.6)];
    fillRect(s, 24, 39, 18, 1, withAlpha(INK, 150));
    panel(s, 22, 16, 20, 23, ST[2], 0.45, 0.6);
    strokeRect(s, 21, 15, 22, 25, INK);
    inset(s, 25, 19, 14, 9, INK, 0, 0);
    glow(s, 32, 23, 12, kc, 0.3);
    fillRect(s, 26, 20, 12, 7, kr[2]);
    fillRect(s, 26, 20, 12, 1, kr[3]);
    fillRect(s, 27, 21, 4, 2, kr[3]);
    fillRect(s, 26, 26, 12, 1, kr[1]);
    // card slot
    fillRect(s, 27, 31, 10, 4, INK);
    fillRect(s, 28, 32, 8, 1, kr[1]);
    fillRect(s, 27, 35, 10, 1, ST[5]);
    for (const [x, y] of [[23, 17], [39, 17], [23, 36], [39, 36]]) {
      setPx(s, x, y, ST[6]);
      setPx(s, x + 1, y + 1, INK);
    }
  } else {
    // hub
    fillCircle(s, 31.5, 27.5, 7, INK);
    fillCircle(s, 31.5, 27.5, 6, ST[4]);
    strokeCircle(s, 31.5, 27.5, 6, ST[2]);
    fillCircle(s, 30.5, 26.5, 3, ST[6]);
    fillCircle(s, 31.5, 27.5, 2, ST[2]);
    setPx(s, 30, 26, ST[7]);
    fillRect(s, 31, 21, 2, 3, ST[1]);
    fillRect(s, 31, 32, 2, 3, ST[1]);
  }
  return s;
}

// ---------------------------------------------------------------- switches

function conduit(s, x, w = 4) {
  fillRect(s, x + w, 0, 2, S, withAlpha(INK, 110));
  pipeV(s, x, w, DARK_PIPE);
  for (const y of [45, 58]) {
    fillRect(s, x - 2, y, w + 4, 3, ST[2]);
    fillRect(s, x - 2, y, w + 4, 1, ST[5]);
    setPx(s, x - 1, y + 1, ST[6]);
    setPx(s, x + w, y + 1, ST[6]);
  }
}

function switchWall(base, on) {
  const s = clone(base);
  conduit(s, 30);
  const lamp = on ? GN : RD;
  // housing
  fillRect(s, 17, 34, 32, 2, withAlpha(INK, 130));
  fillRect(s, 48, 5, 2, 30, withAlpha(INK, 110));
  panel(s, 16, 3, 32, 31, ST[3], 0.4, 0.6);
  inset(s, 19, 6, 26, 25, ST[1], 0.5, 0.35);
  for (const [x, y] of [[17, 4], [45, 4], [17, 31], [45, 31]]) {
    setPx(s, x, y, ST[7]);
    setPx(s, x + 1, y + 1, INK);
  }
  // lamp
  fillRect(s, 21, 8, 22, 8, INK);
  if (on) {
    glow(s, 31.5, 11.5, 20, GN[2], 0.4);
    fillRect(s, 22, 9, 20, 6, GN[2]);
    fillRect(s, 23, 10, 18, 3, GN[3]);
    fillRect(s, 22, 14, 20, 1, GN[1]);
  } else {
    fillRect(s, 22, 9, 20, 6, RD[1]);
    fillRect(s, 22, 9, 20, 1, RD[2]);
    fillRect(s, 23, 10, 5, 1, RD[3]);
    fillRect(s, 22, 14, 20, 1, RD[0]);
  }
  // lever slot and handle
  fillRect(s, 29, 18, 6, 12, INK);
  fillRect(s, 35, 18, 1, 12, ST[4]);
  const ky = on ? 17 : 26;
  fillRect(s, 31, on ? 20 : 22, 2, on ? 6 : 6, ST[6]);
  fillRect(s, 33, on ? 20 : 22, 1, 6, ST[2]);
  fillRect(s, 26, ky + 5, 12, 1, withAlpha(INK, 160));
  panel(s, 26, ky, 12, 5, lamp[2], 0.5, 0.5);
  fillRect(s, 28, ky + 1, 4, 1, lamp[3]);
  // position marks
  fillRect(s, 22, 19, 3, 1, on ? GN[2] : ST[4]);
  fillRect(s, 22, 28, 3, 1, on ? ST[4] : RD[2]);
  fillRect(s, 39, 19, 3, 1, on ? GN[2] : ST[4]);
  fillRect(s, 39, 28, 3, 1, on ? ST[4] : RD[2]);
  return s;
}

function exitWall(base, on) {
  const s = clone(base);
  conduit(s, 30);
  // warning strips down both sides
  for (const x of [0, 57]) {
    hazard(s, x, 0, 7, 64, 16, x > 0);
    fillRect(s, x === 0 ? 7 : 56, 0, 1, 64, INK);
    fillRect(s, x === 0 ? 8 : 55, 0, 1, 64, withAlpha(INK, 90));
  }
  wear(s, 121, 0, 0, 7, 64, ST[2], 0.66);
  wear(s, 122, 57, 0, 7, 64, ST[2], 0.66);
  // sign
  fillRect(s, 11, 20, 44, 2, withAlpha(INK, 130));
  panel(s, 10, 2, 44, 18, ST[3], 0.4, 0.6);
  fillRect(s, 12, 4, 40, 14, INK);
  const tx = 32 - Math.floor(textWidth('EXIT', 2) / 2);
  if (on) {
    glow(s, 31.5, 11, 26, GN[2], 0.35);
    fillRect(s, 13, 5, 38, 12, GN[0]);
    fillRect(s, 13, 5, 38, 1, GN[1]);
    drawText(s, 'EXIT', tx + 1, 7, GN[1], 2);
    drawText(s, 'EXIT', tx, 6, GN[3], 2);
  } else {
    fillRect(s, 13, 5, 38, 12, RD[0]);
    drawText(s, 'EXIT', tx + 1, 7, '#1c0606', 2);
    drawText(s, 'EXIT', tx, 6, RD[2], 2);
  }
  // button housing
  fillRect(s, 22, 37, 22, 2, withAlpha(INK, 130));
  panel(s, 21, 22, 22, 15, ST[3], 0.4, 0.6);
  fillCircle(s, 31.5, 29, 6, INK);
  const b = on ? GN : RD;
  if (on) glow(s, 31.5, 29, 13, GN[2], 0.4);
  fillCircle(s, 31.5, 29, 5, b[1]);
  fillCircle(s, on ? 31.5 : 31, on ? 29 : 28.5, 4, b[2]);
  fillCircle(s, on ? 31.5 : 30, on ? 29 : 27.5, on ? 2 : 1, b[3]);
  for (const [x, y] of [[22, 23], [40, 23], [22, 34], [40, 34]]) {
    setPx(s, x, y, ST[7]);
    setPx(s, x + 1, y + 1, INK);
  }
  return s;
}

// ---------------------------------------------------------------- flats

function tread(s, x0, y0, w, h, c) {
  for (let j = 0; j * 8 < h; j++) {
    for (let i = 0; i * 8 < w; i++) {
      const x = x0 + i * 8 + 2, y = y0 + j * 8 + 2;
      const fwd = (i + j) & 1;
      for (let k = 0; k < 4; k++) {
        const px = x + k, py = fwd ? y + 3 - k : y + k;
        setPx(s, px, py + 1, darken(c, 0.35));
        setPx(s, px, py, lighten(c, 0.3));
      }
    }
  }
}

function plateFlat() {
  const s = tile(ST[3]);
  const a = mix(ST[3], ST[4], 0.7), b = mix(ST[3], ST[4], 0.25);
  panel(s, 0, 0, 32, 32, a);
  panel(s, 32, 32, 32, 32, a);
  panel(s, 32, 0, 32, 32, b);
  panel(s, 0, 32, 32, 32, b);
  tread(s, 4, 4, 24, 24, a);
  tread(s, 36, 36, 24, 24, a);
  mottle(s, 131, 0.1, 3);
  for (const [qx, qy] of [[0, 0], [32, 0], [0, 32], [32, 32]]) {
    for (const [x, y] of [[2, 2], [28, 2], [2, 28], [28, 28]]) rivet(s, qx + x, qy + y, ST[4]);
  }
  // scuffs
  line(s, 38, 8, 52, 20, withAlpha(ST[6], 70));
  line(s, 40, 8, 56, 22, withAlpha(ST[1], 80));
  line(s, 6, 40, 22, 56, withAlpha(ST[1], 70));
  glowStain(s, 46, 14, 9, ST[0], 0.3);
  glowStain(s, 14, 50, 8, RU[1], 0.35);
  return s;
}

// Dark stain with a soft edge.
function glowStain(s, cx, cy, r, c, a) {
  glow(s, cx, cy, r, c, a);
}

function grateFlat() {
  const s = tile('#0c0e12');
  // something dim underneath
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const n = fbmTile(x / 16, y / 16, 4, 4, 141, 2);
      if (n > 0.55) setPx(s, x, y, n > 0.66 ? '#231a14' : '#171a20');
    }
  }
  for (let k = 0; k < 8; k++) {
    const p = k * 8;
    const frame = k % 4 === 0;
    const c = frame ? ST[4] : ST[3];
    const w = frame ? 4 : 3;
    // bars along x
    fillRect(s, 0, p, S, w, c);
    fillRect(s, 0, p, S, 1, lighten(c, 0.35));
    fillRect(s, 0, p + w - 1, S, 1, darken(c, 0.5));
  }
  for (let k = 0; k < 8; k++) {
    const p = k * 8;
    const frame = k % 4 === 0;
    const c = frame ? ST[4] : ST[3];
    const w = frame ? 4 : 3;
    fillRect(s, p, 0, w, S, c);
    fillRect(s, p, 0, 1, S, lighten(c, 0.35));
    fillRect(s, p + w - 1, 0, 1, S, darken(c, 0.5));
  }
  // weld dots where bars cross
  for (let j = 0; j < 8; j++) for (let i = 0; i < 8; i++) setPx(s, i * 8 + 1, j * 8 + 1, ST[6]);
  for (const [x, y] of [[1, 1], [33, 1], [1, 33], [33, 33]]) rivet(s, x, y, ST[5]);
  mottle(s, 142, 0.1, 3);
  return s;
}

function concreteFlat() {
  const s = concreteBase(151);
  mottle(s, 152, 0.06, 2, 4);
  fillRect(s, 0, 0, 64, 1, CO[1]);
  fillRect(s, 0, 1, 64, 1, withAlpha(CO[6], 120));
  fillRect(s, 0, 0, 1, 64, CO[1]);
  fillRect(s, 1, 2, 1, 62, withAlpha(CO[6], 100));
  crack(s, 153, 22, 4, 40, 1);
  crack(s, 154, 50, 34, 24, -1);
  glow(s, 44, 16, 10, CO[0], 0.4);
  glow(s, 14, 46, 8, '#241c14', 0.45);
  glow(s, 18, 49, 5, '#241c14', 0.4);
  return s;
}

function hazardFlat() {
  const s = tile(ST[3]);
  hazard(s, 0, 0, 64, 64, 32);
  wear(s, 161, 0, 0, 64, 64, ST[3], 0.67);
  mottle(s, 162, 0.1, 3);
  scratch(s, 8, 30, 30, 20, INK, HZ[3]);
  scratch(s, 34, 52, 58, 42, INK, HZ[3]);
  glow(s, 46, 18, 9, INK, 0.3);
  fillRect(s, 0, 0, 64, 1, withAlpha(INK, 150));
  fillRect(s, 0, 0, 1, 64, withAlpha(INK, 150));
  fillRect(s, 0, 1, 64, 1, withAlpha(HZ[3], 90));
  return s;
}

function rustFlat() {
  const s = tile(ST[3]);
  const base = mix(ST[3], CO[2], 0.3);
  for (const [x, y] of [[0, 0], [32, 0], [0, 32], [32, 32]]) panel(s, x, y, 32, 32, base);
  mottle(s, 171, 0.1, 3);
  rustOver(s, 172, 0.47, [[0, 0, 32, 32], [32, 0, 32, 32], [0, 32, 32, 32], [32, 32, 32, 32]], [RU[0], RU[1], RU[2], RU[3]]);
  for (const [qx, qy] of [[0, 0], [32, 0], [0, 32], [32, 32]]) {
    fillRect(s, qx, qy, 32, 1, withAlpha(lighten(base, 0.3), 130));
    fillRect(s, qx, qy + 31, 32, 1, withAlpha(INK, 190));
    fillRect(s, qx + 31, qy, 1, 32, withAlpha(INK, 170));
    for (const [x, y] of [[2, 2], [28, 2], [2, 28], [28, 28]]) rivet(s, qx + x, qy + y, RU[4]);
  }
  return s;
}

function liftFlat() {
  const s = tile(ST[3]);
  hazard(s, 0, 0, 64, 64, 16);
  wear(s, 181, 0, 0, 64, 64, ST[2], 0.66);
  strokeRect(s, 6, 6, 52, 52, INK);
  panel(s, 7, 7, 50, 50, ST[4]);
  tread(s, 8, 8, 48, 48, ST[4]);
  mottle(s, 182, 0.08, 3);
  // ring with opposed arrows: reads the same from either side
  fillCircle(s, 31.5, 31.5, 19, HZ[2]);
  fillCircle(s, 31.5, 31.5, 16, ST[4]);
  strokeCircle(s, 31.5, 31.5, 19, HZ[0]);
  fillPoly(s, [[31.5, 18], [24, 28], [39, 28]], HZ[2]);
  fillPoly(s, [[31.5, 45], [24, 35], [39, 35]], HZ[2]);
  fillRect(s, 24, 28, 16, 1, HZ[0]);
  wear(s, 183, 10, 10, 44, 44, ST[4], 0.72);
  for (const [x, y] of [[9, 9], [53, 9], [9, 53], [53, 53]]) rivet(s, x, y, ST[5]);
  return s;
}

function slagFrames() {
  const frames = [];
  for (let k = 0; k < 4; k++) {
    const th = (k / 4) * Math.PI * 2, c = Math.cos(th), sn = Math.sin(th);
    const s = tile();
    for (let y = 0; y < S; y++) {
      for (let x = 0; x < S; x++) {
        const u = x / 16, v = y / 16;
        const wx = fbmTile(u + 0.14 * c, v + 0.14 * sn, 4, 4, 191, 2) - 0.5;
        const wy = fbmTile(u - 0.14 * sn, v + 0.14 * c, 4, 4, 193, 2) - 0.5;
        const h = fbmTile(u + wx * 1.4, v + wy * 1.4, 4, 4, 197, 3);
        const a = fbmTile(u * 2, v * 2, 8, 8, 199, 2) - 0.5, b = fbmTile(u * 2, v * 2, 8, 8, 211, 2) - 0.5;
        const vein = 1 - Math.abs(2 * h - 1);
        let heat = 0.2 + 0.75 * vein * vein + (a * c + b * sn) * 0.3;
        const crust = fbmTile(u + wy * 0.6 + 2.1, v + wx * 0.6, 4, 4, 223, 3);
        if (crust > 0.6) heat -= (crust - 0.6) * 4;
        const t = clamp01(heat) * (SL.length - 1);
        const i = Math.min(SL.length - 1, Math.floor(t + (bayer(x, y) - 0.5) * 0.5 + 0.5));
        setPx(s, x, y, SL[i]);
      }
    }
    frames.push(s);
  }
  return frames;
}

function coolantFrames() {
  const frames = [];
  for (let k = 0; k < 4; k++) {
    const angle = (k / 4) * Math.PI * 2;
    const s = tile();
    const wa = worley(4, 231, 0.9, { angle, radius: 1.3 });
    const wb = worley(6, 237, 0.9, { angle: -angle, radius: 1 });
    for (let y = 0; y < S; y++) {
      for (let x = 0; x < S; x++) {
        const i = y * S + x;
        const ea = wa.f2[i] - wa.f1[i], eb = wb.f2[i] - wb.f1[i];
        const depth = fbmTile(x / 32 + Math.cos(angle) * 0.1, y / 32 + Math.sin(angle) * 0.1, 2, 2, 241, 2);
        let l = 0.2 + depth * 0.3;
        l += 0.55 * smooth(3.2, 0, ea) + 0.3 * smooth(2.4, 0, eb);
        const t = clamp01(l) * (CL.length - 1);
        const ci = Math.min(CL.length - 1, Math.floor(t + (bayer(x, y) - 0.5) * 0.5 + 0.5));
        setPx(s, x, y, CL[ci]);
      }
    }
    frames.push(s);
  }
  return frames;
}

// ---------------------------------------------------------------- ceilings

function ceilPanel(vent) {
  const s = tile(ST[2]);
  const c = mix(ST[3], ST[4], 0.15);
  for (const [x, y] of [[0, 0], [32, 0], [0, 32], [32, 32]]) {
    panel(s, x, y, 32, 32, c, 0.3, 0.55);
    inset(s, x + 5, y + 5, 22, 22, mix(ST[2], ST[3], 0.7), 0.45, 0.3);
    for (const [bx, by] of [[2, 2], [28, 2], [2, 28], [28, 28]]) rivet(s, x + bx, y + by, ST[4]);
  }
  // one vented panel per tile
  for (let y = 40; vent && y < 56; y += 4) {
    fillRect(s, 40, y, 16, 2, INK);
    fillRect(s, 40, y + 2, 16, 1, ST[4]);
  }
  mottle(s, 251, 0.1, 3);
  drips(s, 252, 5, 4, INK, 0.25, 4, 10);
  glow(s, 14, 16, 8, RU[1], 0.3);
  return s;
}

function ceilPipes() {
  const s = tile('#12151b');
  for (let y = 0; y < S; y += 4) fillRect(s, 0, y, S, 1, '#181c24');
  const pipes = [[2, 12, STEEL_PIPE], [18, 6, RUST_PIPE], [27, 10, DARK_PIPE], [41, 5, TEAL_PIPE], [49, 12, STEEL_PIPE]];
  for (const [y, h, stops] of pipes) {
    fillRect(s, 0, y + h, S, 2, withAlpha(INK, 170));
    pipeH(s, y, h, stops);
  }
  for (let y = 49; y < 61; y++) {
    for (let x = 0; x < S; x++) {
      const n = fbmTile(x / 16, y / 8, 4, 8, 261, 3);
      if (n > 0.6) setPx(s, x, y, withAlpha(n > 0.66 ? RU[3] : RU[2], 200));
    }
  }
  // hanger straps
  for (const x of [12, 44]) {
    fillRect(s, x + 5, 0, 2, S, withAlpha(INK, 130));
    fillRect(s, x, 0, 5, S, ST[3]);
    fillRect(s, x, 0, 1, S, ST[5]);
    fillRect(s, x + 4, 0, 1, S, ST[1]);
    for (const y of [0, 15, 24, 38, 46, 61]) rivet(s, x + 1, y, ST[4]);
  }
  return s;
}

function ceilLight(base) {
  const s = clone(base);
  // housing fills the tile centre
  fillRect(s, 7, 15, 50, 34, INK);
  panel(s, 8, 16, 48, 32, ST[2], 0.4, 0.6);
  const warm = '#ffb84a';
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const dx = Math.max(0, Math.abs(x - 31.5) - 21), dy = Math.max(0, Math.abs(y - 31.5) - 11);
      const dist = Math.hypot(dx, dy);
      if (dist > 0 && dist < 16) setPx(s, x, y, withAlpha(warm, 150 * (1 - dist / 16) ** 2));
    }
  }
  // lens with two tubes
  fillRect(s, 10, 19, 44, 26, INK);
  fillRect(s, 11, 20, 42, 24, '#ffd070');
  for (const y of [22, 34]) {
    fillRect(s, 12, y, 40, 8, '#ffe9a8');
    fillRect(s, 13, y + 2, 38, 4, '#fffbe6');
  }
  for (let x = 17; x < 53; x += 7) fillRect(s, x, 20, 1, 24, '#e0a040');
  fillRect(s, 11, 31, 42, 2, '#d89838');
  for (const [x, y] of [[9, 17], [53, 17], [9, 45], [53, 45]]) {
    setPx(s, x, y, ST[7]);
    setPx(s, x + 1, y + 1, INK);
  }
  return s;
}

function ceilDark() {
  const s = tile('#0f1116');
  mottle(s, 271, 0.25, 3);
  for (const p of [0, 32]) {
    fillRect(s, 0, p, S, 4, ST[1]);
    fillRect(s, 0, p, S, 1, ST[2]);
    fillRect(s, 0, p + 3, S, 1, INK);
  }
  for (const p of [0, 32]) {
    fillRect(s, p, 0, 4, S, ST[1]);
    fillRect(s, p, 0, 1, S, ST[2]);
    fillRect(s, p + 3, 0, 1, S, INK);
  }
  for (const [x, y] of [[1, 1], [33, 1], [1, 33], [33, 33]]) rivet(s, x, y, ST[2]);
  return s;
}

// ---------------------------------------------------------------- sky

function skyTexture() {
  const W = SKY_W, H = SKY_H;
  const s = createSurface(W, H, '#000');
  const f = new Float32Array(W * H * 3);
  const put = (x, y, r, g, b, a = 1) => {
    if (y < 0 || y >= H) return;
    const k = (y * W + (((x % W) + W) % W)) * 3;
    f[k] += (r - f[k]) * a; f[k + 1] += (g - f[k + 1]) * a; f[k + 2] += (b - f[k + 2]) * a;
  };

  // space and nebula
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const u = x / 32, v = y / 32, g = y / H;
      const n1 = fbmTile(u, v, 8, 4, 301, 4);
      const n2 = fbmTile(u + 3.3, v + 1.7, 8, 4, 307, 4);
      const dust = fbmTile(u * 2, v * 2, 16, 8, 311, 3);
      const m1 = smooth(0.48, 0.78, n1) * (0.5 + dust);
      const m2 = smooth(0.5, 0.8, n2) * (0.5 + dust);
      put(x, y, 5 + 5 * g + 8 * m1 + 46 * m2, 6 + 6 * g + 44 * m1 + 10 * m2, 12 + 12 * g + 50 * m1 + 54 * m2);
    }
  }

  // stars
  for (let i = 0; i < 330; i++) {
    const x = Math.floor(hash2(i, 0, 321) * W), y = Math.floor(hash2(i, 1, 321) * H);
    const m = hash2(i, 2, 321), tint = hash2(i, 3, 321);
    const c = tint < 0.2 ? [255, 214, 160] : tint < 0.45 ? [170, 215, 255] : [235, 240, 255];
    put(x, y, c[0], c[1], c[2], m < 0.55 ? 0.35 : m < 0.88 ? 0.7 : 1);
    if (m > 0.95) {
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) put(x + dx, y + dy, c[0], c[1], c[2], 0.45);
    }
  }

  // ringed planet
  const PX = 170, PY = 62, PR = 36, tilt = -0.36, squash = 0.27;
  const ct = Math.cos(tilt), st = Math.sin(tilt);
  const ll = Math.hypot(-0.62, -0.5, 0.6);
  const L = [-0.62 / ll, -0.5 / ll, 0.6 / ll];
  const Lr = [L[0] * ct + L[1] * st, -L[0] * st + L[1] * ct, L[2]];
  const bands = [RU[2], RU[4], RU[5], RU[3], RU[6], RU[4], RU[5], RU[2], RU[3], RU[5], RU[1]];
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      let dx = x - PX;
      dx -= W * Math.round(dx / W);
      const dy = y - PY;
      const ex = dx * ct + dy * st, ey = -dx * st + dy * ct;
      const rr = (dx * dx + dy * dy) / (PR * PR);
      if (rr <= 1) {
        const nz = Math.sqrt(1 - rr);
        const lit = Math.max(0, (dx / PR) * L[0] + (dy / PR) * L[1] + nz * L[2]);
        const wob = (fbm(ex / 16, ey / 4, 331, 3) - 0.5) * 0.16;
        const c = ramp(bands, clamp01((ey / PR + wob) * 0.5 + 0.5));
        const k = 0.05 + 1.1 * Math.pow(lit, 0.85);
        let r = c[0] * k, g = c[1] * k, b = c[2] * k;
        if (nz < 0.3 && lit > 0.15) {
          const a = (1 - nz / 0.3) * 0.45 * lit;
          r += (255 - r) * a; g += (220 - g) * a; b += (180 - b) * a;
        }
        put(x, y, r, g, b);
      }
      const rho = Math.hypot(ex, ey / squash) / PR;
      if (rho > 1.3 && rho < 2.2 && (ey > 0 || rr > 1)) {
        const t = (rho - 1.3) / 0.9;
        let dens = t < 0.07 ? 0.3 : t < 0.42 ? 0.85 : t < 0.5 ? 0.06 : t < 0.86 ? 0.62 : 0.28;
        dens *= 0.75 + 0.5 * hash2(Math.floor(t * 30), 0, 337);
        // planet shadow across the far side of the ring
        const p = [ex, ey, (ey / squash) * Math.sqrt(1 - squash * squash)];
        const along = p[0] * Lr[0] + p[1] * Lr[1] + p[2] * Lr[2];
        const perp = Math.hypot(p[0] - along * Lr[0], p[1] - along * Lr[1], p[2] - along * Lr[2]);
        const shadow = along < 0 && perp < PR ? 0.12 : 1;
        const base = t < 0.42 ? [226, 190, 146] : [176, 150, 132];
        put(x, y, base[0] * shadow, base[1] * shadow, base[2] * shadow, Math.min(1, dens));
      }
    }
  }

  // small cratered moon
  const MX = 46, MY = 30, MR = 9;
  for (let y = MY - MR; y <= MY + MR; y++) {
    for (let x = MX - MR; x <= MX + MR; x++) {
      const dx = x - MX, dy = y - MY, rr = (dx * dx + dy * dy) / (MR * MR);
      if (rr > 1) continue;
      const nz = Math.sqrt(1 - rr);
      let lit = Math.max(0, (dx / MR) * L[0] + (dy / MR) * L[1] + nz * L[2]);
      for (const [cx, cy, cr] of [[-3, -2, 2.4], [2, 3, 1.8], [3, -4, 1.4], [-4, 4, 1.3]]) {
        const cd = Math.hypot(dx - cx, dy - cy);
        if (cd < cr) lit *= 0.62;
        else if (cd < cr + 1 && dx - cx + dy - cy > 0) lit *= 1.25;
      }
      const k = 0.06 + 1.05 * lit;
      put(x, y, 150 * k, 158 * k, 172 * k);
    }
  }

  // ordered dither to 5 bits per channel: crisp, no banding
  const d = s.data;
  for (let y = 0, k = 0, i = 0; y < H; y++) {
    for (let x = 0; x < W; x++, k += 3, i += 4) {
      const o = (bayer(x, y) - 0.5) * 8;
      d[i] = Math.round((f[k] + o) / 8) * 8;
      d[i + 1] = Math.round((f[k + 1] + o) / 8) * 8;
      d[i + 2] = Math.round((f[k + 2] + o) / 8) * 8;
      d[i + 3] = 255;
    }
  }
  return s;
}

// ---------------------------------------------------------------- build

export function buildTextures() {
  const out = {};
  const add = (name, surfaces, fps = 0) => {
    const list = Array.isArray(surfaces) ? surfaces : [surfaces];
    out[name] = {
      w: list[0].w,
      h: list[0].h,
      frames: list.map((f) => f.data),
      fps,
      fullbright: TEXTURE_FULLBRIGHT.includes(name),
    };
  };

  const plate = plateWall();
  add('w_plate', plate);
  add('w_rust', rustWall());
  add('w_brick', brickWall());
  add('w_pipes', pipeWall());
  add('w_grate', grateWall());
  add('w_hazard', hazardWall());
  add('w_concrete', concreteWall());
  add('w_panel', techPanel());
  add('w_crate', crateWall());
  add('w_rock', rock(281, 5, 0.34, 0.6, 5));
  add('w_furnace', furnaceWall());
  add('w_screen', [screenWall(0), screenWall(1)], 2);
  add('w_door', door(null));
  add('w_door_amber', door('amber'));
  add('w_door_cyan', door('cyan'));
  add('w_door_magenta', door('magenta'));
  add('w_switch_off', switchWall(plate, false));
  add('w_switch_on', switchWall(plate, true));
  add('w_exit_off', exitWall(plate, false));
  add('w_exit_on', exitWall(plate, true));

  add('f_plate', plateFlat());
  add('f_grate', grateFlat());
  add('f_concrete', concreteFlat());
  add('f_hazard', hazardFlat());
  add('f_rust', rustFlat());
  add('f_rock', rock(291, 6, 0.2, 0.5, 8));
  add('f_lift', liftFlat());
  add('f_slag', slagFrames(), 5);
  add('f_coolant', coolantFrames(), 5);
  add('c_panel', ceilPanel(true));
  add('c_pipes', ceilPipes());
  add('c_light', ceilLight(ceilPanel(false)));
  add('c_dark', ceilDark());

  add(SKY, skyTexture());
  return out;
}
