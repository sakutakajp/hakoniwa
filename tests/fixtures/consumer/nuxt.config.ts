import { fileURLToPath } from 'node:url';

// Intentionally separate root/public directories: ~/ must resolve to this
// application, not accidentally make a broken layer work from its own checkout.
export default defineNuxtConfig({
  extends: [process.env.HAKONIWA_LAYER_ROOT || fileURLToPath(new URL('../../../', import.meta.url))],
  compatibilityDate: '2026-10-05',
  devtools: { enabled: false },
  css: [fileURLToPath(new URL('./assets/host.css', import.meta.url))],
  app: {
    head: {
      title: 'Consumer host',
      htmlAttrs: { lang: 'en' },
      bodyAttrs: { class: 'consumer-body' },
      meta: [{ name: 'description', content: 'Independent consumer application' }],
    },
  },
  nitro: { preset: 'node-server' },
});
