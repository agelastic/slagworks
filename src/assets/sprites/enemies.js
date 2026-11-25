// Enemy sprite frames. Each enemy has one pose function that draws it from limb positions,
// so every frame of a type shares the same proportions. Light comes from the top left.
//
//   drawEnemyFrames() -> { [frameName]: surface }   names and sizes as in config.js

import { createSurface, fillPoly, fillEllipse, line, hardenAlpha, toColor, mix, hash2 } from '../../core/pix.js';
import { ENEMY_SPRITES } from '../../config.js';

const OUTLINE = [13, 12, 18, 255];
const WHITE = [255, 255, 255, 255];
const PI = Math.PI;

// ---------------------------------------------------------------- palettes

// Five tones from one base colour: shadows lean cool, highlights lean warm.
function tones(base) {
  const b = toColor(base);
  const cool = [22, 24, 50, 255], warm = [255, 246, 220, 255];
  return [mix(b, cool, 0.74), mix(b, cool, 0.42), b, mix(b, warm, 0.36), mix(b, warm, 0.7)]
    .map((c) => [Math.round(c[0]), Math.round(c[1]), Math.round(c[2]), 255]);
}

const IRON = tones('#4b5160');
const DARK = tones('#2c2f3a');
const STEEL = tones('#8592a6');
const BLADE = tones('#bcc7d4');
const SOOT = tones('#1d1c22');

// Glowing accents: [body, glow, hot centre].
const RED = ['#e8180c', '#ff6a3a', '#fff0dc'];
const RED_OFF = ['#4a1210', '#5c1a16', '#6e2620'];

const FIRE = ['#ff7a14', '#ffd23a', '#fffbe6'];

// ---------------------------------------------------------------- frame builder

// Base tone 0..4 for a pixel at (u, v) inside the bounding box of the part being drawn.
const SHADERS = {
  flat: () => 2,
  col: (u) => (u < 0.12 ? 2 : u < 0.45 ? 3 : u < 0.72 ? 2 : u < 0.9 ? 1 : 0),
  bar: (u, v) => (v < 0.12 ? 2 : v < 0.45 ? 3 : v < 0.72 ? 2 : v < 0.9 ? 1 : 0),
  diag: (u, v) => {
    const t = (u + v) / 2;
    return t < 0.3 ? 3 : t < 0.68 ? 2 : 1;
  },
  ball: (u, v) => {
    const x = u * 2 - 1, y = v * 2 - 1;
    const z = Math.sqrt(Math.max(0, 1 - x * x - y * y));
    const l = -0.52 * x - 0.62 * y + 0.58 * z;
    return l > 0.9 ? 4 : l > 0.62 ? 3 : l > 0.25 ? 2 : l > -0.1 ? 1 : 0;
  },
};

// A frame under construction. Shapes go through a small transform stack, are collected in a
// scratch mask and committed as one shaded, outlined part. Details are painted on top.
function makeFrame(w, h) {
  const f = createSurface(w, h);
  const scratch = createSurface(w, h);
  const fd = f.data, sd = scratch.data;
  let M = [1, 0, 0, 1, 0, 0];
  const stack = [];
  let x0, y0, x1, y1;

  const at = (x, y) => [M[0] * x + M[2] * y + M[4], M[1] * x + M[3] * y + M[5]];
  const scale = () => Math.hypot(M[0], M[1]);
  const grow = (x, y, r = 0) => {
    if (x - r < x0) x0 = x - r;
    if (x + r > x1) x1 = x + r;
    if (y - r < y0) y0 = y - r;
    if (y + r > y1) y1 = y + r;
  };
  const masked = (x, y) => x >= 0 && y >= 0 && x < w && y < h && sd[(y * w + x) * 4 + 3] !== 0;
  const put = (x, y, c) => {
    if (x < 0 || y < 0 || x >= w || y >= h) return;
    const i = (y * w + x) * 4;
    fd[i] = c[0]; fd[i + 1] = c[1]; fd[i + 2] = c[2]; fd[i + 3] = 255;
  };

  function commit(pal, mode, opts) {
    const { edge = mode !== 'ball', outline = true, bias = 0, stripe = null } = opts;
    const shader = SHADERS[mode];
    const bx0 = Math.max(0, Math.floor(x0)), by0 = Math.max(0, Math.floor(y0));
    const bx1 = Math.min(w - 1, Math.ceil(x1)), by1 = Math.min(h - 1, Math.ceil(y1));
    const bw = Math.max(1, bx1 - bx0 + 1), bh = Math.max(1, by1 - by0 + 1);
    for (let y = by0 - 1; y <= by1 + 1; y++) {
      for (let x = bx0 - 1; x <= bx1 + 1; x++) {
        if (masked(x, y)) {
          let t = shader((x - bx0 + 0.5) / bw, (y - by0 + 0.5) / bh) + bias;
          if (edge) {
            const lit = !masked(x - 1, y) || !masked(x, y - 1);
            const dim = !masked(x + 1, y) || !masked(x, y + 1);
            if (lit && !dim) t++;
            else if (dim && !lit) t--;
          }
          t = t < 0 ? 0 : t > 4 ? 4 : t;
          const striped = stripe && ((((x + y * stripe.slope) % stripe.period) + stripe.period) % stripe.period) < stripe.period / 2;
          put(x, y, (striped ? stripe.pal : pal)[t]);
        } else if (outline && (masked(x - 1, y) || masked(x + 1, y) || masked(x, y - 1) || masked(x, y + 1))) {
          put(x, y, OUTLINE);
        }
      }
    }
    for (let y = by0; y <= by1; y++) sd.fill(0, (y * w + bx0) * 4, (y * w + bx1 + 1) * 4);
  }

  const g = {
    w, h, surface: f, at,

    save() { stack.push(M.slice()); },
    restore() { M = stack.pop(); },
    move(dx, dy) {
      M[4] += M[0] * dx + M[2] * dy;
      M[5] += M[1] * dx + M[3] * dy;
    },
    // Rotate (radians, clockwise on screen) and scale about a pivot in local coordinates.
    turn(a, px = 0, py = 0) {
      g.move(px, py);
      const c = Math.cos(a), s = Math.sin(a);
      M = [M[0] * c + M[2] * s, M[1] * c + M[3] * s, M[2] * c - M[0] * s, M[3] * c - M[1] * s, M[4], M[5]];
      g.move(-px, -py);
    },
    zoom(sx, sy = sx, px = 0, py = 0) {
      g.move(px, py);
      M = [M[0] * sx, M[1] * sx, M[2] * sy, M[3] * sy, M[4], M[5]];
      g.move(-px, -py);
    },
    // Run fn inside a temporary transform.
    pose({ dx = 0, dy = 0, rot = 0, sx = 1, sy = sx, px = 0, py = 0 }, fn) {
      g.save();
      g.move(dx, dy);
      if (rot) g.turn(rot, px, py);
      if (sx !== 1 || sy !== 1) g.zoom(sx, sy, px, py);
      fn();
      g.restore();
    },

    // Mask shapes: call inside part().
    poly(pts) {
      const q = pts.map(([x, y]) => at(x, y));
      for (const [x, y] of q) grow(x, y);
      fillPoly(scratch, q, WHITE);
    },
    rect(x, y, rw, rh) {
      g.poly([[x, y], [x + rw - 1, y], [x + rw - 1, y + rh - 1], [x, y + rh - 1]]);
    },
    ell(cx, cy, rx, ry = rx) {
      const rotated = Math.abs(M[1]) > 1e-6 && rx !== ry;
      if (rotated) {
        const pts = [];
        for (let i = 0; i < 20; i++) pts.push([cx + Math.cos((i / 20) * 2 * PI) * rx, cy + Math.sin((i / 20) * 2 * PI) * ry]);
        g.poly(pts);
        return;
      }
      const [x, y] = at(cx, cy);
      const kx = Math.hypot(M[0], M[1]), ky = Math.hypot(M[2], M[3]);
      grow(x, y, Math.max(rx * kx, ry * ky) + 1);
      fillEllipse(scratch, x, y, rx * kx, ry * ky, WHITE);
    },
    // Tapered segment with round ends.
    limb(ax, ay, bx, by, r0, r1 = r0) {
      const [px, py] = at(ax, ay), [qx, qy] = at(bx, by);
      const k = scale();
      r0 *= k; r1 *= k;
      const d = Math.hypot(qx - px, qy - py) || 1;
      const nx = -(qy - py) / d, ny = (qx - px) / d;
      grow(px, py, r0 + 1);
      grow(qx, qy, r1 + 1);
      fillPoly(scratch, [
        [px + nx * r0, py + ny * r0], [qx + nx * r1, qy + ny * r1],
        [qx - nx * r1, qy - ny * r1], [px - nx * r0, py - ny * r0],
      ], WHITE);
      if (r0 >= 1) fillEllipse(scratch, px, py, r0 - 0.3, r0 - 0.3, WHITE);
      if (r1 >= 1) fillEllipse(scratch, qx, qy, r1 - 0.3, r1 - 0.3, WHITE);
    },
    // Collect shapes drawn by fn and commit them as one part.
    // mode: flat | col | bar | diag | ball. opts: { edge, outline, bias, stripe: { pal, period, slope } }
    part(pal, mode, fn, opts = {}) {
      x0 = y0 = Infinity;
      x1 = y1 = -Infinity;
      fn();
      if (x1 >= x0) commit(pal, mode, opts);
    },
    P(pal, mode, pts, opts) { g.part(pal, mode, () => g.poly(pts), opts); },
    R(pal, mode, x, y, rw, rh, opts) { g.part(pal, mode, () => g.rect(x, y, rw, rh), opts); },
    E(pal, mode, cx, cy, rx, ry = rx, opts) { g.part(pal, mode, () => g.ell(cx, cy, rx, ry), opts); },
    L(pal, mode, ax, ay, bx, by, r0, r1 = r0, opts) { g.part(pal, mode, () => g.limb(ax, ay, bx, by, r0, r1), opts); },

    // Details, painted straight onto the frame. They stay inside the silhouette unless
    // free is true.
    dot(x, y, c, free = false) {
      const [px, py] = at(x, y);
      f.atop = !free;
      fillEllipse(f, Math.round(px), Math.round(py), 0, 0, c);
    },
    seg(ax, ay, bx, by, c, free = false) {
      const [px, py] = at(ax, ay), [qx, qy] = at(bx, by);
      f.atop = !free;
      line(f, px, py, qx, qy, c);
    },
    box(x, y, bw, bh, c, free = false) {
      f.atop = !free;
      fillPoly(f, [[x, y], [x + bw - 1, y], [x + bw - 1, y + bh - 1], [x, y + bh - 1]].map(([a, b]) => at(a, b)), c);
    },
    fill(pts, c, free = false) {
      f.atop = !free;
      fillPoly(f, pts.map(([a, b]) => at(a, b)), c);
    },
    disc(x, y, r, c, free = false) {
      const [px, py] = at(x, y);
      f.atop = !free;
      fillEllipse(f, px, py, r * scale(), r * scale(), c);
    },
    // Rivet: dark pixel with a lit pixel up-left of it.
    rivet(x, y, pal) {
      g.dot(x, y, pal[0]);
      g.dot(x - 1, y - 1, pal[4]);
    },
    // Glowing lens in a dark socket. c = [body, glow, hot].
    lens(x, y, r, c) {
      const [px, py] = at(x, y);
      const k = r * scale();
      f.atop = true;
      fillEllipse(f, px, py, k + 1, k + 1, OUTLINE);
      fillEllipse(f, px, py, k, k, c[0]);
      if (k >= 1.5) fillEllipse(f, px, py, k * 0.5, k * 0.5, c[1]);
      if (k >= 3) fillEllipse(f, px - k * 0.2, py - k * 0.2, k * 0.25, k * 0.25, c[2]);
      else fillEllipse(f, Math.floor(px), Math.floor(py), 0, 0, c[2]);
    },
    // Star burst (muzzle flash, impact). c = [outer, mid, core].
    flash(x, y, r, c, spikes = 8, rot = 0) {
      const [px, py] = at(x, y);
      const k = r * scale();
      const star = (rad) => {
        const pts = [];
        for (let i = 0; i < spikes * 2; i++) {
          const a = rot + (i * PI) / spikes;
          const rr = i % 2 ? rad * 0.4 : rad * (0.72 + 0.28 * hash2(i, spikes, Math.round(r * 7)));
          pts.push([px + Math.cos(a) * rr, py + Math.sin(a) * rr]);
        }
        return pts;
      };
      f.atop = false;
      fillPoly(f, star(k), c[0]);
      fillPoly(f, star(k * 0.62), c[1]);
      fillEllipse(f, px, py, k * 0.26, k * 0.26, c[2]);
    },
    // Blend every pixel toward a colour (pain flash). Outline pixels move less.
    tint(c, t) {
      const [r, gr, b] = toColor(c);
      for (let i = 0; i < fd.length; i += 4) {
        if (!fd[i + 3]) continue;
        const k = fd[i] + fd[i + 1] + fd[i + 2] < 90 ? t * 0.45 : t;
        fd[i] += (r - fd[i]) * k;
        fd[i + 1] += (gr - fd[i + 1]) * k;
        fd[i + 2] += (b - fd[i + 2]) * k;
      }
    },
    done() {
      f.atop = false;
      return hardenAlpha(f);
    },
  };
  return g;
}

