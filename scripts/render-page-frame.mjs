import { chromium } from 'playwright-core';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { existsSync } from 'node:fs';

/**
 * 本地抽帧：用无头 Chromium 打开一个影片页，调到指定秒数截图。
 *
 * 为什么要有它：Studio 的渲染器只在面板里跑，做模板开发时不可能每次都去点。
 * 这个脚本复刻同一条契约（window.film.frame / window.renderAt），用来在提交前
 * 亲眼确认"这一秒到底画成什么样"。
 *
 *   node scripts/render-page-frame.mjs <page.html> <seconds> <out.png> [width] [height]
 */

const [pageArg, secondsArg, outArg, widthArg, heightArg] = process.argv.slice(2);
if (!pageArg || !secondsArg || !outArg) {
  console.error('usage: node scripts/render-page-frame.mjs <page.html> <seconds> <out.png> [w] [h]');
  process.exit(2);
}
const pagePath = resolve(pageArg);
if (!existsSync(pagePath)) { console.error('no such page: ' + pagePath); process.exit(2); }
const seconds = Number(secondsArg);
const width = Number(widthArg) || 1920;
const height = Number(heightArg) || 1080;
const out = resolve(outArg);

let browser;
try {
  browser = await chromium.launch({ headless: true });
} catch (error) {
  // 没有下载 Playwright 自带 Chromium 的机器上用系统 Edge/Chrome。
  const candidates = [
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
  ];
  const executablePath = candidates.find((file) => existsSync(file));
  if (!executablePath) throw error;
  browser = await chromium.launch({ headless: true, executablePath });
}

const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1 });
const errors = [];
page.on('pageerror', (error) => errors.push(String(error)));
page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
await page.goto(pathToFileURL(pagePath).href, { waitUntil: 'load' });
// 影片页的契约：先 ready，再给时刻。样例页用 __ready，模板页用 film.ready。
try {
  await page.waitForFunction(() => window.__ready === true || (window.film && window.film.ready), null, { timeout: 20000 });
} catch (error) {
  const state = await page.evaluate(() => ({
    hasRenderAt: typeof window.renderAt === 'function',
    hasFilm: Boolean(window.film),
    ready: window.__ready === true,
  }));
  console.error(JSON.stringify({ stage: 'ready-timeout', state, errors }, null, 1));
  await browser.close();
  process.exit(1);
}
if (await page.evaluate(() => Boolean(window.film && window.film.ready))) {
  await page.evaluate(() => window.film.ready);
}
await page.evaluate(async (t) => {
  if (window.film && typeof window.film.frame === 'function') return window.film.frame(t);
  if (typeof window.renderAt === 'function') return window.renderAt(t);
  throw new Error('page exposes neither film.frame nor renderAt');
}, seconds);
await page.evaluate(() => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))));
await page.screenshot({ path: out });
await browser.close();
console.log(JSON.stringify({ page: pagePath, seconds, out, errors }, null, 1));
if (errors.length) process.exitCode = 1;
