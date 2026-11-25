// Texture self-check and preview images.
//
//   node tools/test-textures.mjs [outDir] [--scene wall,floor,ceil[,light]]
//
// Checks the contract shape, determinism, opacity, exact wrap of the animation loops and
// build time, then writes:
//   tiles-<n>.png     every texture repeated 2 x 2 at 2x (seam check)
//   scene-<n>.png     small software-rendered corridors at 240 lines with light and fog,
//                     to judge the art the way the game shows it

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildTextures } from '../src/assets/textures.js';
import {
  TEXTURE_NAMES, TEXTURE_SIZE, TEXTURE_FRAMES, TEXTURE_FULLBRIGHT, SKY, SKY_W, SKY_H, FOV_Y_DEG,
} from '../src/config.js';
import { createSurface, fillRect, blit, drawText } from '../src/core/pix.js';
import { writePNG, upscale } from './png.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const sceneArg = argv.includes('--scene') ? argv[argv.indexOf('--scene') + 1] : null;
const out = path.resolve(argv[0] && !argv[0].startsWith('--') ? argv[0] : path.join(root, 'out/textures'));

let failed = 0;
const check = (ok, msg) => {
  if (!ok) {
    failed++;
    console.error(`FAIL ${msg}`);
  }
};

// warm up, then time
buildTextures();
const times = [];
let tex;
for (let i = 0; i < 5; i++) {
  const t0 = performance.now();
  tex = buildTextures();
  times.push(performance.now() - t0);
}
times.sort((a, b) => a - b);
console.log(`build time: median ${times[2].toFixed(0)} ms, worst ${times[4].toFixed(0)} ms`);
check(times[2] < 300, 'build takes 300 ms or more');

const again = buildTextures();
check(Object.keys(tex).length === TEXTURE_NAMES.length, 'texture count');
for (const name of TEXTURE_NAMES) {
  const t = tex[name];
  if (!t) {
    check(false, `missing ${name}`);
    continue;
  }
  const [w, h] = name === SKY ? [SKY_W, SKY_H] : [TEXTURE_SIZE, TEXTURE_SIZE];
  check(t.w === w && t.h === h, `${name} size`);
  check(t.frames.length === (TEXTURE_FRAMES[name] || 1), `${name} frame count`);
  check(t.fullbright === TEXTURE_FULLBRIGHT.includes(name), `${name} fullbright`);
  check(t.frames.length === 1 ? t.fps === 0 : t.fps > 0, `${name} fps`);
  let lum = 0;
  t.frames.forEach((f, i) => {
    check(f instanceof Uint8ClampedArray && f.length === w * h * 4, `${name}#${i} data`);
    let opaque = true, same = true;
    const g = again[name].frames[i];
    for (let k = 0; k < f.length; k += 4) {
      if (f[k + 3] !== 255) opaque = false;
      if (f[k] !== g[k] || f[k + 1] !== g[k + 1] || f[k + 2] !== g[k + 2]) same = false;
      if (i === 0) lum += 0.299 * f[k] + 0.587 * f[k + 1] + 0.114 * f[k + 2];
    }
    check(opaque, `${name}#${i} opaque`);
    check(same, `${name}#${i} deterministic`);
  });
  // consecutive frames of a loop must differ, and by a similar amount all the way round
  if (t.frames.length > 2) {
    const diffs = t.frames.map((f, i) => {
      const g = t.frames[(i + 1) % t.frames.length];
      let sum = 0;
      for (let k = 0; k < f.length; k++) sum += Math.abs(f[k] - g[k]);
      return sum / f.length;
    });
    const lo = Math.min(...diffs), hi = Math.max(...diffs);
    console.log(`${name} loop step differences: ${diffs.map((v) => v.toFixed(1)).join(' ')}`);
    check(lo > 1 && hi / lo < 1.5, `${name} loop is uneven`);
  }
  if (process.env.LUMA) console.log(`${name.padEnd(16)} mean luma ${(lum / (w * h)).toFixed(0)}`);
}

// ---- tiled previews

const surf = (name, frame = 0) => ({ w: tex[name].w, h: tex[name].h, data: tex[name].frames[frame] });
const flat = TEXTURE_NAMES.filter((n) => n !== SKY);
const perSheet = 8;
for (let p = 0; p * perSheet < flat.length; p++) {
  const names = flat.slice(p * perSheet, (p + 1) * perSheet);
  const cell = 128 * 2 + 8;
  const sheet = createSurface(4 * cell + 8, Math.ceil(names.length / 4) * (cell + 12) + 8, '#30343c');
  names.forEach((name, i) => {
    const x = 8 + (i % 4) * cell, y = 8 + Math.floor(i / 4) * (cell + 12);
    const t = createSurface(128, 128);
    for (let j = 0; j < 2; j++) for (let k = 0; k < 2; k++) blit(t, surf(name), k * 64, j * 64);
    drawText(sheet, name, x, y, '#ffae1a', 2);
    blit(sheet, upscale(t, 2), x, y + 12);
  });
  console.log(`wrote ${writePNG(path.join(out, `tiles-${p}.png`), sheet)}`);
}
{
  const t = createSurface(SKY_W * 2, SKY_H);
  blit(t, surf(SKY), 0, 0);
  blit(t, surf(SKY), SKY_W, 0);
  console.log(`wrote ${writePNG(path.join(out, 'tiles-sky.png'), upscale(t, 2))}`);
}

// ---- corridor scenes

