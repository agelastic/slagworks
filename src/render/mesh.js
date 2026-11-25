// World mesh builder: grid cells -> textured quads grouped by texture name. No GL in here.
//
// Vertex = x y z u v light flicker (VERT_FLOATS floats), 6 vertices per quad, no index buffer.
// Winding: every quad is counter-clockwise on screen from the side it is meant to be seen from.
// The view transform mirrors the world (y is to the right of x), so the right-handed normal of
// a visible face points away from the viewer.
//
// Texture coordinates stay within a few units of zero (u in 0..1 per cell, v shifted by a whole
// number per quad) so a 16-bit mediump float in the fragment shader is enough.

import { SKY } from '../config.js';

export const VERT_FLOATS = 7;
const QUAD_FLOATS = 6 * VERT_FLOATS;
const SIDE_SHADE = 0.85;     // walls facing +-x are darker

export class Batches {
  constructor() {
    this.byTex = new Map();
    this.list = [];
  }

  reset() {
    for (let i = 0; i < this.list.length; i++) this.list[i].n = 0;
  }

  // Returns the float offset where the next quad of this texture goes.
  alloc(tex) {
    let b = this.byTex.get(tex);
    if (!b) {
      b = { tex, data: new Float32Array(QUAD_FLOATS * 16), n: 0 };
      this.byTex.set(tex, b);
      this.list.push(b);
    }
    if (b.n + QUAD_FLOATS > b.data.length) {
      const grown = new Float32Array(b.data.length * 2);
      grown.set(b.data);
      b.data = grown;
    }
    this.cur = b.data;
    const o = b.n;
    b.n += QUAD_FLOATS;
    return o;
  }

  floats() {
    let n = 0;
    for (let i = 0; i < this.list.length; i++) n += this.list[i].n;
    return n;
  }

  // Vertical quad from (xa, ya) to (xb, yb), a = left end as seen from the visible side.
  // v: texture row 0 (image top) sits at z = anchor + whole numbers and runs downwards.
  wall(tex, xa, ya, xb, yb, z0, z1, anchor, light, flicker) {
    if (!(z1 > z0)) return;
    let vt = anchor - z1, vb = anchor - z0;
    const k = Math.floor((vt + vb) * 0.5 + 0.5);
    vt -= k;
    vb -= k;
    const o = this.alloc(tex), d = this.cur;
    put(d, o, xa, ya, z0, 0, vb, light, flicker);
    put(d, o + 7, xb, yb, z0, 1, vb, light, flicker);
    put(d, o + 14, xb, yb, z1, 1, vt, light, flicker);
    put(d, o + 21, xa, ya, z0, 0, vb, light, flicker);
    put(d, o + 28, xb, yb, z1, 1, vt, light, flicker);
    put(d, o + 35, xa, ya, z1, 0, vt, light, flicker);
  }

  // Horizontal quad over cell (cx, cy). u follows world x, v follows world y.
  flat(tex, cx, cy, z, up, light, flicker) {
    const o = this.alloc(tex), d = this.cur;
    const x1 = cx + 1, y1 = cy + 1;
    if (up) {
      put(d, o, cx, cy, z, 0, 0, light, flicker);
      put(d, o + 7, cx, y1, z, 0, 1, light, flicker);
      put(d, o + 14, x1, y1, z, 1, 1, light, flicker);
      put(d, o + 21, cx, cy, z, 0, 0, light, flicker);
      put(d, o + 28, x1, y1, z, 1, 1, light, flicker);
      put(d, o + 35, x1, cy, z, 1, 0, light, flicker);
    } else {
      put(d, o, cx, cy, z, 0, 0, light, flicker);
      put(d, o + 7, x1, cy, z, 1, 0, light, flicker);
      put(d, o + 14, x1, y1, z, 1, 1, light, flicker);
      put(d, o + 21, cx, cy, z, 0, 0, light, flicker);
      put(d, o + 28, x1, y1, z, 1, 1, light, flicker);
      put(d, o + 35, cx, y1, z, 0, 1, light, flicker);
    }
  }
}

function put(d, o, x, y, z, u, v, light, flicker) {
  d[o] = x; d[o + 1] = y; d[o + 2] = z;
  d[o + 3] = u; d[o + 4] = v;
  d[o + 5] = light; d[o + 6] = flicker;
}

// Faces of cell a towards neighbour b, on the edge from (xa, ya) to (xb, yb).
function side(out, a, b, xa, ya, xb, yb, light, flicker) {
  if (b.solid) {
    out.wall(b.wall, xa, ya, xb, yb, a.floor, a.ceil, 0, light, flicker);
    return;
  }
  if (b.floor > a.floor) {
    // a lift riser hangs from the platform edge so the texture travels with it
    out.wall(b.wt, xa, ya, xb, yb, a.floor, Math.min(b.floor, a.ceil), b.lift ? b.floor : 0, light, flicker);
  }
  if (b.ceil < a.ceil && !(a.ct === SKY && b.ct === SKY)) {
    const lo = Math.max(b.ceil, a.floor);
    if (b.door) {
      // moving slab, texture fixed to its bottom edge, and a fixed header above the door frame
      const top = Math.min(Math.max(b.ceil0, lo), a.ceil);
      out.wall(b.door.tex, xa, ya, xb, yb, lo, top, b.ceil, light, flicker);
      out.wall(b.wt, xa, ya, xb, yb, top, a.ceil, 0, light, flicker);
    } else {
      out.wall(b.wt, xa, ya, xb, yb, lo, a.ceil, 0, light, flicker);
    }
  }
}

export function emitCell(world, a, out) {
  if (a.solid || !(a.ceil > a.floor)) return;
  const cx = a.cx, cy = a.cy, light = a.light, flicker = a.flicker || 0;
  out.flat(a.ft, cx, cy, a.floor, true, light, flicker);
  if (a.ct !== SKY) out.flat(a.ct, cx, cy, a.ceil, false, light, flicker);
  const dim = light * SIDE_SHADE;
  side(out, a, world.cell(cx + 1, cy), cx + 1, cy, cx + 1, cy + 1, dim, flicker);
  side(out, a, world.cell(cx - 1, cy), cx, cy + 1, cx, cy, dim, flicker);
  side(out, a, world.cell(cx, cy + 1), cx + 1, cy + 1, cx, cy + 1, light, flicker);
  side(out, a, world.cell(cx, cy - 1), cx, cy, cx + 1, cy, light, flicker);
}
