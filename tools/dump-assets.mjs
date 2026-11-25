// Write generated art as PNGs so it can be looked at, and check it against config.js.
//
//   node tools/dump-assets.mjs textures [--only <prefix>] [--tile <name>[,<name>...]] [--frame n]
//       textures.png        contact sheet, TEXTURE_NAMES order, every animation frame, 3x
//       tile-<name>.png     3 x 3 repeat at 4x, to check seams
//   node tools/dump-assets.mjs sprites [--only <prefix>]
//       sprites-atlas.png   the atlas on a checker background, 1x
//       sprites-<prefix>.png   with --only: the matching frames cut out, labelled, 3x
//   node tools/dump-assets.mjs --module <path> --export <fn> [--only <prefix>] [--name <file base>]
//       <name>.png          contact sheet of whatever the export returns: a map of
//                           name -> surface { w, h, data }, or the textures / sprites shapes
//   Common: --out <dir> (default out/assets), --scale <n> (default 3)
//   textures / sprites also accept --module <path> [--export <fn>] to run the full check on another file.
//
// Exit code 0 = written, 1 = written but with contract problems listed, 2 = nothing to dump.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  TEXTURE_NAMES, TEXTURE_SIZE, TEXTURE_FRAMES, TEXTURE_FULLBRIGHT, SKY, SKY_W, SKY_H,
  SPRITE_SIZES, SPRITE_NAMES,
} from '../src/config.js';
import { createSurface, fillRect, blit, drawText, textWidth } from '../src/core/pix.js';
import { writePNG, upscale, onChecker } from './png.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function parseArgs(argv) {
  const args = { mode: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const next = argv[i + 1];
      args[a.slice(2)] = next === undefined || next.startsWith('--') ? true : argv[++i];
    } else if (!args.mode) args.mode = a;
  }
  return args;
}

function fail(msg) {
  console.error(`dump-assets: ${msg}`);
  process.exit(2);
}

const OWNERS = {
  'src/assets/textures.js': 'textures',
  'src/assets/sprites.js': 'sprites',
};

async function load(file, exportName) {
  const abs = path.resolve(file);
  const rel = abs.startsWith(root + path.sep) ? path.relative(root, abs) : abs;
  if (!fs.existsSync(abs)) {
    const owner = OWNERS[rel] ? ` It is written by the ${OWNERS[rel]} role.` : '';
    fail(`${rel} does not exist yet.${owner}`);
  }
  let mod;
  try {
    mod = await import(pathToFileURL(abs).href);
  } catch (err) {
    fail(`could not import ${rel}:\n${err.stack || err}`);
  }
  if (typeof mod[exportName] !== 'function') {
    fail(`${rel} has no exported function "${exportName}". Exports: ${Object.keys(mod).join(', ') || '(none)'}`);
  }
  const t0 = performance.now();
  const result = await mod[exportName]();
  console.log(`${rel} ${exportName}() took ${(performance.now() - t0).toFixed(0)} ms`);
  return result;
}

function toSurface(frame, w, h) {
  return { w, h, data: frame };
}

function cutFrame(atlas, r) {
  return blit(createSurface(r.w, r.h), atlas, 0, 0, { sx: r.x, sy: r.y, sw: r.w, sh: r.h });
}

// items: [{ label, surface }] -> one labelled sheet, shelf-packed in the given order.
function contactSheet(items, scale, maxW = 1500) {
  const pad = 6, labelH = 13;
  let x = pad, y = pad, rowH = 0, sheetW = 0;
  const placed = [];
  for (const it of items) {
    const w = Math.max(it.surface.w * scale, textWidth(it.label, 2) + 2);
    const h = it.surface.h * scale + labelH;
    if (x > pad && x + w + pad > maxW) {
      x = pad;
      y += rowH + pad;
      rowH = 0;
    }
    placed.push({ ...it, x, y, w });
    x += w + pad;
    sheetW = Math.max(sheetW, x);
    rowH = Math.max(rowH, h);
  }
  const sheet = createSurface(sheetW, y + rowH + pad);
  for (const p of placed) {
    fillRect(sheet, p.x, p.y, p.w, labelH - 1, '#15171c');
    drawText(sheet, p.label, p.x + 1, p.y + 1, '#ffae1a', 2);
    blit(sheet, upscale(p.surface, scale), p.x, p.y + labelH);
  }
  return onChecker(sheet, 8);
}

