import { expect, test, type Page } from '@playwright/test';

const collection = '/ja/hakoniwa/';
const slugs = ['sand-pedestal', 'nyc-diorama', 'library-diorama', 'dino-diorama', 'electric-town-diorama'];
const heavyAsset = /\/ja\/hakoniwa\/exhibits\/|\/(?:three|three\.module)[.-]/i;

async function hostStyles(page: Page) {
  return page.evaluate(() => {
    const css = (selector: string) => getComputedStyle(document.querySelector(selector)!);
    return {
      rootColor: css('html').color,
      rootBackground: css('html').backgroundColor,
      rootFont: css('html').fontFamily,
      bodyMargin: css('body').margin,
      bodyOverflow: css('body').overflow,
      brandFont: css('.brand').fontFamily,
      brandSize: css('.brand').fontSize,
      eyebrowSize: css('.eyebrow').fontSize,
      linkColor: css('#host-probe').color,
      linkDecoration: css('#host-probe').textDecorationLine,
      language: document.documentElement.lang,
      bodyClass: document.body.className,
    };
  });
}

async function mockExhibits(page: Page) {
  await page.route('**/ja/hakoniwa/exhibits/**/index.html*', route => route.fulfill({
    status: 200,
    contentType: 'text/html',
    body: `<!doctype html><html><body><canvas id="scene" data-ready="true"></canvas>
      <script>window.__disposeScene = () => { parent.__hakoniwaDisposed = (parent.__hakoniwaDisposed || 0) + 1; };</script>
      </body></html>`,
  }));
}

test('host routes, metadata and static HTML remain independent of the layer', async ({ page, request }) => {
  const downloaded: string[] = [];
  page.on('request', request => { if (heavyAsset.test(request.url())) downloaded.push(request.url()); });
  for (const path of ['/', '/about', '/dev/assets']) {
    const response = await page.goto(path);
    expect(response?.status()).toBe(200);
    expect(response?.headers()['x-robots-tag']).toBeUndefined();
    await expect(page.getByTestId('host-shell')).toBeVisible();
    await expect(page.locator('html')).toHaveAttribute('lang', 'en');
    await expect(page.locator('meta[name="robots"]')).toHaveCount(0);
    await expect(page.locator('meta[name="description"]')).toHaveAttribute('content', 'Independent consumer application');
    await expect(page.locator('iframe')).toHaveCount(0);
    expect((await hostStyles(page)).bodyMargin).toBe('19px');
    await expect(page).toHaveTitle({ '/': 'Consumer host', '/about': 'About the consumer', '/dev/assets': 'Consumer asset tools' }[path]!);
  }
  expect(downloaded).toEqual([]);
  const hostAsset = await request.get('/exhibits/host.txt');
  expect(hostAsset.status()).toBe(200);
  expect(await hostAsset.text()).toContain('belongs to the consumer');
  const staticPage = await request.get('/plain.html');
  expect(staticPage.status()).toBe(200);
  expect(staticPage.headers()['x-robots-tag']).toBeUndefined();
  expect(await staticPage.text()).toContain('content="index, follow"');
  expect(await staticPage.text()).not.toContain('noindex');
  const missingHost = await request.get('/missing-host-page');
  expect(missingHost.status()).toBe(404);
  expect(missingHost.headers()['x-robots-tag']).toBeUndefined();
});

