// Foundation self-check: config/rng/pix in Node, PNG round trip, static server, headless WebGL + touch.
//   node tools/test-foundation.mjs [outDir]

import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as config from '../src/config.js';
import { createRng } from '../src/core/rng.js';
import * as pix from '../src/core/pix.js';
import { writePNG, readPNG, upscale, onChecker } from './png.mjs';
import { startServer } from './serve.mjs';
import { launchBrowser, iphonePage, screenshot, touchDriver } from './browser.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.resolve(process.argv[2] || path.join(root, 'out/foundation'));

// ---- config
{
  const { TEXTURE_NAMES, SPRITE_SIZES, SPRITE_NAMES, SOUND_IDS, THING_CHARS, ENEMY_TYPES, WEAPON_IDS } = config;
  assert.equal(TEXTURE_NAMES.length, 34);
  assert.equal(new Set(TEXTURE_NAMES).size, TEXTURE_NAMES.length);
  // 4 enemies x 11 + overseer 12, 16 items, 5 props, 24 effect frames, 19 weapon frames
  assert.equal(SPRITE_NAMES.length, 44 + 12 + 16 + 5 + 24 + 19);
  assert.deepEqual(SPRITE_SIZES.overseer_die4, { w: 120, h: 132, anchor: 'bottom' });
  assert.deepEqual(SPRITE_SIZES.pr_cable, { w: 12, h: 64, anchor: 'top' });
  assert.deepEqual(SPRITE_SIZES.fx_explode5, { w: 72, h: 72, anchor: 'center' });
  assert.deepEqual(SPRITE_SIZES.wp_scatter_fire3, { w: 150, h: 110, anchor: 'bottom' });
  assert.equal(SPRITE_SIZES.wp_rivet_fire2, undefined);
  assert.equal(SOUND_IDS.length, 34 + 20);
  assert.equal(new Set(SOUND_IDS).size, SOUND_IDS.length);
  assert.equal(Object.keys(THING_CHARS).length, 27);
  for (const [ch, t] of Object.entries(THING_CHARS)) {
    assert.equal(ch.length, 1);
    if (t.sprite) assert.ok(SPRITE_SIZES[t.sprite], `sprite for '${ch}'`);
    if (t.kind === 'enemy') assert.ok(ENEMY_TYPES.includes(t.type));
    if (t.kind === 'weapon') assert.ok(WEAPON_IDS.includes(t.type));
  }
  const area = SPRITE_NAMES.reduce((a, n) => a + (SPRITE_SIZES[n].w + 1) * (SPRITE_SIZES[n].h + 1), 0);
  console.log(`config ok: ${TEXTURE_NAMES.length} textures, ${SPRITE_NAMES.length} sprite frames `
    + `(${area} px with padding, ${(area / (1024 * 1024) * 100).toFixed(0)}% of 1024x1024), ${SOUND_IDS.length} sounds`);
}

// ---- rng
{
  const a = createRng(42), b = createRng(42), c = createRng(43);
  const seq = Array.from({ length: 5 }, () => a.next());
  assert.deepEqual(seq, Array.from({ length: 5 }, () => b.next()));
  assert.notDeepEqual(seq, Array.from({ length: 5 }, () => c.next()));
  const r = createRng(7);
  let sum = 0;
  const seen = new Set();
  for (let i = 0; i < 20000; i++) {
    const v = r.next();
    assert.ok(v >= 0 && v < 1);
    sum += v;
    const k = r.int(10, 15);
    assert.ok(Number.isInteger(k) && k >= 10 && k <= 15);
    seen.add(k);
    const f = r.range(-2, 3);
    assert.ok(f >= -2 && f < 3);
  }
  assert.equal(seen.size, 6);
  assert.ok(Math.abs(sum / 20000 - 0.5) < 0.01);
  assert.ok(['x', 'y'].includes(r.pick(['x', 'y'])));
  assert.equal(r.chance(0), false);
  assert.equal(r.chance(1), true);
  const saved = r.state, next = r.next();
  r.state = saved;
  assert.equal(r.next(), next);
  console.log('rng ok');
}

