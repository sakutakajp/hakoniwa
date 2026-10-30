import { test, expect } from '@playwright/test';

test('WebGL非対応時にも説明と作品選択を残す', async ({ page }) => {
  await page.addInitScript(() => {
    const original = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement, kind: string, ...args: any[]) {
      if (kind === 'webgl2' || kind === 'webgl' || kind === 'experimental-webgl') return null;
      return (original as any).call(this, kind, ...args);
    } as typeof original;
  });
  await page.goto('/ja/hakoniwa/library-diorama');
  await expect(page.frameLocator('iframe').locator('#scene-message')).toBeVisible();
  await expect(page.locator('.loading-note')).toHaveCount(0);
  await expect(page.locator('.viewer-panel nav a')).toHaveCount(5);
  await page.getByRole('link', { name: '展示室にもどる', exact: true }).click();
  await expect(page.locator('.exhibit-card')).toHaveCount(5);
});
