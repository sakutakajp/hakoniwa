<script setup lang="ts">
import { ROBOTS_NOINDEX, shouldNoindex } from '#shared/indexing';
const route = useRoute();
useHead(() => ({ meta: shouldNoindex(route.path) ? [{ key: 'robots', name: 'robots', content: ROBOTS_NOINDEX }] : [] }));
</script>
<template><NuxtPage /></template>
