// Level validator. Works from level data and the contract rules only (no src/game).
//
//   node tools/validate-levels.mjs [--out <dir>] [--only <id>]
//
// For every level: structure checks, a reachability search over (cell, keys held, tags fired),
// soft-lock detection, stats, and two top-down PNGs in <dir> (default out/levels):
//   <id>.png        floors shaded by height, walls tinted by texture, doors, lifts, things
//   <id>-light.png  light levels (yellow dot = flicker, blue = sky)
// Exit code 1 when any level has errors.

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  THING_CHARS, WALL_TEXTURES, FLAT_TEXTURES, SKY, KEY_NAMES, KEY_COLORS, KEY_DOOR_TEXTURES,
  STEP_HEIGHT, PLAYER_HEIGHT, GRID_MAX, BOSS_TAG, LEVEL_COUNT, MUSIC_TRACK_COUNT,
  ENEMY_SPRITES, TEXELS_PER_UNIT, TEX_SWITCH_OFF, TEX_EXIT_OFF,
} from '../src/config.js';
import { createSurface, fillRect, strokeRect, fillCircle, line, drawText, textWidth, mix } from '../src/core/pix.js';
import { writePNG } from './png.mjs';

// Starting numbers from the contract (section 8). Only used for the budget stats.
const ENEMY_HP = { scrapper: 30, gunner: 45, spitter: 70, hauler: 220, overseer: 1800 };
const AMMO_AMOUNT = { rivets: 10, rivetbox: 50, shells: 4, shellbox: 20, canister: 1, canistercrate: 5 };
const AMMO_DAMAGE = { rivets: 12.5, shells: 63, canisters: 80 };   // average per round, every pellet hitting
const HEALTH_AMOUNT = { medgel: 10, medkit: 25 };
const ARMOR_AMOUNT = { vest: 50, heavyarmor: 100 };
const START_RIVETS = 50;
const MIN_AMMO_RATIO = 1.6;
const WALK_SPEED = 3.4;
const INTRODUCED_WEAPON = ['scatter', 'bolt', 'launcher', null];   // by level index

const EPS = 1e-6;
const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1]];

const args = process.argv.slice(2);
const argOf = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : null; };
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outDir = path.resolve(argOf('--out') || path.join(root, 'out/levels'));
const only = argOf('--only');

// With --only <id> just that level file is loaded (the others may not exist yet or may be
// mid-edit); without it the whole set comes from index.js.
let levels;
if (only) {
  const { build } = await import('../src/levels/build.js');
  const index = Number(only.replace(/\D/g, '')) - 1;
  levels = [];
  levels[index] = build((await import(`../src/levels/${only}.js`)).default);
} else {
  levels = (await import('../src/levels/index.js')).default;
}

// ---------------------------------------------------------------- structure

