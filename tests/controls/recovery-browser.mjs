import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
const base = process.env.BASE_URL || 'http://127.0.0.1:3149';
assert.match(base, /^http:\/\/(127\.0\.0\.1|localhost):\d+$/);
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium', args:['--no-sandbox'] });
try {
  const page = await browser.newPage();
  await page.addInitScript(() => { window.__sceneDisposals = 0; });
  const requested = [];
  await page.route('**/exhibits/electric-town-diorama/index.html*', route => {
    requested.push(route.request().url());
    const low = new URL(route.request().url()).searchParams.get('quality') === 'low';
    return route.fulfill({ contentType:'text/html', body:`<canvas id="scene"></canvas>${low ? '' : '<p id="scene-message">WebGL unavailable</p>'}<script>window.__disposeScene=()=>parent.__sceneDisposals++;<\/script>` });
  });
  await page.goto(`${base}/ja/hakoniwa/electric-town-diorama`);
  await page.getByText('3D表示を開始できませんでした。静止画でも作品をご覧いただけます。', { exact:true }).waitFor();
  await page.getByRole('link', { name:'軽量表示で開く' }).click();
  await page.waitForFunction(() => document.querySelector('iframe')?.src.includes('quality=low'));
  await page.getByText('小さな世界を準備しています。静止画を眺めながらお待ちください。', { exact:true }).waitFor();
  assert.ok(requested.some(url => url.includes('quality=low')));
  assert.ok(await page.evaluate(() => window.__sceneDisposals > 0));
  assert.equal(await page.locator('.scene-surface').getAttribute('aria-busy'), 'true');
  assert.equal(await page.getByRole('button', { name:'左へ回転', exact:true }).isDisabled(), true);
  // Advance the clock used by readiness timeout; RAF and real timers stay unchanged.
  await page.evaluate(() => { const original = Date.now; Date.now = () => original() + 46000; });
  await page.getByText('準備に時間がかかっています。このまま待つか、読み込みをやり直せます。', { exact:true }).waitFor();
  assert.equal(await page.locator('.scene-surface').getAttribute('aria-busy'), 'true');
  const scene = page.frames().find(frame => frame.url().includes('/exhibits/'));
  await scene.evaluate(() => {
    document.querySelector('#scene').dataset.ready = 'true';
    window.__hakoniwaControls = { rotate(){},zoom(){},reset(){},setPaused(){},paused:false };
  });
  await page.waitForFunction(() => !document.querySelector('.camera-controls button').disabled);
  assert.equal(await page.locator('.scene-surface').getAttribute('aria-busy'), 'false');
  await scene.evaluate(() => { document.querySelector('#scene').dataset.unavailable = 'true'; });
  await page.getByText('3D表示を開始できませんでした。静止画でも作品をご覧いただけます。', { exact:true }).waitFor();
  console.log('PASS: samepath quality navigation disposes old scene, changes iframe source, resets readiness; slow timeout remains recoverable and differs from explicit failure.');
} finally { await browser.close(); }