// Two-bone joint position between a and b; side picks which way the joint bends.
function joint(ax, ay, bx, by, l1, l2, side) {
  const dx = bx - ax, dy = by - ay;
  const len = Math.hypot(dx, dy) || 1;
  const d = Math.min(len, l1 + l2 - 0.01);
  const a = (l1 * l1 - l2 * l2 + d * d) / (2 * d);
  const k = Math.sqrt(Math.max(0, l1 * l1 - a * a));
  const ux = dx / len, uy = dy / len;
  return [ax + ux * a - uy * k * side, ay + uy * a + ux * k * side];
}

// Leg phase 0..1 -> { s: +1 planted forward .. -1 planted back, lift: 0..1 }.
// The foot is on the ground for the first half and swings forward in the second.
function stride(ph) {
  ph -= Math.floor(ph);
  if (ph < 0.5) return { s: 1 - 4 * ph, lift: 0 };
  return { s: -1 + 4 * (ph - 0.5), lift: Math.sin((ph - 0.5) * 2 * PI) };
}

// ---------------------------------------------------------------- scrapper

const SCRAP_SHELL = tones('#7d8ea6');
const SCRAP_PAINT = tones('#a03a2c');

// p: { bob, tilt, zoom (body), jaw (0 shut .. 1 wide), lens, legs, extra(g) }
// legs: 4 entries, L front, R front, L rear, R rear, each { s, lift } from stride() and
// optionally knee / foot = [x, y] for the left side (mirrored for the right).
function drawScrapper(g, p) {
  const W = g.w, gy = 34;
  const { bob = 0, tilt = 0, zoom = 1, jaw = 0.3, lens = RED, legs = [] } = p;
  const mx = (x) => W - 1 - x;
  const body = (fn) => g.pose({ dy: bob, rot: tilt, px: 23.5, py: 24, sx: zoom }, fn);

  const rest = [
    { hip: [15, 24], knee: [10, 14], foot: [9, gy], r: 1.4 },
    { hip: [13, 20], knee: [5, 7], foot: [2, gy - 1], r: 1.3 },
  ];
  const leg = (i) => {
    const pair = rest[i >> 1], right = i & 1;
    const st = { s: 0, lift: 0, ...legs[i] };
    if (st.off) return;
    let hip;
    body(() => { hip = g.at(right ? mx(pair.hip[0]) : pair.hip[0], pair.hip[1]); });
    let [kx, ky] = st.knee || [pair.knee[0] - st.lift, pair.knee[1] - st.lift * 3 + bob * 0.5];
    let [fx, fy] = st.foot || [pair.foot[0] - st.s * 1.5, pair.foot[1] + Math.min(0, st.s) * 2 - st.lift * 6];
    if (right) { kx = mx(kx); fx = mx(fx); }
    g.L(IRON, 'col', hip[0], hip[1], kx, ky, pair.r, pair.r, { bias: 1 });
    g.L(STEEL, 'col', kx, ky, fx, fy, pair.r, 0.5, { bias: 1 });
    g.E(IRON, 'ball', kx, ky, pair.r);
  };

  leg(2); leg(3);

  body(() => {
    // exhaust stubs behind the shell
    g.R(DARK, 'col', 19, 10, 3, 4);
    g.R(DARK, 'col', 26, 10, 3, 4);
    // shell
    g.P(SCRAP_SHELL, 'bar', [[11, 21], [13, 16], [18, 12], [29, 12], [34, 16], [36, 21], [34, 23], [13, 23]]);
    g.fill([[12, 19], [35, 19], [36, 21], [11, 21]], SCRAP_PAINT[2]);
    g.seg(12, 19, 35, 19, SCRAP_PAINT[3]);
    g.seg(12, 21, 35, 21, SCRAP_PAINT[1]);
    g.box(22, 13, 4, 6, SCRAP_SHELL[1]);
    g.seg(23, 13, 23, 18, SCRAP_SHELL[0]);
    g.rivet(15, 18, SCRAP_SHELL);
    g.rivet(32, 18, SCRAP_SHELL);
    // face band and chin
    g.P(DARK, 'flat', [[13, 22], [34, 22], [31, 27], [16, 27]]);
    g.R(IRON, 'flat', 19, 27, 10, 3);
  });

  leg(0); leg(1);

  body(() => {
    for (const right of [0, 1]) {
      const m = (x) => (right ? mx(x) : x);
      g.pose({ rot: (right ? -1 : 1) * (jaw - 0.3) * 0.9, px: m(19), py: 28 }, () => {
        g.P(BLADE, 'diag', [[19, 27], [15, 28], [13, 31], [14, 33], [18, 33], [15, 31], [17, 29], [19, 29]].map(([x, y]) => [m(x), y]));
      });
    }
    g.lens(18.5, 24.5, 1.5, lens);
    g.lens(28.5, 24.5, 1.5, lens);
    g.dot(22, 25, lens[0]);
    g.dot(25, 25, lens[0]);
  });

  if (p.extra) p.extra(g);
}