function checkStructure(level, index, err, warn) {
  for (const k of ['id', 'name', 'intro']) if (typeof level[k] !== 'string' || !level[k]) err(`missing ${k}`);
  if (!Number.isInteger(level.music) || level.music < 0 || level.music >= MUSIC_TRACK_COUNT) err(`music ${level.music} out of range`);
  if (!(level.par > 0)) err('par must be a positive number');
  if (typeof level.playerYaw !== 'number') err('playerYaw must be a number');

  const { cells, things, legend } = level;
  if (!Array.isArray(cells) || !cells.length || !Array.isArray(things) || !legend) { err('cells, things and legend are required'); return null; }
  const W = cells[0].length, H = cells.length;
  let ragged = false;
  cells.forEach((row, y) => { if (row.length !== W) { err(`cells row ${y} has width ${row.length}, expected ${W}`); ragged = true; } });
  if (things.length !== H) { err(`things has ${things.length} rows, cells has ${H}`); ragged = true; }
  things.forEach((row, y) => { if (row.length !== W) { err(`things row ${y} has width ${row.length}, expected ${W}`); ragged = true; } });
  if (W > GRID_MAX || H > GRID_MAX) err(`size ${W}x${H} exceeds ${GRID_MAX}`);
  if (ragged) return null;

  // legend
  const used = new Set();
  for (const [ch, d] of Object.entries(legend)) {
    const at = `legend '${ch}'`;
    if (ch.length !== 1) err(`${at}: key must be one char`);
    if (d.solid) {
      if (!WALL_TEXTURES.includes(d.wall)) err(`${at}: wall texture '${d.wall}' is not a wall texture`);
      if (d.switch && !(Number.isInteger(d.switch.tag) && d.switch.tag > 0)) err(`${at}: switch needs a positive tag`);
      if (d.switch && d.wall !== TEX_SWITCH_OFF) err(`${at}: a switch must use ${TEX_SWITCH_OFF}`);
      if (d.exit && d.wall !== TEX_EXIT_OFF) err(`${at}: the exit must use ${TEX_EXIT_OFF}`);
      continue;
    }
    if (typeof d.floor !== 'number' || typeof d.ceil !== 'number') { err(`${at}: floor and ceil are required`); continue; }
    if (d.ceil - d.floor < PLAYER_HEIGHT - EPS && !d.door) warn(`${at}: only ${(d.ceil - d.floor).toFixed(2)} high, the player cannot stand there`);
    if (!FLAT_TEXTURES.includes(d.ft)) err(`${at}: floor texture '${d.ft}' is not a flat`);
    if (d.ct !== SKY && !FLAT_TEXTURES.includes(d.ct)) err(`${at}: ceiling texture '${d.ct}' is not a flat or sky`);
    if (!WALL_TEXTURES.includes(d.wt)) err(`${at}: wt '${d.wt}' is not a wall texture`);
    if (!(d.light >= 0 && d.light <= 1)) err(`${at}: light ${d.light} out of 0..1`);
    if (d.flicker !== undefined && !(d.flicker >= 0 && d.flicker <= 1)) err(`${at}: flicker out of 0..1`);
    if (d.damage !== undefined && !(d.damage >= 0)) err(`${at}: damage must be >= 0`);
    if (d.trigger !== undefined && !(Number.isInteger(d.trigger) && d.trigger >= 0)) err(`${at}: trigger must be a tag number`);
    if (d.door) {
      const dr = d.door;
      if (!WALL_TEXTURES.includes(dr.tex)) err(`${at}: door tex '${dr.tex}' is not a wall texture`);
      if (dr.key != null && !KEY_NAMES.includes(dr.key)) err(`${at}: unknown key '${dr.key}'`);
      if (dr.key && KEY_DOOR_TEXTURES[dr.key] !== dr.tex) warn(`${at}: ${dr.key} door does not use ${KEY_DOOR_TEXTURES[dr.key]}`);
      if (dr.tag && !(Number.isInteger(dr.tag) && dr.tag > 0)) err(`${at}: door tag must be a positive integer`);
      if ((dr.key ? 1 : 0) + (dr.tag ? 1 : 0) + (dr.secret ? 1 : 0) > 1) err(`${at}: a door is one of key, tag or secret`);
      if (d.lift) err(`${at}: a cell cannot be both door and lift`);
      if (d.ceil - d.floor < PLAYER_HEIGHT) err(`${at}: open door is lower than the player`);
    }
    if (d.lift) {
      const l = d.lift;
      if (!(l.low < l.high)) err(`${at}: lift low must be below high`);
      if (d.floor !== l.low && d.floor !== l.high) err(`${at}: lift floor ${d.floor} is neither low ${l.low} nor high ${l.high}`);
      if (d.ceil - l.high < PLAYER_HEIGHT) err(`${at}: no headroom at the top of the lift`);
      if (l.tag && !(Number.isInteger(l.tag) && l.tag > 0)) err(`${at}: lift tag must be a positive integer`);
      if (d.trigger || d.secret || d.damage) err(`${at}: lifts cannot be trigger, secret or damaging cells`);
    }
  }
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const c = cells[y][x], t = things[y][x];
      if (!legend[c]) err(`cell char '${c}' at ${x},${y} is not in the legend`);
      else used.add(c);
      if (t !== '.' && !THING_CHARS[t]) err(`thing char '${t}' at ${x},${y} is not a thing`);
    }
  }
  for (const ch of Object.keys(legend)) if (!used.has(ch)) warn(`legend '${ch}' is never used`);
  return { W, H };
}

// ---------------------------------------------------------------- level model

function buildModel(level, W, H) {
  const N = W * H;
  const def = new Array(N), thing = new Array(N).fill(null);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      def[y * W + x] = level.legend[level.cells[y][x]] || { solid: true, wall: 'w_plate' };
      const t = level.things[y][x];
      if (t !== '.' && THING_CHARS[t]) thing[y * W + x] = { ch: t, ...THING_CHARS[t] };
    }
  }
  const tags = new Set();
  for (const d of def) {
    if (d.solid) { if (d.switch) tags.add(d.switch.tag); continue; }
    if (d.trigger) tags.add(d.trigger);
    if (d.door && d.door.tag) tags.add(d.door.tag);
    if (d.lift && d.lift.tag) tags.add(d.lift.tag);
  }
  const tagList = [...tags].sort((a, b) => a - b);
  const tagBit = new Map(tagList.map((t, i) => [t, 1 << i]));
  const neighbours = (i) => {
    const x = i % W, y = (i - x) / W, out = [];
    for (const [dx, dy] of DIRS) {
      const nx = x + dx, ny = y + dy;
      if (nx >= 0 && ny >= 0 && nx < W && ny < H) out.push(ny * W + nx);
    }
    return out;
  };
  return { level, W, H, N, def, thing, tagList, tagBit, neighbours, at: (i) => `${i % W},${Math.floor(i / W)}` };
}

