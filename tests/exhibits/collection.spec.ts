import { test, expect } from '@playwright/test';
import { mkdirSync } from 'node:fs';
const evidence = process.env.EVIDENCE_DIR || 'test-results/evidence';
mkdirSync(evidence, { recursive: true });
const slugs = ['sand-pedestal', 'nyc-diorama', 'library-diorama', 'dino-diorama', 'electric-town-diorama'];

for (const slug of slugs) {
  test(`${slug}: 描画・操作・切替時の解放`, async ({ page }, testInfo) => {
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
    await page.goto(`/hakoniwa/${slug}?quality=low&inspect=1`);
    const iframe = page.locator('iframe');
    const frame = page.frameLocator('iframe');
    const canvas = frame.locator('#scene');
    await expect(canvas).toHaveAttribute('data-ready', 'true', { timeout: 180000 });
    await expect(page.locator('.loading-note')).toHaveCount(0);
    await expect(page.locator('iframe')).toHaveCount(1);
    const scene = page.frames().find(frame => frame.url().includes('/exhibits/'))!;
    const initial = await scene.evaluate(() => (window as any).__scene.view.get());
    await canvas.focus();
    await canvas.press('ArrowRight');
    await expect.poll(() => scene.evaluate(() => (window as any).__scene.view.get().azimuth)).not.toBe(initial.azimuth);
    await canvas.press('0');
    await expect.poll(() => scene.evaluate(azimuth => Math.abs((window as any).__scene.view.get().azimuth - azimuth), initial.azimuth)).toBeLessThan(.05);
    const box = (await iframe.boundingBox())!;
    if (testInfo.project.name === 'desktop') {
      await page.mouse.move(box.x + box.width * .5, box.y + box.height * .5);
      await page.mouse.down();
      await page.mouse.move(box.x + box.width * .65, box.y + box.height * .55, { steps: 4 });
      await page.mouse.up();
    } else {
      const cdp = await page.context().newCDPSession(page);
      const x = box.x + box.width * .5, y = box.y + box.height * .5;
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
      for (let i = 1; i <= 8; i++) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x + i * 10, y: y + i * 3 }] });
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      await cdp.detach();
    }
    await expect.poll(() => scene.evaluate(azimuth => Math.abs((window as any).__scene.view.get().azimuth - azimuth), initial.azimuth)).toBeGreaterThan(1);
    await scene.evaluate(() => { (window as any).__scene.view.reset({ animate: false }); document.querySelector('canvas')?.blur(); });
    await page.mouse.move(1, 1);
    await page.waitForTimeout(1000);
    // 完成画面と各作品のホーム構図を記録する。
    await page.screenshot({ path: `${evidence}/${testInfo.project.name}-${slug}.png`, fullPage: true });
    if (testInfo.project.name === 'desktop') {
      mkdirSync(`${evidence}/thumbnails`, { recursive: true });
      await page.locator('.scene-stage').evaluate(el => { (el as HTMLElement).style.width = '900px'; (el as HTMLElement).style.height = '650px'; });
      await page.waitForTimeout(1000);
      await canvas.screenshot({ path: `${evidence}/thumbnails/${slug}.png` });
    }
    await scene.evaluate(() => {
      const dispose = (window as any).__disposeScene;
      (window as any).__disposeScene = () => {
        dispose();
        (parent as any).__cleanupEvidence = { disposed: document.querySelector('canvas')?.dataset.disposed, lost: (window as any).__scene.renderer.getContext().isContextLost() };
      };
    });
    await page.locator('.back-link').click();
    await expect(page).toHaveURL('/');
    await expect(page.locator('iframe')).toHaveCount(0);
    expect(await page.evaluate(() => (window as any).__cleanupEvidence)).toEqual({ disposed: 'true', lost: true });
    // ホーム画像は検証後にこの実描画から生成するので、初回の404は除く。
    expect(errors.filter(message => !message.includes('404'))).toEqual([]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  });
}
