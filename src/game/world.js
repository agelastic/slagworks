// The level grid: cells, movers (doors and lifts), tags, body collision, ray casts,
// line of sight, the enemy flow field and the sound flood.

import {
  STEP_HEIGHT, SKY, TEX_SWITCH_ON, TEX_SWITCH_OFF, TEX_EXIT_ON, KEY_DOOR_TEXTURES,
} from '../config.js';
import { GRAVITY, MAX_FALL } from './tuning.js';

export const NO_PATH = 0xffff;

const DOOR_SPEED = 2.5;        // units per second
const DOOR_OPEN_TIME = 4;      // seconds a plain door stays open
const LIFT_SPEED = 1.5;
const LIFT_BOARD_TIME = 0.4;   // standing time before an untagged lift departs
const LIFT_RETURN_TIME = 3;    // empty time before it goes home
const EPS = 1e-6;
const MOVE_STEP = 0.15;        // longest collision sub-step, must stay below the smallest radius
const WALK_CLEARANCE = 0.5;    // headroom the flow field asks for

const SEEN_RAYS = 240;
const RAY_COS = new Float64Array(SEEN_RAYS);
const RAY_SIN = new Float64Array(SEEN_RAYS);
for (let i = 0; i < SEEN_RAYS; i++) {
  RAY_COS[i] = Math.cos((i + 0.5) / SEEN_RAYS * Math.PI * 2);
  RAY_SIN[i] = Math.sin((i + 0.5) / SEEN_RAYS * Math.PI * 2);
}

function blankCell(cx, cy) {
  return {
    cx, cy, solid: false, wall: null,
    floor: 0, ceil: 0, floor0: 0, ceil0: 0,
    ft: null, ct: null, wt: null, light: 0, flicker: 0, damage: 0,
    door: null, lift: null, mover: false, dynamic: false,
    secret: false, trigger: 0, exit: false, switch: null, seen: false,
    secretId: 0, triggered: false,
  };
}

const OUTSIDE = blankCell(-1, -1);
OUTSIDE.solid = true;
OUTSIDE.wall = 'w_plate';

function buildCell(cx, cy, def, ch) {
  if (!def) throw new Error(`level cell '${ch}' at ${cx},${cy} has no legend entry`);
  const c = blankCell(cx, cy);
  if (def.solid) {
    c.solid = true;
    c.wall = def.wall || 'w_plate';
    c.exit = !!def.exit;
    if (def.switch) c.switch = { tag: def.switch.tag | 0, on: false, readyAt: 0 };
    return c;
  }
  c.floor = c.floor0 = def.floor || 0;
  c.ceil = c.ceil0 = def.ceil === undefined ? c.floor + 1.5 : def.ceil;
  c.ft = def.ft || 'f_plate';
  c.ct = def.ct || 'c_panel';
  c.wt = def.wt || 'w_plate';
  c.light = def.light === undefined ? 0.8 : def.light;
  c.flicker = def.flicker || 0;
  c.damage = def.damage || 0;
  c.secret = !!def.secret;
  c.trigger = def.trigger | 0;
  if (def.door) {
    const key = def.door.key || null;
    c.door = {
      tex: def.door.tex || (key ? KEY_DOOR_TEXTURES[key] : 'w_door'),
      key, tag: def.door.tag | 0, secret: !!def.door.secret, open: 0, group: null,
    };
    c.ceil = c.floor;
    c.mover = true;
  } else if (def.lift) {
    c.lift = { low: def.lift.low, high: def.lift.high, tag: def.lift.tag | 0, group: null };
    c.mover = true;
  }
  return c;
}

function sameMover(a, b) {
  if (a.door) {
    return !!b.door && a.door.key === b.door.key && a.door.tag === b.door.tag
      && a.door.secret === b.door.secret;
  }
  return !!b.lift && a.lift.low === b.lift.low && a.lift.high === b.lift.high
    && a.lift.tag === b.lift.tag;
}

