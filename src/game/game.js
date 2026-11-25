// Game state for one run: the player, weapons, pickups, props, events and the scene.
// Enemies live in enemies.js, flying things and effects in projectiles.js.

import {
  PLAYER_RADIUS, PLAYER_HEIGHT, EYE_HEIGHT, STEP_HEIGHT, BOSS_TAG, THING_CHARS, THING_EMPTY,
  WEAPON_SPRITES, WEAPON_IDS, KEY_NAMES,
} from '../config.js';
import { Rng } from '../core/rng.js';
import { World, rayCylinder, circleTouchesCell } from './world.js';
import {
  PLAYER, WEAPONS, AUTO_SWITCH_ORDER, WEAPON_SWITCH_TIME, HITSCAN_RANGE, PICKUPS,
  WEAPON_PICKUP_AMMO, PROPS, DIFFICULTY, NOISE_REACH,
} from './tuning.js';
import { createEnemy, updateEnemies, hurtEnemy, enemySprite } from './enemies.js';
import {
  spawnFx, spawnProjectile, updateProjectiles, updateEffects, projectileFrame, effectFrame,
} from './projectiles.js';

const TAU = Math.PI * 2;
const DEG = Math.PI / 180;
const SEEN_RANGE = 22;
const BURN_PERIOD = 0.5;
const SWITCH_DROP = 70;        // virtual px the weapon sinks while switching

function wrap(a) {
  a %= TAU;
  if (a > Math.PI) a -= TAU;
  else if (a < -Math.PI) a += TAU;
  return a;
}

const WEAPON_FRAMES = WEAPON_IDS.map((id) => {
  const out = { idle: `wp_${id}_idle`, fire: [] };
  for (let i = 0; i < WEAPON_SPRITES[id].fire; i++) out.fire.push(`wp_${id}_fire${i}`);
  return out;
});

const ITEM_KINDS = new Set(['weapon', 'ammo', 'health', 'armor', 'key']);

export class Game {
  constructor({ levels, difficulty = 1, seed = 1 }) {
    this.levels = levels;
    this.difficulty = difficulty;
    this.diff = DIFFICULTY[difficulty] || DIFFICULTY[1];
    this.rng = new Rng(seed);
    this.events = [];
    this.state = 'playing';
    this.levelIndex = -1;
    this.level = null;
    this.world = null;
    this.player = null;
    this.stats = null;
    this.shot = { kind: null, t: 0, x: 0, y: 0, z: 0, nx: 0, ny: 0, target: null, cell: null };
    this.scene = {
      cam: { x: 0, y: 0, z: 0, yaw: 0 },
      sprites: [],
      weapon: { frame: '', dx: 0, dy: 0, light: 1 },
      extraLight: 0,
      time: 0,
    };
    this.pool = [];
  }

  // ---------------------------------------------------------------- level setup

