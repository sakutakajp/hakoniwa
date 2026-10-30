import { test, expect } from '@playwright/test';

test('図書館の拡大・リセット・別作品への切替', async ({ page }, testInfo) => {
  await page.goto('/ja/hakoniwa/library-diorama?quality=low&inspect=1');
  const frame = page.frameLocator('iframe');
  await expect(frame.locator('#scene')).toHaveAttribute('data-ready', 'true', { timeout: 180000 });
  const scene = page.frames().find(frame => frame.url().includes('/ja/hakoniwa/exhibits/'))!;
  const box = (await page.locator('iframe').boundingBox())!;
  const x = box.x + box.width / 2, y = box.y + box.height / 2;
  if (testInfo.project.name === 'mobile') {
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: x - 35, y, id: 1 }, { x: x + 35, y, id: 2 }] });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x - 65, y, id: 1 }, { x: x + 65, y, id: 2 }] });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await cdp.detach();
  } else {
    await page.mouse.move(x, y);
    await page.mouse.wheel(0, -300);
  }
  await expect.poll(() => scene.evaluate(() => (window as any).__scene.view.get().zoom)).toBeGreaterThan(1.1);
  await frame.locator('canvas').press('0');
  await expect.poll(() => scene.evaluate(() => (window as any).__scene.view.get().zoom)).toBe(1);
  // 操作後の解像度が元に戻った完成画面を保存する。
  await expect.poll(() => scene.evaluate(() => { const c = document.querySelector('canvas')!; return c.width / c.clientWidth; })).toBeGreaterThan(.99);
  await scene.evaluate(() => document.querySelector('canvas')?.blur());
  await page.screenshot({ path: `${process.env.EVIDENCE_DIR || 'test-results/evidence'}/final-library-${testInfo.project.name}.png`, fullPage: true });
  await scene.evaluate(() => {
    const dispose = (window as any).__disposeScene;
    (window as any).__disposeScene = () => { dispose(); (parent as any).__switchDisposed = (window as any).__scene.renderer.getContext().isContextLost(); };
  });
  await page.getByText('操作・箱庭', { exact: true }).click();
  await page.locator('.viewer-panel nav a[href="/ja/hakoniwa/nyc-diorama"]').click();
  await expect(page).toHaveURL('/ja/hakoniwa/nyc-diorama');
  expect(await page.evaluate(() => (window as any).__switchDisposed)).toBe(true);
  await expect(page.locator('iframe')).toHaveCount(1);
  await expect(page.locator('.viewer-panel nav [aria-current="page"]')).toContainText('ニューヨーク');
});
