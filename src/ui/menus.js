// Menus and full-screen states, plus the localStorage helpers for settings and the save.
//
//   const menus = createMenus(document.getElementById('menu'), handlers)
//   menus.show(screen, data)   menus.hide()   menus.current
//
// handlers: onNewGame(difficulty), onContinue(), onResume(), onRestartLevel(), onQuit(),
//           onNextLevel(), onSettings(settings), onSound(id) (optional: 'menu_move' | 'menu_select')
//
// A button that leaves the menus changes the screen first and calls its handler second,
// so a handler may call show()/hide() itself and that wins:
//   Continue, difficulty pick, Resume, Restart, Retry, Next Level -> hide()
//   Quit to Title, Back to Title                                  -> show('title')
//
// data per screen:
//   intermission  { name, stats, par }   stats as game.stats, par in seconds
//   victory       { stats, difficulty }  totals over the whole run
//   loading       { text, progress }     progress 0..1, omit for an indeterminate bar

import {
  DEFAULT_SETTINGS, DIFFICULTY_NAMES, RENDER_H_DEFAULT, RENDER_H_HIGH, SAVE_KEY, SETTINGS_KEY,
} from '../config.js';

// ---------------------------------------------------------------- storage

function read(key) {
  try {
    return JSON.parse(localStorage.getItem(key));
  } catch {
    return null;
  }
}

function write(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // storage full or blocked: play on without persistence
  }
}

export function loadSettings() {
  const s = { ...DEFAULT_SETTINGS };
  const stored = read(SETTINGS_KEY);
  if (stored && typeof stored === 'object') {
    for (const key of Object.keys(s)) {
      if (typeof stored[key] === typeof s[key]) s[key] = stored[key];
    }
  }
  if (s.quality !== RENDER_H_HIGH) s.quality = RENDER_H_DEFAULT;
  return s;
}

export function saveSettings(settings) {
  write(SETTINGS_KEY, settings);
}

// -> { levelIndex, difficulty, loadout } or null
export function loadSave() {
  const s = read(SAVE_KEY);
  return s && typeof s.levelIndex === 'number' ? s : null;
}

export function saveSave(save) {
  write(SAVE_KEY, save);
}

export function clearSave() {
  try {
    localStorage.removeItem(SAVE_KEY);
  } catch {
    // nothing to clear
  }
}

// ---------------------------------------------------------------- wordmark

// Stencil letters on a 100 x 140 cell: each glyph is a few solid pieces separated by bridges.
const GLYPHS = {
  S: [
    [[14, 0], [100, 0], [100, 26], [26, 26], [26, 50], [0, 50], [0, 14]],
    [[0, 57], [100, 57], [100, 107], [74, 107], [74, 83], [0, 83]],
    [[0, 114], [100, 114], [100, 126], [86, 140], [0, 140]],
  ],
  L: [
    [[0, 0], [26, 0], [26, 107], [0, 107]],
    [[0, 114], [100, 114], [100, 140], [14, 140], [0, 126]],
  ],
  A: [
    [[14, 0], [86, 0], [100, 14], [100, 57], [74, 57], [74, 26], [26, 26], [26, 57], [0, 57], [0, 14]],
    [[0, 64], [100, 64], [100, 140], [74, 140], [74, 90], [26, 90], [26, 140], [0, 140]],
  ],
  G: [
    [[14, 0], [100, 0], [100, 26], [26, 26], [26, 114], [67, 114], [67, 140], [14, 140], [0, 126], [0, 14]],
    [[48, 64], [100, 64], [100, 126], [86, 140], [74, 140], [74, 90], [48, 90]],
  ],
  W: [
    [[0, 0], [26, 0], [26, 114], [74, 114], [74, 0], [100, 0], [100, 126], [86, 140], [14, 140], [0, 126]],
    [[37, 40], [63, 40], [63, 107], [37, 107]],
  ],
  O: [
    [[14, 0], [46.5, 0], [46.5, 26], [26, 26], [26, 114], [46.5, 114], [46.5, 140], [14, 140], [0, 126], [0, 14]],
    [[53.5, 0], [86, 0], [100, 14], [100, 126], [86, 140], [53.5, 140], [53.5, 114], [74, 114], [74, 26], [53.5, 26]],
  ],
  R: [
    [[0, 0], [26, 0], [26, 140], [0, 140]],
    [[33, 0], [86, 0], [100, 14], [100, 76], [86, 90], [33, 90], [33, 64], [74, 64], [74, 26], [33, 26]],
    [[45, 97], [73, 97], [100, 140], [72, 140]],
  ],
  K: [
    [[0, 0], [26, 0], [26, 140], [0, 140]],
    [[33, 66], [33, 44], [66, 0], [100, 0], [50, 66]],
    [[33, 73], [50, 73], [100, 140], [66, 140], [33, 95]],
  ],
};