  loadLevel(index, carry) {
    const level = this.levels[index];
    this.levelIndex = index;
    this.level = level;
    this.state = 'playing';
    this.time = 0;
    this.world = new World(level, (id, x, y) => this.sound(id, x, y));
    this.enemies = [];
    this.items = [];
    this.props = [];
    this.projectiles = [];
    this.effects = [];
    this.flash = 0;
    this.seenTimer = 0;
    this.burn = 0;
    this.lockedCell = null;
    this.lockedAt = -10;
    this.painAt = -10;
    this.bossCount = 0;
    this.foundSecrets = new Set();
    this.lastCell = null;

    const p = this.player = {
      x: 1.5, y: 1.5, z: 0, vz: 0, yaw: level.playerYaw || 0, eyeZ: EYE_HEIGHT,
      vx: 0, vy: 0, eyeOffset: 0, bob: 0, bobAmount: 0,
      radius: PLAYER_RADIUS, clearance: PLAYER_HEIGHT, step: STEP_HEIGHT,
      noDrop: false, noDamage: false, onGround: true,
      health: PLAYER.health, armor: 0,
      ammo: { ...PLAYER.startAmmo },
      weapons: PLAYER.startWeapons.slice(),
      weapon: PLAYER.startWeapon,
      keys: { amber: false, cyan: false, magenta: false },
      god: false,
      // weapon state
      pending: -1, switchPhase: 'ready', switchT: 0,
      refire: 0, fireT: 99, fired: false, swingHit: true, pumped: true,
    };
    if (carry) {
      p.health = carry.health;
      p.armor = carry.armor;
      p.ammo = { ...p.ammo, ...carry.ammo };
      p.weapons = carry.weapons.slice();
      p.weapon = p.weapons[carry.weapon] ? carry.weapon : 0;
    }

    let start = null;
    const world = this.world;
    level.things.forEach((row, cy) => {
      for (let cx = 0; cx < row.length; cx++) {
        const ch = row[cx];
        if (ch === THING_EMPTY) continue;
        const t = THING_CHARS[ch];
        if (!t) throw new Error(`${level.id}: unknown thing '${ch}' at ${cx},${cy}`);
        const x = cx + 0.5, y = cy + 0.5, z = world.cell(cx, cy).floor;
        if (t.kind === 'player') start = { x, y, z };
        else if (t.kind === 'enemy') {
          const e = createEnemy(this, t.type, x, y, z);
          this.enemies.push(e);
          if (t.type === 'overseer') this.bossCount++;
        } else if (t.kind === 'prop') {
          const def = PROPS[t.type] || { radius: 0.2, height: 0.5 };
          this.props.push({
            type: t.type, sprite: t.sprite, anchor: t.anchor, blocking: t.blocking,
            x, y, z, radius: def.radius, height: def.height, hp: def.hp || 0, def,
            dead: false, fuse: -1, cell: world.cell(cx, cy),
          });
        } else if (ITEM_KINDS.has(t.kind)) {
          this.items.push({ kind: t.kind, type: t.type, ammo: t.ammo, sprite: t.sprite, x, y, z, taken: false, phase: (cx * 7 + cy * 3) % 10 });
        }
      }
    });
    if (start) { p.x = start.x; p.y = start.y; p.z = start.z; }
    p.eyeZ = p.z + EYE_HEIGHT;

    this.stats = {
      kills: 0, totalKills: this.enemies.length,
      items: 0, totalItems: this.items.length,
      secrets: 0, totalSecrets: world.secrets,
      time: 0,
    };
    world.computeFlow(p.x, p.y);
    world.markSeen(p.x, p.y, p.eyeZ, SEEN_RANGE);
    this.lastCell = world.cellAt(p.x, p.y);
    if (level.intro) this.message(level.intro);
  }

  getLoadout() {
    const p = this.player;
    return {
      health: Math.max(1, Math.ceil(p.health)),
      armor: Math.ceil(p.armor),
      ammo: { ...p.ammo },
      weapons: p.weapons.slice(),
      weapon: p.pending >= 0 ? p.pending : p.weapon,
    };
  }

  // ---------------------------------------------------------------- events

  sound(id, x, y) {
    this.events.push({ type: 'sound', id, x, y });
  }

  message(text) {
    this.events.push({ type: 'message', text });
  }

  impactFx(kind, x, y, z) {
    spawnFx(this, kind, x, y, z);
  }

  fireTag(tag) {
    this.world.fireTag(tag);
    const text = this.level.tagMessages && this.level.tagMessages[tag];
    if (text) this.message(text);
  }

  // Gunfire and explosions wake idle enemies the sound reaches.
  noise(x, y) {
    const world = this.world;
    world.flood(x, y, NOISE_REACH);
    for (const e of this.enemies) {
      if (e.state === 'idle' && world.heard[Math.floor(e.y) * world.w + Math.floor(e.x)]) e.wake = true;
    }
  }

  // ---------------------------------------------------------------- step

  step(dt, input) {
    if (this.state !== 'playing' && this.state !== 'dead') return;
    this.time += dt;
    const p = this.player;
    const world = this.world;
    if (this.state === 'playing') {
      this.stats.time += dt;
      this.playerInput(dt, input);
    } else {
      p.vx = p.vy = 0;
      p.eyeOffset += (-EYE_HEIGHT + 0.12 - p.eyeOffset) * Math.min(1, dt * 4);
    }

    world.update(dt, p, (c) => this.occupied(c));
    this.movePlayer(dt, this.state === 'playing' ? input : null);

    if (world.flowDirty || Math.floor(p.x) !== world.flowX || Math.floor(p.y) !== world.flowY) {
      world.computeFlow(p.x, p.y);
    }
    updateEnemies(this, dt);
    updateProjectiles(this, dt);
    this.updateProps(dt);
    updateEffects(this, dt);
    this.flash = Math.max(0, this.flash - dt * 3);

    if (this.state === 'playing') {
      this.updateWeapon(dt);
      this.pickups();
      this.cellEffects(dt);
      this.seenTimer -= dt;
      if (this.seenTimer <= 0) {
        this.seenTimer = 0.1;
        world.markSeen(p.x, p.y, p.eyeZ, SEEN_RANGE);
      }
    }
  }

  occupied(c) {
    const p = this.player;
    if (circleTouchesCell(p.x, p.y, p.radius, c)) return true;
    for (const e of this.enemies) {
      if (e.alive && circleTouchesCell(e.x, e.y, e.radius, c)) return true;
    }
    return false;
  }