// Geometry of the level once `keys` are held and `tags` have fired.
function geometry(m, keys, tags) {
  const { N, def, thing } = m;
  const open = new Uint8Array(N), see = new Uint8Array(N);
  const lo = new Float64Array(N), hi = new Float64Array(N), entry = new Float64Array(N), ceil = new Float64Array(N);
  for (let i = 0; i < N; i++) {
    const d = def[i];
    if (d.solid) continue;
    if (d.door) {
      const dr = d.door;
      const usable = dr.key ? (keys & (1 << KEY_NAMES.indexOf(dr.key))) !== 0 : dr.tag ? (tags & m.tagBit.get(dr.tag)) !== 0 : true;
      if (!usable) continue;
    }
    see[i] = 1;
    if (thing[i] && thing[i].blocking) continue;
    open[i] = 1;
    ceil[i] = d.ceil;
    if (d.lift && d.lift.tag) {
      const fired = (tags & m.tagBit.get(d.lift.tag)) !== 0;
      const other = d.floor === d.lift.low ? d.lift.high : d.lift.low;
      lo[i] = hi[i] = entry[i] = fired ? other : d.floor;
    } else if (d.lift) {
      lo[i] = d.lift.low; hi[i] = d.lift.high; entry[i] = d.floor;   // rides between both ends, rests at `floor`
    } else {
      lo[i] = hi[i] = entry[i] = d.floor;
    }
  }
  return { open, see, lo, hi, entry, ceil };
}

function canMove(g, a, b) {
  if (!g.open[b]) return false;
  const be = g.entry[b];
  const h = Math.min(Math.max(be, g.lo[a]), g.hi[a]);   // a tag-0 lift lets the player leave at any height on its way
  if (be - h > STEP_HEIGHT + EPS) return false;
  return Math.min(g.ceil[a], g.ceil[b]) - Math.max(h, be) >= PLAYER_HEIGHT - EPS;
}

function lineOfSight(m, see, a, b) {
  const ax = (a % m.W) + 0.5, ay = Math.floor(a / m.W) + 0.5;
  const bx = (b % m.W) + 0.5, by = Math.floor(b / m.W) + 0.5;
  const steps = Math.ceil(Math.hypot(bx - ax, by - ay) * 4);
  for (let s = 1; s < steps; s++) {
    const i = Math.floor(ay + ((by - ay) * s) / steps) * m.W + Math.floor(ax + ((bx - ax) * s) / steps);
    if (i !== b && !see[i]) return false;
  }
  return true;
}

