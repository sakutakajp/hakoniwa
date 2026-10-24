import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './tests/exhibits',
  timeout: 240000,
  workers: 1,
  expect: { timeout: 20000 },
  reporter: [['list'], ['json', { outputFile: process.env.EVIDENCE_REPORT || `${process.env.EVIDENCE_DIR || 'test-results/evidence'}/results.json` }]],
  use: {
    baseURL: 'http://127.0.0.1:3000',
    // ソフトウェアGPUで安定して比較できるよう波のアニメーションを止める。
    contextOptions: { reducedMotion: 'reduce' },
    launchOptions: { executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium', args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] },
  },
  projects: [
    { name: 'desktop', use: { viewport: { width: 1440, height: 1000 } } },
    { name: 'mobile', use: { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 1 } },
  ],
});