  // ---------------------------------------------------------------- player

  playerInput(dt, input) {
    const p = this.player;
    if (input.turn) p.yaw = wrap(p.yaw + input.turn);
    if (input.weaponSlot >= 0) this.selectSlot(input.weaponSlot);
    if (input.weaponNext) this.cycleWeapon(1);
    if (input.weaponPrev) this.cycleWeapon(-1);
    if (input.use) this.useAhead();
    p.trigger = input.fire;
    this.isTouch = !!input.isTouch;
  }

  movePlayer(dt, input) {
    const p = this.player;
    const world = this.world;
    let wx = 0, wy = 0;
    if (input) {
      const mx = input.moveX || 0, my = input.moveY || 0;
      const c = Math.cos(p.yaw), s = Math.sin(p.yaw);
      wx = c * my - s * mx;
      wy = s * my + c * mx;
      const len = Math.hypot(wx, wy);
      if (len > 1) { wx /= len; wy /= len; }
    }
    const control = p.onGround ? 1 : 0.35;
    const tx = wx * PLAYER.speed, ty = wy * PLAYER.speed;
    const dvx = tx - p.vx, dvy = ty - p.vy;
    const dv = Math.hypot(dvx, dvy);
    if (dv > 0) {
      const rate = (wx || wy ? PLAYER.accel : PLAYER.friction) * control * dt;
      const k = Math.min(1, rate / dv);
      p.vx += dvx * k;
      p.vy += dvy * k;
    }

    if (wx || wy) this.bump(wx, wy);

    const ox = p.x, oy = p.y;
    if (p.vx || p.vy) {
      world.moveBody(p, p.vx * dt, p.vy * dt);
      this.separate(p);
      // Velocity follows what actually happened, so walls do not store momentum.
      p.vx = (p.x - ox) / dt;
      p.vy = (p.y - oy) / dt;
    }
    const r = world.settle(p, dt);
    if (r > 0) p.eyeOffset -= r;
    else if (r < -6) p.eyeOffset -= Math.min(0.25, -r * 0.02);
    if (this.state === 'playing') p.eyeOffset *= Math.max(0, 1 - dt * 10);
    if (Math.abs(p.eyeOffset) < 1e-4 && this.state === 'playing') p.eyeOffset = 0;

    const speed = Math.hypot(p.vx, p.vy);
    const want = p.onGround ? Math.min(1, speed / PLAYER.speed) : 0;
    p.bobAmount += (want - p.bobAmount) * Math.min(1, dt * 8);
    p.bob += dt * (4 + 6 * want);
    let eye = p.z + EYE_HEIGHT + p.eyeOffset + Math.sin(p.bob * 2) * 0.025 * p.bobAmount;
    const ceil = world.ceilZ(p);
    if (eye > ceil - 0.06) eye = ceil - 0.06;
    if (eye < p.z + 0.1) eye = p.z + 0.1;
    p.eyeZ = eye;
  }

  // Bodies the player or an enemy cannot overlap: other live enemies, blocking props, the player.
  separate(b) {
    const world = this.world;
    const sx = b.x, sy = b.y;
    const push = (ox, oy, oz, orad, oh) => {
      if (b.z >= oz + oh || oz >= b.z + (b.clearance || 1)) return;
      const dx = b.x - ox, dy = b.y - oy;
      const min = b.radius + orad;
      const d2 = dx * dx + dy * dy;
      if (d2 >= min * min) return;
      const d = Math.sqrt(d2);
      if (d < 1e-6) { b.x += min * 0.5; return; }
      const k = (min - d) / d;
      b.x += dx * k;
      b.y += dy * k;
    };
    for (const pr of this.props) if (pr.blocking && !pr.dead) push(pr.x, pr.y, pr.z, pr.radius, pr.height);
    for (const e of this.enemies) if (e !== b && e.alive) push(e.x, e.y, e.z, e.radius, e.clearance);
    if (b !== this.player) push(this.player.x, this.player.y, this.player.z, this.player.radius, PLAYER_HEIGHT);
    if (b.x !== sx || b.y !== sy) {
      const ex = b.x, ey = b.y;
      b.x = sx; b.y = sy;
      // Slide the push through the level code so it never ends inside a wall.
      world.moveBody(b, ex - sx, ey - sy);
      if (world.stuck(b, b.x, b.y) && !world.stuck(b, sx, sy)) { b.x = sx; b.y = sy; }
    }
  }

