// Headless check of src/input.js against tools/test-input.html.
//   node tools/test-input.mjs [outDir]
// Drives real multi-touch, keyboard and mouse through Chrome and asserts on sample().

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startServer } from './serve.mjs';
import { launchBrowser, iphonePage, desktopPage, screenshot } from './browser.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outDir = path.resolve(process.argv[2] || path.join(root, 'out', 'input'));

let failed = 0;
function check(name, ok, detail = '') {
  if (!ok) failed++;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? `  ${detail}` : ''}`);
}
const near = (a, b, eps = 0.02) => Math.abs(a - b) <= eps;

async function touch(page) {
  const cdp = await page.context().newCDPSession(page);
  const points = new Map();
  const send = (type, touchPoints) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints });
  return {
    async start(id, x, y) {
      points.set(id, { id, x, y });
      await send('touchStart', [...points.values()]);
    },
    async move(id, x, y) {
      points.set(id, { id, x, y });
      await send('touchMove', [...points.values()]);
    },
    async end(id) {
      const p = points.get(id);
      points.delete(id);
      await send('touchEnd', [p]);
    },
    async cancel() {
      points.clear();
      await send('touchCancel', []);
    },
  };
}

const sample = (page) => page.evaluate(() => window.__input.sample());
const centre = (page, sel) => page.evaluate((s) => {
  const r = document.querySelector(s).getBoundingClientRect();
  return { x: r.left + r.width / 2, y: r.top + r.height / 2, w: r.width, h: r.height, shown: r.width > 0 };
}, sel);
const hasClass = (page, sel, cls) => page.evaluate(([s, c]) => document.querySelector(s).classList.contains(c), [sel, cls]);

async function open(page, url, query) {
  await page.goto(`${url}tools/test-input.html?${query}`);
  await page.waitForFunction(() => window.__input);
  await page.evaluate(() => window.__input.setEnabled(true));
}

async function geometry(page) {
  const g = {};
  for (const name of ['fire', 'use', 'next', 'pause', 'base', 'knob']) g[name] = await centre(page, `.ti-${name}`);
  g.view = await page.evaluate(() => {
    const r = document.getElementById('view').getBoundingClientRect();
    return { top: r.top, bottom: r.bottom, w: innerWidth, h: innerHeight };
  });
  return g;
}

function checkLayout(label, g, safe) {
  const { w, h } = g.view;
  const parts = ['fire', 'use', 'next', 'pause', 'base'];
  const box = (p) => ({ l: p.x - p.w / 2, r: p.x + p.w / 2, t: p.y - p.h / 2, b: p.y + p.h / 2 });
  let inside = true;
  for (const name of parts) {
    const b = box(g[name]);
    if (b.l < safe.l + 6 || b.r > w - safe.r - 6 || b.t < safe.t + 6 || b.b > h - safe.b - 12) inside = false;
  }
  check(`${label}: controls inside the safe area, clear of the home strip`, inside);
  let gap = Infinity;
  for (let i = 0; i < parts.length; i++) {
    for (let j = i + 1; j < parts.length; j++) {
      const a = g[parts[i]];
      const b = g[parts[j]];
      gap = Math.min(gap, Math.hypot(a.x - b.x, a.y - b.y) - a.w / 2 - b.w / 2);
    }
  }
  check(`${label}: no overlap`, gap >= 12, `min gap ${gap.toFixed(1)} px`);
  check(`${label}: sizes`, g.fire.w === 84 && g.use.w === 56 && g.next.w === 56 && g.pause.w === 44);
  const top = h > w ? g.view.bottom : safe.t;
  check(`${label}: pause sits in the top-left corner slot`, g.pause.x - 22 >= safe.l && g.pause.x + 22 <= safe.l + 68
    && g.pause.y - 22 >= top + 6 && g.pause.y + 22 <= top + 60);
}

async function touchSuite(page, label, { leftHanded }) {
  const t = await touch(page);
  const g = await geometry(page);
  const { w, h } = g.view;
  const portrait = h > w;
  const safe = portrait ? { t: 47, r: 0, b: 34, l: 0 } : { t: 0, r: 47, b: 21, l: 47 };
  checkLayout(label, g, safe);
  check(`${label}: fire is on the ${leftHanded ? 'left' : 'right'}`, leftHanded ? g.fire.x < w / 2 : g.fire.x > w / 2);
  check(`${label}: stick rests on the ${leftHanded ? 'right' : 'left'}`, leftHanded ? g.base.x > w / 2 : g.base.x < w / 2);
  if (portrait) check(`${label}: controls sit below the view`, Math.min(g.next.y - 28, g.pause.y - 22, g.base.y - 56) >= g.view.bottom);

  await sample(page);
  // Stick: lands where the thumb lands, analog, dead zone, base follows past the rim.
  const sx = g.base.x + (leftHanded ? 20 : -20);
  const sy = g.base.y + 10;
  await t.start(1, sx, sy);
  let s = await sample(page);
  check(`${label}: stick touch alone outputs nothing`, s.moveX === 0 && s.moveY === 0 && s.turn === 0 && !s.fire);
  const base = await centre(page, '.ti-base');
  check(`${label}: stick base floats to the thumb`, near(base.x, sx, 0.6) && near(base.y, sy, 0.6));
  await t.move(1, sx + 4, sy);
  s = await sample(page);
  check(`${label}: dead zone`, s.moveX === 0 && s.moveY === 0);
  await t.move(1, sx + 31, sy);
  s = await sample(page);
  check(`${label}: half deflection right`, near(s.moveX, 0.5) && near(s.moveY, 0), `moveX ${s.moveX.toFixed(3)}`);
  await t.move(1, sx, sy - 56);
  s = await sample(page);
  check(`${label}: full forward`, near(s.moveY, 1) && near(s.moveX, 0), `moveY ${s.moveY.toFixed(3)}`);
  await t.move(1, sx - 40, sy + 40);
  s = await sample(page);
  check(`${label}: diagonal back-left`, near(s.moveX, -0.707, 0.03) && near(s.moveY, -0.707, 0.03),
    `${s.moveX.toFixed(3)} ${s.moveY.toFixed(3)}`);
  await t.move(1, sx + 120, sy);
  s = await sample(page);
  const followed = await centre(page, '.ti-base');
  check(`${label}: past the rim clamps to 1 and the base follows`, near(s.moveX, 1) && near(followed.x, sx + 64, 0.6),
    `moveX ${s.moveX.toFixed(3)} base ${followed.x.toFixed(1)}`);
  await t.move(1, sx + 64, sy);
  s = await sample(page);
  check(`${label}: returning to the moved base centre is neutral`, s.moveX === 0 && s.moveY === 0);
  await t.move(1, sx + 64, sy - 40);
  s = await sample(page);
  const hold = s.moveY;
  check(`${label}: stick held forward`, hold > 0.6);

  // Second finger: look drag on the other half while the stick stays held.
  const lookX = leftHanded ? w * 0.25 : w * 0.75;
  const lookY = portrait ? g.view.bottom + 60 : h * 0.3;
  await t.start(2, lookX, lookY);
  await t.move(2, lookX + 1, lookY);
  s = await sample(page);
  check(`${label}: 1 px of jitter does not turn`, s.turn === 0);
  await t.move(2, lookX + 10, lookY);
  await t.move(2, lookX + 60, lookY + 25);
  s = await sample(page);
  check(`${label}: look drag is 1:1 (50 px = 0.3 rad) with the stick still held`,
    near(s.turn, 50 * 0.006, 1e-6) && near(s.moveY, hold, 1e-6), `turn ${s.turn.toFixed(4)}`);
  s = await sample(page);
  check(`${label}: turn is cleared by sample`, s.turn === 0 && near(s.moveY, hold, 1e-6));
  await t.move(2, lookX + 20, lookY);
  s = await sample(page);
  check(`${label}: dragging back turns left`, near(s.turn, -40 * 0.006, 1e-6));
  await t.end(2);

  // Fire: held, and the same finger turns the view, also after sliding off the button.
  await t.start(3, g.fire.x + 5, g.fire.y - 4);
  s = await sample(page);
  check(`${label}: fire held`, s.fire === true && s.turn === 0);
  check(`${label}: fire shows pressed`, await hasClass(page, '.ti-fire', 'ti-down'));
  await t.move(3, g.fire.x + 5 - 10, g.fire.y - 4);
  await t.move(3, g.fire.x + 5 - 110, g.fire.y - 60);
  s = await sample(page);
  check(`${label}: dragging the fire finger turns while firing`, s.fire === true && near(s.turn, -100 * 0.006, 1e-6),
    `turn ${s.turn.toFixed(4)}`);
  s = await sample(page);
  check(`${label}: fire stays held off the button, stick still held`, s.fire === true && near(s.moveY, hold, 1e-6));
  await t.end(3);
  s = await sample(page);
  check(`${label}: fire released`, s.fire === false && !(await hasClass(page, '.ti-fire', 'ti-down')));

  // Button edges.
  await t.start(4, g.use.x, g.use.y);
  check(`${label}: use shows pressed`, await hasClass(page, '.ti-use', 'ti-down'));
  s = await sample(page);
  const s2 = await sample(page);
  check(`${label}: use fires exactly once while held`, s.use === true && s2.use === false);
  await t.end(4);
  s = await sample(page);
  check(`${label}: use release adds nothing`, !s.use && !(await hasClass(page, '.ti-use', 'ti-down')));
  await t.start(4, g.next.x + 30, g.next.y);
  await t.end(4);
  s = await sample(page);
  check(`${label}: next weapon edge, hit just outside the rim`, s.weaponNext === true && !s.use && !s.fire);
  check(`${label}: next weapon edge once`, (await sample(page)).weaponNext === false);
  await t.start(4, g.use.x, g.use.y);
  await sample(page);
  await t.move(4, g.use.x - 12, g.use.y);
  await t.move(4, g.use.x - 52, g.use.y);
  s = await sample(page);
  check(`${label}: a finger sliding off USE becomes a look drag`, near(s.turn, -40 * 0.006, 1e-6) && !s.use
    && !(await hasClass(page, '.ti-use', 'ti-down')));
  await t.end(4);

  await t.start(5, g.pause.x, g.pause.y);
  s = await sample(page);
  check(`${label}: pause waits for release`, s.pause === false && await hasClass(page, '.ti-pause', 'ti-down'));
  await t.end(5);
  s = await sample(page);
  check(`${label}: pause on release, once`, s.pause === true && (await sample(page)).pause === false);
  await t.start(5, g.pause.x, g.pause.y);
  await t.move(5, g.pause.x + 30, g.pause.y + 30);
  await t.end(5);
  s = await sample(page);
  check(`${label}: sliding off pause cancels it`, s.pause === false);

  // Stick release.
  await t.end(1);
  s = await sample(page);
  const rest = await centre(page, '.ti-base');
  check(`${label}: stick release clears and returns to rest`, s.moveX === 0 && s.moveY === 0
    && near(rest.x, g.base.x, 0.6) && near(rest.y, g.base.y, 0.6));

  // touchcancel, disable and page hide release everything.
  const holdAll = async () => {
    await t.start(1, sx, sy);
    await t.move(1, sx, sy - 50);
    await t.start(3, g.fire.x, g.fire.y);
    const v = await sample(page);
    return v.fire && v.moveY > 0.8;
  };
  check(`${label}: (setup) stick and fire held`, await holdAll());
  await t.cancel();
  s = await sample(page);
  check(`${label}: touchcancel releases everything`, !s.fire && s.moveY === 0
    && !(await hasClass(page, '.ti-fire', 'ti-down')) && await hasClass(page, '.ti-base', 'ti-idle'));

  check(`${label}: (setup) stick and fire held`, await holdAll());
  await page.evaluate(() => {
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
    document.dispatchEvent(new Event('visibilitychange'));
    delete document.hidden;
  });
  s = await sample(page);
  check(`${label}: page hidden clears held state`, !s.fire && s.moveY === 0);
  await t.cancel();

  check(`${label}: (setup) stick and fire held`, await holdAll());
  await page.evaluate(() => window.__input.setEnabled(false));
  s = await sample(page);
  const hidden = await page.evaluate(() => getComputedStyle(document.querySelector('.ti-layer')).display === 'none');
  check(`${label}: setEnabled(false) clears state and hides the controls`, !s.fire && s.moveY === 0 && hidden && s.isTouch);
  await t.move(1, sx, sy - 55);
  await page.evaluate(() => window.__input.setEnabled(true));
  s = await sample(page);
  check(`${label}: fingers still down after re-enabling stay ignored`, !s.fire && s.moveY === 0);
  await t.end(1);
  await t.end(3);

  check(`${label}: touch events are default-prevented`, await page.evaluate(() => {
    const p = window.__log.prevented;
    return p.touchstart === true && p.touchmove === true && p.touchend === true;
  }));
}

async function run() {
  const server = await startServer(root, 0);
  const browser = await launchBrowser();
  try {
    // ---------------------------------------------------------------- iPhone landscape
    let page = await iphonePage(browser);
    await open(page, server.url, 'safe=1');
    check('landscape: controls shown on a coarse pointer', (await centre(page, '.ti-fire')).shown
      && await page.evaluate(() => window.__input.isTouch));
    await screenshot(page, path.join(outDir, 'landscape.png'));
    await touchSuite(page, 'landscape', { leftHanded: false });

    // Sensitivity scales the drag.
    let t = await touch(page);
    await page.evaluate(() => window.__input.setSensitivity(2));
    await t.start(2, 600, 100);
    await t.move(2, 610, 100);
    await t.move(2, 660, 100);
    let s = await sample(page);
    check('landscape: sensitivity 2 doubles the turn', near(s.turn, 50 * 0.012, 1e-6));
    await t.end(2);
    await page.evaluate(() => window.__input.setSensitivity(1));

    // The minimap stacks above the layer: a tap reaches it and must not fire or take the lock.
    const map = await centre(page, '#minimap');
    await page.touchscreen.tap(map.x, map.y);
    await page.waitForTimeout(100);
    s = await sample(page);
    check('landscape: a tap on the minimap reaches it and leaves the game input alone',
      await page.evaluate(() => window.__log.mapClicks) === 1 && !s.fire && s.turn === 0
      && await page.evaluate(() => document.pointerLockElement === null));

    check('landscape: gesturestart and contextmenu are blocked', await page.evaluate(() => {
      const layer = document.querySelector('.ti-layer');
      const g = new Event('gesturestart', { bubbles: true, cancelable: true });
      layer.dispatchEvent(g);
      const c = new MouseEvent('contextmenu', { bubbles: true, cancelable: true });
      layer.dispatchEvent(c);
      const d = new MouseEvent('dblclick', { bubbles: true, cancelable: true });
      layer.dispatchEvent(d);
      return g.defaultPrevented && c.defaultPrevented && d.defaultPrevented;
    }));

    // Pressed-state screenshot: stick dragged, fire held.
    const g = await geometry(page);
    await t.start(1, g.base.x + 10, g.base.y - 6);
    await t.move(1, g.base.x + 44, g.base.y - 40);
    await t.start(3, g.fire.x, g.fire.y);
    await page.evaluate(() => { window.__state.fire = 1; window.__draw(); });
    await page.waitForTimeout(150);
    await screenshot(page, path.join(outDir, 'landscape-pressed.png'));
    await t.cancel();
    await page.evaluate(() => { window.__state.fire = 0; window.__draw(); });

    // Left-handed mirror.
    await page.evaluate(() => window.__input.setLayout({ leftHanded: true }));
    await page.waitForTimeout(150);
    await screenshot(page, path.join(outDir, 'landscape-left.png'));
    await touchSuite(page, 'landscape left-handed', { leftHanded: true });
    check('landscape: no page errors', page.errors.length === 0, page.errors.join(' | '));
    await page.context().close();

    // ---------------------------------------------------------------- iPhone portrait
    page = await iphonePage(browser, { landscape: false });
    await open(page, server.url, 'safe=1');
    await screenshot(page, path.join(outDir, 'portrait.png'));
    await touchSuite(page, 'portrait', { leftHanded: false });
    t = await touch(page);
    const pg = await geometry(page);
    await t.start(2, 80, pg.view.top + 100);
    await t.move(2, 90, pg.view.top + 100);
    await t.move(2, 140, pg.view.top + 100);
    s = await sample(page);
    check('portrait: dragging on the view (left half) looks, not moves', near(s.turn, 0.3, 1e-6) && s.moveX === 0);
    await t.end(2);
    await page.evaluate(() => window.__input.setLayout({ leftHanded: true }));
    await page.waitForTimeout(150);
    await screenshot(page, path.join(outDir, 'portrait-left.png'));
    await touchSuite(page, 'portrait left-handed', { leftHanded: true });
    check('portrait: no page errors', page.errors.length === 0, page.errors.join(' | '));
    await page.context().close();

    // ---------------------------------------------------------------- small phone, no insets
    page = await iphonePage(browser);
    await page.setViewportSize({ width: 568, height: 320 });
    await open(page, server.url, '');
    await screenshot(page, path.join(outDir, 'landscape-small.png'));
    checkLayout('568x320 without insets', await geometry(page), { t: 0, r: 0, b: 0, l: 0 });
    await page.context().close();

    // ---------------------------------------------------------------- desktop
    page = await desktopPage(browser, { width: 1280, height: 720 });
    await open(page, server.url, '');
    check('desktop: touch controls stay hidden', !(await centre(page, '.ti-fire')).shown
      && !(await page.evaluate(() => window.__input.isTouch)));
    await sample(page);

    await page.keyboard.down('KeyW');
    await page.keyboard.down('KeyD');
    s = await sample(page);
    check('desktop: W + D moves forward-right, normalised', near(s.moveX, 0.707, 0.01) && near(s.moveY, 0.707, 0.01) && !s.isTouch);
    await page.keyboard.up('KeyD');
    await page.keyboard.up('KeyW');
    await page.keyboard.down('ArrowDown');
    await page.keyboard.down('KeyA');
    s = await sample(page);
    check('desktop: Down + A moves back-left', s.moveX < -0.7 && s.moveY < -0.7);
    await page.keyboard.up('ArrowDown');
    await page.keyboard.up('KeyA');
    s = await sample(page);
    check('desktop: keys released', s.moveX === 0 && s.moveY === 0);

    await page.keyboard.down('KeyE');
    await page.keyboard.down('KeyE');   // a second down on a held key is an auto-repeat
    await page.keyboard.down('KeyE');
    s = await sample(page);
    const again = await sample(page);
    await page.keyboard.down('KeyE');
    const repeat = await sample(page);
    check('desktop: E is one use edge, auto-repeat ignored', s.use && !again.use && !repeat.use);
    await page.keyboard.up('KeyE');
    await page.keyboard.press('Space');
    check('desktop: Space is use', (await sample(page)).use === true);
    await page.keyboard.press('Digit3');
    s = await sample(page);
    check('desktop: 3 selects slot 2, once', s.weaponSlot === 2 && (await sample(page)).weaponSlot === -1);
    await page.keyboard.press('KeyQ');
    check('desktop: Q is next weapon', (await sample(page)).weaponNext === true);
    await page.keyboard.press('KeyP');
    check('desktop: P pauses', (await sample(page)).pause === true);
    await page.keyboard.press('Escape');
    check('desktop: Esc pauses', (await sample(page)).pause === true);
    await page.keyboard.press('KeyM');
    check('desktop: M toggles the map', (await sample(page)).map === true);
    await page.evaluate(() => {
      window.__tab = null;
      window.addEventListener('keydown', (e) => { if (e.code === 'Tab') window.__tab = e.defaultPrevented; });
    });
    await page.keyboard.press('Tab');
    s = await sample(page);
    check('desktop: Tab toggles the map and is default-prevented', s.map === true && await page.evaluate(() => window.__tab) === true);

    await sample(page);
    await page.keyboard.down('ArrowRight');
    await page.waitForTimeout(60);
    s = await sample(page);
    check('desktop: Right arrow turns right at a bounded rate', s.turn > 0.05 && s.turn <= 0.2601, `turn ${s.turn.toFixed(3)}`);
    await page.keyboard.up('ArrowRight');
    await page.keyboard.down('KeyF');
    s = await sample(page);
    check('desktop: F fires while held', s.fire === true);
    await page.keyboard.up('KeyF');

    // Keys held when the window loses focus are dropped.
    await page.keyboard.down('KeyW');
    await page.evaluate(() => window.dispatchEvent(new Event('blur')));
    s = await sample(page);
    check('desktop: blur clears held keys', s.moveY === 0);
    await page.keyboard.up('KeyW');

    // Disabled: nothing comes through, keys are not swallowed.
    await page.evaluate(() => window.__input.setEnabled(false));
    await page.keyboard.down('KeyW');
    await page.keyboard.press('KeyE');
    s = await sample(page);
    check('desktop: disabled input is neutral', s.moveY === 0 && !s.use);
    await page.evaluate(() => window.__input.setEnabled(true));
    s = await sample(page);
    check('desktop: a key held from before enabling stays ignored', s.moveY === 0 && !s.use);
    await page.keyboard.up('KeyW');

    // Mouse: click takes the pointer lock, then movement turns and the button fires.
    await page.mouse.move(640, 360);
    await page.mouse.down();
    await page.mouse.up();
    await page.waitForTimeout(200);
    const locked = await page.evaluate(() => document.pointerLockElement === document.getElementById('view'));
    check('desktop: click in the view takes the pointer lock', locked);
    s = await sample(page);
    check('desktop: the locking click does not fire', s.fire === false);
    if (locked) {
      await sample(page);
      await page.mouse.move(740, 360);
      s = await sample(page);
      check('desktop: mouse look, 100 px = 0.25 rad', near(s.turn, 0.25, 0.005), `turn ${s.turn.toFixed(4)}`);
      await page.mouse.down();
      s = await sample(page);
      check('desktop: left button fires while held', s.fire === true);
      await page.mouse.up();
      check('desktop: left button released', (await sample(page)).fire === false);
      await page.mouse.wheel(0, 100);
      await page.waitForTimeout(50);
      s = await sample(page);
      check('desktop: wheel down is next weapon', s.weaponNext === true && !s.weaponPrev);
      await page.waitForTimeout(150);
      await page.mouse.wheel(0, -100);
      await page.waitForTimeout(50);
      s = await sample(page);
      check('desktop: wheel up is previous weapon', s.weaponPrev === true && !s.weaponNext);

      await page.evaluate(() => document.exitPointerLock());
      await page.waitForTimeout(150);
      s = await sample(page);
      check('desktop: losing the pointer lock raises pause', s.pause === true);
      await page.mouse.down();
      await page.mouse.up();
      await page.waitForTimeout(200);
      await page.evaluate(() => window.__input.setEnabled(false));
      await page.waitForTimeout(150);
      const released = await page.evaluate(() => document.pointerLockElement === null);
      await page.evaluate(() => window.__input.setEnabled(true));
      s = await sample(page);
      check('desktop: setEnabled(false) releases the lock without a pause edge', released && s.pause === false);
    }

    // Gamepad (stubbed standard pad).
    await page.evaluate(() => {
      const btn = (v) => ({ pressed: v > 0.5, value: v });
      window.__pad = { connected: true, mapping: 'standard', axes: [0, 0, 0, 0], buttons: Array.from({ length: 17 }, () => btn(0)) };
      window.__padBtn = (i, v) => { window.__pad.buttons[i] = btn(v); };
      navigator.getGamepads = () => [null, window.__pad];
    });
    await sample(page);
    await page.evaluate(() => { window.__pad.axes = [0.1, -1, 1, 0]; window.__padBtn(7, 0.9); window.__padBtn(0, 1); window.__padBtn(5, 1); });
    await page.waitForTimeout(40);
    s = await sample(page);
    const pad2 = await sample(page);
    check('desktop: gamepad sticks, trigger and button edges', s.moveX === 0 && near(s.moveY, 1) && s.turn > 0.03 && s.fire
      && s.use && s.weaponNext && !pad2.use && !pad2.weaponNext && pad2.fire, JSON.stringify(s));
    await page.evaluate(() => { window.__pad.axes = [0, 0, 0, 0]; window.__padBtn(7, 0); window.__padBtn(0, 0); window.__padBtn(5, 0); window.__padBtn(9, 1); });
    s = await sample(page);
    check('desktop: gamepad start pauses, sticks neutral', s.pause && s.moveY === 0 && s.turn === 0 && !s.fire);

    // First touch on a fine-pointer device brings up the touch controls and is tracked.
    await page.evaluate(() => { navigator.getGamepads = () => []; });
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
    t = await touch(page);
    await t.start(1, 200, 500);
    await t.move(1, 200, 440);
    s = await sample(page);
    check('desktop: first touch reveals the controls and already drives the stick', s.isTouch && near(s.moveY, 1)
      && (await centre(page, '.ti-fire')).shown);
    await t.end(1);
    check('desktop: no page errors', page.errors.length === 0, page.errors.join(' | '));
    await page.context().close();
  } finally {
    await browser.close();
    await server.close();
  }
  console.log(failed ? `\n${failed} check(s) failed` : '\nall input checks passed');
  console.log(`screenshots in ${outDir}`);
  process.exit(failed ? 1 : 0);
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
