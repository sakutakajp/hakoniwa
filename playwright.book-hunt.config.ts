import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './tests/book-hunt', timeout: 240000, workers: 1,
  expect: { timeout: 30000 },
  reporter: [['list'], ['json', { outputFile: `${process.env.EVIDENCE_DIR || 'test-results/book-hunt'}/results.json` }]],
  use: { baseURL: process.env.BOOK_HUNT_URL || 'http://127.0.0.1:3015', reducedMotion: 'reduce', launchOptions: { executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium', args: ['--no-sandbox','--use-angle=swiftshader','--enable-unsafe-swiftshader'] } },
  projects: [
    { name: 'desktop', use: { viewport: {width:1280,height:900} } },
    { name: 'small-mobile', use: { viewport: {width:320,height:740}, isMobile:true, hasTouch:true, deviceScaleFactor:1 } },
    { name: 'mobile', use: { viewport: {width:390,height:844}, isMobile:true, hasTouch:true, deviceScaleFactor:3 } },
  ],
});