function plainDoor(c) {
  return !!c.door && !c.door.key && !c.door.tag && !c.door.secret;
}

// A ground enemy can stand in this cell.
function standable(c) {
  if (c.solid || c.damage > 0) return false;
  return c.ceil - c.floor >= WALK_CLEARANCE || plainDoor(c);
}

function canStep(a, b) {
  return standable(a) && standable(b) && Math.abs(a.floor - b.floor) <= STEP_HEIGHT + EPS;
}

// First point where a ray meets an upright cylinder, as map distance along the ray, or -1.
// (dx, dy) is unit length on the map plane, dz the rise per unit of map distance.
export function rayCylinder(ox, oy, oz, dx, dy, dz, cx, cy, cz, r, h, maxT) {
  const mx = cx - ox, my = cy - oy;
  const along = mx * dx + my * dy;
  const off2 = mx * mx + my * my - along * along;
  if (off2 >= r * r) return -1;
  const half = Math.sqrt(r * r - off2);
  let t0 = along - half, t1 = along + half;
  if (t1 < 0 || t0 > maxT) return -1;
  if (t0 < 0) t0 = 0;
  if (dz === 0) {
    if (oz < cz || oz > cz + h) return -1;
  } else {
    let ta = (cz - oz) / dz, tb = (cz + h - oz) / dz;
    if (ta > tb) { const s = ta; ta = tb; tb = s; }
    if (ta > t0) t0 = ta;
    if (tb < t1) t1 = tb;
    if (t0 > t1) return -1;
  }
  return t0 <= maxT ? t0 : -1;
}

// Distance from a point to an upright cylinder (0 inside).
export function cylinderDistance(x, y, z, cx, cy, cz, r, h) {
  const d = Math.max(0, Math.hypot(cx - x, cy - y) - r);
  const dz = z < cz ? cz - z : z > cz + h ? z - cz - h : 0;
  return Math.hypot(d, dz);
}

export function circleTouchesCell(x, y, r, c) {
  const qx = x < c.cx ? c.cx : x > c.cx + 1 ? c.cx + 1 : x;
  const qy = y < c.cy ? c.cy : y > c.cy + 1 ? c.cy + 1 : y;
  const dx = x - qx, dy = y - qy;
  return dx * dx + dy * dy < r * r;
}

export class World {
  // emit(id, x, y) receives mover sounds.
  constructor(level, emit) {
    const rows = level.cells;
    this.h = rows.length;
    this.w = rows[0].length;
    this.emit = emit || (() => {});
    this.version = 0;

    const n = this.w * this.h;
    this.cells = new Array(n);
    for (let cy = 0; cy < this.h; cy++) {
      if (rows[cy].length !== this.w) throw new Error(`level row ${cy} is ${rows[cy].length} wide, expected ${this.w}`);
      for (let cx = 0; cx < this.w; cx++) {
        const ch = rows[cy][cx];
        this.cells[cy * this.w + cx] = buildCell(cx, cy, level.legend[ch], ch);
      }
    }

    this.movers = this.cells.filter((c) => c.mover);
    this.groups = [];
    this.buildGroups();
    for (const m of this.movers) {
      m.dynamic = true;
      for (const nb of this.neighbours(m)) nb.dynamic = true;
    }

    // Touching secret cells count as one secret.
    this.secrets = 0;
    for (const start of this.cells) {
      if (!start.secret || start.secretId) continue;
      const id = ++this.secrets;
      const stack = [start];
      start.secretId = id;
      while (stack.length) {
        for (const nb of this.neighbours(stack.pop())) {
          if (nb.secret && !nb.secretId) { nb.secretId = id; stack.push(nb); }
        }
      }
    }

    this.flow = new Uint16Array(n);      // steps to the player's cell, NO_PATH where unreachable
    this.flow.fill(NO_PATH);
    this.flowDirty = true;
    this.flowX = -1;
    this.flowY = -1;
    this.heard = new Uint8Array(n);      // result of the last flood()
    this.queue = new Int32Array(n);
    this.steps = new Uint16Array(n);

    // Details of the last castRay() hit.
    this.hit = { kind: null, t: 0, x: 0, y: 0, z: 0, nx: 0, ny: 0, cell: null };
  }

