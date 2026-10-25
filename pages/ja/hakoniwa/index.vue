<script setup lang="ts">
import MuseumBrand from '#hakoniwa/components/MuseumBrand.vue';
import { exhibits } from '#hakoniwa/data/exhibits';
useSeoMeta({ title: '箱庭の展示室 | MIRAI MUSEUM', description: '島と海、ニューヨーク、図書館、ジュラ紀の川辺、電気街。5つの小さな世界を、好きな角度から。' });
</script>

<template>
  <div class="museum">
    <nav class="host-breadcrumb" aria-label="サイト内の位置"><NuxtLink to="/ja/">hirameki.dev</NuxtLink><span aria-hidden="true"> / </span><span>箱庭</span></nav>
    <header class="masthead"><NuxtLink to="/ja/hakoniwa/" class="brand"><MuseumBrand /><span class="brand-subtitle">みらい博物館</span></NuxtLink><span class="edition">THE HAKONIWA COLLECTION</span></header>
    <main class="collection">
      <section class="intro"><p class="eyebrow">{{ String(exhibits.length).padStart(2, '0') }} WORLDS · ENDLESS PERSPECTIVES</p><h1>小さな世界を、<br>好きな角度から。</h1><p class="intro-copy">海の向こうへ。街の路地へ。本の森へ。<br>くるりと回して、近づいて。<br class="mobile-break">あなただけの景色を見つけよう。</p></section>
      <section class="exhibit-grid" :aria-label="`${exhibits.length}つの箱庭`">
        <NuxtLink v-for="item in exhibits" :key="item.slug" :to="`/ja/hakoniwa/${item.slug}`" class="exhibit-card">
          <div class="card-image"><img :src="`/ja/hakoniwa/images/hakoniwa/${item.slug}.webp`" :alt="`${item.title}の箱庭`" :loading="item.number === '01' ? 'eager' : 'lazy'" width="900" height="650"><span class="card-number">{{ item.number }}</span></div>
          <div class="card-copy"><p class="eyebrow">{{ item.category }}</p><h2>{{ item.title }}<span aria-hidden="true">↗</span></h2><p>{{ item.subtitle }}</p></div>
        </NuxtLink>
      </section>
    </main>
    <footer class="museum-footer"><span>小さな世界から、広がる好奇心。</span><span>MIRAI MUSEUM / 箱庭の展示室</span></footer>
  </div>
</template>