test('collection has namespaced thumbnails and links without downloading 3D', async ({ page }) => {
  const downloaded: string[] = [];
  page.on('request', request => { if (heavyAsset.test(request.url())) downloaded.push(request.url()); });
  const response = await page.goto(collection);
  expect(response?.status()).toBe(200);
  expect(response?.headers()['x-robots-tag']).toBeUndefined();
  await expect(page.getByTestId('host-shell')).toHaveCount(0);
  await expect(page.locator('.exhibit-card')).toHaveCount(5);
  await expect(page.locator('iframe, canvas')).toHaveCount(0);
  await expect(page.locator('html')).toHaveAttribute('lang', 'ja');
  await expect(page.locator('meta[name="robots"]')).toHaveCount(0);
  for (const [index, slug] of slugs.entries()) {
    const card = page.locator('.exhibit-card').nth(index);
    await expect(card).toHaveAttribute('href', new RegExp(`^/ja/hakoniwa/${slug}/?$`));
    const image = card.locator('img');
    await expect(image).toHaveAttribute('src', `/ja/hakoniwa/images/hakoniwa/${slug}.webp`);
    await image.scrollIntoViewIfNeeded();
    await expect.poll(() => image.evaluate((node: HTMLImageElement) => node.complete && node.naturalWidth > 0)).toBe(true);
  }
  expect(downloaded).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('SPA navigation, repeated viewer switches, Escape and Back restore the host', async ({ page }) => {
  await mockExhibits(page);
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/');
  const original = await hostStyles(page);
  await page.getByRole('link', { name: 'Hakoniwa collection', exact: true }).click();
  await expect(page).toHaveURL(/\/ja\/hakoniwa\/$/);
  await expect(page.getByTestId('host-shell')).toHaveCount(0);
  await page.locator('.exhibit-card').nth(2).click();
  await expect(page).toHaveURL(/\/ja\/hakoniwa\/library-diorama\/?$/);
  await expect(page.locator('.loading-note')).toHaveCount(0);
  await expect(page.locator('iframe')).toHaveCount(1);
  await expect(page.locator('body')).toHaveClass(/hakoniwa-immersive-view/);
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', 'noindex, follow');
  const frame = await page.locator('iframe').boundingBox();
  expect(frame?.x).toBe(0);
  expect(frame?.y).toBe(0);
  expect(frame?.width).toBe(1280);
  expect(frame?.height).toBe(900);
  await page.getByText('操作・箱庭', { exact: true }).click();
  await page.getByRole('navigation', { name: '箱庭を選ぶ', exact: true }).getByRole('link', { name: /ニューヨーク/ }).click();
  await expect(page).toHaveURL(/\/ja\/hakoniwa\/nyc-diorama\/?$/);
  await expect(page.locator('iframe')).toHaveCount(1);
  await expect(page.locator('iframe')).toHaveAttribute('src', /\/ja\/hakoniwa\/exhibits\/nyc-diorama\/index.html/);
  expect(await page.evaluate(() => (window as any).__hakoniwaDisposed)).toBe(1);
  await page.getByText('操作・箱庭', { exact: true }).click();
  await expect(page.locator('.viewer-menu')).toHaveAttribute('open', '');
  await page.keyboard.press('Escape');
  await expect(page.locator('.viewer-menu')).not.toHaveAttribute('open', '');
  await page.goBack();
  await expect(page).toHaveURL(/\/ja\/hakoniwa\/library-diorama\/?$/);
  await page.goBack();
  await expect(page).toHaveURL(/\/ja\/hakoniwa\/$/);
  await expect(page.locator('iframe')).toHaveCount(0);
  await expect(page.locator('body')).not.toHaveClass(/hakoniwa-immersive-view/);
  await page.goBack();
  await expect(page).toHaveURL('/');
  await expect(page.getByTestId('host-shell')).toBeVisible();
  await expect(page.locator('meta[name="robots"]')).toHaveCount(0);
  await expect(page).toHaveTitle('Consumer host');
  expect(await hostStyles(page)).toEqual(original);
  expect(await page.evaluate(() => (window as any).__hakoniwaDisposed)).toBeGreaterThanOrEqual(3);
  expect(errors).toEqual([]);
});

test('nested routes, direct URLs, missing slugs and public assets stay in the namespace', async ({ page, request }) => {
  await mockExhibits(page);
  for (const slug of slugs) {
    const response = await page.goto(`/ja/hakoniwa/${slug}`);
    expect(response?.status()).toBe(200);
    expect(response?.headers()['x-robots-tag']).toBe('noindex, follow');
    await expect(page.locator('.fullscreen-room')).toHaveCount(1);
    await expect(page.locator('iframe')).toHaveAttribute('src', new RegExp(`/ja/hakoniwa/exhibits/${slug}/index.html`));
  }
  for (const path of [
    '/ja/hakoniwa/dev/assets',
    '/ja/hakoniwa/dev/assets/library-diorama',
    '/ja/hakoniwa/dev/assets/library-diorama/chair',
    '/ja/hakoniwa/dev/assets/mesh-review',
    '/ja/hakoniwa/play/library-books',
  ]) {
    const response = await request.get(path);
    expect(response.status(), path).toBe(200);
    expect(response.headers()['x-robots-tag'] === 'noindex, follow' || /name="robots"[^>]*noindex/.test(await response.text()), path).toBe(true);
  }
  for (const path of ['/ja/hakoniwa/unknown', '/ja/hakoniwa/dev/assets/unknown', '/ja/hakoniwa/dev/assets/library-diorama/unknown']) {
    const response = await request.get(path);
    expect(response.status(), path).toBe(404);
    expect(response.headers()['x-robots-tag'], path).toBe('noindex, follow');
  }
  for (const path of [
    '/ja/hakoniwa/fonts/m-plus-rounded-1c/brand-500.woff',
    '/ja/hakoniwa/exhibits/licenses/THREE-LICENSE.txt',
    '/ja/hakoniwa/exhibits/library-diorama/index.html',
  ]) expect((await request.get(path)).status(), path).toBe(200);
  const comparison = await request.get('/ja/hakoniwa/library-comparison.html');
  expect(comparison.status()).toBe(200);
  expect(await comparison.text()).toContain('/ja/hakoniwa/exhibits/');
  expect(await comparison.text()).toContain('noindex');
  const legacy = await request.get('/ja/hakoniwa/ocean-diorama/index.html');
  expect(legacy.status()).toBe(200);
  expect(await legacy.text()).toContain('/ja/hakoniwa/sand-pedestal');
});

test('real 3D is requested only after opening a viewer and is disposed on exit', async ({ page }) => {
  const downloaded: string[] = [];
  page.on('request', request => { if (heavyAsset.test(request.url())) downloaded.push(request.url()); });
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(collection);
  expect(downloaded).toEqual([]);
  await page.goto('/ja/hakoniwa/electric-town-diorama?quality=low&inspect=1');
  const canvas = page.frameLocator('iframe').locator('#scene');
  await expect(canvas).toHaveAttribute('data-ready', 'true', { timeout: 180000 });
  await expect(page.locator('.loading-note')).toHaveCount(0);
  expect(downloaded.some(url => /\/exhibits\/assets\/.*\.js/.test(url))).toBe(true);
  const scene = page.frames().find(frame => frame.url().includes('/ja/hakoniwa/exhibits/'))!;
  const initial = await scene.evaluate(() => (window as any).__scene.view.get().azimuth);
  await canvas.focus();
  await canvas.press('ArrowRight');
  await expect.poll(() => scene.evaluate(() => (window as any).__scene.view.get().azimuth)).not.toBe(initial);
  await scene.evaluate(() => {
    const dispose = (window as any).__disposeScene;
    (window as any).__disposeScene = () => {
      dispose();
      (parent as any).__layerCleanup = {
        disposed: document.querySelector('canvas')?.dataset.disposed,
        contextLost: (window as any).__scene.renderer.getContext().isContextLost(),
      };
    };
  });
  await page.screenshot({ path: 'test-results/layer-consumer-electric-town.png' });
  await page.getByRole('link', { name: '展示室にもどる', exact: true }).click();
  await expect(page).toHaveURL(/\/ja\/hakoniwa\/$/);
  await expect(page.locator('iframe')).toHaveCount(0);
  expect(await page.evaluate(() => (window as any).__layerCleanup)).toEqual({ disposed: 'true', contextLost: true });
  expect(errors).toEqual([]);
});
