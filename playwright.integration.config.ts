import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir:'./tests/integration',timeout:360000,workers:1,expect:{timeout:30000},
  reporter:[['list'],['json',{outputFile:`${process.env.EVIDENCE_DIR||'test-results/integration'}/results.json`}]],
  use:{baseURL:process.env.MUSEUM_URL||'http://127.0.0.1:3017',viewport:{width:1280,height:900},reducedMotion:'reduce',launchOptions:{executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',args:['--no-sandbox','--use-angle=swiftshader','--enable-unsafe-swiftshader']}},
});
