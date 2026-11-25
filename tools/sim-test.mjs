// Headless test of the game logic.
//
//   node tools/sim-test.mjs              fixture assertions, fuzz, walker on fixture and every real level
//   node tools/sim-test.mjs --level l2   fuzz and walker on one real level only
//   node tools/sim-test.mjs --quick      fixture assertions only
//
// Exit code 1 when an assertion fails.

import { existsSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import { Game } from '../src/game/game.js';
import { hurtEnemy, createEnemy } from '../src/game/enemies.js';
import { neutralInput, STEP_DT, BOSS_TAG, STEP_HEIGHT, PLAYER_HEIGHT, SPRITE_SIZES, SOUND_IDS } from '../src/config.js';
import { WEAPONS } from '../src/game/tuning.js';
import { build } from '../src/levels/build.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const onlyLevel = args.includes('--level') ? args[args.indexOf('--level') + 1] : null;
const quick = args.includes('--quick');

let failures = 0;
function check(cond, what) {
  if (cond) console.log(`  ok    ${what}`);
  else { failures++; console.log(`  FAIL  ${what}`); }
}

// ---------------------------------------------------------------- fixture level

const W = 41;
function row(fill, set) {
  const a = new Array(W).fill(fill);
  for (const [x0, x1, ch] of set) for (let x = x0; x <= x1; x++) a[x] = ch;
  return a.join('');
}
const CELLS = [
  row('#', [[3, 3, 'W'], [36, 36, 'X']]),
  row('#', [[1, 5, '.'], [7, 11, '.'], [13, 15, '.'], [16, 17, '~'], [19, 23, '.'], [25, 29, 'h'], [31, 35, 'o'], [36, 36, 'T'], [37, 37, 'n'], [38, 38, 'O'], [39, 39, 'E']]),
  row('#', [[1, 5, '.'], [6, 6, 'D'], [7, 11, '.'], [12, 12, 'Y'], [13, 13, '.'], [14, 14, 'g'], [15, 17, '.'], [18, 18, 'u'], [19, 23, '.'], [24, 24, 'L'], [25, 29, 'h'], [30, 30, 'G'], [31, 36, 'o']]),
  row('#', [[1, 5, '.'], [7, 11, '.'], [13, 17, '.'], [19, 19, 'z'], [20, 23, '.'], [25, 29, 'h'], [31, 36, 'o']]),
  row('#', [[15, 15, 'Q']]),
  row('#', [[15, 15, 'q']]),
  row('#', []),
];
const THINGS = (() => {
  const t = CELLS.map(() => new Array(W).fill('.'));
  const put = (x, y, ch) => { t[y][x] = ch; };
  put(2, 2, 'P');
  'rRsSk'.split('').forEach((ch, i) => put(1 + i, 1, ch));
  'K+HvV'.split('').forEach((ch, i) => put(1 + i, 3, ch));
  put(9, 3, 'A'); put(10, 1, 'a'); put(8, 1, '3');
  put(13, 3, 'j'); put(17, 3, 'i'); put(15, 5, 'C');
  put(22, 1, 'b'); put(22, 3, 'c'); put(20, 1, '4'); put(20, 3, 'x');
  put(28, 2, 'd'); put(26, 1, '5'); put(25, 3, 'l'); put(29, 3, 'p'); put(27, 3, 'M');
  put(33, 2, 'Z');
  return t.map((r) => r.join(''));
})();
const room = { floor: 0, ceil: 1.5, ft: 'f_plate', ct: 'c_panel', wt: 'w_plate', light: 0.8 };
const FIXTURE = {
  id: 'fx', name: 'Fixture', intro: 'Fixture level.', music: 0, par: 60, playerYaw: 0,
  cells: CELLS, things: THINGS,
  legend: {
    '#': { solid: true, wall: 'w_plate' },
    '.': room,
    '~': { ...room, ft: 'f_slag', damage: 10 },
    g: { ...room, trigger: 7 },
    q: { ...room, secret: true },
    z: { ...room, floor: 0.3 },
    D: { ...room, door: { tex: 'w_door' } },
    Y: { ...room, door: { tex: 'w_door_amber', key: 'amber' } },
    u: { ...room, door: { tex: 'w_door', tag: 7 } },
    Q: { ...room, door: { tex: 'w_plate', secret: true } },
    L: { floor: 0, ceil: 2.5, ft: 'f_lift', ct: 'c_panel', wt: 'w_hazard', light: 0.8, lift: { low: 0, high: 1, tag: 0 } },
    h: { ...room, floor: 1, ceil: 2.5 },
    G: { ...room, floor: 1, ceil: 2.5, door: { tex: 'w_door', tag: 5 } },
    o: { ...room, floor: 1, ceil: 3.2 },
    T: { floor: 1, ceil: 3.5, ft: 'f_lift', ct: 'c_panel', wt: 'w_hazard', light: 0.8, lift: { low: 1, high: 2, tag: 6 } },
    n: { ...room, floor: 2, ceil: 3.5 },
    O: { ...room, floor: 2, ceil: 3.5, door: { tex: 'w_door', tag: BOSS_TAG } },
    W: { solid: true, wall: 'w_switch_off', switch: { tag: 5 } },
    X: { solid: true, wall: 'w_switch_off', switch: { tag: 6 } },
    E: { solid: true, wall: 'w_exit_off', exit: true },
  },
  tagMessages: { 5: 'A gate opened.' },
};

// ---------------------------------------------------------------- helpers

function newGame(levels = [FIXTURE, FIXTURE], seed = 1, index = 0) {
  const g = new Game({ levels, difficulty: 1, seed });
  g.loadLevel(index);
  g.log = [];
  return g;
}

function run(g, seconds, fn) {
  const steps = Math.round(seconds / STEP_DT);
  for (let i = 0; i < steps; i++) {
    const inp = neutralInput();
    if (fn && fn(inp, g, i) === false) break;
    g.step(STEP_DT, inp);
    for (const e of g.events) g.log.push(e);
    g.events.length = 0;
  }
}

function place(g, x, y, yaw = 0) {
  const p = g.player;
  p.x = x; p.y = y; p.yaw = yaw;
  p.z = g.world.cellAt(x, y).floor;
  p.vx = p.vy = p.vz = 0;
  p.onGround = true;
  g.lastCell = g.world.cellAt(x, y);
}

const forward = (inp) => { inp.moveY = 1; };
const groupAt = (g, x, y) => { const c = g.world.cell(x, y); return (c.door || c.lift).group; };
const has = (g, pred) => g.log.some(pred);

function noEnemies(g) { g.enemies.length = 0; }

function finite(...v) { return v.every((n) => Number.isFinite(n)); }

// ---------------------------------------------------------------- assertions

function fixtureTests() {
  console.log('fixture');
  let g = newGame();
  check(g.stats.totalKills === 5 && g.stats.totalItems === 16 && g.stats.totalSecrets === 1,
    `totals kills ${g.stats.totalKills}, items ${g.stats.totalItems}, secrets ${g.stats.totalSecrets}`);

  // Movement feel.
  g = newGame(); noEnemies(g);
  place(g, 3.5, 2.5, 0);
  let t90 = -1, tt = 0;
  run(g, 0.5, (inp, gg) => { tt += STEP_DT; inp.moveY = 1; if (t90 < 0 && gg.player.vx > 0.9 * 3.4) t90 = tt; });
  check(t90 > 0 && t90 < 0.2, `accelerates to 90% speed in ${t90.toFixed(3)} s`);
  tt = 0;
  let tstop = -1;
  run(g, 0.5, (inp, gg) => { tt += STEP_DT; if (tstop < 0 && Math.hypot(gg.player.vx, gg.player.vy) < 0.05) tstop = tt; });
  check(tstop > 0 && tstop < 0.25, `friction stops in ${tstop.toFixed(3)} s`);
  place(g, 4.5, 2.5, Math.PI * 0.75);
  run(g, 1.2, (inp) => { inp.moveY = 1; });
  check(g.player.y > 3.6 && Math.abs(g.player.y - (4 - 0.28)) < 0.01, `pressed against the wall (y ${g.player.y.toFixed(3)})`);
  place(g, 4.5, 3.7, Math.PI * 0.75);
  const x0 = g.player.x;
  run(g, 0.5, (inp) => { inp.moveY = 1; });
  const sv = (x0 - g.player.x) / 0.5;
  check(sv > 2.0, `slides along a wall at ${sv.toFixed(2)} u/s when walking into it at 45 degrees`);
  place(g, 2.5, 3.5, Math.PI * 0.75);
  run(g, 1, (inp) => { inp.moveY = 1; });
  check(g.player.x > 1.27 && g.player.x < 1.3 && g.player.y > 3.7, 'settles into a corner without passing it');
  // Step up eases the eye; walking off a ledge falls.
  g = newGame(); noEnemies(g);
  place(g, 19.5, 1.5, Math.PI / 2);
  let maxJump = 0, lastEye = g.player.eyeZ;
  run(g, 1, (inp, gg) => { inp.moveY = 1; maxJump = Math.max(maxJump, Math.abs(gg.player.eyeZ - lastEye)); lastEye = gg.player.eyeZ; });
  check(Math.abs(g.player.z - 0.3) < 1e-6 && maxJump < 0.06, `step up 0.3 lands on top, eye moves at most ${maxJump.toFixed(3)} per step`);
  place(g, 25.4, 2.5, Math.PI);
  const zs = [];
  run(g, 0.7, (inp, gg) => { if (gg.player.x > 24.5) inp.moveY = 1; zs.push(gg.player.z); });
  const fallStart = zs.findIndex((z) => z < 0.999);
  const fallEnd = zs.findIndex((z) => z < 0.001);
  check(fallStart >= 0 && fallEnd - fallStart > 10, `walking off a 1.0 ledge falls over ${fallEnd - fallStart} steps`);

  // Plain door by bumping.
  noEnemies(g);
  place(g, 5.4, 2.5, 0);
  run(g, 2.5, forward);
  check(g.player.x > 7.2, `plain door opens on bump and lets the player through (x ${g.player.x.toFixed(2)})`);
  check(has(g, (e) => e.type === 'sound' && e.id === 'door_open' && e.x !== undefined), 'door_open sound with position');
  run(g, 6);
  check(groupAt(g, 6, 2).state === 'closed', 'plain door closes again after the player left');

  // Key door.
  g = newGame(); noEnemies(g);
  place(g, 11.4, 2.5, 0);
  run(g, 1, forward);
  check(groupAt(g, 12, 2).state === 'closed' && has(g, (e) => e.type === 'message' && /amber/.test(e.text)),
    'amber door refuses without the key and says why');
  check(g.log.filter((e) => e.id === 'locked').length === 1, 'locked sound is not spammed while pushing');
  place(g, 9.5, 2.5, Math.PI / 2);
  run(g, 0.6, forward);
  check(g.player.keys.amber, 'walking over the amber key picks it up');
  place(g, 11.4, 2.5, 0);
  run(g, 2, forward);
  check(g.player.x > 13, `amber door opens with the key (x ${g.player.x.toFixed(2)})`);

  // Tagged door refuses, switch fires its tag.
  g = newGame(); noEnemies(g);
  place(g, 29.4, 2.5, 0);
  run(g, 0.5, forward);
  check(groupAt(g, 30, 2).state === 'closed' && has(g, (e) => e.text === 'Opens elsewhere.'), 'tag door refuses use');
  place(g, 3.5, 1.5, -Math.PI / 2);
  const v0 = g.world.version;
  run(g, 0.1, (inp, gg, i) => { inp.use = i === 0; });
  check(g.world.cell(3, 0).switch.on && g.world.version > v0 && g.world.cell(3, 0).wall === 'w_switch_on', 'USE flips the switch');
  check(groupAt(g, 30, 2).state === 'opening' && has(g, (e) => e.text === 'A gate opened.'), 'switch fires tag 5 and shows its message');

  // Trigger cell.
  g = newGame(); noEnemies(g);
  place(g, 13.5, 2.5, 0);
  run(g, 0.5, forward);
  check(groupAt(g, 18, 2).state !== 'closed', 'trigger cell opens the tag 7 door');

  // Untagged lift.
  g = newGame(); noEnemies(g);
  place(g, 23.5, 2.5, 0);
  run(g, 1.2, (inp, gg) => { if (gg.player.x < 24.5) inp.moveY = 1; });
  run(g, 2);
  check(Math.abs(g.player.z - 1) < 0.01, `lift carries the player up (z ${g.player.z.toFixed(2)})`);
  run(g, 1.5, forward);
  check(g.player.x > 25.3 && Math.abs(g.player.z - 1) < 0.01, 'player steps off the lift on the upper floor');
  run(g, 6);
  check(g.world.cell(24, 2).floor === 0, 'lift returns home after the player left');

  // Tagged lift via its switch.
  g = newGame(); noEnemies(g);
  place(g, 36.5, 1.5, -Math.PI / 2);
  run(g, 0.1, (inp, gg, i) => { inp.use = i === 0; });
  run(g, 1.5);
  check(Math.abs(g.player.z - 2) < 0.01, `tagged lift rises when its switch fires (z ${g.player.z.toFixed(2)})`);

  // Secret door and secret count.
  g = newGame(); noEnemies(g);
  place(g, 15.5, 3.5, Math.PI / 2);
  run(g, 0.1, (inp, gg, i) => { inp.use = i === 0; });
  run(g, 2.5, forward);
  check(g.stats.secrets === 1 && has(g, (e) => e.type === 'secret'), 'secret door opens on use and the secret is counted once');
  check(g.player.keys.cyan, 'cyan key in the secret alcove picked up');
  run(g, 2, (inp) => { inp.moveY = -1; });
  run(g, 2, forward);
  check(g.stats.secrets === 1, 're-entering does not count the secret again');
  check(groupAt(g, 15, 4).state === 'open', 'secret door stays open');

  // Damaging floor.
  g = newGame(); noEnemies(g);
  place(g, 16.5, 1.5, 0);
  run(g, 2);
  check(g.player.health < 85 && g.player.health > 75 && has(g, (e) => e.id === 'floor_burn'),
    `damaging floor hurts (health ${g.player.health.toFixed(1)})`);

  // Pickups in the start room.
  g = newGame(); noEnemies(g);
  g.player.health = 50;
  for (const x of [1, 2, 3, 4, 5]) for (const y of [1, 3]) { place(g, x + 0.5, y + 0.5); run(g, 0.05); }
  const p = g.player;
  check(p.ammo.rivets === 110 && p.ammo.shells === 24 && p.ammo.canisters === 6, `ammo pickups (${JSON.stringify(p.ammo)})`);
  check(p.health === 85 && p.armor === 100, `health and armor pickups (health ${p.health}, armor ${p.armor})`);
  check(g.stats.items === 10, `items counted (${g.stats.items})`);
  place(g, 8.5, 1.5); run(g, 0.4);
  check(p.weapons[2] && (p.pending === 2 || p.weapon === 2), 'new weapon pickup auto-switches');
  run(g, 0.5);
  check(p.weapon === 2, 'scattergun raised');

  // Each weapon can kill.
  for (let slot = 0; slot < 5; slot++) {
    g = newGame(); noEnemies(g);
    const q = g.player;
    q.weapons = [true, true, true, true, true];
    q.ammo = { rivets: 200, shells: 50, canisters: 20 };
    q.weapon = slot;
    const dist = slot === 0 ? 0.9 : 3.5;
    place(g, 19.5, 2.5, 0);
    const e = createEnemy(g, 'gunner', 19.5 + dist, 2.5, 0);
    e.def = { ...e.def, painChance: 0 };
    g.enemies.push(e);
    let t = 0;
    run(g, 12, (inp, gg) => {
      t += STEP_DT;
      if (!e.alive) return false;
      gg.player.yaw = Math.atan2(e.y - gg.player.y, e.x - gg.player.x);
      inp.fire = true;
      return true;
    });
    check(!e.alive, `${WEAPONS[slot].id} kills a gunner (${t.toFixed(1)} s, health left ${q.health.toFixed(0)})`);
    if (slot === 4) check(has(g, (ev) => ev.id === 'explode'), 'launcher canister explodes');
  }

  // Launcher splash hurts the player.
  g = newGame(); noEnemies(g);
  g.player.weapons[4] = true; g.player.ammo.canisters = 5; g.player.weapon = 4;
  place(g, 22.5, 2.5, -Math.PI / 2);
  run(g, 0.5, (inp) => { inp.fire = true; });
  check(g.player.health < 100, `own launcher splash hurts (health ${g.player.health.toFixed(0)})`);

  // Out of ammo switches away; wrench always available.
  g = newGame(); noEnemies(g);
  g.player.ammo.rivets = 2;
  place(g, 3.5, 2.5, Math.PI);
  run(g, 2, (inp) => { inp.fire = true; });
  check(g.player.weapon === 0 && g.player.ammo.rivets === 0, 'empty rivet gun switches to the wrench');

  // Drum explodes and chains.
  g = newGame(); noEnemies(g);
  const d1 = g.props.find((pp) => pp.type === 'drum');
  g.props.push({ ...d1, x: d1.x + 1.2, dead: false, fuse: -1, hp: d1.def.hp });
  const victim = createEnemy(g, 'scrapper', d1.x + 0.6, d1.y - 0.9, 0);
  g.enemies.push(victim);
  place(g, 19.5, 2.5, Math.atan2(d1.y - 2.5, d1.x - 19.5));
  run(g, 1.5, (inp) => { inp.fire = true; });
  check(g.props.filter((pp) => pp.type === 'drum' && pp.dead).length === 2, 'shot drum explodes and sets off its neighbour');
  check(!victim.alive, 'drum blast kills a nearby scrapper');

  // Enemies wake, approach and hurt.
  g = newGame();
  g.enemies = g.enemies.filter((e) => e.type === 'scrapper');
  const sc = g.enemies[0];
  place(g, 7.5, 2.5, Math.PI);
  const d0 = Math.hypot(sc.x - 7.5, sc.y - 2.5);
  run(g, 4);
  check(sc.state !== 'idle' && has(g, (e) => e.id === 'scrapper_alert'), 'scrapper wakes on sight');
  check(g.player.health < 100, `scrapper approaches (from ${d0.toFixed(1)}) and hurts (health ${g.player.health.toFixed(0)})`);

  g = newGame();
  g.enemies = g.enemies.filter((e) => e.type === 'gunner');
  g.world.fireTag(7);
  place(g, 17.5, 2.5, Math.PI);
  run(g, 0.5, (inp) => { inp.fire = true; });     // gunfire noise behind a door wakes it
  check(g.enemies[0].state !== 'idle', 'gunner wakes on gunfire noise');
  run(g, 6);
  check(g.player.health < 100, `gunner hurts the player (health ${g.player.health.toFixed(0)})`);

  g = newGame();
  g.enemies = g.enemies.filter((e) => e.type === 'spitter');
  g.world.fireTag(7);
  place(g, 17.5, 2.5, 0);
  run(g, 8);
  check(has(g, (e) => e.id === 'slag_spit') && g.player.health < 100, `spitter lobs slag and hurts (health ${g.player.health.toFixed(0)})`);

  g = newGame();
  g.enemies = g.enemies.filter((e) => e.type === 'hauler');
  place(g, 25.5, 1.5, 0);
  run(g, 8);
  check(g.player.health < 100, `hauler hurts (health ${g.player.health.toFixed(0)})`);

  // Overseer: volleys, spawns, tag 99 on death.
  g = newGame();
  g.enemies = g.enemies.filter((e) => e.type === 'overseer');
  g.player.god = true;
  const boss = g.enemies[0];
  place(g, 31.5, 2.5, 0);
  run(g, 30);
  const kids = g.enemies.filter((e) => e.spawned);
  check(has(g, (e) => e.id === 'bolt_shot'), 'overseer fires bolt volleys');
  check(kids.length > 0 && kids.length <= 2, `overseer spawns scrappers, capped (${kids.length})`);
  hurtEnemy(g, boss, 99999, g.player);
  run(g, 2);
  check(boss.state === 'dead' && groupAt(g, 38, 1).state !== 'closed', 'last overseer dying fires tag 99');

  // Exit ends the level; last level gives victory.
  g = newGame(); noEnemies(g);
  g.world.fireTag(BOSS_TAG);
  run(g, 2);
  place(g, 37.5, 1.5, 0);
  run(g, 2, forward);
  check(g.state === 'levelEnd' && has(g, (e) => e.type === 'levelEnd') && g.world.cell(39, 1).wall === 'w_exit_on', 'exit ends the level');
  g = newGame([FIXTURE, FIXTURE], 1, 1); noEnemies(g);
  place(g, 3.5, 1.5, -Math.PI / 2);
  g.world.cell(3, 0).exit = true; g.world.cell(3, 0).switch = null;
  run(g, 0.1, (inp) => { inp.use = true; });
  check(g.state === 'victory', 'exit on the last level gives victory');

  // Death.
  g = newGame(); noEnemies(g);
  g.hurtPlayer(500, 0, 0);
  run(g, 1);
  check(g.state === 'dead' && has(g, (e) => e.type === 'playerDied'), 'death sets state dead');

  // Loadout carries.
  g = newGame(); noEnemies(g);
  Object.assign(g.player, { health: 63, armor: 20, weapon: 2 });
  g.player.weapons[2] = true; g.player.ammo.shells = 17;
  const carry = JSON.parse(JSON.stringify(g.getLoadout()));
  g.loadLevel(1, carry);
  const pp = g.player;
  check(pp.health === 63 && pp.armor === 20 && pp.ammo.shells === 17 && pp.weapons[2] && pp.weapon === 2, 'loadout carries into the next level');

  // Scene shape.
  g = newGame();
  place(g, 23.5, 2.5, Math.PI);
  run(g, 2, (inp) => { inp.fire = true; inp.moveX = 0.5; });
  const sc2 = g.getScene();
  const badFrames = sc2.sprites.filter((s) => !SPRITE_SIZES[s.frame]).map((s) => s.frame);
  check(badFrames.length === 0 && SPRITE_SIZES[sc2.weapon.frame], `scene frames are all atlas frames ${badFrames.slice(0, 3)}`);
  const badSounds = g.log.filter((e) => e.type === 'sound' && !SOUND_IDS.includes(e.id)).map((e) => e.id);
  check(badSounds.length === 0, `sound ids are all in SOUND_IDS ${[...new Set(badSounds)]}`);
  check(sc2.sprites.every((s) => finite(s.x, s.y, s.z, s.light)) && finite(sc2.cam.x, sc2.cam.y, sc2.cam.z, sc2.cam.yaw, sc2.weapon.dx, sc2.weapon.dy),
    'scene numbers are finite');
}

// ---------------------------------------------------------------- fuzz

function fuzz(level, seeds, label) {
  const problems = [];
  let deaths = 0;
  for (const seed of seeds) {
    const g = new Game({ levels: [level], difficulty: seed % 3, seed });
    g.loadLevel(0);
    g.player.god = seed % 2 === 0;
    let hold = neutralInput(), holdT = 0, rs = seed * 7919;
    const rnd = () => { rs = (rs * 1103515245 + 12345) >>> 0; return rs / 4294967296; };
    let firstBad = null;
    try {
      for (let i = 0; i < 120 / STEP_DT; i++) {
        holdT -= STEP_DT;
        if (holdT <= 0) {
          holdT = 0.1 + rnd() * 0.6;
          hold = neutralInput();
          hold.moveX = rnd() * 2 - 1; hold.moveY = rnd() * 2.4 - 1;
          hold.fire = rnd() < 0.4;
          hold.isTouch = rnd() < 0.5;
          hold.turnRate = (rnd() * 2 - 1) * 4;
        }
        const inp = { ...hold, turn: hold.turnRate * STEP_DT, use: rnd() < 0.03, weaponSlot: rnd() < 0.01 ? Math.floor(rnd() * 5) : -1, weaponNext: rnd() < 0.01 };
        g.step(STEP_DT, inp);
        g.events.length = 0;
        g.getScene();
        const p = g.player;
        const c = g.world.cellAt(p.x, p.y);
        let bad = null;
        if (!finite(p.x, p.y, p.z, p.eyeZ, p.yaw, p.health)) bad = 'NaN in player';
        else if (c.solid) bad = `player inside solid cell ${c.cx},${c.cy}`;
        else if (g.world.stuck(p, p.x, p.y)) bad = `player overlaps a blocking cell at ${p.x.toFixed(2)},${p.y.toFixed(2)} z ${p.z.toFixed(2)}`;
        for (const e of g.enemies) {
          if (bad) break;
          const ec = g.world.cellAt(e.x, e.y);
          if (!finite(e.x, e.y, e.z)) bad = `NaN in ${e.type}`;
          else if (ec.solid) bad = `${e.type} inside solid cell ${ec.cx},${ec.cy}`;
          else if (ec.damage > 0) bad = `${e.type} on a damaging floor ${ec.cx},${ec.cy}`;
        }
        if (bad && !firstBad) firstBad = `seed ${seed} t ${(i * STEP_DT).toFixed(2)}: ${bad}`;
        if (g.state === 'dead') { deaths++; g.loadLevel(0); }
        else if (g.state !== 'playing') g.loadLevel(0);
      }
    } catch (err) {
      firstBad = `seed ${seed}: exception ${err.stack}`;
    }
    if (firstBad) problems.push(firstBad);
  }
  check(problems.length === 0, `${label}: fuzz ${seeds.length} seeds x 120 s (${deaths} deaths) ${problems.join('; ')}`);
}

// ---------------------------------------------------------------- walker

// Cells the player can walk between: open, enough headroom, a step up within STEP_HEIGHT.
// Lifts count at either end. Closed doors count when bumping opens them.
function walkable(g, c) {
  if (c.solid || c.propBlocked) return false;
  if (c.door) {
    const d = c.door;
    if (d.group.state === 'open' || d.group.state === 'opening') return true;
    if (d.tag) return false;
    if (d.key && !g.player.keys[d.key]) return false;
    return true;
  }
  return c.ceil0 - c.floor >= PLAYER_HEIGHT;
}
function heights(c) {
  return c.lift && !c.lift.tag ? [c.lift.low, c.lift.high] : [c.floor];
}
function canPass(g, a, b) {
  if (!walkable(g, b)) return false;
  for (const ha of heights(a)) for (const hb of heights(b)) if (hb - ha <= STEP_HEIGHT + 1e-6) return true;
  return false;
}

function bfs(g, from) {
  const w = g.world;
  const prev = new Map([[from, null]]);
  const q = [from];
  while (q.length) {
    const a = q.shift();
    for (const b of w.neighbours(a)) {
      if (prev.has(b) || !canPass(g, a, b)) continue;
      prev.set(b, a);
      q.push(b);
    }
  }
  return prev;
}

function pathTo(prev, c) {
  const out = [];
  for (let x = c; x; x = prev.get(x)) out.push(x);
  return out.reverse();
}

function objectives(g) {
  const w = g.world;
  const out = [];
  for (const it of g.items) if (!it.taken && it.kind === 'key' && !g.player.keys[it.type]) out.push({ kind: 'key', cell: w.cellAt(it.x, it.y) });
  for (const c of w.cells) {
    if (c.trigger && !c.triggered) out.push({ kind: 'trigger', cell: c });
    if (c.switch && !c.switch.on) out.push({ kind: 'switch', wall: c });
    if (c.exit) out.push({ kind: 'exit', wall: c });
  }
  return out;
}

function walker(level, label, maxTime = 900) {
  const g = new Game({ levels: [level], difficulty: 1, seed: 3 });
  g.loadLevel(0);
  g.player.god = true;
  const w = g.world;
  for (const pr of g.props) if (pr.blocking) pr.cell.propBlocked = true;
  const ignore = new Map();
  let path = null, goal = null, replan = 0, lastProgress = 0, best = Infinity, stuckT = 0, log = [];
  const p = g.player;
  try {
    for (let i = 0; i < maxTime / STEP_DT && g.state === 'playing'; i++) {
      const inp = neutralInput();
      p.ammo.rivets = Math.max(p.ammo.rivets, 100);
      p.ammo.shells = Math.max(p.ammo.shells, 20);
      if (p.weapons[4]) p.ammo.canisters = Math.max(p.ammo.canisters, 5);
      const here = w.cellAt(p.x, p.y);

      // Shoot visible enemies nearby.
      let foe = null, fd = 9;
      for (const pr of g.props) if (pr.dead) pr.cell.propBlocked = false;
      for (const e of g.enemies) {
        if (!e.alive || (ignore.get(e) || 0) > g.time) continue;
        const d = Math.hypot(e.x - p.x, e.y - p.y);
        if (d < fd && w.los(p.x, p.y, p.eyeZ, e.x, e.y, e.z + e.hover + e.def.height * 0.5)) { fd = d; foe = e; }
      }
      if (foe) {
        // Give up on a foe the shots do not reach.
        if (foe !== walker.foe || foe.hp < walker.foeHp) { walker.foe = foe; walker.foeHp = foe.hp; walker.foeT = g.time; }
        if (g.time - walker.foeT > 5) { ignore.set(foe, g.time + 15); walker.foe = null; }
        const want = Math.atan2(foe.y - p.y, foe.x - p.x);
        inp.turn = Math.atan2(Math.sin(want - p.yaw), Math.cos(want - p.yaw));
        inp.fire = Math.abs(inp.turn) < 0.3;
        if (fd < 1.6 && p.weapon === 4) inp.weaponSlot = p.weapons[2] ? 2 : 1;
        else if (fd > 3 && p.weapons[4] && p.weapon !== 4) inp.weaponSlot = 4;
        else if (!p.weapons[4] && p.weapons[2] && p.weapon !== 2) inp.weaponSlot = 2;
        lastProgress = g.time;
        g.step(STEP_DT, inp);
        g.events.length = 0;
        continue;
      }

      replan -= STEP_DT;
      if (!path || replan <= 0) {
        replan = 0.5;
        const prev = bfs(g, here);
        const goals = objectives(g);
        let pick = null;
        for (const o of goals) {
          let target = null;
          if (o.cell) { if (prev.has(o.cell)) target = o.cell; }
          else {
            for (const nb of w.neighbours(o.wall)) {
              if (prev.has(nb) && (!target || pathTo(prev, nb).length < pathTo(prev, target).length)) target = nb;
            }
          }
          if (!target) continue;
          const len = pathTo(prev, target).length;
          const score = o.kind === 'exit' ? -1 : len;
          if (!pick || score < pick.score) pick = { ...o, target, score };
        }
        if (!pick) {
          // Nothing reachable: hunt the nearest reachable enemy.
          for (const e of g.enemies) {
            const c = w.cellAt(e.x, e.y);
            if (e.alive && prev.has(c)) {
              const len = pathTo(prev, c).length;
              if (!pick || len < pick.score) pick = { kind: 'enemy', target: c, score: len };
            }
          }
        }
        if (!pick) {
          if (!goal || goal.kind !== 'none') log.push(`t ${g.time.toFixed(1)} no reachable objective from ${here.cx},${here.cy}`);
          goal = { kind: 'none' };
          path = [];
        } else {
          if (!goal || goal.kind !== pick.kind || goal.target !== pick.target) {
            log.push(`t ${g.time.toFixed(1)} -> ${pick.kind} at ${(pick.wall || pick.target).cx},${(pick.wall || pick.target).cy}`);
            best = Infinity;
          }
          goal = pick;
          path = pathTo(prev, pick.target);
        }
      }

      // Follow the path: the first cell we are not already in.
      let next = null;
      for (let k = 0; k < path.length; k++) if (path[k] === here) { next = path[k + 1] || null; break; }
      if (!next && path.length && path[0] !== here) next = path[0];
      let tx, ty;
      if (next) { tx = next.cx + 0.5; ty = next.cy + 0.5; }
      else if (goal && goal.wall) { tx = goal.wall.cx + 0.5; ty = goal.wall.cy + 0.5; inp.use = (i % 20) === 0; }
      else if (goal && goal.target) { tx = goal.target.cx + 0.5; ty = goal.target.cy + 0.5; }
      if (tx !== undefined) {
        // Waiting for a lift to arrive at our height.
        const blocked = next && next.floor - p.z > STEP_HEIGHT + 1e-6;
        const onLift = here.lift && here.lift.group.pos !== here.lift.group.target;
        if (blocked && (here.lift || next.lift)) {
          if (next.lift && !here.lift && next.lift.group.pos === next.lift.group.target) w.callLift(next);
        } else if (!onLift) {
          const want = Math.atan2(ty - p.y, tx - p.x);
          inp.turn = Math.atan2(Math.sin(want - p.yaw), Math.cos(want - p.yaw));
          inp.moveY = Math.abs(inp.turn) < 0.8 ? 1 : 0.2;
          if (goal && goal.wall && !next) {
            inp.moveY = Math.hypot(tx - p.x, ty - p.y) > 0.75 ? 0.6 : 0;
            inp.use = Math.abs(inp.turn) < 0.3 && (i % 15) === 0;
          }
        }
        const d = (goal.target ? Math.hypot(goal.target.cx + 0.5 - p.x, goal.target.cy + 0.5 - p.y) : 0) + path.length;
        if (d < best - 0.05) { best = d; lastProgress = g.time; }
      }
      if (g.time - lastProgress > 12) {
        stuckT += 1;
        lastProgress = g.time;
        best = Infinity;
        log.push(`t ${g.time.toFixed(1)} no progress at ${p.x.toFixed(2)},${p.y.toFixed(2)} z ${p.z.toFixed(2)} goal ${goal && goal.kind} next ${next ? next.cx + ',' + next.cy : '-'}`);
        if (args.includes('--verbose')) {
          for (const e of g.enemies) if (e.alive && Math.hypot(e.x - p.x, e.y - p.y) < 3) log.push(`        near: ${e.type} ${e.state} ${e.x.toFixed(2)},${e.y.toFixed(2)}`);
        }
        if (stuckT > 6) break;
      }
      g.step(STEP_DT, inp);
      g.events.length = 0;
    }
  } catch (err) {
    log.push(`exception ${err.stack}`);
  }
  const ok = g.state === 'levelEnd' || g.state === 'victory';
  check(ok, `${label}: walker ${ok ? 'reached the exit' : 'did not reach the exit'} in ${g.time.toFixed(1)} s simulated, kills ${g.stats.kills}/${g.stats.totalKills}, secrets ${g.stats.secrets}/${g.stats.totalSecrets}`);
  if (!ok || args.includes('--verbose')) for (const l of log.slice(-25)) console.log(`        ${l}`);
}

// ---------------------------------------------------------------- main

async function realLevels() {
  const out = [];
  for (const id of ['l1', 'l2', 'l3', 'l4']) {
    if (onlyLevel && id !== onlyLevel) continue;
    const file = join(ROOT, 'src', 'levels', `${id}.js`);
    if (!existsSync(file)) { console.log(`  skip  ${id}: src/levels/${id}.js does not exist yet`); continue; }
    try {
      const mod = await import(pathToFileURL(file).href);
      out.push(build(mod.default));
    } catch (err) {
      failures++;
      console.log(`  FAIL  ${id}: could not load (${err.message})`);
    }
  }
  return out;
}

if (!onlyLevel) {
  fixtureTests();
  if (!quick) {
    console.log('fixture fuzz and walker');
    fuzz(FIXTURE, [1, 2, 3, 4, 5, 6], 'fixture');
    walker(FIXTURE, 'fixture');
  }
}
if (!quick) {
  console.log('real levels');
  for (const level of await realLevels()) {
    fuzz(level, [1, 2, 3, 4], level.id);
    walker(level, level.id);
  }
}
console.log(failures ? `${failures} failure(s)` : 'all passed');
process.exit(failures ? 1 : 0);
