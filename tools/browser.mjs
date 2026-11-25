// Headless system Google Chrome via playwright-core, with WebGL working (ANGLE on Metal).
//
//   const browser = await launchBrowser()            // { headless: false } to watch
//   const page = await iphonePage(browser)           // 844 x 390 landscape, DPR 3, touch, mobile Safari UA
//   const page = await iphonePage(browser, { landscape: false })   // 390 x 844
//   const page = await desktopPage(browser, { width: 1280, height: 720 })
//   page.errors                                      // string[]: console errors, page errors, failed requests
//   const errors = watchErrors(anyPage)              // same collector for a page you made yourself
//   await screenshot(page, 'out/shot.png')           // CSS-pixel scale (844 x 390), creates directories
//   await screenshot(page, 'out/gl.png', { selector: '#gl' })
//   const t = await touchDriver(page)                // multi-touch: t.start(id, x, y), t.move(id, x, y),
//                                                    // t.end(id), t.tap(x, y), t.drag(id, x0, y0, x1, y1, steps)
//   await browser.close()
//
// Set SLAG_GL=swiftshader to force the software rasteriser if the GPU path ever misbehaves.
// Audio output is muted. The autoplay policy is left at the default, so an AudioContext still
// needs a user gesture (touchDriver taps and page.mouse clicks count as gestures).

import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright-core';

const IPHONE_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 '
  + '(KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';

export function launchBrowser({ headless = true } = {}) {
  const gl = process.env.SLAG_GL === 'swiftshader'
    ? ['--use-angle=swiftshader', '--enable-unsafe-swiftshader']
    : ['--use-angle=metal'];
  return chromium.launch({
    channel: 'chrome',
    headless,
    args: [...gl, '--ignore-gpu-blocklist', '--mute-audio'],
  });
}

export function watchErrors(page) {
  const errors = [];
  const skip = (url) => url.endsWith('/favicon.ico');
  page.on('console', (msg) => {
    if (msg.type() !== 'error') return;
    if (skip(msg.location().url || '')) return;
    errors.push(`console: ${msg.text()}`);
  });
  page.on('pageerror', (err) => errors.push(`pageerror: ${err.stack || err.message}`));
  page.on('requestfailed', (req) => {
    if (!skip(req.url())) errors.push(`requestfailed: ${req.url()} ${req.failure()?.errorText || ''}`);
  });
  page.on('response', (res) => {
    if (res.status() >= 400 && !skip(res.url())) errors.push(`http ${res.status()}: ${res.url()}`);
  });
  return errors;
}

async function newPage(browser, contextOptions) {
  const context = await browser.newContext(contextOptions);
  const page = await context.newPage();
  page.errors = watchErrors(page);
  return page;
}

export function iphonePage(browser, { landscape = true } = {}) {
  const viewport = landscape ? { width: 844, height: 390 } : { width: 390, height: 844 };
  return newPage(browser, {
    viewport,
    screen: viewport,
    deviceScaleFactor: 3,
    hasTouch: true,
    isMobile: true,
    userAgent: IPHONE_UA,
  });
}

export function desktopPage(browser, { width = 1280, height = 720 } = {}) {
  return newPage(browser, { viewport: { width, height }, deviceScaleFactor: 1 });
}

export async function screenshot(page, file, { selector = null, fullScale = false } = {}) {
  fs.mkdirSync(path.dirname(path.resolve(file)), { recursive: true });
  const opts = { path: file, scale: fullScale ? 'device' : 'css' };
  if (selector) await page.locator(selector).screenshot(opts);
  else await page.screenshot(opts);
  return file;
}

// Raw multi-touch through the DevTools protocol. Ids are any integers you choose; coordinates are
// CSS pixels in the viewport. Events arrive in the page as trusted touchstart/touchmove/touchend.
export async function touchDriver(page) {
  const cdp = await page.context().newCDPSession(page);
  const points = new Map();
  const send = (type, touchPoints = [...points.values()]) => cdp.send('Input.dispatchTouchEvent', {
    type,
    touchPoints,
  });
  const driver = {
    async start(id, x, y) {
      points.set(id, { id, x, y });
      await send('touchStart');
    },
    async move(id, x, y) {
      points.set(id, { id, x, y });
      await send('touchMove');
    },
    async end(id) {
      const p = points.get(id);
      if (!p) return;
      points.delete(id);
      // Chrome releases exactly the points listed in a touchEnd; the others stay down.
      await send('touchEnd', [p]);
    },
    async tap(x, y, id = 99) {
      await driver.start(id, x, y);
      await driver.end(id);
    },
    async drag(id, x0, y0, x1, y1, steps = 8) {
      await driver.start(id, x0, y0);
      for (let i = 1; i <= steps; i++) {
        await driver.move(id, x0 + ((x1 - x0) * i) / steps, y0 + ((y1 - y0) * i) / steps);
      }
    },
  };
  return driver;
}
