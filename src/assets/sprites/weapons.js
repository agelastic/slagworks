// First-person weapon view-models.
//
// Each weapon is a small scene of solid primitives in camera space (cm, x right, y up,
// z into the screen, eye at the origin). The scene is ray-cast per pixel with the game's
// own perspective, shaded into a few palette tones, inked where one part occludes another
// and outlined. Animation frames are the same scene with a different pose, so they register.

import { VIRTUAL_H, FOV_Y_DEG, WEAPON_SPRITES } from '../../config.js';
import { createSurface, fillPoly, fillEllipse, setPx, line, blit, outline, hardenAlpha, hex, mix, hash2 } from '../../core/pix.js';

const D2R = Math.PI / 180;
const TAU = Math.PI * 2;
const FOCAL = (VIRTUAL_H / 2) / Math.tan((FOV_Y_DEG / 2) * D2R);

// ---------------------------------------------------------------- vectors and poses

const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const mul = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (a) => mul(a, 1 / Math.hypot(a[0], a[1], a[2]));
const lerp = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

// A frame of reference. Angles in degrees: yaw turns +z toward +x, pitch lifts +z toward +y,
// roll turns +x toward +y. Applied roll, then pitch, then yaw, then the parent pose.
function makePose(o, yaw = 0, pitch = 0, roll = 0, parent = null) {
  const cw = Math.cos(yaw * D2R), sw = Math.sin(yaw * D2R);
  const cp = Math.cos(pitch * D2R), sp = Math.sin(pitch * D2R);
  const cr = Math.cos(roll * D2R), sr = Math.sin(roll * D2R);
  const rot = (v) => {
    let x = v[0], y = v[1], z = v[2], t;
    t = x * cr - y * sr; y = x * sr + y * cr; x = t;
    t = y * cp + z * sp; z = -y * sp + z * cp; y = t;
    t = x * cw + z * sw; z = -x * sw + z * cw; x = t;
    return [x, y, z];
  };
  let x = rot([1, 0, 0]), y = rot([0, 1, 0]), z = rot([0, 0, 1]);
  if (parent) {
    x = parent.dir(x); y = parent.dir(y); z = parent.dir(z);
    o = parent.pt(o);
  }
  const dir = (v) => [
    x[0] * v[0] + y[0] * v[1] + z[0] * v[2],
    x[1] * v[0] + y[1] * v[1] + z[1] * v[2],
    x[2] * v[0] + y[2] * v[1] + z[2] * v[2],
  ];
  const pt = (v) => add(o, dir(v));
  return { o, x, y, z, dir, pt };
}

const WORLD = makePose([0, 0, 0]);

// ---------------------------------------------------------------- materials

// pal runs dark to light. amb + dif + spec are tone contributions (tone 0..1 picks the entry).
function material(pal, o = {}) {
  return { pal: pal.map((c) => hex(c)), amb: 0.16, dif: 0.7, spec: 0.3, shin: 14, glow: 0, rim: true, ...o };
}

const M = {
  steel: material(['#1b1e25', '#30353f', '#4a515e', '#6c7584', '#97a1ae', '#cdd5db']),
  gun: material(['#0f1115', '#1b1f26', '#2a303a', '#3d4551', '#566170', '#7c8794']),
  black: material(['#07080a', '#101216', '#1a1d23', '#262a32', '#343943', '#474d58'], { spec: 0.15 }),
  brass: material(['#3a2408', '#6b4410', '#a06d18', '#cf9a2a', '#ecc457', '#fff0a8'], { spec: 0.4 }),
  amber: material(['#4a2a05', '#7d4708', '#b56c0c', '#e3941a', '#ffb92e', '#ffdf86'], { spec: 0.2 }),
  red: material(['#2c0a09', '#57120f', '#861c15', '#b42c1e', '#d9523a', '#f39a7c'], { spec: 0.2 }),
  dial: material(['#5d6068', '#8d9097', '#b9bcc0', '#dcdfe0', '#f1f3f2', '#ffffff'], { spec: 0.1, amb: 0.5, dif: 0.5 }),
  glove: material(['#2b1a0d', '#4b2f18', '#734a24', '#9c6a33', '#c2904c', '#e3bd7c'], { spec: 0.08, rim: false }),
  pad: material(['#0c0d10', '#17191e', '#24272e', '#33373f', '#474c56', '#5f6672'], { spec: 0.12 }),
  sleeve: material(['#0b1620', '#122736', '#1a3a4d', '#245168', '#336d88', '#4f90aa'], { spec: 0.03, rim: false }),
  glow: material(['#7a1400', '#b82c00', '#e85600', '#ff8c12', '#ffc03a', '#fff0a0'], { glow: 0.55, rim: false }),
  hot: material(['#e85600', '#ff8c12', '#ffb52e', '#ffd95a', '#fff0a0', '#ffffe6'], { glow: 0.6, rim: false }),
  lens: material(['#04303a', '#075868', '#0c8ea0', '#22c4d6', '#7fe9f2', '#e2ffff'], { glow: 0.45, rim: false }),
  ember: material(['#3a0a00', '#6b1600', '#a02c00', '#d24c08', '#f27a1c', '#ffb14a'], { glow: 0.42, rim: false }),
  green: material(['#0b1c13', '#14331e', '#1e4d2a', '#2c6a39', '#459050', '#7cbc7a'], { spec: 0.22 }),
  cyan: material(['#06232b', '#0a3f4c', '#106172', '#19869a', '#38b2c4', '#8de0ec'], { spec: 0.22 }),
  bone: material(['#3b3833', '#67625a', '#989284', '#c2bcab', '#e0dbca', '#f7f4e8'], { spec: 0.18 }),
};

// ---------------------------------------------------------------- scene

