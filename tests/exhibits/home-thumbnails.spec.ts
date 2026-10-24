import { test, expect } from '@playwright/test';
import { mkdirSync } from 'node:fs';

const evidence = process.env.EVIDENCE_DIR || 'test-results/home-thumbnails-page';
mkdirSync(evidence, { recursive: true });
test.use({ baseURL: process.env.PREVIEW_URL || 'http://127.0.0.1:3000' });

test('トップの5作品は同じ表示枠で画像を切り取らずに表示する', async ({ page }, info) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/');
  const cards = page.locator('.exhibit-card');
  await expect(cards).toHaveCount(5);
  const sizes = [];
  for (const card of await cards.all()) {
    const image = card.locator('img');
    await image.scrollIntoViewIfNeeded();
    await expect.poll(() => image.evaluate(el => (el as HTMLImageElement).complete && (el as HTMLImageElement).naturalWidth > 0)).toBe(true);
    const dimensions = await image.evaluate(el => {
      const img = el as HTMLImageElement, r = img.getBoundingClientRect();
      return { width: r.width, height: r.height, naturalWidth: img.naturalWidth, naturalHeight: img.naturalHeight };
    });
    expect(dimensions.naturalWidth).toBe(900);
    expect(dimensions.naturalHeight).toBe(650);
    expect(dimensions.width / dimensions.height).toBeCloseTo(900 / 650, 2);
    sizes.push(dimensions.width);
    await expect(card).toHaveAttribute('href', /^\/hakoniwa\//);
  }
  expect(Math.max(...sizes) - Math.min(...sizes)).toBeLessThan(1);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await expect(page.locator('canvas, iframe')).toHaveCount(0);
  expect(errors).toEqual([]);
  await page.mouse.move(0, 0);
  await page.evaluate(() => scrollTo(0, 0));
  await page.screenshot({ path: `${evidence}/${info.project.name}-home.png`, fullPage: true });
});
