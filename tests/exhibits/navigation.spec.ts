import { test, expect } from '@playwright/test';

test('展示一覧・直接URL・旧URL・404', async ({ page, request }) => {
  await page.goto('/ja/hakoniwa/');
  await expect(page.locator('.exhibit-card')).toHaveCount(5);
  await expect(page.locator('iframe')).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  const images = page.locator('.exhibit-card img');
  for (const img of await images.all()) {
    await img.scrollIntoViewIfNeeded();
    await expect.poll(() => img.evaluate((el: HTMLImageElement) => el.complete && el.naturalWidth > 0)).toBe(true);
  }
  const old = await request.get('/ja/hakoniwa/ocean-diorama/index.html');
  expect(await old.text()).toContain('/ja/hakoniwa/sand-pedestal');
  const unknown = await request.get('/ja/hakoniwa/unknown');
  expect(unknown.status()).toBe(404);
  const license = await request.get('/ja/hakoniwa/exhibits/licenses/THREE-LICENSE.txt');
  expect(license.ok()).toBe(true);
  await page.evaluate(() => scrollTo(0, 0));
  await page.screenshot({ path: `${process.env.EVIDENCE_DIR || 'test-results/evidence'}/collection-${test.info().project.name}.png`, fullPage: true });
});
