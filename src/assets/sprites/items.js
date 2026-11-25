// Pickups, props and effects. Every frame is drawn at its SPRITE_SIZES size.

import { SPRITE_SIZES, KEY_COLORS, KEY_NAMES, FX_SPRITES } from '../../config.js';
import {
  createSurface, fillRect, strokeRect, bevel, gradRect, line, fillCircle, strokeCircle,
  fillEllipse, strokeEllipse, fillPoly, setPx, outline, hardenAlpha, lighten, darken,
  hash2, fbm, bayer, drawText, blit,
} from '../../core/pix.js';

const INK = '#0c0c10';
const ST0 = '#1c2028', ST1 = '#343b47', ST2 = '#525c6b', ST3 = '#7d8898', ST4 = '#aab4c2', ST5 = '#dde4ee';
const BOX = ['#383c34', '#687060', '#a0a890'];       // ammo container: dark, mid, light
const RIVET_C = '#ffd23a', SHELL_C = '#e8302a', CAN_C = '#ff7a1a';   // stripe per ammo type
const BRASS = '#f2c230', BRASS_L = '#fff0a0', BRASS_D = '#a8761a';
const GEL = '#2fe06a', GEL_L = '#b8ffd0', GEL_D = '#149a44';
const CASE = ['#98a49e', '#eef2ee', '#ffffff'];
const AR0 = '#17336a', AR1 = '#2c62b4', AR2 = '#4a90e2', AR3 = '#9ccfff', AR4 = '#e8f5ff';
const GRIP = '#a8582a', GRIP_L = '#dc8c4c', GRIP_D = '#6a3214';
const TAU = Math.PI * 2;

function erase(s, x, y, w, h) {
  for (let j = y; j < y + h; j++) {
    for (let i = x; i < x + w; i++) s.data.fill(0, (j * s.w + i) * 4, (j * s.w + i) * 4 + 4);
  }
}

// Slide the art vertically until it touches the anchored edge of the frame.
function settle(s, anchor) {
  if (anchor === 'center') return;
  const { w, h, data } = s, row = w * 4;
  let top = -1, bottom = -1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (data[(y * w + x) * 4 + 3]) {
        if (top < 0) top = y;
        bottom = y;
        break;
      }
    }
  }
  if (top < 0) return;
  if (anchor === 'bottom' && bottom < h - 1) {
    const dy = h - 1 - bottom;
    data.copyWithin(dy * row, 0, (h - dy) * row);
    data.fill(0, 0, dy * row);
  } else if (anchor === 'top' && top > 0) {
    data.copyWithin(0, top * row);
    data.fill(0, (h - top) * row);
  }
}

function box(s, x, y, w, h, [dark, mid, light]) {
  fillRect(s, x, y, w, h, mid);
  bevel(s, x, y, w, h, light, dark);
}

// A band wrapped around an upright cylinder: lit from the left.
function band(s, x, y, w, h, c) {
  gradRect(s, x, y, w, h, [lighten(c, 0.35), c, c, darken(c, 0.3), darken(c, 0.55)], 'h');
}

// Disc with a wobbly edge. colorAt(d, x, y) gets d = 0 at the centre .. 1 at the edge and
// may return null to leave the pixel alone.
function lump(s, cx, cy, r, amp, seed, colorAt) {
  const reach = Math.ceil(r * (1 + amp)) + 1;
  for (let y = Math.floor(cy - reach); y <= cy + reach; y++) {
    for (let x = Math.floor(cx - reach); x <= cx + reach; x++) {
      const dx = x - cx, dy = y - cy, dist = Math.hypot(dx, dy) || 1e-6;
      const n = fbm(1.7 * dx / dist + 5.3, 1.7 * dy / dist + 9.1, seed, 3);
      const d = dist / (r * (1 + amp * (n - 0.5) * 2));
      const c = d <= 1 ? colorAt(d, x, y) : null;
      if (c) setPx(s, x, y, c);
    }
  }
}

function fire(h) {
  return h > 0.86 ? '#ffffff' : h > 0.68 ? '#fff3a6' : h > 0.5 ? '#ffc93a' : h > 0.34 ? '#ff8c1c'
    : h > 0.2 ? '#d9441a' : '#84260f';
}

// ---------------------------------------------------------------- ammo

function rivets(s) {
  for (let i = 0; i < 4; i++) {
    const x = 2 + i * 4;
    fillRect(s, x, 3, 3, 1, '#ffffff');
    fillRect(s, x, 4, 3, 1, ST4);
    fillRect(s, x + 1, 5, 1, 2, ST5);
  }
  box(s, 2, 7, 16, 8, BOX);
  fillRect(s, 2, 9, 16, 4, RIVET_C);
  fillRect(s, 2, 9, 16, 1, lighten(RIVET_C, 0.5));
  fillRect(s, 2, 12, 16, 1, darken(RIVET_C, 0.3));
}

function rivetBox(s) {
  fillRect(s, 2, 5, 24, 2, BOX[0]);
  for (let i = 0; i < 6; i++) {
    const x = 3 + i * 4;
    fillRect(s, x, 3, 3, 1, '#ffffff');
    fillRect(s, x, 4, 3, 1, ST4);
    fillRect(s, x + 1, 5, 1, 2, ST5);
  }
  box(s, 1, 7, 26, 13, BOX);
  fillRect(s, 1, 10, 26, 7, RIVET_C);
  fillRect(s, 1, 10, 26, 1, lighten(RIVET_C, 0.5));
  fillRect(s, 1, 16, 26, 1, darken(RIVET_C, 0.3));
  drawText(s, 'RIV', 8, 11, '#4a3206');
  setPx(s, 3, 8, ST4); setPx(s, 24, 8, ST4);
  setPx(s, 3, 18, ST4); setPx(s, 24, 18, ST4);
}

