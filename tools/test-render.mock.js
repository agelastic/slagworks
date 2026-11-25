// Stand-in assets and a mock world for the renderer test page. Runs in Node and in the browser.
// Textures carry a label, a grid, an up arrow, a light top edge and a black bottom band so that
// mirrored, rotated or wrongly anchored mapping is obvious in a screenshot.

import {
  TEXTURE_NAMES, TEXTURE_FRAMES, TEXTURE_FULLBRIGHT, SKY, SKY_W, SKY_H, SPRITE_NAMES, SPRITE_SIZES,
  EYE_HEIGHT,
} from '../src/config.js';
import * as P from '../src/core/pix.js';

export function mockTextures() {
  const out = {};
  TEXTURE_NAMES.forEach((name, i) => {
    if (name === SKY) return;
    const n = TEXTURE_FRAMES[name] || 1;
    const base = P.hsl((i * 47) % 360, 0.5, name[0] === 'w' ? 0.5 : 0.38);
    const frames = [];
    for (let f = 0; f < n; f++) {
      const s = P.createSurface(64, 64, base);
      for (let g = 16; g < 64; g += 16) {
        P.fillRect(s, g, 0, 1, 64, P.darken(base, 0.25));
        P.fillRect(s, 0, g, 64, 1, P.darken(base, 0.25));
      }
      P.fillRect(s, 0, 0, 64, 2, P.lighten(base, 0.7));
      P.fillRect(s, 0, 2, 1, 59, P.lighten(base, 0.35));
      P.fillRect(s, 63, 0, 1, 61, P.darken(base, 0.55));
      P.fillRect(s, 0, 61, 64, 3, '#101014');
      P.fillPoly(s, [[50, 22], [58, 34], [42, 34]], '#ffffff');
      P.fillRect(s, 48, 34, 5, 14, '#ffffff');
      P.drawText(s, name.slice(2).toUpperCase(), 4, 5, '#ffffff');
      P.drawText(s, name[0] === 'w' ? 'WALL' : 'FLAT', 4, 13, '#101014');
      if (n > 1) {
        P.drawText(s, `F${f}`, 4, 21, '#101014');
        P.fillRect(s, 4 + f * 9, 40, 8, 8, '#ffffff');
      }
      frames.push(s.data);
    }
    out[name] = { w: 64, h: 64, frames, fps: n > 1 ? 4 : 0, fullbright: TEXTURE_FULLBRIGHT.includes(name) };
  });

  const sky = P.createSurface(SKY_W, SKY_H, null, true);
  P.gradRect(sky, 0, 0, SKY_W, SKY_H, ['#05060f', '#141038', '#5a2a5a', '#d0703a'], 'v');
  for (let k = 0; k < 220; k++) {
    const x = Math.floor(P.hash2(k, 1, 7) * SKY_W), y = Math.floor(P.hash2(k, 2, 7) * 100);
    P.setPx(sky, x, y, P.hash2(k, 3, 7) > 0.7 ? '#ffffff' : '#8090c0');
  }
  P.fillCircle(sky, 0, 64, 20, '#e8d8a0');           // straddles the wrap seam
  P.fillRect(sky, 0, 119, SKY_W, 1, '#00ff60');      // one row above the horizon at 240p
  ['N', 'E', 'S', 'W'].forEach((ch, k) => P.drawText(sky, ch, 56 + k * 64, 20, '#ffffff', 4));
  out[SKY] = { w: SKY_W, h: SKY_H, frames: [sky.data], fps: 0, fullbright: true };
  return out;
}

const SPRITE_HUES = { wp: 30, it: 120, pr: 200, fx: 55 };

