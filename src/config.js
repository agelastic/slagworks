// Names, shapes and physical constants shared across modules.
// Gameplay tuning (damage, speeds, pickup amounts) lives in src/game/tuning.js.
// Runs unmodified in Node and in the browser.

// ---------------------------------------------------------------- units

export const PLAYER_RADIUS = 0.28;
export const PLAYER_HEIGHT = 0.80;
export const EYE_HEIGHT = 0.62;      // above the feet
export const STEP_HEIGHT = 0.35;     // max step up
export const TEXELS_PER_UNIT = 64;   // walls, flats and sprites
export const GRID_MAX = 64;          // max level width and height in cells

export const STEP_DT = 1 / 60;       // fixed simulation step, seconds
export const MAX_STEPS_PER_FRAME = 5;

export const FOV_Y_DEG = 58;         // vertical field of view
export const RENDER_H_DEFAULT = 240; // internal render height
export const RENDER_H_HIGH = 400;
export const RENDER_ASPECT_MAX = 2.4; // internal width clamped to [renderH, renderH * 2.4]
export const VIRTUAL_W = 320;        // weapon view-models are laid out on this screen
export const VIRTUAL_H = 240;

export const BOSS_TAG = 99;          // fired when the last overseer in a level dies
export const MUSIC_TRACK_COUNT = 4;
export const LEVEL_COUNT = 4;

// ---------------------------------------------------------------- textures

export const TEXTURE_SIZE = 64;
export const SKY = 'sky';
export const SKY_W = 256;
export const SKY_H = 128;

export const WALL_TEXTURES = Object.freeze([
  'w_plate', 'w_rust', 'w_brick', 'w_pipes', 'w_grate', 'w_hazard', 'w_concrete',
  'w_panel', 'w_crate', 'w_rock', 'w_furnace', 'w_screen',
  'w_door', 'w_door_amber', 'w_door_cyan', 'w_door_magenta',
  'w_switch_off', 'w_switch_on', 'w_exit_off', 'w_exit_on',
]);

export const FLAT_TEXTURES = Object.freeze([
  'f_plate', 'f_grate', 'f_concrete', 'f_hazard', 'f_rust', 'f_rock', 'f_lift',
  'f_slag', 'f_coolant',
  'c_panel', 'c_pipes', 'c_light', 'c_dark',
]);

// Every key buildTextures() must return, in sheet order. All 64 x 64 except 'sky' (256 x 128).
export const TEXTURE_NAMES = Object.freeze([...WALL_TEXTURES, ...FLAT_TEXTURES, SKY]);

// Frame counts for animated textures (all others have 1 frame) and the fullbright set.
export const TEXTURE_FRAMES = Object.freeze({ w_screen: 2, f_slag: 4, f_coolant: 4 });
export const TEXTURE_FULLBRIGHT = Object.freeze(['f_slag', 'f_coolant', 'c_light']);

// Textures the game swaps at runtime.
export const TEX_SWITCH_OFF = 'w_switch_off';
export const TEX_SWITCH_ON = 'w_switch_on';
export const TEX_EXIT_OFF = 'w_exit_off';
export const TEX_EXIT_ON = 'w_exit_on';

// ---------------------------------------------------------------- keys

export const KEY_NAMES = Object.freeze(['amber', 'cyan', 'magenta']);
// One hex per key, used by door textures, key sprites, HUD and minimap.
export const KEY_COLORS = Object.freeze({
  amber: '#ffae1a',
  cyan: '#22d6e6',
  magenta: '#e83ac2',
});
export const KEY_DOOR_TEXTURES = Object.freeze({
  amber: 'w_door_amber',
  cyan: 'w_door_cyan',
  magenta: 'w_door_magenta',
});

// ---------------------------------------------------------------- enemies

export const ENEMY_TYPES = Object.freeze(['scrapper', 'gunner', 'spitter', 'hauler', 'overseer']);

// Sprite size in pixels and frame count per animation.
// Frame names: <type>_walk0.., <type>_attack0.. (0 wind-up, 1 strike/fire),
// <type>_pain0, <type>_die0.. (last die frame is the wreck that stays on the floor).
export const ENEMY_SPRITES = Object.freeze({
  scrapper: { w: 48, h: 36, walk: 4, attack: 2, pain: 1, die: 4 },
  gunner: { w: 48, h: 76, walk: 4, attack: 2, pain: 1, die: 4 },
  spitter: { w: 56, h: 68, walk: 4, attack: 2, pain: 1, die: 4 },
  hauler: { w: 76, h: 92, walk: 4, attack: 2, pain: 1, die: 4 },
  overseer: { w: 120, h: 132, walk: 4, attack: 2, pain: 1, die: 5 },
});
export const ENEMY_ANIMS = Object.freeze(['walk', 'attack', 'pain', 'die']);

