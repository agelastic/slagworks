// Checks the sprite packer and the item / prop / effect frames, and writes preview PNGs.
//   node tools/test-sprites-misc.mjs [outDir]
// The packer is exercised with the real item frames plus flat placeholder frames for enemies
// and weapons. When the enemy and weapon modules exist, the real buildSprites() is checked too.

import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { SPRITE_SIZES, SPRITE_NAMES } from '../src/config.js';
import { createSurface, fillRect, blit, hash2, hsl, upscale } from '../src/core/pix.js';
import { drawItemFrames } from '../src/assets/sprites/items.js';
import { packAtlas } from '../src/assets/sprites/pack.js';
import { writePNG, onChecker } from './png.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.resolve(process.argv[2] || path.join(root, 'out/sprites-misc'));

function checkAtlas({ atlas, frames }, sources) {
  const pow2 = (n) => n > 0 && (n & (n - 1)) === 0;
  assert.ok(pow2(atlas.w) && pow2(atlas.h) && atlas.w <= 2048 && atlas.h <= 2048, `atlas ${atlas.w}x${atlas.h}`);
  assert.equal(atlas.data.length, atlas.w * atlas.h * 4);
  assert.deepEqual(Object.keys(frames).sort(), [...SPRITE_NAMES].sort());
  for (let i = 3; i < atlas.data.length; i += 4) assert.ok(atlas.data[i] === 0 || atlas.data[i] === 255, 'partial alpha');
  const owner = new Int16Array(atlas.w * atlas.h).fill(-1);
  SPRITE_NAMES.forEach((name, index) => {
    const r = frames[name], want = SPRITE_SIZES[name];
    assert.equal(r.w, want.w, name);
    assert.equal(r.h, want.h, name);
    assert.ok(r.x >= 1 && r.y >= 1 && r.x + r.w < atlas.w && r.y + r.h < atlas.h, `${name} leaves the atlas`);
    // claim the frame plus 1 px to the right and below: any overlap or touching frame trips this
    for (let y = r.y; y <= r.y + r.h; y++) {
      for (let x = r.x; x <= r.x + r.w; x++) {
        const inside = x < r.x + r.w && y < r.y + r.h, k = y * atlas.w + x;
        if (inside) {
          assert.ok(owner[k] < 0, `${name} overlaps or touches ${SPRITE_NAMES[owner[k]]}`);
          owner[k] = index;
        } else assert.ok(owner[k] < 0 || owner[k] === index, `${name} touches ${SPRITE_NAMES[owner[k]]}`);
      }
    }
    if (!sources) return;
    const src = sources[name].data;
    let opaque = 0;
    for (let y = 0; y < r.h; y++) {
      for (let x = 0; x < r.w; x++) {
        const i = (y * r.w + x) * 4, o = ((r.y + y) * atlas.w + r.x + x) * 4;
        const a = src[i + 3] >= 128 ? 255 : 0;
        assert.equal(atlas.data[o + 3], a, `${name} alpha at ${x},${y}`);
        if (a) {
          opaque++;
          assert.ok(atlas.data[o] === src[i] && atlas.data[o + 1] === src[i + 1] && atlas.data[o + 2] === src[i + 2], `${name} colour at ${x},${y}`);
        }
      }
    }
    assert.ok(opaque > 0, `${name} is empty`);
  });
  // everything outside the frames is transparent
  for (let k = 0; k < owner.length; k++) if (owner[k] < 0) assert.equal(atlas.data[k * 4 + 3], 0, 'stray pixel outside frames');
}

// ---- item frames
const items = drawItemFrames();
const mine = SPRITE_NAMES.filter((n) => /^(it|pr|fx)_/.test(n));
assert.deepEqual(Object.keys(items).sort(), [...mine].sort(), 'drawItemFrames returns exactly the it_/pr_/fx_ frames');
for (const name of mine) {
  const s = items[name], want = SPRITE_SIZES[name];
  assert.ok(s.w === want.w && s.h === want.h, `${name} size`);
  let top = s.h, bottom = -1, count = 0;
  for (let y = 0; y < s.h; y++) {
    for (let x = 0; x < s.w; x++) {
      const a = s.data[(y * s.w + x) * 4 + 3];
      assert.ok(a === 0 || a === 255, `${name} partial alpha`);
      if (a) { count++; top = Math.min(top, y); bottom = y; }
    }
  }
  assert.ok(count > 0, `${name} is empty`);
  if (want.anchor === 'bottom') assert.equal(bottom, s.h - 1, `${name} floats above its anchor`);
  if (want.anchor === 'top') assert.equal(top, 0, `${name} hangs below its anchor`);
}
const again = drawItemFrames();
for (const name of mine) assert.deepEqual(again[name].data, items[name].data, `${name} is not deterministic`);
console.log(`items: ${mine.length} frames ok`);

