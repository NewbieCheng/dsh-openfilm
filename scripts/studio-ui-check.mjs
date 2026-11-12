import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { chromium } from 'playwright-core';
import { existsSync } from 'node:fs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const temp = mkdtempSync(join(tmpdir(), 'openfilm-ui-'));
process.env.OPENFILM_HOME = join(temp, 'home');
process.env.OPENFILM_SHARED_HOME = join(temp, 'home');
let studio;
let browser;
try {
  const { startStudio } = await import('openfilm/studio');
  studio = await startStudio({ port: 0, advertise: false, stays: true, openBrowser: () => {} });
  const { installTemplate } = await import('../src/official-templates.mjs');
  const { openProject } = await import(pathToFileURL(join(root, 'node_modules', 'openfilm', 'studio', 'server', 'projects.mjs')).href);
  const installed = await installTemplate({
    root: join(root, 'vendor', 'templates'), id: 'motion-styles', parentDir: join(temp, 'library'),
    createProject: async (path) => { const p = await openProject(path); return { id: p.id, path: p.path }; },
    titleFor: () => '动效风格样片',
  });
  const origin = 'http://127.0.0.1:' + studio.port;
  const candidates = ['C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', 'C:/Program Files/Google/Chrome/Application/chrome.exe'];
  const executablePath = candidates.find((f) => existsSync(f));
  browser = await chromium.launch({ headless: true, ...(executablePath ? { executablePath } : {}) });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e).slice(0, 160)));
  await page.goto(origin + '/projects/' + installed.projectId + '?key=' + studio.key, { waitUntil: 'load', timeout: 30000 });
  await page.waitForTimeout(5000);
  const body = (await page.locator('body').innerText().catch(() => '')).slice(0, 600);
  await page.screenshot({ path: join(root, '.tmp-frames', 'studio-ui-motion.png') });
  // 打开 Studio 自己的"重新选片型"弹窗，确认真实界面里能看到新模板。
  let dialogText = '';
  const picker = page.getByText('重新选片型', { exact: false }).first();
  if (await picker.count()) {
    await picker.click({ timeout: 5000 }).catch(() => {});
    await page.waitForTimeout(1500);
    dialogText = (await page.locator('body').innerText().catch(() => '')).slice(-1200);
    await page.screenshot({ path: join(root, '.tmp-frames', 'studio-ui-picker.png') });
  }
  console.log(JSON.stringify({ projectId: installed.projectId, url: page.url().replace(/key=[^&]+/, 'key=***'), errors, body, dialogHasTemplate: /动效风格样片/.test(dialogText), dialogText: dialogText.slice(0, 700) }, null, 1));
} finally {
  if (browser) await browser.close().catch(() => {});
  if (studio) await studio.close().catch(() => {});
  rmSync(temp, { recursive: true, force: true });
}