export function mockSprites() {
  const W = 1024, H = 1024;
  const atlas = P.createSurface(W, H);
  const frames = {};
  const names = [...SPRITE_NAMES].sort((a, b) => SPRITE_SIZES[b].h - SPRITE_SIZES[a].h);
  let x = 1, y = 1, rowH = 0;
  for (const name of names) {
    const { w, h } = SPRITE_SIZES[name];
    if (x + w + 1 > W) {
      x = 1;
      y += rowH + 1;
      rowH = 0;
    }
    const prefix = name.slice(0, 2);
    const col = P.hsl(SPRITE_HUES[prefix] ?? 0, 0.6, 0.5);
    const s = P.createSurface(w, h);
    if (prefix === 'wp') {
      P.fillPoly(s, [[w * 0.25, h - 1], [w * 0.75, h - 1], [w * 0.6, h * 0.25], [w * 0.4, h * 0.25]], col);
      if (name.includes('fire')) P.fillCircle(s, w / 2, h * 0.14, h * 0.12, '#fff2a0');
    } else {
      P.fillEllipse(s, (w - 1) / 2, (h - 1) / 2, w / 2 - 1, h / 2 - 1, col);
      P.fillRect(s, Math.floor(w / 2) - 1, 0, 2, h, P.darken(col, 0.4));   // centre line, full height
    }
    P.fillRect(s, 0, h - 2, w, 2, '#ffffff');                             // full-width base
    P.fillRect(s, 0, 0, w, 1, '#ff40ff');                                 // full-width top
    P.fillRect(s, 0, 0, 3, 3, '#ff40ff');                                 // top-left corner block only
    const words = name.split('_');
    words.forEach((word, k) => {
      if (P.textWidth(word) <= w - 4) P.drawText(s, word.toUpperCase(), 3, 5 + k * 7, '#101014');
    });
    P.hardenAlpha(s);
    P.blit(atlas, s, x, y);
    frames[name] = { x, y, w, h };
    x += w + 1;
    rowH = Math.max(rowH, h);
  }
  return { atlas: { w: W, h: H, data: atlas.data }, frames };
}

// ---------------------------------------------------------------- world

const hall = { ceil: 3, ft: 'f_concrete', ct: 'c_pipes', wt: 'w_concrete', light: 0.9 };
const door = { floor: 0, ceil: 1, ft: 'f_hazard', ct: 'c_dark', wt: 'w_hazard', light: 0.8 };

export const MOCK_LEGEND = {
  '#': { solid: true, wall: 'w_plate' },
  R: { solid: true, wall: 'w_rock' },
  C: { solid: true, wall: 'w_crate' },
  S: { solid: true, wall: 'w_switch_off', switch: { tag: 1 } },
  '.': { floor: 0, ceil: 1.5, ft: 'f_plate', ct: 'c_panel', wt: 'w_rust', light: 0.8 },
  p: { floor: -1, ceil: 1.5, ft: 'f_slag', ct: 'c_panel', wt: 'w_brick', light: 0.8 },
  ',': { floor: 0, ceil: 1.25, ft: 'f_grate', ct: 'c_dark', wt: 'w_pipes', light: 0.5 },
  f: { floor: 0, ceil: 1.25, ft: 'f_grate', ct: 'c_light', wt: 'w_pipes', light: 0.9, flicker: 0.8 },
  h: { floor: 0, ...hall },
  1: { floor: 0.25, ...hall },
  2: { floor: 0.5, ...hall },
  3: { floor: 0.75, ...hall },
  u: { floor: 1, ...hall, ft: 'f_rust', wt: 'w_grate' },
  k: { floor: -0.25, ...hall, ft: 'f_coolant', wt: 'w_furnace' },
  o: { floor: 1, ceil: 2, ft: 'f_hazard', ct: 'c_dark', wt: 'w_panel', light: 0.7 },
  y: { floor: 1, ceil: 5, ft: 'f_rock', ct: 'sky', wt: 'w_rock', light: 1 },
  Y: { floor: 1.5, ceil: 6, ft: 'f_concrete', ct: 'sky', wt: 'w_concrete', light: 1 },
  D: { ...door, door: { tex: 'w_door', key: null, tag: 0, secret: false }, open: 0 },
  E: { ...door, door: { tex: 'w_door_amber', key: 'amber', tag: 0, secret: false }, open: 0.5 },
  F: { ...door, door: { tex: 'w_door_cyan', key: 'cyan', tag: 0, secret: false }, open: 1 },
  L: { floor: 0.5, ...hall, ft: 'f_lift', wt: 'w_hazard', lift: { low: 0, high: 1, tag: 0 } },
};

