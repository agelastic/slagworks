// End-to-end smoke test in headless Chrome: boot, menus, touch controls, every level, the
// state flow (pause, death, exit, victory, settings, continue) and a frame-time sample.
//
//   node tools/browser-test.mjs [outDir]      screenshots go to outDir (default out/browser-test)
//   ONLY=controls|levels|frametime|flow node tools/browser-test.mjs   run one part
//
// Exits non-zero on any failed check. Uses an ephemeral port.

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startServer } from './serve.mjs';
import { launchBrowser, iphonePage, desktopPage, screenshot, touchDriver } from './browser.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const only = process.env.ONLY || '';
const outDir = path.resolve(process.argv[2] || path.join(root, 'out/browser-test'));

let failures = 0;
function check(ok, label, detail = '') {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${label}${detail ? `  (${detail})` : ''}`);
  if (!ok) failures++;
  return ok;
}

const server = await startServer(root, 0);
const browser = await launchBrowser();
const url = (query = '') => new URL(query, server.url).href;
const shot = (page, name) => screenshot(page, path.join(outDir, `${name}.png`));

// ---------------------------------------------------------------- page helpers

const state = (page) => page.evaluate(() => window.__game && window.__game.state);
const waitState = (page, s, timeout = 20000) => page.waitForFunction(
  (want) => window.__game && window.__game.state === want, s, { timeout },
).then(() => true, () => false);

async function open(page, query) {
  await page.goto(url(query));
  return page.waitForFunction(() => window.__game && window.__game.state !== 'loading', null, { timeout: 30000 })
    .then(() => true, () => false);
}

async function center(page, selector) {
  const box = await page.locator(selector).first().boundingBox();
  if (!box) throw new Error(`no element ${selector}`);
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

// A real tap (touch pages) or click (desktop) on an element.
async function tap(page, selector) {
  const { x, y } = await center(page, selector);
  if (page.touch) await page.touch.tap(x, y);
  else await page.mouse.click(x, y);
  await page.waitForTimeout(120);
}

async function hold(page, selector, ms) {
  const { x, y } = await center(page, selector);
  await page.touch.start(7, x, y);
  await page.waitForTimeout(ms);
  await page.touch.end(7);
}

const player = (page) => page.evaluate(() => {
  const p = window.__game.game.player;
  return { x: p.x, y: p.y, z: p.z, yaw: p.yaw, health: p.health, ammo: { ...p.ammo }, weapon: p.weapon };
});

// Put the player at (x, y) on the floor of that cell, facing yaw.
const place = (page, x, y, yaw) => page.evaluate(([x, y, yaw]) => {
  const g = window.__game.game;
  const p = g.player;
  const c = g.world.cell(Math.floor(x), Math.floor(y));
  p.x = x; p.y = y; p.yaw = yaw; p.z = c.floor; p.vx = p.vy = p.vz = 0; p.eyeZ = p.z + 0.62;
}, [x, y, yaw]);

// Finds viewpoints in the current level: for a target cell, an open cell 1..4 cells away along
// a row or column with a clear, level path, and the yaw that faces the target.
const SPOT_FINDER = `(() => {
  const g = window.__game.game, w = g.world;
  const open = (c) => !c.solid && !c.door && !c.damage && c.ceil - c.floor >= 1;
  function viewOf(tx, ty, near = 1, far = 4) {
    const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]];
    for (let d = far; d >= near; d--) {
      for (const [dx, dy] of dirs) {
        const sx = tx + dx * d, sy = ty + dy * d;
        const s = w.cell(sx, sy);
        if (!open(s) || s.lift) continue;
        let clear = true;
        for (let k = 1; k < d; k++) {
          const m = w.cell(tx + dx * k, ty + dy * k);
          if (m.solid || Math.abs(m.floor - s.floor) > 0.6 || m.ceil - s.floor < 1) clear = false;
        }
        if (clear) return { x: sx + 0.5, y: sy + 0.5, yaw: Math.atan2(-dy, -dx) };
      }
    }
    return null;
  }
  const cells = w.cells;
  const first = (f) => cells.find(f);
  const spots = {};
  const p = g.player;
  spots.start = { x: p.x, y: p.y, yaw: p.yaw };
  const door = first((c) => c.door && !c.door.key && !c.door.tag && !c.door.secret && viewOf(c.cx, c.cy, 2));
  if (door) spots.door = viewOf(door.cx, door.cy, 2);
  const keyDoor = first((c) => c.door && c.door.key && viewOf(c.cx, c.cy, 2));
  if (keyDoor) spots.keydoor = viewOf(keyDoor.cx, keyDoor.cy, 2);
  const lift = first((c) => c.lift && viewOf(c.cx, c.cy, 2));
  if (lift) spots.lift = viewOf(lift.cx, lift.cy, 2);
  const slag = first((c) => c.damage && c.ft === 'f_slag' && viewOf(c.cx, c.cy, 2));
  if (slag) spots.slag = viewOf(slag.cx, slag.cy, 2);
  const cool = first((c) => c.damage && c.ft === 'f_coolant' && viewOf(c.cx, c.cy, 2));
  if (cool) spots.coolant = viewOf(cool.cx, cool.cy, 2);
  // Outdoor: the sky cell with the most sky cells around it, looking along the longer axis.
  let best = null, bestN = -1;
  for (const c of cells) {
    if (c.solid || c.ct !== 'sky') continue;
    let n = 0;
    for (let dy = -3; dy <= 3; dy++) for (let dx = -3; dx <= 3; dx++) if (w.cell(c.cx + dx, c.cy + dy).ct === 'sky') n++;
    if (n > bestN) { bestN = n; best = c; }
  }
  if (best) {
    let y = best.cy;
    while (w.cell(best.cx, y + 1).ct === 'sky' && !w.cell(best.cx, y + 1).solid) y++;
    spots.yard = { x: best.cx + 0.5, y: Math.max(best.cy, y - 1) + 0.5, yaw: -Math.PI / 2 - 0.3 };
  }
  const exit = first((c) => c.exit && viewOf(c.cx, c.cy, 2));
  if (exit) spots.exit = viewOf(exit.cx, exit.cy, 2);
  // Enemy group: the enemy with the most others within 4 cells, seen from 3 cells away.
  let group = null, groupN = 0;
  for (const e of g.enemies) {
    if (e.type === 'overseer') continue;
    const n = g.enemies.filter((o) => Math.hypot(o.x - e.x, o.y - e.y) < 4).length;
    if (n > groupN) { groupN = n; group = e; }
  }
  if (group) {
    const v = viewOf(Math.floor(group.x), Math.floor(group.y), 2, 4);
    if (v) spots.enemies = v;
  }
  const boss = g.enemies.find((e) => e.type === 'overseer');
  if (boss) {
    const v = viewOf(Math.floor(boss.x), Math.floor(boss.y), 4, 7);
    if (v) spots.boss = v;
  }
  return spots;
})()`;

// ---------------------------------------------------------------- 1. boot, menus, controls per viewport

async function controlsTest(name, page) {
  console.log(`\n${name}`);
  check(await open(page, ''), 'boots to a menu');
  check(await state(page) === 'title', 'title screen');
  await page.waitForTimeout(300);
  await shot(page, `${name}-title`);

  await tap(page, '[data-act="go"][data-arg="difficulty"]');
  check(await page.evaluate(() => window.__game.menus.current) === 'difficulty', 'New Game opens difficulty');
  await shot(page, `${name}-difficulty`);
  await tap(page, '[data-act="newgame"][data-arg="1"]');
  check(await waitState(page, 'playing'), 'difficulty tap starts the game');
  const f0 = await page.evaluate(() => window.__game.frames);
  await page.waitForTimeout(500);
  const f1 = await page.evaluate(() => window.__game.frames);
  check(f1 - f0 > 10, 'frames advance', `${f1 - f0} frames in 0.5 s`);
  await page.evaluate(() => { window.__game.game.player.god = true; });

  const a = await player(page);
  const vp = page.viewportSize();
  if (page.touch) {
    // Stick in the lower left, look-drag on the right half, both held at once.
    const portrait = vp.height > vp.width;
    const sx = portrait ? 90 : 130, sy = portrait ? vp.height - 190 : vp.height - 110;
    const lx = vp.width * 0.62, ly = portrait ? vp.height - 330 : vp.height * 0.45;
    await page.touch.start(1, sx, sy);
    await page.touch.start(2, lx, ly);
    for (let i = 1; i <= 20; i++) {
      await page.touch.move(1, sx, sy - Math.min(i, 6) * 9);
      await page.touch.move(2, lx + i * 4, ly);
      await page.waitForTimeout(40);
    }
    await page.waitForTimeout(400);
    await shot(page, `${name}-moving`);
    await page.touch.end(2);
    await page.touch.end(1);
  } else {
    await page.keyboard.down('KeyW');
    await page.keyboard.down('ArrowRight');
    await page.waitForTimeout(500);
    await page.keyboard.up('ArrowRight');
    await page.waitForTimeout(500);
    await page.keyboard.up('KeyW');
  }
  const b = await player(page);
  const moved = Math.hypot(b.x - a.x, b.y - a.y);
  check(moved > 0.5, 'player moved', `${moved.toFixed(2)} units`);
  check(Math.abs(b.yaw - a.yaw) > 0.2, 'player turned', `${(b.yaw - a.yaw).toFixed(2)} rad`);

  // Fire the rivet gun.
  await page.evaluate(() => { window.__game.game.player.yaw += Math.PI; });
  if (page.touch) await hold(page, '.ti-fire', 700);
  else {
    await page.keyboard.down('KeyF');
    await page.waitForTimeout(700);
    await page.keyboard.up('KeyF');
  }
  const c = await player(page);
  check(c.ammo.rivets < b.ammo.rivets, 'firing uses ammo', `${b.ammo.rivets} -> ${c.ammo.rivets}`);
  await page.waitForTimeout(100);
  await shot(page, `${name}-playing`);
  check(page.errors.length === 0, 'no console or page errors', page.errors.slice(0, 3).join(' | '));
}

// ---------------------------------------------------------------- 2. levels and viewpoints

async function levelsTest(page) {
  console.log('\nlevels');
  for (let i = 1; i <= 4; i++) {
    check(await open(page, `?autostart=1&level=${i}&god=1`), `level ${i} loads`);
    check(await waitState(page, 'playing'), `level ${i} playing`);
    await page.waitForTimeout(400);
    const spots = await page.evaluate(SPOT_FINDER);
    const want = { 2: ['slag'], 3: ['yard'], 4: ['boss'] }[i] || [];
    for (const k of ['start', 'door', 'enemies', ...want]) check(!!spots[k], `level ${i} has a ${k} viewpoint`);
    let n = 0;
    for (const [k, v] of Object.entries(spots)) {
      await page.evaluate((slot) => { window.__game.game.player.weapon = slot; }, n++ % 5);
      await place(page, v.x, v.y, v.yaw);
      await page.waitForTimeout(160);
      await page.evaluate(() => { const p = window.__game.game.player; p.eyeOffset = 0; });
      await shot(page, `l${i}-${k}`);
    }
    check(page.errors.length === 0, `level ${i} no errors`, page.errors.slice(0, 3).join(' | '));
  }
}

// ---------------------------------------------------------------- 3. frame time

async function frameTime(page) {
  console.log('\nframe time');
  await open(page, '?autostart=1&level=3&god=1');
  await waitState(page, 'playing');
  await page.waitForTimeout(800);
  const spots = await page.evaluate(SPOT_FINDER);
  if (spots.yard) await place(page, spots.yard.x, spots.yard.y, spots.yard.yaw);
  const r = await page.evaluate(() => new Promise((resolve) => {
    const g = window.__game;
    const f0 = g.frames, w0 = g.workMs, t0 = performance.now();
    let turn = 0;
    const spin = setInterval(() => { g.game.player.yaw += 0.02; turn++; }, 16);
    setTimeout(() => {
      clearInterval(spin);
      const frames = g.frames - f0;
      resolve({ frames, ms: (performance.now() - t0) / frames, work: (g.workMs - w0) / frames });
    }, 5000);
  }));
  console.log(`  level 3, 5 s: ${r.frames} frames, ${r.ms.toFixed(2)} ms per frame, ${r.work.toFixed(2)} ms CPU work per frame (step + render calls)`);
  check(r.ms < 25, 'frame interval under 25 ms');
}

// ---------------------------------------------------------------- 4. game flow

async function flowTest(page) {
  console.log('\nflow');
  await open(page, '?autostart=1&level=1&god=1');
  check(await waitState(page, 'playing'), 'level 1 playing');
  const spots = await page.evaluate(SPOT_FINDER);

  // Enemies near a group wake, chase and hurt the player (god mode off for this part).
  const near = (sp) => page.evaluate(([x, y]) => window.__game.game.enemies
    .filter((e) => e.alive && Math.hypot(e.x - x, e.y - y) < 8)
    .map((e) => ({ idle: e.state === 'idle', d: Math.hypot(e.x - x, e.y - y) })), [sp.x, sp.y]);
  const before = await near(spots.enemies);
  await page.evaluate(() => { const p = window.__game.game.player; p.god = false; p.health = 100; p.armor = 0; });
  await place(page, spots.enemies.x, spots.enemies.y, spots.enemies.yaw);
  await page.waitForFunction(() => window.__game.game.player.health < 100, null, { timeout: 4000, polling: 50 }).catch(() => {});
  await page.evaluate(() => { window.__game.game.player.god = true; });
  const after = await near(spots.enemies);
  const health = (await player(page)).health;
  check(after.filter((e) => !e.idle).length > before.filter((e) => !e.idle).length, 'enemies wake',
    `${before.filter((e) => !e.idle).length} -> ${after.filter((e) => !e.idle).length} of ${after.length} awake`);
  check(health < 100, 'enemies hurt the player', `health ${health.toFixed(0)}`);
  await shot(page, 'flow-fight');


  // Plain door opens when walked into.
  const doorInfo = await page.evaluate(() => {
    const g = window.__game.game;
    const d = g.world.cells.find((c) => c.door && !c.door.key && !c.door.tag && !c.door.secret);
    return { cx: d.cx, cy: d.cy };
  });
  await place(page, spots.door.x, spots.door.y, spots.door.yaw);
  await walk(page, 1200);
  const opened = await page.evaluate(() => window.__game.game.world.movers.some((c) => c.door && !c.door.key && !c.door.tag && c.door.open > 0.2));
  check(opened, 'a plain door opens on bump', `door near ${doorInfo.cx},${doorInfo.cy}`);

  // Key door refuses without the key and opens with it.
  await place(page, spots.keydoor.x, spots.keydoor.y, spots.keydoor.yaw);
  await walk(page, 1200);
  const shut = await page.evaluate(() => window.__game.game.world.movers.filter((c) => c.door && c.door.key).every((c) => c.door.open === 0));
  check(shut, 'key door stays shut without the key');
  await page.evaluate(() => { const g = window.__game.game; g.player.keys.amber = g.player.keys.cyan = g.player.keys.magenta = true; });
  await place(page, spots.keydoor.x, spots.keydoor.y, spots.keydoor.yaw);
  await walk(page, 1500);
  const keyOpen = await page.evaluate(() => window.__game.game.world.movers.some((c) => c.door && c.door.key && c.door.open > 0.2));
  check(keyOpen, 'key door opens with the key', keyOpen ? '' : JSON.stringify({ spot: spots.keydoor, p: await player(page), st: await page.evaluate(() => window.__game.game.state),
    doors: await page.evaluate(() => window.__game.game.world.movers.filter((c) => c.door && c.door.key).map((c) => [c.cx, c.cy, c.door.open, c.door.group && c.door.group.state])) }));
  await shot(page, 'flow-keydoor');

  // A tag-0 lift moves when stood on.
  const lift = await page.evaluate(() => {
    const c = window.__game.game.world.cells.find((c) => c.lift && !c.lift.tag);
    return c && { cx: c.cx, cy: c.cy, floor: c.floor };
  });
  if (check(!!lift, 'level 1 has a tag-0 lift')) {
    await place(page, lift.cx + 0.5, lift.cy + 0.5, 0);
    await page.waitForTimeout(2500);
    const after = await page.evaluate(([x, y]) => window.__game.game.world.cell(x, y).floor, [lift.cx, lift.cy]);
    check(Math.abs(after - lift.floor) > 0.4, 'lift carries the player', `${lift.floor} -> ${after.toFixed(2)}`);
  }

  // Death, dead screen, retry.
  await page.evaluate(() => { const p = window.__game.game.player; p.god = false; window.__game.game.hurtPlayer(999, undefined, undefined, true); });
  check(await waitState(page, 'dead', 5000), 'death shows the dead screen');
  await page.waitForTimeout(200);
  await shot(page, 'flow-dead');
  await tap(page, '[data-act="restart"]');
  check(await waitState(page, 'playing'), 'retry restarts the level');
  check((await player(page)).health > 0, 'health restored on retry');
  check(await page.evaluate(() => window.__game.game.player.god), 'god mode kept on retry');

  // Pause and resume through the touch PAUSE button.
  await tap(page, '.ti-pause');
  check(await waitState(page, 'paused', 3000), 'PAUSE button pauses');
  await shot(page, 'flow-pause');
  const fp = await page.evaluate(() => window.__game.game.time);
  await page.waitForTimeout(300);
  check(await page.evaluate(() => window.__game.game.time) === fp, 'game time stops while paused');
  await tap(page, '[data-act="resume"]');
  check(await waitState(page, 'playing'), 'Resume resumes');

  // Exit: walk into the exit switch, intermission, next level.
  await place(page, spots.exit.x, spots.exit.y, spots.exit.yaw);
  await walk(page, 1500);
  check(await waitState(page, 'intermission', 5000), 'exit leads to the intermission');
  await page.waitForTimeout(200);
  await shot(page, 'flow-intermission');
  await tap(page, '[data-act="next"]');
  check(await waitState(page, 'playing'), 'Next Level starts');
  check(await page.evaluate(() => window.__game.game.levelIndex) === 1, 'now on level 2');

  // Continue after a reload resumes level 2.
  check(await open(page, ''), 'reload');
  check(await page.locator('[data-act="continue"]').count() === 1, 'title offers Continue');
  await tap(page, '[data-act="continue"]');
  check(await waitState(page, 'playing'), 'Continue starts');
  check(await page.evaluate(() => window.__game.game.levelIndex) === 1, 'Continue resumes level 2');

  // Settings persist over a reload.
  await tap(page, '.ti-pause');
  await waitState(page, 'paused', 3000);
  await tap(page, '[data-act="go"][data-arg="settings"]');
  await shot(page, 'flow-settings');
  await tap(page, '.seg[data-set="quality"][data-value="400"]');
  await tap(page, '.seg[data-set="leftHanded"][data-value="true"]');
  check(await page.evaluate(() => document.getElementById('gl').height) === 400, 'quality applies at once');
  await page.waitForTimeout(150);
  await shot(page, 'flow-settings-changed');
  await open(page, '?autostart=1&level=2');
  await waitState(page, 'playing');
  check(await page.evaluate(() => document.getElementById('gl').height) === 400, 'quality persists over reload');
  await page.waitForTimeout(300);
  await shot(page, 'flow-lefthanded');
  await page.evaluate(() => localStorage.removeItem('slagworks.settings'));

  // The last level's exit leads to victory.
  await open(page, '?autostart=1&level=4&god=1');
  await waitState(page, 'playing');
  const exit4 = await page.evaluate(SPOT_FINDER).then((s) => s.exit);
  await place(page, exit4.x, exit4.y, exit4.yaw);
  await walk(page, 1500);
  check(await waitState(page, 'victory', 5000), 'last exit leads to victory');
  await page.waitForTimeout(200);
  await shot(page, 'flow-victory');
  check(await page.evaluate(() => localStorage.getItem('slagworks.save')) === null, 'victory clears the save');
  check(page.errors.length === 0, 'flow: no errors', page.errors.slice(0, 3).join(' | '));
}

// Hold the stick forward.
async function walk(page, ms) {
  const vp = page.viewportSize();
  const sx = 130, sy = vp.height - 110;
  await page.touch.start(3, sx, sy);
  for (let i = 1; i <= 6; i++) await page.touch.move(3, sx, sy - i * 10);
  await page.waitForTimeout(ms);
  await page.touch.end(3);
}

// ---------------------------------------------------------------- run

try {
  for (const [name, make] of only && only !== 'controls' ? [] : [
    ['land', () => iphonePage(browser, { landscape: true })],
    ['port', () => iphonePage(browser, { landscape: false })],
    ['desk', () => desktopPage(browser, { width: 1280, height: 720 })],
  ]) {
    const page = await make();
    if (name !== 'desk') page.touch = await touchDriver(page);
    await controlsTest(name, page);
    await page.context().close();
  }

  const page = await iphonePage(browser, { landscape: true });
  page.touch = await touchDriver(page);
  if (!only || only === 'levels') await levelsTest(page);
  if (!only || only === 'frametime') await frameTime(page);
  if (!only || only === 'flow') await flowTest(page);
  await page.context().close();
} catch (err) {
  check(false, 'test run', err.stack || String(err));
}

await browser.close();
server.close();
console.log(failures ? `\n${failures} failed` : '\nall passed');
console.log(`screenshots in ${outDir}`);
process.exit(failures ? 1 : 0);