// Primitive kinds: 0 ellipsoid, 1 rounded cone (sphere-capped), 2 capped cone, 3 box.
function makeScene() {
  const prims = [];
  let pose = WORLD;
  const push = (p, mat, pat) => {
    p.mat = mat;
    p.pat = pat || null;
    prims.push(p);
  };
  const cone = (k, a, b, ra, rb, mat, pat) => {
    const pa = pose.pt(a), pb = pose.pt(b), ba = sub(pb, pa);
    const m0 = dot(ba, ba), len = Math.sqrt(m0), rr = ra - rb;
    const ax = mul(ba, 1 / len);
    let ref = sub(pose.y, mul(ax, dot(pose.y, ax)));
    if (dot(ref, ref) < 1e-4) ref = sub(pose.x, mul(ax, dot(pose.x, ax)));
    ref = norm(ref);
    push({
      k, pa, pb, ba, ra, rb, rr, m0, ax, ref, bit: cross(ax, ref),
      m1: -dot(ba, pa), m5: dot(pa, pa), m7: dot(pb, pb), m9: -dot(pb, ba),
      bc: lerp(pa, pb, 0.5), br: len / 2 + Math.max(ra, rb),
    }, mat, pat);
  };
  return {
    prims,
    flash: null,   // { at: [x, y, z], power, reach } lights the scene from the muzzle
    use(p) { pose = p; },
    get pose() { return pose; },
    pt: (v) => pose.pt(v),
    // Ellipsoid. rad is a number or [rx, ry, rz]; basis { x, y, z } overrides the pose axes.
    blob(c, rad, mat, basis, pat) {
      const r = typeof rad === 'number' ? [rad, rad, rad] : rad;
      const b = basis || pose, wc = pose.pt(c);
      const ox = -dot(wc, b.x) / r[0], oy = -dot(wc, b.y) / r[1], oz = -dot(wc, b.z) / r[2];
      push({
        k: 0, ex: b.x, ey: b.y, ez: b.z, ia: 1 / r[0], ib: 1 / r[1], ic: 1 / r[2],
        ox, oy, oz, oo: ox * ox + oy * oy + oz * oz - 1, bc: wc, br: Math.max(r[0], r[1], r[2]),
      }, mat, pat);
    },
    // Rounded cone: a sausage with radius ra at a and rb at b.
    rod(a, b, ra, rb, mat, pat) { cone(1, a, b, ra, rb ?? ra, mat, pat); },
    // Flat-capped cone or cylinder. pat(h, angle) gets the distance along the axis and the angle around it.
    tube(a, b, ra, rb, mat, pat) { cone(2, a, b, ra, rb ?? ra, mat, pat); },
    // Box. rot = [yaw, pitch, roll] of the box inside the pose. pat(x, y, z) gets box-local coordinates.
    box(c, half, mat, rot, pat) {
      const b = rot ? makePose([0, 0, 0], rot[0], rot[1], rot[2], pose) : pose;
      const wc = pose.pt(c);
      push({
        k: 3, ex: b.x, ey: b.y, ez: b.z, hx: half[0], hy: half[1], hz: half[2],
        ox: -dot(wc, b.x), oy: -dot(wc, b.y), oz: -dot(wc, b.z),
        bc: wc, br: Math.hypot(half[0], half[1], half[2]),
      }, mat, pat);
    },
  };
}

// ---------------------------------------------------------------- ray casting

// Ray from the eye (origin) along the unit direction (dx, dy, dz). Each test returns the
// distance or -1 and leaves the surface normal in nx, ny, nz.
let nx = 0, ny = 0, nz = 0;

function hitBlob(p, dx, dy, dz) {
  const ex = p.ex, ey = p.ey, ez = p.ez;
  const qx = (dx * ex[0] + dy * ex[1] + dz * ex[2]) * p.ia;
  const qy = (dx * ey[0] + dy * ey[1] + dz * ey[2]) * p.ib;
  const qz = (dx * ez[0] + dy * ez[1] + dz * ez[2]) * p.ic;
  const A = qx * qx + qy * qy + qz * qz;
  const B = p.ox * qx + p.oy * qy + p.oz * qz;
  const h = B * B - A * p.oo;
  if (h < 0) return -1;
  const t = (-B - Math.sqrt(h)) / A;
  if (t <= 0) return -1;
  const lx = (p.ox + t * qx) * p.ia, ly = (p.oy + t * qy) * p.ib, lz = (p.oz + t * qz) * p.ic;
  nx = ex[0] * lx + ey[0] * ly + ez[0] * lz;
  ny = ex[1] * lx + ey[1] * ly + ez[1] * lz;
  nz = ex[2] * lx + ey[2] * ly + ez[2] * lz;
  const k = 1 / Math.hypot(nx, ny, nz);
  nx *= k; ny *= k; nz *= k;
  return t;
}

function hitRod(p, dx, dy, dz) {
  const pa = p.pa, pb = p.pb, ba = p.ba, ra = p.ra, rb = p.rb, rr = p.rr, m0 = p.m0, m1 = p.m1;
  const m2 = ba[0] * dx + ba[1] * dy + ba[2] * dz;
  const m3 = -(pa[0] * dx + pa[1] * dy + pa[2] * dz);
  const d2 = m0 - rr * rr;
  const k2 = d2 - m2 * m2;
  const k1 = d2 * m3 - m1 * m2 + m2 * rr * ra;
  const k0 = d2 * p.m5 - m1 * m1 + m1 * rr * ra * 2 - m0 * ra * ra;
  const h = k1 * k1 - k0 * k2;
  if (h < 0) return -1;
  let t = (-Math.sqrt(h) - k1) / k2;
  const y = m1 - ra * rr + t * m2;
  if (y > 0 && y < d2 && t > 0) {
    nx = d2 * (t * dx - pa[0]) - ba[0] * y;
    ny = d2 * (t * dy - pa[1]) - ba[1] * y;
    nz = d2 * (t * dz - pa[2]) - ba[2] * y;
    const k = 1 / Math.hypot(nx, ny, nz);
    nx *= k; ny *= k; nz *= k;
    return t;
  }
  const m6 = -(pb[0] * dx + pb[1] * dy + pb[2] * dz);
  const h1 = m3 * m3 - p.m5 + ra * ra;
  const h2 = m6 * m6 - p.m7 + rb * rb;
  let best = -1;
  if (h1 > 0) {
    t = -m3 - Math.sqrt(h1);
    if (t > 0) {
      best = t;
      nx = (t * dx - pa[0]) / ra; ny = (t * dy - pa[1]) / ra; nz = (t * dz - pa[2]) / ra;
    }
  }
  if (h2 > 0) {
    t = -m6 - Math.sqrt(h2);
    if (t > 0 && (best < 0 || t < best)) {
      best = t;
      nx = (t * dx - pb[0]) / rb; ny = (t * dy - pb[1]) / rb; nz = (t * dz - pb[2]) / rb;
    }
  }
  return best;
}

