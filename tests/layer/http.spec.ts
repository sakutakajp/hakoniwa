import { expect, test } from '@playwright/test';
import { readdir, readFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { tmpdir } from 'node:os';

const base = '/ja/hakoniwa';
const slugs = ['sand-pedestal', 'nyc-diorama', 'library-diorama', 'dino-diorama', 'electric-town-diorama', 'datacenter-diorama'];
const output = resolve(process.env.LAYER_CONSUMER_DIR || join(tmpdir(), 'hakoniwa-consumer-nuxt3'), '.output/public');
const headOf = (html: string) => html.match(/<head\b[^>]*>([\s\S]*?)<\/head>/i)?.[1] || '';

// These checks deliberately do not request the page/browser fixture. They can
// verify the production integration even when a sandbox cannot launch Chromium.
test('HTTP: consumer pages, old paths and static metadata are not overridden', async ({ request }) => {
  for (const [path, title] of [
    ['/', 'Consumer host'],
    ['/about', 'About the consumer'],
    ['/dev/assets', 'Consumer asset tools'],
  ]) {
    const response = await request.get(path!);
    expect(response.status(), path).toBe(200);
    expect(response.headers()['x-robots-tag'], path).toBeUndefined();
    const html = await response.text();
    expect(html).toContain(`<title>${title}</title>`);
    expect(html).toContain('lang="en"');
    expect(html).toContain('data-testid="host-shell"');
    expect(html).not.toContain('<iframe');
    expect(html).not.toContain('class="hakoniwa-shell"');
    expect(headOf(html)).not.toMatch(/name="robots"[^>]*noindex/);
    expect(headOf(html)).not.toContain('.hakoniwa-shell');
    expect(headOf(html)).not.toContain('/ja/hakoniwa/exhibits/');
  }
  const staticPage = await request.get('/plain.html');
  expect(staticPage.status()).toBe(200);
  expect(staticPage.headers()['x-robots-tag']).toBeUndefined();
  expect(await staticPage.text()).toContain('content="index, follow"');
  expect(await staticPage.text()).not.toContain('noindex');
  const asset = await request.get('/exhibits/host.txt');
  expect(asset.status()).toBe(200);
  expect(await asset.text()).toContain('belongs to the consumer');
  const missing = await request.get('/missing-host-page');
  expect(missing.status()).toBe(404);
  expect(missing.headers()['x-robots-tag']).toBeUndefined();
});

test('HTTP: collection and all nested pages render under /ja/hakoniwa', async ({ request }) => {
  for (const path of [base, `${base}/`]) {
    const response = await request.get(path);
    expect(response.status()).toBe(200);
    expect(response.headers()['x-robots-tag']).toBeUndefined();
    const html = await response.text();
    expect(html).toContain('lang="ja"');
    expect(html).toContain('class="hakoniwa-shell"');
    expect(html).not.toContain('data-testid="host-shell"');
    expect(html).not.toContain('<iframe');
    expect(headOf(html)).not.toMatch(/name="robots"[^>]*noindex/);
    for (const slug of slugs) {
      expect(html).toContain(`href="${base}/${slug}"`);
      expect(html).toContain(`${base}/images/hakoniwa/${slug}.webp`);
    }
  }
  for (const slug of slugs) {
    const response = await request.get(`${base}/${slug}?quality=low&inspect=1`);
    expect(response.status(), slug).toBe(200);
    expect(response.headers()['x-robots-tag'], slug).toBe('noindex, follow');
    const html = await response.text();
    expect(html).toContain('class="fullscreen-room"');
    expect(html).not.toContain('data-testid="host-shell"');
    expect(html).toContain(`${base}/exhibits/${slug}/index.html?hint=0&amp;quality=low&amp;inspect=1`);
    expect(headOf(html)).toMatch(/name="robots"[^>]*noindex/);
  }
  for (const path of [
    '/dev/assets', '/dev/assets/library-diorama', '/dev/assets/library-diorama/chair',
    '/dev/assets/mesh-review', '/play/library-books',
  ]) {
    const response = await request.get(base + path);
    expect(response.status(), path).toBe(200);
    // Nitro can serve prerendered routes before server middleware; their HTML
    // robots tag is the equivalent static-hosting protection.
    expect(response.headers()['x-robots-tag'] === 'noindex, follow' || /name="robots"[^>]*noindex/.test(headOf(await response.text())), path).toBe(true);
  }
  for (const path of ['/unknown', '/dev/assets/unknown', '/dev/assets/library-diorama/unknown']) {
    const response = await request.get(base + path);
    expect(response.status(), path).toBe(404);
    expect(response.headers()['x-robots-tag'], path).toBe('noindex, follow');
  }
});

test('HTTP: generated iframe documents, chunks, font, thumbnails and licenses are served', async ({ request }) => {
  for (const slug of [...slugs, 'library-20m']) {
    const path = `${base}/exhibits/${slug}/index.html`;
    const response = await request.get(path);
    expect(response.status(), path).toBe(200);
    const html = await response.text();
    expect(headOf(html)).toMatch(/name="robots"[^>]*noindex/);
    const assets = [...html.matchAll(/(?:src|href)="([^"?]+\.(?:js|css))"/g)].map(match => match[1]!);
    expect(assets.length, path).toBeGreaterThan(0);
    for (const asset of assets) {
      expect(asset).toMatch(/^\/ja\/hakoniwa\/exhibits\/assets\//);
      const assetResponse = await request.get(asset);
      expect(assetResponse.status(), asset).toBe(200);
      expect(assetResponse.headers()['content-type'], asset).toMatch(/javascript|text\/css/);
    }
  }
  for (const path of [
    '/fonts/m-plus-rounded-1c/brand-500.woff',
    '/exhibits/licenses/THREE-LICENSE.txt',
    ...slugs.map(slug => `/images/hakoniwa/${slug}.webp`),
  ]) expect((await request.get(base + path)).status(), path).toBe(200);
  const comparison = await request.get(`${base}/library-comparison.html`);
  expect(comparison.status()).toBe(200);
  expect(await comparison.text()).toContain(`${base}/exhibits/`);
  expect(await comparison.text()).toContain('noindex');
  const legacy = await request.get(`${base}/ocean-diorama/index.html`);
  expect(legacy.status()).toBe(200);
  expect(await legacy.text()).toContain(`${base}/sand-pedestal`);
});

test('bundle: Three.js belongs only to standalone exhibit chunks, not Nuxt page chunks', async () => {
  const nuxtDirectory = resolve(output, '_nuxt');
  const nuxtChunks = (await readdir(nuxtDirectory)).filter(file => file.endsWith('.js'));
  expect(nuxtChunks.length).toBeGreaterThan(0);
  for (const file of nuxtChunks) {
    expect(await readFile(resolve(nuxtDirectory, file), 'utf8'), file).not.toContain('WebGLRenderer');
  }
  const exhibitDirectory = resolve(output, 'ja/hakoniwa/exhibits/assets');
  const exhibitChunks = (await readdir(exhibitDirectory)).filter(file => file.endsWith('.js'));
  const sources = await Promise.all(exhibitChunks.map(file => readFile(resolve(exhibitDirectory, file), 'utf8')));
  expect(sources.some(source => source.includes('WebGLRenderer'))).toBe(true);
  const mainChunks = (await readdir(nuxtDirectory)).filter(file => file.startsWith('entry.') && file.endsWith('.css'));
  for (const file of mainChunks) {
    expect(await readFile(resolve(nuxtDirectory, file), 'utf8'), file).not.toContain('.hakoniwa-shell');
  }
});
