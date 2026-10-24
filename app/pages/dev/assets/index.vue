<script setup lang="ts">
import {assetCatalog} from '~/data/asset-catalog';
useSeoMeta({title:'アセット一覧 | MIRAI MUSEUM'});
</script>
<template><main class="asset-browser"><p class="eyebrow">MIRAI MUSEUM · OBJECT COLLECTION</p><h1>箱庭のアセット</h1><p>小さな世界をつくる、ひとつひとつの形。箱庭を選ぶと、種類ごとの代表オブジェクトを見られます。</p><div class="asset-grid"><NuxtLink v-for="e in assetCatalog" :key="e.slug" :to="`/dev/assets/${e.slug}`" class="asset-card"><h2>{{e.title}}</h2><p>{{e.objects.length}}種類をみる →</p></NuxtLink></div><p class="asset-note"><NuxtLink to="/dev/assets/mesh-review">シーン全体・結合メッシュの確認</NuxtLink> · <a href="/library-comparison.html">図書館10m／20m比較</a></p></main></template>