  cell(cx, cy) {
    if (cx < 0 || cy < 0 || cx >= this.w || cy >= this.h) return OUTSIDE;
    return this.cells[cy * this.w + cx];
  }

  cellAt(x, y) {
    return this.cell(Math.floor(x), Math.floor(y));
  }

  // In-bounds 4-neighbours.
  neighbours(c) {
    const out = [];
    if (c.cx > 0) out.push(this.cells[c.cy * this.w + c.cx - 1]);
    if (c.cx < this.w - 1) out.push(this.cells[c.cy * this.w + c.cx + 1]);
    if (c.cy > 0) out.push(this.cells[(c.cy - 1) * this.w + c.cx]);
    if (c.cy < this.h - 1) out.push(this.cells[(c.cy + 1) * this.w + c.cx]);
    return out;
  }

  // ---------------------------------------------------------------- movers

  // Touching doors (same key, tag, secret) and touching lifts (same heights, tag) move as one.
  buildGroups() {
    const done = new Set();
    for (const start of this.movers) {
      if (done.has(start)) continue;
      const cells = [];
      const stack = [start];
      done.add(start);
      while (stack.length) {
        const c = stack.pop();
        cells.push(c);
        for (const nb of this.neighbours(c)) {
          if (nb.mover && !done.has(nb) && sameMover(start, nb)) { done.add(nb); stack.push(nb); }
        }
      }
      let g;
      if (start.door) {
        let tallest = 0.1;
        for (const c of cells) tallest = Math.max(tallest, c.ceil0 - c.floor);
        g = { kind: 'door', cells, state: 'closed', open: 0, timer: 0, stay: false, rate: DOOR_SPEED / tallest };
        for (const c of cells) c.door.group = g;
      } else {
        const lift = start.lift;
        const home = Math.abs(start.floor0 - lift.high) < Math.abs(start.floor0 - lift.low) ? 1 : 0;
        g = { kind: 'lift', cells, pos: home, target: home, home, board: 0, away: 0, armed: true };
        for (const c of cells) {
          c.lift.group = g;
          c.floor = home ? c.lift.high : c.lift.low;
        }
      }
      g.x = start.cx + 0.5;
      g.y = start.cy + 0.5;
      this.groups.push(g);
    }
  }

  // player: body used by untagged lifts, or null. occupied(cell): true when a body is in the cell.
  update(dt, player, occupied) {
    for (const g of this.groups) {
      if (g.kind === 'door') this.updateDoor(g, dt, occupied);
      else this.updateLift(g, dt, player);
    }
  }

  setDoor(g, open) {
    g.open = open;
    for (const c of g.cells) {
      c.door.open = open;
      c.ceil = c.floor + (c.ceil0 - c.floor) * open;
    }
  }

  updateDoor(g, dt, occupied) {
    if (g.state === 'opening') {
      this.setDoor(g, Math.min(1, g.open + g.rate * dt));
      if (g.open >= 1) {
        g.state = 'open';
        g.timer = DOOR_OPEN_TIME;
        this.flowDirty = true;
      }
    } else if (g.state === 'open') {
      if (g.stay) return;
      g.timer -= dt;
      if (g.timer > 0) return;
      if (g.cells.some(occupied)) g.timer = 0.5;
      else {
        g.state = 'closing';
        this.emit('door_close', g.x, g.y);
      }
    } else if (g.state === 'closing') {
      if (g.cells.some(occupied)) {
        g.state = 'opening';
        this.emit('door_open', g.x, g.y);
        return;
      }
      this.setDoor(g, Math.max(0, g.open - g.rate * dt));
      if (g.open <= 0) {
        g.state = 'closed';
        this.flowDirty = true;
      }
    }
  }

