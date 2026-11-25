// In-view HUD: readouts, crosshair, message line, tints, hit direction, minimap.
//
//   const hud = createHud(document.getElementById('hud'))
//   hud.update(game)            every frame; touches the DOM only when a value changed
//   hud.message(text)
//   hud.damage(amount, angle)   angle of the source relative to the player's yaw (0 = ahead, + = right)
//   hud.pickup()
//   hud.setVisible(bool)
//   hud.onMapToggle(fn)         fn(open) after the minimap was tapped
//   hud.toggleMap()             for the keyboard map key

import { KEY_COLORS, KEY_NAMES, WEAPON_IDS } from '../config.js';
import { WEAPONS } from '../game/tuning.js';
import { createMinimap } from './minimap.js';

const MESSAGE_MS = 2600;
const MAX_MESSAGES = 3;
const LOW_HEALTH = 25;

const KEY_SVG = (name) => `<svg class="hud-key" data-key="${name}" viewBox="0 0 34 16">
  <path fill="${KEY_COLORS[name]}" stroke="#0b0906" stroke-width="1.5" stroke-linejoin="round"
    d="M8 1.5a6.5 6.5 0 0 1 6.2 4.5H32.5v4h-3v4h-4v-4h-3v3h-4v-3h-4.3A6.5 6.5 0 1 1 8 1.5zm-1 4.3a2.2 2.2 0 1 0 0 4.4 2.2 2.2 0 0 0 0-4.4z"/>
</svg>`;

const TEMPLATE = `
<div class="hud-tint hud-tint-low"></div>
<div class="hud-tint hud-tint-damage"></div>
<div class="hud-tint hud-tint-pickup"></div>
<div class="hud-bigmap">
  <canvas></canvas>
  <div class="hud-bigmap-info"><b></b><span></span><span></span><span></span><span></span></div>
</div>
<div class="hud-cross"><svg viewBox="0 0 24 24">
  <path d="M12 2.5v5M12 16.5v5M2.5 12h5M16.5 12h5" stroke="#000" stroke-opacity=".65" stroke-width="3.4"/>
  <path d="M12 2.5v5M12 16.5v5M2.5 12h5M16.5 12h5" stroke="currentColor" stroke-width="1.6"/>
  <rect x="10.4" y="10.4" width="3.2" height="3.2" fill="#000" fill-opacity=".65"/>
  <rect x="11.1" y="11.1" width="1.8" height="1.8" fill="currentColor"/>
</svg></div>
<div class="hud-hits">${`<div class="hud-hit"><svg viewBox="0 0 100 100">
  <path fill="currentColor" d="M26 8.4A48 48 0 0 1 74 8.4A200 200 0 0 0 26 8.4z"/>
</svg></div>`.repeat(3)}</div>
<div class="hud-msgs"></div>
<div class="hud-vitals">
  <div class="hud-plate hud-health">
    <span class="hud-lbl">HEALTH</span>
    <svg class="hud-ico" viewBox="0 0 16 16"><path d="M6 1h4v5h5v4h-5v5H6v-5H1V6h5z"/></svg>
    <b class="hud-num">0</b>
  </div>
  <div class="hud-plate hud-armor">
    <span class="hud-lbl">ARMOR</span>
    <svg class="hud-ico" viewBox="0 0 16 16"><path d="M8 1l6 2v5c0 3.6-2.5 6-6 7-3.5-1-6-3.4-6-7V3z"/></svg>
    <b class="hud-num">0</b>
  </div>
</div>
<div class="hud-arms">
  <div class="hud-keys">${KEY_NAMES.map(KEY_SVG).join('')}</div>
  <div class="hud-plate right hud-ammo">
    <span class="hud-lbl"></span>
    <div class="hud-slots">${WEAPON_IDS.map(() => '<i></i>').join('')}</div>
    <b class="hud-num">0</b>
  </div>
</div>
<div class="hud-minimap" role="button" aria-label="Toggle map"><canvas></canvas></div>
`;

