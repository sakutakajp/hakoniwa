<script setup lang="ts">
import { exhibits } from '~/data/exhibits';
useSeoMeta({ title: '箱庭の展示室 | MIRAI MUSEUM', description: '島と海、ニューヨーク、図書館、ジュラ紀の川辺、電気街。5つの小さな世界を、好きな角度から。' });
</script>

<template>
  <div class="museum">
    <header class="masthead"><NuxtLink to="/" class="brand"><MuseumBrand /><span class="brand-subtitle">みらい博物館</span></NuxtLink><span class="edition">THE HAKONIWA COLLECTION</span></header>
    <main class="collection">
      <section class="intro"><p class="eyebrow">05 WORLDS · ENDLESS PERSPECTIVES</p><h1>小さな世界を、<br>好きな角度から。</h1><p class="intro-copy">海の向こうへ。街の路地へ。本の森へ。<br>くるりと回して、近づいて。<br class="mobile-break">あなただけの景色を見つけよう。</p></section>
      <section class="exhibit-grid" aria-label="5つの箱庭">
        <NuxtLink v-for="item in exhibits" :key="item.slug" :to="`/hakoniwa/${item.slug}`" class="exhibit-card">
          <div class="card-image"><img :src="`/images/hakoniwa/${item.slug}.webp`" :alt="`${item.title}の箱庭`" :loading="item.number === '01' ? 'eager' : 'lazy'" width="900" height="650"><span class="card-number">{{ item.number }}</span></div>
          <div class="card-copy"><p class="eyebrow">{{ item.category }}</p><h2>{{ item.title }}<span aria-hidden="true">↗</span></h2><p>{{ item.subtitle }}</p></div>
        </NuxtLink>
      </section>
    </main>
    <footer class="museum-footer"><span>小さな世界から、広がる好奇心。</span><span>MIRAI MUSEUM / 箱庭の展示室</span></footer>
  </div>
</template>