const GLYPH_W = 100;
const GLYPH_H = 140;
const GLYPH_GAP = 18;

export function wordmark(text = 'SLAGWORKS') {
  const width = text.length * GLYPH_W + (text.length - 1) * GLYPH_GAP;
  let polys = '';
  [...text].forEach((ch, i) => {
    const x = i * (GLYPH_W + GLYPH_GAP);
    for (const piece of GLYPHS[ch]) {
      polys += `<polygon points="${piece.map(([px, py]) => `${px + x},${py}`).join(' ')}"/>`;
    }
  });
  return `<svg class="wordmark" viewBox="0 0 ${width} ${GLYPH_H}" role="img" aria-label="${text}">
  <defs><linearGradient id="wm-heat" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0" stop-color="#ffe2a0"/><stop offset=".45" stop-color="#ffae1a"/>
    <stop offset=".8" stop-color="#ff7a1c"/><stop offset="1" stop-color="#d93f0b"/>
  </linearGradient></defs>
  <g fill="url(#wm-heat)">${polys}</g>
</svg>`;
}

// ---------------------------------------------------------------- screens

const DIFFICULTY_NOTES = [
  'Light damage, slower machines. Learn the floor.',
  'The foundry as built. A fair shift.',
  'Heavy damage, relentless machines. No mercy.',
];

// Screens drawn over the frozen game view; the rest get the opaque backdrop.
const VEILED = ['pause', 'dead', 'intermission'];

const esc = (text) => String(text).replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));