// ---- pix
{
  const P = pix;
  const s = P.createSurface(8, 8);
  P.setPx(s, 20, 20, '#fff');
  assert.deepEqual(P.getPx(s, 20, 20), [0, 0, 0, 0]);
  s.wrap = true;
  P.setPx(s, 9, -1, '#ff8000');
  assert.deepEqual(P.getPx(s, 1, 7), [255, 128, 0, 255]);
  s.wrap = false;
  P.setPx(s, 1, 7, [0, 0, 0, 128]);
  assert.deepEqual(P.getPx(s, 1, 7), [127, 64, 0, 255]);
  s.atop = true;
  P.fillRect(s, 0, 0, 8, 8, '#00f');
  assert.deepEqual(P.getPx(s, 1, 7), [0, 0, 255, 255]);
  assert.deepEqual(P.getPx(s, 0, 0), [0, 0, 0, 0]);
  assert.deepEqual(P.hex('#0f08'), [0, 255, 0, 136]);
  assert.deepEqual(P.toColor(0x102030), [16, 32, 48, 255]);
  assert.deepEqual(P.mix('#000', '#fff', 0.5), [127.5, 127.5, 127.5, 255]);

  // tileable noise: value at the right/bottom edge continues into the left/top edge
  let worst = 0;
  for (let i = 0; i < 64; i++) {
    const e = 1 / 16;
    worst = Math.max(worst,
      Math.abs(P.fbmTile(4 - e / 2, i / 16, 4, 4, 5) - P.fbmTile(-e / 2, i / 16, 4, 4, 5)),
      Math.abs(P.fbmTile(i / 16, 4 + 0.3, 4, 4, 5) - P.fbmTile(i / 16, 0.3, 4, 4, 5)));
  }
  assert.ok(worst < 1e-9, `fbmTile seam ${worst}`);
  const nm = P.noiseMap(64, 64, { seed: 9, cells: 4 });
  let seam = 0, inner = 0;
  for (let y = 0; y < 64; y++) {
    seam += Math.abs(nm[y * 64 + 63] - nm[y * 64]);
    inner += Math.abs(nm[y * 64 + 31] - nm[y * 64 + 32]);
  }
  assert.ok(seam < inner * 2.5, `noiseMap seam ${seam} vs inner ${inner}`);

  // outline + text + polygon inclusive vertices
  const o = P.createSurface(5, 5);
  P.setPx(o, 2, 2, '#fff');
  P.outline(o, '#000');
  assert.deepEqual(P.getPx(o, 2, 1), [0, 0, 0, 255]);
  assert.deepEqual(P.getPx(o, 1, 1), [0, 0, 0, 0]);
  assert.equal(P.textWidth('AB'), 7);
  assert.equal(P.textWidth('M1'), 9);
  const q = P.createSurface(8, 8);
  P.fillPoly(q, [[1, 1], [6, 1], [6, 6], [1, 6]], '#fff8');
  let filled = 0;
  for (let i = 3; i < q.data.length; i += 4) {
    if (q.data[i]) { filled++; assert.equal(q.data[i], 136); }
  }
  assert.equal(filled, 36);
  console.log('pix ok');
}