// Seam hint: colour step across the wrap edge relative to the strongest step between two
// neighbouring interior lines. Well above 1 means the edge is the hardest line in the texture.
function seamRatio(s, vertical) {
  const { w, h, data: d } = s;
  const len = vertical ? w : h, span = vertical ? h : w;
  const step = (p, q) => {
    let sum = 0;
    for (let k = 0; k < len; k++) {
      const i = (vertical ? p * w + k : k * w + p) * 4, j = (vertical ? q * w + k : k * w + q) * 4;
      sum += Math.abs(d[i] - d[j]) + Math.abs(d[i + 1] - d[j + 1]) + Math.abs(d[i + 2] - d[j + 2]);
    }
    return sum / len;
  };
  let strongest = 0;
  for (let p = 0; p + 1 < span; p++) strongest = Math.max(strongest, step(p, p + 1));
  return step(span - 1, 0) / Math.max(strongest, 4);
}

function report(problems) {
  if (!problems.length) {
    console.log('contract check: ok');
    return;
  }
  console.log(`contract check: ${problems.length} problem(s)`);
  for (const p of problems) console.log(`  - ${p}`);
  process.exitCode = 1;
}

function dumpTextures(textures, args, out, scale) {
  const problems = [];
  const items = [];
  const only = typeof args.only === 'string' ? args.only : '';
  for (const name of Object.keys(textures)) {
    if (!TEXTURE_NAMES.includes(name)) problems.push(`"${name}" is not in TEXTURE_NAMES`);
  }
  console.log('order:');
  TEXTURE_NAMES.forEach((name, index) => {
    const t = textures[name];
    if (!t) {
      problems.push(`missing texture "${name}"`);
      return;
    }
    const [ew, eh] = name === SKY ? [SKY_W, SKY_H] : [TEXTURE_SIZE, TEXTURE_SIZE];
    const frames = t.frames || [];
    const wantFrames = TEXTURE_FRAMES[name] || 1;
    const notes = [];
    if (t.w !== ew || t.h !== eh) problems.push(`${name}: size ${t.w}x${t.h}, expected ${ew}x${eh}`);
    if (frames.length !== wantFrames) problems.push(`${name}: ${frames.length} frame(s), expected ${wantFrames}`);
    if (frames.length > 1 && !(t.fps > 0)) problems.push(`${name}: animated but fps is ${t.fps}`);
    if (!!t.fullbright !== TEXTURE_FULLBRIGHT.includes(name)) {
      problems.push(`${name}: fullbright is ${t.fullbright}, expected ${TEXTURE_FULLBRIGHT.includes(name)}`);
    }
    frames.forEach((f, i) => {
      if (!f || f.length !== t.w * t.h * 4) {
        problems.push(`${name} frame ${i}: data length ${f && f.length}, expected ${t.w * t.h * 4}`);
        return;
      }
      for (let k = 3; k < f.length; k += 4) {
        if (f[k] !== 255) {
          problems.push(`${name} frame ${i}: not fully opaque`);
          break;
        }
      }
      const s = toSurface(f, t.w, t.h);
      if (i === 0) {
        const sx = seamRatio(s, false), sy = name === SKY ? 1 : seamRatio(s, true);
        if (sx > 2.5) notes.push(`left/right edge ${sx.toFixed(1)}x the hardest interior line`);
        if (sy > 2.5) notes.push(`top/bottom edge ${sy.toFixed(1)}x the hardest interior line`);
      }
      if (name.startsWith(only)) items.push({ label: frames.length > 1 ? `${name}#${i}` : name, surface: s });
    });
    console.log(`  ${String(index).padStart(2)} ${name.padEnd(16)} ${t.w}x${t.h}`
      + ` frames ${frames.length}${t.fps ? ` @${t.fps}fps` : ''}${t.fullbright ? ' fullbright' : ''}`
      + (notes.length ? `   [possible seam, look at --tile ${name}: ${notes.join(', ')}]` : ''));
  });
  if (items.length) {
    const file = writePNG(path.join(out, only ? `textures-${only}.png` : 'textures.png'), contactSheet(items, scale));
    console.log(`wrote ${file}`);
  } else console.log('no textures matched; no sheet written');

  if (typeof args.tile === 'string') {
    for (const name of args.tile.split(',')) {
      const t = textures[name];
      if (!t) {
        console.error(`--tile ${name}: no such texture`);
        continue;
      }
      const frame = Math.min(Number(args.frame) || 0, t.frames.length - 1);
      const s = toSurface(t.frames[frame], t.w, t.h);
      const tiled = createSurface(t.w * 3, t.h * 3);
      for (let j = 0; j < 3; j++) for (let i = 0; i < 3; i++) blit(tiled, s, i * t.w, j * t.h);
      const k = Number(args.scale) || (t.w > 64 ? 1 : 4);
      console.log(`wrote ${writePNG(path.join(out, `tile-${name}.png`), upscale(tiled, k))}`);
    }
  }
  report(problems);
}

