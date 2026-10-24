import { tagStaticHtml } from './scripts/noindex-static';
import { shouldNoindex, withNoindexMeta } from './shared/indexing';

export default defineNuxtConfig({
  compatibilityDate: "2026-10-05",
  css: ["~/assets/css/museum.css", "~/assets/css/asset-browser.css"],
  devtools: { enabled: false },
  routeRules: { "/dev/**": { prerender: false }, "/dev/assets": { prerender: true } },
  // package名からの自動生成に任せず、既存の配信先Worker名に合わせる。
  nitro: {
    cloudflare: { wrangler: { name: "miraimuseum" } },
    hooks: {
      'prerender:generate': route => {
        if (shouldNoindex(route.route) && route.contents && /<html[\s>]/i.test(route.contents)) route.contents = withNoindexMeta(route.contents);
      },
    },
  },
  hooks: {
    'nitro:build:public-assets': async nitro => { await tagStaticHtml(nitro.options.output.publicDir); },
  },
  app: {
    head: {
      htmlAttrs: { lang: "ja" },
      title: "箱庭の展示室 | MIRAI MUSEUM",
    },
  },
});
