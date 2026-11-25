// Boot, state machine and frame loop.
//
// States: loading, title, playing, paused, intermission, dead, victory.
// Testing hooks: window.__game exposes the current game and state; URL parameters
//   ?autostart=1&level=2&difficulty=1   start straight into level 2 (1-based) on Journeyman
//   ?god=1                              the player takes no damage

import { STEP_DT, MAX_STEPS_PER_FRAME, neutralInput, WEAPON_IDS } from './config.js';
import { buildTextures } from './assets/textures.js';
import { buildSprites } from './assets/sprites.js';
import levels from './levels/index.js';
import { Game } from './game/game.js';
import { createRenderer } from './render/renderer.js';
import { createAudio } from './audio.js';
import { createInput } from './input.js';
import { createHud } from './ui/hud.js';
import { createMenus, loadSettings, loadSave, saveSave, clearSave } from './ui/menus.js';

const DEATH_DELAY = 1.6;     // seconds of the death animation before the dead screen
const EXIT_DELAY = 0.7;      // seconds between using the exit and the intermission

const params = new URLSearchParams(location.search);
const viewEl = document.getElementById('view');
const canvas = document.getElementById('gl');

let mode = 'loading';
let game = null;
let difficulty = 1;
let levelCarry = null;       // loadout at the start of the current level, for restarts
let run = null;              // stats summed over finished levels
let endTimer = 0;            // counts down after death or the exit
let renderer = null;
let audio = null;
let input = null;
let hud = null;
let settings = loadSettings();
let frames = 0;
let workMs = 0;              // CPU time spent in steps and render, summed (for the frame-time test)
let dirty = true;            // render once more while not running (resize, pause)

const menus = createMenus(document.getElementById('menu'), {
  onNewGame: (d) => newGame(d, 0),
  onContinue: continueGame,
  onResume: resume,
  onRestartLevel: () => startLevel(game.levelIndex, levelCarry),
  onQuit: quit,
  onNextLevel: () => startLevel(game.levelIndex + 1, levelCarry),
  onSettings: (s) => { settings = s; applySettings(); },
  onSound: (id) => audio && audio.play(id),
});

window.__game = {
  get game() { return game; },
  get state() { return mode; },
  get frames() { return frames; },
  get workMs() { return workMs; },
  get renderer() { return renderer; },
  get input() { return input; },
  get audio() { return audio; },
  get menus() { return menus; },
  startLevel: (i, carry) => startLevel(i, carry),
};

// ---------------------------------------------------------------- boot

const nextFrame = () => new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0)));

async function boot() {
  menus.show('loading', { text: 'Casting textures', progress: 0.05 });
  await nextFrame();
  const textures = buildTextures();
  menus.show('loading', { text: 'Assembling machines', progress: 0.45 });
  await nextFrame();
  const sprites = buildSprites();
  menus.show('loading', { text: 'Powering up', progress: 0.85 });
  await nextFrame();

  renderer = createRenderer(canvas, { textures, sprites });
  audio = createAudio();
  input = createInput(document.getElementById('touch'), {
    view: viewEl, sensitivity: settings.sensitivity, leftHanded: settings.leftHanded,
  });
  hud = createHud(document.getElementById('hud'));
  hud.setVisible(false);
  applySettings();
  fit();

  for (const ev of ['touchend', 'click', 'keydown']) document.addEventListener(ev, unlockAudio, true);
  window.addEventListener('resize', fit);
  window.addEventListener('orientationchange', () => { fit(); setTimeout(fit, 300); });
  if (window.visualViewport) window.visualViewport.addEventListener('resize', fit);
  if (window.ResizeObserver) new ResizeObserver(fit).observe(viewEl);
  document.addEventListener('visibilitychange', () => { if (document.hidden) pause(); });
  window.addEventListener('pagehide', pause);

  if (params.get('autostart') === '1') {
    const level = Math.min(levels.length, Math.max(1, Number(params.get('level')) || 1)) - 1;
    newGame(Math.min(2, Math.max(0, Number(params.get('difficulty') ?? 1) || 0)), level);
  } else {
    toTitle();
  }
  requestAnimationFrame(loop);
}

function unlockAudio() {
  audio.unlock();
  for (const ev of ['touchend', 'click', 'keydown']) document.removeEventListener(ev, unlockAudio, true);
}

function applySettings() {
  if (!renderer) return;
  input.setSensitivity(settings.sensitivity);
  input.setLayout({ leftHanded: settings.leftHanded });
  audio.setSfxVolume(settings.sfx);
  audio.setMusicVolume(settings.music);
  renderer.setQuality(settings.quality);
  dirty = true;
}

function fit() {
  if (!renderer) return;
  const box = viewEl.getBoundingClientRect();
  renderer.resize(box.width, box.height);
  dirty = true;
}

// ---------------------------------------------------------------- states

function setMode(next) {
  mode = next;
  input.setEnabled(next === 'playing');
  hud.setVisible(game !== null && next !== 'title' && next !== 'victory');
  dirty = true;
}

function toTitle() {
  game = null;
  setMode('title');
  audio.setMusic(null);
  menus.show('title');
}

