// Flying things (launcher canisters, slag globs, overseer bolts) and short-lived effect sprites.

import { FX_SPRITES } from '../config.js';
import { WEAPONS, SLAG_GRAVITY } from './tuning.js';

function frameNames(base) {
  const out = [];
  for (let i = 0; i < FX_SPRITES[base].frames; i++) out.push(base + i);
  return out;
}

// light: -1 fullbright, 0 = light of the cell it is in. rise in units per second.
export const FX = {
  puff: { frames: frameNames('fx_puff'), dur: 0.2, light: -1, rise: 0 },
  oil: { frames: frameNames('fx_oil'), dur: 0.26, light: 0, rise: 0 },
  smoke: { frames: frameNames('fx_smoke'), dur: 0.55, light: 0, rise: 0.35 },
  explode: { frames: frameNames('fx_explode'), dur: 0.48, light: -1, rise: 0 },
};

// pad widens what the projectile touches. trail: seconds between smoke puffs.
const KINDS = {
  rocket: { frames: frameNames('fx_rocket'), pad: 0.06, gravity: 0, trail: 0.04 },
  slag: { frames: frameNames('fx_slag'), pad: 0.1, gravity: SLAG_GRAVITY, trail: 0 },
  bolt: { frames: frameNames('fx_bolt'), pad: 0.06, gravity: 0, trail: 0 },
};

const LAUNCHER = WEAPONS[4];
const MAX_LIFE = 8;

export function spawnFx(game, kind, x, y, z) {
  game.effects.push({ def: FX[kind], x, y, z, t: 0 });
}

// owner: the player object or an enemy. damage: rolled at launch.
export function spawnProjectile(game, kind, owner, x, y, z, vx, vy, vz, damage) {
  game.projectiles.push({
    kind, def: KINDS[kind], owner, x, y, z, vx, vy, vz, damage,
    ox: owner.x, oy: owner.y, t: 0, puff: 0.07,
  });
}

function impact(game, pr, shot, dx, dy, dz) {
  // Step back off the surface so effects and blast lines of sight start in open space.
  const x = shot.x - dx * 0.08, y = shot.y - dy * 0.08, z = shot.z - dz * 0.08;
  if (pr.kind === 'rocket') {
    if (shot.kind === 'sky') return;
    if (shot.kind === 'enemy') game.damageEnemy(shot.target, pr.damage);
    else if (shot.kind === 'prop') game.damageProp(shot.target, pr.damage);
    game.explode(x, y, z, LAUNCHER.splash, LAUNCHER.splashRadius, true, shot.target);
    return;
  }
  if (shot.kind === 'player') game.hurtPlayer(pr.damage, pr.ox, pr.oy);
  else if (shot.kind === 'prop') game.damageProp(shot.target, pr.damage);
  if (shot.kind === 'sky') return;
  game.impactFx('puff', x, y, z);
  if (pr.kind === 'slag') {
    game.impactFx('smoke', x, y, z + 0.1);
    game.sound('slag_hit', x, y);
  } else {
    game.sound('bolt_hit', x, y);
  }
}

export function updateProjectiles(game, dt) {
  const list = game.projectiles;
  let n = 0;
  for (let i = 0; i < list.length; i++) {
    const pr = list[i];
    pr.t += dt;
    pr.vz -= pr.def.gravity * dt;
    const speed = Math.hypot(pr.vx, pr.vy);
    if (pr.t > MAX_LIFE || speed < 0.01) continue;
    const dx = pr.vx / speed, dy = pr.vy / speed, dz = pr.vz / speed;
    game.trace(pr.x, pr.y, pr.z, dx, dy, dz, speed * dt, pr.owner, pr.def.pad);
    if (game.shot.kind) {
      impact(game, pr, game.shot, dx, dy, dz);
      continue;
    }
    pr.x += pr.vx * dt;
    pr.y += pr.vy * dt;
    pr.z += pr.vz * dt;
    if (pr.def.trail) {
      pr.puff -= dt;
      if (pr.puff <= 0) {
        pr.puff = pr.def.trail;
        spawnFx(game, 'smoke', pr.x - dx * 0.25, pr.y - dy * 0.25, pr.z);
      }
    }
    list[n++] = pr;
  }
  list.length = n;
}

export function updateEffects(game, dt) {
  const list = game.effects;
  let n = 0;
  for (let i = 0; i < list.length; i++) {
    const fx = list[i];
    fx.t += dt;
    if (fx.t >= fx.def.dur) continue;
    fx.z += fx.def.rise * dt;
    list[n++] = fx;
  }
  list.length = n;
}

export function projectileFrame(pr) {
  return pr.def.frames[Math.floor(pr.t * 12) % pr.def.frames.length];
}

export function effectFrame(fx) {
  const f = fx.def.frames;
  return f[Math.min(f.length - 1, Math.floor(fx.t / fx.def.dur * f.length))];
}
