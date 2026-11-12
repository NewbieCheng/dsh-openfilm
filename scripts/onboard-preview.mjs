import { chromium } from 'playwright-core';
import { existsSync } from 'node:fs';

/**
 * 首次启动向导的可重复预览：在真实 shell 页面里打桩 RPC（账号/环境/模板），
 * 截出第 1 步与第 2 步。它不是 GUI 验收的替代品，只用于改动 UI 时快速看效果。
 *
 *   node scripts/onboard-preview.mjs
 */
const { origin, ticket } = await (await fetch('http://127.0.0.1:47821/api/studio-url')).json();
const exe = ['C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', 'C:/Program Files/Google/Chrome/Application/chrome.exe'].find((f) => existsSync(f));
const browser = await chromium.launch({ headless: true, ...(exe ? { executablePath: exe } : {}) });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
let envCalls = 0;
const templates = [
  { id: 'paper-texture', title: '纸纹讲堂', productTitle: '口播讲堂', productBlurb: '竖屏讲解、口播感' },
  { id: 'replica-film', title: '复刻影片', productTitle: '知识大赏', productBlurb: '分镜知识片、卡片与场景感' },
  { id: 'sketchnote', title: '手绘笔记', productTitle: '手绘笔记', productBlurb: '纸笔笔记风短片' },
  { id: 'motion-styles', title: '动效风格样片', productTitle: '动效风格样片', productBlurb: '弹簧/错峰/相机推镜的整片样片' },
  { id: 'custom', title: '自定义', productTitle: '自定义', productBlurb: '空白开始，先丢素材再定风格' },
];
await page.route('**/__dsh/official-rpc', async (route) => {
  const body = JSON.parse(route.request().postData() || '{}');
  const channel = body.channel;
  let reply = { ok: true };
  if (channel === 'auth:status') reply = { loggedIn: true, dev: true, account: 'dev@local', displayName: '开发模式' };
  if (channel === 'prefs:get') reply = { prefs: { onboardingCompleted: false, defaultTemplateId: '', lastProjectId: '', customLanguage: '中文' } };
  if (channel === 'system:check') {
    envCalls += 1;
    const ok = envCalls > 2;
    reply = {
      platform: 'win32',
      tools: { ffmpeg: { status: ok ? 'ok' : 'missing' }, ffprobe: { status: 'ok' } },
      installer: { tools: { ffmpeg: { ready: ok, installing: !ok, received: ok ? 0 : 32000000, total: 83000000, error: '' }, ffprobe: { ready: true } } },
      asr: { ready: true, installing: false, progress: 1, bytesOnDisk: 239000000, bytesTotal: 239000000 },
      ready: ok,
    };
  }
  if (channel === 'environment:check') {
    reply = { platform: 'win32', tools: { ffmpeg: { status: 'missing' }, ffprobe: { status: 'ok' } } };
  }
  if (channel === 'template:list') reply = { templates, prefs: { onboardingCompleted: false } };
  await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(reply) });
});
await page.route('**/api/no996-openfilm/asr', async (route) => {
  const body = JSON.parse(route.request().postData() || '{}');
  await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body.action === 'install'
    ? { ready: false, installing: true, progress: 0.32, bytesOnDisk: 76000000, bytesTotal: 239000000 }
    : { ready: true, installing: false, progress: 1, bytesOnDisk: 239000000, bytesTotal: 239000000 }) });
});
await page.goto(origin + '/__dsh/open#' + ticket, { waitUntil: 'load', timeout: 30000 });
await page.waitForTimeout(3200);
await page.evaluate(() => { const gate = document.querySelector('.nof-lg'); if (gate) gate.style.visibility = 'hidden'; });
await page.waitForTimeout(300);
await page.screenshot({ path: '.tmp-frames/onboard-step1.png' });
const clickWizard = (pattern) => page.evaluate((source) => {
  const overlay = [...document.querySelectorAll('div')].find(node => node.style && node.style.zIndex === '2147482400');
  const matcher = new RegExp(source);
  const button = [...(overlay ? overlay.querySelectorAll('button') : [])].find(node => matcher.test(node.textContent || ''));
  if (!button) return 'none';
  button.click();
  return button.textContent;
}, pattern.source);
console.log('primary:', await clickWizard(/选片型|等装完再继续/));
await page.waitForTimeout(700);
await page.screenshot({ path: '.tmp-frames/onboard-step2.png' });
let text = await page.evaluate(() => (document.documentElement.innerText.match(/你想剪哪种视频？[\s\S]{0,600}/) || [''])[0]);
console.log(JSON.stringify({ step2HasMotion: /动效风格样片/.test(text), step2HasCustom: /自定义/.test(text) }));
// 自定义：画布与时长两个可选项
console.log('custom:', await clickWizard(/^自定义/));
await page.waitForTimeout(400);
await page.screenshot({ path: '.tmp-frames/onboard-step2-custom.png' });
text = await page.evaluate(() => document.documentElement.innerText);
console.log(JSON.stringify({ customHasRatio: /画布/.test(text) && /9:16/.test(text), customHasSeconds: /时长/.test(text) && /60/.test(text) }));
await browser.close();