// ---- packer with placeholders for the frames other modules draw
const all = { ...items };
SPRITE_NAMES.forEach((name, i) => {
  if (all[name]) return;
  const { w, h } = SPRITE_SIZES[name];
  const s = createSurface(w, h, hsl(i * 47, 0.5, 0.45));
  fillRect(s, 2, 2, w - 4, h - 4, hsl(i * 47, 0.5, 0.3));
  // some soft alpha the packer has to harden
  for (let x = 0; x < w; x++) { s.data[x * 4 + 3] = 200; s.data[((h - 1) * w + x) * 4 + 3] = 60; }
  all[name] = s;
});
const packed = packAtlas(all);
checkAtlas(packed, all);
assert.ok(packed.atlas.w === 1024 && packed.atlas.h === 1024, 'expected the 1024 atlas');
assert.deepEqual(packAtlas(all).frames, packed.frames, 'packing is not deterministic');
let used = 0;
for (const name of SPRITE_NAMES) used += SPRITE_SIZES[name].w * SPRITE_SIZES[name].h;
console.log(`packer: ${SPRITE_NAMES.length} frames in ${packed.atlas.w}x${packed.atlas.h}, ${(used / (packed.atlas.w * packed.atlas.h) * 100).toFixed(0)}% used`);
console.log(`wrote ${writePNG(path.join(out, 'atlas-placeholder.png'), onChecker(packed.atlas, 8))}`);

const { it_medkit: _dropped, ...missing } = all;
assert.throws(() => packAtlas(missing), /it_medkit: missing/);
assert.throws(() => packAtlas({ ...all, pr_drum: createSurface(26, 40, '#f00'), fx_bolt0: createSurface(8, 8, '#f00') }),
  (err) => /pr_drum: is 26x40, expected 26x38/.test(err.message) && /fx_bolt0: is 8x8, expected 16x16/.test(err.message));
const warn = console.warn;
let warned = '';
console.warn = (msg) => { warned += msg; };
const withExtra = packAtlas({ ...all, not_a_frame: createSurface(4, 4, '#f00') });
console.warn = warn;
assert.ok(!withExtra.frames.not_a_frame && /not_a_frame/.test(warned), 'unknown frames are dropped with a warning');
console.log('packer: error cases ok');

// ---- preview: pickups and props on a dark floor at 1x and 0.5x, in full and in dim light
{
  const names = mine.filter((n) => !n.startsWith('fx_'));
  const W = names.reduce((sum, n) => sum + SPRITE_SIZES[n].w + 6, 6), rowH = 84;
  const sheet = createSurface(W, rowH * 3 + 50);
  for (let y = 0; y < sheet.h; y++) {
    for (let x = 0; x < sheet.w; x++) {
      const v = 22 + hash2(x >> 2, y >> 2, 3) * 14;
      fillRect(sheet, x, y, 1, 1, [v, v * 0.95, v * 0.9]);
    }
  }
  let x = 6;
  for (const n of names) {
    const s = items[n];
    blit(sheet, s, x, rowH - s.h - 4);
    blit(sheet, s, x, rowH * 2 - s.h - 4, { tint: [140, 140, 140] });
    blit(sheet, s, x, rowH * 3 - s.h - 4, { tint: [80, 80, 80] });
    const half = createSurface(Math.ceil(s.w / 2), Math.ceil(s.h / 2));
    for (let j = 0; j < half.h; j++) {
      for (let i = 0; i < half.w; i++) half.data.set(s.data.subarray(((j * 2) * s.w + i * 2) * 4, ((j * 2) * s.w + i * 2) * 4 + 4), (j * half.w + i) * 4);
    }
    blit(sheet, half, x, rowH * 3 + 46 - half.h);
    x += s.w + 6;
  }
  console.log(`wrote ${writePNG(path.join(out, 'preview-dark.png'), upscale(sheet, 2))}`);
}

// ---- the real atlas, once the other sprite modules are there
const others = ['enemies.js', 'weapons.js'].filter((f) => !fs.existsSync(path.join(root, 'src/assets/sprites', f)));
if (others.length) {
  console.log(`real buildSprites() not run: src/assets/sprites/${others.join(' and ')} not written yet`);
} else {
  const { buildSprites } = await import(pathToFileURL(path.join(root, 'src/assets/sprites.js')).href);
  const t0 = performance.now();
  const built = buildSprites();
  const ms = performance.now() - t0;
  checkAtlas(built, null);
  assert.deepEqual(buildSprites().atlas.data, built.atlas.data, 'buildSprites is not deterministic');
  console.log(`buildSprites: ${built.atlas.w}x${built.atlas.h}, ${Object.keys(built.frames).length} frames, ${ms.toFixed(0)} ms`);
  console.log(`wrote ${writePNG(path.join(out, 'atlas.png'), onChecker(built.atlas, 8))}`);
}
console.log('test-sprites-misc: passed');