function clock(seconds) {
  const s = Math.max(0, Math.floor(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

export function createHud(hudEl) {
  hudEl.innerHTML = TEMPLATE;
  const $ = (sel) => hudEl.querySelector(sel);

  const el = {
    damage: $('.hud-tint-damage'),
    pickup: $('.hud-tint-pickup'),
    msgs: $('.hud-msgs'),
    hits: [...hudEl.querySelectorAll('.hud-hit')],
    health: $('.hud-health'),
    healthNum: $('.hud-health .hud-num'),
    armor: $('.hud-armor'),
    armorNum: $('.hud-armor .hud-num'),
    ammo: $('.hud-ammo'),
    ammoNum: $('.hud-ammo .hud-num'),
    weapon: $('.hud-ammo .hud-lbl'),
    slots: [...hudEl.querySelectorAll('.hud-slots i')],
    keys: [...hudEl.querySelectorAll('.hud-key')],
    mapButton: $('.hud-minimap'),
    bigInfo: [...$('.hud-bigmap-info').children],
  };

  const minimap = createMinimap($('.hud-minimap canvas'));
  const bigmap = createMinimap($('.hud-bigmap canvas'), { large: true });

  // Last values written to the DOM.
  const shown = { health: null, armor: null, ammo: null, weapon: null, slots: '', keys: '', info: '' };
  let mapOpen = false;
  let mapToggleFn = null;
  let frame = 0;
  let nextHit = 0;

  function bump(node) {
    node.animate([{ color: '#fffbe8' }, {}], { duration: 260, easing: 'ease-out' });
  }

  function update(game) {
    const p = game.player;
    if (!p) return;

    const health = Math.max(0, Math.ceil(p.health));
    if (health !== shown.health) {
      if (shown.health !== null) bump(el.healthNum);
      shown.health = health;
      el.healthNum.textContent = health;
      const low = health <= LOW_HEALTH;
      el.health.classList.toggle('warn', low);
      hudEl.classList.toggle('low', low && health > 0);
    }

    const armor = Math.max(0, Math.ceil(p.armor));
    if (armor !== shown.armor) {
      if (shown.armor !== null) bump(el.armorNum);
      shown.armor = armor;
      el.armorNum.textContent = armor;
      el.armor.classList.toggle('dim', armor === 0);
    }

    const weapon = WEAPONS[p.weapon];
    if (p.weapon !== shown.weapon) {
      shown.weapon = p.weapon;
      shown.ammo = null;
      el.weapon.textContent = weapon.name.toUpperCase();
    }

    const ammo = weapon.ammo ? p.ammo[weapon.ammo] : -1;
    if (ammo !== shown.ammo) {
      shown.ammo = ammo;
      el.ammoNum.textContent = ammo < 0 ? '--' : ammo;
      el.ammo.classList.toggle('warn', ammo === 0);
    }

    let slots = '';
    for (let i = 0; i < el.slots.length; i++) slots += i === p.weapon ? '2' : p.weapons[i] ? '1' : '0';
    if (slots !== shown.slots) {
      shown.slots = slots;
      el.slots.forEach((node, i) => {
        node.className = slots[i] === '2' ? 'have on' : slots[i] === '1' ? 'have' : '';
      });
    }

    let keys = '';
    for (const name of KEY_NAMES) keys += p.keys[name] ? '1' : '0';
    if (keys !== shown.keys) {
      shown.keys = keys;
      el.keys.forEach((node, i) => node.classList.toggle('have', keys[i] === '1'));
    }

    // The map canvases are redrawn at a third of the frame rate, offset from each other.
    frame++;
    if (frame % 3 === 0) minimap.draw(game);
    if (mapOpen && frame % 3 === 1) drawBigMap(game);
  }

  function drawBigMap(game) {
    const em = parseFloat(getComputedStyle(hudEl).fontSize);
    bigmap.draw(game, { top: 5.2 * em, bottom: 6.6 * em, left: 1.5 * em, right: 1.5 * em });

    const s = game.stats;
    const info = `${game.level ? game.level.name : ''}|${s.kills}/${s.totalKills}|${s.items}/${s.totalItems}|${s.secrets}/${s.totalSecrets}|${clock(s.time)}`;
    if (info !== shown.info) {
      shown.info = info;
      const part = info.split('|');
      el.bigInfo[0].textContent = part[0].toUpperCase();
      el.bigInfo[1].textContent = `KILLS ${part[1]}`;
      el.bigInfo[2].textContent = `ITEMS ${part[2]}`;
      el.bigInfo[3].textContent = `SECRETS ${part[3]}`;
      el.bigInfo[4].textContent = `TIME ${part[4]}`;
    }
  }

  function message(text) {
    if (!text) return;
    const node = document.createElement('div');
    node.className = 'hud-msg';
    node.textContent = text;
    el.msgs.append(node);
    while (el.msgs.children.length > MAX_MESSAGES) el.msgs.firstChild.remove();
    setTimeout(() => node.classList.add('out'), MESSAGE_MS);
    setTimeout(() => node.remove(), MESSAGE_MS + 700);
  }

  function damage(amount, angle) {
    const strength = Math.min(0.9, 0.3 + (amount || 0) / 45);
    el.damage.animate([{ opacity: strength }, { opacity: 0 }], { duration: 520, easing: 'ease-out' });
    if (typeof angle !== 'number' || Number.isNaN(angle)) return;
    const hit = el.hits[nextHit];
    nextHit = (nextHit + 1) % el.hits.length;
    hit.style.transform = `rotate(${angle}rad)`;
    hit.animate([{ opacity: 1 }, { opacity: 1, offset: 0.35 }, { opacity: 0 }], { duration: 1100 });
  }

  function pickup() {
    el.pickup.animate([{ opacity: 0.5 }, { opacity: 0 }], { duration: 320, easing: 'ease-out' });
  }

  function setVisible(visible) {
    hudEl.hidden = !visible;
  }

  function toggleMap() {
    mapOpen = !mapOpen;
    shown.info = '';
    frame = 0;
    hudEl.classList.toggle('map-open', mapOpen);
    return mapOpen;
  }

  // pointerdown, not click: it still arrives if a touch handler elsewhere cancels the tap.
  el.mapButton.addEventListener('pointerdown', (e) => {
    e.stopPropagation();
    toggleMap();
    if (mapToggleFn) mapToggleFn(mapOpen);
  });

  return {
    update,
    message,
    damage,
    pickup,
    setVisible,
    onMapToggle(fn) { mapToggleFn = fn; },
    toggleMap,
  };
}