  openDoor(g) {
    if (g.state === 'open' || g.state === 'opening') return;
    g.state = 'opening';
    this.flowDirty = true;
    this.emit('door_open', g.x, g.y);
  }

  // The player uses a door cell. Returns 'opened', 'locked' (key missing), 'tagged'
  // (opens elsewhere) or null when there is nothing to do.
  useDoor(c, keys) {
    const d = c.door, g = d.group;
    if (g.state === 'open' || g.state === 'opening') return null;
    if (d.tag) return 'tagged';
    if (d.key && !(keys && keys[d.key])) return 'locked';
    if (d.key || d.secret) g.stay = true;
    this.openDoor(g);
    return 'opened';
  }

  // A chasing enemy next to a door: only plain doors give way.
  nudgeDoor(c) {
    if (plainDoor(c)) this.openDoor(c.door.group);
  }

  onLift(g, body) {
    const c = this.cellAt(body.x, body.y);
    return !!c.lift && c.lift.group === g && Math.abs(body.z - c.floor) < 0.1;
  }

  sendLift(g, target) {
    if (g.target === target) return;
    g.target = target;
    this.emit('lift_move', g.x, g.y);
  }

  // Brings an untagged lift that is at rest to its other end. Returns true if it left.
  callLift(c) {
    const g = c.lift.group;
    if (c.lift.tag || g.pos !== g.target) return false;
    this.sendLift(g, 1 - g.target);
    return true;
  }

  updateLift(g, dt, player) {
    const lift = g.cells[0].lift;
    if (lift.tag === 0) {
      const riding = !!player && this.onLift(g, player);
      if (g.pos === g.target) {
        if (riding) {
          g.away = 0;
          if (g.armed) {
            g.board += dt;
            if (g.board >= LIFT_BOARD_TIME) {
              g.armed = false;
              this.sendLift(g, 1 - g.target);
            }
          }
        } else {
          g.armed = true;
          g.board = 0;
          if (g.target !== g.home) {
            g.away += dt;
            if (g.away >= LIFT_RETURN_TIME) this.sendLift(g, g.home);
          }
        }
      } else if (!riding) {
        g.armed = true;
      }
    }
    if (g.pos === g.target) return;
    const step = LIFT_SPEED / Math.max(0.1, lift.high - lift.low) * dt;
    g.pos = g.target > g.pos ? Math.min(g.target, g.pos + step) : Math.max(g.target, g.pos - step);
    for (const c of g.cells) c.floor = c.lift.low + (c.lift.high - c.lift.low) * g.pos;
    if (g.pos === g.target) {
      g.away = 0;
      g.board = 0;
      this.flowDirty = true;
      this.emit('lift_stop', g.x, g.y);
    }
  }

  // Opens every door and toggles every lift carrying the tag. Returns how many groups reacted.
  fireTag(tag) {
    if (!tag) return 0;
    let n = 0;
    for (const g of this.groups) {
      const first = g.cells[0];
      if ((first.door || first.lift).tag !== tag) continue;
      n++;
      if (g.kind === 'door') {
        g.stay = true;
        this.openDoor(g);
      } else {
        this.sendLift(g, 1 - g.target);
      }
    }
    return n;
  }

  tagHasLift(tag) {
    return this.groups.some((g) => g.kind === 'lift' && g.cells[0].lift.tag === tag);
  }

  flipSwitch(c) {
    c.switch.on = !c.switch.on;
    c.wall = c.switch.on ? TEX_SWITCH_ON : TEX_SWITCH_OFF;
    this.version++;
  }

  lightExit(c) {
    c.wall = TEX_EXIT_ON;
    this.version++;
  }

  // ---------------------------------------------------------------- bodies
  //
  // A body is { x, y, z, vz, radius (< 0.5), clearance, step, noDrop, noDamage, onGround }.