//                        0         1         2
//                        0123456789012345678901234
export const MOCK_MAP = [
  /* 0 */ '#################RRRRRRRR',
  /* 1 */ '#.....#hhh123uuu#yyyyyyyR',
  /* 2 */ '#.C...Dhhh123uuuoyyyyyyyR',
  /* 3 */ '#.....Ehhh123uuu#yyYYyyyR',
  /* 4 */ '#.....Fhhhhhhuuu#yyYYyyyR',
  /* 5 */ '#pp...#hkkhhhLuu#yyyyyyyR',
  /* 6 */ '#pp...ShhhhhhhuuRyyyyyyyR',
  /* 7 */ '###,#############RRRRRRRR',
  /* 8 */ '#,,,,,,,,,fff,,,,,,,,,,,#',
  /* 9 */ '#########################',
];

// Builds a world with the Cell shape of contract section 8.
export function buildWorld(map = MOCK_MAP, legend = MOCK_LEGEND) {
  const h = map.length, w = map[0].length;
  const outside = { cx: -1, cy: -1, solid: true, wall: 'w_plate' };
  const cells = [];
  for (let cy = 0; cy < h; cy++) {
    for (let cx = 0; cx < w; cx++) {
      const d = legend[map[cy][cx]];
      if (!d) throw new Error(`no legend entry for '${map[cy][cx]}' at ${cx},${cy}`);
      const c = {
        cx, cy, solid: !!d.solid, wall: d.wall || null,
        floor: d.floor ?? 0, ceil: d.ceil ?? 0, floor0: d.floor ?? 0, ceil0: d.ceil ?? 0,
        ft: d.ft || null, ct: d.ct || null, wt: d.wt || null,
        light: d.light ?? 1, flicker: d.flicker || 0, damage: d.damage || 0,
        door: d.door ? { ...d.door, open: 0 } : null,
        lift: d.lift ? { ...d.lift } : null,
        mover: !!(d.door || d.lift), dynamic: false,
        secret: !!d.secret, trigger: d.trigger || 0, exit: !!d.exit,
        switch: d.switch ? { tag: d.switch.tag, on: false } : null,
        seen: false,
      };
      cells.push(c);
    }
  }
  const world = {
    w, h, cells, version: 1,
    cell: (cx, cy) => (cx < 0 || cy < 0 || cx >= w || cy >= h ? outside : cells[cy * w + cx]),
    movers: cells.filter((c) => c.mover),
  };
  for (const m of world.movers) {
    m.dynamic = true;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) world.cell(m.cx + dx, m.cy + dy).dynamic = true;
    if (m.door) setDoor(m, legend[map[m.cy][m.cx]].open || 0);
  }
  return world;
}

export function setDoor(cell, open) {
  cell.door.open = open;
  cell.ceil = cell.floor + (cell.ceil0 - cell.floor) * open;
}

export function setLift(cell, t) {
  cell.floor = cell.lift.low + (cell.lift.high - cell.lift.low) * t;
}

// ---------------------------------------------------------------- scenes

const spr = (frame, x, y, z, light = 0.8, extra = {}) => ({
  frame, x, y, z, anchor: SPRITE_SIZES[frame].anchor, light, flipX: false, ...extra,
});