function hitTube(p, dx, dy, dz) {
  const pa = p.pa, pb = p.pb, ba = p.ba, ra = p.ra, rb = p.rb, rr = p.rr, m0 = p.m0, m1 = p.m1;
  const m2 = ba[0] * dx + ba[1] * dy + ba[2] * dz;
  const m3 = -(pa[0] * dx + pa[1] * dy + pa[2] * dz);
  if (m1 < 0) {
    // eye is beyond the a cap
    if (m2 > 0) {
      const ux = -pa[0] * m2 - dx * m1, uy = -pa[1] * m2 - dy * m1, uz = -pa[2] * m2 - dz * m1;
      if (ux * ux + uy * uy + uz * uz < ra * ra * m2 * m2) {
        nx = -p.ax[0]; ny = -p.ax[1]; nz = -p.ax[2];
        return -m1 / m2;
      }
    }
  } else if (p.m9 > 0) {
    // eye is beyond the b cap
    if (m2 < 0) {
      const t = -p.m9 / m2;
      const ux = t * dx - pb[0], uy = t * dy - pb[1], uz = t * dz - pb[2];
      if (ux * ux + uy * uy + uz * uz < rb * rb) {
        nx = p.ax[0]; ny = p.ax[1]; nz = p.ax[2];
        return t;
      }
    }
  }
  const hy = m0 + rr * rr;
  const k2 = m0 * m0 - m2 * m2 * hy;
  const k1 = m0 * m0 * m3 - m1 * m2 * hy + m0 * ra * rr * m2;
  const k0 = m0 * m0 * p.m5 - m1 * m1 * hy + m0 * ra * (rr * m1 * 2 - m0 * ra);
  const h = k1 * k1 - k2 * k0;
  if (h < 0) return -1;
  const t = (-k1 - Math.sqrt(h)) / k2;
  const y = m1 + t * m2;
  if (t <= 0 || y < 0 || y > m0) return -1;
  nx = m0 * (m0 * (t * dx - pa[0]) + rr * ba[0] * ra) - ba[0] * hy * y;
  ny = m0 * (m0 * (t * dy - pa[1]) + rr * ba[1] * ra) - ba[1] * hy * y;
  nz = m0 * (m0 * (t * dz - pa[2]) + rr * ba[2] * ra) - ba[2] * hy * y;
  const k = 1 / Math.hypot(nx, ny, nz);
  nx *= k; ny *= k; nz *= k;
  return t;
}

function hitBox(p, dx, dy, dz) {
  const ex = p.ex, ey = p.ey, ez = p.ez;
  let qx = dx * ex[0] + dy * ex[1] + dz * ex[2];
  let qy = dx * ey[0] + dy * ey[1] + dz * ey[2];
  let qz = dx * ez[0] + dy * ez[1] + dz * ez[2];
  if (Math.abs(qx) < 1e-9) qx = 1e-9;
  if (Math.abs(qy) < 1e-9) qy = 1e-9;
  if (Math.abs(qz) < 1e-9) qz = 1e-9;
  const ix = 1 / qx, iy = 1 / qy, iz = 1 / qz;
  const kx = Math.abs(ix) * p.hx, ky = Math.abs(iy) * p.hy, kz = Math.abs(iz) * p.hz;
  const ax = -ix * p.ox - kx, ay = -iy * p.oy - ky, az = -iz * p.oz - kz;
  const tn = Math.max(ax, ay, az);
  const tf = Math.min(-ix * p.ox + kx, -iy * p.oy + ky, -iz * p.oz + kz);
  if (tn > tf || tn <= 0) return -1;
  let e, s;
  if (ax >= ay && ax >= az) { e = ex; s = qx > 0 ? -1 : 1; }
  else if (ay >= az) { e = ey; s = qy > 0 ? -1 : 1; }
  else { e = ez; s = qz > 0 ? -1 : 1; }
  nx = e[0] * s; ny = e[1] * s; nz = e[2] * s;
  return tn;
}

const HIT = [hitBlob, hitRod, hitTube, hitBox];

// Pattern lookup: returns the material a pattern picks for the hit point, or null.
function patterned(p, t, dx, dy, dz) {
  const x = t * dx, y = t * dy, z = t * dz;
  if (p.k === 1 || p.k === 2) {
    const qx = x - p.pa[0], qy = y - p.pa[1], qz = z - p.pa[2];
    const h = qx * p.ax[0] + qy * p.ax[1] + qz * p.ax[2];
    const u = qx * p.ref[0] + qy * p.ref[1] + qz * p.ref[2];
    const v = qx * p.bit[0] + qy * p.bit[1] + qz * p.bit[2];
    return p.pat(h, Math.atan2(v, u), Math.hypot(u, v));
  }
  return p.pat(
    p.ox + x * p.ex[0] + y * p.ex[1] + z * p.ex[2],
    p.oy + x * p.ey[0] + y * p.ey[1] + z * p.ey[2],
    p.oz + x * p.ez[0] + y * p.ez[1] + z * p.ez[2],
  );
}

const LIGHT = norm([-0.55, 0.75, -0.42]);
const INK_GAP = 0.3;    // cm a neighbour must stand proud of this surface to ink it
const RIM_GAP = 1.0;    // cm of drop behind an edge before it gets a highlight or a shade line
const WARM = hex('#ffd676');

const rayCache = new Map();

function rays(w, h) {
  const key = w * 1000 + h;
  let r = rayCache.get(key);
  if (r) return r;
  r = new Float32Array(w * h * 3);
  const ox = w / 2, oy = h - VIRTUAL_H / 2;
  for (let y = 0, i = 0; y < h; y++) {
    for (let x = 0; x < w; x++, i += 3) {
      const rx = x + 0.5 - ox, ry = oy - (y + 0.5);
      const k = 1 / Math.hypot(rx, ry, FOCAL);
      r[i] = rx * k; r[i + 1] = ry * k; r[i + 2] = FOCAL * k;
    }
  }
  rayCache.set(key, r);
  return r;
}

// Frame pixel of a camera-space point.
function project(w, h, p) {
  return [w / 2 + (FOCAL * p[0]) / p[2], h - VIRTUAL_H / 2 - (FOCAL * p[1]) / p[2]];
}