  // Walking into a door, switch or exit uses it.
  bump(wx, wy) {
    const p = this.player;
    const world = this.world;
    const reach = p.radius + 0.1;
    const side = p.radius * 0.9;   // the body's edges, so a door is used when only a shoulder meets it
    const probes = [
      [p.x + wx * reach, p.y + wy * reach],
      [p.x + wx * reach - wy * side, p.y + wy * reach + wx * side],
      [p.x + wx * reach + wy * side, p.y + wy * reach - wx * side],
      [p.x + Math.sign(wx) * reach, p.y],
      [p.x, p.y + Math.sign(wy) * reach],
    ];
    const here = world.cellAt(p.x, p.y);
    for (const [x, y] of probes) {
      const c = world.cellAt(x, y);
      if (c === here) continue;
      if (c.door && (c.door.group.state === 'closed' || c.door.group.state === 'closing')) {
        this.useCell(c, false);
        return;
      }
      if (c.solid && (c.switch || c.exit)) {
        this.useCell(c, false);
        return;
      }
    }
  }

  // USE: the first door, switch, exit or lift in the facing direction within reach.
  useAhead() {
    const p = this.player;
    const world = this.world;
    const dx = Math.cos(p.yaw), dy = Math.sin(p.yaw);
    const here = world.cellAt(p.x, p.y);
    for (let t = 0.05; t <= PLAYER.useReach; t += 0.05) {
      const c = world.cellAt(p.x + dx * t, p.y + dy * t);
      if (c === here) continue;
      if (c.door && c.door.group.state !== 'open') { this.useCell(c, true); return; }
      if (c.solid) { this.useCell(c, true); return; }
      if (c.lift) { world.callLift(c); return; }
      if (c.ceil - c.floor < 0.3 || c.floor - p.z > STEP_HEIGHT + 0.6) return;
    }
  }

  useCell(c, pressed) {
    const world = this.world;
    const p = this.player;
    const x = c.cx + 0.5, y = c.cy + 0.5;
    if (c.door) {
      const r = world.useDoor(c, p.keys);
      if (r === 'locked' || r === 'tagged') {
        if (c === this.lockedCell && this.time - this.lockedAt < 1.2) return;
        this.lockedCell = c;
        this.lockedAt = this.time;
        this.sound('locked', x, y);
        this.message(r === 'locked' ? `You need the ${c.door.key} key.` : 'Opens elsewhere.');
      }
      return;
    }
    if (c.exit) {
      world.lightExit(c);
      this.sound('switch', x, y);
      this.sound('level_end');
      this.events.push({ type: 'levelEnd' });
      this.state = this.levelIndex >= this.levels.length - 1 ? 'victory' : 'levelEnd';
      return;
    }
    if (c.switch) {
      const sw = c.switch;
      // A bump only flips a switch that is off; USE can flip a lift switch back.
      if (sw.on && !(pressed && world.tagHasLift(sw.tag))) return;
      if (this.time < sw.readyAt) return;
      sw.readyAt = this.time + 1;
      world.flipSwitch(c);
      this.sound('switch', x, y);
      this.fireTag(sw.tag);
    }
  }

  cellEffects(dt) {
    const p = this.player;
    const world = this.world;
    const c = world.cellAt(p.x, p.y);
    if (c !== this.lastCell) {
      this.lastCell = c;
      if (c.secretId && !this.foundSecrets.has(c.secretId)) {
        this.foundSecrets.add(c.secretId);
        this.stats.secrets++;
        this.events.push({ type: 'secret' });
        this.sound('secret');
        this.message('Secret area found.');
      }
      if (c.trigger && !c.triggered) {
        c.triggered = true;
        this.fireTag(c.trigger);
      }
    }
    // Damaging floors: any overlapped cell under the feet.
    let dmg = 0;
    if (p.onGround) {
      const r = p.radius * 0.7;
      for (let i = 0; i < 4; i++) {
        const q = world.cellAt(p.x + (i & 1 ? r : -r), p.y + (i & 2 ? r : -r));
        if (q.damage > dmg && Math.abs(q.floor - p.z) < 0.05) dmg = q.damage;
      }
    }
    if (dmg > 0) {
      this.burn -= dt;
      if (this.burn <= 0) {
        this.burn = BURN_PERIOD;
        this.sound('floor_burn', p.x, p.y);
        this.hurtPlayer(dmg * BURN_PERIOD, undefined, undefined, true);
      }
    } else {
      this.burn = 0;
    }
  }