// Breadth-first search over (cell, keys, tags). safe = never step on damaging floors.
// boss = tag 99 may fire while every overseer is in view.
function search(m, { safe = false, boss = true } = {}) {
  const { N, def, thing } = m;
  const start = thing.findIndex((t) => t && t.kind === 'player');
  const bosses = [];
  thing.forEach((t, i) => { if (t && t.type === 'overseer') bosses.push(i); });
  const bossBit = m.tagBit.get(BOSS_TAG) || 0;

  const worldIds = new Map(), worlds = [], geoms = [];
  const worldOf = (keys, tags) => {
    const k = keys + tags * 8;
    let id = worldIds.get(k);
    if (id === undefined) { id = worlds.length; worldIds.set(k, id); worlds.push({ keys, tags }); geoms.push(geometry(m, keys, tags)); }
    return id;
  };
  const ids = new Map(), cellOf = [], worldIdx = [], dist = [], preds = [], wins = [];
  const add = (c, w, from) => {
    const k = w * N + c;
    let id = ids.get(k);
    if (id === undefined) {
      id = cellOf.length; ids.set(k, id);
      cellOf.push(c); worldIdx.push(w); preds.push([]); dist.push(from < 0 ? 0 : dist[from] + 1);
    }
    if (from >= 0) preds[id].push(from);
  };
  add(start, worldOf(0, 0), -1);

  for (let s = 0; s < cellOf.length; s++) {
    const c = cellOf[s], w = worldIdx[s], g = geoms[w];
    const { keys, tags } = worlds[w];
    let won = false;
    for (const n of m.neighbours(c)) {
      const d = def[n];
      if (d.solid) {
        if (d.exit) won = true;
        if (d.switch && !(tags & m.tagBit.get(d.switch.tag))) add(c, worldOf(keys, tags | m.tagBit.get(d.switch.tag)), s);
        continue;
      }
      if (safe && d.damage) continue;
      if (!canMove(g, c, n)) continue;
      let nk = keys, nt = tags;
      if (thing[n] && thing[n].kind === 'key') nk |= 1 << KEY_NAMES.indexOf(thing[n].type);
      if (d.trigger) nt |= m.tagBit.get(d.trigger);
      add(n, worldOf(nk, nt), s);
    }
    if (boss && bossBit && !(tags & bossBit) && bosses.length && bosses.every((b) => lineOfSight(m, g.see, c, b))) {
      add(c, worldOf(keys, tags | bossBit), s);
    }
    if (won) wins.push(s);
  }

  // states from which a win is still possible
  const canWin = new Uint8Array(cellOf.length);
  const stack = [...wins];
  for (const s of wins) canWin[s] = 1;
  while (stack.length) for (const p of preds[stack.pop()]) if (!canWin[p]) { canWin[p] = 1; stack.push(p); }

  const reach = new Int32Array(N).fill(-1);   // fewest transitions to reach each cell
  let firedTags = 0, heldKeys = 0;
  for (let s = 0; s < cellOf.length; s++) {
    if (reach[cellOf[s]] < 0 || dist[s] < reach[cellOf[s]]) reach[cellOf[s]] = dist[s];
    firedTags |= worlds[worldIdx[s]].tags; heldKeys |= worlds[worldIdx[s]].keys;
  }
  const stuck = [];
  for (let s = 0; s < cellOf.length; s++) if (!canWin[s]) stuck.push(s);
  const winDist = wins.length ? Math.min(...wins.map((s) => dist[s])) : -1;
  return { states: cellOf.length, cellOf, worldIdx, worlds, geoms, reach, firedTags, heldKeys, wins, winDist, stuck };
}

// ---------------------------------------------------------------- analysis