function scrapperFrames() {
  const { w, h } = ENEMY_SPRITES.scrapper;
  const out = {};
  const frame = (name, pose, post) => {
    const g = makeFrame(w, h);
    drawScrapper(g, pose);
    if (post) post(g);
    out[`scrapper_${name}`] = g.done();
  };
  for (let i = 0; i < 4; i++) {
    const a = stride(i / 4), b = stride(i / 4 + 0.5);
    frame(`walk${i}`, { bob: i % 2 ? 0 : 1, tilt: i === 1 ? 0.05 : i === 3 ? -0.05 : 0, legs: [a, b, b, a] });
  }
  // rear up, front legs and mandibles spread
  frame('attack0', {
    bob: -4, jaw: 1,
    legs: [{ knee: [9, 13], foot: [3, 3] }, { knee: [9, 13], foot: [3, 3] }, { knee: [6, 12], foot: [3, 33] }, { knee: [6, 12], foot: [3, 33] }],
  });
  // lunge and bite
  frame('attack1', {
    bob: 3, zoom: 1.16, jaw: -0.1,
    legs: [{ knee: [8, 17], foot: [13, 34] }, { knee: [8, 17], foot: [13, 34] }, { knee: [4, 10], foot: [1, 33] }, { knee: [4, 10], foot: [1, 33] }],
    extra: (g) => g.flash(23.5, 32, 6, ['#ffd23a', '#fff6c0', '#ffffff'], 6, 0.3),
  });
  frame('pain0', {
    bob: -2, tilt: 0.28, jaw: 0.9,
    legs: [{ knee: [8, 13], foot: [5, 31] }, { knee: [11, 17], foot: [11, 34] }, { knee: [3, 9], foot: [1, 30] }, { knee: [7, 6], foot: [4, 33] }],
  }, (g) => g.tint('#ffffff', 0.55));
  frame('die0', {
    bob: -3, tilt: -0.3, jaw: 1.1,
    legs: [{ knee: [7, 10], foot: [2, 22] }, { knee: [8, 12], foot: [5, 28] }, { knee: [4, 6], foot: [1, 26] }, { knee: [6, 5], foot: [3, 30] }],
    extra: (g) => g.flash(27, 16, 8, FIRE, 7, 0.2),
  });
  frame('die1', {
    bob: 4, tilt: 0.22, jaw: 1.2, lens: RED_OFF,
    legs: [{ knee: [8, 20], foot: [4, 34] }, { knee: [9, 24], foot: [6, 34] }, { knee: [4, 16], foot: [1, 33] }, { knee: [5, 14], foot: [2, 30] }],
    extra: (g) => {
      g.flash(19, 20, 5, FIRE, 6, 0.5);
      for (const [x, y] of [[9, 9], [36, 6], [40, 14], [30, 4]]) g.dot(x, y, FIRE[1], true);
    },
  });
  frame('die2', {
    bob: 7, tilt: 0.12, jaw: 1.5, lens: RED_OFF,
    legs: [{ knee: [8, 25], foot: [3, 34] }, { knee: [8, 28], foot: [4, 34] }, { knee: [5, 22], foot: [1, 33] }, { off: true }],
    extra: (g) => {
      g.flash(29, 24, 3, FIRE, 5, 0.9);
      // the torn-off leg
      g.L(STEEL, 'col', 38, 33, 46, 31, 1.2, 0.5);
    },
  });
  frame('die3', {
    bob: 8, tilt: 0.1, jaw: 1.6, lens: RED_OFF,
    legs: [{ knee: [9, 29], foot: [3, 34] }, { knee: [7, 31], foot: [3, 34] }, { knee: [6, 26], foot: [1, 34] }, { off: true }],
    extra: (g) => g.L(STEEL, 'col', 38, 33, 46, 32, 1.2, 0.5),
  }, (g) => g.tint('#16141a', 0.3));
  return out;
}

// ---------------------------------------------------------------- gunner

const GUN_ARMOR = tones('#6a9a58');
const GUN_TRIM = tones('#3e5c40');
const GUN_METAL = tones('#3a3e4c');
const HAZARD = tones('#e8b820');
const AMBER = ['#ff9a10', '#ffd45a', '#fff8dc'];
const AMBER_OFF = ['#4a3414', '#4a3414', '#5e4520'];
const MUZZLE = ['#ff8a1a', '#ffe060', '#ffffff'];