  // True when the body may not overlap this cell.
  blocks(c, b) {
    if (c.solid) return true;
    const z = b.z;
    if (c.floor - z > b.step + EPS) return true;
    if (c.ceil - (c.floor > z ? c.floor : z) < b.clearance - EPS) return true;
    if (b.noDrop && b.onGround && z - c.floor > b.step + EPS) return true;
    if (b.noDamage && c.damage > 0) return true;
    return false;
  }

  // True when the body placed at (x, y) would overlap a blocking cell.
  stuck(b, x, y) {
    const r = b.radius - 1e-5;
    const x0 = Math.floor(x - r), x1 = Math.floor(x + r);
    const y0 = Math.floor(y - r), y1 = Math.floor(y + r);
    for (let cy = y0; cy <= y1; cy++) {
      for (let cx = x0; cx <= x1; cx++) {
        const c = this.cell(cx, cy);
        if (!this.blocks(c, b)) continue;
        const qx = x < cx ? cx : x > cx + 1 ? cx + 1 : x;
        const qy = y < cy ? cy : y > cy + 1 ? cy + 1 : y;
        const dx = x - qx, dy = y - qy;
        if (dx * dx + dy * dy < r * r) return true;
      }
    }
    return false;
  }

  // The centre is inside a blocking cell: creep toward the nearest side that is free.
  escape(b, cx, cy) {
    const r = b.radius;
    const fx = b.x - cx, fy = b.y - cy;
    let best = Infinity, ex = b.x, ey = b.y;
    if (fx < best && !this.blocks(this.cell(cx - 1, cy), b)) { best = fx; ex = cx - r; ey = b.y; }
    if (1 - fx < best && !this.blocks(this.cell(cx + 1, cy), b)) { best = 1 - fx; ex = cx + 1 + r; ey = b.y; }
    if (fy < best && !this.blocks(this.cell(cx, cy - 1), b)) { best = fy; ex = b.x; ey = cy - r; }
    if (1 - fy < best && !this.blocks(this.cell(cx, cy + 1), b)) { best = 1 - fy; ex = b.x; ey = cy + 1 + r; }
    if (best === Infinity) return;
    const dx = ex - b.x, dy = ey - b.y;
    const d = Math.hypot(dx, dy);
    if (d < EPS) return;
    const m = Math.min(d, 0.1);
    b.x += dx / d * m;
    b.y += dy / d * m;
  }

  // Pushes the circle out of the blocking cells around it: faces first, then corners,
  // so sliding along a wall never catches on the seams between cells.
  pushOut(b) {
    const r = b.radius;
    for (let pass = 0; pass < 2; pass++) {
      const cx = Math.floor(b.x), cy = Math.floor(b.y);
      if (this.blocks(this.cell(cx, cy), b)) {
        this.escape(b, cx, cy);
        return;
      }
      let moved = false;
      if (b.x - cx < r && this.blocks(this.cell(cx - 1, cy), b)) { b.x = cx + r; moved = true; }
      if (cx + 1 - b.x < r && this.blocks(this.cell(cx + 1, cy), b)) { b.x = cx + 1 - r; moved = true; }
      if (b.y - cy < r && this.blocks(this.cell(cx, cy - 1), b)) { b.y = cy + r; moved = true; }
      if (cy + 1 - b.y < r && this.blocks(this.cell(cx, cy + 1), b)) { b.y = cy + 1 - r; moved = true; }
      for (let i = 0; i < 4; i++) {
        const sx = i & 1 ? 1 : -1, sy = i & 2 ? 1 : -1;
        const qx = sx < 0 ? cx : cx + 1, qy = sy < 0 ? cy : cy + 1;
        const dx = b.x - qx, dy = b.y - qy;
        const d2 = dx * dx + dy * dy;
        if (d2 >= r * r || d2 < 1e-12) continue;
        if (!this.blocks(this.cell(cx + sx, cy + sy), b)) continue;
        const k = r / Math.sqrt(d2);
        b.x = qx + dx * k;
        b.y = qy + dy * k;
        moved = true;
      }
      if (!moved) return;
    }
  }