// ---------------------------------------------------------------- weapons

// Index in this array = weapon slot 0..4 (player.weapon, player.weapons[]).
export const WEAPON_IDS = Object.freeze(['wrench', 'rivet', 'scatter', 'bolt', 'launcher']);
export const AMMO_TYPES = Object.freeze(['rivets', 'shells', 'canisters']);

// View-model frame size and number of fire frames.
// Frame names: wp_<id>_idle, wp_<id>_fire0 .. wp_<id>_fire<fire - 1>.
export const WEAPON_SPRITES = Object.freeze({
  wrench: { w: 140, h: 110, fire: 3 },
  rivet: { w: 100, h: 100, fire: 2 },
  scatter: { w: 150, h: 110, fire: 4 },
  bolt: { w: 130, h: 110, fire: 2 },
  launcher: { w: 150, h: 120, fire: 3 },
});

// ---------------------------------------------------------------- items, props, effects

export const ITEM_SPRITES = Object.freeze({
  it_rivets: { w: 20, h: 16 },
  it_rivetbox: { w: 28, h: 22 },
  it_shells: { w: 20, h: 14 },
  it_shellbox: { w: 28, h: 20 },
  it_canister: { w: 14, h: 22 },
  it_canistercrate: { w: 30, h: 24 },
  it_medgel: { w: 14, h: 18 },
  it_medkit: { w: 26, h: 20 },
  it_vest: { w: 28, h: 26 },
  it_heavyarmor: { w: 30, h: 30 },
  it_key_amber: { w: 16, h: 24 },
  it_key_cyan: { w: 16, h: 24 },
  it_key_magenta: { w: 16, h: 24 },
  it_scattergun: { w: 52, h: 18 },
  it_boltdriver: { w: 52, h: 22 },
  it_launcher: { w: 56, h: 24 },
});

export const PROP_SPRITES = Object.freeze({
  pr_drum: { w: 26, h: 38, anchor: 'bottom' },
  pr_lamp: { w: 14, h: 74, anchor: 'bottom' },
  pr_tank: { w: 40, h: 76, anchor: 'bottom' },
  pr_junk: { w: 52, h: 22, anchor: 'bottom' },
  pr_cable: { w: 12, h: 64, anchor: 'top' },
});

// Frame names: <key>0 .. <key><frames - 1>. All anchored at their centre.
export const FX_SPRITES = Object.freeze({
  fx_slag: { w: 20, h: 20, frames: 2 },
  fx_bolt: { w: 16, h: 16, frames: 2 },
  fx_rocket: { w: 18, h: 18, frames: 2 },
  fx_puff: { w: 16, h: 16, frames: 4 },
  fx_oil: { w: 20, h: 20, frames: 4 },
  fx_explode: { w: 72, h: 72, frames: 6 },
  fx_smoke: { w: 24, h: 24, frames: 4 },
});

// ---------------------------------------------------------------- sprite frames

// Every sprite frame name -> { w, h, anchor }, anchor is 'bottom' | 'center' | 'top'.
// buildSprites() must return exactly these frames at exactly these pixel sizes.
export const SPRITE_SIZES = (() => {
  const out = {};
  const add = (name, w, h, anchor) => { out[name] = Object.freeze({ w, h, anchor }); };
  for (const type of ENEMY_TYPES) {
    const e = ENEMY_SPRITES[type];
    for (const anim of ENEMY_ANIMS) {
      for (let i = 0; i < e[anim]; i++) add(`${type}_${anim}${i}`, e.w, e.h, 'bottom');
    }
  }
  for (const [name, s] of Object.entries(ITEM_SPRITES)) add(name, s.w, s.h, 'bottom');
  for (const [name, s] of Object.entries(PROP_SPRITES)) add(name, s.w, s.h, s.anchor);
  for (const [name, s] of Object.entries(FX_SPRITES)) {
    for (let i = 0; i < s.frames; i++) add(`${name}${i}`, s.w, s.h, 'center');
  }
  for (const id of WEAPON_IDS) {
    const s = WEAPON_SPRITES[id];
    add(`wp_${id}_idle`, s.w, s.h, 'bottom');
    for (let i = 0; i < s.fire; i++) add(`wp_${id}_fire${i}`, s.w, s.h, 'bottom');
  }
  return Object.freeze(out);
})();

export const SPRITE_NAMES = Object.freeze(Object.keys(SPRITE_SIZES));

// ---------------------------------------------------------------- sounds