function dumpSprites(sprites, args, out, scale) {
  const problems = [];
  const { atlas, frames } = sprites;
  if (!atlas || !frames) fail('buildSprites() must return { atlas: { w, h, data }, frames }');
  const pow2 = (n) => n > 0 && (n & (n - 1)) === 0;
  if (!pow2(atlas.w) || !pow2(atlas.h) || atlas.w > 2048 || atlas.h > 2048) {
    problems.push(`atlas is ${atlas.w}x${atlas.h}; must be power-of-two and at most 2048`);
  }
  if (atlas.data.length !== atlas.w * atlas.h * 4) problems.push('atlas data length does not match w*h*4');
  for (let k = 3; k < atlas.data.length; k += 4) {
    if (atlas.data[k] !== 0 && atlas.data[k] !== 255) {
      problems.push(`atlas has partial alpha (first at pixel ${(k - 3) / 4 % atlas.w}, ${Math.floor((k - 3) / 4 / atlas.w)})`);
      break;
    }
  }
  for (const name of Object.keys(frames)) {
    if (!SPRITE_SIZES[name]) problems.push(`"${name}" is not in SPRITE_SIZES`);
  }
  const rects = [];
  let used = 0;
  for (const name of SPRITE_NAMES) {
    const r = frames[name], want = SPRITE_SIZES[name];
    if (!r) {
      problems.push(`missing frame "${name}"`);
      continue;
    }
    if (r.w !== want.w || r.h !== want.h) problems.push(`${name}: ${r.w}x${r.h}, expected ${want.w}x${want.h}`);
    if (r.x < 0 || r.y < 0 || r.x + r.w > atlas.w || r.y + r.h > atlas.h) {
      problems.push(`${name}: rect ${r.x},${r.y} ${r.w}x${r.h} leaves the atlas`);
      continue;
    }
    used += r.w * r.h;
    // opaque bounds inside the frame
    let top = r.h, bottom = -1;
    for (let y = 0; y < r.h; y++) {
      for (let x = 0; x < r.w; x++) {
        if (atlas.data[((r.y + y) * atlas.w + r.x + x) * 4 + 3]) {
          if (y < top) top = y;
          bottom = y;
        }
      }
    }
    if (bottom < 0) problems.push(`${name}: frame is empty`);
    else if (want.anchor === 'bottom' && bottom < r.h - 1) {
      console.log(`  note ${name}: ${r.h - 1 - bottom} empty row(s) under the art (floats above its anchor)`);
    } else if (want.anchor === 'top' && top > 0) {
      console.log(`  note ${name}: ${top} empty row(s) above the art (gap below the ceiling)`);
    }
    rects.push({ name, ...r });
  }
  for (let i = 0; i < rects.length; i++) {
    for (let j = i + 1; j < rects.length; j++) {
      const a = rects[i], b = rects[j];
      // frames need at least 1 px between them
      if (a.x < b.x + b.w + 1 && b.x < a.x + a.w + 1 && a.y < b.y + b.h + 1 && b.y < a.y + a.h + 1) {
        problems.push(`${a.name} and ${b.name} overlap or touch (need 1 px padding)`);
      }
    }
  }
  console.log(`atlas ${atlas.w}x${atlas.h}, ${rects.length}/${SPRITE_NAMES.length} frames, `
    + `${((used / (atlas.w * atlas.h)) * 100).toFixed(0)}% used`);
  console.log(`wrote ${writePNG(path.join(out, 'sprites-atlas.png'), onChecker(atlas, 8))}`);

  if (typeof args.only === 'string') {
    const items = rects.filter((r) => r.name.startsWith(args.only))
      .map((r) => ({ label: r.name, surface: cutFrame(atlas, r) }));
    if (items.length) {
      console.log(`wrote ${writePNG(path.join(out, `sprites-${args.only}.png`), contactSheet(items, scale))}`);
    } else console.log(`no frames start with "${args.only}"`);
  } else {
    console.log('add --only <prefix> (e.g. gunner_, it_, wp_scatter) for a labelled 3x sheet of those frames');
  }
  report(problems);
}

