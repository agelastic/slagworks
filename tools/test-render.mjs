// Renderer checks: mesh sanity in Node, then screenshots of the test page in headless Chrome.
//
//   node tools/test-render.mjs [--out dir] [--mode mock|real] [--level n] [--only text]
//                              [--suite views,doors,lift,sky,weapons,light,switch,lost,emu,bench]
//
// Frames are saved at the internal resolution, upscaled 3x so they are easy to look at.

import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Batches, emitCell, VERT_FLOATS } from '../src/render/mesh.js';
import { buildWorld, setDoor, setLift } from './test-render.mock.js';
import { createSurface, blit, drawText } from '../src/core/pix.js';
import { decodePNG, writePNG, upscale } from './png.mjs';
import { startServer } from './serve.mjs';
import { launchBrowser, iphonePage, desktopPage } from './browser.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const opt = (name, def) => {
  const i = args.indexOf(`--${name}`);
  return i < 0 ? def : args[i + 1];
};
const out = path.resolve(opt('out', path.join(root, 'out/render')));
const mode = opt('mode', 'mock');
const level = Number(opt('level', 0));
const only = opt('only', '');
const suites = new Set(opt('suite', mode === 'mock'
  ? 'views,doors,lift,sky,weapons,light,switch,lost,emu,bench' : 'views,weapons,bench').split(','));

// ---------------------------------------------------------------- mesh checks (Node)

// Every quad must face into the cell that owns it, be non-degenerate and keep small UVs.
function checkMesh(world, label) {
  let quads = 0;
  for (const cell of world.cells) {
    const b = new Batches();
    emitCell(world, cell, b);
    for (const batch of b.list) {
      assert.ok(batch.tex, `${label}: quad without texture in cell ${cell.cx},${cell.cy}`);
      for (let o = 0; o < batch.n; o += 6 * VERT_FLOATS) {
        const d = batch.data;
        const v = (k) => [d[o + k * 7], d[o + k * 7 + 1], d[o + k * 7 + 2]];
        const [p0, p1, p2] = [v(0), v(1), v(2)];
        const e1 = p1.map((x, i) => x - p0[i]), e2 = p2.map((x, i) => x - p0[i]);
        const n = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
        const len = Math.hypot(...n);
        assert.ok(len > 1e-6, `${label}: degenerate quad in cell ${cell.cx},${cell.cy}`);
        // centre of the quad relative to the centre of the cell's air space
        const c = [0, 0, 0];
        for (let k = 0; k < 6; k++) v(k).forEach((x, i) => { c[i] += x / 6; });
        const mid = [cell.cx + 0.5, cell.cy + 0.5, (cell.floor + cell.ceil) / 2];
        const outward = c.map((x, i) => x - mid[i]);
        const dot = n[0] * outward[0] + n[1] * outward[1] + n[2] * outward[2];
        assert.ok(dot > 0, `${label}: quad of ${batch.tex} in cell ${cell.cx},${cell.cy} faces the wrong way`);
        for (let k = 0; k < 6; k++) {
          const u = d[o + k * 7 + 3], t = d[o + k * 7 + 4];
          assert.ok(u >= 0 && u <= 1, `${label}: u ${u}`);
          assert.ok(Math.abs(t) <= 4, `${label}: v ${t} in cell ${cell.cx},${cell.cy}`);
          assert.ok(d[o + k * 7 + 2] >= cell.floor - 1e-6 && d[o + k * 7 + 2] <= cell.ceil + 1e-6,
            `${label}: quad outside the cell's height range in ${cell.cx},${cell.cy}`);
        }
        quads++;
      }
    }
  }
  return quads;
}