function analyse(level, index) {
  const errors = [], warnings = [];
  const err = (msg) => errors.push(msg), warn = (msg) => warnings.push(msg);
  const size = checkStructure(level, index, err, warn);
  if (!size) return { errors, warnings };
  const m = buildModel(level, size.W, size.H);
  const { W, H, N, def, thing, at } = m;

  // border, player, things
  for (let i = 0; i < N; i++) {
    const x = i % W, y = Math.floor(i / W);
    if ((x === 0 || y === 0 || x === W - 1 || y === H - 1) && !def[i].solid) err(`border cell ${at(i)} is not solid`);
  }
  const starts = thing.filter((t) => t && t.kind === 'player').length;
  if (starts !== 1) { err(`expected exactly one P, found ${starts}`); return { errors, warnings, m }; }

  const count = { enemy: {}, ammo: { rivets: 0, shells: 0, canisters: 0 }, health: 0, armor: 0, keys: new Set(), weapons: new Set(), props: 0, items: 0 };
  let enemyHealth = 0;
  for (let i = 0; i < N; i++) {
    const t = thing[i], d = def[i];
    if (!t) continue;
    if (d.solid) { err(`thing '${t.ch}' at ${at(i)} is inside a wall`); continue; }
    if (d.door || d.lift) err(`thing '${t.ch}' at ${at(i)} stands on a ${d.door ? 'door' : 'lift'}`);
    const room = d.ceil - d.floor;
    const need = t.kind === 'enemy' ? Math.max(PLAYER_HEIGHT, ENEMY_SPRITES[t.type].h / TEXELS_PER_UNIT) : PLAYER_HEIGHT;
    if (room < need - EPS) err(`thing '${t.ch}' at ${at(i)} does not fit: ${room.toFixed(2)} high, needs ${need.toFixed(2)}`);
    if (d.damage && t.kind !== 'prop') err(`thing '${t.ch}' at ${at(i)} is on a damaging floor`);
    if (t.kind === 'enemy') { count.enemy[t.type] = (count.enemy[t.type] || 0) + 1; enemyHealth += ENEMY_HP[t.type]; }
    else if (t.kind === 'ammo') { count.ammo[t.ammo] += AMMO_AMOUNT[t.type]; count.items++; }
    else if (t.kind === 'health') { count.health += HEALTH_AMOUNT[t.type]; count.items++; }
    else if (t.kind === 'armor') { count.armor += ARMOR_AMOUNT[t.type]; count.items++; }
    else if (t.kind === 'key') { count.keys.add(t.type); count.items++; }
    else if (t.kind === 'weapon') { count.weapons.add(t.type); count.items++; }
    else if (t.kind === 'prop') count.props++;
  }

  // movers, tags, exits
  const sources = new Map(), targets = new Map();
  const bump = (map, tag) => map.set(tag, (map.get(tag) || 0) + 1);
  let exits = 0, secrets = 0, doors = 0, lifts = 0, skyCells = 0, damageCells = 0, flickerCells = 0, openCells = 0;
  let minLight = 1, maxLight = 0;
  const usedKeys = new Set();
  const liftTags = new Set();
  for (let i = 0; i < N; i++) {
    const d = def[i], x = i % W, y = Math.floor(i / W);
    if (d.solid) {
      if (d.exit) exits++;
      if (d.switch) bump(sources, d.switch.tag);
      continue;
    }
    openCells++;
    minLight = Math.min(minLight, d.light); maxLight = Math.max(maxLight, d.light);
    if (d.ct === SKY) skyCells++;
    if (d.damage) damageCells++;
    if (d.flicker) flickerCells++;
    if (d.secret) secrets++;
    if (d.trigger) bump(sources, d.trigger);
    if (d.lift) { lifts++; if (d.lift.tag) { bump(targets, d.lift.tag); liftTags.add(d.lift.tag); } }
    if (d.door) {
      doors++;
      if (d.door.tag) bump(targets, d.door.tag);
      if (d.door.key) usedKeys.add(d.door.key);
      // a door sits in a wall: closed on one axis, open on the other
      const wallish = (j) => !def[j] || def[j].solid || !!def[j].door;
      const ew = wallish(i - 1) && wallish(i + 1), ns = wallish(i - W) && wallish(i + W);
      const passEW = !def[i - 1].solid && !def[i + 1].solid, passNS = !def[i - W].solid && !def[i + W].solid;
      if (!((ew && passNS) || (ns && passEW))) err(`door at ${x},${y} is not set in a wall`);
    }
  }
  if (!exits) err('no exit cell');
  if (!secrets) warn('no secret cells');
  const hasBoss = !!count.enemy.overseer;
  if (hasBoss) bump(sources, BOSS_TAG);
  for (const tag of targets.keys()) if (!sources.has(tag)) err(`tag ${tag} has doors or lifts but nothing fires it`);
  for (const tag of sources.keys()) if (!targets.has(tag)) err(`tag ${tag} is fired but moves nothing`);
  // a lift toggles on every firing, so its tag needs a single one-shot source (one switch or one trigger cell)
  for (const tag of liftTags) if (sources.get(tag) > 1) err(`lift tag ${tag} has ${sources.get(tag)} sources; it would toggle more than once`);
  for (const tag of Object.keys(level.tagMessages || {})) if (!targets.has(Number(tag))) warn(`tagMessages has unused tag ${tag}`);
  for (const key of usedKeys) if (!count.keys.has(key)) err(`${key} door but no ${key} key`);
  for (const key of count.keys) if (!usedKeys.has(key)) warn(`${key} key but no ${key} door`);
  if (index === LEVEL_COUNT - 1) {
    if (!hasBoss) err('the last level needs an overseer (Z)');
    if (!targets.has(BOSS_TAG)) err(`the last level must use tag ${BOSS_TAG}`);
  } else if (targets.has(BOSS_TAG) && !hasBoss) err(`tag ${BOSS_TAG} used without an overseer`);
  const intro = INTRODUCED_WEAPON[index];
  if (intro && !count.weapons.has(intro)) err(`level ${index + 1} must contain the ${intro} pickup`);

  // reachability
  const full = search(m);
  const safe = search(m, { safe: true });
  const reached = (r, i) => r.reach[i] >= 0;
  if (!full.wins.length) err('the exit cannot be used');
  else if (!safe.wins.length) err('the exit can only be reached across damaging floor');
  const seenFrom = (target) => {
    for (let s = 0; s < full.cellOf.length; s++) {
      if (lineOfSight(m, full.geoms[full.worldIdx[s]].see, full.cellOf[s], target)) return true;
    }
    return false;
  };
  const firstReach = {};
  for (let i = 0; i < N; i++) {
    const t = thing[i], d = def[i];
    if (d.secret && !reached(full, i)) err(`secret cell ${at(i)} is unreachable`);
    if (d.trigger && !d.solid && !reached(full, i)) err(`trigger cell ${at(i)} is unreachable`);
    if (!t || d.solid) continue;
    if (t.kind === 'enemy') {
      if (!reached(full, i) && !seenFrom(i)) err(`enemy '${t.ch}' at ${at(i)} can be neither reached nor seen`);
    } else if (t.kind === 'key' || t.kind === 'weapon') {
      if (!reached(full, i)) err(`${t.kind} '${t.ch}' at ${at(i)} is unreachable`);
      else if (!reached(safe, i)) err(`${t.kind} '${t.ch}' at ${at(i)} can only be reached across damaging floor`);
      else firstReach[`${t.type}${t.kind === 'key' ? ' key' : ''}`] = safe.reach[i];
    } else if (t.kind !== 'prop' && t.kind !== 'player' && !reached(full, i)) {
      err(`pickup '${t.ch}' at ${at(i)} is unreachable`);
    }
  }
  for (const [tag, bit] of m.tagBit) if (sources.has(tag) && !(full.firedTags & bit)) err(`tag ${tag} can never fire`);
  if (full.stuck.length) {
    const seen = new Set(), samples = [];
    for (const s of full.stuck) {
      const w = full.worlds[full.worldIdx[s]];
      const k = `${w.keys}/${w.tags}`;
      if (seen.has(k)) continue;
      seen.add(k);
      const keys = KEY_NAMES.filter((_, i) => w.keys & (1 << i)).join('+') || 'none';
      const tags = m.tagList.filter((t) => w.tags & m.tagBit.get(t)).join(',') || 'none';
      samples.push(`${at(full.cellOf[s])} (keys ${keys}; tags ${tags})`);
    }
    err(`soft-lock: ${full.stuck.length} reachable states cannot reach the exit, e.g. ${samples.slice(0, 6).join('; ')}`);
  }
  if (targets.has(BOSS_TAG) && hasBoss && search(m, { boss: false }).wins.length) err(`the exit is usable without tag ${BOSS_TAG}`);

  // budget
  const ammoDamage = Object.entries(count.ammo).reduce((sum, [type, n]) => sum + n * AMMO_DAMAGE[type], 0);
  const ratio = enemyHealth ? ammoDamage / enemyHealth : Infinity;
  if (ratio < MIN_AMMO_RATIO) err(`ammo damage ${ammoDamage} is only ${ratio.toFixed(2)}x enemy health ${enemyHealth} (need ${MIN_AMMO_RATIO})`);

  const stats = {
    size: `${W}x${H}`, openCells, enemies: count.enemy, enemyHealth, ammo: count.ammo, ammoDamage, ratio,
    ratioWithStart: enemyHealth ? (ammoDamage + START_RIVETS * AMMO_DAMAGE.rivets) / enemyHealth : Infinity,
    health: count.health, armor: count.armor, keys: [...count.keys], weapons: [...count.weapons], items: count.items,
    secrets, doors, lifts, exits, tags: m.tagList, skyCells, damageCells, flickerCells, minLight, maxLight,
    states: full.states, worlds: full.worlds.length, winDist: safe.winDist, firstReach,
  };
  return { errors, warnings, m, full, stats };
}