// p: { bob, sway, drop (pelvis sinks, knees buckle), lean (torso rotation), fold (torso
//      height scale, < 1 slumps toward the camera), legs: [left, right] each a stride()
//      result or { foot: [x, y] }, aim (0 cannon down .. 1 at the camera), gunSwing, gunOut,
//      armSwing, armOut, head: { rot, dx, dy }, visor, extra(g) }
function drawGunner(g, p) {
  const {
    bob = 0, sway = 0, drop = 0, lean = 0, fold = 1, legs = [], aim = 0,
    gunSwing = 0, gunOut = 0, armSwing = 0, armOut = 0, head = {}, visor = AMBER,
  } = p;
  const cx = 25.5 + sway, hipY = 45 + bob + drop;

  const leg = (side) => {
    const st = { s: 0, lift: 0, ...legs[side < 0 ? 0 : 1] };
    const hx = cx + side * 5;
    const [fx, fy] = st.foot || [25.5 + side * (8 + st.lift), 71 - st.lift * 6 + Math.min(0, st.s) * 1.5];
    const [kx, ky] = joint(hx, hipY, fx, fy, 13.4, 13.6, -side);
    g.L(IRON, 'col', hx, hipY, kx, ky, 2.3);
    g.part(GUN_ARMOR, 'col', () => {
      g.limb(kx, ky + 2, fx, fy - 1, 3, 3.6);
      g.poly([[fx - 4, fy - 5], [fx + 4, fy - 5], [fx + 4, fy], [fx - 4, fy]]);
    });
    g.seg(fx - 3, fy - 3, fx + 3, fy - 3, GUN_ARMOR[1]);
    g.E(STEEL, 'ball', kx, ky, 2.6);
    g.P(GUN_TRIM, 'flat', [[fx - 4, fy], [fx + 4, fy], [fx + 5, fy + 3], [fx - 5, fy + 3]]);
  };
  const upper = (fn) => g.pose({ dx: sway, dy: bob + drop, rot: lean, sx: 1, sy: fold, px: 25.5, py: 41 }, fn);

  leg(-1); leg(1);
  g.pose({ dx: sway, dy: bob + drop }, () => {
    g.P(IRON, 'flat', [[19, 38], [32, 38], [33, 44], [29, 47], [22, 47], [18, 44]]);
    g.P(GUN_TRIM, 'diag', [[23, 40], [28, 40], [27, 46], [24, 46]]);
  });

  upper(() => {
    // ammo hopper behind the gun-side shoulder
    g.R(GUN_METAL, 'col', 9, 9, 6, 6);
    g.box(10, 11, 4, 1, HAZARD[2]);

    // off-hand arm with a two-prong claw
    const ex = 41 + armOut * 3, ey = 30 - armOut * 2, hx = 41 + armOut * 5, hy = 40 + armSwing - armOut * 5;
    g.L(IRON, 'col', 38.5, 20, ex, ey, 2);
    g.L(GUN_ARMOR, 'col', ex, ey, hx, hy, 2.5, 2.2);
    g.P(BLADE, 'flat', [[hx - 2, hy + 1], [hx - 3, hy + 6], [hx - 2, hy + 6], [hx, hy + 3], [hx + 2, hy + 6], [hx + 3, hy + 6], [hx + 2, hy + 1]]);

    // abdomen
    g.R(DARK, 'col', 21, 33, 10, 7);
    g.seg(21, 35, 30, 35, DARK[0]);
    g.seg(21, 37, 30, 37, DARK[0]);
    // head sits low between the collar guards
    g.pose({ dx: head.dx || 0, dy: head.dy || 0, rot: head.rot || 0, px: 26, py: 14 }, () => {
      g.L(IRON, 'flat', 31, 8, 33, 2, 0.5);
      g.P(GUN_ARMOR, 'diag', [[21, 8], [23, 6], [29, 6], [31, 8], [31, 13], [29, 15], [23, 15], [21, 13]]);
      g.box(22, 8, 9, 5, OUTLINE);
      g.box(22, 9, 9, 3, visor[0]);
      g.box(23, 9, 5, 1, visor[1]);
      g.box(23, 9, 2, 1, visor[2]);
      g.dot(33, 2, visor[0], true);
    });
    // chest
    g.P(GUN_ARMOR, 'diag', [[14, 16], [20, 14], [22, 16], [30, 16], [32, 14], [37, 16], [38, 23], [33, 35], [19, 35], [13, 23]]);
    g.seg(15, 23, 36, 23, GUN_ARMOR[1]);
    g.seg(15, 24, 36, 24, GUN_ARMOR[3]);
    g.box(22, 26, 8, 7, DARK[1]);
    g.seg(22, 27, 29, 27, DARK[3]);
    g.seg(22, 29, 29, 29, DARK[3]);
    g.seg(22, 31, 29, 31, DARK[3]);
    g.box(31, 18, 5, 3, '#e8e2c8');
    g.box(32, 19, 3, 1, GUN_ARMOR[1]);
    g.rivet(34, 27, GUN_ARMOR);
    g.rivet(17, 27, GUN_ARMOR);

    // shoulders: small round one, big shield on the gun side
    g.E(GUN_ARMOR, 'ball', 38.5, 18.5, 4, 3.8);
    const shield = () => {
      g.P(GUN_ARMOR, 'diag', [[4, 15], [8, 12], [15, 12], [18, 15], [18, 22], [14, 25], [7, 25], [4, 21]]);
      g.seg(5, 21, 17, 21, GUN_ARMOR[1]);
      g.seg(6, 22, 16, 22, GUN_TRIM[2]);
      g.box(7, 15, 3, 3, '#e8e2c8');
    };

    // cannon arm
    if (aim < 0.5) {
      g.pose({ rot: 0.1 + gunSwing * 0.04 + gunOut, sy: 1 - aim * 0.9, px: 10, py: 25 }, () => {
        g.R(STEEL, 'col', 8, 44, 5, 11);
        g.R(GUN_METAL, 'col', 7, 53, 7, 4, { bias: 1 });
        g.box(9, 56, 3, 1, OUTLINE);
        g.R(GUN_METAL, 'col', 7, 39, 7, 6, { bias: 1 });
        g.R(GUN_METAL, 'col', 5, 23, 11, 17, { bias: 1 });
        g.box(5, 35, 11, 2, HAZARD[2]);
        g.box(5, 35, 2, 2, HAZARD[3]);
        g.box(13, 35, 3, 2, HAZARD[1]);
        g.seg(8, 27, 8, 32, GUN_METAL[0]);
        g.seg(11, 27, 11, 32, GUN_METAL[0]);
        g.seg(14, 27, 14, 32, GUN_METAL[0]);
      });
      shield();
    } else {
      shield();
      const tx = 12, ty = 32;
      g.E(GUN_METAL, 'ball', tx - 2, ty - 3, 7, 7, { bias: 1 });
      g.E(GUN_METAL, 'ball', tx - 1, ty - 1, 6.6, 6.6, { bias: 1 });
      g.E(STEEL, 'ball', tx, ty, 5.6);
      g.disc(tx, ty, 3.6, OUTLINE);
      g.disc(tx + 0.5, ty + 0.5, 2.2, GUN_METAL[1]);
      g.disc(tx + 0.5, ty + 0.5, 1.2, OUTLINE);
    }
  });

  if (p.extra) p.extra(g);
}

function gunnerFrames() {
  const { w, h } = ENEMY_SPRITES.gunner;
  const out = {};
  const frame = (name, pose, post) => {
    const g = makeFrame(w, h);
    drawGunner(g, pose);
    if (post) post(g);
    out[`gunner_${name}`] = g.done();
  };
  for (let i = 0; i < 4; i++) {
    const a = stride(i / 4), b = stride(i / 4 + 0.5);
    frame(`walk${i}`, {
      bob: i % 2 ? 0 : 1, sway: i === 1 ? -1 : i === 3 ? 1 : 0, legs: [a, b],
      gunSwing: a.s * 1.5, armSwing: b.s * 2,
    });
  }
  const braced = [{ foot: [16, 71] }, { foot: [35, 71] }];
  frame('attack0', { aim: 1, bob: 1, armOut: 0.3, legs: braced });
  frame('attack1', {
    aim: 1, bob: 2, lean: 0.05, sway: 1, armOut: 0.5, legs: braced,
    extra: (g) => g.flash(13, 34, 12, MUZZLE, 9, 0.2),
  });
  frame('pain0', {
    bob: -1, lean: 0.16, sway: 1, aim: 0.3, armOut: 0.8, head: { rot: -0.3 }, legs: braced,
  }, (g) => g.tint('#ffffff', 0.55));
  frame('die0', {
    drop: 2, lean: -0.2, sway: -1, armOut: 1, gunSwing: -5, gunOut: 0.25, head: { rot: 0.4 }, legs: braced,
    extra: (g) => g.flash(27, 28, 10, FIRE, 8, 0.4),
  });
  frame('die1', {
    drop: 12, lean: 0.22, fold: 0.85, armOut: 0.6, gunOut: 0.5, head: { rot: 0.5, dy: 2 }, visor: AMBER_OFF,
    legs: [{ foot: [14, 71] }, { foot: [37, 71] }],
    extra: (g) => {
      g.flash(20, 40, 6, FIRE, 6, 0.1);
      for (const [x, y] of [[8, 20], [40, 16], [44, 30], [30, 12]]) g.dot(x, y, FIRE[1], true);
    },
  });
  frame('die2', {
    drop: 22, lean: 0.12, fold: 0.55, armOut: 1.3, gunOut: 0.8, head: { rot: 0.9, dy: 3 }, visor: AMBER_OFF,
    legs: [{ foot: [11, 71] }, { foot: [39, 71] }],
    extra: (g) => g.flash(31, 58, 4, FIRE, 5, 0.7),
  });
  frame('die3', {
    drop: 26, lean: 0.4, sway: -3, fold: 0.5, armOut: 1.6, gunOut: 1.1, head: { rot: 1.1, dy: 4 }, visor: AMBER_OFF,
    legs: [{ foot: [8, 71] }, { foot: [40, 71] }],
  }, (g) => g.tint('#16141a', 0.18));
  return out;
}

// ---------------------------------------------------------------- spitter

const COPPER = tones('#b9673a');
const BRASS = tones('#d2a640');
const ORANGE = ['#ff5a0a', '#ffae2a', '#fff3b8'];
const ORANGE_HOT = ['#ffa01e', '#ffe98a', '#ffffff'];
const ORANGE_OFF = ['#3a1a12', '#48231a', '#5a2c20'];

