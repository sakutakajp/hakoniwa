import { test, expect } from '@playwright/test';
import { mkdirSync, readFileSync } from 'node:fs';

// ソフトウェアGPUではリサイズ時の水面再描画に時間がかかる。
test.setTimeout(360000);
const settled = expect.configure({ timeout: 60000 });

const evidence = process.env.EVIDENCE_DIR || 'test-results/camera-after';
const slugs = ['sand-pedestal', 'nyc-diorama', 'library-diorama', 'dino-diorama', 'electric-town-diorama'];
mkdirSync(evidence, { recursive: true });

for (const slug of slugs) {
  test(`${slug}: 共通ホーム・操作後のリサイズ・リセット`, async ({ page }, info) => {
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(`/ja/hakoniwa/exhibits/${slug}/index.html?quality=low&inspect=1&hint=0`);
    const canvas = page.locator('#scene');
    await expect(canvas).toHaveAttribute('data-ready', 'true', { timeout: 180000 });
    const snapshot = () => page.evaluate(() => {
      const { view, camera } = (window as any).__scene;
      return { view: view.get(), matrix: [...camera.projectionMatrix.elements], position: camera.position.toArray() };
    });
    const initial = await snapshot();
    expect(initial.view).toEqual({ azimuth: 0, elevation: 22.8, zoom: 1, panX: 0, panY: 0 });
    // 基準作品は変更前のカメラ位置・投影行列と一致する。
    if (slug === 'nyc-diorama') {
      const before = JSON.parse(readFileSync('tests/exhibits/fixtures/nyc-home-camera.json', 'utf8'))
        .find((entry: any) => entry.slug === slug && entry.name === info.project.name);
      expect(initial.matrix).toEqual(before.matrix);
      expect(initial.position).toEqual(before.position);
    }
    await page.screenshot({ path: `${evidence}/${info.project.name}-${slug}.png` });
    await canvas.focus();
    await canvas.press('ArrowRight');
    await canvas.press('+');
    await settled.poll(async () => (await snapshot()).view.zoom).toBeGreaterThan(1);
    await settled.poll(() => page.evaluate(() => (window as any).__scene.view.isMoving())).toBe(false);
    const moved = (await snapshot()).view;
    expect(moved.azimuth).not.toBe(initial.view.azimuth);
    const size = page.viewportSize()!;
    await page.setViewportSize({ width: size.height, height: size.width });
    await settled.poll(() => page.evaluate(() => (window as any).__scene.camera.aspect)).toBeCloseTo(size.height / size.width, 5);
    expect((await snapshot()).view).toEqual(moved);
    await page.setViewportSize(size);
    await canvas.press('0');
    await settled.poll(snapshot).toEqual(initial);
    // 狭い端末でも初期化し直さず、同じホーム方向で縦横比に追従する。
    await page.setViewportSize({ width: 320, height: 568 });
    await settled.poll(() => page.evaluate(() => (window as any).__scene.camera.aspect)).toBeCloseTo(320 / 568, 5);
    expect((await snapshot()).view).toEqual(initial.view);
    await page.screenshot({ path: `${evidence}/${info.project.name}-${slug}-320.png` });
    expect(errors).toEqual([]);
  });
}