// ---------------------------------------------------------------- pictures

const S = 16, MARGIN = 14;
const WALL_TINT = {
  w_plate: '#4d5560', w_rust: '#6b4028', w_brick: '#70352a', w_pipes: '#3f5a48', w_grate: '#3a3f4a',
  w_hazard: '#7a6a14', w_concrete: '#55554f', w_panel: '#2f4f78', w_crate: '#6a5230', w_rock: '#463a30',
  w_furnace: '#b04a10', w_screen: '#1f7070', w_switch_off: '#20a040', w_exit_off: '#c02020',
};
const FLAT_TINT = {
  f_plate: '#8890a0', f_grate: '#7088a0', f_concrete: '#909088', f_hazard: '#a89a50', f_rust: '#987060',
  f_rock: '#8a7a68', f_lift: '#b0a040', f_slag: '#ff7a10', f_coolant: '#30e070',
};
const THING_TINT = {
  scrapper: '#ff9020', gunner: '#ff3030', spitter: '#d020d0', hauler: '#900000', overseer: '#ffffff',
  ammo: '#ffe040', health: '#40ff60', armor: '#50a0ff', weapon: '#ffffff', prop: '#404040',
};

function drawRulers(s, W, H) {
  for (let x = 0; x < W; x += 5) drawText(s, String(x), MARGIN + x * S + 2, 3, '#c0c0c0');
  for (let y = 0; y < H; y += 5) drawText(s, String(y), 1, MARGIN + y * S + 5, '#c0c0c0');
}