function render(sc, w, h) {
  const n = w * h, R = rays(w, h), prims = sc.prims;
  const tb = new Float32Array(n).fill(Infinity);
  const ib = new Int16Array(n).fill(-1);
  const nb = new Float32Array(n * 3);
  const ox = w / 2, oy = h - VIRTUAL_H / 2;

  for (let pi = 0; pi < prims.length; pi++) {
    const p = prims[pi], hit = HIT[p.k], c = p.bc, r = p.br;
    let x0 = 0, x1 = w - 1, y0 = 0, y1 = h - 1;
    const z0 = c[2] - r, z1 = c[2] + r;
    if (z1 <= 0) continue;
    if (z0 > 2) {
      const xa = c[0] - r, xb = c[0] + r, ya = c[1] - r, yb = c[1] + r;
      x0 = Math.max(0, Math.floor(ox + FOCAL * (xa < 0 ? xa / z0 : xa / z1)));
      x1 = Math.min(w - 1, Math.ceil(ox + FOCAL * (xb > 0 ? xb / z0 : xb / z1)));
      y0 = Math.max(0, Math.floor(oy - FOCAL * (yb > 0 ? yb / z0 : yb / z1)));
      y1 = Math.min(h - 1, Math.ceil(oy - FOCAL * (ya < 0 ? ya / z0 : ya / z1)));
    }
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const i = y * w + x, j = i * 3;
        const t = hit(p, R[j], R[j + 1], R[j + 2]);
        if (t > 0 && t < tb[i]) {
          tb[i] = t; ib[i] = pi;
          nb[j] = nx; nb[j + 1] = ny; nb[j + 2] = nz;
        }
      }
    }
  }

  // tones
  const tone = new Int8Array(n), warm = new Float32Array(n), mats = new Array(n);
  const fl = sc.flash;
  for (let i = 0; i < n; i++) {
    const pi = ib[i];
    if (pi < 0) continue;
    const p = prims[pi], j = i * 3, t = tb[i];
    const dx = R[j], dy = R[j + 1], dz = R[j + 2];
    const ax = nb[j], ay = nb[j + 1], az = nb[j + 2];
    let m = p.mat;
    if (p.pat) m = patterned(p, t, dx, dy, dz) || m;
    mats[i] = m;
    let v;
    if (m.glow) {
      v = m.glow + 0.4 * Math.max(0, -(ax * dx + ay * dy + az * dz)) + 0.12 * ay;
    } else {
      const ndl = ax * LIGHT[0] + ay * LIGHT[1] + az * LIGHT[2];
      const wrap = ndl * 0.5 + 0.5;
      let hx = LIGHT[0] - dx, hy = LIGHT[1] - dy, hz = LIGHT[2] - dz;
      const hk = 1 / Math.hypot(hx, hy, hz);
      const ndh = Math.max(0, (ax * hx + ay * hy + az * hz) * hk);
      v = m.amb + m.dif * (0.72 * Math.max(0, ndl) + 0.28 * wrap * wrap) + m.spec * ndh ** m.shin;
      if (fl) {
        const lx = fl.at[0] - t * dx, ly = fl.at[1] - t * dy, lz = fl.at[2] - t * dz;
        const d = Math.hypot(lx, ly, lz);
        const k = (fl.power * Math.max(0, (ax * lx + ay * ly + az * lz) / d)) / (1 + (d / fl.reach) ** 2);
        v += k;
        warm[i] = k;
      }
    }
    const levels = m.pal.length;
    tone[i] = Math.max(0, Math.min(levels - 1, Math.floor(v * levels)));
  }

  // ink occlusion edges on the far side, bevel the near side, write colours
  const out = createSurface(w, h), d = out.data;
  const near = (i, k) => {
    // is neighbour k a different part standing in front of the surface at i?
    const pk = ib[k];
    if (pk < 0 || pk === ib[i]) return false;
    const j = i * 3, q = k * 3;
    const nd = nb[j] * R[q] + nb[j + 1] * R[q + 1] + nb[j + 2] * R[q + 2];
    const here = nb[j] * R[j] + nb[j + 1] * R[j + 1] + nb[j + 2] * R[j + 2];
    const expect = nd < -0.04 ? (tb[i] * here) / nd : tb[i];
    return tb[k] < expect - INK_GAP;
  };
  const drop = (i, k) => ib[k] < 0 || (ib[k] !== ib[i] && tb[k] > tb[i] + RIM_GAP);
  for (let y = 0, i = 0; y < h; y++) {
    for (let x = 0; x < w; x++, i++) {
      if (ib[i] < 0) continue;
      const m = mats[i], pal = m.pal;
      let c;
      if ((x > 0 && near(i, i - 1)) || (x < w - 1 && near(i, i + 1))
        || (y > 0 && near(i, i - w)) || (y < h - 1 && near(i, i + w))) {
        c = mul(pal[0], 0.55);
      } else {
        let k = tone[i];
        if (m.rim) {
          const lit = (y > 0 && drop(i, i - w)) || (x > 0 && drop(i, i - 1));
          const shaded = (y < h - 1 && drop(i, i + w)) || (x < w - 1 && drop(i, i + 1));
          if (lit && !shaded) k = Math.min(pal.length - 1, k + 1);
          else if (shaded && !lit) k = Math.max(0, k - 1);
        }
        c = pal[k];
        const wv = warm[i];
        if (wv > 0.16) c = mix(c, WARM, wv > 0.4 ? 0.5 : 0.26);
      }
      const o = i * 4;
      d[o] = c[0]; d[o + 1] = c[1]; d[o + 2] = c[2]; d[o + 3] = 255;
    }
  }
  return out;
}

// ---------------------------------------------------------------- shared parts

// Gloved fist closed round a handle. Everything is given in camera space.
//   at     grip centre on the handle axis          axis   handle direction, out of the thumb side
//   back   direction from the handle to the back of the hand
//   elbow  point the forearm runs to (normally below the frame)
//   rh     handle radius                           thumb  direction the thumb lies along; default wraps
function fist(sc, { at, axis, back, elbow, left = false, rh = 1.5, thumb = null, size = 1 }) {
  const prev = sc.pose;
  sc.use(WORLD);
  const a = norm(axis);
  const u = norm(sub(back, mul(a, dot(back, a))));
  const f = left ? cross(a, u) : cross(u, a);
  const k = size;
  // cu: toward the back of the hand, cf: toward the far side the fingers wrap, s: along the handle
  const P = (cu, cf, s) => add(at, add(mul(u, cu), add(mul(f, cf), mul(a, s * k))));

  for (let i = 0; i < 4; i++) {
    const s = (1.5 - i) * 2.15, g = [1, 1.05, 1, 0.86][i] * k;
    const K = P(rh + 1.3 * g, 1.9 * g, s), J1 = P(0.5 * g, rh + 1.15 * g, s);
    const J2 = P(-(rh + 1.05 * g), 0.9 * g, s), T = P(-(rh + 0.45 * g), -1.5 * g, s);
    sc.rod(K, J1, 1.2 * g, 1.15 * g, M.glove);
    sc.rod(J1, J2, 1.15 * g, 1.1 * g, M.glove);
    sc.rod(J2, T, 1.1 * g, 1.0 * g, M.glove);
  }
  const hand = { x: u, y: a, z: f };
  sc.blob(P(rh + 1.35 * k, -1.1 * k, -0.2), [1.7 * k, 4.6 * k, 3.4 * k], M.glove, hand);
  sc.blob(P(rh + 2.25 * k, 0.5 * k, 0), [1.0 * k, 3.9 * k, 1.9 * k], M.pad, hand);

  const b0 = P(rh + 0.5 * k, -2.7 * k, 1.6), b1 = P(-0.5 * k, -(rh + 1.5 * k), 3.2);
  const b2 = thumb ? add(b1, mul(norm(thumb), 3.3 * k)) : P(-(rh + 1.3 * k), -0.9 * k, 4.3);
  sc.rod(b0, b1, 1.45 * k, 1.3 * k, M.glove);
  sc.rod(b1, b2, 1.3 * k, 1.1 * k, M.glove);

  forearm(sc, P(rh + 1.2 * k, -3.6 * k, -0.6), elbow, k);
  sc.use(prev);
}

