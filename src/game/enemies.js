// Machine enemies: waking, chasing over the flow field, attacks, pain, death and the boss.

import { ENEMY_SPRITES, STEP_HEIGHT, PLAYER_HEIGHT } from '../config.js';
import { ENEMIES, ENEMY_SIGHT, SLAG_GRAVITY } from './tuning.js';
import { spawnFx, spawnProjectile } from './projectiles.js';

const DEG = Math.PI / 180;
const MAX_CLEARANCE = 1.0;     // headroom an enemy needs to move, whatever its sprite height
const SIGHT_PERIOD = 0.3;
const HOVER = 0.45;            // overseer float height

const FRAMES = {};
for (const [type, s] of Object.entries(ENEMY_SPRITES)) {
  const names = (anim, n) => Array.from({ length: n }, (_, i) => `${type}_${anim}${i}`);
  FRAMES[type] = { walk: names('walk', s.walk), attack: names('attack', s.attack), pain: names('pain', s.pain), die: names('die', s.die) };
}

export function createEnemy(game, type, x, y, z, spawned) {
  const def = ENEMIES[type];
  return {
    type, def, x, y, z, vz: 0,
    radius: def.radius, clearance: Math.min(def.height, MAX_CLEARANCE), step: STEP_HEIGHT,
    noDrop: true, noDamage: true, onGround: true,
    hp: def.hp, alive: true, state: 'idle', t: 0, wake: false,
    cooldown: 0, sight: game.rng.next() * SIGHT_PERIOD, walk: 0, flip: false,
    hover: type === 'overseer' ? HOVER : 0,
    shots: 0, painAt: -10, chargeReady: 0, chargeDx: 0, chargeDy: 0, struck: false,
    spawnT: 0, spawned: !!spawned, children: 0, parent: null, seesPlayer: false,
  };
}

export function enemySprite(e) {
  const f = FRAMES[e.type];
  switch (e.state) {
    case 'windup': return f.attack[0];
    case 'attack': return f.attack[1];
    case 'pain': return f.pain[0];
    case 'dying': return f.die[Math.min(f.die.length - 1, Math.floor(e.t / e.def.dieTime * f.die.length))];
    case 'dead': return f.die[f.die.length - 1];
    default: return f.walk[Math.floor(e.walk) % f.walk.length];
  }
}

function phaseOf(e) {
  const share = e.hp / e.def.hp;
  for (const ph of e.def.phases) if (share > ph.above) return ph;
  return e.def.phases[e.def.phases.length - 1];
}

function cooldown(game, e) {
  const c = e.type === 'overseer' ? phaseOf(e).cooldown : e.def.cooldown;
  return game.rng.range(c[0], c[1]) * game.diff.cadence;
}

function wake(game, e) {
  if (e.state !== 'idle') return;
  e.state = 'chase';
  e.t = 0;
  e.cooldown = game.rng.range(0.5, 1.1) * game.diff.reaction;
  game.sound(`${e.type}_alert`, e.x, e.y);
}

export function hurtEnemy(game, e, amount, source) {
  if (!e.alive || amount <= 0) return;
  e.hp -= amount;
  if (e.hp <= 0) {
    e.alive = false;
    e.state = 'dying';
    e.t = 0;
    game.sound(`${e.type}_death`, e.x, e.y);
    if (!e.spawned) game.stats.kills++;
    if (e.parent) e.parent.children--;
    if (e.type === 'overseer') {
      game.bossDied();
      spawnFx(game, 'explode', e.x, e.y, e.z + e.hover + 1);
    }
    return;
  }
  if (e.state === 'idle') wake(game, e);
  if (e.state !== 'charge' && game.time - e.painAt > 0.25 && game.rng.chance(e.def.painChance)) {
    e.painAt = game.time;
    e.state = 'pain';
    e.charging = false;
    e.t = 0;
    game.sound(`${e.type}_pain`, e.x, e.y);
  }
}