function shell(s, x, y, h) {
  fillRect(s, x, y, 3, 1, '#8a1a16');
  fillRect(s, x, y + 1, 3, h - 1, SHELL_C);
  fillRect(s, x, y + 1, 1, h - 1, lighten(SHELL_C, 0.45));
  fillRect(s, x + 2, y + 1, 1, h - 1, darken(SHELL_C, 0.35));
}

function shells(s) {
  for (let i = 0; i < 4; i++) {
    const x = 3 + i * 4;
    shell(s, x, 2, 8);
    fillRect(s, x, 10, 3, 3, BRASS);
    setPx(s, x, 10, BRASS_L);
    fillRect(s, x, 12, 3, 1, BRASS_D);
  }
}

function shellBox(s) {
  for (let i = 0; i < 6; i++) shell(s, 2 + i * 4, 2, 4);
  box(s, 1, 6, 26, 12, BOX);
  fillRect(s, 1, 9, 26, 6, SHELL_C);
  fillRect(s, 1, 9, 26, 1, lighten(SHELL_C, 0.4));
  fillRect(s, 1, 14, 26, 1, darken(SHELL_C, 0.35));
  for (let i = 0; i < 3; i++) {
    const x = 7 + i * 5;
    fillRect(s, x, 10, 4, 4, BRASS);
    fillRect(s, x, 10, 4, 1, BRASS_L);
    fillRect(s, x + 1, 11, 2, 2, BRASS_D);
  }
}

function canister(s) {
  fillPoly(s, [[6, 1], [7, 1], [10, 5], [3, 5]], CAN_C);
  setPx(s, 6, 2, lighten(CAN_C, 0.6)); setPx(s, 5, 3, lighten(CAN_C, 0.6)); setPx(s, 4, 4, lighten(CAN_C, 0.6));
  setPx(s, 9, 4, darken(CAN_C, 0.35)); setPx(s, 9, 5, darken(CAN_C, 0.35)); setPx(s, 10, 5, darken(CAN_C, 0.35));
  gradRect(s, 3, 6, 8, 12, [ST4, ST5, ST4, ST3, ST2, ST1], 'h');
  band(s, 3, 8, 8, 3, CAN_C);
  fillRect(s, 3, 15, 8, 1, ST1);
  fillRect(s, 2, 18, 10, 3, ST1);
  fillRect(s, 2, 18, 10, 1, ST3);
  setPx(s, 3, 18, ST5);
}

function canisterCrate(s) {
  for (let i = 0; i < 4; i++) {
    const x = 3 + i * 6;
    fillPoly(s, [[x + 2, 2], [x + 4, 6], [x, 6]], CAN_C);
    setPx(s, x + 2, 3, lighten(CAN_C, 0.6)); setPx(s, x + 1, 5, lighten(CAN_C, 0.6));
    setPx(s, x + 4, 6, darken(CAN_C, 0.35));
    fillRect(s, x, 7, 5, 2, ST3);
    setPx(s, x, 7, ST5);
    setPx(s, x + 4, 7, ST1); setPx(s, x + 4, 8, ST1);
  }
  box(s, 1, 9, 28, 13, BOX);
  fillRect(s, 1, 12, 28, 6, CAN_C);
  fillRect(s, 1, 12, 28, 1, lighten(CAN_C, 0.45));
  fillRect(s, 1, 17, 28, 1, darken(CAN_C, 0.35));
  for (let x = 3; x < 27; x += 6) {
    line(s, x, 16, x + 3, 13, '#3a1a06');
    line(s, x + 1, 16, x + 4, 13, '#3a1a06');
  }
  for (const [x, y] of [[1, 9], [26, 9], [1, 19], [26, 19]]) fillRect(s, x, y, 3, 3, ST2);
  setPx(s, 2, 10, ST5); setPx(s, 27, 10, ST5); setPx(s, 2, 20, ST5); setPx(s, 27, 20, ST5);
}

// ---------------------------------------------------------------- health and armor

// The medical mark: a green gel drop.
function gelDrop(s, cx, top, r) {
  const d = createSurface(s.w, s.h), cy = top + r * 1.6 + 1;
  fillCircle(d, cx, cy, r, GEL);
  fillPoly(d, [[Math.floor(cx), top], [Math.ceil(cx), top], [cx + r - 0.5, cy - 1], [cx - r + 0.5, cy - 1]], GEL);
  d.atop = true;
  fillCircle(d, cx + r * 0.8, cy + r * 0.8, r * 0.9, GEL_D);
  setPx(d, cx - r * 0.45, cy - 1, '#ffffff');
  setPx(d, cx - r * 0.45, cy, GEL_L);
  d.atop = false;
  outline(d, '#0c5c2a');
  blit(s, d, 0, 0);
}

function medGel(s) {
  fillRect(s, 4, 1, 6, 3, '#eef2ee');
  fillRect(s, 4, 1, 1, 3, '#ffffff');
  fillRect(s, 4, 3, 6, 1, '#9aa6a0');
  fillRect(s, 5, 4, 4, 1, '#b4c4bc');
  fillRect(s, 3, 5, 8, 11, '#e4f6ea');
  fillRect(s, 2, 6, 10, 9, '#e4f6ea');
  fillRect(s, 3, 8, 8, 8, GEL);
  fillRect(s, 2, 8, 10, 7, GEL);
  fillRect(s, 2, 8, 10, 1, GEL_L);
  fillRect(s, 10, 9, 2, 6, GEL_D);
  fillRect(s, 4, 15, 7, 1, GEL_D);
  fillRect(s, 4, 6, 1, 2, '#ffffff');
  fillRect(s, 4, 10, 1, 4, GEL_L);
  setPx(s, 7, 11, GEL_L); setPx(s, 8, 13, GEL_L);
}

