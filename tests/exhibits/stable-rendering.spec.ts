import { test, expect } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';

test.use({ reducedMotion: 'no-preference', deviceScaleFactor: 3 });
const slugs = ['sand-pedestal', 'nyc-diorama', 'library-diorama', 'dino-diorama', 'electric-town-diorama'];
for (const slug of slugs) {
  test(`${slug}: 操作中の解像度と描画を維持`, async ({ page }, info) => {
    const mobile = info.project.name === 'mobile';
    await page.setViewportSize(mobile ? { width: 390, height: 600 } : { width: 960, height: 640 });
    const errors: string[] = [];
    page.on('pageerror', e => errors.push(e.message));
    page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
    await page.goto(`/exhibits/${slug}/index.html?quality=low&inspect=1`);
    await expect(page.locator('#scene')).toHaveAttribute('data-ready', 'true', { timeout: 180000 });
    await page.waitForTimeout(600);
    const initial = await page.evaluate(() => {
      const app = (window as any).__scene, c = app.renderer.domElement;
      const trace: any = { sizes: [], renders: [], samples: [], phase: 'start' };
      (window as any).__renderTrace = trace;
      const setSize = app.renderer.setSize.bind(app.renderer);
      app.renderer.setSize = (...args: any[]) => { trace.sizes.push({ t: performance.now(), phase: trace.phase }); return setSize(...args); };
      const render = app.renderer.render.bind(app.renderer);
      app.renderer.render = (...args: any[]) => { const t = performance.now(); render(...args); trace.renders.push({ t, duration: performance.now() - t, phase: trace.phase }); };
      const sample = (t: number) => { trace.samples.push({ t, w: c.width, h: c.height, moving: app.view.isMoving(), phase: trace.phase }); requestAnimationFrame(sample); };
      requestAnimationFrame(sample);
      return { w: c.width, h: c.height, view: app.view.get() };
    });
    const dir = `${process.env.EVIDENCE_DIR || 'test-results/evidence'}/${info.project.name}-${slug}`;
    mkdirSync(dir, { recursive: true });
    const cdp = await page.context().newCDPSession(page);
    const frames: any[] = [];
    cdp.on('Page.screencastFrame', e => {
      const index = frames.length;
      frames.push({ index, timestamp: e.metadata.timestamp });
      writeFileSync(`${dir}/${String(index).padStart(4, '0')}.jpg`, Buffer.from(e.data, 'base64'));
      cdp.send('Page.screencastFrameAck', { sessionId: e.sessionId }).catch(() => {});
    });
    await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 75, maxWidth: 480, maxHeight: 640, everyNthFrame: 1 });
    const { width, height } = page.viewportSize()!;
    const x = width / 2, y = height / 2;
    for (let repeat = 0; repeat < 2; repeat++) {
      await page.evaluate(n => { (window as any).__renderTrace.phase = `drag-${n}`; }, repeat);
      if (mobile) {
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y, id: 1 }] });
        await page.waitForTimeout(650);
        for (let i = 1; i <= 3; i++) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x + i * 15, y: y + i * 4, id: 1 }] });
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      } else {
        await page.mouse.move(x, y); await page.mouse.down(); await page.waitForTimeout(650);
        await page.mouse.move(x + 60, y + 20, { steps: 3 }); await page.mouse.up();
      }
      await expect.poll(() => page.evaluate(() => (window as any).__scene.view.get().azimuth)).not.toBe(initial.view.azimuth);
      await page.evaluate(() => { (window as any).__renderTrace.phase = 'zoom'; });
      if (mobile) {
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: x - 30, y, id: 1 }, { x: x + 30, y, id: 2 }] });
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x - 55, y, id: 1 }, { x: x + 55, y, id: 2 }] });
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      } else await page.mouse.wheel(0, -250);
      await expect.poll(() => page.evaluate(() => (window as any).__scene.view.get().zoom)).toBeGreaterThan(1.05);
      await page.evaluate(() => { (window as any).__renderTrace.phase = 'reset'; (window as any).__scene.view.reset({ animate: false }); });
      await expect.poll(() => page.evaluate(() => (window as any).__scene.view.isMoving())).toBe(false);
      await page.evaluate(() => { (window as any).__renderTrace.phase = 'stopped'; });
      await page.waitForTimeout(650);
    }
    await cdp.send('Page.stopScreencast');
    const trace = await page.evaluate(() => (window as any).__renderTrace);
    writeFileSync(`${dir}/trace.json`, JSON.stringify({ initial, frames, trace, errors }, null, 2));
    expect(trace.sizes).toEqual([]);
    expect(trace.samples.length).toBeGreaterThan(5);
    expect(trace.samples.every((s: any) => s.w === initial.w && s.h === initial.h)).toBe(true);
    expect(trace.renders.length).toBeGreaterThan(5);
    expect(errors).toEqual([]);
    await page.screenshot({ path: `${dir}/settled.png` });
  });
}