// ---- test picture: every primitive, written as PNG and read back
{
  const P = pix;
  const W = 192, H = 128;
  const s = P.createSurface(W, H, '#15171c');

  // tileable noise panel, 2 x 2 repeats so the seams would be visible
  const n = P.noiseMap(32, 32, { seed: 11, cells: 4, octaves: 4 });
  for (let y = 0; y < 64; y++) {
    for (let x = 0; x < 64; x++) {
      const v = n[(y % 32) * 32 + (x % 32)];
      P.setPx(s, x, y, P.ramp(['#1a0d08', '#5a2a14', '#b0582a', '#ffae1a'], v));
    }
  }
  // dithered gradient + posterised copy
  P.gradRect(s, 66, 0, 30, 30, ['#101820', '#22d6e6'], 'v', true);
  P.gradRect(s, 98, 0, 30, 30, ['#101820', '#22d6e6', '#ffffff'], 'h');
  // bevelled plate with rivets
  P.fillRect(s, 66, 34, 62, 28, '#4a5058');
  P.bevel(s, 66, 34, 62, 28, P.lighten('#4a5058', 0.35), P.darken('#4a5058', 0.45));
  for (const [x, y] of [[70, 38], [123, 38], [70, 57], [123, 57]]) {
    P.fillCircle(s, x, y, 1, '#8a929c');
    P.setPx(s, x + 1, y + 1, '#22262c');
  }
  P.drawText(s, 'SLAGWORKS', 72, 42, '#ffae1a');
  P.drawText(s, 'BAY 07 - 3.5%', 72, 50, '#c8ccd2');
  // shapes
  P.fillCircle(s, 147.5, 15.5, 13, '#e83ac2');
  P.strokeCircle(s, 147.5, 15.5, 13, '#fff');
  P.fillEllipse(s, 176, 15, 12, 7, '#22d6e6');
  P.strokeEllipse(s, 176, 15, 12, 7, '#063a40');
  P.fillPoly(s, [[134, 60], [150, 34], [166, 60]], '#ffae1a');
  P.strokePoly(s, [[134, 60], [150, 34], [166, 60]], '#3a2400');
  P.line(s, 170, 34, 190, 60, '#ffffff');
  P.line(s, 190, 34, 170, 60, '#ff4030', 3);
  P.strokeRect(s, 168, 32, 24, 30, '#808890');
  // translucent overlay
  P.fillRect(s, 20, 20, 40, 20, [0, 0, 0, 120]);
  P.drawText(s, 'ALPHA', 30, 27, '#fff');

  // a small sprite: built on transparency, mirrored, shaded atop, outlined, blitted twice
  const sp = P.createSurface(24, 28);
  P.fillRect(sp, 4, 9, 8, 12, '#6a727c');
  P.fillRect(sp, 6, 2, 6, 6, '#8a929c');
  P.fillRect(sp, 2, 10, 2, 9, '#50565e');
  P.fillRect(sp, 6, 21, 4, 6, '#50565e');
  P.setPx(sp, 9, 4, '#ffae1a');
  P.mirrorX(sp);
  sp.atop = true;
  P.gradRect(sp, 0, 0, 24, 28, [[255, 255, 255, 50], [0, 0, 0, 0], [0, 0, 0, 110]], 'h');
  sp.atop = false;
  P.outline(sp);
  P.hardenAlpha(sp);
  P.blit(s, P.upscale(sp, 2), 4, 68);
  P.blit(s, sp, 56, 96);
  P.blit(s, sp, 84, 96, { flipX: true, tint: '#ff8060' });
  // posterised noise + palette snap
  const pal = ['#15171c', '#3a3f46', '#6a727c', '#b0582a', '#ffae1a', '#22d6e6'];
  const m = P.createSurface(64, 56);
  P.shade(m, (x, y) => P.hsl(200 + 160 * P.fbm(x / 12, y / 12, 4), 0.6, 0.15 + 0.6 * P.valueNoise(x / 6, y / 6, 2)));
  P.blit(s, P.clone(m), 124, 68, { sw: 32 });
  P.toPalette(m, pal, 0.6);
  P.blit(s, m, 156, 68, { sx: 32, sw: 32 });
  P.drawText(s, 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', 56, 68, '#c8ccd2');
  P.drawText(s, "0123456789 .,:!?-+/%#()[]'=<>*_", 56, 76, '#8a929c');
  P.drawText(s, 'x2', 56, 84, '#22d6e6', 2);

  const file = writePNG(path.join(out, 'pix-test.png'), upscale(s, 4));
  const back = readPNG(file);
  assert.equal(back.w, W * 4);
  assert.deepEqual([...back.data.subarray(0, 4)], [...s.data.subarray(0, 4)]);
  writePNG(path.join(out, 'pix-sprite.png'), onChecker(upscale(sp, 8), 8));
  for (let i = 3; i < sp.data.length; i += 4) assert.ok(sp.data[i] === 0 || sp.data[i] === 255);
  console.log(`pix picture -> ${file}`);
}

// ---- server + headless Chrome
{
  const server = await startServer(root, 0);
  for (const [rel, type] of [['src/config.js', 'text/javascript'], ['package.json', 'application/json'],
    ['tools/test-foundation.html', 'text/html'], ['tools/png.mjs', 'text/javascript']]) {
    const res = await fetch(server.url + rel);
    assert.equal(res.status, 200, rel);
    assert.ok(res.headers.get('content-type').startsWith(type), `${rel}: ${res.headers.get('content-type')}`);
    assert.equal(res.headers.get('cache-control'), 'no-store');
  }
  assert.equal((await fetch(server.url + 'nope.js')).status, 404);
  assert.equal((await fetch(server.url + '..%2f..%2fetc/passwd')).status, 403);
  console.log(`server ok on ${server.url}`);

  const browser = await launchBrowser();
  try {
    for (const landscape of [true, false]) {
      const page = await iphonePage(browser, { landscape });
      await page.goto(server.url + 'tools/test-foundation.html');
      await page.waitForFunction(() => window.result && (window.result.ok || window.result.why));
      await page.waitForFunction(() => window.result.frames > 5);
      const r = await page.evaluate(() => window.result);
      assert.ok(r.ok, r.why);
      assert.equal(r.glError, 0);
      assert.ok(r.triangle[0] > 60 && r.triangle[1] > 60 && r.triangle[2] < 80, `triangle ${r.triangle}`);
      assert.deepEqual(r.background, [13, 13, 20, 255]);
      assert.deepEqual(r.texStripe, [255, 174, 26, 255]);
      const env = await page.evaluate(() => ({
        w: innerWidth, h: innerHeight, dpr: devicePixelRatio,
        touch: 'ontouchstart' in window, coarse: matchMedia('(pointer: coarse)').matches,
        ua: navigator.userAgent.includes('iPhone'),
      }));
      assert.deepEqual(env, landscape
        ? { w: 844, h: 390, dpr: 3, touch: true, coarse: true, ua: true }
        : { w: 390, h: 844, dpr: 3, touch: true, coarse: true, ua: true });

      if (landscape) {
        const t = await touchDriver(page);
        await t.start(1, 100, 300);
        await t.start(2, 700, 200);
        await t.move(1, 140, 260);
        await t.end(1);
        await t.move(2, 650, 180);
        await t.end(2);
        await t.tap(400, 100);
        const ev = (await page.evaluate(() => window.result.touches)).map((e) => `${e.type}:${e.changed}:${e.active}`);
        assert.deepEqual(ev, [
          'touchstart:1:1', 'touchstart:2:2', 'touchmove:1:2', 'touchend:1:1',
          'touchmove:2:1', 'touchend:2:0', 'touchstart:99:1', 'touchend:99:0',
        ]);
        assert.ok((await page.evaluate(() => window.result.touches)).every((e) => e.trusted));
        console.log(`webgl ok: ${r.renderer}, max texture ${r.maxTextureSize}`);
        console.log('multi-touch ok');
      }
      const shot = await screenshot(page, path.join(out, `webgl-${landscape ? 'landscape' : 'portrait'}.png`));
      const img = readPNG(shot);
      assert.equal(img.w, landscape ? 844 : 390);
      // the screenshot must show the GL frame: amber stripe at the top right of the canvas
      const px = (x, y) => [...img.data.subarray((y * img.w + x) * 4, (y * img.w + x) * 4 + 3)];
      const stripe = px(Math.round(img.w * 0.75), 1);
      assert.ok(stripe[0] > 200 && stripe[1] > 130 && stripe[2] < 80, `screenshot stripe ${stripe}`);
      assert.deepEqual(page.errors, []);
      await page.context().close();
    }
    console.log(`screenshots -> ${out}`);
  } finally {
    await browser.close();
    await server.close();
  }
}

console.log('foundation checks passed');
