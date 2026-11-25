// UI check: screenshots of every menu screen and HUD state on three viewports, plus layout
// and interaction assertions. Uses tools/test-ui.html with a mock game.
//
//   node tools/test-ui.mjs [outDir] [--real]     --real imports the actual src/game/tuning.js

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startServer } from './serve.mjs';
import { launchBrowser, iphonePage, desktopPage, screenshot, touchDriver } from './browser.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const real = args.includes('--real');
const outDir = args.find((a) => !a.startsWith('--')) || 'out/ui';

const server = await startServer(root, 0);
const browser = await launchBrowser();
const failures = [];
const fail = (msg) => { failures.push(msg); console.log(`  FAIL ${msg}`); };

const VIEWS = [
  { name: 'land', touch: true, open: () => iphonePage(browser, { landscape: true }) },
  { name: 'port', touch: true, open: () => iphonePage(browser, { landscape: false }) },
  { name: 'desk', touch: false, open: () => desktopPage(browser, { width: 1280, height: 800 }) },
];

const MENUS = ['title', 'difficulty', 'settings', 'help', 'pause', 'dead', 'intermission', 'victory', 'loading'];

async function load(page, view) {
  const q = [view.touch ? 'safe' : '', real ? 'real' : ''].filter(Boolean).join('&');
  await page.goto(`${server.url}tools/test-ui.html?${q}`);
  await page.waitForFunction(() => window.uiReady === true);
}

// Layout facts about the menu currently shown.
const menuFacts = () => {
  const menu = document.getElementById('menu');
  const vw = innerWidth, vh = innerHeight;
  const out = { small: [], outside: [], overflow: [], pageScroll: document.scrollingElement.scrollHeight > vh || document.scrollingElement.scrollWidth > vw };
  for (const b of menu.querySelectorAll('button, input')) {
    const r = b.getBoundingClientRect();
    const label = b.textContent.trim().slice(0, 24) || b.dataset.set;
    if (r.height < 47.5) out.small.push(`${label} ${r.height.toFixed(1)}px`);
    if (r.left < 0 || r.top < 0 || r.right > vw + 0.5 || r.bottom > vh + 0.5) out.outside.push(label);
  }
  for (const s of menu.querySelectorAll('.menu-scroll')) {
    if (s.scrollHeight > s.clientHeight + 1) out.overflow.push(`${s.scrollHeight} > ${s.clientHeight}`);
    if (s.scrollWidth > s.clientWidth + 1) out.overflow.push(`x ${s.scrollWidth} > ${s.clientWidth}`);
  }
  return out;
};

// Rects of HUD parts and of the mock touch controls.
const hudFacts = () => {
  const rect = (sel) => {
    const el = document.querySelector(sel);
    const r = el.getBoundingClientRect();
    return { sel, x: r.left, y: r.top, w: r.width, h: r.height };
  };
  const view = document.getElementById('view').getBoundingClientRect();
  return {
    view: { x: view.left, y: view.top, w: view.width, h: view.height },
    parts: ['.hud-vitals', '.hud-arms', '.hud-minimap', '.hud-msgs'].map(rect),
    mocks: ['.mock-pause', '.mock-stick', '.mock-fire', '.mock-use', '.mock-next'].map(rect),
    numPx: [...document.querySelectorAll('.hud-num')].map((n) => parseFloat(getComputedStyle(n).fontSize)),
    lblPx: [...document.querySelectorAll('.hud-lbl, .hud-msg')].map((n) => parseFloat(getComputedStyle(n).fontSize)),
    coarse: matchMedia('(pointer: coarse)').matches,
  };
};

const overlap = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