function drawLayout(m, full) {
  const { W, H, def, thing } = m;
  const s = createSurface(W * S + MARGIN, H * S + MARGIN, '#101014');
  drawRulers(s, W, H);
  const stuckCells = new Set(full ? full.stuck.map((st) => full.cellOf[st]) : []);
  for (let i = 0; i < W * H; i++) {
    const x = i % W, y = Math.floor(i / W), px = MARGIN + x * S, py = MARGIN + y * S;
    const d = def[i];
    if (d.solid) {
      fillRect(s, px, py, S, S, mix(WALL_TINT[d.wall] || '#505050', '#000000', d.switch || d.exit ? 0 : 0.45));
      if (d.switch) drawText(s, String(d.switch.tag), px + 5, py + 5, '#ffffff');
      if (d.exit) drawText(s, 'EX', px + 3, py + 5, '#ffffff');
      continue;
    }
    const b = Math.max(0.2, Math.min(1, 0.5 + d.floor * 0.2));
    let c = mix('#000000', FLAT_TINT[d.ft] || '#909090', b);
    if (d.damage) c = FLAT_TINT[d.ft] || '#ff0000';
    if (d.ct === SKY) c = mix(c, '#4060ff', 0.3);
    fillRect(s, px, py, S, S, c);
    if (d.door) {
      const dc = d.door.key ? KEY_COLORS[d.door.key] : d.door.secret ? '#a050e0' : d.door.tag ? '#808890' : '#c89060';
      fillRect(s, px + 2, py + 2, S - 4, S - 4, dc);
      if (d.door.tag) drawText(s, String(d.door.tag), px + 4, py + 5, '#000000');
    }
    if (d.lift) {
      strokeRect(s, px + 1, py + 1, S - 2, S - 2, '#ffe000');
      drawText(s, d.lift.tag ? String(d.lift.tag) : d.floor === d.lift.low ? '^' : 'v', px + 5, py + 5, '#ffe000');
    }
    if (d.trigger) { fillRect(s, px, py, 5, 5, '#ff40ff'); drawText(s, String(d.trigger), px + 6, py + 1, '#ff40ff'); }
    if (d.secret) strokeRect(s, px + 1, py + 1, S - 2, S - 2, '#c060ff');
    if (full && full.reach[i] < 0 && !(thing[i] && thing[i].blocking) && !d.door) {
      line(s, px, py, px + S - 1, py + S - 1, '#ff0000'); line(s, px + S - 1, py, px, py + S - 1, '#ff0000');
    } else if (stuckCells.has(i)) strokeRect(s, px + 3, py + 3, S - 6, S - 6, '#ff0000');
  }
  // floor height changes: thin line for a step, thick black for a ledge
  for (let i = 0; i < W * H; i++) {
    const x = i % W, y = Math.floor(i / W), px = MARGIN + x * S, py = MARGIN + y * S;
    if (def[i].solid) continue;
    for (const [dx, dy] of [[1, 0], [0, 1]]) {
      const j = (y + dy) * W + x + dx;
      if (x + dx >= W || y + dy >= H || def[j].solid) continue;
      const diff = Math.abs(def[i].floor - def[j].floor);
      if (diff < EPS) continue;
      const c = diff > STEP_HEIGHT + EPS ? '#000000' : '#404048', t = diff > STEP_HEIGHT + EPS ? 2 : 1;
      if (dx) fillRect(s, px + S - 1, py, t, S, c); else fillRect(s, px, py + S - 1, S, t, c);
    }
  }
  for (let i = 0; i < W * H; i++) {
    const t = thing[i];
    if (!t) continue;
    const cx = MARGIN + (i % W) * S + S / 2, cy = MARGIN + Math.floor(i / W) * S + S / 2;
    if (t.kind === 'player') {
      const yaw = m.level.playerYaw || 0;
      fillCircle(s, cx - 0.5, cy - 0.5, 5, '#00ffff');
      line(s, cx, cy, Math.round(cx + Math.cos(yaw) * 10), Math.round(cy + Math.sin(yaw) * 10), '#00ffff', 2);
    } else if (t.kind === 'enemy') {
      fillCircle(s, cx - 0.5, cy - 0.5, t.type === 'overseer' || t.type === 'hauler' ? 7 : t.type === 'scrapper' ? 4 : 5.5, THING_TINT[t.type]);
      drawText(s, t.ch, cx - 2, cy - 2, t.type === 'overseer' ? '#ff0000' : '#000000');
    } else {
      const c = t.kind === 'key' ? KEY_COLORS[t.type] : THING_TINT[t.kind];
      const w = textWidth(t.ch) + 3;
      fillRect(s, cx - Math.ceil(w / 2), cy - 4, w + 1, 9, c);
      strokeRect(s, cx - Math.ceil(w / 2), cy - 4, w + 1, 9, '#000000');
      drawText(s, t.ch === '+' ? '+' : t.ch, cx - Math.ceil(w / 2) + 2, cy - 2, t.kind === 'prop' ? '#d0d0d0' : '#000000');
    }
  }
  return s;
}

