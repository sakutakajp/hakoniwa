import { fileURLToPath } from 'node:url';
import { tagStaticHtml } from './scripts/noindex-static';
import { shouldNoindex, withNoindexMeta } from './shared/indexing';

export default defineNuxtConfig({
  $meta: { name: 'hakoniwa' },
  alias: { '#hakoniwa': fileURLToPath(new URL('.', import.meta.url)) },
  compatibilityDate: '2026-10-05',
  modules: [fileURLToPath(new URL('./modules/hakoniwa.ts', import.meta.url))],
  // Never change the consumer's root route, app shell, global CSS/head, or deploy target.
  routeRules: {
    '/ja/hakoniwa/dev/**': { prerender: false },
    '/ja/hakoniwa/dev/assets': { prerender: true },
  },
  nitro: {
    hooks: {
      'prerender:generate': route => {
        if (shouldNoindex(route.route) && route.contents && /<html[\s>]/i.test(route.contents)) route.contents = withNoindexMeta(route.contents);
      },
    },
  },
  hooks: {
    'nitro:build:public-assets': async nitro => { await tagStaticHtml(nitro.options.output.publicDir); },
  },
});