  // sx, sy: where the damage came from (undefined = no direction).
  hurtPlayer(amount, sx, sy, raw) {
    const p = this.player;
    if (this.state !== 'playing' || amount <= 0) return;
    let dmg = raw ? amount : amount * this.diff.damage;
    if (p.god) dmg = 0;
    const absorb = Math.min(p.armor, dmg * PLAYER.armorAbsorb);
    p.armor -= absorb;
    p.health -= dmg - absorb;
    const angle = sx === undefined ? null : wrap(Math.atan2(sy - p.y, sx - p.x) - p.yaw);
    this.events.push({ type: 'damage', amount: dmg, angle });
    if (p.health <= 0) {
      p.health = 0;
      this.state = 'dead';
      this.sound('player_death');
      this.events.push({ type: 'playerDied' });
      return;
    }
    if (this.time - this.painAt > 0.35) {
      this.painAt = this.time;
      this.sound('player_pain');
    }
  }

  // ---------------------------------------------------------------- pickups

  pickups() {
    const p = this.player;
    const reach = p.radius + PLAYER.pickupReach;
    for (const it of this.items) {
      if (it.taken) continue;
      const dx = it.x - p.x, dy = it.y - p.y;
      if (dx * dx + dy * dy > reach * reach || Math.abs(it.z - p.z) > 0.6) continue;
      if (this.take(it)) {
        it.taken = true;
        this.stats.items++;
        this.events.push({ type: 'pickup' });
      }
    }
  }

  take(it) {
    const p = this.player;
    const max = PLAYER.maxAmmo;
    if (it.kind === 'ammo') {
      if (p.ammo[it.ammo] >= max[it.ammo]) return false;
      const dry = this.outOfAmmo(p.weapon);
      p.ammo[it.ammo] = Math.min(max[it.ammo], p.ammo[it.ammo] + PICKUPS[it.type].amount);
      this.sound('pickup_ammo');
      this.message(PICKUPS[it.type].text);
      if (dry && p.weapon === 0) this.autoSwitch();
      return true;
    }
    if (it.kind === 'health') {
      if (p.health >= PLAYER.maxHealth) return false;
      p.health = Math.min(PLAYER.maxHealth, p.health + PICKUPS[it.type].amount);
      this.sound('pickup_health');
      this.message(PICKUPS[it.type].text);
      return true;
    }
    if (it.kind === 'armor') {
      const a = Math.min(PLAYER.maxArmor, PICKUPS[it.type].amount);
      if (p.armor >= a) return false;
      p.armor = a;
      this.sound('pickup_armor');
      this.message(PICKUPS[it.type].text);
      return true;
    }
    if (it.kind === 'key') {
      p.keys[it.type] = true;
      this.sound('pickup_key');
      this.message(`${it.type[0].toUpperCase()}${it.type.slice(1)} key`);
      return true;
    }
    if (it.kind === 'weapon') {
      const slot = WEAPON_IDS.indexOf(it.type);
      const w = WEAPONS[slot];
      const had = p.weapons[slot];
      if (had && p.ammo[w.ammo] >= max[w.ammo]) return false;
      p.weapons[slot] = true;
      p.ammo[w.ammo] = Math.min(max[w.ammo], p.ammo[w.ammo] + (WEAPON_PICKUP_AMMO[it.type] || 0));
      this.sound('pickup_weapon');
      this.message(w.name);
      if (!had) this.switchTo(slot);
      return true;
    }
    return false;
  }

  // ---------------------------------------------------------------- weapons

  outOfAmmo(slot) {
    const w = WEAPONS[slot];
    return !!w.ammo && this.player.ammo[w.ammo] < 1;
  }

  switchTo(slot) {
    const p = this.player;
    if (slot === p.weapon && p.pending < 0) return;
    if (slot === p.pending) return;
    p.pending = slot;
    if (p.switchPhase === 'ready') { p.switchPhase = 'lower'; p.switchT = 0; }
    else if (p.switchPhase === 'raise') { p.switchPhase = 'lower'; p.switchT = WEAPON_SWITCH_TIME - p.switchT; }
  }

  selectSlot(slot) {
    const p = this.player;
    if (!p.weapons[slot]) return;
    if (this.outOfAmmo(slot)) { this.message(`No ${WEAPONS[slot].ammo}.`); return; }
    this.switchTo(slot);
  }

  cycleWeapon(dir) {
    const p = this.player;
    const from = p.pending >= 0 ? p.pending : p.weapon;
    for (let i = 1; i <= 5; i++) {
      const s = (from + dir * i + 10) % 5;
      if (p.weapons[s] && !this.outOfAmmo(s)) { this.switchTo(s); return; }
    }
  }

  autoSwitch() {
    const p = this.player;
    for (const s of AUTO_SWITCH_ORDER) {
      if (p.weapons[s] && !this.outOfAmmo(s)) { this.switchTo(s); return; }
    }
  }