function medKit(s) {
  strokeRect(s, 9, 1, 8, 5, ST2);
  fillRect(s, 9, 1, 8, 1, ST4);
  box(s, 1, 4, 24, 14, CASE);
  fillRect(s, 2, 16, 22, 1, '#c4cec8');
  fillRect(s, 2, 8, 22, 1, '#aab6b0');
  fillRect(s, 3, 7, 3, 3, ST3); setPx(s, 3, 7, ST5);
  fillRect(s, 20, 7, 3, 3, ST3); setPx(s, 20, 7, ST5);
  gelDrop(s, 12.5, 6, 3);
}

function vest(s) {
  fillPoly(s, [[5, 1], [9, 1], [11, 5], [16, 5], [18, 1], [22, 1], [24, 4], [23, 9], [25, 12],
    [24, 23], [21, 24], [6, 24], [3, 23], [2, 12], [4, 9], [3, 4]], AR2);
  s.atop = true;
  fillRect(s, 0, 12, 28, 6, AR1);
  fillRect(s, 0, 18, 28, 8, darken(AR1, 0.15));
  fillRect(s, 19, 0, 9, 26, [8, 16, 44, 90]);
  fillRect(s, 0, 11, 28, 1, AR0);
  fillRect(s, 0, 17, 28, 1, AR0);
  fillRect(s, 0, 12, 19, 1, AR2);
  fillRect(s, 0, 18, 19, 1, AR2);
  fillRect(s, 13, 5, 2, 7, AR1);
  line(s, 5, 1, 3, 4, AR3); line(s, 3, 4, 4, 9, AR3); line(s, 4, 9, 2, 12, AR3);
  fillRect(s, 5, 1, 4, 1, AR4);
  fillRect(s, 18, 1, 4, 1, AR3);
  fillRect(s, 6, 6, 5, 1, AR3); fillRect(s, 6, 7, 3, 1, AR3);
  fillRect(s, 16, 6, 4, 1, AR3);
  for (const [x, y] of [[5, 14], [22, 14], [6, 21], [21, 21], [13, 14], [14, 21]]) setPx(s, x, y, AR4);
  s.atop = false;
  fillRect(s, 1, 14, 2, 3, ST3); setPx(s, 1, 14, ST5);
  fillRect(s, 25, 14, 2, 3, ST2);
}

function heavyArmor(s) {
  fillPoly(s, [[9, 3], [20, 3], [23, 7], [24, 19], [21, 27], [8, 27], [5, 19], [6, 7]], AR2);
  s.atop = true;
  fillRect(s, 0, 17, 30, 4, AR1);
  fillRect(s, 0, 21, 30, 3, darken(AR1, 0.12));
  fillRect(s, 0, 24, 30, 4, darken(AR1, 0.25));
  fillRect(s, 19, 0, 11, 30, [8, 16, 44, 80]);
  for (const y of [16, 20, 23]) {
    fillRect(s, 0, y, 30, 1, AR0);
    fillRect(s, 0, y + 1, 19, 1, AR2);
  }
  fillRect(s, 8, 5, 5, 1, AR3); fillRect(s, 8, 6, 3, 1, AR3);
  s.atop = false;
  fillRect(s, 11, 1, 8, 3, AR1);
  fillRect(s, 11, 1, 8, 1, AR3);
  fillRect(s, 17, 2, 2, 2, AR0);
  for (const cx of [5, 24]) {
    fillCircle(s, cx, 8, 4, AR1);
    fillCircle(s, cx - 0.5, 7.5, 3, AR2);
    fillCircle(s, cx - 1, 7, 2, AR3);
    setPx(s, cx - 2, 6, AR4);
    fillRect(s, cx - 3, 12, 7, 1, AR0);
  }
  fillCircle(s, 14.5, 11, 3.2, AR0);
  fillCircle(s, 14.5, 11, 2.2, '#35c8ff');
  fillCircle(s, 14, 10.5, 1, '#c8f6ff');
  setPx(s, 14, 10, '#ffffff');
  for (const [x, y] of [[8, 14], [21, 14], [9, 25], [20, 25]]) setPx(s, x, y, AR4);
}

// ---------------------------------------------------------------- keys

function keyCard(s, index, c) {
  fillRect(s, 2, 3, 12, 20, c);
  fillRect(s, 2, 3, 12, 1, lighten(c, 0.55));
  fillRect(s, 2, 3, 1, 20, lighten(c, 0.55));
  fillRect(s, 13, 4, 1, 19, darken(c, 0.35));
  fillRect(s, 3, 22, 11, 1, darken(c, 0.35));
  fillRect(s, 6, 5, 4, 2, INK);
  fillRect(s, 6, 7, 4, 1, lighten(c, 0.4));
  for (let i = 0; i <= index; i++) {
    fillRect(s, 4, 9 + i * 3, 5, 2, lighten(c, 0.8));
    fillRect(s, 4, 10 + i * 3, 5, 1, lighten(c, 0.5));
  }
  fillRect(s, 3, 19, 10, 3, darken(c, 0.6));
  fillRect(s, 4, 20, 3, 1, lighten(c, 0.7));
  setPx(s, 11, 20, lighten(c, 0.3));
  erase(s, 2, 3, 1, 1);
  erase(s, 13, 3, 1, 1);
  for (const y of [[12], [10, 14], [8, 12, 16]][index]) erase(s, 12, y, 2, 2);
}

