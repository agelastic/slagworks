// Gameplay numbers. Shapes and names shared with other modules live in ../config.js.

export const PLAYER = {
  speed: 3.4,          // units per second
  accel: 34,           // toward the wished velocity, units per second squared
  friction: 24,        // with no input
  health: 100,
  maxHealth: 100,
  maxArmor: 100,
  armorAbsorb: 0.5,    // share of damage taken by armor while it lasts
  useReach: 1.2,
  pickupReach: 0.3,    // added to the player radius
  startWeapons: [true, true, false, false, false],
  startWeapon: 1,
  startAmmo: { rivets: 50, shells: 0, canisters: 0 },
  maxAmmo: { rivets: 200, shells: 50, canisters: 20 },
  aimAssist: 5.5,      // degrees, touch only
  selfSplash: 0.7,     // share of own launcher splash taken
};

export const GRAVITY = 18;
export const MAX_FALL = 16;

// Index = weapon slot. `frames` are the durations of wp_<id>_fire0..n in seconds.
// spread is the half-angle in degrees. period is seconds between shots.
export const WEAPONS = [
  { id: 'wrench', name: 'Torque Wrench', ammo: null, kind: 'melee',
    damage: [20, 40], reach: 1.1, period: 0.5, frames: [0.07, 0.1, 0.13], hitAt: 0.1,
    sound: 'wrench_swing', flash: 0, kick: 0, loud: false },
  { id: 'rivet', name: 'Rivet Gun', ammo: 'rivets', kind: 'hitscan',
    damage: [10, 15], pellets: 1, spread: 0.6, period: 0.3, frames: [0.06, 0.09],
    sound: 'rivet_fire', flash: 0.22, kick: 4, loud: true },
  { id: 'scatter', name: 'Scattergun', ammo: 'shells', kind: 'hitscan',
    damage: [6, 12], pellets: 7, spread: 6, period: 0.95, frames: [0.07, 0.15, 0.2, 0.2], pumpAt: 0.32,
    sound: 'scatter_fire', flash: 0.4, kick: 10, loud: true },
  { id: 'bolt', name: 'Bolt Driver', ammo: 'rivets', kind: 'hitscan',
    damage: [10, 15], pellets: 1, spread: 2, period: 1 / 9, frames: [0.05, 0.05],
    sound: 'bolt_fire', flash: 0.2, kick: 3, loud: true },
  { id: 'launcher', name: 'Thermal Launcher', ammo: 'canisters', kind: 'projectile',
    damage: [60, 100], splash: 70, splashRadius: 2.2, speed: 14, period: 0.9, frames: [0.07, 0.12, 0.16],
    sound: 'launcher_fire', flash: 0.35, kick: 12, loud: true },
];

// Weapon picked when the current one runs dry, best first.
export const AUTO_SWITCH_ORDER = [2, 3, 1, 4, 0];

export const WEAPON_SWITCH_TIME = 0.14;   // seconds to lower, and again to raise
export const HITSCAN_RANGE = 48;

// Things-layer pickups, keyed by THING_CHARS type.
export const PICKUPS = {
  rivets: { amount: 10, text: 'Rivets' },
  rivetbox: { amount: 50, text: 'Box of rivets' },
  shells: { amount: 4, text: 'Shells' },
  shellbox: { amount: 20, text: 'Box of shells' },
  canister: { amount: 1, text: 'Thermal canister' },
  canistercrate: { amount: 5, text: 'Crate of canisters' },
  medgel: { amount: 10, text: 'Med gel' },
  medkit: { amount: 25, text: 'Med kit' },
  vest: { amount: 50, text: 'Plate vest' },
  heavyarmor: { amount: 100, text: 'Heavy plating' },
};

// Ammo that comes with a weapon pickup.
export const WEAPON_PICKUP_AMMO = { scatter: 8, bolt: 40, launcher: 3 };