  updateWeapon(dt) {
    const p = this.player;
    const w = WEAPONS[p.weapon];
    p.fireT += dt;
    p.refire -= dt;

    if (p.switchPhase === 'lower') {
      p.switchT += dt;
      if (p.switchT >= WEAPON_SWITCH_TIME) {
        p.weapon = p.pending;
        p.pending = -1;
        p.switchPhase = 'raise';
        p.switchT = WEAPON_SWITCH_TIME;
        p.fireT = 99;
        this.sound('weapon_switch');
      }
      return;
    }
    if (p.switchPhase === 'raise') {
      p.switchT -= dt;
      if (p.switchT <= 0) { p.switchT = 0; p.switchPhase = 'ready'; }
      return;
    }

    if (w.id === 'wrench' && !p.swingHit && p.fireT >= w.hitAt) {
      p.swingHit = true;
      this.melee(w);
    }
    if (w.pumpAt && !p.pumped && p.fireT >= w.pumpAt) {
      p.pumped = true;
      this.sound('scatter_pump', p.x, p.y);
    }

    if (!p.trigger || p.refire > 0) return;
    if (this.outOfAmmo(p.weapon)) {
      this.sound('dry_fire');
      p.refire = 0.4;
      this.autoSwitch();
      return;
    }
    p.refire = w.period;
    p.fireT = 0;
    if (w.ammo) p.ammo[w.ammo]--;
    this.flash = w.flash;
    this.sound(w.sound, p.x, p.y);
    if (w.loud) this.noise(p.x, p.y);

    if (w.kind === 'melee') {
      p.swingHit = false;
    } else if (w.kind === 'hitscan') {
      const aim = this.autoAim(HITSCAN_RANGE);
      for (let i = 0; i < w.pellets; i++) {
        const a = aim.yaw + (this.rng.next() * 2 - 1) * w.spread * DEG;
        const slope = aim.slope + (w.pellets > 1 ? (this.rng.next() * 2 - 1) * 0.03 : 0);
        this.hitscan(p.x, p.y, p.eyeZ - 0.1, a, slope, HITSCAN_RANGE, p, this.rng.range(w.damage[0], w.damage[1]));
      }
      if (w.pumpAt) p.pumped = false;
    } else {
      const aim = this.autoAim(HITSCAN_RANGE);
      const dx = Math.cos(aim.yaw), dy = Math.sin(aim.yaw);
      const z = p.eyeZ - 0.18;
      const slope = aim.target ? (aim.tz - z) / Math.max(0.1, aim.dist) : 0;
      spawnProjectile(this, 'rocket', p, p.x + dx * 0.15, p.y + dy * 0.15, z,
        dx * w.speed, dy * w.speed, slope * w.speed, this.rng.range(w.damage[0], w.damage[1]));
    }
    if (w.ammo && this.outOfAmmo(p.weapon)) this.autoSwitch();
  }

  // The target under the crosshair: nearest visible enemy or drum whose body covers the
  // facing direction (widened by the aim-assist cone on touch). Vertical aim follows it.
  autoAim(range) {
    const p = this.player;
    const out = this.aim || (this.aim = { target: null, yaw: 0, slope: 0, tz: 0, dist: 0 });
    out.target = null;
    out.yaw = p.yaw;
    out.slope = 0;
    const assist = this.isTouch ? PLAYER.aimAssist * DEG : 0;
    const eye = p.eyeZ - 0.1;
    let best = range;
    const consider = (o, x, y, z, r, h) => {
      const dx = x - p.x, dy = y - p.y;
      const d = Math.hypot(dx, dy);
      if (d >= best || d < 0.01) return;
      const off = Math.abs(wrap(Math.atan2(dy, dx) - p.yaw));
      const half = Math.atan(r / d);
      if (off > half + assist) return;
      const tz = z + h * 0.55;
      if (!this.world.los(p.x, p.y, eye, x, y, tz)) return;
      best = d;
      out.target = o;
      out.tz = tz;
      out.dist = d;
      out.slope = (tz - eye) / d;
      out.yaw = off > half * 0.8 ? Math.atan2(dy, dx) : p.yaw;
    };
    for (const e of this.enemies) if (e.alive) consider(e, e.x, e.y, e.z + e.hover, e.def.hitRadius, e.def.height);
    for (const pr of this.props) if (pr.hp && !pr.dead) consider(pr, pr.x, pr.y, pr.z, pr.radius, pr.height);
    return out;
  }