// ---------------------------------------------------------------- weapon pickups (side view, muzzle right)

function scattergun(s) {
  fillPoly(s, [[12, 4], [1, 6], [1, 13], [4, 13], [9, 10], [12, 9]], GRIP);
  line(s, 12, 4, 1, 6, GRIP_L);
  fillRect(s, 1, 7, 1, 7, GRIP_D);
  line(s, 4, 13, 9, 10, GRIP_D);
  fillRect(s, 12, 3, 12, 7, ST3);
  fillRect(s, 12, 3, 12, 1, ST5);
  fillRect(s, 12, 8, 12, 2, ST1);
  fillRect(s, 15, 5, 6, 2, SHELL_C);
  fillRect(s, 15, 5, 6, 1, lighten(SHELL_C, 0.45));
  fillRect(s, 24, 3, 26, 1, ST5);
  fillRect(s, 24, 4, 26, 1, ST4);
  fillRect(s, 24, 5, 26, 1, ST2);
  fillRect(s, 49, 2, 2, 5, ST3);
  fillRect(s, 49, 2, 2, 1, ST5);
  fillRect(s, 47, 1, 1, 2, SHELL_C);
  fillRect(s, 24, 7, 22, 2, ST1);
  fillRect(s, 24, 7, 22, 1, ST3);
  fillRect(s, 45, 6, 2, 3, ST4);
  fillRect(s, 28, 6, 12, 5, GRIP);
  fillRect(s, 28, 6, 12, 1, GRIP_L);
  for (let x = 29; x < 40; x += 2) fillRect(s, x, 7, 1, 3, GRIP_D);
  strokeRect(s, 16, 10, 5, 4, ST2);
  setPx(s, 18, 11, ST5);
}

function boltDriver(s) {
  fillRect(s, 14, 1, 14, 2, ST3);
  fillRect(s, 14, 1, 14, 1, ST5);
  fillRect(s, 14, 3, 2, 2, ST2);
  fillRect(s, 26, 3, 2, 2, ST2);
  fillPoly(s, [[3, 8], [8, 6], [8, 13], [7, 19], [3, 19], [4, 13]], GRIP_D);
  line(s, 3, 8, 4, 13, GRIP); line(s, 4, 13, 3, 19, GRIP);
  fillRect(s, 8, 5, 22, 9, ST3);
  fillRect(s, 8, 5, 22, 1, ST5);
  fillRect(s, 8, 12, 22, 2, ST1);
  fillRect(s, 10, 7, 19, 3, RIVET_C);
  fillRect(s, 10, 7, 19, 1, lighten(RIVET_C, 0.5));
  fillRect(s, 10, 9, 19, 1, darken(RIVET_C, 0.3));
  for (let x = 12; x < 27; x += 4) fillRect(s, x, 8, 2, 1, '#4a3206');
  fillRect(s, 30, 6, 16, 7, ST2);
  fillRect(s, 30, 6, 16, 1, ST4);
  fillRect(s, 30, 12, 16, 1, ST0);
  for (let x = 32; x < 45; x += 3) {
    fillRect(s, x, 8, 2, 1, ST0);
    fillRect(s, x, 10, 2, 1, ST0);
  }
  fillRect(s, 46, 7, 4, 5, ST0);
  fillRect(s, 46, 7, 5, 1, ST5);
  fillRect(s, 46, 9, 5, 1, ST5);
  fillRect(s, 46, 11, 5, 1, ST4);
  fillRect(s, 34, 13, 4, 6, GRIP_D);
  fillRect(s, 34, 13, 1, 6, GRIP);
  fillCircle(s, 22.5, 16, 4.4, ST1);
  fillCircle(s, 22.5, 16, 3.4, ST3);
  strokeCircle(s, 22, 15.5, 2.8, ST5);
  fillCircle(s, 22.5, 16, 2.2, ST2);
  fillCircle(s, 22.5, 16, 1.2, RIVET_C);
  line(s, 9, 14, 9, 16, ST2); line(s, 9, 17, 12, 17, ST2);
  setPx(s, 11, 15, ST5);
}

function launcher(s) {
  fillPoly(s, [[7, 6], [1, 4], [1, 15], [7, 13]], ST2);
  line(s, 1, 4, 7, 6, ST4);
  fillRect(s, 1, 6, 1, 8, ST0);
  line(s, 2, 14, 7, 13, ST0);
  gradRect(s, 7, 6, 40, 8, [ST5, ST4, ST3, ST3, ST2, ST1], 'v');
  fillPoly(s, [[46, 6], [52, 3], [54, 3], [54, 16], [52, 16], [46, 13]], ST3);
  line(s, 46, 6, 52, 3, ST5);
  line(s, 46, 13, 52, 16, ST1);
  fillRect(s, 53, 4, 2, 12, ST0);
  fillRect(s, 53, 7, 1, 6, CAN_C);
  fillRect(s, 53, 9, 1, 2, '#ffd27a');
  const hot = [lighten(CAN_C, 0.55), CAN_C, CAN_C, darken(CAN_C, 0.2), darken(CAN_C, 0.5)];
  gradRect(s, 27, 6, 6, 8, hot, 'v');
  gradRect(s, 40, 6, 3, 8, hot, 'v');
  gradRect(s, 13, 6, 2, 8, hot, 'v');
  fillRect(s, 11, 6, 1, 8, ST1);
  fillRect(s, 18, 2, 8, 4, ST2);
  fillRect(s, 18, 2, 8, 1, ST4);
  fillRect(s, 24, 3, 2, 2, '#5ad8ff');
  fillRect(s, 9, 14, 8, 2, ST1);
  fillPoly(s, [[20, 14], [25, 14], [24, 21], [20, 21]], GRIP_D);
  line(s, 20, 14, 20, 21, GRIP);
  strokeRect(s, 25, 14, 5, 4, ST2);
  setPx(s, 26, 15, ST5);
  fillRect(s, 36, 14, 4, 6, GRIP_D);
  fillRect(s, 36, 14, 1, 6, GRIP);
}

