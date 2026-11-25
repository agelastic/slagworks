// Automap drawn on a 2D canvas from world cells the player has seen.
//
//   const map = createMinimap(canvas, { large: false })
//   map.draw(game, pad)
//
// Small mode: player centred, heading up, a fixed radius of cells.
// Large mode: north up, the whole level fitted into the canvas minus `pad`
// ({ top, right, bottom, left } in CSS px, optional).

import { KEY_COLORS, STEP_HEIGHT } from '../config.js';

const WALL = '#ffae1a';
const FLOOR = 'rgba(255, 174, 26, 0.17)';
const LEDGE = 'rgba(255, 174, 26, 0.42)';
const SLAG = 'rgba(255, 84, 22, 0.55)';
const COOLANT = 'rgba(64, 224, 150, 0.45)';
const LIFT = 'rgba(255, 216, 138, 0.42)';
const DOOR = '#fff0c8';
const DOOR_TAG = '#9c8a68';
const SWITCH = '#ff7a1f';
const EXIT = '#f4fff0';
const ARROW = '#ffffff';

const SMALL_RADIUS = 6.5; // cells from the player to the canvas edge

// A closed secret door reads as wall until it has been opened.
function isWall(c) {
  return c.solid || Boolean(c.door && c.door.secret && c.door.open < 0.02);
}