  // Moves the body by (dx, dy) on the map plane, sliding along whatever blocks it.
  moveBody(b, dx, dy) {
    const n = Math.max(1, Math.ceil(Math.hypot(dx, dy) / MOVE_STEP));
    const sx = dx / n, sy = dy / n;
    for (let i = 0; i < n; i++) {
      const ox = b.x, oy = b.y;
      b.x = ox + sx;
      b.y = oy + sy;
      this.pushOut(b);
      if (this.stuck(b, b.x, b.y)) {
        if (this.stuck(b, ox, oy)) {
          // Wedged before the move (a mover closed in): keep any progress out of it.
        } else if (!this.stuck(b, ox + sx, oy)) {
          b.x = ox + sx; b.y = oy;
        } else if (!this.stuck(b, ox, oy + sy)) {
          b.x = ox; b.y = oy + sy;
        } else {
          b.x = ox; b.y = oy;
        }
      }
      if (this.cellAt(b.x, b.y).solid && !this.cellAt(ox, oy).solid) { b.x = ox; b.y = oy; }
    }
  }

  // Highest floor among the cells the body overlaps and can stand on.
  groundZ(b) {
    const r = b.radius - 1e-4;
    const x0 = Math.floor(b.x - r), x1 = Math.floor(b.x + r);
    const y0 = Math.floor(b.y - r), y1 = Math.floor(b.y + r);
    let z = -Infinity;
    for (let cy = y0; cy <= y1; cy++) {
      for (let cx = x0; cx <= x1; cx++) {
        const c = this.cell(cx, cy);
        if (c.solid || c.floor <= z || c.floor - b.z > b.step + EPS) continue;
        if (circleTouchesCell(b.x, b.y, r, c)) z = c.floor;
      }
    }
    return z === -Infinity ? b.z : z;
  }

  // Lowest ceiling among the cells the body overlaps.
  ceilZ(b) {
    const r = b.radius - 1e-4;
    const x0 = Math.floor(b.x - r), x1 = Math.floor(b.x + r);
    const y0 = Math.floor(b.y - r), y1 = Math.floor(b.y + r);
    let z = Infinity;
    for (let cy = y0; cy <= y1; cy++) {
      for (let cx = x0; cx <= x1; cx++) {
        const c = this.cell(cx, cy);
        if (c.ceil >= z || this.blocks(c, b)) continue;
        if (circleTouchesCell(b.x, b.y, r, c)) z = c.ceil;
      }
    }
    return z;
  }

  // Vertical motion for one step. Returns the height stepped up (> 0), the landing
  // speed (< 0) on touchdown, or 0.
  settle(b, dt) {
    const gz = this.groundZ(b);
    if (b.z <= gz) {
      const up = gz - b.z;
      b.z = gz;
      b.vz = 0;
      b.onGround = true;
      return up;
    }
    if (b.onGround && b.z - gz <= 0.06) {   // small ledges and descending lifts: stay planted
      b.z = gz;
      return 0;
    }
    b.onGround = false;
    b.vz = Math.max(b.vz - GRAVITY * dt, -MAX_FALL);
    b.z += b.vz * dt;
    if (b.z > gz) return 0;
    const v = b.vz;
    b.z = gz;
    b.vz = 0;
    b.onGround = true;
    return v;
  }

  // ---------------------------------------------------------------- rays