export const SOUND_IDS = Object.freeze([
  'wrench_swing', 'wrench_hit', 'rivet_fire', 'scatter_fire', 'scatter_pump', 'bolt_fire',
  'launcher_fire', 'explode', 'dry_fire', 'weapon_switch', 'ricochet',
  'door_open', 'door_close', 'lift_move', 'lift_stop', 'switch', 'locked', 'secret',
  'pickup_item', 'pickup_ammo', 'pickup_weapon', 'pickup_key', 'pickup_health', 'pickup_armor',
  'player_pain', 'player_death', 'floor_burn',
  'slag_spit', 'slag_hit', 'bolt_shot', 'bolt_hit',
  'level_end', 'menu_move', 'menu_select',
  ...ENEMY_TYPES.flatMap((t) => [`${t}_alert`, `${t}_attack`, `${t}_pain`, `${t}_death`]),
]);

// ---------------------------------------------------------------- things layer

// Things-layer char -> { kind, type, ... }. '.' means nothing.
//   kind 'player'  type 'start'
//   kind 'enemy'   type = one of ENEMY_TYPES
//   kind 'weapon'  type = one of WEAPON_IDS, sprite = item frame
//   kind 'ammo'    type = item name, ammo = one of AMMO_TYPES, sprite
//   kind 'health' | 'armor'   type = item name, sprite
//   kind 'key'     type = one of KEY_NAMES, sprite
//   kind 'prop'    type = prop name, sprite, blocking (solid to movement), anchor
export const THING_CHARS = Object.freeze({
  P: { kind: 'player', type: 'start' },

  a: { kind: 'enemy', type: 'scrapper' },
  b: { kind: 'enemy', type: 'gunner' },
  c: { kind: 'enemy', type: 'spitter' },
  d: { kind: 'enemy', type: 'hauler' },
  Z: { kind: 'enemy', type: 'overseer' },

  3: { kind: 'weapon', type: 'scatter', sprite: 'it_scattergun' },
  4: { kind: 'weapon', type: 'bolt', sprite: 'it_boltdriver' },
  5: { kind: 'weapon', type: 'launcher', sprite: 'it_launcher' },

  r: { kind: 'ammo', type: 'rivets', ammo: 'rivets', sprite: 'it_rivets' },
  R: { kind: 'ammo', type: 'rivetbox', ammo: 'rivets', sprite: 'it_rivetbox' },
  s: { kind: 'ammo', type: 'shells', ammo: 'shells', sprite: 'it_shells' },
  S: { kind: 'ammo', type: 'shellbox', ammo: 'shells', sprite: 'it_shellbox' },
  k: { kind: 'ammo', type: 'canister', ammo: 'canisters', sprite: 'it_canister' },
  K: { kind: 'ammo', type: 'canistercrate', ammo: 'canisters', sprite: 'it_canistercrate' },

  '+': { kind: 'health', type: 'medgel', sprite: 'it_medgel' },
  H: { kind: 'health', type: 'medkit', sprite: 'it_medkit' },
  v: { kind: 'armor', type: 'vest', sprite: 'it_vest' },
  V: { kind: 'armor', type: 'heavyarmor', sprite: 'it_heavyarmor' },

  A: { kind: 'key', type: 'amber', sprite: 'it_key_amber' },
  C: { kind: 'key', type: 'cyan', sprite: 'it_key_cyan' },
  M: { kind: 'key', type: 'magenta', sprite: 'it_key_magenta' },

  x: { kind: 'prop', type: 'drum', sprite: 'pr_drum', blocking: true, anchor: 'bottom' },
  l: { kind: 'prop', type: 'lamp', sprite: 'pr_lamp', blocking: true, anchor: 'bottom' },
  p: { kind: 'prop', type: 'tank', sprite: 'pr_tank', blocking: true, anchor: 'bottom' },
  j: { kind: 'prop', type: 'junk', sprite: 'pr_junk', blocking: false, anchor: 'bottom' },
  i: { kind: 'prop', type: 'cable', sprite: 'pr_cable', blocking: false, anchor: 'top' },
});

export const THING_EMPTY = '.';

// ---------------------------------------------------------------- game / ui

export const DIFFICULTY_NAMES = Object.freeze(['Apprentice', 'Journeyman', 'Foreman']);

export const GAME_STATES = Object.freeze(['playing', 'dead', 'levelEnd', 'victory']);

export const MENU_SCREENS = Object.freeze([
  'title', 'difficulty', 'settings', 'help', 'pause', 'dead', 'intermission', 'victory', 'loading',
]);

export const SETTINGS_KEY = 'slagworks.settings';
export const SAVE_KEY = 'slagworks.save';
export const DEFAULT_SETTINGS = Object.freeze({
  sensitivity: 1, sfx: 0.8, music: 0.5, quality: RENDER_H_DEFAULT, leftHanded: false,
});

// A fresh, neutral input sample in the shape createInput().sample() returns.
export function neutralInput() {
  return {
    moveX: 0, moveY: 0, turn: 0,
    fire: false,
    use: false, weaponNext: false, weaponPrev: false,
    weaponSlot: -1,
    pause: false, map: false,
    isTouch: false,
  };
}
