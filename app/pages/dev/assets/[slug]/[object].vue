<script setup lang="ts">
import {assetCatalog} from '~/data/asset-catalog';
import {showAsset} from '~/utils/asset-view';
const route=useRoute(), exhibit=assetCatalog.find(e=>e.slug===route.params.slug), object=exhibit?.objects.find(o=>o.id===route.params.object);
if(!exhibit||!object)throw createError({statusCode:404,statusMessage:'オブジェクトが見つかりません'});
useSeoMeta({title:`${object.label} · ${exhibit.title} | MIRAI MUSEUM`});
const frame=ref<HTMLIFrameElement>(),ready=ref(false),failure=ref(''),size=ref<number[]>([]);
let timer:ReturnType<typeof setInterval>|undefined,selection:ReturnType<typeof showAsset>|undefined;
const win=()=>frame.value?.contentWindow as any;
function dispose(){clearInterval(timer);selection?.dispose();selection=undefined;win()?.__disposeScene?.();}
function restore(e:PageTransitionEvent){if(e.persisted)location.reload();}
function zoom(delta:number){const a=win()?.__scene;if(a){a.view.set({zoom:Math.max(.7,Math.min(3,a.view.get().zoom+delta))},{animate:false});a.requestRender?.();}}
function reset(){const a=win()?.__scene;a?.view.set({azimuth:45,elevation:25,zoom:1,panX:0,panY:0},{animate:false});a?.requestRender?.();}
onMounted(()=>{const start=Date.now();timer=setInterval(()=>{const w=win();if(w?.document.querySelector('canvas[data-ready=true]')&&w.__scene){clearInterval(timer);try{selection=showAsset(w,object!);size.value=selection.size;ready.value=true;}catch(e){failure.value=(e as Error).message;}}else if(Date.now()-start>240000){clearInterval(timer);failure.value='準備に時間がかかっています。ページを再読込してください。';}},200);window.addEventListener('pagehide',dispose);window.addEventListener('pageshow',restore);});
onBeforeUnmount(()=>{dispose();window.removeEventListener('pagehide',dispose);window.removeEventListener('pageshow',restore);});
</script>
<template><main v-if="exhibit&&object" class="asset-browser"><NuxtLink :to="`/dev/assets/${exhibit.slug}`">← {{exhibit.title}}の一覧</NuxtLink><h1>{{object.label}}</h1><p>出典：{{exhibit.title}} · 種類ごとの代表1点</p><div class="asset-controls"><button :disabled="!ready" @click="reset">向きを戻す</button><button :disabled="!ready" @click="zoom(.2)">＋ 拡大</button><button :disabled="!ready" @click="zoom(-.2)">− 縮小</button></div><div class="asset-object-stage"><iframe ref="frame" :src="`/exhibits/${exhibit.slug}/index.html?inspect=1&hint=0&quality=low`" :title="object.label+'の立体表示'"/><div v-if="!ready" class="asset-object-loading" role="status">{{failure||'オブジェクトを準備しています…'}}</div></div><p>ドラッグで回転 · ピンチ／ホイールで拡大</p><p v-if="ready" class="asset-dimensions">寸法（幅 × 高さ × 奥行）：{{size.map(n=>n.toFixed(3)).join(' × ')}} units<span v-if="exhibit.slug.startsWith('library')"> ／ {{size.map(n=>(n*(exhibit.slug==='library-20m'?2:1)).toFixed(3)).join(' × ')}} m</span></p><p class="asset-note">元の箱庭の形状・材質を使用しています。寸法は元の配置方向の外接箱です。焼き込まれた陰影は元のシーンに準じます。図書館以外の実距離換算は未確定です。</p></main></template>
