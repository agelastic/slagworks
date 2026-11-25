// Screenshots of level 1 from fixed viewpoints, rendered with the real renderer and assets.
//   node tools/test-level-1.mjs [outDir]
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startServer } from './serve.mjs';
import { launchBrowser, desktopPage, screenshot } from './browser.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.resolve(process.argv[2] || path.join(root, 'out/level-1'));
const D = Math.PI / 180;
const VIEWS = [
  ['start', 2.5, 13.9, 0],
  ['bay-north', 10.5, 17.5, -90 * D],
  ['office', 10.5, 6.5, -90 * D],
  ['hub-entry', 19.5, 14, 0],
  ['hub-amber', 25.9, 17, -90 * D],
  ['hub-ledge', 27, 12, -40 * D],
  ['service', 33.9, 11.5, 90 * D],
  ['freight', 33.5, 20.5, 145 * D],
  ['storage', 17.5, 22.9, 160 * D],
  ['gallery', 13.5, 27.5, 180 * D],
  ['exit', 25.9, 6.5, -90 * D],
];

const server = await startServer(root, 0);
const browser = await launchBrowser();
try {
  const page = await desktopPage(browser, { width: 960, height: 540 });
  await page.goto(`${server.url}tools/test-level-1.html`);
  await page.waitForFunction(() => window.T && (window.T.ready || window.T.error), null, { timeout: 60000 })
    .catch((e) => { throw new Error(`${e.message}\n${page.errors.join('\n')}`); });
  const err = await page.evaluate(() => window.T.error);
  if (err) throw new Error(err);
  for (const [name, x, y, yaw] of VIEWS) {
    await page.evaluate(([x, y, yaw]) => window.T.view(x, y, yaw), [x, y, yaw]);
    await screenshot(page, path.join(out, `view-${name}.png`), { selector: '#gl' });
  }
  if (page.errors.length) console.log('page errors:', page.errors);
  console.log(`views in ${out}`);
} finally {
  await browser.close();
  server.close();
}