// p: { bob, sway, rock (body rotation), sx, sy (body squash), legs: [left, right] stride()
//      results or { foot }, glow (nozzle colours), eyes, burst (0 intact, > 0 lid lifts off),
//      lid: { dx, dy, rot } | null (null = gone), stack (false = gone), extra(g) }
function drawSpitter(g, p) {
  const {
    bob = 0, sway = 0, rock = 0, sx = 1, sy = 1, legs = [], glow = ORANGE, eyes = glow,
    burst = 0, lid = {}, stack = true,
  } = p;
  const cx = 27.5, cy = 34, RX = 19, RY = 18;
  const mx = (x) => 55 - x;
  const body = (fn) => g.pose({ dx: sway, dy: bob, rot: rock, sx, sy, px: cx, py: 56 }, fn);
  const hw = (y) => RX * Math.sqrt(Math.max(0, 1 - ((y - cy) / RY) ** 2));

  const leg = (side) => {
    const st = { s: 0, lift: 0, ...legs[side < 0 ? 0 : 1] };
    let hip;
    body(() => { hip = g.at(cx + side * 13, 48); });
    const [fx, fy] = st.foot || [cx + side * (19 + st.lift), 63 - st.lift * 5 + Math.min(0, st.s)];
    const [kx, ky] = joint(hip[0], hip[1], fx, fy, 9.6, 9.6, -side);
    g.L(IRON, 'col', hip[0], hip[1], kx, ky, 3);
    g.L(COPPER, 'col', kx, ky, fx, fy - 1, 3.4, 3, { bias: -1 });
    g.E(STEEL, 'ball', kx, ky, 3.2);
    g.P(IRON, 'flat', [[fx - 5, fy], [fx + 5, fy], [fx + 6, fy + 3], [fx - 6, fy + 3]]);
  };
  // iron hoop around the drum at height y, sagging in the middle
  const band = (y, t, sag) => {
    const top = [], bottom = [];
    for (let i = 0; i <= 8; i++) {
      const u = (i / 8) * 2 - 1, k = 1 - u * u;
      top.push([cx + u * (hw(y) - 1), y + sag * k]);
      bottom.unshift([cx + u * (hw(y + t) - 1), y + t + sag * k]);
    }
    g.P(IRON, 'bar', [...top, ...bottom], { edge: false });
    for (let i = 1; i < 8; i++) {
      const u = (i / 8) * 2 - 1;
      g.dot(cx + u * (hw(y) - 1), y + sag * (1 - u * u) + t / 2, i < 4 ? BRASS[4] : BRASS[2]);
    }
  };
  const teeth = [[-19, 33], [-15, 30], [-11, 34], [-7, 30], [-2, 35], [3, 31], [8, 35], [12, 30], [16, 33], [19, 32]]
    .map(([x, y]) => [cx + x, y]);
  const arc = (from, to) => {
    const pts = [];
    for (let i = 0; i <= 12; i++) {
      const a = from + ((to - from) * i) / 12;
      pts.push([cx + Math.cos(a) * RX, cy + Math.sin(a) * RY]);
    }
    return pts;
  };
  const stackPart = () => {
    g.R(IRON, 'col', 13, 9, 7, 11);
    g.R(IRON, 'col', 12, 7, 9, 3, { bias: 1 });
    g.box(14, 7, 5, 1, SOOT[1]);
  };
  const upperDetails = () => {
    band(21, 2, 2);
    // pressure gauge
    g.L(STEEL, 'col', 37, 20, 39, 15, 1.2);
    g.E(BRASS, 'ball', 39.5, 12.5, 3.6);
    g.disc(39.5, 12.5, 2, '#efe9d6');
    g.seg(39, 12, 41, 11, '#b0221a');
    // slit vents: the furnace shows through
    for (const m of [(x) => x, mx]) {
      g.fill([[16, 26], [23, 29], [23, 32], [16, 29]].map(([x, y]) => [m(x), y]), OUTLINE);
      g.fill([[17, 27], [22, 29], [22, 31], [17, 29]].map(([x, y]) => [m(x), y]), eyes[0]);
      g.seg(m(18), 28, m(21), 29, eyes[1]);
    }
  };

  leg(-1); leg(1);

  body(() => {
    if (stack && !burst) stackPart();
    // firebox under the drum
    g.P(IRON, 'flat', [[15, 48], [40, 48], [38, 57], [17, 57]]);
    for (const x of [20, 25, 30, 35]) g.box(x, 54, 2, 2, glow[0]);

    if (!burst) {
      g.E(COPPER, 'ball', cx, cy, RX, RY);
      upperDetails();
    } else {
      // open bowl with the fire inside
      g.E(SOOT, 'flat', cx, 33, 17, 4);
      g.fill([[14, 33], [41, 33], [38, 36], [17, 36]], burst < 2 ? ORANGE[0] : ORANGE_OFF[1]);
      g.P(COPPER, 'ball', [...teeth, ...arc(0.05, PI - 0.05)], { bias: -1 });
    }
    band(44, 2, 2);
    // nozzle
    g.E(IRON, 'ball', cx, 39, 8.6);
    for (let i = 0; i < 8; i++) g.dot(cx + Math.cos(i * PI / 4 + 0.4) * 7, 39 + Math.sin(i * PI / 4 + 0.4) * 7, i > 3 && i < 7 ? STEEL[4] : STEEL[2]);
    g.E(DARK, 'flat', cx, 39, 6);
    g.lens(cx, 39, 4.6, glow);

    if (burst && lid) {
      g.pose({ dx: lid.dx || 0, dy: lid.dy || 0, rot: lid.rot || 0, px: cx, py: 26 }, () => {
        if (stack) stackPart();
        g.P(COPPER, 'ball', [...teeth.slice().reverse(), ...arc(PI + 0.05, 2 * PI - 0.05)]);
        upperDetails();
      });
    }
  });

  if (p.extra) p.extra(g);
}

function spitterFrames() {
  const { w, h } = ENEMY_SPRITES.spitter;
  const out = {};
  const frame = (name, pose, post) => {
    const g = makeFrame(w, h);
    drawSpitter(g, pose);
    if (post) post(g);
    out[`spitter_${name}`] = g.done();
  };
  for (let i = 0; i < 4; i++) {
    const a = stride(i / 4), b = stride(i / 4 + 0.5);
    frame(`walk${i}`, {
      bob: i % 2 ? -1 : 0, sway: i === 1 ? -2 : i === 3 ? 2 : 0, rock: i === 1 ? -0.07 : i === 3 ? 0.07 : 0, legs: [a, b],
    });
  }
  frame('attack0', {
    bob: -1, sx: 1.04, sy: 1.04, glow: ORANGE_HOT, eyes: ORANGE_HOT,
    extra: (g) => g.flash(16, 3, 4, FIRE, 5, 0.3),
  });
  frame('attack1', {
    bob: 1, sx: 1.06, sy: 0.96, glow: ORANGE_HOT, eyes: ORANGE_HOT,
    extra: (g) => {
      g.flash(27.5, 39, 14, FIRE, 10, 0.15);
      for (const [x, y] of [[8, 30], [47, 27], [12, 52], [45, 50], [27, 60]]) g.disc(x, y, 1, FIRE[1], true);
    },
  });
  frame('pain0', { bob: -2, rock: 0.2, sway: 2, legs: [{ foot: [9, 63] }, { foot: [48, 61] }] }, (g) => g.tint('#ffffff', 0.55));
  frame('die0', {
    rock: -0.14, bob: -1, glow: ORANGE_HOT, eyes: ORANGE_HOT,
    extra: (g) => {
      g.seg(20, 20, 26, 26, FIRE[1]); g.seg(26, 26, 24, 31, FIRE[1]); g.seg(26, 26, 33, 28, FIRE[1]);
      g.flash(36, 20, 10, FIRE, 8, 0.3);
    },
  });
  frame('die1', {
    burst: 1, bob: 2, lid: { dx: -5, dy: -9, rot: -0.35 }, legs: [{ foot: [7, 63] }, { foot: [48, 63] }],
    extra: (g) => {
      g.flash(29, 27, 12, FIRE, 9, 0.5);
      for (const [x, y] of [[48, 12], [6, 26], [44, 4], [52, 30]]) g.disc(x, y, 1, FIRE[1], true);
    },
  });
  frame('die2', {
    burst: 1, bob: 7, rock: 0.06, lid: null, glow: ORANGE_OFF, legs: [{ foot: [7, 63] }, { foot: [48, 63] }],
    extra: (g) => g.flash(26, 36, 7, FIRE, 7, 0.9),
  });
  frame('die3', {
    burst: 2, bob: 10, rock: 0.08, lid: null, glow: ORANGE_OFF, legs: [{ foot: [7, 63] }, { foot: [48, 63] }],
    extra: (g) => { g.dot(22, 45, ORANGE[0]); g.dot(30, 46, ORANGE[0]); g.dot(26, 45, ORANGE[1]); },
  }, (g) => g.tint('#16141a', 0.2));
  return out;
}