// A straight corridor along +x, 2 units wide, seen from the middle. `ends` is the texture on
// the wall that closes the corridor at distance `depth`.
function renderScene({ wall, floor, ceil, end, light = 0.75, height = 1.25, depth = 6, yaw = 0.18, frame = 0 }) {
  const H = 240, W = 426;
  const img = createSurface(W, H, '#000');
  const tanY = Math.tan((FOV_Y_DEG * Math.PI) / 360);
  const eye = 0.62, cy = 1.0;
  const cosY = Math.cos(yaw), sinY = Math.sin(yaw);
  const sample = (name, u, v) => {
    const t = tex[name];
    const f = t.frames[Math.min(frame, t.frames.length - 1)];
    const x = ((Math.floor(u * 64) % t.w) + t.w) % t.w, y = ((Math.floor(v * 64) % t.h) + t.h) % t.h;
    const k = (y * t.w + x) * 4;
    return [f[k], f[k + 1], f[k + 2], t.fullbright];
  };
  for (let py = 0; py < H; py++) {
    for (let px = 0; px < W; px++) {
      const sx = ((px + 0.5) / W * 2 - 1) * tanY * (W / H), sz = (1 - (py + 0.5) / H * 2) * tanY;
      // camera space: forward 1, right sx, up sz
      const dx = cosY - sx * sinY, dy = sinY + sx * cosY, dz = sz;
      let best = 1e9, c = null, side = 1;
      const tryHit = (t, name, uv, shade = 1) => {
        if (t > 0.001 && t < best) {
          const p = [dx * t, cy + dy * t, eye + dz * t];
          if (p[2] < -0.001 || p[2] > height + 0.001 || p[1] < -0.001 || p[1] > 2.001 || p[0] > depth + 0.001) return;
          best = t;
          c = sample(name, ...uv(p));
          side = shade;
        }
      };
      if (dz < 0) tryHit(-eye / dz, floor, (p) => [p[0], p[1]]);
      if (dz > 0) {
        if (ceil === SKY) {
          // not hit-tested: drawn below
        } else tryHit((height - eye) / dz, ceil, (p) => [p[0], p[1]]);
      }
      if (dy < 0) tryHit(-cy / dy, wall, (p) => [p[0], -p[2]]);
      if (dy > 0) tryHit((2 - cy) / dy, wall, (p) => [-p[0], -p[2]]);
      if (dx > 0) tryHit(depth / dx, end || wall, (p) => [p[1], -p[2]], 0.85);
      let r, g, b;
      if (!c) {
        const ang = Math.atan2(dy, dx);
        const s = sample(SKY, (ang / (Math.PI * 2)) * (SKY_W / 64) * 2, ((py / H) * SKY_H) / 64);
        [r, g, b] = s;
      } else if (c[3]) {
        [r, g, b] = c;
      } else {
        const fog = Math.max(0.12, 1 - best / 14);
        const k = light * side * fog;
        r = c[0] * k; g = c[1] * k; b = c[2] * k;
      }
      const i = (py * W + px) * 4;
      img.data[i] = r; img.data[i + 1] = g; img.data[i + 2] = b; img.data[i + 3] = 255;
    }
  }
  return img;
}

const scenes = sceneArg
  ? [(() => {
    const [wall, floor, ceil, light, end] = sceneArg.split(',');
    return { wall, floor, ceil, light: Number(light) || 0.75, end: end || undefined };
  })()]
  : [
    { wall: 'w_plate', floor: 'f_plate', ceil: 'c_panel', end: 'w_door' },
    { wall: 'w_rust', floor: 'f_rust', ceil: 'c_pipes', end: 'w_door_amber', light: 0.6 },
    { wall: 'w_brick', floor: 'f_concrete', ceil: 'c_dark', end: 'w_furnace', light: 0.65 },
    { wall: 'w_pipes', floor: 'f_grate', ceil: 'c_light', end: 'w_switch_off' },
    { wall: 'w_concrete', floor: 'f_hazard', ceil: 'c_panel', end: 'w_door_cyan', height: 1.5 },
    { wall: 'w_crate', floor: 'f_lift', ceil: 'c_panel', end: 'w_exit_off' },
    { wall: 'w_rock', floor: 'f_rock', ceil: SKY, end: 'w_door_magenta', height: 2 },
    { wall: 'w_hazard', floor: 'f_slag', ceil: 'c_dark', end: 'w_grate', light: 0.5 },
    { wall: 'w_panel', floor: 'f_coolant', ceil: 'c_pipes', end: 'w_screen', light: 0.6 },
    { wall: 'w_grate', floor: 'f_plate', ceil: 'c_light', end: 'w_exit_on', depth: 3 },
    { wall: 'w_screen', floor: 'f_concrete', ceil: 'c_panel', end: 'w_switch_on', depth: 3 },
    { wall: 'w_furnace', floor: 'f_rust', ceil: 'c_dark', end: 'w_door', light: 0.55, depth: 4 },
  ];
for (let p = 0; p * 4 < scenes.length; p++) {
  const group = scenes.slice(p * 4, p * 4 + 4);
  const sheet = createSurface(2 * 426 + 12, Math.ceil(group.length / 2) * 252 + 4, '#101216');
  group.forEach((sc, i) => {
    const x = 4 + (i % 2) * 430, y = 4 + Math.floor(i / 2) * 252;
    blit(sheet, renderScene(sc), x, y);
    fillRect(sheet, x, y, 426, 9, '#000000a0');
    drawText(sheet, `${sc.wall} ${sc.floor} ${sc.ceil} ${sc.end || ''}`, x + 2, y + 2, '#ffae1a');
  });
  console.log(`wrote ${writePNG(path.join(out, `scene-${p}.png`), upscale(sheet, sceneArg ? 2 : 1))}`);
}

console.log(failed ? `${failed} check(s) failed` : 'all checks passed');
process.exit(failed ? 1 : 0);