// A test loadout for starting past level 1 through the URL hook: every weapon, some ammo.
function testLoadout() {
  return {
    health: 100, armor: 50, ammo: { rivets: 150, shells: 30, canisters: 10 },
    weapons: WEAPON_IDS.map(() => true), weapon: 1,
  };
}

function newGame(d, level) {
  difficulty = d;
  run = { kills: 0, totalKills: 0, items: 0, totalItems: 0, secrets: 0, totalSecrets: 0, time: 0 };
  game = new Game({ levels, difficulty, seed: (Math.random() * 0x7fffffff) | 0 });
  startLevel(level, level > 0 ? testLoadout() : undefined);
}

function continueGame() {
  const save = loadSave();
  if (!save) return toTitle();
  difficulty = save.difficulty;
  run = save.run || { kills: 0, totalKills: 0, items: 0, totalItems: 0, secrets: 0, totalSecrets: 0, time: 0 };
  game = new Game({ levels, difficulty, seed: (Math.random() * 0x7fffffff) | 0 });
  startLevel(Math.min(save.levelIndex, levels.length - 1), save.loadout);
}

function startLevel(index, carry) {
  game.loadLevel(index, carry);
  if (params.get('god') === '1') game.player.god = true;
  levelCarry = game.getLoadout();
  saveSave({ levelIndex: index, difficulty, loadout: levelCarry, run });
  renderer.setWorld(game.world);
  audio.setMusic(game.level.music);
  endTimer = 0;
  menus.hide();
  setMode('playing');
}

function pause() {
  if (mode !== 'playing') return;
  setMode('paused');
  menus.show('pause');
}

function resume() {
  if (!game) return;
  menus.hide();
  setMode('playing');
}

function quit() {
  game = null;
  setMode('title');
  audio.setMusic(null);
}

function addRun(stats) {
  for (const k of Object.keys(run)) run[k] += stats[k];
}

function finishLevel() {
  addRun(game.stats);
  if (game.state === 'victory') {
    clearSave();
    setMode('victory');
    menus.show('victory', { stats: run, difficulty });
    return;
  }
  levelCarry = game.getLoadout();
  saveSave({ levelIndex: game.levelIndex + 1, difficulty, loadout: levelCarry, run });
  setMode('intermission');
  menus.show('intermission', { name: game.level.name, stats: game.stats, par: game.level.par });
}

// ---------------------------------------------------------------- loop

let last = 0;
let acc = 0;
let pending = neutralInput();   // edges and turn not yet handed to a step

function merge(into, s) {
  into.moveX = s.moveX;
  into.moveY = s.moveY;
  into.fire = s.fire;
  into.isTouch = s.isTouch;
  into.turn += s.turn;
  into.use = into.use || s.use;
  into.weaponNext = into.weaponNext || s.weaponNext;
  into.weaponPrev = into.weaponPrev || s.weaponPrev;
  if (s.weaponSlot >= 0) into.weaponSlot = s.weaponSlot;
}

function clearEdges(s) {
  s.turn = 0;
  s.use = s.weaponNext = s.weaponPrev = false;
  s.weaponSlot = -1;
}

function loop(now) {
  requestAnimationFrame(loop);
  const dt = Math.min(0.25, Math.max(0, (now - last) / 1000));
  last = now;
  if (!game) return;
  const t0 = performance.now();

  const running = mode === 'playing' || mode === 'dead';
  if (running) {
    if (mode === 'playing') {
      const s = input.sample();
      if (s.pause) return pause();
      if (s.map) hud.toggleMap();
      merge(pending, s);
    } else {
      Object.assign(pending, neutralInput());
    }

    acc += dt;
    let steps = 0;
    while (acc >= STEP_DT && steps < MAX_STEPS_PER_FRAME) {
      game.step(STEP_DT, pending);
      clearEdges(pending);
      acc -= STEP_DT;
      steps++;
    }
    if (steps === MAX_STEPS_PER_FRAME) acc = 0;

    drainEvents();
    if (mode === 'playing') watchState(dt);
  } else {
    acc = 0;
  }

  if (running || dirty) {
    renderer.render(game.getScene());
    hud.update(game);
    frames++;
    dirty = false;
  }
  workMs += performance.now() - t0;
}

function watchState(dt) {
  if (game.state === 'playing') return;
  endTimer += dt;
  if (game.state === 'dead') {
    if (endTimer >= DEATH_DELAY) {
      setMode('dead');
      menus.show('dead');
    } else {
      input.setEnabled(false);
    }
  } else if (endTimer >= EXIT_DELAY) {
    finishLevel();
  }
}

function drainEvents() {
  const p = game.player;
  audio.setListener(p.x, p.y, p.yaw);
  for (const e of game.events) {
    if (e.type === 'sound') audio.play(e.id, e.x === undefined ? {} : { x: e.x, y: e.y });
    else if (e.type === 'message') hud.message(e.text);
    else if (e.type === 'damage') hud.damage(e.amount, e.angle);
    else if (e.type === 'pickup' || e.type === 'secret') hud.pickup();
  }
  game.events.length = 0;
}

boot().catch((err) => {
  menus.show('loading', { text: `Startup failed: ${err.message}` });
  throw err;
});