// ---------------------------------------------------------------- props

function drum(s) {
  // silhouette first, then shade inside it
  fillRect(s, 2, 5, 22, 30, '#f00');
  fillEllipse(s, 12.5, 33.5, 10.6, 2.4, '#f00');
  fillRect(s, 1, 12, 24, 2, '#f00');
  fillRect(s, 1, 26, 24, 2, '#f00');
  s.atop = true;
  gradRect(s, 1, 0, 24, 38, ['#6a160c', '#c22c14', '#f2561e', '#ff7e36', '#ee4a1a', '#b0260f', '#6a140a', '#3c0a06'], 'h', true);
  gradRect(s, 2, 16, 22, 7, ['#b88a10', '#ffd21a', '#ffe66a', '#ffd21a', '#d8a814', '#8a6408', '#5a4004'], 'h');
  for (let y = 16; y < 23; y++) {
    for (let x = 2; x < 24; x++) if ((x + y) % 6 < 3) setPx(s, x, y, [16, 12, 10, 235]);
  }
  for (const y of [12, 26]) {
    fillRect(s, 0, y, 26, 1, [255, 220, 180, 70]);
    fillRect(s, 0, y + 1, 26, 1, [20, 0, 0, 110]);
  }
  fillRect(s, 0, 32, 26, 2, [20, 0, 0, 90]);
  fillRect(s, 0, 34, 26, 4, [20, 0, 0, 170]);
  s.atop = false;
  fillEllipse(s, 12.5, 5, 10.6, 2.4, '#ff9a5a');
  fillEllipse(s, 12.5, 5, 9, 1.4, '#a82a12');
  fillRect(s, 15, 4, 3, 2, ST1);
  setPx(s, 15, 4, ST4);
}

function lamp(s) {
  fillRect(s, 3, 70, 8, 3, ST2);
  fillRect(s, 3, 70, 8, 1, ST4);
  fillRect(s, 5, 66, 4, 4, ST2);
  fillRect(s, 5, 66, 1, 4, ST4);
  fillRect(s, 6, 15, 1, 51, ST4);
  fillRect(s, 7, 15, 1, 51, ST2);
  for (const y of [30, 50]) {
    fillRect(s, 5, y, 4, 2, ST3);
    setPx(s, 5, y, ST5);
  }
  fillRect(s, 2, 1, 10, 2, ST2);
  fillRect(s, 2, 1, 10, 1, ST4);
  fillRect(s, 5, 0, 4, 1, ST2);
  fillRect(s, 3, 3, 8, 9, '#ffae1a');
  fillRect(s, 4, 3, 6, 9, '#ffe26a');
  fillRect(s, 5, 4, 4, 7, '#fffbe0');
  fillRect(s, 3, 7, 8, 1, '#c87a0a');
  fillRect(s, 4, 12, 6, 3, ST2);
  fillRect(s, 4, 12, 6, 1, ST4);
}

function tank(s) {
  const T = ['#122a2c', '#27575a', '#4f9a96', '#8fd2c8', '#c8f2e8', '#7cc0b8', '#3f7f7c', '#1f4a4c', '#0f2628'];
  fillEllipse(s, 17.5, 14, 14.6, 9, T[2]);
  fillRect(s, 3, 14, 30, 55, T[2]);
  fillRect(s, 2, 23, 32, 3, T[2]);
  fillRect(s, 2, 57, 32, 3, T[2]);
  s.atop = true;
  gradRect(s, 2, 0, 32, 76, T, 'h', true);
  for (const y of [23, 57]) {
    fillRect(s, 0, y, 40, 1, [220, 255, 250, 80]);
    fillRect(s, 0, y + 2, 40, 1, [0, 20, 20, 130]);
    for (let x = 4; x < 33; x += 4) setPx(s, x, y + 1, [0, 24, 24, 150]);
  }
  fillRect(s, 0, 66, 40, 3, [0, 20, 20, 90]);
  s.atop = false;
  // sight glass
  fillRect(s, 12, 29, 9, 24, '#0c2022');
  fillRect(s, 13, 30, 7, 22, '#06302a');
  fillRect(s, 13, 37, 7, 15, '#2fe8a8');
  fillRect(s, 13, 37, 7, 1, '#d0fff0');
  fillRect(s, 18, 38, 2, 14, '#18a878');
  fillRect(s, 14, 39, 1, 11, '#a8ffe0');
  setPx(s, 16, 42, '#d0fff0'); setPx(s, 17, 47, '#d0fff0'); setPx(s, 15, 50, '#d0fff0');
  for (let y = 31; y < 52; y += 4) fillRect(s, 22, y, 2, 1, '#0f2628');
  fillRect(s, 19, 60, 13, 7, '#cfe6dc');
  fillRect(s, 19, 66, 13, 1, '#8fb4a8');
  drawText(s, 'CL4', 20, 61, '#12383a');
  // filler valve
  fillRect(s, 15, 2, 6, 4, ST2);
  fillRect(s, 15, 2, 1, 4, ST4);
  fillRect(s, 11, 1, 14, 2, '#d8361a');
  fillRect(s, 11, 1, 14, 1, '#ff7e56');
  // side pipe
  fillRect(s, 35, 31, 3, 36, ST2);
  fillRect(s, 35, 31, 1, 36, ST4);
  fillRect(s, 37, 31, 1, 36, ST1);
  fillRect(s, 33, 30, 6, 3, ST3);
  fillRect(s, 33, 65, 6, 3, ST3);
  fillRect(s, 34, 46, 5, 2, ST1);
  // skirt and feet
  fillRect(s, 4, 69, 28, 3, T[7]);
  fillRect(s, 4, 69, 28, 1, T[6]);
  for (const x of [4, 15, 27]) {
    fillRect(s, x, 72, 6, 3, ST1);
    fillRect(s, x, 72, 6, 1, ST3);
  }
}

