<script setup lang="ts">
import type { PublicSceneControls } from '#hakoniwa/exhibits/shared/public-controls';
const props = defineProps<{ slug: string; title: string; source: string }>();
type SceneWindow = Window & { __hakoniwaControls?: PublicSceneControls; __disposeScene?: () => void };
const frame = ref<HTMLIFrameElement>();
const notice = ref<HTMLElement>();
const dock = ref<HTMLElement>();
const state = ref<'loading' | 'slow' | 'ready' | 'error'>('loading');
const generation = ref(0);
const paused = ref(false);
const canControl = ref(false);
let started = 0;
let poll: ReturnType<typeof setInterval> | undefined;
const poster = computed(() => `/ja/hakoniwa/images/hakoniwa/${props.slug}.webp`);
function sceneWindow() { return frame.value?.contentWindow as SceneWindow | null; }
function inspect() {
  try {
    const doc = frame.value?.contentDocument;
    const canvas = doc?.querySelector<HTMLCanvasElement>('#scene');
    const api = sceneWindow()?.__hakoniwaControls;
    if (canvas?.dataset.unavailable === 'true' || doc?.querySelector('#scene-message:not([hidden])')) {
      state.value = 'error';
    } else if (canvas?.dataset.ready === 'true') {
      const restoreFocus = notice.value?.contains(document.activeElement);
      state.value = 'ready';
      if (restoreFocus) nextTick(() => dock.value?.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus());
    } else if (Date.now() - started > 45000) {
      state.value = 'slow';
    }
    canControl.value = state.value === 'ready' && !!api;
    if (api) paused.value = api.paused;
  } catch { state.value = 'error'; canControl.value = false; }
}
function dispose() {
  try { sceneWindow()?.__disposeScene?.(); } catch { /* A failed frame may already be gone. */ }
}
function retry() {
  dispose();
  state.value = 'loading';
  canControl.value = false;
  started = Date.now();
  generation.value++;
}
function control(action: 'left' | 'right' | 'in' | 'out' | 'reset' | 'motion') {
  const api = sceneWindow()?.__hakoniwaControls;
  if (!api || !canControl.value) return;
  if (action === 'left') api.rotate(15);
  if (action === 'right') api.rotate(-15);
  if (action === 'in') api.zoom(1.2);
  if (action === 'out') api.zoom(1 / 1.2);
  if (action === 'reset') api.reset();
  if (action === 'motion') { api.setPaused(!api.paused); paused.value = api.paused; }
}
onMounted(() => { started = Date.now(); poll = setInterval(inspect, 500); });
onBeforeUnmount(() => { clearInterval(poll); dispose(); });
</script>

<template>
  <section class="scene-frame" :aria-label="`${title}の作品表示`">
    <div class="scene-surface" :aria-busy="state === 'loading' || state === 'slow'">
      <img v-show="state !== 'ready'" class="scene-poster" :src="poster" :alt="`${title}の静止画`" width="900" height="650">
      <iframe :key="generation" ref="frame" :src="source" :title="`${title}の箱庭。ドラッグや矢印キーで回転できます`" :class="{ 'is-unavailable': state !== 'ready' }" :tabindex="state === 'ready' ? 0 : -1" :aria-hidden="state !== 'ready'" @load="inspect" @error="state = 'error'" />
    </div>
    <div v-if="state !== 'ready'" ref="notice" class="scene-notice">
      <p role="status">{{ state === 'loading' ? '小さな世界を準備しています。静止画を眺めながらお待ちください。' : state === 'slow' ? '準備に時間がかかっています。このまま待つか、読み込みをやり直せます。' : '3D表示を開始できませんでした。静止画でも作品をご覧いただけます。' }}</p>
      <div class="scene-actions">
        <button type="button" @click="retry">{{ state === 'loading' ? '読み込みをやり直す' : 'もう一度試す' }}</button>
        <NuxtLink v-if="!source.includes('quality=low')" :to="`/ja/hakoniwa/${slug}?quality=low`">軽量表示で開く</NuxtLink>
        <NuxtLink to="/ja/hakoniwa/">展示室にもどる</NuxtLink>
      </div>
    </div>
    <div ref="dock" class="camera-controls" role="group" aria-label="箱庭のカメラ操作">
      <button type="button" :disabled="!canControl" @click="control('left')">左へ回転</button>
      <button type="button" :disabled="!canControl" @click="control('right')">右へ回転</button>
      <button type="button" :disabled="!canControl" @click="control('in')">拡大</button>
      <button type="button" :disabled="!canControl" @click="control('out')">縮小</button>
      <button type="button" :disabled="!canControl" @click="control('reset')">元の向き</button>
      <button type="button" :disabled="!canControl" :aria-pressed="paused" @click="control('motion')">動きを抑える</button>
    </div>
  </section>
</template>

<style scoped>
.scene-frame,.scene-surface { position:absolute; inset:0; }
.scene-poster { width:100%; height:100%; object-fit:contain; background:var(--hakoniwa-surface-art); }
iframe { position:absolute; inset:0; width:100%; height:100%; border:0; }
iframe.is-unavailable { visibility:hidden; }
.scene-notice { position:absolute; top:50%; left:50%; transform:translate(-50%,-50%); width:min(34rem,calc(100% - 2rem)); padding:1.25rem; border:1px solid var(--hakoniwa-border); border-radius:var(--hakoniwa-radius); background:var(--hakoniwa-surface-panel); color:var(--hakoniwa-text); box-shadow:0 4px 24px #493e3318; }
.scene-notice p { margin:0 0 1rem; line-height:1.7; }
.scene-actions { display:flex; flex-wrap:wrap; gap:.5rem; }
.scene-actions a,.scene-actions button,.camera-controls button { display:inline-flex; align-items:center; justify-content:center; min-height:44px; padding:.6rem .8rem; border:1px solid var(--hakoniwa-border); border-radius:.5rem; background:var(--hakoniwa-surface-panel); color:var(--hakoniwa-text); font:inherit; font-size:.875rem; cursor:pointer; }
.camera-controls { position:absolute; bottom:calc(.75rem + env(safe-area-inset-bottom,0px)); left:50%; transform:translateX(-50%); display:flex; flex-wrap:wrap; justify-content:center; gap:.35rem; width:max-content; max-width:calc(100% - 1rem); padding:.4rem; border-radius:var(--hakoniwa-radius); background:var(--hakoniwa-surface-panel); }
.camera-controls button:disabled { opacity:.55; cursor:default; }
.camera-controls button[aria-pressed=true] { background:var(--hakoniwa-surface-selected); }
@media(max-height:550px) { .scene-notice { top:5.5rem; bottom:7rem; transform:translateX(-50%); overflow:auto; } }
</style>