for (const view of VIEWS) {
  console.log(`[${view.name}]`);
  const page = await view.open();
  await load(page, view);
  const shot = (name) => screenshot(page, path.join(outDir, `${view.name}-${name}.png`));

  // ---- menus
  for (const screen of MENUS) {
    await page.evaluate((s) => { window.ui.clearSave(); window.ui.show(s); }, screen);
    await page.waitForTimeout(750);
    await shot(`menu-${screen}`);
    const f = await page.evaluate(menuFacts);
    if (f.small.length) fail(`${view.name} ${screen}: control under 48px: ${f.small.join(', ')}`);
    if (f.outside.length) fail(`${view.name} ${screen}: control outside viewport: ${f.outside.join(', ')}`);
    if (f.pageScroll) fail(`${view.name} ${screen}: page scrolls`);
    if (f.overflow.length && view.name !== 'port') fail(`${view.name} ${screen}: panel needs scrolling (${f.overflow.join(', ')})`);
    if (f.overflow.length && view.name === 'port') console.log(`  note ${screen}: panel scrolls in portrait (${f.overflow.join(', ')})`);
  }
  await page.evaluate(() => {
    window.ui.saveSave({ levelIndex: 2, difficulty: 1, loadout: {} });
    window.ui.show('title');
  });
  await shot('menu-title-save');
  const f2 = await page.evaluate(menuFacts);
  if (f2.overflow.length) fail(`${view.name} title with save: needs scrolling (${f2.overflow.join(', ')})`);
  await page.evaluate(() => { window.ui.show('pause'); document.querySelector('[data-arg="settings"]').click(); });
  await shot('menu-settings-paused');
  await page.evaluate(() => window.ui.show('loading', { text: 'Casting sprites', progress: 0.62 }));
  await shot('menu-loading-progress');

  // ---- menu behaviour
  const result = await page.evaluate(async () => {
    const { ui } = window;
    const click = (sel) => document.querySelector(`#menu ${sel}`).click();
    const key = (k) => window.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true }));
    const out = {};
    ui.calls.length = 0;
    localStorage.clear();

    ui.show('title');
    out.noContinue = !document.querySelector('[data-act="continue"]');
    click('[data-arg="difficulty"]');
    out.toDifficulty = ui.menus.current;
    key('Escape');
    out.escBack = ui.menus.current;
    click('[data-arg="difficulty"]');
    click('[data-act="newgame"][data-arg="2"]');
    out.afterNew = ui.menus.current;

    ui.show('title');
    click('[data-arg="help"]');
    click('[data-act="back"]');
    out.helpBack = ui.menus.current;

    click('[data-arg="settings"]');
    const range = document.querySelector('[data-set="sensitivity"]');
    range.value = '1.7';
    range.dispatchEvent(new Event('input', { bubbles: true }));
    click('[data-set="quality"][data-value="400"]');
    click('[data-set="leftHanded"][data-value="true"]');
    out.stored = JSON.parse(localStorage.getItem('slagworks.settings'));
    out.loaded = ui.loadSettings();
    out.pressed = document.querySelector('[data-set="quality"][data-value="400"]').getAttribute('aria-pressed');
    out.readout = document.querySelector('[data-out="sensitivity"]').textContent;
    click('[data-act="back"]');
    out.settingsBack = ui.menus.current;

    ui.show('pause');
    click('[data-arg="settings"]');
    out.veil = document.getElementById('menu').className;
    key('Escape');
    out.pauseBack = ui.menus.current;
    key('ArrowDown');
    out.focusAfterDown = document.activeElement.textContent.trim();
    key('Escape');
    out.afterResume = ui.menus.current;
    out.menuHidden = document.getElementById('menu').hidden;

    ui.show('pause');
    click('[data-act="quit"]');
    out.afterQuit = ui.menus.current;
    ui.show('dead');
    click('[data-act="restart"]');
    ui.show('intermission');
    click('[data-act="next"]');
    ui.saveSave({ levelIndex: 1, difficulty: 0, loadout: { a: 1 } });
    ui.show('title');
    click('[data-act="continue"]');
    out.save = ui.loadSave();
    ui.clearSave();
    out.cleared = ui.loadSave();
    out.calls = ui.calls.filter((c) => c[0] !== 'onSound').map((c) => (c[0] === 'onSettings' ? 'onSettings' : c.join(':')));
    out.sounds = ui.calls.filter((c) => c[0] === 'onSound').length;
    out.lastSettings = ui.calls.filter((c) => c[0] === 'onSettings').pop()[1];
    localStorage.clear();
    return out;
  });
  const expect = (name, got, want) => {
    if (JSON.stringify(got) !== JSON.stringify(want)) fail(`${view.name} ${name}: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
  };
  expect('title without save hides Continue', result.noContinue, true);
  expect('New Game opens difficulty', result.toDifficulty, 'difficulty');
  expect('Escape goes back', result.escBack, 'title');
  expect('difficulty pick hides menu', result.afterNew, null);
  expect('help back', result.helpBack, 'title');
  expect('settings stored', result.stored, { sensitivity: 1.7, sfx: 0.8, music: 0.5, quality: 400, leftHanded: true });
  expect('settings loaded', result.loaded, result.stored);
  expect('onSettings payload', result.lastSettings, result.stored);
  expect('segment pressed', result.pressed, 'true');
  expect('readout', result.readout, '1.7x');
  expect('settings back to title', result.settingsBack, 'title');
  expect('settings over pause keeps veil', result.veil, 'veil');
  expect('settings back to pause', result.pauseBack, 'pause');
  expect('arrow moves focus', result.focusAfterDown, 'Restart Level');
  expect('Escape resumes', [result.afterResume, result.menuHidden], [null, true]);
  expect('quit shows title', result.afterQuit, 'title');
  expect('save round trip', result.save, { levelIndex: 1, difficulty: 0, loadout: { a: 1 } });
  expect('clearSave', result.cleared, null);
  expect('handler calls', result.calls, ['onNewGame:2', 'onSettings', 'onSettings', 'onSettings', 'onResume', 'onQuit', 'onRestartLevel', 'onNextLevel', 'onContinue']);
  if (result.sounds < 8) fail(`${view.name}: expected menu sounds, got ${result.sounds}`);

  // A real tap on a menu button and on a slider.
  await page.evaluate(() => { window.ui.calls.length = 0; window.ui.show('pause'); });
  const resume = await page.evaluate(() => {
    const r = document.querySelector('[data-act="resume"]').getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  });
  if (view.touch) await (await touchDriver(page)).tap(resume.x, resume.y);
  else await page.mouse.click(resume.x, resume.y);
  await page.waitForTimeout(120);
  expect('tap on Resume', await page.evaluate(() => [window.ui.menus.current, window.ui.calls.some((c) => c[0] === 'onResume')]), [null, true]);

  // ---- HUD
  await page.evaluate(() => { window.ui.menus.hide(); window.ui.hud.message('Loading Dock: get to the freight lift.'); });
  await page.waitForTimeout(200);
  await shot('hud');
  const h = await page.evaluate(hudFacts);
  if (h.coarse !== view.touch) fail(`${view.name}: pointer:coarse is ${h.coarse}`);
  if (Math.min(...h.numPx) < 20) fail(`${view.name}: HUD number ${Math.min(...h.numPx)}px < 20px`);
  if (Math.min(...h.lblPx) < 10) fail(`${view.name}: HUD label ${Math.min(...h.lblPx)}px < 10px`);
  for (const p of h.parts) {
    if (p.x < h.view.x - 0.5 || p.y < h.view.y - 0.5 || p.x + p.w > h.view.x + h.view.w + 0.5 || p.y + p.h > h.view.y + h.view.h + 0.5) {
      fail(`${view.name}: ${p.sel} leaves the view`);
    }
    for (const m of h.mocks) if (view.touch && overlap(p, m)) fail(`${view.name}: ${p.sel} overlaps ${m.sel}`);
    for (const o of h.parts) if (o !== p && overlap(p, o)) fail(`${view.name}: ${p.sel} overlaps ${o.sel}`);
  }

  // Low health, melee weapon, a hit from the right rear, stacked messages.
  await page.evaluate(() => {
    const { game, hud } = window.ui;
    Object.assign(game.player, { health: 17.3, armor: 0, weapon: 0, keys: { amber: false, cyan: true, magenta: false } });
    hud.message('You need the cyan key.');
    hud.message('A door opened somewhere.');
    hud.damage(24, 2.2);
    hud.damage(10, -0.7);
  });
  await page.waitForTimeout(120);
  await shot('hud-hurt');
  await page.evaluate(() => {
    const { game, hud } = window.ui;
    Object.assign(game.player, { health: 64, armor: 100, weapon: 4, weapons: [true, true, true, true, true], keys: { amber: true, cyan: true, magenta: true } });
    game.player.ammo.canisters = 0;
    hud.pickup();
  });
  await page.waitForTimeout(60);
  await shot('hud-pickup');

  // Tap the minimap: the large map opens although #touch covers the view.
  const mm = h.parts.find((p) => p.sel === '.hud-minimap');
  const tapMap = async () => {
    if (view.touch) await (await touchDriver(page)).tap(mm.x + mm.w / 2, mm.y + mm.h / 2);
    else await page.mouse.click(mm.x + mm.w / 2, mm.y + mm.h / 2);
    await page.waitForTimeout(250);
  };
  await page.evaluate(() => { window.ui.calls.length = 0; });
  await tapMap();
  expect('minimap tap opens map', await page.evaluate(() => [document.getElementById('hud').classList.contains('map-open'), window.ui.calls]), [true, [['onMapToggle', true]]]);
  await shot('hud-map');
  await tapMap();
  expect('second tap closes map', await page.evaluate(() => document.getElementById('hud').classList.contains('map-open')), false);
  expect('toggleMap()', await page.evaluate(() => [window.ui.hud.toggleMap(), window.ui.hud.toggleMap()]), [true, false]);

  // update() leaves the DOM alone when nothing changed.
  const mutations = await page.evaluate(async () => {
    let count = 0;
    const obs = new MutationObserver((list) => { count += list.length; });
    obs.observe(document.getElementById('hud'), { subtree: true, childList: true, attributes: true, characterData: true });
    await new Promise((r) => setTimeout(r, 500));
    obs.disconnect();
    return count;
  });
  if (mutations > 0) fail(`${view.name}: ${mutations} HUD mutations while idle`);

  await page.evaluate(() => window.ui.hud.setVisible(false));
  expect('setVisible(false)', await page.evaluate(() => getComputedStyle(document.getElementById('hud')).display), 'none');

  if (page.errors.length) fail(`${view.name} page errors: ${page.errors.join(' | ')}`);
  await page.context().close();
}

// index.html: the shell must sit still and show the boot splash before main.js exists.
{
  const page = await iphonePage(browser, { landscape: false });
  await page.goto(`${server.url}index.html`);
  await page.waitForTimeout(300);
  await screenshot(page, path.join(outDir, 'index-boot.png'));
  const facts = await page.evaluate(() => {
    window.scrollTo(0, 200);
    const view = document.getElementById('view').getBoundingClientRect();
    return {
      ids: ['app', 'view', 'gl', 'hud', 'touch', 'menu'].filter((id) => !document.getElementById(id)),
      scrollY: window.scrollY,
      scrolls: document.scrollingElement.scrollHeight > innerHeight,
      aspect: view.width / view.height,
      pixelated: getComputedStyle(document.getElementById('gl')).imageRendering,
      touchAction: getComputedStyle(document.body).touchAction,
    };
  });
  if (facts.ids.length) fail(`index.html misses ids: ${facts.ids}`);
  if (facts.scrollY !== 0 || facts.scrolls) fail('index.html scrolls');
  if (Math.abs(facts.aspect - 4 / 3) > 0.02) fail(`portrait view aspect ${facts.aspect}`);
  if (facts.pixelated !== 'pixelated') fail(`canvas image-rendering is ${facts.pixelated}`);
  if (facts.touchAction !== 'none') fail(`body touch-action is ${facts.touchAction}`);
  await page.context().close();
}

await browser.close();
await server.close();
console.log(failures.length ? `\n${failures.length} failure(s)` : `\nui test passed, screenshots in ${outDir}`);
process.exit(failures.length ? 1 : 0);