function drawLight(m) {
  const { W, H, def } = m;
  const s = createSurface(W * S + MARGIN, H * S + MARGIN, '#101014');
  drawRulers(s, W, H);
  for (let i = 0; i < W * H; i++) {
    const px = MARGIN + (i % W) * S, py = MARGIN + Math.floor(i / W) * S;
    const d = def[i];
    if (d.solid) { fillRect(s, px, py, S, S, '#300808'); continue; }
    const v = Math.round(d.light * 255);
    fillRect(s, px, py, S, S, d.ct === SKY ? [v * 0.6, v * 0.75, v] : [v, v, v]);
    if (d.flicker) fillRect(s, px + 6, py + 6, 4, 4, '#ffd000');
  }
  return s;
}

// ---------------------------------------------------------------- report

function report(level, index) {
  const r = analyse(level, index);
  const { errors, warnings, stats } = r;
  console.log(`\n${level.id}  ${level.name}`);
  if (stats) {
    const enemies = Object.entries(stats.enemies).map(([t, n]) => `${t} ${n}`).join(', ') || 'none';
    const total = Object.values(stats.enemies).reduce((a, b) => a + b, 0);
    const secs = stats.winDist >= 0 ? Math.round(stats.winDist / WALK_SPEED) : -1;
    console.log(`  size ${stats.size}, ${stats.openCells} open cells, ${stats.doors} doors, ${stats.lifts} lift cells, tags [${stats.tags.join(', ')}], secrets ${stats.secrets}`);
    console.log(`  enemies ${total}: ${enemies}; total health ${stats.enemyHealth}`);
    console.log(`  ammo: rivets ${stats.ammo.rivets}, shells ${stats.ammo.shells}, canisters ${stats.ammo.canisters}; damage ${stats.ammoDamage} = ${stats.ratio.toFixed(2)}x enemy health (${stats.ratioWithStart.toFixed(2)}x with the ${START_RIVETS} starting rivets)`);
    console.log(`  health +${stats.health}, armor +${stats.armor}, items ${stats.items}, keys [${stats.keys.join(', ')}], weapons [${stats.weapons.join(', ')}]`);
    console.log(`  light ${stats.minLight}..${stats.maxLight}, flicker cells ${stats.flickerCells}, sky cells ${stats.skyCells}, damaging cells ${stats.damageCells}`);
    const first = Object.entries(stats.firstReach).map(([k, v]) => `${k} ${v}`).join(', ');
    console.log(`  shortest safe route to the exit: ${stats.winDist} moves (about ${secs} s of walking); first reach: ${first || 'n/a'}`);
    console.log(`  search: ${stats.states} states in ${stats.worlds} key/tag combinations`);
  }
  if (r.m) {
    writePNG(path.join(outDir, `${level.id}.png`), drawLayout(r.m, r.full));
    writePNG(path.join(outDir, `${level.id}-light.png`), drawLight(r.m));
  }
  for (const w of warnings) console.log(`  warning: ${w}`);
  for (const e of errors) console.log(`  ERROR: ${e}`);
  if (!errors.length) console.log('  ok');
  return errors.length;
}

let failed = 0;
if (!only && (!Array.isArray(levels) || levels.length !== LEVEL_COUNT)) {
  console.log(`ERROR: expected ${LEVEL_COUNT} levels, found ${Array.isArray(levels) ? levels.length : typeof levels}`);
  failed++;
}
const ids = new Set();
(levels || []).forEach((level, index) => {
  if (!level) return;
  if (ids.has(level.id)) { console.log(`ERROR: duplicate level id ${level.id}`); failed++; }
  ids.add(level.id);
  if (only && level.id !== only) return;
  failed += report(level, index);
});
console.log(`\npictures in ${outDir}`);
console.log(failed ? `${failed} error(s)` : 'all levels ok');
process.exit(failed ? 1 : 0);
