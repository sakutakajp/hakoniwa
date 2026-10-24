<script setup lang="ts">
import type * as THREE from 'three';
import { exhibits } from '#hakoniwa/data/exhibits';
useSeoMeta({ title: 'アセット確認 | MIRAI MUSEUM' });
const options = [...exhibits.map(e => ({ slug: e.slug, title: e.title })), { slug: 'library-20m', title: '図書館20m · 比較試作' }];
const selected = ref('library-20m');
const frame = ref<HTMLIFrameElement>();
const ready = ref(false), failure = ref('');
const component = ref('');
const solo = ref(false);
const revision = ref(0);
const parts = ref<Array<{id:string;name:string;size:number[];instances:number;vertices:number}>>([]);
let timer: ReturnType<typeof setInterval> | undefined;
let started = 0;
let visibility = new Map<string, boolean>();
type SceneApp = { scene: THREE.Scene; renderer: THREE.WebGLRenderer; requestRender?: () => void; view: { get: () => Record<string, number>; set: (value: Record<string, number>, options?: {animate:boolean}) => void; reset: (options?: {animate:boolean}) => void } };
const app = () => (frame.value?.contentWindow as (Window & {__scene?:SceneApp}) | null)?.__scene;
const isLibrary = computed(() => selected.value.startsWith('library'));
const scale = computed(() => selected.value === 'library-20m' ? {factor:2,label:'20m四方 · 比較試作の設定'} : selected.value === 'library-diorama' ? {factor:1,label:'10m四方 · 現行の基準'} : {factor:null,label:'4段階規格への割当は未確定'});
const picked = computed(() => parts.value.find(p => p.id === component.value));
const source = computed(() => `/ja/hakoniwa/exhibits/${selected.value}/index.html?inspect=1&hint=0&quality=low`);
const provenance = computed(() => {
  if (!picked.value) return '展示シーンの組み立て';
  if (!isLibrary.value) return '展示シーン内で生成された部品';
  const map:Record<string,string> = { library:'図書館の壁・棚・家具・回廊・階段（結合メッシュ）', 'pedestal-plate':'台座', 'window-glass':'窓ガラス', 'case-glass':'展示ケースのガラス', plants:'室内の植栽', 'marble-floor':'大理石の床', 'gallery-deck':'回廊の床', rug:'敷物', globe:'地球儀', celestial:'天球儀' };
  return map[picked.value.name] || '図書館シーン内で生成された部品';
});
function dispose() {
  clearInterval(timer);
  (frame.value?.contentWindow as (Window & {__disposeScene?:()=>void}) | null)?.__disposeScene?.();
  visibility = new Map();
}
function refreshParts() {
  const a=app(); if(!a)return;
  a.scene.updateMatrixWorld(true);
  const found:typeof parts.value=[];
  a.scene.traverse(object=>{
    const mesh=object as THREE.Mesh;
    if(!mesh.isMesh || !mesh.geometry)return;
    let box: THREE.Box3 | null;
    if((mesh as THREE.InstancedMesh).isInstancedMesh){const inst=mesh as THREE.InstancedMesh;inst.computeBoundingBox();box=inst.boundingBox?.clone()??null;}
    else {mesh.geometry.computeBoundingBox();box=mesh.geometry.boundingBox?.clone()??null;}
    if(!box || box.isEmpty())return;
    box.applyMatrix4(mesh.matrixWorld);
    found.push({id:mesh.uuid,name:mesh.name||`${mesh.type} #${found.length+1}`,size:[box.max.x-box.min.x,box.max.y-box.min.y,box.max.z-box.min.z],instances:(mesh as THREE.InstancedMesh).isInstancedMesh?(mesh as THREE.InstancedMesh).count:1,vertices:mesh.geometry.attributes.position?.count ?? 0});
    visibility.set(mesh.uuid,mesh.visible);
  });parts.value=found;
}
function startPolling(){started=Date.now();clearInterval(timer);timer=setInterval(()=>{
  const doc=frame.value?.contentDocument;
  if(doc?.querySelector('#scene[data-ready="true"]')&&app()){ready.value=true;refreshParts();clearInterval(timer);}
  else if(doc?.querySelector('#scene-message:not([hidden])')){failure.value='この環境ではシーンを初期化できませんでした。';clearInterval(timer);}
  else if(Date.now()-started>240000){failure.value='準備に時間がかかっています。再読込してください。';clearInterval(timer);}
},300);}
async function change(){dispose();ready.value=false;failure.value='';component.value='';solo.value=false;parts.value=[];revision.value++;await nextTick();startPolling();}
function redraw(){const a=app();if(!a)return;if(a.requestRender)a.requestRender();else a.view.set(a.view.get(),{animate:false});}
function isolate(){const a=app();if(!a||!isLibrary.value)return;a.scene.traverse(o=>{if(visibility.has(o.uuid))o.visible=solo.value&&component.value?o.uuid===component.value:visibility.get(o.uuid)!;});redraw();}
watch(component,()=>{solo.value=false;isolate();});
function reset(){solo.value=false;isolate();app()?.view.reset({animate:false});}
function zoom(amount:number){const a=app();if(a)a.view.set({zoom:Math.max(.7,Math.min(3,(a.view.get().zoom||1)+amount))},{animate:false});}
function restore(event:PageTransitionEvent){if(event.persisted)location.reload();}
onMounted(()=>{startPolling();window.addEventListener('pagehide',dispose);window.addEventListener('pageshow',restore);});
onBeforeUnmount(()=>{dispose();window.removeEventListener('pagehide',dispose);window.removeEventListener('pageshow',restore);});
const fmt=(values:number[],factor=1)=>values.map(v=>(v*factor).toFixed(3)).join(' × ');
</script>
<template>
  <main class="asset-review">
    <header><div><p class="eyebrow">MIRAI MUSEUM · ASSET REVIEW</p><h1>アセット確認</h1><p>シーンと実際の部品を選び、形・大きさ・縮尺を確認します。</p></div><a href="/ja/hakoniwa/library-comparison.html?quality=low">図書館10m／20m比較 →</a></header>
    <div class="review-layout"><aside>
      <label>展示<select v-model="selected" @change="change"><option v-for="o in options" :key="o.slug" :value="o.slug">{{o.title}}</option></select></label>
      <label>生成された部品<select v-model="component" :disabled="!ready"><option value="">シーン全体</option><option v-for="p in parts" :key="p.id" :value="p.id">{{p.name}}</option></select></label>
      <label v-if="isLibrary && picked" class="check"><input v-model="solo" type="checkbox" @change="isolate">選んだメッシュだけを見る</label>
      <p class="status" role="status">{{failure || (ready ? `${parts.length}個の実メッシュを確認できます` : '図書館・箱庭を準備しています…')}}</p>
      <dl><dt>生成元</dt><dd>{{provenance}}</dd><dt>縮尺</dt><dd>{{scale.label}}</dd>
        <template v-if="picked"><dt>ワールド寸法 X × Y × Z</dt><dd>{{fmt(picked.size)}} units</dd><dt>実距離換算</dt><dd>{{scale.factor ? fmt(picked.size,scale.factor)+' m' : '未確定のため換算しません'}}</dd><dt>インスタンス数／元形状の頂点数</dt><dd>{{picked.instances}} ／ {{picked.vertices.toLocaleString()}}</dd></template>
        <template v-else><dt>台座の基準幅</dt><dd>10 units（既存設定）</dd></template>
      </dl>
      <p class="note">寸法は現在の配置を含むワールド軸に沿った外接箱です。InstancedMeshは全配置の範囲を計測します。</p>
      <p class="note">図書館のlibraryは壁・棚・家具・階段を結合したメッシュです。机単体の独立モデルではありません。単独表示でも焼き込まれた陰影は元のシーンのままです。</p>
    </aside><section><div class="review-toolbar"><button :disabled="!ready" @click="reset">全体に戻す</button><button :disabled="!ready" @click="zoom(.2)">＋ 拡大</button><button :disabled="!ready" @click="zoom(-.2)">− 縮小</button><span>ドラッグで回転 · ピンチ／ホイールで拡大</span></div><div class="review-stage"><iframe :key="revision" ref="frame" :src="source" :title="selected+' アセット確認'"/><div v-if="!ready" class="review-loading">{{failure || '小さな世界を準備しています…'}}</div></div><p class="note">URLを知っている方はどなたでも閲覧できます。表示は軽量品質です。</p></section></div>
  </main>