export function createMinimap(canvas, { large = false } = {}) {
  const ctx = canvas.getContext('2d');
  const floors = { [FLOOR]: [], [SLAG]: [], [COOLANT]: [], [LIFT]: [] };
  const blocks = { [SWITCH]: [], [EXIT]: [] };
  const doors = { [DOOR]: [], [DOOR_TAG]: [] };
  for (const c of Object.values(KEY_COLORS)) doors[c] = [];
  const walls = [];
  const ledges = [];
  let boundsOf = null;
  let bounds = null;

  function fit() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = Math.round(canvas.clientWidth * dpr);
    const h = Math.round(canvas.clientHeight * dpr);
    if (w > 0 && h > 0 && (canvas.width !== w || canvas.height !== h)) {
      canvas.width = w;
      canvas.height = h;
    }
    return dpr;
  }

  function levelBounds(world) {
    if (boundsOf === world) return bounds;
    let x0 = world.w, y0 = world.h, x1 = 0, y1 = 0;
    for (const c of world.cells) {
      if (c.solid) continue;
      if (c.cx < x0) x0 = c.cx;
      if (c.cy < y0) y0 = c.cy;
      if (c.cx > x1) x1 = c.cx;
      if (c.cy > y1) y1 = c.cy;
    }
    if (x1 < x0) { x0 = 0; y0 = 0; x1 = world.w - 1; y1 = world.h - 1; }
    boundsOf = world;
    bounds = { x: x0 - 1, y: y0 - 1, w: x1 - x0 + 3, h: y1 - y0 + 3 };
    return bounds;
  }

  // Sort the cells of a rectangle into draw lists.
  function collect(world, x0, y0, x1, y1) {
    for (const k in floors) floors[k].length = 0;
    for (const k in blocks) blocks[k].length = 0;
    for (const k in doors) doors[k].length = 0;
    walls.length = 0;
    ledges.length = 0;

    for (let cy = y0; cy <= y1; cy++) {
      for (let cx = x0; cx <= x1; cx++) {
        const c = world.cell(cx, cy);
        if (!c.seen || isWall(c)) continue;

        if (c.door) {
          const list = c.door.key ? doors[KEY_COLORS[c.door.key]] : c.door.tag ? doors[DOOR_TAG] : doors[DOOR];
          list.push(cx, cy, c.door.open);
          floors[FLOOR].push(cx, cy);
        } else if (c.damage > 0) {
          floors[c.ft === 'f_coolant' ? COOLANT : SLAG].push(cx, cy);
        } else if (c.lift) {
          floors[LIFT].push(cx, cy);
        } else {
          floors[FLOOR].push(cx, cy);
        }

        // Walls on the four edges, plus switch and exit blocks behind them.
        const n = world.cell(cx, cy - 1);
        const e = world.cell(cx + 1, cy);
        const s = world.cell(cx, cy + 1);
        const w = world.cell(cx - 1, cy);
        if (isWall(n)) { walls.push(cx, cy, cx + 1, cy); mark(n, cx, cy - 1); }
        if (isWall(e)) { walls.push(cx + 1, cy, cx + 1, cy + 1); mark(e, cx + 1, cy); }
        if (isWall(s)) { walls.push(cx, cy + 1, cx + 1, cy + 1); mark(s, cx, cy + 1); }
        if (isWall(w)) { walls.push(cx, cy, cx, cy + 1); mark(w, cx - 1, cy); }

        // Drops and platforms too tall to step.
        if (!isWall(e) && e.seen && Math.abs(e.floor - c.floor) > STEP_HEIGHT) ledges.push(cx + 1, cy, cx + 1, cy + 1);
        if (!isWall(s) && s.seen && Math.abs(s.floor - c.floor) > STEP_HEIGHT) ledges.push(cx, cy + 1, cx + 1, cy + 1);
      }
    }
  }

  function mark(c, cx, cy) {
    if (c.exit) blocks[EXIT].push(cx, cy);
    else if (c.switch) blocks[SWITCH].push(cx, cy);
  }

  function fillCells(list, style, inset = 0) {
    if (list.length === 0) return;
    ctx.fillStyle = style;
    ctx.beginPath();
    for (let i = 0; i < list.length; i += 2) ctx.rect(list[i] + inset, list[i + 1] + inset, 1 - 2 * inset, 1 - 2 * inset);
    ctx.fill();
  }

  function strokeEdges(list, style, width) {
    if (list.length === 0) return;
    ctx.strokeStyle = style;
    ctx.lineWidth = width;
    ctx.beginPath();
    for (let i = 0; i < list.length; i += 4) {
      ctx.moveTo(list[i], list[i + 1]);
      ctx.lineTo(list[i + 2], list[i + 3]);
    }
    ctx.stroke();
  }

  // Call with the world transform (1 unit = 1 cell) already set. px = device pixels per cell.
  function paint(px, dpr) {
    for (const k in floors) fillCells(floors[k], k);
    for (const k in blocks) fillCells(blocks[k], k, 0.12);
    for (const k in doors) {
      const list = doors[k];
      if (list.length === 0) continue;
      ctx.fillStyle = k;
      for (let i = 0; i < list.length; i += 3) {
        ctx.globalAlpha = 1 - 0.65 * list[i + 2];
        ctx.fillRect(list[i] + 0.1, list[i + 1] + 0.1, 0.8, 0.8);
      }
      ctx.globalAlpha = 1;
    }
    ctx.lineCap = 'square';
    strokeEdges(ledges, LEDGE, (1 * dpr) / px);
    strokeEdges(walls, WALL, (large ? 1.5 : 1.6) * dpr / px);
  }

  // Arrow pointing along +x at the origin of the current transform, `r` long.
  function arrow(r, outline) {
    ctx.beginPath();
    ctx.moveTo(r, 0);
    ctx.lineTo(-r * 0.75, r * 0.72);
    ctx.lineTo(-r * 0.35, 0);
    ctx.lineTo(-r * 0.75, -r * 0.72);
    ctx.closePath();
    ctx.lineJoin = 'round';
    ctx.lineWidth = outline;
    ctx.strokeStyle = '#0b0906';
    ctx.stroke();
    ctx.fillStyle = ARROW;
    ctx.fill();
  }

  function draw(game, pad) {
    const dpr = fit();
    const W = canvas.width, H = canvas.height;
    const world = game.world, p = game.player;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, W, H);
    if (!world || !p) return;

    if (!large) {
      const px = W / (2 * SMALL_RADIUS);
      const ox = W / 2, oy = H * 0.58;
      const r = Math.ceil(SMALL_RADIUS * 1.6);
      const cx = Math.floor(p.x), cy = Math.floor(p.y);
      collect(world, cx - r, cy - r, cx + r, cy + r);
      ctx.translate(ox, oy);
      ctx.rotate(-p.yaw - Math.PI / 2);
      ctx.scale(px, px);
      ctx.translate(-p.x, -p.y);
      paint(px, dpr);
      ctx.setTransform(1, 0, 0, 1, ox, oy);
      ctx.rotate(-Math.PI / 2);
      arrow(Math.max(5 * dpr, px * 0.62), 2 * dpr);
      return;
    }

    const b = levelBounds(world);
    const pt = (pad?.top || 0) * dpr, pr = (pad?.right || 0) * dpr;
    const pb = (pad?.bottom || 0) * dpr, pl = (pad?.left || 0) * dpr;
    const aw = Math.max(1, W - pl - pr), ah = Math.max(1, H - pt - pb);
    const px = Math.min(aw / b.w, ah / b.h, 30 * dpr);
    const ox = pl + (aw - b.w * px) / 2 - b.x * px;
    const oy = pt + (ah - b.h * px) / 2 - b.y * px;
    collect(world, b.x, b.y, b.x + b.w, b.y + b.h);
    ctx.setTransform(px, 0, 0, px, ox, oy);
    paint(px, dpr);
    ctx.setTransform(1, 0, 0, 1, ox + p.x * px, oy + p.y * px);
    ctx.rotate(p.yaw);
    arrow(Math.max(6.5 * dpr, px * 0.8), 2 * dpr);
  }

  return { draw };
}