function junk(s) {
  fillPoly(s, [[2, 20], [5, 15], [12, 12], [20, 8], [30, 9], [38, 12], [46, 16], [49, 20]], '#4a3324');
  s.atop = true;
  const rust = ['#33231a', '#4a3324', '#5e3e27', '#77502c'];
  for (let y = 0; y < 22; y++) {
    for (let x = 0; x < 52; x++) setPx(s, x, y, rust[Math.floor(hash2(x >> 1, y >> 1, 7) * 4)]);
  }
  s.atop = false;
  // leaning plate
  fillPoly(s, [[6, 19], [9, 6], [17, 8], [15, 19]], ST2);
  line(s, 9, 6, 6, 19, ST4);
  line(s, 9, 6, 17, 8, ST4);
  line(s, 17, 9, 15, 19, ST1);
  setPx(s, 10, 9, ST5); setPx(s, 14, 10, ST5); setPx(s, 9, 16, ST5); setPx(s, 13, 17, ST5);
  line(s, 11, 12, 13, 15, '#8a4a22');
  // gear
  fillCircle(s, 24, 12, 5, '#8a6a2e');
  for (let i = 0; i < 8; i++) {
    const a = i * TAU / 8 + 0.3;
    fillRect(s, Math.round(24 + Math.cos(a) * 6) - 0.5, Math.round(12 + Math.sin(a) * 6) - 0.5, 2, 2, '#8a6a2e');
  }
  strokeCircle(s, 23.5, 11.5, 3, '#c49a48');
  fillCircle(s, 24, 12, 1.6, '#2a1c12');
  fillRect(s, 18, 15, 13, 5, '#4a3324');
  // pipe
  line(s, 28, 17, 44, 7, ST2, 3);
  line(s, 28, 16, 44, 6, ST4);
  line(s, 29, 19, 45, 9, ST1);
  fillCircle(s, 44.5, 7, 2, ST0);
  // beam and hazard scrap
  fillRect(s, 34, 16, 12, 3, '#b8461c');
  fillRect(s, 34, 16, 12, 1, '#e87a3a');
  fillRect(s, 19, 17, 8, 3, '#ffd21a');
  for (let x = 20; x < 27; x += 3) fillRect(s, x, 17, 1, 3, INK);
  strokeEllipse(s, 9, 18, 5, 2, '#1a1a20');
  fillRect(s, 2, 20, 48, 1, '#33231a');
}

function cable(s) {
  fillRect(s, 2, 0, 8, 3, ST2);
  fillRect(s, 2, 0, 8, 1, ST4);
  fillRect(s, 4, 3, 5, 2, ST1);
  // thin frayed wire behind, heavy cable with a dangling plug in front
  for (let y = 5; y < 37; y++) {
    const tx = 8 - Math.round(1.4 * Math.sin((y - 5) / 6 + 1));
    setPx(s, tx, y, y % 6 < 3 ? '#d83a24' : '#8a1e14');
  }
  setPx(s, 9, 37, '#e8862a'); setPx(s, 7, 38, '#e8862a'); setPx(s, 8, 37, '#8a1e14');
  let x = 4;
  for (let y = 5; y < 56; y++) {
    x = 4 + Math.round(1.6 * Math.sin((y - 5) / 9));
    setPx(s, x, y, '#4a4a58');
    setPx(s, x + 1, y, '#22222a');
    if (y % 13 === 4) { setPx(s, x, y, ST5); setPx(s, x + 1, y, ST3); }
  }
  fillRect(s, x - 1, 56, 4, 4, ST2);
  fillRect(s, x - 1, 56, 1, 4, ST4);
  setPx(s, x, 60, '#e8862a'); setPx(s, x + 1, 61, '#e8862a');
  setPx(s, x, 62, '#fff3a6');
}

// ---------------------------------------------------------------- effects

function slag(s, f) {
  const cx = 9.5 + (f ? 0.6 : -0.4), cy = 9.5 + (f ? -0.5 : 0.4);
  lump(s, cx, cy, 6.2, 0.22, 3 + f * 17, (d, x, y) => fire(1.02 - d * d * 0.8 - ((x - cx) + (y - cy)) * 0.025));
  const drops = f ? [[2, 15, 2], [16, 3, 1], [15, 16, 1]] : [[15, 15, 2], [3, 4, 1], [3, 16, 1]];
  for (const [x, y, n] of drops) {
    fillRect(s, x, y, n, n, '#ff8c1c');
    setPx(s, x, y, '#ffc93a');
  }
  outline(s, '#5a1406');
}

function bolt(s, f) {
  const c = 7.5;
  const dirs = f ? [[0.72, 0.72, 5.5], [0.72, -0.72, 5.5]] : [[1, 0, 6.5], [0, 1, 6.5]];
  for (const [dx, dy, len] of dirs) {
    line(s, c - dx * len, c - dy * len, c + dx * len, c + dy * len, '#22b8e6');
    line(s, c - dx * len * 0.6, c - dy * len * 0.6, c + dx * len * 0.6, c + dy * len * 0.6, '#8af2ff');
  }
  fillCircle(s, c, c, f ? 3.6 : 4.2, '#22b8e6');
  fillCircle(s, c, c, f ? 2.8 : 3, '#8af2ff');
  fillCircle(s, c, c, f ? 1.4 : 1.9, '#ffffff');
  outline(s, '#0c3f86');
}