function clock(seconds) {
  const s = Math.max(0, Math.floor(seconds || 0));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

const button = (act, label, { cls = '', note = '', arg = '' } = {}) => `
<button type="button" class="btn ${cls}" data-act="${act}"${arg !== '' ? ` data-arg="${arg}"` : ''}>
  <i class="chev"></i><span class="txt">${label}${note ? `<small>${note}</small>` : ''}</span>
</button>`;

const panel = (title, body, { wide = false, sub = '' } = {}) => `
<div class="menu-frame${wide ? ' wide' : ''}"><div class="menu-scroll">
  <div class="menu-head"><h2>${title}</h2></div>
  ${sub ? `<p class="menu-sub">${sub}</p>` : ''}
  ${body}
</div></div>`;

function tally(stats) {
  const row = (label, found, total) => `
    <span>${label}</span>
    <span class="val${total > 0 && found >= total ? ' good' : ''}">${found}<span class="of"> / ${total}</span></span>
    <span class="gauge"><i style="width:${total > 0 ? Math.round((100 * found) / total) : 100}%"></i></span>`;
  return row('Kills', stats.kills, stats.totalKills)
    + row('Items', stats.items, stats.totalItems)
    + row('Secrets', stats.secrets, stats.totalSecrets);
}

const SHARE_ICON = '<svg viewBox="0 0 20 24"><path d="M10 15V2M5.5 6.2L10 1.8l4.5 4.4M6 9.5H3v13h14v-13h-3"/></svg>';

export function createMenus(menuEl, handlers = {}) {
  let current = null;
  let parent = 'title';      // where Back leads from settings
  let settings = loadSettings();

  const render = {
    title() {
      const save = loadSave();
      const canContinue = save !== null;
      const where = save ? `Level ${save.levelIndex + 1} / ${DIFFICULTY_NAMES[save.difficulty] ?? ''}` : '';
      return `
<div class="title">
  <div class="title-brand">
    ${wordmark()}
    <div class="title-rule"></div>
    <p class="title-tag">Derelict orbital foundry. Salvage rights pending.</p>
  </div>
  <div class="menu-scroll"><div class="menu-list">
    ${canContinue ? button('continue', 'Continue', { cls: 'primary', note: esc(where) }) : ''}
    ${button('go', 'New Game', { arg: 'difficulty', cls: canContinue ? '' : 'primary' })}
    ${button('go', 'Settings', { arg: 'settings' })}
    ${button('go', 'How to Play', { arg: 'help' })}
  </div></div>
</div>`;
    },

    difficulty() {
      return panel('New Game', `
<div class="menu-list">
  ${DIFFICULTY_NAMES.map((name, i) => button('newgame', name, { arg: i, note: DIFFICULTY_NOTES[i], cls: i === 1 ? 'primary' : '' })).join('')}
  ${button('back', 'Back', { cls: 'back' })}
</div>`, { sub: 'Choose your grade' });
    },

    settings() {
      const slider = (key, label, min, max, step) => `
<label class="set-row">
  <span class="set-label">${label}<output data-out="${key}"></output></span>
  <input class="range" type="range" data-set="${key}" min="${min}" max="${max}" step="${step}" value="${settings[key]}">
</label>`;
      const pair = (key, label, options) => `
<div class="set-row">
  <span class="set-label">${label}</span>
  <div class="segs">${options.map(([value, text]) => `<button type="button" class="seg" data-set="${key}" data-value="${value}">${text}</button>`).join('')}</div>
</div>`;
      return panel('Settings', `
<div class="set-grid">
  ${slider('sensitivity', 'Look sensitivity', 0.3, 2.5, 0.1)}
  ${slider('sfx', 'Effects volume', 0, 1, 0.05)}
  ${slider('music', 'Music volume', 0, 1, 0.05)}
  ${pair('quality', 'Render quality', [[RENDER_H_DEFAULT, `Retro ${RENDER_H_DEFAULT}`], [RENDER_H_HIGH, `Fine ${RENDER_H_HIGH}`]])}
  ${pair('leftHanded', 'Left-handed controls', [[false, 'Off'], [true, 'On']])}
  <div class="set-row end">${button('back', 'Back', { cls: 'back' })}</div>
</div>`, { wide: true });
    },

    help() {
      return panel('How to Play', `
<div class="help-cols">
  <div>
    <h3>Touch</h3>
    <dl>
      <dt>Left thumb</dt><dd>Drag to move. The stick appears where you land.</dd>
      <dt>Right thumb</dt><dd>Drag to turn.</dd>
      <dt>Fire</dt><dd>Hold to shoot. Keep dragging to aim.</dd>
      <dt>Use</dt><dd>Doors, switches, the exit. Walking into them works too.</dd>
      <dt>Next</dt><dd>Cycle weapons.</dd>
      <dt>Minimap</dt><dd>Tap for the full map.</dd>
    </dl>
  </div>
  <div>
    <h3>Keyboard and mouse</h3>
    <dl>
      <dt>W A S D</dt><dd>Move. Arrow keys work as well.</dd>
      <dt>Mouse</dt><dd>Turn. Click the view to capture it.</dd>
      <dt>Left button</dt><dd>Fire.</dd>
      <dt>E / Space</dt><dd>Use.</dd>
      <dt>1-5 / Q / wheel</dt><dd>Weapons.</dd>
      <dt>M / Tab</dt><dd>Map.</dd>
      <dt>Esc / P</dt><dd>Pause.</dd>
    </dl>
  </div>
</div>
<div class="help-foot">
  <div class="tip">${SHARE_ICON}<span>iPhone: tap Share, then Add to Home Screen, and launch from the icon for full-screen play.</span></div>
  ${button('back', 'Back', { cls: 'back' })}
</div>`, { wide: true });
    },

    pause() {
      return panel('Paused', `
<div class="menu-list">
  ${button('resume', 'Resume', { cls: 'primary' })}
  ${button('restart', 'Restart Level')}
  ${button('go', 'Settings', { arg: 'settings' })}
  ${button('quit', 'Quit to Title', { cls: 'back' })}
</div>`);
    },

    dead() {
      return panel('Shift Ended', `
<div class="menu-list">
  ${button('restart', 'Retry', { cls: 'primary' })}
  ${button('quit', 'Quit', { cls: 'back' })}
</div>`, { sub: 'The machines kept the floor.' });
    },

    intermission(data) {
      const stats = data.stats ?? {};
      const par = data.par ?? data.level?.par ?? 0;
      const underPar = par > 0 && stats.time <= par;
      return panel('Level Clear', `
<div class="tally">
  ${tally(stats)}
  <span>Time</span>
  <span class="val${underPar ? ' good' : ''}">${clock(stats.time)}</span>
  <span class="note">Par ${clock(par)}</span>
</div>
<div class="menu-list">${button('next', 'Next Level', { cls: 'primary' })}</div>`, { sub: esc(data.name ?? data.level?.name ?? '') });
    },

    victory(data) {
      const stats = data.stats ?? {};
      const grade = DIFFICULTY_NAMES[data.difficulty];
      return panel('Foundry Silenced', `
<p class="flavor">The Overseer is slag and the lines have stopped. The salvage rights are yours.</p>
<div class="tally">
  ${tally(stats)}
  <span>Time</span>
  <span class="val">${clock(stats.time)}</span>
  <span class="note">${grade ? `Grade: ${grade}` : ''}</span>
</div>
<div class="menu-list">${button('quit', 'Back to Title', { cls: 'primary' })}</div>`);
    },

    loading(data) {
      const fixed = typeof data.progress === 'number';
      const width = fixed ? `style="width:${Math.round(100 * Math.min(1, Math.max(0, data.progress)))}%"` : '';
      return `
<div class="loading">
  ${wordmark()}
  <div class="bar${fixed ? ' fixed' : ''}"><i ${width}></i></div>
  <p>${esc(data.text ?? 'Firing up')}</p>
</div>`;
    },
  };

  function show(screen, data = {}) {
    if (screen === 'settings' && (current === 'title' || current === 'pause')) parent = current;
    current = screen;
    const veiled = VEILED.includes(screen) || (screen === 'settings' && parent === 'pause');
    menuEl.className = `${veiled ? 'veil' : 'solid'}${screen === 'dead' ? ' dead' : ''}`;
    menuEl.dataset.screen = screen;
    menuEl.innerHTML = render[screen](data);
    menuEl.hidden = false;
    if (screen === 'settings') syncSettings();
    const first = menuEl.querySelector('.btn.primary') ?? menuEl.querySelector('.btn');
    if (first) first.focus({ preventScroll: true });
  }

  function hide() {
    current = null;
    menuEl.hidden = true;
    menuEl.innerHTML = '';
    delete menuEl.dataset.screen;
  }

  function back() {
    if (current === 'settings') show(parent);
    else if (current === 'difficulty' || current === 'help') show('title');
    else if (current === 'pause') actions.resume();
  }

  const actions = {
    go: (arg) => show(arg),
    back,
    continue: () => { hide(); handlers.onContinue?.(); },
    newgame: (arg) => { hide(); handlers.onNewGame?.(Number(arg)); },
    resume: () => { hide(); handlers.onResume?.(); },
    restart: () => { hide(); handlers.onRestartLevel?.(); },
    next: () => { hide(); handlers.onNextLevel?.(); },
    quit: () => { show('title'); handlers.onQuit?.(); },
  };

  // Reflect the settings object in the controls of the settings screen.
  function syncSettings() {
    for (const node of menuEl.querySelectorAll('[data-set]')) {
      const key = node.dataset.set;
      if (node.type === 'range') {
        const min = Number(node.min), max = Number(node.max);
        node.style.setProperty('--fill', `${(100 * (settings[key] - min)) / (max - min)}%`);
      } else {
        node.setAttribute('aria-pressed', String(settings[key]) === node.dataset.value);
      }
    }
    for (const out of menuEl.querySelectorAll('[data-out]')) {
      const value = settings[out.dataset.out];
      out.textContent = out.dataset.out === 'sensitivity' ? `${value.toFixed(1)}x` : `${Math.round(value * 100)}%`;
    }
  }

  function setSetting(key, value) {
    if (settings[key] === value) return;
    settings = { ...settings, [key]: value };
    saveSettings(settings);
    syncSettings();
    handlers.onSettings?.({ ...settings });
  }

  menuEl.addEventListener('click', (e) => {
    const seg = e.target.closest('.seg');
    if (seg) {
      const raw = seg.dataset.value;
      setSetting(seg.dataset.set, raw === 'true' ? true : raw === 'false' ? false : Number(raw));
      handlers.onSound?.('menu_select');
      return;
    }
    const btn = e.target.closest('[data-act]');
    if (!btn) return;
    handlers.onSound?.('menu_select');
    actions[btn.dataset.act](btn.dataset.arg);
  });

  menuEl.addEventListener('input', (e) => {
    if (e.target.type === 'range') setSetting(e.target.dataset.set, Number(e.target.value));
  });

  // Releasing the effects slider plays a sample at the new volume.
  menuEl.addEventListener('change', (e) => {
    if (e.target.dataset.set === 'sfx') handlers.onSound?.('menu_select');
  });

  // Keyboard: arrows move between controls, Escape goes back. Handled keys stop here so
  // the game input does not also see them while a menu is open.
  window.addEventListener('keydown', (e) => {
    if (current === null) return;
    const vertical = e.key === 'ArrowDown' ? 1 : e.key === 'ArrowUp' ? -1 : 0;
    const onRange = document.activeElement?.type === 'range';
    const horizontal = onRange ? 0 : e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
    if (vertical || horizontal) {
      const items = [...menuEl.querySelectorAll('button, input')];
      if (items.length === 0) return;
      const at = items.indexOf(document.activeElement);
      const to = at < 0 ? 0 : (at + vertical + horizontal + items.length) % items.length;
      items[to].focus();
      handlers.onSound?.('menu_move');
    } else if (e.key === 'Escape') {
      back();
    } else {
      return;
    }
    e.preventDefault();
    e.stopImmediatePropagation();
  }, true);

  return {
    show,
    hide,
    get current() { return current; },
  };
}