function dumpMap(result, args, out, scale) {
  if (!result || typeof result !== 'object') fail('the export did not return an object');
  let entries;
  if (result.atlas && result.frames) {
    entries = Object.entries(result.frames).map(([name, r]) => [name, cutFrame(result.atlas, r)]);
  } else {
    entries = [];
    for (const [name, v] of Object.entries(result)) {
      if (v && v.data && v.w && v.h) entries.push([name, v]);
      else if (v && Array.isArray(v.frames) && v.w && v.h) {
        v.frames.forEach((f, i) => entries.push([v.frames.length > 1 ? `${name}#${i}` : name, toSurface(f, v.w, v.h)]));
      } else console.log(`  skipped "${name}": not a surface`);
    }
  }
  const only = typeof args.only === 'string' ? args.only : '';
  const items = entries.filter(([name]) => name.startsWith(only)).map(([label, surface]) => ({ label, surface }));
  if (!items.length) fail(`nothing to draw${only ? ` for prefix "${only}"` : ''}; names: ${entries.map((e) => e[0]).join(', ') || '(none)'}`);
  for (const it of items) {
    if (it.surface.data.length !== it.surface.w * it.surface.h * 4) fail(`"${it.label}": data length does not match ${it.surface.w}x${it.surface.h}`);
  }
  const base = typeof args.name === 'string' ? args.name
    : `${path.basename(args.module).replace(/\.[^.]+$/, '')}-${args.export}${only ? `-${only}` : ''}`;
  console.log(`${items.length} image(s): ${items.map((i) => `${i.label} ${i.surface.w}x${i.surface.h}`).join(', ')}`);
  console.log(`wrote ${writePNG(path.join(out, `${base}.png`), contactSheet(items, scale))}`);
}

const args = parseArgs(process.argv.slice(2));
const out = path.resolve(typeof args.out === 'string' ? args.out : path.join(root, 'out/assets'));
const scale = Number(args.scale) || 3;

const override = typeof args.module === 'string' ? args.module : null;
if (args.mode === 'textures') {
  dumpTextures(await load(override || path.join(root, 'src/assets/textures.js'), args.export || 'buildTextures'), args, out, scale);
} else if (args.mode === 'sprites') {
  dumpSprites(await load(override || path.join(root, 'src/assets/sprites.js'), args.export || 'buildSprites'), args, out, scale);
} else if (override) {
  if (typeof args.export !== 'string') fail('--module needs --export <function name>');
  dumpMap(await load(override, args.export), args, out, scale);
} else {
  console.error([
    'usage:',
    '  node tools/dump-assets.mjs textures [--only <prefix>] [--tile <name>[,<name>]] [--frame n]',
    '  node tools/dump-assets.mjs sprites [--only <prefix>]',
    '  node tools/dump-assets.mjs --module <path> --export <fn> [--only <prefix>] [--name <base>]',
    '  common: --out <dir> (default out/assets)  --scale <n> (default 3)',
  ].join('\n'));
  process.exit(2);
}