  // Walks the grid along a ray from (ox, oy, oz). (dx, dy) is unit length on the map plane,
  // dz the rise per unit of map distance. Returns the map distance to the first surface,
  // or maxT when nothing is hit; world.hit holds the details (kind null, 'wall', 'floor',
  // 'ceil' or 'sky').
  castRay(ox, oy, oz, dx, dy, dz, maxT) {
    const hit = this.hit;
    let cx = Math.floor(ox), cy = Math.floor(oy);
    const sx = dx > 0 ? 1 : -1, sy = dy > 0 ? 1 : -1;
    const ddx = dx !== 0 ? Math.abs(1 / dx) : Infinity;
    const ddy = dy !== 0 ? Math.abs(1 / dy) : Infinity;
    let tx = dx > 0 ? (cx + 1 - ox) * ddx : dx < 0 ? (ox - cx) * ddx : Infinity;
    let ty = dy > 0 ? (cy + 1 - oy) * ddy : dy < 0 ? (oy - cy) * ddy : Infinity;
    let c = this.cell(cx, cy);
    // An origin outside the open span of its own cell ignores that cell's flats.
    let flats = !c.solid && oz >= c.floor && oz <= c.ceil;
    hit.nx = 0;
    hit.ny = 0;
    for (;;) {
      const te = Math.min(tx, ty, maxT);
      if (flats) {
        const ze = oz + dz * te;
        if (ze < c.floor || ze > c.ceil) {
          const low = ze < c.floor;
          const t = ((low ? c.floor : c.ceil) - oz) / dz;
          hit.kind = low ? 'floor' : c.ct === SKY ? 'sky' : 'ceil';
          hit.t = t;
          hit.x = ox + dx * t;
          hit.y = oy + dy * t;
          hit.z = low ? c.floor : c.ceil;
          hit.cell = c;
          return t;
        }
      }
      if (te >= maxT) {
        hit.kind = null;
        hit.cell = null;
        return maxT;
      }
      let side;
      if (tx < ty) { side = 0; cx += sx; tx += ddx; } else { side = 1; cy += sy; ty += ddy; }
      c = this.cell(cx, cy);
      flats = true;
      const z = oz + dz * te;
      if (c.solid || z < c.floor || z > c.ceil) {
        hit.kind = 'wall';
        hit.t = te;
        hit.x = ox + dx * te;
        hit.y = oy + dy * te;
        hit.z = z;
        hit.nx = side === 0 ? -sx : 0;
        hit.ny = side === 1 ? -sy : 0;
        hit.cell = c;
        return te;
      }
    }
  }

  // Clear straight line between two points.
  los(x0, y0, z0, x1, y1, z1) {
    const dx = x1 - x0, dy = y1 - y0;
    const d = Math.hypot(dx, dy);
    if (d < 1e-6) return true;
    this.castRay(x0, y0, z0, dx / d, dy / d, (z1 - z0) / d, d);
    return this.hit.kind === null;
  }

  // Marks the cells visible from the eye point as seen (automap).
  markSeen(x, y, eyeZ, range) {
    const start = this.cellAt(x, y);
    if (start === OUTSIDE) return;
    start.seen = true;
    for (let i = 0; i < SEEN_RAYS; i++) {
      const dx = RAY_COS[i], dy = RAY_SIN[i];
      let cx = start.cx, cy = start.cy;
      const sx = dx > 0 ? 1 : -1, sy = dy > 0 ? 1 : -1;
      const ddx = Math.abs(1 / dx), ddy = Math.abs(1 / dy);
      let tx = dx > 0 ? (cx + 1 - x) * ddx : (x - cx) * ddx;
      let ty = dy > 0 ? (cy + 1 - y) * ddy : (y - cy) * ddy;
      for (;;) {
        let t;
        if (tx < ty) { t = tx; cx += sx; tx += ddx; } else { t = ty; cy += sy; ty += ddy; }
        if (t > range || cx < 0 || cy < 0 || cx >= this.w || cy >= this.h) break;
        const c = this.cells[cy * this.w + cx];
        c.seen = true;
        if (c.solid || c.ceil - c.floor < 0.05 || c.floor > eyeZ + 0.4 || c.ceil < eyeZ - 0.4) break;
      }
    }
  }

  // ---------------------------------------------------------------- flow field and sound

