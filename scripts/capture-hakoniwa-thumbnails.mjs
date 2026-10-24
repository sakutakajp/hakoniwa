/** 共通ホームから一覧用画像を撮影。先に npm run build:exhibits を実行して配信する。
 * node scripts/capture-hakoniwa-thumbnails.mjs http://127.0.0.1:3000 [保存先]
 * 台座の投影幅・下端をニューヨークと一致させる。モデルや詳細ページは変更しない。
 */
import { chromium } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';
import { exhibits } from '../app/data/exhibits.ts';
import { homeCamera } from '../exhibits/shared/home-camera.ts';

const baseURL = process.argv[2] || 'http://127.0.0.1:3000';
const output = resolve(process.argv[3] || 'test-results/home-thumbnails');
const width = 900, height = 650;
mkdirSync(output, { recursive: true });
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium',
  args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
const metrics = [];
let reference;
try {
  // 基準を先に撮影し、その台座の画面占有率を全作品に使う。
  const ordered = [...exhibits].sort((a, b) => Number(b.slug === 'nyc-diorama') - Number(a.slug === 'nyc-diorama'));
  for (const { slug } of ordered) {
    const page = await browser.newPage({ viewport: { width, height }, reducedMotion: 'reduce' });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(new URL(`/exhibits/${slug}/index.html?inspect=1&quality=low&hint=0`, baseURL).href);
    await page.locator('#scene[data-ready="true"]').waitFor({ timeout: 180000 });
    const bounds = () => page.evaluate(() => {
      const { scene, camera } = window.__scene;
      const base = scene.getObjectByName('pedestal-base') || scene.getObjectByName('pedestal-plate');
      if (!base) throw new Error('台座が見つかりません');
      scene.updateMatrixWorld(true);
      const positions = base.geometry.getAttribute('position');
      const point = camera.position.clone();
      let minX = Infinity, maxX = -Infinity, minY = Infinity;
      for (let i = 0; i < positions.count; i++) {
        point.fromBufferAttribute(positions, i).applyMatrix4(base.matrixWorld).project(camera);
        minX = Math.min(minX, point.x); maxX = Math.max(maxX, point.x); minY = Math.min(minY, point.y);
      }
      return { width: maxX - minX, center: (minX + maxX) / 2, bottom: minY };
    });
    const home = await page.evaluate(() => window.__scene.view.get());
    assert.equal(home.azimuth, homeCamera.azimuth);
    assert.equal(home.elevation, homeCamera.elevation);
    const before = await bounds();
    reference ??= before;
    const zoom = reference.width / before.width;
    // 既存の全体フィットを拡大しない。将来NYより高い作品が増えたら基準を再検討する。
    assert(zoom >= 0.6 && zoom <= 1 + 1e-8, `${slug}: 安全な縮小範囲外 (${zoom})`);
    await page.evaluate(({ zoom, panX, panY }) => {
      const app = window.__scene;
      app.view.set({ zoom, panX, panY }, { animate: false });
      app.setSeaTime?.(0); app.setWaterTime?.(0);
    }, { zoom, panX: reference.center - before.center * zoom, panY: reference.bottom - before.bottom * zoom });
    await page.waitForFunction(() => !window.__scene.view.isMoving(), null, { timeout: 60000 });
    // 描画ループの完了後に投影値と画像を取得する。
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    const after = await bounds();
    assert(Math.abs(after.width - reference.width) * width / 2 < 0.1, `${slug}: 台座幅の不一致`);
    assert(Math.abs(after.bottom - reference.bottom) * height / 2 < 0.1, `${slug}: 台座下端の不一致`);
    assert.deepEqual(errors, []);
    await page.locator('#scene').screenshot({ path: `${output}/${slug}.png`, timeout: 60000 });
    metrics.push({ slug, home, zoom, pedestalWidthPx: after.width * width / 2, pedestalBottomPx: (1 - after.bottom) * height / 2 });
    console.log(slug, metrics.at(-1));
    await page.close();
  }
  writeFileSync(`${output}/metrics.json`, JSON.stringify({ width, height, metrics }, null, 2) + '\n');
} finally {
  await browser.close();
}