export function updateEnemies(game, dt) {
  const list = game.enemies;
  for (let i = 0; i < list.length; i++) updateEnemy(game, list[i], dt);
}

function canSee(game, e) {
  const p = game.player;
  const dx = p.x - e.x, dy = p.y - e.y;
  if (dx * dx + dy * dy > ENEMY_SIGHT * ENEMY_SIGHT) return false;
  return game.world.los(e.x, e.y, e.z + e.hover + e.def.eye, p.x, p.y, p.eyeZ);
}

function updateEnemy(game, e, dt) {
  const world = game.world;
  const p = game.player;
  e.t += dt;
  if (e.state === 'dead') return;
  if (e.state === 'dying') {
    if (e.t >= e.def.dieTime) { e.state = 'dead'; e.hover = 0; }
    else if (e.hover > 0) e.hover = Math.max(0, e.hover - dt * 1.5);
    world.settle(e, dt);
    return;
  }

  // Sight checks are spread out over time.
  e.sight -= dt;
  if (e.sight <= 0) {
    e.sight = SIGHT_PERIOD;
    e.seesPlayer = game.state === 'playing' && canSee(game, e);
  }
  if (e.state === 'idle') {
    if (e.wake || e.seesPlayer) wake(game, e);
    else { world.settle(e, dt); return; }
  }
  if (e.type === 'overseer') e.hover = HOVER + Math.sin(game.time * 2.1) * 0.08;

  const dx = p.x - e.x, dy = p.y - e.y;
  const dist = Math.hypot(dx, dy);
  const playerAlive = game.state === 'playing';

  switch (e.state) {
    case 'pain':
      if (e.t >= 0.22) { e.state = 'chase'; e.t = 0; }
      break;
    case 'windup':
      e.flip = dx < 0;
      if (e.t >= (e.charging ? e.def.charge.windup : e.def.windup)) {
        e.t = 0;
        if (e.charging) {
          e.state = 'charge';
          e.struck = false;
          const d = Math.max(0.01, dist);
          e.chargeDx = dx / d;
          e.chargeDy = dy / d;
          game.sound(`${e.type}_attack`, e.x, e.y);
        } else {
          e.state = 'attack';
          e.shots = 0;
          strike(game, e, dist);
        }
      }
      break;
    case 'attack': {
      const def = e.def;
      if (def.attack === 'hitscan' && e.shots < def.burst && e.t >= e.shots * def.burstGap) strike(game, e, dist);
      else if (def.attack === 'volley' && e.shots < phaseOf(e).volleys && e.t >= e.shots * def.volleyGap) strike(game, e, dist);
      const busy = def.attack === 'hitscan' ? def.burst * def.burstGap
        : def.attack === 'volley' ? phaseOf(e).volleys * def.volleyGap : 0;
      if (e.t >= busy + def.recover) {
        e.state = 'chase';
        e.t = 0;
        e.cooldown = cooldown(game, e);
      }
      break;
    }
    case 'charge': {
      const c = e.def.charge;
      const ox = e.x, oy = e.y;
      moveEnemy(game, e, e.chargeDx * c.speed * dt, e.chargeDy * c.speed * dt);
      e.walk += dt * e.def.walkFps * 2;
      const moved = Math.hypot(e.x - ox, e.y - oy);
      if (!e.struck && playerAlive && dist - e.radius - p.radius <= e.def.reach + 0.1) {
        e.struck = true;
        game.hurtPlayer(game.rng.range(e.def.damage[0], e.def.damage[1]), e.x, e.y);
        game.sound(`${e.type}_attack`, e.x, e.y);
      }
      if (e.t >= c.time || e.struck || moved < c.speed * dt * 0.3) {
        e.state = 'chase';
        e.t = 0;
        e.charging = false;
        e.chargeReady = game.time + c.cooldown;
        e.cooldown = cooldown(game, e) * 0.6;
      }
      break;
    }
    default:
      chase(game, e, dt, dist, dx, dy, playerAlive);
  }
  world.settle(e, dt);
  if (e.type === 'overseer') spawner(game, e, dt);
}

