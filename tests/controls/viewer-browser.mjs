// Local production build only: BASE_URL=http://127.0.0.1:3147 node tests/controls/viewer-browser.mjs
import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
const base = process.env.BASE_URL || 'http://127.0.0.1:3147';
assert.match(base, /^http:\/\/(127\.0\.0\.1|localhost):\d+$/);
const output = process.env.ARTIFACT_DIR || '/tmp/hakoniwa-redesign';
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium', args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const results = [];
try {
  for (const viewport of [{ width:1440,height:1000 }, { width:390,height:844 }, { width:320,height:568 }]) {
    const page = await browser.newPage({ viewport, reducedMotion:'reduce' });
    page.setDefaultTimeout(60000);
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    const sceneRequests = [];
    page.on('request', request => { if (request.url().includes('/exhibits/')) sceneRequests.push(request.url()); });
    await page.goto(`${base}/ja/hakoniwa/`);
    await page.locator('.exhibit-card').first().waitFor();
    assert.equal(await page.locator('.exhibit-card').count(), 6);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    assert.equal(sceneRequests.length, 0);
    await page.screenshot({ path:`${output}/collection-${viewport.width}.png` });
    // Deterministic initialization failure, followed by a fresh real scene.
    const pattern = '**/exhibits/electric-town-diorama/index.html*';
    await page.route(pattern, route => route.fulfill({ contentType:'text/html', body:'<canvas id="scene"></canvas><p id="scene-message">3D unavailable</p>' }));
    await page.goto(`${base}/ja/hakoniwa/electric-town-diorama?quality=low&inspect=1`);
    await page.getByRole('button', { name:'もう一度試す', exact:true }).waitFor();
    assert.equal(await page.locator('.scene-poster').isVisible(), true);
    assert.equal(await page.getByRole('button', { name:'左へ回転', exact:true }).isDisabled(), true);
    await page.screenshot({ path:`${output}/failure-${viewport.width}.png` });
    if (viewport.width === 320) {
      await page.locator('.scene-actions').getByRole('link', { name:'展示室にもどる' }).click();
      await page.locator('.exhibit-card').first().waitFor();
      results.push({ viewport, failureBack:true, errors });
      await page.close(); continue;
    }
    await page.unroute(pattern);
    await page.getByRole('button', { name:'もう一度試す', exact:true }).click();
    await page.getByRole('button', { name:'右へ回転', exact:true }).waitFor();
    await page.waitForFunction(() => !document.querySelector('.camera-controls button')?.disabled, null, { timeout:180000 });
    await page.screenshot({ path:`${output}/ready-${viewport.width}.png` });
    console.log('ready', viewport.width, await page.locator('.camera-controls').boundingBox());
    const scene = page.frames().find(frame => frame.url().includes('/exhibits/'));
    const view = () => scene.evaluate(() => window.__scene.view.get());
    const before = await view();
    await page.getByRole('button', { name:'右へ回転', exact:true }).click();
    await page.waitForTimeout(150);
    const rotated = await view(); assert.equal(rotated.azimuth, before.azimuth - 15);
    await page.getByRole('button', { name:'拡大', exact:true }).click();
    await page.waitForTimeout(150); assert.ok((await view()).zoom > before.zoom);
    await page.getByRole('button', { name:'元の向き', exact:true }).click();
    await page.waitForTimeout(150); assert.equal((await view()).azimuth, before.azimuth);
    assert.equal(await page.getByRole('button', { name:'動きを抑える' }).getAttribute('aria-pressed'), 'true');
    await page.emulateMedia({ reducedMotion:'no-preference' });
    await page.waitForFunction(() => document.querySelector('[aria-pressed]')?.getAttribute('aria-pressed') === 'false');
    await page.getByRole('button', { name:'動きを抑える' }).click();
    assert.equal(await page.getByRole('button', { name:'動きを抑える' }).getAttribute('aria-pressed'), 'true');
    await page.screenshot({ path:`${output}/viewer-${viewport.width}.png` });
    // Save old API before exit; lifecycle must remove it and make retained references inert.
    await scene.evaluate(() => { window.__oldPublicApi = window.__hakoniwaControls; });
    await page.getByRole('link', { name:'展示室にもどる', exact:true }).click();
    await page.locator('.exhibit-card').first().waitFor();
    assert.equal(await page.locator('iframe').count(), 0);
    assert.deepEqual(errors, []);
    results.push({ viewport, realRetry:true, before, rotated, motionPreference:true, back:true, errors });
    await page.close();
  }
} finally {
  await writeFile(`${output}/results.json`, JSON.stringify(results,null,2));
  await browser.close();
}
console.log(JSON.stringify(results,null,2));