// The canister seen from behind, the way the player sees it fly away.
function rocket(s, f) {
  const c = 8.5;
  for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
    fillRect(s, c + dx * 6.5 - (dx ? 1 : 0.5), c + dy * 6.5 - (dy ? 1 : 0.5), dx ? 3 : 2, dy ? 3 : 2, ST1);
  }
  fillCircle(s, c, c, 5.6, ST1);
  fillCircle(s, c, c, 4.8, CAN_C);
  strokeCircle(s, c - 0.5, c - 0.5, 4.3, lighten(CAN_C, 0.4));
  fillCircle(s, c, c, 4, ST2);
  setPx(s, 5, 5, ST4); setPx(s, 6, 4, ST4);
  lump(s, c, c, f ? 3.4 : 2.6, 0.35, 41 + f * 9, (d) => (d < 0.45 ? '#ffffff' : d < 0.75 ? '#fff3a6' : '#ffc93a'));
  if (f) for (const [x, y] of [[8, 3], [13, 9], [4, 11], [10, 13]]) setPx(s, x, y, '#ff8c1c');
  outline(s, INK);
}

// Particle i of n in an effect: direction and relative speed, the same in every frame.
function particle(i, n, seed, slowest = 0.55) {
  const a = (i + hash2(i, 1, seed) * 0.8) * TAU / n;
  return { cx: Math.cos(a), cy: Math.sin(a), v: slowest + hash2(i, 2, seed) * (1 - slowest) };
}

function puff(s, f) {
  const c = 7.5, reach = [3.2, 5.6, 7, 7.4][f], from = [0, 0.3, 0.62, 1][f];
  const head = ['#ffffff', '#ffffff', '#fff3a6', '#ff8c1c'][f];
  const tail = ['#ffc93a', '#ffc93a', '#ff8c1c', '#d9441a'][f];
  for (let i = 0; i < 9; i++) {
    if (f === 3 && i % 3 === 1) continue;
    const p = particle(i, 9, 5, 0.7), r = reach * p.v;
    if (f < 3) line(s, c + p.cx * r * from, c + p.cy * r * from, c + p.cx * r, c + p.cy * r, tail);
    setPx(s, c + p.cx * r, c + p.cy * r, head);
    if (f === 3) setPx(s, c + p.cx * (r - 1.2), c + p.cy * (r - 1.2), tail);
  }
  if (f < 2) {
    fillCircle(s, c, c, 2.6 - f * 0.6, '#ffc93a');
    fillCircle(s, c, c, 1.6 - f * 0.6, '#ffffff');
  } else if (f === 2) {
    fillRect(s, 7, 7, 2, 2, '#ff8c1c');
    setPx(s, 7, 7, '#ffc93a');
  }
}

// Hydraulic oil thrown out of a hit machine, with a few sparks.
function oil(s, f) {
  const c = 9.5, t = [0.3, 0.72, 1, 1.16][f];
  const OIL = '#96601c', OIL_L = '#e8ae44', OIL_D = '#4a2a0a';
  if (f === 0) {
    lump(s, c, c, 3.2, 0.3, 19, (d, x, y) => (d < 0.45 && x + y < 19 ? OIL_L : d > 0.8 && x + y > 19 ? OIL_D : OIL));
    outline(s, '#1c0f04');
  }
  for (let i = 0; i < 6; i++) {
    if (f === 3 && i % 3 === 0) continue;
    const p = particle(i, 6, 23, 0.65);
    const x = Math.round(c + p.cx * p.v * t * 7.4), y = Math.round(c + p.cy * p.v * t * 6 + t * t * 2 - 1);
    if (f === 0) {
      setPx(s, x, y, OIL_L);
    } else if (f === 3) {
      fillRect(s, x, y - 1, 1, 2, OIL);
      setPx(s, x, y + 1, OIL_D);
    } else {
      line(s, x - p.cx * 2.6, y - p.cy * 2.6 - 0.8, x, y, OIL_D);
      fillRect(s, x - 1, y - 1, f === 1 ? 3 : 2, f === 1 ? 3 : 2, OIL);
      setPx(s, x - 1, y - 1, OIL_L);
      setPx(s, x + (f === 1 ? 1 : 0), y + (f === 1 ? 1 : 0), OIL_D);
    }
  }
  for (let i = 0; i < 5; i++) {
    if (f === 3 && i % 2) continue;
    const p = particle(i, 5, 77, 0.7), r = (2.5 + t * 5.5) * p.v;
    setPx(s, c + p.cx * r, c + p.cy * r, f < 2 ? '#ffffff' : '#ffc93a');
    if (f < 3) setPx(s, c + p.cx * (r - 1), c + p.cy * (r - 1), f < 1 ? '#fff3a6' : '#ff8c1c');
  }
}

const SMOKE = ['#35312f', '#55504c', '#7b756f', '#a6a098'];

