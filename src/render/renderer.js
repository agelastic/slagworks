// WebGL1 renderer: sky, grid world, billboards, weapon. No extensions needed.
//
//   const r = createRenderer(canvas, { textures, sprites })
//   r.setWorld(world)        build the mesh for a level
//   r.resize(cssW, cssH)     size of the box the canvas is stretched to, in CSS pixels
//   r.setQuality(renderH)    internal height in pixels (240 or 400)
//   r.render(scene)
//
// The canvas backing store is the internal resolution; devicePixelRatio is never applied.
// The page stretches the canvas with CSS (image-rendering: pixelated).

import {
  FOV_Y_DEG, RENDER_H_DEFAULT, RENDER_ASPECT_MAX, VIRTUAL_H, TEXELS_PER_UNIT, SKY, SKY_H,
} from '../config.js';
import { Batches, emitCell, VERT_FLOATS } from './mesh.js';
import { WORLD_VS, WORLD_FS, SPRITE_VS, SPRITE_FS, SKY_VS, SKY_FS } from './shaders.js';

const NEAR = 0.1;
const FAR = 120;
const DEPTH_A = (FAR + NEAR) / (FAR - NEAR);
const DEPTH_B = (-2 * FAR * NEAR) / (FAR - NEAR);
const TAN_HALF_FOV = Math.tan((FOV_Y_DEG * Math.PI) / 360);
const SKY_REPEATS = 4;           // times the sky texture wraps around the horizon
const SKY_COLUMNS = 24;
const SPRITE_BIAS = 0.2;         // depth bias in world units for sprites that stand on something
const FX_BIAS = 0.45;            // centre-anchored effects may overlap walls and bodies more
const STRIDE = VERT_FLOATS * 4;
const QUAD_FLOATS = VERT_FLOATS * 6;