  // Fires one instant shot. Damages what it hits, spawns the impact effect.
  hitscan(x, y, z, yaw, slope, range, owner, damage) {
    const dx = Math.cos(yaw), dy = Math.sin(yaw);
    const s = this.trace(x, y, z, dx, dy, slope, range, owner, 0);
    const bx = s.x - dx * 0.06, by = s.y - dy * 0.06, bz = s.z - slope * 0.06;
    if (s.kind === 'enemy') {
      hurtEnemy(this, s.target, damage, owner);
      spawnFx(this, 'oil', bx, by, bz);
    } else if (s.kind === 'prop') {
      this.damageProp(s.target, damage);
      spawnFx(this, 'puff', bx, by, bz);
    } else if (s.kind === 'player') {
      this.hurtPlayer(damage, owner.x, owner.y);
    } else if (s.kind && s.kind !== 'sky') {
      spawnFx(this, 'puff', bx, by, bz);
      if (owner === this.player && this.rng.chance(0.25)) this.sound('ricochet', bx, by);
    }
    return s;
  }

  melee(w) {
    const p = this.player;
    const aim = this.autoAim(w.reach + 0.6);
    const damage = this.rng.range(w.damage[0], w.damage[1]);
    if (aim.target) {
      const t = aim.target;
      const r = t.def.hitRadius || t.radius;
      if (aim.dist - r <= w.reach) {
        const fx = p.x + (t.x - p.x) * (1 - r / aim.dist), fy = p.y + (t.y - p.y) * (1 - r / aim.dist);
        if (t.alive !== undefined) {
          hurtEnemy(this, t, damage, p);
          spawnFx(this, 'oil', fx, fy, aim.tz);
        } else {
          this.damageProp(t, damage);
          spawnFx(this, 'puff', fx, fy, aim.tz);
        }
        this.sound('wrench_hit', fx, fy);
        return;
      }
    }
    const dx = Math.cos(p.yaw), dy = Math.sin(p.yaw);
    const s = this.trace(p.x, p.y, p.eyeZ - 0.15, dx, dy, 0, w.reach, p, 0);
    if (s.kind && s.kind !== 'sky') {
      if (s.kind === 'prop') this.damageProp(s.target, damage);
      spawnFx(this, 'puff', s.x - dx * 0.06, s.y - dy * 0.06, s.z);
      this.sound('wrench_hit', s.x, s.y);
    }
  }

  // Ray against the level, live enemies, blocking props and the player (unless owner).
  // Fills this.shot: kind null | 'wall' | 'floor' | 'ceil' | 'sky' | 'enemy' | 'prop' | 'player'.
  trace(x, y, z, dx, dy, dz, maxT, owner, pad) {
    const world = this.world;
    const shot = this.shot;
    let best = world.castRay(x, y, z, dx, dy, dz, maxT);
    const h = world.hit;
    shot.kind = h.kind;
    shot.cell = h.cell;
    shot.nx = h.nx;
    shot.ny = h.ny;
    shot.target = null;
    for (const e of this.enemies) {
      if (!e.alive || e === owner) continue;
      const t = rayCylinder(x, y, z, dx, dy, dz, e.x, e.y, e.z + e.hover, e.def.hitRadius + pad, e.def.height, best);
      if (t >= 0 && t < best) { best = t; shot.kind = 'enemy'; shot.target = e; }
    }
    for (const pr of this.props) {
      if (!pr.blocking || pr.dead) continue;
      const t = rayCylinder(x, y, z, dx, dy, dz, pr.x, pr.y, pr.z, pr.radius + pad, pr.height, best);
      if (t >= 0 && t < best) { best = t; shot.kind = 'prop'; shot.target = pr; }
    }
    const p = this.player;
    if (owner !== p && this.state === 'playing') {
      const t = rayCylinder(x, y, z, dx, dy, dz, p.x, p.y, p.z, p.radius + pad, PLAYER_HEIGHT, best);
      if (t >= 0 && t < best) { best = t; shot.kind = 'player'; shot.target = p; }
    }
    shot.t = best;
    shot.x = x + dx * best;
    shot.y = y + dy * best;
    shot.z = z + dz * best;
    return shot;
  }

  // ---------------------------------------------------------------- props and explosions

  damageProp(pr, amount) {
    if (!pr.hp || pr.dead || pr.fuse >= 0) return;
    pr.hp -= amount;
    if (pr.hp <= 0) pr.fuse = 0.08 + this.rng.next() * 0.1;
  }

  updateProps(dt) {
    for (const pr of this.props) {
      if (pr.fuse < 0 || pr.dead) continue;
      pr.fuse -= dt;
      if (pr.fuse > 0) continue;
      pr.dead = true;
      this.explode(pr.x, pr.y, pr.z + pr.height * 0.5, pr.def.blast, pr.def.blastRadius, false, null, true);
    }
  }