export const MOCK_SPRITES = [
  spr('gunner_walk0', 4.5, 2.5, 0),
  spr('scrapper_walk1', 1.5, 3.2, 0),
  spr('hauler_walk0', 1.6, 5.6, -1),
  spr('it_medkit', 4.5, 5.5, 0),
  spr('pr_lamp', 5.5, 1.5, 0),
  spr('pr_cable', 3.5, 4.5, 1.5),
  spr('fx_explode2', 4.5, 3.5, 0.7, -1),
  spr('spitter_attack1', 8.5, 3.5, 0, 0.9, { flipX: true }),
  spr('spitter_attack1', 8.5, 1.5, 0, 0.9),
  spr('overseer_walk0', 14.5, 2.5, 1, 0.9),
  spr('it_key_amber', 13.5, 5.5, 0.5, 0.9),
  spr('pr_tank', 20.5, 5.5, 1, 1),
  spr('pr_drum', 18.5, 2.5, 1, 1),
  spr('gunner_attack1', 19.5, 3.5, 1.5, 1),
  spr('fx_slag0', 18.5, 4.5, 1.6, -1),
  spr('scrapper_walk0', 3.5, 8.5, 0, 0.5),
  spr('scrapper_walk0', 6.5, 8.5, 0, 0.5),
  spr('scrapper_walk0', 11.5, 8.5, 0, 0.9),
  spr('scrapper_walk0', 15.5, 8.5, 0, 0.5),
  spr('scrapper_walk0', 20.5, 8.5, 0, 0.5),
];

const deg = (d) => (d * Math.PI) / 180;
const view = (name, x, y, floor, yawDeg, extra = {}) => ({
  name, cam: { x, y, z: floor + EYE_HEIGHT, yaw: deg(yawDeg) }, sprites: [], ...extra,
});
const withSprites = { sprites: MOCK_SPRITES };

// yaw 0 = east (+x), 90 = south (+y, down the printed map)
export const MOCK_VIEWS = [
  view('room-se', 1.5, 1.5, 0, 40),
  view('room-doors', 3.2, 3.5, 0, 0),
  view('room-nw', 5.5, 6.5, 0, 225),
  view('room-ne', 1.5, 4.5, 0, 315),
  view('pillar-from-east', 4.5, 2.4, 0, 180),
  view('pillar-from-west', 1.3, 2.5, 0, 0),
  view('pillar-from-south', 2.5, 4.5, 0, 270),
  view('pillar-from-north', 2.5, 1.3, 0, 90),
  view('pit-from-room', 4.2, 5.5, 0, 180),
  view('pit-inside', 1.5, 6.5, -1, 315),
  view('hall-doors', 9.5, 3.5, 0, 180),
  view('hall-stairs', 7.5, 2.5, 0, 0),
  view('hall-lift', 10.5, 5.5, 0, 0),
  view('hall-coolant', 10.5, 6.5, 0, 200),
  view('platform-down', 15.5, 3.5, 1, 180),
  view('platform-lift', 14.5, 5.5, 1, 180),
  view('lift-on', 13.5, 5.5, 0.5, 180),
  view('lift-on-east', 13.5, 5.5, 0.5, 0),
  view('yard-ne', 18.5, 5.5, 1, 315),
  view('yard-doorway', 22.5, 2.5, 1, 180),
  view('yard-steps', 22.5, 5.5, 1, 205),
  view('yard-on-steps', 19.5, 3.5, 1.5, 100),
  view('doorway-out', 15.5, 2.5, 1, 0),
  view('corridor-east', 1.5, 8.5, 0, 0),
  view('corridor-west', 23.5, 8.5, 0, 180),
  view('corridor-flicker', 9.2, 8.5, 0, 0),
  view('switch', 4.5, 6.5, 0, 0),
  view('close-wall', 1.3, 1.5, 0, 180),
  view('sprites-room', 5.5, 6.3, 0, 235, withSprites),
  view('sprites-room-2', 3.5, 1.4, 0, 60, withSprites),
  view('sprites-pillar', 4.5, 2.2, 0, 170, withSprites),
  view('sprites-pit', 4.5, 5.5, 0, 180, withSprites),
  view('sprites-hall', 7.5, 2.5, 0, 0, withSprites),
  view('sprites-lift', 11.5, 5.5, 0, 0, withSprites),
  view('sprites-yard', 22.5, 5.5, 1, 205, withSprites),
  view('sprites-corridor', 1.5, 8.5, 0, 0, withSprites),
  view('sprites-lamp-corner', 3.5, 3.5, 0, 315, withSprites),
];