export function createRenderer(canvas, { textures, sprites }, { emulateMediump = false } = {}) {
  const attrs = { antialias: false, alpha: false, depth: true, stencil: false, powerPreference: 'high-performance' };
  const gl = canvas.getContext('webgl', attrs) || canvas.getContext('experimental-webgl', attrs);
  if (!gl) throw new Error('WebGL is not available');

  let world = null;
  let dynCells = [];
  let hasSky = false;
  let builtVersion = -1;
  let renderH = RENDER_H_DEFAULT;
  let cssW = 4, cssH = 3;
  let aspect = 4 / 3;            // of the displayed box; drives the projection
  let pixelAspect = 1;           // displayed width of one internal pixel relative to its height
  let lost = false;

  // GL objects, re-created after a context restore
  let worldProg, spriteProg, skyProg;
  let texInfo, fallbackTex, atlasTex;
  let staticBuf, dynBuf, spriteBuf, skyBuf;

  const staticBatches = new Batches();
  const dynBatches = new Batches();
  const staticRanges = [];
  const dynRanges = [];
  let dynData = new Float32Array(QUAD_FLOATS * 256);
  let spriteData = new Float32Array(QUAD_FLOATS * 128);
  const mat = new Float32Array(16);
  const ortho = new Float32Array(16);
  ortho[10] = 1;
  ortho[12] = -1;
  ortho[13] = -1;
  ortho[15] = 1;

  // ---------------------------------------------------------------- GL resources

  function compile(type, src) {
    const s = gl.createShader(type);
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS) && !gl.isContextLost()) {
      throw new Error(`shader: ${gl.getShaderInfoLog(s)}`);
    }
    return s;
  }

  function program(vs, fs, uniforms) {
    const p = gl.createProgram();
    const head = emulateMediump ? '#define EMU_MEDIUMP\n' : '';
    gl.attachShader(p, compile(gl.VERTEX_SHADER, vs));
    gl.attachShader(p, compile(gl.FRAGMENT_SHADER, head + fs));
    gl.bindAttribLocation(p, 0, 'aPos');
    gl.bindAttribLocation(p, 1, 'aUv');
    gl.bindAttribLocation(p, 2, 'aLight');
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS) && !gl.isContextLost()) {
      throw new Error(`program: ${gl.getProgramInfoLog(p)}`);
    }
    const out = { p };
    for (const u of uniforms) out[u] = gl.getUniformLocation(p, u);
    return out;
  }

  function texture(rgba, w, h, wrapS, wrapT) {
    const t = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE,
      new Uint8Array(rgba.buffer, rgba.byteOffset, rgba.byteLength));
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, wrapS);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, wrapT);
    return t;
  }

  function initGL() {
    worldProg = program(WORLD_VS, WORLD_FS, ['uMat', 'uLightMod', 'uFullbright']);
    spriteProg = program(SPRITE_VS, SPRITE_FS, ['uMat', 'uParams']);
    skyProg = program(SKY_VS, SKY_FS, ['uSky']);

    texInfo = new Map();
    for (const name of Object.keys(textures)) {
      const t = textures[name];
      const wrapT = name === SKY ? gl.CLAMP_TO_EDGE : gl.REPEAT;
      texInfo.set(name, {
        frames: t.frames.map((f) => texture(f, t.w, t.h, gl.REPEAT, wrapT)),
        fps: t.fps || 0,
        fullbright: t.fullbright ? 1 : 0,
      });
    }
    fallbackTex = texInfo.values().next().value;
    atlasTex = texture(sprites.atlas.data, sprites.atlas.w, sprites.atlas.h, gl.CLAMP_TO_EDGE, gl.CLAMP_TO_EDGE);

    staticBuf = gl.createBuffer();
    dynBuf = gl.createBuffer();
    spriteBuf = gl.createBuffer();
    skyBuf = gl.createBuffer();
    const sky = new Float32Array(SKY_COLUMNS * QUAD_FLOATS);
    for (let i = 0, o = 0; i < SKY_COLUMNS; i++) {
      const x0 = (i / SKY_COLUMNS) * 2 - 1, x1 = ((i + 1) / SKY_COLUMNS) * 2 - 1;
      for (const [x, y] of [[x0, -1], [x1, -1], [x1, 1], [x0, -1], [x1, 1], [x0, 1]]) {
        sky[o] = x;
        sky[o + 1] = y;
        o += VERT_FLOATS;
      }
    }
    gl.bindBuffer(gl.ARRAY_BUFFER, skyBuf);
    gl.bufferData(gl.ARRAY_BUFFER, sky, gl.STATIC_DRAW);

    gl.enableVertexAttribArray(0);
    gl.enableVertexAttribArray(1);
    gl.enableVertexAttribArray(2);
    gl.enable(gl.CULL_FACE);
    gl.depthFunc(gl.LEQUAL);
    gl.disable(gl.BLEND);
    gl.disable(gl.DITHER);
    gl.activeTexture(gl.TEXTURE0);
    gl.clearColor(0, 0, 0, 1);
    builtVersion = -1;
  }

  function bindVerts(buf) {
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.vertexAttribPointer(0, 3, gl.FLOAT, false, STRIDE, 0);
    gl.vertexAttribPointer(1, 2, gl.FLOAT, false, STRIDE, 12);
    gl.vertexAttribPointer(2, 2, gl.FLOAT, false, STRIDE, 20);
  }

  // ---------------------------------------------------------------- world mesh

  // Concatenates the batches into one array and records a draw range per texture.
  function pack(batches, data, ranges) {
    let o = 0, r = 0;
    for (let i = 0; i < batches.list.length; i++) {
      const b = batches.list[i];
      if (b.n === 0) continue;
      const src = b.data;
      for (let j = 0; j < b.n; j++) data[o + j] = src[j];
      let range = ranges[r];
      if (!range) range = ranges[r] = { info: null, first: 0, count: 0 };
      range.info = texInfo.get(b.tex) || fallbackTex;
      range.first = o / VERT_FLOATS;
      range.count = b.n / VERT_FLOATS;
      o += b.n;
      r++;
    }
    for (let i = r; i < ranges.length; i++) ranges[i].count = 0;
    return o;
  }

  function buildStatic() {
    staticBatches.reset();
    const cells = world.cells;
    for (let i = 0; i < cells.length; i++) {
      if (!cells[i].dynamic) emitCell(world, cells[i], staticBatches);
    }
    const data = new Float32Array(staticBatches.floats());
    pack(staticBatches, data, staticRanges);
    gl.bindBuffer(gl.ARRAY_BUFFER, staticBuf);
    gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
    builtVersion = world.version;
  }

  function buildDynamic() {
    dynBatches.reset();
    for (let i = 0; i < dynCells.length; i++) emitCell(world, dynCells[i], dynBatches);
    const n = dynBatches.floats();
    if (n > dynData.length) dynData = new Float32Array(n * 2);
    pack(dynBatches, dynData, dynRanges);
    return n;
  }

  // Uploads the first n floats of a streamed array. The view is only re-created when n changes.
  const views = new Map();
  function upload(buf, data, n) {
    let v = views.get(buf);
    if (!v || v.buffer !== data.buffer || v.length !== n) {
      v = data.subarray(0, n);
      views.set(buf, v);
    }
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, v, gl.DYNAMIC_DRAW);
  }

  function drawRanges(ranges, time) {
    let fullbright = -1;
    for (let i = 0; i < ranges.length; i++) {
      const r = ranges[i];
      if (r.count === 0) continue;
      const info = r.info;
      const frames = info.frames;
      gl.bindTexture(gl.TEXTURE_2D, frames.length > 1 ? frames[Math.floor(time * info.fps) % frames.length] : frames[0]);
      if (info.fullbright !== fullbright) {
        fullbright = info.fullbright;
        gl.uniform1f(worldProg.uFullbright, fullbright);
      }
      gl.drawArrays(gl.TRIANGLES, r.first, r.count);
    }
  }

  // ---------------------------------------------------------------- sprites

  function spriteQuad(o, x0, y0, x1, y1, zb, zt, f, flipX, light, bias) {
    const d = spriteData;
    const aw = sprites.atlas.w, ah = sprites.atlas.h;
    let u0 = f.x / aw, u1 = (f.x + f.w) / aw;
    if (flipX) { const t = u0; u0 = u1; u1 = t; }
    const vt = f.y / ah, vb = (f.y + f.h) / ah;
    d[o] = x0; d[o + 1] = y0; d[o + 2] = zb; d[o + 3] = u0; d[o + 4] = vb;
    d[o + 7] = x1; d[o + 8] = y1; d[o + 9] = zb; d[o + 10] = u1; d[o + 11] = vb;
    d[o + 14] = x1; d[o + 15] = y1; d[o + 16] = zt; d[o + 17] = u1; d[o + 18] = vt;
    d[o + 21] = x0; d[o + 22] = y0; d[o + 23] = zb; d[o + 24] = u0; d[o + 25] = vb;
    d[o + 28] = x1; d[o + 29] = y1; d[o + 30] = zt; d[o + 31] = u1; d[o + 32] = vt;
    d[o + 35] = x0; d[o + 36] = y0; d[o + 37] = zt; d[o + 38] = u0; d[o + 39] = vt;
    for (let i = 5; i < QUAD_FLOATS; i += VERT_FLOATS) {
      d[o + i] = light;
      d[o + i + 1] = bias;
    }
  }

  // Returns the number of floats written: world sprites first, the weapon quad (if any) last.
  function buildSprites(scene, sin, cos) {
    const list = scene.sprites;
    const need = (list.length + 1) * QUAD_FLOATS;
    if (need > spriteData.length) spriteData = new Float32Array(need * 2);
    let o = 0;
    for (let i = 0; i < list.length; i++) {
      const s = list[i];
      const f = sprites.frames[s.frame];
      if (!f) continue;
      const hw = f.w / (2 * TEXELS_PER_UNIT), h = f.h / TEXELS_PER_UNIT;
      const rx = -sin * hw, ry = cos * hw;
      const zb = s.anchor === 'center' ? s.z - h * 0.5 : s.anchor === 'top' ? s.z - h : s.z;
      spriteQuad(o, s.x - rx, s.y - ry, s.x + rx, s.y + ry, zb, zb + h, f, s.flipX,
        s.light, s.anchor === 'center' ? FX_BIAS : SPRITE_BIAS);
      o += QUAD_FLOATS;
    }
    return o;
  }

  // Weapon frame on the 320 x 240 virtual screen: bottom-centre of the frame at the bottom-centre
  // of the view, moved by (dx, dy) virtual pixels (+dx right, +dy down). Coordinates are internal pixels.
  function buildWeapon(o, w) {
    const f = sprites.frames[w.frame];
    if (!f) return false;
    const s = canvas.height / VIRTUAL_H;
    const sx = s / pixelAspect;
    const x0 = Math.round(canvas.width * 0.5 + (w.dx - f.w * 0.5) * sx);
    const y0 = Math.round(-w.dy * s);
    spriteQuad(o, x0, y0, x0 + f.w * sx, y0, 0, f.h * s, f, false, w.light, 0);
    // spriteQuad lays the quad out in x, y (ground plane) and z (height); the weapon wants
    // x across and y up, so move the height into y.
    const d = spriteData;
    for (let i = 0; i < QUAD_FLOATS; i += VERT_FLOATS) {
      d[o + i + 1] = y0 + d[o + i + 2];
      d[o + i + 2] = 0;
    }
    return true;
  }

  // ---------------------------------------------------------------- frame

  function flickerNoise(t) {
    let h = Math.sin(Math.floor(t * 14) * 127.1) * 43758.5453;
    h -= Math.floor(h);
    return h < 0.7 ? h * 0.25 : h;
  }

  function render(scene) {
    if (lost) return;
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.depthMask(true);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    if (!world) return;
    if (world.version !== builtVersion) buildStatic();

    const cam = scene.cam;
    const time = scene.time || 0;
    const extra = scene.extraLight || 0;
    const sin = Math.sin(cam.yaw), cos = Math.cos(cam.yaw);
    const fy = 1 / TAN_HALF_FOV, fx = fy / aspect;
    const fwd = cos * cam.x + sin * cam.y;
    // clip = projection * view, written out so the terms that must be exactly zero are
    mat[0] = -sin * fx; mat[4] = cos * fx; mat[8] = 0; mat[12] = fx * (sin * cam.x - cos * cam.y);
    mat[1] = 0; mat[5] = 0; mat[9] = fy; mat[13] = -fy * cam.z;
    mat[2] = DEPTH_A * cos; mat[6] = DEPTH_A * sin; mat[10] = 0; mat[14] = DEPTH_B - DEPTH_A * fwd;
    mat[3] = cos; mat[7] = sin; mat[11] = 0; mat[15] = -fwd;

    if (hasSky) {
      const info = texInfo.get(SKY) || fallbackTex;
      const turns = (cam.yaw * SKY_REPEATS) / (2 * Math.PI);
      gl.disable(gl.DEPTH_TEST);
      gl.depthMask(false);
      gl.useProgram(skyProg.p);
      gl.uniform4f(skyProg.uSky, turns - Math.floor(turns), TAN_HALF_FOV * aspect,
        SKY_REPEATS / (2 * Math.PI), (0.5 * VIRTUAL_H) / SKY_H);
      gl.bindTexture(gl.TEXTURE_2D, info.frames[0]);
      bindVerts(skyBuf);
      gl.drawArrays(gl.TRIANGLES, 0, SKY_COLUMNS * 6);
      gl.depthMask(true);
    }

    gl.enable(gl.DEPTH_TEST);
    gl.useProgram(worldProg.p);
    gl.uniformMatrix4fv(worldProg.uMat, false, mat);
    gl.uniform2f(worldProg.uLightMod, flickerNoise(time), extra);
    bindVerts(staticBuf);
    drawRanges(staticRanges, time);
    if (dynCells.length) {
      upload(dynBuf, dynData, buildDynamic());
      bindVerts(dynBuf);
      drawRanges(dynRanges, time);
    }

    const spriteFloats = buildSprites(scene, sin, cos);
    const weapon = scene.weapon && buildWeapon(spriteFloats, scene.weapon);
    const total = spriteFloats + (weapon ? QUAD_FLOATS : 0);
    if (total === 0) return;
    upload(spriteBuf, spriteData, total);
    bindVerts(spriteBuf);
    gl.useProgram(spriteProg.p);
    gl.bindTexture(gl.TEXTURE_2D, atlasTex);
    if (spriteFloats) {
      gl.uniformMatrix4fv(spriteProg.uMat, false, mat);
      gl.uniform4f(spriteProg.uParams, DEPTH_A, DEPTH_B, 1, extra);
      gl.drawArrays(gl.TRIANGLES, 0, spriteFloats / VERT_FLOATS);
    }
    if (weapon) {
      ortho[0] = 2 / canvas.width;
      ortho[5] = 2 / canvas.height;
      gl.disable(gl.DEPTH_TEST);
      gl.uniformMatrix4fv(spriteProg.uMat, false, ortho);
      gl.uniform4f(spriteProg.uParams, 0, 0, 0, extra);
      gl.drawArrays(gl.TRIANGLES, spriteFloats / VERT_FLOATS, 6);
    }
  }

  // ---------------------------------------------------------------- public

  function setWorld(w) {
    world = w;
    dynCells = [];
    hasSky = false;
    for (const c of w.cells) {
      if (c.solid) continue;
      if (c.dynamic) dynCells.push(c);
      if (c.ct === SKY) hasSky = true;
    }
    builtVersion = -1;
  }

  function applySize() {
    aspect = cssW / cssH;
    const h = renderH;
    const ideal = h * aspect;
    const clamped = Math.min(Math.max(ideal, h), h * RENDER_ASPECT_MAX);
    const w = Math.round(clamped / 2) * 2;      // even, so the view centre is a pixel boundary
    if (canvas.width !== w) canvas.width = w;
    if (canvas.height !== h) canvas.height = h;
    pixelAspect = ideal / clamped;              // 1 unless the width was clamped
  }

  function resize(w, h) {
    if (!(w > 0 && h > 0)) return;
    cssW = w;
    cssH = h;
    applySize();
  }

  function setQuality(h) {
    renderH = h;
    applySize();
  }

  canvas.addEventListener('webglcontextlost', (e) => {
    e.preventDefault();
    lost = true;
  });
  canvas.addEventListener('webglcontextrestored', () => {
    views.clear();
    initGL();
    lost = false;
  });

  initGL();
  applySize();

  return { setWorld, resize, setQuality, render, gl };
}
