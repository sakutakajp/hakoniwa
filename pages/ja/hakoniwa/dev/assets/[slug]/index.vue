<script setup lang="ts">
import {assetCatalog} from '#hakoniwa/data/asset-catalog';
const route=useRoute();const exhibit=assetCatalog.find(e=>e.slug===route.params.slug);
if(!exhibit)throw createError({statusCode:404,statusMessage:'箱庭が見つかりません'});
useSeoMeta({title:`${exhibit.title}のアセット | MIRAI MUSEUM`});
</script>
<template><main v-if="exhibit" class="asset-browser"><NuxtLink to="/ja/hakoniwa/dev/assets">← 箱庭一覧</NuxtLink><h1>{{exhibit.title}}</h1><p>同じ種類は代表をひとつ。椅子とラウンジチェアなど、形・用途が異なるものは別々に展示します。</p><div class="asset-grid"><NuxtLink v-for="o in exhibit.objects" :key="o.id" class="asset-card" :to="`/ja/hakoniwa/dev/assets/${exhibit.slug}/${o.id}`"><h2>{{o.label}}</h2><p>回してみる →</p></NuxtLink></div><p class="asset-note">単体の範囲を確認できたオブジェクトを掲載しています。壁や地面など、シーン全体のすべての部品を網羅した一覧ではありません。</p></main></template>