</template>
<style scoped>
.asset-review{max-width:1480px;margin:auto;padding:30px;background:#f7f1e7;min-height:100vh;color:#453c32;font-family:system-ui,sans-serif}header{display:flex;justify-content:space-between;align-items:center;gap:24px;margin-bottom:25px}h1{font-family:serif;font-size:30px;font-weight:500;margin:8px 0}p{font-size:14px;line-height:1.7}a{color:inherit;font-size:14px}.review-layout{display:grid;grid-template-columns:300px 1fr;gap:24px}aside{border:1px solid #d6c9b5;border-radius:10px;padding:18px;background:#fcf8ef}label{display:block;font-size:13px;margin-bottom:18px}select{display:block;width:100%;padding:10px;margin-top:8px;background:#fffcf5;border:1px solid #b9ad98;border-radius:5px;color:inherit}label.check{display:flex;align-items:center;gap:8px}dt{font-size:12px;color:#81735d;margin-top:18px}dd{font-size:13px;margin:6px 0;overflow-wrap:anywhere;line-height:1.6}.status{font-size:12px}.note{font-size:12px;color:#786c5b}.review-toolbar{display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-bottom:12px}button{padding:10px 15px;border:1px solid #b9ad98;border-radius:5px;background:#fffaf0;color:inherit;cursor:pointer}.review-toolbar span{font-size:12px}.review-stage{height:600px;background:#fae8d4;position:relative;border-radius:10px;overflow:hidden}iframe{width:100%;height:100%;border:0}.review-loading{position:absolute;inset:0;display:grid;place-content:center;background:#fae8d4;font-size:13px}@media(max-width:800px){.asset-review{padding:18px 14px}header{align-items:flex-start;flex-direction:column;gap:6px}.review-layout{display:flex;flex-direction:column}aside{order:2}.review-stage{height:440px}h1{font-size:25px}}
</style>