// ---------------------------------------------------------------- hauler

const YELLOW = tones('#e6b21c');
const HULL = tones('#4d525e');
const LAMP = ['#ffd45e', '#fff6c4', '#ffffff'];
const LAMP_OFF = ['#4a4132', '#4a4132', '#5c5240'];
const IMPACT = ['#ffd23a', '#fff6c0', '#ffffff'];
const STRIPES = { pal: SOOT, period: 8, slope: 1 };

// p: { bob, sway, drop, lean, fold, legs: [left, right] stride() results or { foot },
//      arms: [left, right] each { elbow: [x, y], wrist: [x, y], open, zoom, flat, abs } in
//      left-side coordinates (mirrored for the right arm); body space unless abs,
//      lamp, extra(g) }
function drawHauler(g, p) {
  const { bob = 0, sway = 0, drop = 0, lean = 0, fold = 1, legs = [], arms = [], lamp = LAMP } = p;
  const cx = 37.5;
  const mx = (x) => 75 - x;
  const body = (fn) => g.pose({ dx: sway, dy: bob + drop, rot: lean, sx: 1, sy: fold, px: cx, py: 60 }, fn);
  const hipY = 63 + bob + drop;

  const leg = (side) => {
    const st = { s: 0, lift: 0, ...legs[side < 0 ? 0 : 1] };
    const hx = cx + sway + side * 10;
    const [fx, fy] = st.foot || [cx + side * (15 + st.lift), 86 - st.lift * 6 + Math.min(0, st.s) * 1.5];
    const [kx, ky] = joint(hx, hipY, fx, fy, 12.6, 12.6, -side);
    g.L(IRON, 'col', hx, hipY, kx, ky, 4.6);
    g.part(YELLOW, 'col', () => {
      g.limb(kx, ky + 3, fx, fy - 4, 5.6, 6.4);
      g.poly([[fx - 7, fy - 6], [fx + 7, fy - 6], [fx + 7, fy], [fx - 7, fy]]);
    });
    g.box(fx - 7, fy - 3, 15, 2, SOOT[2]);
    g.E(STEEL, 'ball', kx, ky, 4.6);
    g.P(HULL, 'flat', [[fx - 8, fy], [fx + 8, fy], [fx + 9, fy + 4], [fx - 9, fy + 4]]);
  };

  // open: jaw angle, flat: squash across the jaws (a clamp lying on the floor)
  const clamp = (open, flat) => {
    if (flat !== 1) g.zoom(flat, 1);
    for (const m of [1, -1]) {
      g.pose({ rot: m * open * 0.6, px: -4 * m, py: 4 }, () => {
        g.P(STEEL, 'diag', [[-5, 3], [-10, 8], [-10, 15], [-5, 21], [-2, 19], [-5, 14], [-5, 9], [-2, 6]].map(([x, y]) => [x * m, y]));
        g.dot(-5 * m, 11, STEEL[0]);
        g.dot(-5 * m, 13, STEEL[0]);
      });
    }
    g.R(HULL, 'flat', -6, -1, 13, 6);
    g.box(-5, 2, 11, 1, YELLOW[2]);
    g.E(DARK, 'ball', 0, 3, 1.6);
  };

  const arm = (side) => {
    const m = side < 0 ? (x) => x : mx;
    const a = { elbow: [9, 47], wrist: [10, 61], open: 0.25, zoom: 1, flat: 1, ...arms[side < 0 ? 0 : 1] };
    let sh, el, wr;
    body(() => {
      sh = g.at(m(14), 30);
      el = a.abs ? [m(a.elbow[0]), a.elbow[1]] : g.at(m(a.elbow[0]), a.elbow[1]);
      wr = a.abs ? [m(a.wrist[0]), a.wrist[1]] : g.at(m(a.wrist[0]), a.wrist[1]);
    });
    g.L(IRON, 'col', sh[0], sh[1], el[0], el[1], 4);
    body(() => {
      // shoulder plate with a striped skirt
      g.P(YELLOW, 'diag', [[2, 21], [7, 13], [19, 12], [25, 18], [25, 30], [2, 30]].map(([x, y]) => [m(x), y]));
      g.P(YELLOW, 'flat', [[2, 31], [25, 31], [25, 34], [20, 38], [6, 38], [2, 34]].map(([x, y]) => [m(x), y]), { stripe: STRIPES });
      g.rivet(m(side < 0 ? 7 : 8), 19, YELLOW);
      g.rivet(m(side < 0 ? 21 : 22), 18, YELLOW);
    });
    g.L(YELLOW, 'col', el[0], el[1], wr[0], wr[1], 5.4 * a.zoom, 6 * a.zoom);
    g.E(IRON, 'ball', el[0], el[1], 3.6, 3.6, { bias: 1 });
    const ang = Math.atan2(wr[1] - el[1], wr[0] - el[0]) - PI / 2;
    g.pose({ dx: wr[0], dy: wr[1], rot: ang, sx: a.zoom }, () => clamp(a.open, a.flat));
  };

  // exhaust stacks behind the shoulders
  body(() => {
    g.R(IRON, 'col', 10, 3, 5, 12);
    g.R(IRON, 'col', 9, 2, 7, 3, { bias: 1 });
    g.R(IRON, 'col', 60, 7, 5, 8);
    g.R(IRON, 'col', 59, 6, 7, 3, { bias: 1 });
  });

  leg(-1); leg(1);
  g.pose({ dx: sway, dy: bob + drop }, () => {
    g.P(IRON, 'flat', [[25, 57], [50, 57], [52, 64], [47, 69], [28, 69], [23, 64]]);
    g.P(YELLOW, 'diag', [[33, 59], [42, 59], [41, 67], [34, 67]], { bias: -1 });
  });

  body(() => {
    // torso
    g.P(HULL, 'diag', [[20, 22], [55, 22], [58, 34], [52, 49], [47, 58], [28, 58], [23, 49], [17, 34]]);
    g.seg(27, 51, 48, 51, HULL[0]);
    g.seg(28, 54, 47, 54, HULL[0]);
    g.seg(27, 52, 48, 52, HULL[3]);
    g.P(YELLOW, 'diag', [[25, 28], [50, 28], [52, 35], [48, 44], [27, 44], [23, 35]]);
    g.P(YELLOW, 'flat', [[26, 45], [49, 45], [47, 49], [28, 49]], { stripe: STRIPES });
    // radiator grille
    g.box(31, 33, 14, 9, SOOT[1]);
    for (let x = 32; x < 45; x += 3) g.seg(x, 34, x, 40, HULL[3]);
    g.box(45, 30, 5, 2, '#ece6cc');
    g.rivet(27, 31, YELLOW);
    g.rivet(27, 41, YELLOW);
    g.rivet(49, 41, YELLOW);
    // head: a low slab sunk between the shoulders, lamps under a brow
    g.P(HULL, 'diag', [[30, 18], [45, 18], [48, 22], [48, 29], [27, 29], [27, 22]], { bias: 1 });
    g.box(29, 22, 18, 5, OUTLINE);
    for (const m of [(x) => x, mx]) {
      g.fill([[30, 23], [35, 24], [35, 25], [30, 25]].map(([x, y]) => [m(x), y]), lamp[0]);
      g.seg(m(31), 24, m(34), 24, lamp[1]);
      g.dot(m(33), 24, lamp[2]);
    }
  });

  arm(-1); arm(1);
  if (p.extra) p.extra(g);
}