function chase(game, e, dt, dist, dx, dy, playerAlive) {
  const world = game.world;
  const def = e.def;
  const p = game.player;
  e.cooldown -= dt;

  if (playerAlive && e.cooldown <= 0 && e.seesPlayer) {
    const gap = dist - e.radius - p.radius;
    let go = false;
    if (def.attack === 'melee') go = gap <= def.reach && Math.abs(p.z - e.z) < 0.8;
    else go = dist <= def.range && game.rng.chance(dt * 4);
    if (def.charge && !go && game.time >= e.chargeReady && dist >= def.charge.min && dist <= def.charge.max
      && Math.abs(p.z - e.z) < 0.2 && game.rng.chance(dt * 1.5)) {
      e.charging = true;
      go = true;
    }
    if (go) {
      e.state = 'windup';
      e.t = 0;
      return;
    }
  }

  // Where to walk: straight at the player when close and visible, else down the flow field.
  const speed = def.speed * (e.type === 'overseer' ? phaseOf(e).speed : 1);
  let tx = 0, ty = 0;
  const cx = Math.floor(e.x), cy = Math.floor(e.y);
  const stopAt = def.attack === 'melee' ? e.radius + p.radius + def.reach * 0.6 : (e.seesPlayer ? def.hold : 0);
  if (dist > stopAt || !e.seesPlayer) {
    const here = world.flowAt(cx, cy);
    if (here === 0 || (e.seesPlayer && dist < 1.6)) {
      tx = dx; ty = dy;
    } else {
      const next = world.flowNext(cx, cy, dx, dy);
      if (next) {
        if (next.door) world.nudgeDoor(next);
        tx = next.cx + 0.5 - e.x;
        ty = next.cy + 0.5 - e.y;
      } else if (e.seesPlayer) {
        tx = dx; ty = dy;
      }
    }
  }
  // Keep apart from other enemies.
  for (const o of game.enemies) {
    if (o === e || !o.alive) continue;
    const ox = e.x - o.x, oy = e.y - o.y;
    const min = e.radius + o.radius + 0.15;
    const d2 = ox * ox + oy * oy;
    if (d2 < min * min && d2 > 1e-8) {
      const d = Math.sqrt(d2);
      tx += ox / d * (min - d) * 3;
      ty += oy / d * (min - d) * 3;
    }
  }
  const len = Math.hypot(tx, ty);
  if (len > 1e-4) {
    const step = Math.min(speed * dt, len);
    const ox = e.x, oy = e.y;
    moveEnemy(game, e, tx / len * step, ty / len * step);
    const moved = Math.hypot(e.x - ox, e.y - oy);
    e.walk += moved / Math.max(0.1, speed) * def.walkFps;
    // Pressing against a plain door opens it.
    if (moved < step * 0.3) {
      const ahead = world.cellAt(e.x + tx / len * (e.radius + 0.1), e.y + ty / len * (e.radius + 0.1));
      if (ahead.door) world.nudgeDoor(ahead);
    }
  }
}

function moveEnemy(game, e, mx, my) {
  game.world.moveBody(e, mx, my);
  game.separate(e);
}

