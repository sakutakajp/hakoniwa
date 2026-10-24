<script setup lang="ts">
import { ROBOTS_NOINDEX, shouldNoindex } from '#hakoniwa/shared/indexing';
import '#hakoniwa/assets/css/museum.css';
import '#hakoniwa/assets/css/asset-browser.css';

// This parent owns the experience, without replacing the consumer's app or layout.
definePageMeta({ layout: false });
const route = useRoute();
useHead(() => ({
  htmlAttrs: { lang: 'ja' },
  bodyAttrs: { class: 'hakoniwa-page' },
  meta: shouldNoindex(route.path)
    ? [{ key: 'robots', name: 'robots', content: ROBOTS_NOINDEX }]
    : [],
}));
</script>

<template>
  <div class="hakoniwa-shell"><NuxtPage /></div>
</template>
