<script setup lang="ts">
import SceneFrame from '#hakoniwa/components/SceneFrame.vue';
import MuseumBrand from '#hakoniwa/components/MuseumBrand.vue';
import { exhibits } from '#hakoniwa/data/exhibits';
definePageMeta({ key: route => `${route.params.slug}:${route.query.quality ?? "auto"}` });
const route = useRoute();
const item = exhibits.find(entry => entry.slug === route.params.slug);
if (!item) throw createError({ statusCode: 404, statusMessage: 'この箱庭は見つかりません' });
useSeoMeta({ title: `${item.title}の箱庭 | MIRAI MUSEUM`, description: item.description });
const menu = ref<HTMLDetailsElement>();
useHead({
  bodyAttrs: { class: 'hakoniwa-immersive-view' },
  meta: [{ name: 'viewport', content: 'width=device-width, initial-scale=1, viewport-fit=cover' }],
});
function closeMenu(event: KeyboardEvent) {
  if (event.key === 'Escape' && menu.value?.open) {
    menu.value.open = false;
    menu.value.querySelector('summary')?.focus();
  }
}
const query = new URLSearchParams({ hint: '0' });
// 品質の比較・確認に使う値だけを作品へ渡す。
if (route.query.quality === 'low' || route.query.quality === 'high') query.set('quality', route.query.quality);
if (route.query.inspect === '1') query.set('inspect', '1');
const source = `/ja/hakoniwa/exhibits/${item.slug}/index.html${query.size ? `?${query}` : ''}`;
onMounted(() => window.addEventListener('keydown', closeMenu));
onBeforeUnmount(() => window.removeEventListener('keydown', closeMenu));
</script>

<template>
  <main class="fullscreen-room">
    <h1 class="screen-reader-title">{{ item!.title }}の箱庭</h1>
    <SceneFrame :slug="item!.slug" :title="item!.title" :source="source" />
    <header class="viewer-overlay">
      <NuxtLink to="/ja/hakoniwa/" class="viewer-back" aria-label="展示室にもどる">
        <span class="back-arrow" aria-hidden="true">←</span>
        <span class="viewer-identity"><MuseumBrand /><span class="viewer-title">{{ item!.title }}の箱庭</span></span>
      </NuxtLink>
      <details ref="menu" class="viewer-menu">
        <summary>操作・箱庭</summary>
        <div class="viewer-panel">
          <h2>眺め方</h2>
          <p>ドラッグで回転、ホイール・ピンチで拡大。右ドラッグ・2本指で移動。ダブルクリック・ダブルタップで元の向きに戻ります。</p>
          <p>キーボードでは画面を選んで矢印キー・＋・−・0で操作できます。</p>
          <p class="world-description">{{ item!.description }}</p>
          <nav aria-label="箱庭を選ぶ"><NuxtLink v-for="entry in exhibits" :key="entry.slug" :to="`/ja/hakoniwa/${entry.slug}`" :aria-current="entry.slug === item!.slug ? 'page' : undefined"><span>{{ entry.number }}</span>{{ entry.title }}</NuxtLink></nav>
        </div>
      </details>
    </header>
  </main>
</template>

<style scoped>
:global(body.hakoniwa-immersive-view) { overflow: hidden; overscroll-behavior: none; }
.fullscreen-room { position: fixed; inset: 0; width: 100%; height: 100vh; height: 100dvh; overflow: hidden; background: #fae8d4; }
.fullscreen-room .scene-stage { position: absolute; inset: 0; width: 100%; height: 100%; min-height: 0; margin: 0; border-radius: 0; }
.viewer-overlay { position: absolute; z-index: 2; top: calc(16px + env(safe-area-inset-top, 0px)); left: calc(16px + env(safe-area-inset-left, 0px)); right: calc(16px + env(safe-area-inset-right, 0px)); display: flex; justify-content: space-between; align-items: flex-start; gap: 12px; pointer-events: none; }
.viewer-back, .viewer-menu { pointer-events: auto; }
.viewer-back, .viewer-menu summary { background: #fffaf0e8; border: 1px solid #d7c5ad99; border-radius: 12px; box-shadow: 0 2px 10px #493e3308; }
.viewer-back { display: flex; gap: 12px; align-items: center; padding: 10px 15px; min-height: 48px; }
.back-arrow { font-size: 18px; }
.viewer-identity { display: flex; flex-direction: column; gap: 3px; font-size: 17px; }
.viewer-title { font-size: 10px; color: var(--hakoniwa-text-muted); }
.viewer-menu { position: relative; }
.viewer-menu summary { min-height: 48px; padding: 15px; cursor: pointer; list-style: none; font-size: 12px; white-space: nowrap; }
.viewer-menu summary::-webkit-details-marker { display: none; }
.viewer-menu summary::after { content: ' ＋'; }
.viewer-menu[open] summary::after { content: ' −'; }
.viewer-panel { position: absolute; top: calc(100% + 10px); right: 0; width: min(340px, calc(100vw - 32px - env(safe-area-inset-left, 0px) - env(safe-area-inset-right, 0px))); max-height: calc(100dvh - 106px - env(safe-area-inset-top, 0px) - env(safe-area-inset-bottom, 0px)); overflow-y: auto; overscroll-behavior: contain; padding: 20px; background: #fffaf5f5; border: 1px solid #dfd1be; border-radius: 12px; box-shadow: 0 8px 30px #493e3310; font-size: 12px; line-height: 1.8; }
.viewer-panel h2 { margin: 0; font-size: 15px; font-weight: 500; }
.world-description { color: var(--hakoniwa-text-muted); border-top: 1px solid #e4d8c8; padding-top: 12px; }
.viewer-panel nav { display: grid; gap: 4px; }
.viewer-panel nav a { display: flex; gap: 14px; align-items: center; min-height: 44px; padding: 8px 12px; border-radius: 6px; }
.viewer-panel nav a[aria-current=page], .viewer-panel nav a:hover { background: #eee2d1; }
.viewer-panel nav span { color: var(--hakoniwa-text-muted); font-size: 10px; }
.loading-note { padding: 80px 24px; flex-wrap: wrap; text-align: center; }
.screen-reader-title { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); }
@media(max-width:540px) { .viewer-overlay { gap: 8px; top: calc(10px + env(safe-area-inset-top, 0px)); left: calc(10px + env(safe-area-inset-left, 0px)); right: calc(10px + env(safe-area-inset-right, 0px)); } .viewer-back { padding: 8px 10px; gap: 8px; } .viewer-identity { font-size: 14px; } .viewer-menu summary { padding: 15px 10px; font-size: 11px; } }
</style>
