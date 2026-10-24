<template>
  <div data-testid="host-shell">
    <header><strong>Consumer shell</strong></header>
    <nav aria-label="Host navigation">
      <NuxtLink to="/">Home</NuxtLink>
      <NuxtLink to="/about">About</NuxtLink>
      <NuxtLink to="/ja/hakoniwa/">Hakoniwa collection</NuxtLink>
    </nav>
    <slot />
  </div>
</template>