// Wrist, cuff and sleeve from the heel of a hand to the elbow. Camera space.
function forearm(sc, w0, elbow, k = 1) {
  const e = norm(sub(elbow, w0));
  const w1 = add(w0, mul(e, 2.2 * k)), w2 = add(w0, mul(e, 6.2 * k));
  sc.rod(w0, w1, 2.7 * k, 2.9 * k, M.glove);
  sc.tube(w1, w2, 3.1 * k, 3.5 * k, M.pad, (h) => (h > 1.1 * k && h < 2.3 * k ? M.amber : null));
  sc.rod(add(w0, mul(e, 5.6 * k)), elbow, 3.2 * k, 4.6 * k, M.sleeve);
}

// Muzzle flash: nested ragged stars, hottest in the middle.
const FLASH_LAYERS = [[1, '#d9440a'], [0.84, '#ff8a1a'], [0.62, '#ffd23a'], [0.38, '#fff6cf']];

function drawFlash(s, cx, cy, r, seed, spikes = 7, squash = 1) {
  const rot = hash2(seed, 1, 7) * TAU;
  for (const [k, c] of FLASH_LAYERS) {
    const pts = [];
    for (let i = 0; i < spikes * 2; i++) {
      const a = (i / (spikes * 2)) * TAU + rot;
      const j = hash2(i, seed, 3);
      const rr = r * k * (i % 2 ? 0.4 + 0.14 * j : 0.74 + 0.26 * j);
      pts.push([cx + Math.cos(a) * rr, cy - Math.sin(a) * rr * squash]);
    }
    fillPoly(s, pts, c);
    fillEllipse(s, cx, cy, r * k * 0.5, r * k * 0.5 * squash, c);
  }
  for (let i = 0; i < spikes; i++) {
    const a = hash2(i, seed, 11) * TAU, rr = r * (0.95 + 0.35 * hash2(i, seed, 13));
    setPx(s, cx + Math.cos(a) * rr, cy - Math.sin(a) * rr * squash, i % 2 ? '#ffd23a' : '#ff8a1a');
  }
}

// Render a scene into a frame: optional 2D layer behind the weapon (flashes), the weapon
// with its outline, then an optional 2D layer in front.
function frame(id, sc, behind = null, front = null) {
  const { w, h } = WEAPON_SPRITES[id];
  const s = createSurface(w, h);
  const proj = (p) => project(w, h, p), scale = (p) => FOCAL / p[2];
  if (behind) behind(s, proj, scale);
  blit(s, outline(render(sc, w, h), '#08090c'), 0, 0);
  if (front) front(s, proj, scale);
  return hardenAlpha(s);
}

// ---------------------------------------------------------------- rivet gun

// Pneumatic pistol. kick 0..1 is recoil, flash 0..1 the muzzle flash size.
function rivetGun({ kick = 0, flash = 0 }) {
  const sc = makeScene();
  const gun = makePose([0.8, -17.2 - 0.9 * kick, 57 - 6 * kick], -1, 10 + 5 * kick, 0);
  sc.use(gun);

  // grip
  sc.rod([0, -2.5, -2.6], [0, -12.6, -5.6], 1.9, 1.8, M.black);
  // coiled air hose from the left of the body
  const coil = (h) => (h % 1.5 < 0.55 ? M.amber : null);
  sc.rod([-2.6, -1.4, -3], [-5.6, -3.6, -4.5], 0.95, 0.95, M.black, coil);
  sc.rod([-5.6, -3.6, -4.5], [-7.2, -9.5, -7], 0.95, 0.95, M.black, coil);
  sc.rod([-7.2, -9.5, -7], [-6.4, -18, -11], 0.95, 0.95, M.black, coil);
  sc.rod([-6.4, -18, -11], [-7, -32, -20], 0.95, 0.95, M.black, coil);

  // air reservoir under the barrel
  sc.tube([0, -3.3, 3], [0, -3.3, 15], 1.6, 1.6, M.amber);
  sc.blob([0, -3.3, 15], [1.6, 1.6, 1.2], M.amber);

  // body, front to back
  sc.tube([0, 0, 19], [0, 0, 21.5], 2.2, 2.2, M.gun);
  sc.tube([0, 0, 11], [0, 0, 20], 1.7, 1.7, M.steel);
  sc.tube([0, 0, 9], [0, 0, 11.2], 3.4, 3.4, M.gun);
  sc.tube([0, 0, -4.8], [0, 0, 9], 3.0, 3.0, M.steel,
    (h, a) => (h > 9.6 && h < 13 ? ((h * 0.55 + a * 1.4 + 40) % 1 < 0.5 ? M.amber : M.black) : null));
  sc.tube([0, 0, -7], [0, 0, -4.6], 3.4, 3.4, M.gun);
  // top rail with vent slots, sights
  sc.box([0, 3.2, 1.5], [1.2, 0.6, 5.5], M.gun, null,
    (x, y, z) => (y > 0.3 && Math.abs(x) < 0.7 && (z + 8) % 2.4 < 1.2 ? M.black : null));
  sc.box([0, 4.1, -3.4], [1.45, 0.5, 0.8], M.gun);
  sc.box([0, 2.3, 20.2], [0.35, 0.6, 0.6], M.amber);
  // pressure gauge on the back
  sc.tube([0, 0, -7.5], [0, 0, -7], 2.2, 2.2, M.brass);
  sc.tube([0, 0, -7.8], [0, 0, -7.4], 1.65, 1.65, M.dial);
  sc.box([0.4, 0.45, -7.9], [0.2, 0.8, 0.15], M.red, [0, 0, -42]);

  fist(sc, {
    at: gun.pt([0, -7.6, -4.1]), axis: gun.dir([0, 0.96, 0.28]), back: gun.dir([0.78, 0, -0.62]),
    elbow: [12, -48, 18], rh: 1.8, thumb: gun.dir([-0.1, 0.15, 1]),
  });

  const muzzle = gun.pt([0, 0, 22.5]);
  if (flash) sc.flash = { at: gun.pt([0, 1.5, 20]), power: 1.3 * flash, reach: 14 };
  return frame('rivet', sc, flash && ((s, proj, scale) => {
    const [x, y] = proj(muzzle);
    drawFlash(s, x, y - 1, 4.6 * scale(muzzle) * flash, 5, 7);
  }));
}

// ---------------------------------------------------------------- scattergun