// The attack lands or fires.
function strike(game, e, dist) {
  const p = game.player;
  const def = e.def;
  const playerAlive = game.state === 'playing';
  const eyeZ = e.z + e.hover + def.eye;
  e.shots++;
  game.sound(`${e.type}_attack`, e.x, e.y);
  if (def.attack === 'melee') {
    if (playerAlive && dist - e.radius - p.radius <= def.reach + 0.3 && Math.abs(p.z - e.z) < 0.8
      && game.world.los(e.x, e.y, eyeZ, p.x, p.y, p.z + 0.5)) {
      game.hurtPlayer(game.rng.range(def.damage[0], def.damage[1]), e.x, e.y);
    }
    return;
  }
  const tz = p.z + PLAYER_HEIGHT * 0.55;
  const aim = Math.atan2(p.y - e.y, p.x - e.x);
  const d = Math.max(0.3, dist);
  if (def.attack === 'hitscan') {
    // Accuracy falls with distance.
    const spread = def.spread * DEG * (0.6 + d / 6);
    const a = aim + (game.rng.next() * 2 - 1) * spread;
    const slope = (tz - eyeZ) / d + (game.rng.next() * 2 - 1) * 0.04;
    const dx = Math.cos(a), dy = Math.sin(a);
    game.hitscan(e.x + dx * e.radius, e.y + dy * e.radius, eyeZ, a, slope, def.range * 1.5, e,
      game.rng.range(def.damage[0], def.damage[1]));
    return;
  }
  if (def.attack === 'lob') {
    // Leads the target a little and arcs to land on it.
    const T = d / def.projSpeed;
    const lx = p.x + p.vx * T * def.lead, ly = p.y + p.vy * T * def.lead;
    const ldx = lx - e.x, ldy = ly - e.y;
    const ld = Math.max(0.3, Math.hypot(ldx, ldy));
    const tt = ld / def.projSpeed;
    const vz = (tz - eyeZ + 0.5 * SLAG_GRAVITY * tt * tt) / tt;
    const ux = ldx / ld, uy = ldy / ld;
    spawnProjectile(game, 'slag', e, e.x + ux * (e.radius + 0.05), e.y + uy * (e.radius + 0.05), eyeZ,
      ux * def.projSpeed, uy * def.projSpeed, vz, game.rng.range(def.damage[0], def.damage[1]));
    game.sound('slag_spit', e.x, e.y);
    return;
  }
  // Overseer: a fan of bolts.
  const ph = phaseOf(e);
  const fan = ph.fan * DEG;
  for (let i = 0; i < ph.bolts; i++) {
    const a = aim + (ph.bolts > 1 ? (i / (ph.bolts - 1) - 0.5) * fan : 0);
    const ux = Math.cos(a), uy = Math.sin(a);
    const vz = (tz - eyeZ) / d * def.projSpeed;
    spawnProjectile(game, 'bolt', e, e.x + ux * (e.radius + 0.1), e.y + uy * (e.radius + 0.1), eyeZ,
      ux * def.projSpeed, uy * def.projSpeed, vz, game.rng.range(def.damage[0], def.damage[1]));
  }
  game.sound('bolt_shot', e.x, e.y);
}

// The overseer calls in scrappers near itself, up to the phase cap.
function spawner(game, e, dt) {
  const ph = phaseOf(e);
  e.spawnT += dt;
  if (e.spawnT < ph.spawnEvery || e.children >= ph.spawnCap) return;
  const world = game.world;
  for (let tries = 0; tries < 12; tries++) {
    const a = game.rng.next() * Math.PI * 2, r = game.rng.range(1.2, 3);
    const x = Math.floor(e.x + Math.cos(a) * r) + 0.5, y = Math.floor(e.y + Math.sin(a) * r) + 0.5;
    const c = world.cellAt(x, y);
    if (c.solid || c.damage > 0 || c.door || c.ceil - c.floor < 0.6) continue;
    if (Math.abs(c.floor - e.z) > 1.5 || !world.los(e.x, e.y, e.z + e.hover + e.def.eye, x, y, c.floor + 0.3)) continue;
    const child = createEnemy(game, 'scrapper', x, y, c.floor, true);
    if (world.stuck(child, x, y)) continue;
    const pl = game.player;
    if (Math.hypot(pl.x - x, pl.y - y) < 1.2) continue;
    if (game.enemies.some((o) => o.alive && Math.hypot(o.x - x, o.y - y) < o.radius + child.radius)) continue;
    child.parent = e;
    e.children++;
    e.spawnT = 0;
    game.enemies.push(child);
    wake(game, child);
    spawnFx(game, 'smoke', x, y, c.floor + 0.3);
    spawnFx(game, 'puff', x, y, c.floor + 0.3);
    return;
  }
  e.spawnT = ph.spawnEvery * 0.7;
}
