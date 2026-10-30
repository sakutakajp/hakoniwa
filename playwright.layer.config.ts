import { defineConfig } from '@playwright/test';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const port = Number(process.env.LAYER_PORT || 3025);
const consumerDir = process.env.LAYER_CONSUMER_DIR || join(tmpdir(), 'hakoniwa-consumer-nuxt4');
const baseURL = process.env.LAYER_URL || `http://127.0.0.1:${port}`;

export default defineConfig({
  testDir: './tests/layer',
  timeout: 240000,
  workers: 1,
  expect: { timeout: 20000 },
  reporter: [['list']],
  use: {
    baseURL,
    contextOptions: { reducedMotion: 'reduce' },
    viewport: { width: 1280, height: 900 },
    launchOptions: {
      executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium',
      args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
    },
    trace: 'retain-on-failure',
  },
  // The consumer must be built first; LAYER_URL can point to an existing server.
  webServer: process.env.LAYER_URL ? undefined : {
    command: 'node .output/server/index.mjs',
    cwd: consumerDir,
    env: { PORT: String(port), HOST: '127.0.0.1' },
    url: baseURL,
    reuseExistingServer: !process.env.CI,
    timeout: 30000,
  },
});