// One round puff of smoke lit from the upper left. erode 0..1 eats dithered holes into it,
// starting at the rim.
function smokeBall(s, cx, cy, r, seed, erode = 0) {
  lump(s, cx, cy, r, 0.16, seed, (d, x, y) => {
    const m = fbm(x / 3.5 + seed, y / 3.5, seed, 2);
    if (m + (bayer(x, y) - 0.5) * 0.16 < erode + (d - 0.55) * 0.35 * (erode > 0)) return null;
    const v = 0.5 - ((x - cx) + (y - cy)) / (r * 2.4) + (m - 0.5) * 0.5 - d * d * 0.1;
    return SMOKE[v > 0.74 ? 3 : v > 0.52 ? 2 : v > 0.3 ? 1 : 0];
  });
}

function explode(s, f) {
  const c = 35.5;
  if (f === 0) {
    for (let i = 0; i < 14; i++) {
      const p = particle(i, 14, 61), len = 12 + p.v * 14;
      line(s, c, c, c + p.cx * len, c + p.cy * len, '#ff8c1c', 2);
      line(s, c, c, c + p.cx * len * 0.75, c + p.cy * len * 0.75, '#ffc93a', 2);
      line(s, c, c, c + p.cx * len * 0.5, c + p.cy * len * 0.5, '#fff3a6', 1);
    }
    lump(s, c, c, 12, 0.18, 8, (d) => (d < 0.6 ? '#ffffff' : d < 0.82 ? '#fff3a6' : '#ffc93a'));
    return;
  }
  // smoke behind the fire, drifting outward and up
  const spread = [0, 0, 0, 15, 18, 20][f], erode = [0, 0, 0, 0, 0.2, 0.44][f], lift = [0, 0, 0, 1, 2, 4][f];
  for (let i = 0; spread && i < 8; i++) {
    const p = particle(i, 7, 37, 0.75), far = i === 7 ? 0 : spread * p.v;
    const r = (f === 5 ? 9 : 10) + hash2(i, 5, 37) * 2.5;
    smokeBall(s, c + p.cx * far, c + p.cy * far - lift, r, 40 + i, erode);
  }
  const R = [0, 19, 25, 26, 22, 0][f];
  const gain = [0, 1.7, 1.35, 1.0, 0.75, 0][f];
  const bias = [0, 0.3, 0.14, -0.02, -0.12, 0][f];
  const rise = [0, 0, 1, 3, 5, 0][f];
  for (let y = 0; R && y < 72; y++) {
    for (let x = 0; x < 72; x++) {
      const dx = x - c, dy = y - c + rise, dist = Math.hypot(dx, dy);
      const n = fbm(x / 11 + 3.1, (y + rise * 2) / 11 + 0.7, 20, 3);
      const m = fbm(x / 5 + 1.3, (y + rise * 3) / 5, 29, 3);
      const d = dist / R + (n - 0.5) * 1.0 + Math.max(0, Math.hypot(x - c, y - c) - 31) / 4;
      if (d > 1) continue;
      const heat = (1 - d) * gain + bias + (m - 0.5) * 0.55;
      // from frame 3 on the cool rim is left out so the smoke shows through
      if (f < 3 || heat > 0.1) setPx(s, x, y, fire(heat));
    }
  }
  if (f === 5) {
    for (let i = 0; i < 6; i++) {
      const p = particle(i, 6, 71);
      setPx(s, c + p.cx * 14 * p.v, c + p.cy * 14 * p.v, i % 2 ? '#ff8c1c' : '#d9441a');
    }
  }
}

function smoke(s, f) {
  const c = 11.5, spread = [0, 2.6, 4.2, 5.4][f], grow = [0.8, 1, 1.12, 1.05][f], erode = [0, 0, 0.24, 0.46][f];
  const puffs = [[-0.8, 0.5, 4.6], [0.9, 0.1, 5], [-0.1, -1, 4.2]];
  puffs.forEach(([dx, dy, r], i) => {
    if (f === 0 && i === 2) return;
    smokeBall(s, c + dx * spread + (f ? 0 : dx * 1.5), c + 1 + dy * spread - f * 0.6, r * grow, 60 + i, erode);
  });
}

// ---------------------------------------------------------------- frame list

// name -> draw(surface). Items and props get the dark outline; effects handle their own edges.
const SOLID = {
  it_rivets: rivets,
  it_rivetbox: rivetBox,
  it_shells: shells,
  it_shellbox: shellBox,
  it_canister: canister,
  it_canistercrate: canisterCrate,
  it_medgel: medGel,
  it_medkit: medKit,
  it_vest: vest,
  it_heavyarmor: heavyArmor,
  it_scattergun: scattergun,
  it_boltdriver: boltDriver,
  it_launcher: launcher,
  pr_drum: drum,
  pr_lamp: lamp,
  pr_tank: tank,
  pr_junk: junk,
  pr_cable: cable,
};
KEY_NAMES.forEach((key, i) => { SOLID[`it_key_${key}`] = (s) => keyCard(s, i, KEY_COLORS[key]); });

const EFFECTS = {
  fx_slag: slag, fx_bolt: bolt, fx_rocket: rocket, fx_puff: puff, fx_oil: oil, fx_explode: explode, fx_smoke: smoke,
};

// -> { [frameName]: surface } for every it_*, pr_* and fx_* frame.
export function drawItemFrames() {
  const out = {};
  for (const [name, draw] of Object.entries(SOLID)) {
    const { w, h, anchor } = SPRITE_SIZES[name];
    const s = createSurface(w, h);
    draw(s);
    outline(s, INK);
    hardenAlpha(s);
    settle(s, anchor);
    out[name] = s;
  }
  for (const [key, draw] of Object.entries(EFFECTS)) {
    for (let f = 0; f < FX_SPRITES[key].frames; f++) {
      const { w, h } = SPRITE_SIZES[key + f];
      const s = createSurface(w, h);
      draw(s, f);
      out[key + f] = hardenAlpha(s);
    }
  }
  return out;
}