// Open left hand under a fore-end: fingertips curl up its right side, the thumb up its left.
// c is the fore-end centre in the current pose, hw and hh its half width and height.
function cradle(sc, { c, hw, hh, elbow, size = 1 }) {
  const pose = sc.pose, k = size;
  const [cx, cy, cz] = c, lo = cy - hh, hi = cy + hh;
  for (let i = 0; i < 4; i++) {
    const z = cz + (1.5 - i) * 2.25 * k, g = [1, 1.05, 1, 0.86][i] * k;
    const a = [cx + hw * 0.3, lo - 1.0 * g, z], b = [cx + hw + 0.75 * g, lo - 0.3 * g, z];
    const c2 = [cx + hw + 0.7 * g, hi + 0.2 * g, z], d = [cx + hw - 1.0 * g, hi + 0.85 * g, z];
    sc.rod(a, b, 1.15 * g, 1.15 * g, M.glove);
    sc.rod(b, c2, 1.15 * g, 1.1 * g, M.glove);
    sc.rod(c2, d, 1.1 * g, 1.0 * g, M.glove);
  }
  sc.blob([cx - 0.3, lo - 1.5 * k, cz - 0.4 * k], [hw + 0.9 * k, 1.9 * k, 5.0 * k], M.glove);
  const t0 = [cx - hw * 0.4, lo - 1.1 * k, cz + 2.4 * k], t1 = [cx - hw - 0.85 * k, lo - 0.1 * k, cz + 3.2 * k];
  const t2 = [cx - hw - 0.75 * k, hi + 0.3 * k, cz + 4.4 * k], t3 = [cx - hw + 1.1 * k, hi + 0.9 * k, cz + 5.2 * k];
  sc.rod(t0, t1, 1.45 * k, 1.4 * k, M.glove);
  sc.rod(t1, t2, 1.4 * k, 1.3 * k, M.glove);
  sc.rod(t2, t3, 1.3 * k, 1.1 * k, M.glove);
  const w0 = pose.pt([cx - hw * 0.55, lo - 1.7 * k, cz - 3.6 * k]);
  sc.use(WORLD);
  forearm(sc, w0, elbow, k);
  sc.use(pose);
}

// Twin-barrel pump blaster. kick 0..1 recoil, flash 0..1 muzzle flash, pump 0..1 fore-end travel.
function scatterGun({ kick = 0, flash = 0, pump = 0 }) {
  const sc = makeScene();
  const gun = makePose([0.6, -16.6 - 1.4 * kick, 47 - 7 * kick], -2, 8.5 + 6.5 * kick, 0);
  sc.use(gun);

  // grip under the receiver
  sc.rod([0, -4, -5.5], [0, -13.5, -8.6], 1.9, 1.8, M.black);

  // barrels, clamps, rib and bead
  for (const sx of [-1, 1]) {
    sc.tube([sx * 2.35, 0, 5], [sx * 2.35, 0, 39], 2.25, 2.25, M.steel);
    sc.tube([sx * 2.35, 0, 37], [sx * 2.35, 0, 39.8], 2.6, 2.6, M.gun);
  }
  sc.box([0, 0, 30], [5.0, 2.6, 0.9], M.brass);
  sc.box([0, 0, 8.5], [5.0, 2.6, 0.9], M.brass);
  sc.box([0, 2.0, 22.5], [0.6, 0.45, 15.5], M.gun, null,
    (x, y, z) => (y > 0.2 && Math.abs(x) < 0.35 && (z + 20) % 3 < 1.4 ? M.black : null));
  sc.blob([0, 3.0, 38.4], 0.6, M.brass);

  // fore-end
  const pz = 20 - 8.5 * pump;
  sc.box([0, -2.2, pz], [5.7, 2.0, 5.6], M.pad, null, (x, y, z) => ((z + 6) % 1.9 < 0.6 ? M.black : null));
  sc.box([0, -2.2, pz + 5.9], [5.9, 2.2, 0.5], M.steel);
  sc.box([0, -2.2, pz - 5.9], [5.9, 2.2, 0.5], M.steel);

  // receiver
  sc.box([0, -0.5, -2.2], [5.1, 3.3, 7.4], M.green, null, (x, y, z) => {
    if (y > 3.1 && x > 0.9 && x < 4.1 && z > -2.5 && z < 3.5) return M.black;
    if (y > 3.1 && x < -1.2 && x > -4 && (z + 9) % 2 < 0.9 && z < 4) return M.black;
    return null;
  });
  sc.box([0, 0.2, 5.6], [5.4, 3.0, 0.7], M.gun);
  sc.box([0, 3.5, -7.6], [1.5, 0.7, 0.9], M.gun);
  for (const sx of [-1, 1]) {
    sc.tube([sx * 2.35, 0.1, -10.6], [sx * 2.35, 0.1, -9.4], 2.0, 2.0, M.brass);
    sc.tube([sx * 2.35, 0.1, -11], [sx * 2.35, 0.1, -10.5], 1.1, 1.1, M.gun);
  }

  fist(sc, {
    at: gun.pt([0, -8.8, -7.1]), axis: gun.dir([0, 0.95, 0.31]), back: gun.dir([0.78, 0, -0.62]),
    elbow: [15, -50, 14], rh: 1.8, thumb: gun.dir([-0.1, 0.15, 1]),
  });
  cradle(sc, { c: [0, -2.2, pz], hw: 5.7, hh: 2.0, elbow: [-19, -44, 26] });

  const muzzles = [gun.pt([-2.35, 0.3, 41.5]), gun.pt([2.35, 0.3, 41.5])];
  if (flash) sc.flash = { at: gun.pt([0, 4, 36]), power: 1.5 * flash, reach: 22 };
  return frame('scatter', sc, flash && ((s, proj, scale) => {
    muzzles.forEach((m, i) => {
      const [x, y] = proj(m);
      drawFlash(s, x + (i ? 3 : -3), y - 3, 7.5 * scale(m) * flash, 21 + i * 8, 8);
    });
  }));
}

// ---------------------------------------------------------------- wrench

// A wrench pose is given in frame pixels: grip and jaw as [px, py, depth cm]. The handle runs
// up local y from the grip to the jaw, local z is the flat of the jaw, turned by face degrees.
const WRENCH_POSES = {
  idle: { grip: [100, 100, 50], jaw: [58, 24, 76], face: 10, elbow: [20, -52, 12] },
  wind: { grip: [100, 98, 48], jaw: [112, 21, 72], face: 25, elbow: [22, -52, 10] },
  strike: { grip: [88, 96, 48], jaw: [24, 52, 62], face: 30, elbow: [16, -52, 14] },
  follow: { grip: [50, 102, 50], jaw: [18, 84, 60], face: 50, elbow: [4, -52, 16] },
};