{
  const world = buildWorld();
  let quads = checkMesh(world, 'mock');
  for (const t of [0, 0.3, 1]) {
    for (const m of world.movers) {
      if (m.door) setDoor(m, t);
      else setLift(m, t);
    }
    quads = Math.max(quads, checkMesh(world, `mock movers at ${t}`));
  }
  // door slab texture is fixed to the slab bottom, lift riser texture to the platform edge
  const w2 = buildWorld();
  const vAt = (cellXY, tex, pick) => {
    const b = new Batches();
    emitCell(w2, w2.cell(...cellXY), b);
    const batch = b.byTex.get(tex);
    assert.ok(batch && batch.n, `no ${tex} quad in cell ${cellXY}`);
    return pick(batch.data);
  };
  const frac = (x) => x - Math.floor(x);
  for (const open of [0, 0.2, 0.55, 1 - 1e-9]) {
    setDoor(w2.cell(6, 2), open);
    // vertex 0 is bottom-left: v there must be a whole number (texture bottom row ends at the slab bottom)
    const vb = vAt([5, 2], 'w_door', (d) => d[4]);
    assert.ok(Math.min(frac(vb), 1 - frac(vb)) < 1e-6, `door slab v at bottom ${vb} (open ${open})`);
  }
  for (const t of [0.1, 0.5, 0.83, 1]) {
    setLift(w2.cell(13, 5), t);
    // vertex 2 is top-right: v there must be a whole number (texture top row starts at the platform edge)
    const vt = vAt([12, 5], 'w_hazard', (d) => d[2 * 7 + 4]);
    assert.ok(Math.min(frac(vt), 1 - frac(vt)) < 1e-6, `lift riser v at top ${vt} (t ${t})`);
  }
  console.log(`mesh ok: mock world, ${quads} quads, all faces point into their cell`);
}

if (mode === 'real') {
  const { loadLevelNode } = await import('./test-render.real.js');
  for (let i = 0; i < 4; i++) {
    const world = await loadLevelNode(i);
    console.log(`mesh ok: level ${i}, ${checkMesh(world, `level ${i}`)} quads`);
  }
}

// ---------------------------------------------------------------- browser

const server = await startServer(root, 0);
const browser = await launchBrowser();
let failed = false;

async function openPage(query, { landscape = true, desktop = null } = {}) {
  const page = desktop ? await desktopPage(browser, desktop) : await iphonePage(browser, { landscape });
  await page.goto(`${server.url}tools/test-render.html?mode=${mode}&level=${level}${query}`);
  await page.waitForFunction(() => window.T && (window.T.ready || window.T.error), null, { timeout: 60000 });
  const error = await page.evaluate(() => window.T.error);
  if (error) throw new Error(`page failed: ${error}`);
  return page;
}

const saved = [];
function savePng(name, dataUrl, scale = 3) {
  const img = decodePNG(Buffer.from(dataUrl.split(',')[1], 'base64'));
  writePNG(path.join(out, `${name}.png`), scale > 1 ? upscale(img, scale) : img);
  saved.push({ name, img });
  return img;
}

// 2 x 2 contact sheets at 2x of everything saved since the last call.
function sheets(label) {
  for (let i = 0, k = 0; i < saved.length; i += 4, k++) {
    const group = saved.slice(i, i + 4);
    const w = Math.max(...group.map((g) => g.img.w)), h = Math.max(...group.map((g) => g.img.h));
    const sheet = createSurface(w * 4 + 6, h * 4 + 6, '#ff00ff');
    group.forEach((g, j) => {
      const big = upscale(g.img, 2);
      drawText(big, g.name, 4, 4, '#000000', 2);
      drawText(big, g.name, 3, 3, '#ffffff', 2);
      blit(sheet, big, (j % 2) * (w * 2 + 6), Math.floor(j / 2) * (h * 2 + 6));
    });
    writePNG(path.join(out, `sheet-${label}-${k}.png`), sheet);
  }
  saved.length = 0;
}

const shot = (page, name, view, over = {}, scale = 3) => page
  .evaluate(([v, o]) => window.T.shot(v, o), [view, over])
  .then((url) => savePng(name, url, scale));