  // Breadth-first distances from the player's cell over cells ground enemies can walk.
  computeFlow(px, py) {
    const { w, h, cells, flow, queue } = this;
    flow.fill(NO_PATH);
    this.flowDirty = false;
    this.flowX = Math.floor(px);
    this.flowY = Math.floor(py);
    if (this.flowX < 0 || this.flowY < 0 || this.flowX >= w || this.flowY >= h) return;
    const start = this.flowY * w + this.flowX;
    flow[start] = 0;
    queue[0] = start;
    let head = 0, tail = 1;
    while (head < tail) {
      const i = queue[head++];
      const a = cells[i];
      const d = flow[i] + 1;
      const cx = i % w, cy = (i - cx) / w;
      for (let k = 0; k < 4; k++) {
        const nx = cx + (k === 0 ? -1 : k === 1 ? 1 : 0);
        const ny = cy + (k === 2 ? -1 : k === 3 ? 1 : 0);
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        const j = ny * w + nx;
        if (flow[j] !== NO_PATH) continue;
        const b = cells[j];
        if (!standable(b) || a.solid || Math.abs(a.floor - b.floor) > STEP_HEIGHT + EPS) continue;
        flow[j] = d;
        queue[tail++] = j;
      }
    }
  }

  flowAt(cx, cy) {
    if (cx < 0 || cy < 0 || cx >= this.w || cy >= this.h) return NO_PATH;
    return this.flow[cy * this.w + cx];
  }

  // The neighbouring cell an enemy in (cx, cy) should walk to, or null. Ties go to the
  // neighbour closest to the direction (tdx, tdy).
  flowNext(cx, cy, tdx, tdy) {
    const here = this.flowAt(cx, cy);
    if (here === NO_PATH || here === 0) return null;
    const a = this.cell(cx, cy);
    let best = null, bestD = here, bestDot = -Infinity;
    for (let oy = -1; oy <= 1; oy++) {
      for (let ox = -1; ox <= 1; ox++) {
        if (!ox && !oy) continue;
        const d = this.flowAt(cx + ox, cy + oy);
        if (d >= here || d > bestD) continue;
        const b = this.cell(cx + ox, cy + oy);
        if (ox && oy) {
          const s1 = this.cell(cx + ox, cy), s2 = this.cell(cx, cy + oy);
          if (!canStep(a, s1) || !canStep(a, s2) || !canStep(s1, b) || !canStep(s2, b)) continue;
          if (s1.door || s2.door || b.door) continue;
        } else if (d !== 0 && !canStep(a, b)) {
          continue;
        } else if (d === 0 && (b.solid || Math.abs(a.floor - b.floor) > STEP_HEIGHT + EPS)) {
          continue;
        }
        const dot = (ox * tdx + oy * tdy) / (ox && oy ? Math.SQRT2 : 1);
        if (d < bestD || dot > bestDot) { best = b; bestD = d; bestDot = dot; }
      }
    }
    return best;
  }

  // Floods sound from (x, y) through open cells for up to maxSteps cells; shut doors stop it.
  // Fills world.heard with 1 where it reaches.
  flood(x, y, maxSteps) {
    const { w, h, cells, heard, queue, steps } = this;
    heard.fill(0);
    const sx = Math.floor(x), sy = Math.floor(y);
    if (sx < 0 || sy < 0 || sx >= w || sy >= h) return;
    const start = sy * w + sx;
    heard[start] = 1;
    steps[start] = 0;
    queue[0] = start;
    let head = 0, tail = 1;
    while (head < tail) {
      const i = queue[head++];
      if (steps[i] >= maxSteps) continue;
      const cx = i % w, cy = (i - cx) / w;
      for (let k = 0; k < 4; k++) {
        const nx = cx + (k === 0 ? -1 : k === 1 ? 1 : 0);
        const ny = cy + (k === 2 ? -1 : k === 3 ? 1 : 0);
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        const j = ny * w + nx;
        if (heard[j]) continue;
        const c = cells[j];
        if (c.solid || (c.door && c.door.open < 0.3)) continue;
        heard[j] = 1;
        steps[j] = steps[i] + 1;
        queue[tail++] = j;
      }
    }
  }
}