function unproject(w, h, [px, py, z]) {
  return [((px - w / 2) * z) / FOCAL, ((h - VIRTUAL_H / 2 - py) * z) / FOCAL, z];
}

// Pose with origin o, local y along yax, local z as near the camera's view direction as allowed.
function axisPose(o, yax, face = 0) {
  const y = norm(yax);
  const f = [Math.sin(face * D2R), 0, Math.cos(face * D2R)];
  const z = norm(sub(f, mul(y, dot(f, y))));
  const x = cross(y, z);
  const dir = (v) => [
    x[0] * v[0] + y[0] * v[1] + z[0] * v[2],
    x[1] * v[0] + y[1] * v[1] + z[1] * v[2],
    x[2] * v[0] + y[2] * v[1] + z[2] * v[2],
  ];
  return { o, x, y, z, dir, pt: (v) => add(o, dir(v)) };
}

const WRENCH_LEN = 34;

function wrenchPose(p) {
  const { w, h } = WEAPON_SPRITES.wrench;
  const g = unproject(w, h, p.grip), j = unproject(w, h, p.jaw);
  // keep the jaw on its screen spot, slide it along the eye ray so the wrench has its true length
  const d = norm(j), gd = dot(g, d);
  const jz = gd + Math.sqrt(Math.max(0, WRENCH_LEN * WRENCH_LEN - (dot(g, g) - gd * gd)));
  return axisPose(g, sub(mul(d, jz), g), p.face);
}

function wrench(name, from = null) {
  const sc = makeScene();
  const wr = wrenchPose(WRENCH_POSES[name]);
  sc.use(wr);

  // grip: red rubber sleeve with black bands, steel end cap
  sc.tube([0, -7, 0], [0, 7, 0], 2.0, 2.0, M.red, (h) => (h % 3.2 < 0.8 ? M.black : null));
  sc.tube([0, -8.6, 0], [0, -6.8, 0], 2.4, 2.4, M.steel);
  // torque collar
  sc.tube([0, 7, 0], [0, 10.4, 0], 2.3, 2.3, M.brass, (h) => (h > 1.4 && h < 2 ? M.gun : null));
  // shaft with a groove down each face
  sc.box([0, 19.5, 0], [1.6, 9.5, 1.0], M.steel, null,
    (x, y, z) => (Math.abs(x) < 0.45 && Math.abs(z) > 0.8 && Math.abs(y) < 8 ? M.gun : null));
  sc.box([0, 29.5, 0], [2.4, 1.4, 1.2], M.steel);
  // open jaw
  sc.box([0, 32.2, 0], [5.9, 2.2, 1.4], M.steel);
  sc.tube([0, 31.4, -1.4], [0, 31.4, 1.4], 4.6, 4.6, M.steel);
  sc.box([-4.2, 36.6, 0], [1.7, 4.0, 1.4], M.steel, [0, 0, 8]);
  sc.box([4.3, 36.2, 0], [1.7, 3.6, 1.4], M.steel, [0, 0, -6]);
  sc.blob([-2.8, 32.4, -1.4], 0.6, M.brass);
  sc.blob([2.8, 32.4, -1.4], 0.6, M.brass);
  sc.box([0, 33, 0.2], [2.2, 0.5, 1.3], M.red);

  fist(sc, {
    at: wr.pt([0, 0.5, 0]), axis: wr.y, back: add(mul(wr.x, 0.8), [0, 0, -0.6]),
    elbow: WRENCH_POSES[name].elbow, rh: 2.0,
  });

  // speed streaks traced by the jaw between the previous pose and this one
  return frame('wrench', sc, from && ((s, proj) => {
    const a = WRENCH_POSES[from], b = WRENCH_POSES[name];
    const at = (t) => wrenchPose({
      grip: lerp(a.grip, b.grip, t), jaw: lerp(a.jaw, b.jaw, t), face: a.face + (b.face - a.face) * t,
    });
    for (const [r, c, th] of [[36, '#5c626d', 3], [30, '#7a828e', 2], [24, '#5c626d', 2]]) {
      let prev = null;
      for (let i = 0; i <= 10; i++) {
        const p = proj(at(0.15 + i * 0.075).pt([0, r, 0]));
        if (prev) line(s, prev[0], prev[1], p[0], p[1], c, th);
        prev = p;
      }
    }
  }));
}

// ---------------------------------------------------------------- bolt driver

// Six-barrel rotary. spin turns the cluster (degrees), flash 0..1, which picks the firing barrel.
function boltGun({ kick = 0, spin = 0, flash = 0, which = 0 }) {
  const sc = makeScene();
  const gun = makePose([0.6, -18.6 - 0.6 * kick, 50 - 3 * kick], -2, 9 + 2 * kick, 0);
  sc.use(gun);

  sc.rod([0, -4, -5.5], [0, -13.5, -8.6], 1.9, 1.8, M.black);

  // barrel cluster
  const R = 3.6, bar = (i) => {
    const a = (spin + i * 60 + 90) * D2R;
    return [R * Math.cos(a), R * Math.sin(a)];
  };
  for (let i = 0; i < 6; i++) {
    const [bx, by] = bar(i);
    sc.tube([bx, by, 4], [bx, by, 36], 1.3, 1.3, M.steel, i === 0 ? (h) => (h > 25 && h < 27 ? M.amber : null) : null);
    sc.tube([bx, by, 35.6], [bx, by, 36.6], 1.5, 1.5, M.gun);
    sc.tube([bx, by, 36.5], [bx, by, 36.7], 0.7, 0.7, M.black);
  }
  sc.tube([0, 0, 4], [0, 0, 37], 1.4, 1.4, M.gun);
  const notch = (h, a) => ((a - spin * D2R + TAU * 4) % (TAU / 6) < 0.35 ? M.black : null);
  sc.tube([0, 0, 13], [0, 0, 15.5], 5.4, 5.4, M.cyan, notch);
  sc.tube([0, 0, 28], [0, 0, 29.5], 5.3, 5.3, M.gun, notch);
  // motor housing and receiver
  sc.tube([0, 0, 1], [0, 0, 4], 4.4, 4.4, M.gun, (h) => (h > 1.2 && h < 2 ? M.amber : null));
  sc.box([0, -2.6, -2.5], [5, 3.2, 6], M.cyan, null,
    (x, y, z) => (y > 3.0 && Math.abs(x) < 3.2 && z < 3 && (z + 9) % 3.4 < 1.5 ? M.black : null));
  sc.box([0, 1.0, -6], [1.4, 0.7, 1], M.gun);

  // ammo drum on the right, face to the eye, belt up into the receiver
  sc.tube([7.6, -7.5, 4], [7.6, -7.5, 11], 4.6, 4.6, M.gun, (h, a, r) => {
    if (h > 3 && h < 4.2) return M.amber;
    if (h > 0.1 || r > 3.8) return null;
    if (r < 1.5) return M.brass;
    return ((a + TAU) * 5 / TAU) % 1 < 0.22 ? M.black : null;
  });
  for (let i = 0; i < 5; i++) {
    const t = i / 4, p = [7.2 - 2.2 * t, -3.2 + 2.0 * t, 5 - 4 * t];
    sc.rod(add(p, [0, 0, -1.3]), add(p, [0, 0, 1.3]), 0.75, 0.55, M.brass);
  }

  // side handle for the left hand
  sc.rod([-5, -1, 24], [-10.5, -2.6, 23], 1.4, 1.4, M.black);

  fist(sc, {
    at: gun.pt([0, -8.8, -7.1]), axis: gun.dir([0, 0.95, 0.31]), back: gun.dir([0.78, 0, -0.62]),
    elbow: [15, -50, 14], rh: 1.8, thumb: gun.dir([-0.1, 0.15, 1]),
  });
  fist(sc, {
    at: gun.pt([-9, -2.2, 23.3]), axis: gun.dir([-1, -0.3, 0]), back: gun.dir([0, 0.6, -0.8]),
    elbow: [-14, -56, 44], rh: 1.4, left: true,
  });

  const [fx, fy] = bar(which ? 5 : 1);
  const muzzle = gun.pt([fx, fy, 38]);
  if (flash) sc.flash = { at: gun.pt([0, 3, 34]), power: 1.2 * flash, reach: 16 };
  return frame('bolt', sc, flash && ((s, proj, scale) => {
    const [x, y] = proj(muzzle);
    drawFlash(s, x, y + 2, 5.2 * scale(muzzle) * flash, 31 + which * 6, 6);
  }));
}

