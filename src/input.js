// Player input: touch controls (owns every DOM node inside #touch), keyboard, mouse with
// pointer lock, and gamepad. sample() merges all sources into one record per frame.

import { neutralInput } from './config.js';

const TOUCH_LOOK = 0.006;    // radians per CSS px of drag at sensitivity 1
const MOUSE_LOOK = 0.0025;   // radians per px of mouse travel at sensitivity 1
const KEY_TURN = 2.6;        // radians per second, arrow keys
const PAD_TURN = 3.4;        // radians per second at full stick deflection
const PAD_DEAD = 0.18;

const STICK_R = 56;          // stick base radius, CSS px
const STICK_DEAD = 6;        // px of thumb travel before the stick outputs anything
const KNOB_R = 26;
const RADIUS = { fire: 42, use: 28, next: 28, pause: 22 };
const HIT_SLOP = 10;         // buttons accept touches this far outside their edge
const DRAG_SLOP = { look: 2, fire: 6, btn: 10 };   // px ignored before a touch starts turning
const WHEEL_MS = 120;

const KEY_EDGES = {
  KeyE: 'use', Space: 'use', KeyQ: 'weaponNext',
  Escape: 'pause', KeyP: 'pause', KeyM: 'map', Tab: 'map',
};
const KEY_HELD = ['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'KeyF'];

const STYLE = `
.ti-layer{position:absolute;left:0;top:0;right:0;bottom:0;display:none;box-sizing:border-box;overflow:hidden;
padding:env(safe-area-inset-top,0px) env(safe-area-inset-right,0px) env(safe-area-inset-bottom,0px) env(safe-area-inset-left,0px);
pointer-events:auto;touch-action:none;-webkit-user-select:none;user-select:none;
-webkit-touch-callout:none;-webkit-tap-highlight-color:transparent}
.ti-layer.ti-on{display:block}
.ti-c{position:absolute;left:0;top:0;display:none;box-sizing:border-box;border-radius:50%;pointer-events:none}
.ti-touch .ti-c{display:flex}
.ti-btn{flex-direction:column;align-items:center;justify-content:center;
border:2px solid rgba(255,174,26,.5);background:rgba(18,11,3,.34);
box-shadow:0 0 0 1px rgba(0,0,0,.45),inset 0 0 0 1px rgba(0,0,0,.3);
color:rgba(255,196,96,.82);font:700 10px/1 ui-monospace,Menlo,Consolas,monospace;letter-spacing:.14em;
text-shadow:0 1px 0 rgba(0,0,0,.7);transition:background-color .08s,border-color .08s,transform .06s}
.ti-btn span{margin-right:-.14em}
.ti-btn svg{fill:none;stroke:currentColor;stroke-linecap:square;stroke-linejoin:miter}
.ti-btn.ti-down{background:rgba(255,166,20,.46);border-color:rgba(255,222,150,.95);color:#fff3d6;transform:scale(.93)}
.ti-fire{width:84px;height:84px}
.ti-fire .ti-ring{position:absolute;left:0;top:0;width:100%;height:100%;stroke-width:1.5;stroke-dasharray:5 4.16;opacity:.55;margin:-2px}
.ti-fire .ti-ico{width:30px;height:30px;stroke-width:2.2;margin:2px 0 5px}
.ti-use,.ti-next{width:56px;height:56px}
.ti-use{font-size:12px}
.ti-next .ti-ico{width:20px;height:14px;stroke-width:2.4;margin-bottom:4px}
.ti-pause{width:44px;height:44px;opacity:.8}
.ti-pause .ti-ico{width:16px;height:16px;stroke-width:3.4}
.ti-base{width:${STICK_R * 2}px;height:${STICK_R * 2}px;border:2px solid rgba(255,174,26,.42);
background:radial-gradient(rgba(18,11,3,.08) 40%,rgba(18,11,3,.36));box-shadow:0 0 0 1px rgba(0,0,0,.4);
color:rgba(255,174,26,.6);will-change:transform;transition:opacity .12s}
.ti-base svg{width:100%;height:100%;fill:currentColor}
.ti-knob{width:${KNOB_R * 2}px;height:${KNOB_R * 2}px;border:2px solid rgba(255,208,128,.8);
background:rgba(255,166,20,.34);box-shadow:0 0 0 1px rgba(0,0,0,.45);will-change:transform;transition:opacity .12s}
.ti-idle{opacity:.45}
`;

const HTML = `
<div class="ti-c ti-base ti-idle"><svg viewBox="0 0 112 112"><path d="M56 8l5 8H51zM56 104l5-8H51zM8 56l8-5v10zM104 56l-8-5v10z"/></svg></div>
<div class="ti-c ti-knob ti-idle"></div>
<div class="ti-c ti-btn ti-fire"><svg class="ti-ring" viewBox="0 0 84 84"><circle cx="42" cy="42" r="35"/></svg><svg class="ti-ico" viewBox="0 0 30 30"><circle cx="15" cy="15" r="6.5"/><path d="M15 2v7M15 21v7M2 15h7M21 15h7"/></svg><span>FIRE</span></div>
<div class="ti-c ti-btn ti-use"><span>USE</span></div>
<div class="ti-c ti-btn ti-next"><svg class="ti-ico" viewBox="0 0 20 14"><path d="M3 2l5 5-5 5M11 2l5 5-5 5"/></svg><span>WPN</span></div>
<div class="ti-c ti-btn ti-pause"><svg class="ti-ico" viewBox="0 0 16 16"><path d="M5 3v10M11 3v10"/></svg></div>
`;

export function createInput(touchRoot, opts = {}) {
  const view = opts.view || document.getElementById('view');
  const lockEl = view || touchRoot;
  let sens = opts.sensitivity ?? 1;
  let leftHanded = !!opts.leftHanded;
  let enabled = false;
  let isTouch = !!(window.matchMedia && window.matchMedia('(pointer: coarse)').matches);

  if (!document.getElementById('ti-style')) {
    const style = document.createElement('style');
    style.id = 'ti-style';
    style.textContent = STYLE;
    document.head.appendChild(style);
  }
  const layer = document.createElement('div');
  layer.className = isTouch ? 'ti-layer ti-touch' : 'ti-layer';
  layer.innerHTML = HTML;
  touchRoot.appendChild(layer);
  const baseEl = layer.querySelector('.ti-base');
  const knobEl = layer.querySelector('.ti-knob');
  const btnEl = {};
  for (const name of Object.keys(RADIUS)) btnEl[name] = layer.querySelector(`.ti-${name}`);

  // Layout in layer coordinates (CSS px), filled by layout().
  const geo = {
    ox: 0, oy: 0, w: 0, h: 0, top: 0, restX: 0, restY: 0,
    fire: { x: 0, y: 0 }, use: { x: 0, y: 0 }, next: { x: 0, y: 0 }, pause: { x: 0, y: 0 },
  };

  const touches = new Map();   // identifier -> { role, btn, sx, sy, lx, drag }
  const pressed = { fire: 0, use: 0, next: 0, pause: 0 };
  let stick = null;            // the touch record driving the stick
  let originX = 0;
  let originY = 0;
  let stickX = 0;
  let stickY = 0;
  let turn = 0;                // accumulated from touch drags and the mouse
  const keys = new Set();
  let mouseFire = false;
  let locked = false;
  let selfExit = false;
  let relock = false;
  let lastWheel = 0;
  let padPrev = -1;
  let lastSample = 0;
  const edges = { use: false, weaponNext: false, weaponPrev: false, weaponSlot: -1, pause: false, map: false };

  // ------------------------------------------------------------ touch layout

  function layout() {
    const box = layer.getBoundingClientRect();
    if (!box.width) return;
    const cs = getComputedStyle(layer);
    const sT = parseFloat(cs.paddingTop) || 0;
    const sR = parseFloat(cs.paddingRight) || 0;
    const sB = parseFloat(cs.paddingBottom) || 0;
    const sL = parseFloat(cs.paddingLeft) || 0;
    const W = box.width;
    const H = box.height;
    const portrait = H > W;
    // Portrait: the controls live below the 3D view when it leaves room for them.
    const viewBottom = portrait && view ? view.getBoundingClientRect().bottom - box.top : 0;
    const top = viewBottom > 0 && viewBottom < H - 260 ? viewBottom : sT;
    const fireInset = Math.max(leftHanded ? sL : sR, 16);
    const stickInset = Math.max(leftHanded ? sR : sL, 16);
    const bottom = H - Math.max(sB, 12);

    geo.ox = box.left;
    geo.oy = box.top;
    geo.w = W;
    geo.h = H;
    geo.top = top;

    const mirror = (x) => (leftHanded ? W - x : x);
    const place = (name, x, y) => {
      geo[name].x = x;
      geo[name].y = y;
      btnEl[name].style.left = `${x - RADIUS[name]}px`;
      btnEl[name].style.top = `${y - RADIUS[name]}px`;
    };
    const fx = W - fireInset - (portrait ? 62 : 96);
    const fy = bottom - (portrait ? 140 : 96);
    place('fire', mirror(fx), fy);
    place('use', mirror(fx - 88), fy + 24);
    place('next', mirror(fx + 14), fy - 90);
    // PAUSE is not mirrored: the HUD keeps the top-left corner (68 px past the inset) free
    // for it and puts the minimap top-right.
    place('pause', sL + 34, top + 32);

    geo.restX = mirror(stickInset + (portrait ? 80 : 100));
    geo.restY = bottom - (portrait ? 150 : 100);
    if (!stick) drawStick(geo.restX, geo.restY, geo.restX, geo.restY);
  }

  function drawStick(bx, by, kx, ky) {
    baseEl.style.transform = `translate3d(${bx - STICK_R}px,${by - STICK_R}px,0)`;
    knobEl.style.transform = `translate3d(${kx - KNOB_R}px,${ky - KNOB_R}px,0)`;
  }

  function setStickIdle(idle) {
    baseEl.classList.toggle('ti-idle', idle);
    knobEl.classList.toggle('ti-idle', idle);
  }

  function press(name, delta) {
    pressed[name] += delta;
    btnEl[name].classList.toggle('ti-down', pressed[name] > 0);
  }

  function hitButton(x, y) {
    let best = null;
    let bestD = HIT_SLOP;
    for (const name of Object.keys(RADIUS)) {
      const d = Math.hypot(x - geo[name].x, y - geo[name].y) - RADIUS[name];
      if (d < bestD) {
        best = name;
        bestD = d;
      }
    }
    return best;
  }

  function inStickZone(x, y) {
    const half = geo.w / 2;
    return (leftHanded ? x > half : x < half) && y > geo.top;
  }

  // ------------------------------------------------------------ touch events

  function markTouch() {
    if (isTouch) return;
    isTouch = true;
    layer.classList.add('ti-touch');
  }

  function onTouchStart(e) {
    prevent(e);
    if (!enabled) return;
    markTouch();
    // Drop records whose finger is gone without a touchend.
    for (const id of [...touches.keys()]) {
      let alive = false;
      for (const t of e.touches) if (t.identifier === id) alive = true;
      if (!alive) release(id, false);
    }
    for (const t of e.changedTouches) {
      const x = t.clientX - geo.ox;
      const y = t.clientY - geo.oy;
      const tr = { role: 'look', btn: null, sx: x, sy: y, lx: x, drag: false };
      const btn = hitButton(x, y);
      if (btn) {
        tr.role = btn === 'fire' ? 'fire' : 'btn';
        tr.btn = btn;
        press(btn, 1);
        if (btn === 'use') edges.use = true;
        else if (btn === 'next') edges.weaponNext = true;
      } else if (!stick && inStickZone(x, y)) {
        tr.role = 'stick';
        stick = tr;
        originX = x;
        originY = y;
        stickX = 0;
        stickY = 0;
        setStickIdle(false);
        drawStick(x, y, x, y);
      }
      touches.set(t.identifier, tr);
    }
  }

  function onTouchMove(e) {
    prevent(e);
    for (const t of e.changedTouches) {
      const tr = touches.get(t.identifier);
      if (!tr) continue;
      const x = t.clientX - geo.ox;
      const y = t.clientY - geo.oy;
      if (tr.role === 'stick') {
        moveStick(x, y);
      } else if (tr.drag) {
        turn += (x - tr.lx) * TOUCH_LOOK * sens;
        tr.lx = x;
      } else if (Math.hypot(x - tr.sx, y - tr.sy) > DRAG_SLOP[tr.role]) {
        // From here on the drag is 1:1; the slop itself is not applied, so there is no jump.
        tr.drag = true;
        tr.lx = x;
        if (tr.role === 'btn') press(tr.btn, -1);
      }
    }
  }

  function moveStick(x, y) {
    let dx = x - originX;
    let dy = y - originY;
    let d = Math.hypot(dx, dy);
    if (d > STICK_R) {
      // The base follows the thumb once it is dragged past the rim.
      const k = STICK_R / d;
      originX = x - dx * k;
      originY = y - dy * k;
      dx *= k;
      dy *= k;
      d = STICK_R;
    }
    const mag = d <= STICK_DEAD ? 0 : (d - STICK_DEAD) / (STICK_R - STICK_DEAD);
    stickX = mag ? (dx / d) * mag : 0;
    stickY = mag ? (-dy / d) * mag : 0;
    drawStick(originX, originY, x, y);
  }

  function release(id, completed) {
    const tr = touches.get(id);
    if (!tr) return;
    touches.delete(id);
    if (tr.role === 'stick') {
      stick = null;
      stickX = 0;
      stickY = 0;
      setStickIdle(true);
      drawStick(geo.restX, geo.restY, geo.restX, geo.restY);
    } else if (tr.role === 'fire') {
      press('fire', -1);
    } else if (tr.role === 'btn' && !tr.drag) {
      press(tr.btn, -1);
      // PAUSE acts on release so that sliding off it cancels.
      if (tr.btn === 'pause' && completed) edges.pause = true;
    }
  }

  function releaseAll() {
    for (const id of [...touches.keys()]) release(id, false);
  }

  function onTouchEnd(e) {
    prevent(e);
    for (const t of e.changedTouches) release(t.identifier, true);
  }

  // ------------------------------------------------------------ keyboard, mouse

  function onKeyDown(e) {
    if (!enabled || e.metaKey || e.ctrlKey || e.altKey) return;
    const code = e.code;
    const slot = /^(?:Digit|Numpad)([1-5])$/.exec(code);
    const edge = KEY_EDGES[code];
    if (!slot && !edge && !KEY_HELD.includes(code)) return;
    e.preventDefault();
    // Auto-repeat never retriggers, and a key held from before enabling stays ignored.
    if (e.repeat || keys.has(code)) return;
    keys.add(code);
    if (edge) edges[edge] = true;
    else if (slot) edges.weaponSlot = slot[1] - 1;
  }

  function onKeyUp(e) {
    keys.delete(e.code);
  }

  function requestLock() {
    if (!lockEl.requestPointerLock) return false;
    const p = lockEl.requestPointerLock();
    if (p && p.catch) p.catch(() => {});
    return true;
  }

  // pointerdown rather than mousedown: a tap on the minimap (which sits above the touch layer)
  // also produces compatibility mouse events, and those must not fire or take the lock.
  function onPointerDown(e) {
    if (!enabled || e.pointerType !== 'mouse' || e.button !== 0) return;
    if (locked || !requestLock()) mouseFire = true;
  }

  function onMouseUp(e) {
    if (e.button === 0) mouseFire = false;
  }

  function onMouseMove(e) {
    if (!enabled || !locked) return;
    const dx = e.movementX || 0;
    if (Math.abs(dx) < 400) turn += dx * MOUSE_LOOK * sens;   // drop the odd bogus spike
  }

  function onLockChange() {
    const now = document.pointerLockElement === lockEl;
    if (locked && !now) {
      mouseFire = false;
      // Esc is swallowed by the browser to release the lock, so losing it means pause.
      if (enabled && !selfExit) {
        edges.pause = true;
        relock = true;
      }
    }
    locked = now;
    selfExit = false;
  }

  function onWheel(e) {
    if (!enabled || !e.deltaY || e.timeStamp - lastWheel < WHEEL_MS) return;
    lastWheel = e.timeStamp;
    if (e.deltaY > 0) edges.weaponNext = true;
    else edges.weaponPrev = true;
  }

  // ------------------------------------------------------------ gamepad

  function pollPad(out, dt) {
    let pad = null;
    for (const p of navigator.getGamepads ? navigator.getGamepads() : []) {
      if (p && p.connected && p.mapping === 'standard') {
        pad = p;
        break;
      }
    }
    if (!pad) return;
    const axis = (i) => {
      const v = pad.axes[i] || 0;
      const a = Math.abs(v);
      return a < PAD_DEAD ? 0 : (Math.sign(v) * (a - PAD_DEAD)) / (1 - PAD_DEAD);
    };
    const down = (i) => !!pad.buttons[i] && (pad.buttons[i].pressed || pad.buttons[i].value > 0.5);
    out.moveX += axis(0);
    out.moveY -= axis(1);
    const tx = axis(2);
    out.turn += tx * Math.abs(tx) * PAD_TURN * sens * dt;
    if (down(7)) out.fire = true;
    let mask = 0;
    for (const i of [0, 4, 5, 8, 9]) if (down(i)) mask |= 1 << i;
    const hit = mask & ~padPrev;
    padPrev = mask;
    if (hit & 1) out.use = true;            // A
    if (hit & 32) out.weaponNext = true;    // RB
    if (hit & 16) out.weaponPrev = true;    // LB
    if (hit & 512) out.pause = true;        // Start
    if (hit & 256) out.map = true;          // Back
  }

  // ------------------------------------------------------------ state

  function clearEdges() {
    edges.use = false;
    edges.weaponNext = false;
    edges.weaponPrev = false;
    edges.weaponSlot = -1;
    edges.pause = false;
    edges.map = false;
  }

  function clearHeld() {
    releaseAll();
    keys.clear();
    mouseFire = false;
    turn = 0;
  }

  function sample() {
    const now = performance.now();
    const dt = Math.min((now - lastSample) / 1000, 0.1);
    lastSample = now;
    const out = neutralInput();
    out.isTouch = isTouch;
    if (!enabled) return out;

    out.moveX = stickX + (keys.has('KeyD') ? 1 : 0) - (keys.has('KeyA') ? 1 : 0);
    out.moveY = stickY + (keys.has('KeyW') || keys.has('ArrowUp') ? 1 : 0)
      - (keys.has('KeyS') || keys.has('ArrowDown') ? 1 : 0);
    out.turn = turn + ((keys.has('ArrowRight') ? 1 : 0) - (keys.has('ArrowLeft') ? 1 : 0)) * KEY_TURN * dt;
    out.fire = pressed.fire > 0 || mouseFire || keys.has('KeyF');
    out.use = edges.use;
    out.weaponNext = edges.weaponNext;
    out.weaponPrev = edges.weaponPrev;
    out.weaponSlot = edges.weaponSlot;
    out.pause = edges.pause;
    out.map = edges.map;
    turn = 0;
    clearEdges();
    pollPad(out, dt);

    const len = Math.hypot(out.moveX, out.moveY);
    if (len > 1) {
      out.moveX /= len;
      out.moveY /= len;
    }
    return out;
  }

  function setEnabled(on) {
    on = !!on;
    if (on === enabled) return;
    clearHeld();
    clearEdges();
    enabled = on;
    layer.classList.toggle('ti-on', on);
    if (on) {
      lastSample = performance.now();
      layout();
      // Works when called from the click or key press that resumed the game; otherwise the
      // next click in the view takes the lock.
      if (relock) requestLock();
      relock = false;
    } else {
      padPrev = -1;   // buttons held across the pause do not fire an edge on resume
      relock = relock || locked;
      if (locked) {
        selfExit = true;
        document.exitPointerLock();
      }
    }
  }

  function prevent(e) {
    if (e.cancelable) e.preventDefault();
  }

  const active = { passive: false };
  touchRoot.addEventListener('touchstart', onTouchStart, active);
  touchRoot.addEventListener('touchmove', onTouchMove, active);
  touchRoot.addEventListener('touchend', onTouchEnd, active);
  touchRoot.addEventListener('touchcancel', releaseAll);
  touchRoot.addEventListener('dblclick', prevent);
  for (const el of new Set([touchRoot, lockEl])) {
    el.addEventListener('contextmenu', prevent);
    el.addEventListener('pointerdown', onPointerDown);
  }
  for (const type of ['gesturestart', 'gesturechange', 'gestureend']) {
    document.addEventListener(type, prevent, active);
  }
  if (!isTouch) window.addEventListener('touchstart', markTouch, { capture: true, passive: true });

  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('keyup', onKeyUp);
  window.addEventListener('mouseup', onMouseUp);
  window.addEventListener('mousemove', onMouseMove);
  window.addEventListener('wheel', onWheel, { passive: true });
  document.addEventListener('pointerlockchange', onLockChange);

  window.addEventListener('blur', clearHeld);
  window.addEventListener('pagehide', clearHeld);
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) clearHeld();
  });
  window.addEventListener('resize', layout);
  window.addEventListener('orientationchange', () => {
    releaseAll();
    layout();
  });
  if (window.ResizeObserver) {
    const ro = new ResizeObserver(layout);
    ro.observe(layer);
    if (view) ro.observe(view);
  }

  return {
    sample,
    setEnabled,
    setSensitivity(v) {
      sens = v;
    },
    setLayout(l) {
      leftHanded = !!(l && l.leftHanded);
      releaseAll();
      layout();
    },
    get isTouch() {
      return isTouch;
    },
  };
}