function diff(a, b) {
  assert.equal(a.w, b.w);
  let n = 0;
  for (let i = 0; i < a.data.length; i += 4) {
    if (Math.abs(a.data[i] - b.data[i]) + Math.abs(a.data[i + 1] - b.data[i + 1]) + Math.abs(a.data[i + 2] - b.data[i + 2]) > 24) n++;
  }
  return n / (a.w * a.h);
}

try {
  const page = await openPage('');
  const names = (await page.evaluate(() => window.T.names)).filter((n) => n.includes(only));
  const info = await page.evaluate(() => ({ gl: window.T.glInfo(), size: window.T.size() }));
  console.log(`gl: ${info.gl.renderer}, depth ${info.gl.depthBits} bits, fragment precision bits `
    + `highp ${info.gl.highpFragment} mediump ${info.gl.mediumpFragment}, internal ${info.size.join('x')}`);
  const prefix = mode === 'real' ? `l${level}-` : '';

  if (suites.has('views')) {
    for (const name of names) await shot(page, `${prefix}${name}`, name);
    console.log(`views: ${names.length} -> ${out}`);
    sheets(`${prefix}views`);
  }

  if (suites.has('doors')) {
    for (const open of [0, 0.25, 0.5, 0.75, 1]) {
      await page.evaluate((o) => window.T.setDoor(6, 2, o), open);
      await shot(page, `door-${open * 100}`, 'room-doors', { cam: { x: 4.2, y: 2.5 } });
      await shot(page, `door-back-${open * 100}`, 'hall-doors', { cam: { x: 8.2, y: 2.5 } });
    }
    await page.evaluate(() => window.T.setDoor(6, 2, 0));
    sheets('doors');
  }

  if (suites.has('lift')) {
    for (const t of [0, 0.25, 0.5, 0.75, 1]) {
      await page.evaluate((v) => window.T.setLift(13, 5, v), t);
      await shot(page, `lift-${t * 100}`, 'hall-lift', { cam: { x: 11.2 } });
    }
    await page.evaluate(() => window.T.setLift(13, 5, 0.5));
    sheets('lift');
  }

  if (suites.has('sky')) {
    await page.evaluate(() => window.T.setSkyHeight(1.25));
    for (const yaw of [0, 45, 90, 135, 180, 270, 359, 361]) {
      await shot(page, `sky-${yaw}`, 'yard-ne', { cam: { x: 20.5, y: 3.5, z: 2.12, yaw: (yaw * Math.PI) / 180 } });
    }
    await page.evaluate(() => window.T.setSkyHeight(null));
    sheets('sky');
  }

  if (suites.has('weapons')) {
    const ids = ['wrench', 'rivet', 'scatter', 'bolt', 'launcher'];
    const view = names.includes('room-doors') ? 'room-doors' : names[0];
    for (const id of ids) {
      const weapon = await page.evaluate((w) => window.T.weapon(w), id);
      await shot(page, `${prefix}weapon-${id}`, view, { weapon });
    }
    const fire = await page.evaluate(() => window.T.weapon('scatter', 'fire0', 6, 4));
    await shot(page, `${prefix}weapon-fire`, view, { weapon: fire, extraLight: 0.35 });
    const lowered = await page.evaluate(() => window.T.weapon('launcher', 'idle', 0, 60, 0.3));
    await shot(page, `${prefix}weapon-lowered`, view, { weapon: lowered });
    // other internal sizes: portrait box and the high quality setting
    const portrait = await openPage('', { landscape: false });
    await portrait.setViewportSize({ width: 390, height: 292 });
    await portrait.evaluate(() => window.T.renderer.resize(390, 292));
    const w1 = await portrait.evaluate(() => window.T.weapon('bolt'));
    await shot(portrait, `${prefix}weapon-portrait`, view, { weapon: w1 });
    console.log(`portrait box 390x292 -> internal ${(await portrait.evaluate(() => window.T.size())).join('x')}`);
    await portrait.context().close();
    const high = await openPage('&h=400');
    const w2 = await high.evaluate(() => window.T.weapon('launcher'));
    await shot(high, `${prefix}weapon-h400`, view, { weapon: w2 }, 2);
    console.log(`quality 400 -> internal ${(await high.evaluate(() => window.T.size())).join('x')}`);
    await high.context().close();
    const wide = await openPage('', { desktop: { width: 1600, height: 500 } });
    const w3 = await wide.evaluate(() => window.T.weapon('scatter'));
    await shot(wide, `${prefix}weapon-wide`, view, { weapon: w3 });
    console.log(`wide box 1600x500 -> internal ${(await wide.evaluate(() => window.T.size())).join('x')} (clamped)`);
    await wide.context().close();
    sheets(`${prefix}weapons`);
  }

  if (suites.has('light')) {
    await shot(page, 'light-extra', 'room-doors', { extraLight: 0.35 });
    for (const t of [0, 0.08, 0.16, 0.24, 0.32, 0.4]) await shot(page, `flicker-${t * 100}`, 'corridor-flicker', { time: t });
    for (const t of [0, 0.25, 0.5, 0.75]) await shot(page, `anim-${t * 100}`, 'pit-from-room', { time: t });
    sheets('light');
  }

  if (suites.has('switch')) {
    const a = await shot(page, 'switch-off', 'switch');
    await page.evaluate(() => window.T.setWall(6, 6, 'w_switch_on'));
    const b = await shot(page, 'switch-on', 'switch');
    await page.evaluate(() => window.T.setWall(6, 6, 'w_switch_off'));
    assert.ok(diff(a, b) > 0.01, 'switch texture change did not show up');
    console.log('switch: static mesh rebuilt on world.version change');
  }

  if (suites.has('lost')) {
    const view = names[0];
    const a = await shot(page, 'lost-before', view);
    await page.evaluate(() => window.T.loseContext());
    const b = await shot(page, 'lost-after', view);
    assert.equal(diff(a, b), 0, 'frame differs after context restore');
    console.log('context loss: restored, frame identical');
  }

  if (suites.has('emu')) {
    const emu = await openPage('&emu=1');
    let worst = 0;
    for (const name of names) {
      const a = await shot(page, `emu-ref-${name}`, name, {}, 1);
      const b = await shot(emu, `emu-${name}`, name, {}, 3);
      worst = Math.max(worst, diff(a, b));
    }
    console.log(`mediump emulation: worst view differs in ${(worst * 100).toFixed(2)}% of pixels`);
    await emu.context().close();
  }

  if (suites.has('bench')) {
    for (const h of [240, 400]) {
      const p = h === 240 ? page : await openPage(`&h=${h}`);
      let worst = null;
      for (const name of names) {
        const r = await p.evaluate((v) => window.T.bench(v, 120), name);
        if (!worst || r.sync > worst.sync) worst = { name, ...r };
      }
      const raf = await p.evaluate((v) => window.T.raf(v, 2), worst.name);
      console.log(`bench h=${h} (${(await p.evaluate(() => window.T.size())).join('x')}): heaviest view ${worst.name}: `
        + `render() ${worst.js.toFixed(3)} ms JS, ${worst.sync.toFixed(3)} ms with GPU sync; `
        + `rAF median ${raf.median.toFixed(2)} ms, p95 ${raf.p95.toFixed(2)} ms, max ${raf.max.toFixed(2)} ms`);
      if (p !== page) await p.context().close();
    }
  }

  if (page.errors.length) {
    failed = true;
    console.log('page errors:\n' + page.errors.join('\n'));
  }
} catch (e) {
  failed = true;
  console.error(e);
} finally {
  await browser.close();
  await server.close();
}
process.exit(failed ? 1 : 0);