// ---------------------------------------------------------------- launcher

// Heavy tube launcher carried right of centre. kick 0..1 recoil, flash 0..1, heat 0..1 the coil.
function launcherGun({ kick = 0, flash = 0, heat = 0 }) {
  const sc = makeScene();
  const gun = makePose([3.5, -20.5 - 1.8 * kick, 54 - 8 * kick], -5, 6 + 8 * kick, 0);
  sc.use(gun);

  sc.rod([0, -6.5, -2], [0, -15, -5], 1.9, 1.8, M.black);

  // main tube, muzzle shroud, bore, rear venturi
  sc.tube([0, 0, -34], [0, 0, 30], 5.4, 5.4, M.red, (h) => (h > 21 && h < 23 ? M.black : null));
  sc.tube([0, 0, 30], [0, 0, 37], 6.3, 6.3, M.gun, (h) => (h > 2.2 && h < 3 ? M.brass : null));
  sc.tube([0, 0, 36.9], [0, 0, 37.2], 4.6, 4.6, M.black);
  sc.tube([0, 0, -16], [0, 0, -12], 5.9, 5.9, M.steel, (h, ang) => ((ang + TAU) % (TAU / 8) < 0.2 ? M.gun : null));
  // heat coil wound round the chamber
  const coil = heat > 0.5 ? M.hot : M.glow;
  sc.tube([0, 0, 0], [0, 0, 14], 5.8, 5.8, M.black, (h, a) => ((h / 3.5 + a / TAU + 8) % 1 < 0.5 ? coil : null));
  sc.tube([0, 0, -0.8], [0, 0, 0.2], 6.3, 6.3, M.steel);
  sc.tube([0, 0, 13.8], [0, 0, 14.8], 6.3, 6.3, M.steel);
  // top sight rail
  sc.box([0, 5.8, 20], [1.0, 0.6, 8], M.gun);
  sc.box([0, 7.2, 27], [1.8, 1.1, 0.5], M.steel, null, (x) => (Math.abs(x) < 0.6 ? M.amber : null));
  // canister magazine on the left
  sc.box([-6.6, -1.5, 22], [1.6, 3.6, 5], M.steel, null, (x, y, z) => (Math.abs(z) < 1.2 ? M.amber : null));
  // fore-end
  sc.box([0, -6.4, 22], [7.0, 1.8, 5.5], M.pad, null, (x, y, z) => ((z + 6) % 1.9 < 0.6 ? M.black : null));

  fist(sc, {
    at: gun.pt([0, -10.5, -3.5]), axis: gun.dir([0, 0.95, 0.31]), back: gun.dir([0.78, 0, -0.62]),
    elbow: [18, -50, 18], rh: 1.8, thumb: gun.dir([-0.1, 0.15, 1]),
  });
  cradle(sc, { c: [0, -6.4, 22], hw: 7.0, hh: 1.8, elbow: [-16, -50, 30] });

  const muzzle = gun.pt([0, 0, 38]);
  if (flash) sc.flash = { at: gun.pt([0, 7, 32]), power: 1.7 * flash, reach: 26 };
  return frame('launcher', sc, null, flash && ((s, proj, scale) => {
    const [x, y] = proj(muzzle);
    drawFlash(s, x, y - 1, 10 * scale(muzzle) * flash, 41, 9, 0.8);
  }));
}

// ---------------------------------------------------------------- export

export function drawWeaponFrames() {
  return {
    wp_wrench_idle: wrench('idle'),
    wp_wrench_fire0: wrench('wind'),
    wp_wrench_fire1: wrench('strike', 'wind'),
    wp_wrench_fire2: wrench('follow', 'strike'),
    wp_rivet_idle: rivetGun({}),
    wp_rivet_fire0: rivetGun({ kick: 1, flash: 1 }),
    wp_rivet_fire1: rivetGun({ kick: 0.45 }),
    wp_scatter_idle: scatterGun({}),
    wp_scatter_fire0: scatterGun({ kick: 0.55, flash: 1 }),
    wp_scatter_fire1: scatterGun({ kick: 1 }),
    wp_scatter_fire2: scatterGun({ kick: 0.4, pump: 1 }),
    wp_scatter_fire3: scatterGun({ kick: 0.1, pump: 0.45 }),
    wp_bolt_idle: boltGun({}),
    wp_bolt_fire0: boltGun({ kick: 1, spin: 0, flash: 1, which: 0 }),
    wp_bolt_fire1: boltGun({ kick: 0.7, spin: 30, flash: 0.85, which: 1 }),
    wp_launcher_idle: launcherGun({}),
    wp_launcher_fire0: launcherGun({ kick: 1, flash: 1, heat: 1 }),
    wp_launcher_fire1: launcherGun({ kick: 0.55, heat: 1 }),
    wp_launcher_fire2: launcherGun({ kick: 0.2 }),
  };
}