function haulerFrames() {
  const { w, h } = ENEMY_SPRITES.hauler;
  const out = {};
  const frame = (name, pose, post) => {
    const g = makeFrame(w, h);
    drawHauler(g, pose);
    if (post) post(g);
    out[`hauler_${name}`] = g.done();
  };
  for (let i = 0; i < 4; i++) {
    const a = stride(i / 4), b = stride(i / 4 + 0.5);
    frame(`walk${i}`, {
      bob: i % 2 ? 0 : 2, sway: i === 1 ? -2 : i === 3 ? 2 : 0, lean: i === 1 ? -0.03 : i === 3 ? 0.03 : 0, legs: [a, b],
      arms: [{ wrist: [10, 61 + b.s * 3] }, { wrist: [10, 61 + a.s * 3] }],
    });
  }
  const wide = [{ foot: [20, 86] }, { foot: [55, 86] }];
  const up = { elbow: [6, 37], wrist: [9, 24], open: 1 };
  frame('attack0', { bob: -1, legs: wide, arms: [up, up] });
  const slam = { elbow: [13, 50], wrist: [26, 58], open: -0.15, zoom: 1.25 };
  frame('attack1', {
    bob: 4, legs: wide, arms: [slam, slam],
    extra: (g) => g.flash(37.5, 72, 13, IMPACT, 10, 0.1),
  });
  frame('pain0', {
    bob: -2, lean: 0.1, sway: 2, legs: wide,
    arms: [{ elbow: [5, 45], wrist: [4, 58], open: 0.8 }, { elbow: [4, 43], wrist: [4, 55], open: 0.9 }],
  }, (g) => g.tint('#ffffff', 0.55));
  frame('die0', {
    drop: 2, lean: -0.1, sway: -2, legs: wide,
    arms: [{ elbow: [5, 45], wrist: [5, 59], open: 0.9 }, { elbow: [6, 46], wrist: [8, 60], open: 0.6 }],
    extra: (g) => g.flash(41, 36, 14, FIRE, 9, 0.3),
  });
  frame('die1', {
    drop: 12, lean: 0.13, fold: 0.9, lamp: LAMP_OFF, legs: [{ foot: [18, 86] }, { foot: [57, 86] }],
    arms: [{ abs: true, elbow: [8, 58], wrist: [9, 70], open: 0.7 }, { abs: true, elbow: [7, 62], wrist: [9, 73], open: 0.5 }],
    extra: (g) => {
      g.flash(24, 40, 9, FIRE, 7, 0.6);
      for (const [x, y] of [[8, 14], [50, 8], [68, 22], [36, 4]]) g.disc(x, y, 1, FIRE[1], true);
    },
  });
  frame('die2', {
    drop: 20, lean: 0.07, fold: 0.66, lamp: LAMP_OFF, legs: [{ foot: [16, 86] }, { foot: [59, 86] }],
    arms: [{ abs: true, elbow: [12, 68], wrist: [9, 78], open: 0.9, flat: 0.8 }, { abs: true, elbow: [14, 72], wrist: [16, 82], open: 0.7, flat: 0.7 }],
    extra: (g) => g.flash(46, 58, 6, FIRE, 6, 0.2),
  });
  frame('die3', {
    drop: 25, lean: 0.05, fold: 0.46, lamp: LAMP_OFF, legs: [{ foot: [14, 86] }, { foot: [61, 86] }],
    arms: [{ abs: true, elbow: [32, 83], wrist: [22, 85], open: 0.9, flat: 0.5 }, { abs: true, elbow: [30, 82], wrist: [19, 85], open: 0.6, flat: 0.5 }],
  }, (g) => g.tint('#16141a', 0.18));
  return out;
}

// ---------------------------------------------------------------- overseer

const OVR_PLATE = tones('#b4b0a4');
const OVR_CORE = tones('#343848');
const CYAN = ['#1590d8', '#6fe4ff', '#f2ffff'];
const CYAN_OFF = ['#14263a', '#182c42', '#22384e'];
// Main lens: [rim, body, glow, hot centre].
const EYE = ['#0b3a78', '#1590d8', '#6fe4ff', '#f2ffff'];
const EYE_HOT = ['#1590d8', '#6fe4ff', '#c8f8ff', '#ffffff'];
const EYE_FIRE = ['#6fe4ff', '#c8f8ff', '#ffffff', '#ffffff'];
const EYE_DIM = ['#0a1c34', '#0f3a66', '#1b6aa0', '#5cb8de'];
const EYE_DEAD = ['#0c0e16', '#141824', '#1c2230', '#262c3a'];
const JET = ['#2a5cff', '#58c8ff', '#f0ffff'];
const BOLT_FLASH = ['#22b8e6', '#8af2ff', '#ffffff'];

const COWL = [[8, 34], [13, 27], [34, 22], [85, 22], [106, 27], [111, 34], [107, 42], [86, 42], [74, 49], [66, 45], [53, 45], [45, 49], [33, 42], [12, 42]];
const COWL_L = [[8, 34], [13, 27], [34, 22], [57, 22], [55, 28], [60, 33], [56, 39], [59, 45], [53, 45], [45, 49], [33, 42], [12, 42]];
const COWL_R = [[62, 22], [85, 22], [106, 27], [111, 34], [107, 42], [86, 42], [74, 49], [66, 45], [63, 45], [61, 39], [65, 33], [60, 28]];

// p: { bob, sway, drop, tilt, fold (hull height scale about its base), look: [dx, dy] of the
//      main lens core, eye (main lens colours), lens (small lenses), jets: [left, centre,
//      right] flame lengths (0 = out), mast, crown,
//      cowl: null (whole) | [left, right] halves, each { dx, dy, rot },
//      pods: [left, right] each { rot, dx, dy, aim (0 hanging .. 1 at the camera), bore (glow
//      colours in the muzzles), at: [x, y] (torn off: shoulder position in frame space,
//      left-side coordinates), off }, extra(g) }
function drawOverseer(g, p) {
  const {
    bob = 0, sway = 0, drop = 0, tilt = 0, fold = 1, look = [0, 0], eye = EYE, lens = CYAN,
    jets = [9, 13, 9], mast = true, crown = true, cowl = null, pods = [],
  } = p;
  const cx = 59.5;
  const mx = (x) => 119 - x;
  const body = (fn) => g.pose({ dx: sway, dy: bob + drop, rot: tilt, sx: 1, sy: fold, px: cx, py: 100 }, fn);
  const flank = (side, fn) => (side < 0 ? fn() : g.pose({ sx: -1, sy: 1, px: cx }, fn));

  const flame = (x, y, hw, len) => {
    if (len <= 0) return;
    g.fill([[x - hw, y], [x + hw, y], [x + hw * 0.6, y + len * 0.55], [x, y + len], [x - hw * 0.6, y + len * 0.55]], JET[0], true);
    g.fill([[x - hw * 0.6, y], [x + hw * 0.6, y], [x, y + len * 0.7]], JET[1], true);
    g.fill([[x - hw * 0.3, y], [x + hw * 0.3, y], [x, y + len * 0.4]], JET[2], true);
  };

  // cannon pod hanging from the shoulder at (16, 40), left-side coordinates
  const pod = (side) => {
    const a = { rot: 0, dx: 0, dy: 0, aim: 0, bore: null, ...pods[side < 0 ? 0 : 1] };
    if (a.off) return;
    const draw = () => {
      const len = (i) => (i === 1 ? 20 : 17) * (1 - 0.72 * a.aim);
      [8.5, 15.5, 22.5].forEach((bx, i) => {
        const y1 = 62 + len(i);
        g.L(STEEL, 'col', bx, 60, bx, y1, 3);
        g.R(IRON, 'col', bx - 3.5, y1 - 4, 8, 3);
        g.E(STEEL, 'flat', bx, y1 + 1, 3.4, 1.6 + a.aim * 1.8);
        g.E(SOOT, 'flat', bx, y1 + 1, 2.2, 0.8 + a.aim * 1.4, { outline: false, edge: false });
        if (a.bore) {
          g.disc(bx, y1 + 1, 1.6, a.bore[1]);
          g.dot(bx, y1 + 1, a.bore[2]);
        }
      });
      g.P(OVR_PLATE, 'diag', [[4, 44], [7, 40], [25, 40], [28, 44], [28, 61], [25, 65], [7, 65], [4, 61]]);
      g.P(HAZARD, 'flat', [[5, 55], [27, 55], [27, 60], [5, 60]], { stripe: STRIPES });
      g.lens(16, 48, 2.4, lens);
    };
    if (a.at) {
      flank(side, () => g.pose({ dx: a.at[0] - 16, dy: a.at[1] - 40, rot: a.rot, px: 16, py: 40 }, draw));
    } else {
      body(() => flank(side, () => g.pose({ dx: a.dx, dy: a.dy, rot: a.rot, px: 16, py: 40 }, draw)));
    }
  };

  const cowlDetails = (side) => {
    const m = side < 0 ? (x) => x : mx;
    g.seg(m(34), 24, m(34), 41, OVR_PLATE[1]);
    g.seg(m(35), 24, m(35), 41, OVR_PLATE[3]);
    g.lens(m(43), 32, 2, lens);
    g.rivet(m(side < 0 ? 16 : 15), 32, OVR_PLATE);
    g.rivet(m(side < 0 ? 26 : 25), 27, OVR_PLATE);
    g.rivet(m(side < 0 ? 26 : 25), 38, OVR_PLATE);
  };

  body(() => {
    if (mast) {
      g.L(IRON, 'col', 45, 22, 43, 5, 1.3, 0.8);
      g.disc(43, 4, 1, CYAN[1], true);
      g.R(IRON, 'col', 71, 11, 3, 12);
      g.R(STEEL, 'bar', 68, 7, 9, 5);
    }
    // thrusters
    flame(40, 100, 5, jets[0]);
    flame(cx, 109, 10, jets[1]);
    flame(mx(40), 100, 5, jets[2]);
    for (const m of [(x) => x, mx]) g.P(IRON, 'col', [[35, 89], [45, 89], [47, 99], [33, 99]].map(([x, y]) => [m(x), y]));
    g.P(IRON, 'col', [[50, 96], [69, 96], [73, 108], [46, 108]]);
    g.seg(48, 105, 71, 105, IRON[0]);

    // housing
    g.P(OVR_CORE, 'diag', [[33, 36], [86, 36], [95, 52], [93, 72], [84, 88], [72, 98], [47, 98], [35, 88], [26, 72], [24, 52]]);
    for (const m of [(x) => x, mx]) {
      g.P(OVR_PLATE, 'diag', [[25, 51], [34, 48], [37, 60], [35, 73], [32, 84], [27, 72]].map(([x, y]) => [m(x), y]));
      g.seg(m(28), 58, m(34), 58, OVR_PLATE[1]);
      g.seg(m(28), 62, m(34), 62, OVR_PLATE[1]);
      g.seg(m(29), 66, m(33), 66, OVR_PLATE[1]);
    }
    g.P(HAZARD, 'flat', [[41, 80], [78, 80], [82, 85], [37, 85]], { stripe: STRIPES });
    g.P(OVR_PLATE, 'bar', [[38, 87], [81, 87], [72, 97], [47, 97]]);
    g.box(52, 90, 16, 4, SOOT[1]);
    for (let x = 53; x < 68; x += 3) g.seg(x, 90, x, 93, OVR_CORE[3]);

    // main lens
    g.E(STEEL, 'ball', cx, 61, 16.5);
    g.disc(cx, 61, 13, OUTLINE);
    g.disc(cx, 61, 11.5, eye[0]);
    g.disc(cx + look[0] * 0.5, 61 + look[1] * 0.5, 8.5, eye[1]);
    g.disc(cx + look[0], 61 + look[1], 5.5, eye[2]);
    g.disc(cx + look[0], 61 + look[1], 2.6, eye[3]);
    g.seg(cx - 8, 56, cx - 5, 53, eye[2]);
    for (const m of [(x) => x, mx]) {
      g.lens(m(39), 53, 2.6, lens);
      g.lens(m(41), 74, 2, lens);
    }
  });

  pod(-1); pod(1);

  body(() => {
    if (crown) {
      g.P(OVR_PLATE, 'bar', [[45, 23], [48, 13], [71, 13], [74, 23]]);
      g.box(52, 16, 16, 4, OUTLINE);
      g.lens(cx, 18, 2, lens);
    }
    if (!cowl) {
      g.P(OVR_PLATE, 'bar', COWL);
      cowlDetails(-1); cowlDetails(1);
    } else {
      [COWL_L, COWL_R].forEach((pts, i) => {
        const c = { dx: 0, dy: 0, rot: 0, ...cowl[i] };
        g.pose({ dx: c.dx, dy: c.dy, rot: c.rot, px: i ? 89 : 30, py: 34 }, () => {
          g.P(OVR_PLATE, 'bar', pts);
          cowlDetails(i ? 1 : -1);
        });
      });
    }
  });

  if (p.extra) p.extra(g);
}