  // Splash damage falling off with distance, needs a clear line. selfShot: the player's
  // own launcher (takes a share). drum: a drum blast (full damage to the player).
  explode(x, y, z, damage, radius, selfShot, exclude, drum) {
    const world = this.world;
    spawnFx(this, 'explode', x, y, z);
    spawnFx(this, 'smoke', x, y, z + 0.2);
    this.sound('explode', x, y);
    this.flash = Math.max(this.flash, 0.25);
    this.noise(x, y);
    const fall = (tx, ty, tz, r) => {
      const d = Math.max(0, Math.hypot(tx - x, ty - y, tz - z) - r);
      if (d >= radius) return 0;
      if (!world.los(x, y, z, tx, ty, tz)) return 0;
      return damage * (1 - d / radius);
    };
    for (const e of this.enemies) {
      if (!e.alive || e === exclude) continue;
      const dmg = fall(e.x, e.y, e.z + e.hover + e.def.height * 0.5, e.def.hitRadius);
      if (dmg > 0) hurtEnemy(this, e, dmg, this.player);
    }
    for (const pr of this.props) {
      if (pr.hp && !pr.dead && pr !== exclude) {
        const dmg = fall(pr.x, pr.y, pr.z + pr.height * 0.5, pr.radius);
        if (dmg > 0) this.damageProp(pr, dmg);
      }
    }
    const p = this.player;
    const dmg = fall(p.x, p.y, p.z + 0.4, p.radius);
    if (dmg > 0) this.hurtPlayer(selfShot && !drum ? dmg * PLAYER.selfSplash : dmg, x, y);
  }

  damageEnemy(e, amount) {
    hurtEnemy(this, e, amount, this.player);
  }

  // Called by enemies.js when an overseer finishes dying.
  bossDied() {
    this.bossCount--;
    if (this.bossCount === 0) this.fireTag(BOSS_TAG);
  }

  // ---------------------------------------------------------------- scene

  getScene() {
    const scene = this.scene;
    const p = this.player;
    const world = this.world;
    scene.cam.x = p.x;
    scene.cam.y = p.y;
    scene.cam.z = p.eyeZ;
    scene.cam.yaw = p.yaw;
    scene.time = this.time;
    scene.extraLight = this.flash;

    const list = scene.sprites;
    let n = 0;
    const add = (frame, x, y, z, anchor, light) => {
      let s = this.pool[n];
      if (!s) s = this.pool[n] = { frame: '', x: 0, y: 0, z: 0, anchor: 'bottom', light: 1, flipX: false };
      s.frame = frame; s.x = x; s.y = y; s.z = z; s.anchor = anchor; s.light = light; s.flipX = false;
      list[n++] = s;
      return s;
    };
    const lightAt = (x, y) => world.cellAt(x, y).light;

    for (const e of this.enemies) {
      const s = add(enemySprite(e), e.x, e.y, e.z + e.hover, 'bottom', lightAt(e.x, e.y));
      s.flipX = e.flip;
    }
    for (const it of this.items) {
      if (it.taken) continue;
      add(it.sprite, it.x, it.y, it.z + 0.03 + 0.03 * (1 + Math.sin(this.time * 3 + it.phase)), 'bottom', lightAt(it.x, it.y));
    }
    for (const pr of this.props) {
      if (pr.dead) continue;
      const z = pr.anchor === 'top' ? pr.cell.ceil : pr.z;
      add(pr.sprite, pr.x, pr.y, z, pr.anchor, pr.cell.light);
    }
    for (const pr of this.projectiles) add(projectileFrame(pr), pr.x, pr.y, pr.z, 'center', -1);
    for (const fx of this.effects) {
      add(effectFrame(fx), fx.x, fx.y, fx.z, 'center', fx.def.light < 0 ? -1 : lightAt(fx.x, fx.y));
    }
    list.length = n;

    if (this.state === 'dead') {
      scene.weapon = null;
      return scene;
    }
    const wp = scene.weapon = this.weaponView || (this.weaponView = { frame: '', dx: 0, dy: 0, light: 1 });
    const w = WEAPONS[p.weapon];
    const frames = WEAPON_FRAMES[p.weapon];
    let frame = frames.idle;
    let acc = 0;
    for (let i = 0; i < w.frames.length; i++) {
      acc += w.frames[i];
      if (p.fireT < acc) { frame = frames.fire[i]; break; }
    }
    wp.frame = frame;
    const bob = p.bobAmount;
    wp.dx = Math.cos(p.bob) * 7 * bob;
    wp.dy = Math.abs(Math.sin(p.bob)) * 5 * bob + 2 * bob;
    if (p.fireT < 0.15) wp.dy += w.kick * (1 - p.fireT / 0.15);
    if (p.switchPhase !== 'ready') wp.dy += SWITCH_DROP * (p.switchT / WEAPON_SWITCH_TIME);
    wp.light = lightAt(p.x, p.y);
    return scene;
  }
}

export { WEAPONS, KEY_NAMES };