// Blocking props. Sizes in world units.
export const PROPS = {
  drum: { radius: 0.22, height: 0.6, hp: 15, blast: 90, blastRadius: 2.4 },
  lamp: { radius: 0.12, height: 1.15 },
  tank: { radius: 0.32, height: 1.2 },
};

// radius: collision with the level and other bodies (below 0.5). hitRadius, height: what shots hit.
// eye: height that sees and shoots. cooldown: seconds between attacks, [min, max].
export const ENEMIES = {
  scrapper: {
    hp: 30, speed: 2.6, radius: 0.3, hitRadius: 0.34, height: 0.5, eye: 0.3, painChance: 0.6,
    attack: 'melee', damage: [8, 12], reach: 0.45, windup: 0.22, recover: 0.25, cooldown: [0.35, 0.7],
    walkFps: 11, dieTime: 0.45,
  },
  gunner: {
    hp: 45, speed: 1.5, radius: 0.3, hitRadius: 0.32, height: 1.15, eye: 0.85, painChance: 0.65,
    attack: 'hitscan', damage: [4, 8], burst: 3, burstGap: 0.14, spread: 4.5, range: 18, hold: 3,
    windup: 0.4, recover: 0.25, cooldown: [1.2, 2.2],
    walkFps: 6, dieTime: 0.5,
  },
  spitter: {
    hp: 70, speed: 1.3, radius: 0.36, hitRadius: 0.4, height: 1.0, eye: 0.7, painChance: 0.4,
    attack: 'lob', damage: [12, 20], projSpeed: 6, lead: 0.5, range: 13, hold: 4,
    windup: 0.5, recover: 0.35, cooldown: [1.6, 2.6],
    walkFps: 5, dieTime: 0.55,
  },
  hauler: {
    hp: 220, speed: 1.9, radius: 0.45, hitRadius: 0.52, height: 1.4, eye: 1.0, painChance: 0.18,
    attack: 'melee', damage: [20, 30], reach: 0.5, windup: 0.4, recover: 0.4, cooldown: [0.6, 1.0],
    charge: { min: 2.2, max: 6.5, speed: 6.5, time: 0.7, windup: 0.45, cooldown: 4 },
    walkFps: 6, dieTime: 0.6,
  },
  overseer: {
    hp: 1500, speed: 1.0, radius: 0.48, hitRadius: 0.85, height: 2.0, eye: 1.2, painChance: 0.02,
    attack: 'volley', damage: [8, 14], projSpeed: 9, range: 40, hold: 5,
    windup: 0.5, recover: 0.4, volleyGap: 0.35,
    // Picked by remaining health share. fan is the total spread of one volley in degrees.
    phases: [
      { above: 0.66, bolts: 3, fan: 16, volleys: 1, cooldown: [2.0, 2.8], spawnEvery: 14, spawnCap: 2, speed: 1.0 },
      { above: 0.33, bolts: 5, fan: 26, volleys: 2, cooldown: [1.5, 2.1], spawnEvery: 10, spawnCap: 4, speed: 1.25 },
      { above: 0, bolts: 7, fan: 38, volleys: 3, cooldown: [1.1, 1.6], spawnEvery: 7, spawnCap: 6, speed: 1.5 },
    ],
    walkFps: 4, dieTime: 1.2,
  },
};

export const ENEMY_SIGHT = 24;        // cells
export const NOISE_REACH = 14;        // cells that gunfire floods through
export const SLAG_GRAVITY = 2.5;      // gentle arc for the spitter's glob

// Index = difficulty. damage scales what the player takes, cadence scales enemy cooldowns,
// reaction scales the delay between an enemy waking and its first attack.
export const DIFFICULTY = [
  { damage: 0.6, cadence: 1.35, reaction: 1.4 },
  { damage: 1, cadence: 1, reaction: 1 },
  { damage: 1.4, cadence: 0.75, reaction: 0.7 },
];