function overseerFrames() {
  const { w, h } = ENEMY_SPRITES.overseer;
  const out = {};
  const frame = (name, pose, post) => {
    const g = makeFrame(w, h);
    drawOverseer(g, pose);
    if (post) post(g);
    out[`overseer_${name}`] = g.done();
  };
  // hover bob, the cannon arms swing a quarter cycle behind it
  for (let i = 0; i < 4; i++) {
    const bob = [0, -2, 0, 2][i], lag = [1, 0, -1, 0][i], swing = [0.05, 0, -0.05, 0][i];
    frame(`walk${i}`, {
      bob, look: [[0, 0], [-2, 0], [0, 1], [2, 0]][i],
      jets: [[9, 13, 8], [7, 15, 10], [10, 11, 7], [6, 14, 9]][i],
      pods: [{ rot: swing, dy: lag }, { rot: -swing, dy: lag }],
    });
  }
  frame('attack0', {
    bob: -2, eye: EYE_HOT, jets: [11, 15, 11],
    pods: [{ aim: 1, rot: 0.08, dy: -3, bore: CYAN }, { aim: 1, rot: 0.08, dy: -3, bore: CYAN }],
  });
  frame('attack1', {
    bob: 1, eye: EYE_FIRE, jets: [8, 12, 8],
    pods: [{ aim: 1, rot: 0.12, dy: -5, bore: CYAN }, { aim: 1, rot: 0.12, dy: -5, bore: CYAN }],
    extra: (g) => {
      g.flash(15, 70, 13, BOLT_FLASH, 9, 0.2);
      g.flash(104, 70, 13, BOLT_FLASH, 9, 0.5);
    },
  });
  frame('pain0', {
    bob: -3, tilt: 0.09, sway: 2, eye: EYE_DIM, look: [2, -2], jets: [12, 6, 4],
    pods: [{ rot: 0.2 }, { rot: -0.12, dy: -2 }],
  }, (g) => g.tint('#ffffff', 0.55));
  frame('die0', {
    tilt: -0.06, sway: -1, eye: EYE_DIM, look: [2, 1], jets: [6, 4, 0],
    pods: [{ rot: 0.22 }, { rot: 0.1 }],
    extra: (g) => {
      g.flash(80, 34, 17, FIRE, 10, 0.3);
      g.flash(28, 72, 9, FIRE, 7, 0.6);
    },
  });
  frame('die1', {
    drop: 10, tilt: 0.1, eye: EYE_DEAD, lens: CYAN_OFF, jets: [0, 5, 0], mast: false,
    cowl: [{ dx: -2, dy: -1, rot: -0.08 }, { dx: 2, rot: 0.05 }],
    pods: [{ at: [13, 66], rot: -0.5 }, { rot: 0.25 }],
    extra: (g) => {
      g.flash(46, 60, 21, FIRE, 11, 0.1);
      g.flash(96, 84, 10, FIRE, 7, 0.4);
    },
  });
  frame('die2', {
    drop: 22, tilt: 0.14, fold: 0.92, eye: EYE_DEAD, lens: CYAN_OFF, jets: [0, 0, 0], mast: false, crown: false,
    cowl: [{ dx: -8, dy: 6, rot: -0.35 }, { dx: 3, dy: 1, rot: 0.1 }],
    pods: [{ at: [10, 104], rot: -1.2 }, { rot: 0.4 }],
    extra: (g) => {
      g.flash(62, 86, 23, FIRE, 12, 0.2);
      g.flash(100, 60, 8, FIRE, 6, 0.7);
    },
  });
  frame('die3', {
    drop: 23, tilt: 0.16, fold: 0.8, eye: EYE_DEAD, lens: CYAN_OFF, jets: [0, 0, 0], mast: false, crown: false,
    cowl: [{ dx: -14, dy: 30, rot: -0.9 }, { dx: 4, dy: 3, rot: 0.16 }],
    pods: [{ at: [8, 108], rot: -1.35 }, { rot: 0.5 }],
    extra: (g) => {
      g.flash(70, 60, 9, FIRE, 7, 0.5);
      g.flash(40, 92, 6, FIRE, 6, 0.9);
    },
  });
  frame('die4', {
    drop: 23, tilt: 0.16, fold: 0.74, eye: EYE_DEAD, lens: CYAN_OFF, jets: [0, 0, 0], mast: false, crown: false,
    cowl: [{ dx: -14, dy: 34, rot: -0.9 }, { dx: 4, dy: 4, rot: 0.16 }],
    pods: [{ at: [8, 108], rot: -1.35 }, { rot: 0.5 }],
  }, (g) => g.tint('#16141a', 0.35));
  return out;
}

// ---------------------------------------------------------------- all

export function drawEnemyFrames() {
  return {
    ...scrapperFrames(),
    ...gunnerFrames(),
    ...spitterFrames(),
    ...haulerFrames(),
    ...overseerFrames(),
  };
}
