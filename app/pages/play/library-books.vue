<script setup lang="ts">
import type * as THREE from 'three';
useSeoMeta({ title: '図書館の本探し | MIRAI MUSEUM' });
const frame = ref<HTMLIFrameElement>();
const stage = ref<HTMLElement>();
const ready = ref(false), failed = ref(false), focused = ref(false);
const mode = ref<'view'|'playing'|'found'|'cleared'>('view');
const round = ref(0), message = ref('');
const collected = ref<string[]>([]);
// 元の10m図書館の閲覧机に置かれた、見える3冊にしおりを重ねる。
const books = [
  {id:'stars',title:'星の本',symbol:'✦',color:'#68557c',point:[-.97,1.82,.82],hint:'夜空のきらめきを集めた一冊。'},
  {id:'forest',title:'森の本',symbol:'❧',color:'#526b51',point:[.37,1.82,.8],hint:'木々と葉っぱの物語。'},
  {id:'sea',title:'海の本',symbol:'≈',color:'#4c7883',point:[1.25,1.82,.22],hint:'波の音が聞こえてくる一冊。'},
];
const positions = ref<Array<{x:number;y:number}>>([]);
const current = computed(()=>books[round.value]!);
const playing = computed(()=>mode.value!=='view');
let poll:ReturnType<typeof setInterval>|undefined, observer:ResizeObserver|undefined;
let disposed=false, focusToken=0, pointer:{x:number;y:number}|undefined, dragged=false;
type SceneApp={scene:THREE.Scene;camera:THREE.Camera;view:{get:()=>{panX:number;panY:number};set:(value:Record<string,number>,opts:{animate:boolean})=>void;reset:(opts:{animate:boolean})=>void;setEnabled:(value:boolean)=>void}};
const app=()=> (frame.value?.contentWindow as (Window & {__scene?:SceneApp})|null)?.__scene;
const nextFrame=()=>new Promise<void>(resolve=>requestAnimationFrame(()=>resolve()));
function project(){const a=app();if(!a)return [];return books.map(b=>a.scene.position.clone().set(b.point[0]!,b.point[1]!,b.point[2]!).project(a.camera));}
async function focusBooks(){
  const a=app();if(!a||!playing.value||document.hidden)return;
  const token=++focusToken;focused.value=false;a.view.setEnabled(false);
  const width=stage.value?.clientWidth||362;
  const zoom=width<650?Math.min(4,3.2*362/Math.min(width,362)):2.8;
  a.view.set({azimuth:0,elevation:62,zoom,panX:0,panY:0},{animate:false});
  await nextFrame();await nextFrame();if(disposed||token!==focusToken||!playing.value)return;
  const pts=project();const center=pts.reduce((v,p)=>({x:v.x+p.x/pts.length,y:v.y+p.y/pts.length}),{x:0,y:0});
  // 投影中心を机に合わせる。画面幅が変わっても同じ本が選べる。
  a.view.set({panX:-center.x,panY:-center.y},{animate:false});
  await nextFrame();await nextFrame();if(disposed||token!==focusToken||!playing.value)return;
  positions.value=project().map(p=>({x:(p.x+1)*50,y:(1-p.y)*50}));focused.value=true;
}
function start(){round.value=0;collected.value=[];message.value='';mode.value='playing';void focusBooks();}
function choose(id:string,event:MouseEvent){
  if(mode.value!=='playing'||!focused.value||collected.value.includes(id)||(event.detail!==0&&dragged))return;
  if(id!==current.value.id){message.value='別の本みたい。もう一度。';return;}
  collected.value.push(id);message.value=`${current.value.title}、見つけました。`;
  mode.value=collected.value.length===books.length?'cleared':'found';
}
function next(){round.value++;message.value='';mode.value='playing';}
function leave(){focusToken++;focused.value=false;mode.value='view';message.value='';app()?.view.setEnabled(true);app()?.view.reset({animate:false});}
function pointerDown(e:PointerEvent){pointer={x:e.clientX,y:e.clientY};dragged=false;}
function pointerCancel(){dragged=true;pointer=undefined;}
function pointerUp(e:PointerEvent){if(pointer)dragged=Math.hypot(e.clientX-pointer.x,e.clientY-pointer.y)>10;pointer=undefined;}
function visibility(){if(!document.hidden&&playing.value)void focusBooks();}
function dispose(){if(disposed)return;disposed=true;focusToken++;clearInterval(poll);observer?.disconnect();document.removeEventListener('visibilitychange',visibility);window.removeEventListener('pagehide',dispose);(frame.value?.contentWindow as (Window & {__disposeScene?:()=>void})|null)?.__disposeScene?.();}
function restore(e:PageTransitionEvent){if(e.persisted)location.reload();}
onMounted(()=>{
  const began=Date.now();poll=setInterval(()=>{
    const doc=frame.value?.contentDocument;
    if(doc?.querySelector('#scene[data-ready="true"]')&&app()){ready.value=true;clearInterval(poll);}
    else if(doc?.querySelector('#scene-message:not([hidden])')||Date.now()-began>240000){failed.value=true;clearInterval(poll);}
  },300);
  observer=new ResizeObserver(()=>{if(playing.value)void focusBooks();});if(stage.value)observer.observe(stage.value);
  document.addEventListener('visibilitychange',visibility);window.addEventListener('pagehide',dispose);window.addEventListener('pageshow',restore);
});
onBeforeUnmount(()=>{dispose();window.removeEventListener('pageshow',restore);});
</script>
<template>
  <main class="book-hunt">
    <header><NuxtLink to="/hakoniwa/library-diorama" class="brand"><MuseumBrand /></NuxtLink><span class="edition">小さな図書館のあそび</span></header>
    <div class="heading"><div><p class="eyebrow">A LITTLE DISCOVERY</p><h1>物語を、見つけよう。</h1></div><button v-if="playing" class="quiet" @click="leave">箱庭を眺める</button></div>
    <section ref="stage" class="stage" :class="{playing}" :aria-busy="!ready">
      <iframe ref="frame" src="/exhibits/library-diorama/index.html?inspect=1&hint=0&quality=low" title="10m図書館の箱庭" :tabindex="playing?-1:0"/>
      <div v-if="!ready" class="loading" role="status">{{failed?'図書館を開けませんでした。再読み込みしてください。':'図書館の明かりを灯しています…'}}</div>
      <div v-if="playing && focused" class="bookmarks" aria-label="机の上の3冊">
        <button v-for="(book,i) in books" :key="book.id" class="book" :data-book="book.id" :aria-label="book.title" :disabled="mode!=='playing'||collected.includes(book.id)" :class="{collected:collected.includes(book.id)}" :style="{left:positions[i]?.x+'%',top:positions[i]?.y+'%', '--cover':book.color}" @pointerdown="pointerDown" @pointerup="pointerUp" @pointercancel="pointerCancel" @click="choose(book.id,$event)"><span class="symbol">{{book.symbol}}</span><span class="book-title">{{book.title}}</span><span v-if="collected.includes(book.id)" class="seal">✓</span></button>
      </div>
    </section>
    <section class="game-bar" aria-label="本探し">
      <template v-if="mode==='view'"><div><h2>しおりの本探し</h2><p>ヒントをたよりに、机の上の3冊をタップ。</p></div><button class="primary" :disabled="!ready" @click="start">本を探す <span>→</span></button></template>
      <template v-else-if="mode==='cleared'"><div role="status"><p class="progress">3 / 3 冊</p><h2>3つの物語が、そろいました。</h2><p>小さな図書館に、また会いに。</p></div><button class="primary" @click="start">もう一度あそぶ</button></template>
      <template v-else><div><p class="progress">{{collected.length}} / 3 冊</p><h2>{{current.hint}}</h2><p class="feedback" role="status" aria-live="polite">{{message || 'しおりのついた本をタップ。'}}</p></div><button v-if="mode==='found'" class="primary" @click="next">次のヒント →</button></template>
    </section>
  </main>
</template>
<style scoped>
.book-hunt{max-width:1100px;margin:auto;padding:25px 28px 40px;color:#4e4538;font-family:system-ui,sans-serif}header{display:flex;justify-content:space-between;align-items:center;gap:16px;border-bottom:1px solid #d8cdbd;padding-bottom:20px}.brand{font-family:serif;letter-spacing:.18em;font-size:14px;color:inherit;text-decoration:none}.edition,.eyebrow{color:#8a7b65;font-size:11px;letter-spacing:.12em}.heading{display:flex;align-items:center;justify-content:space-between;margin:26px 0 20px;gap:15px}h1{font-family:serif;font-weight:400;font-size:30px;margin:8px 0 0}.stage{position:relative;height:560px;border:1px solid #d8cdbd;border-radius:12px;overflow:hidden;background:#fae8d4}iframe{display:block;width:100%;height:100%;border:0}.playing iframe{pointer-events:none}.loading{position:absolute;inset:0;display:grid;place-content:center;background:#fae8d4;font-size:13px;padding:20px}.bookmarks{position:absolute;inset:0;pointer-events:none}.book{position:absolute;transform:translate(-50%,-50%) rotate(-5deg);pointer-events:auto;touch-action:manipulation;width:58px;min-height:72px;border:1px solid #d7bb84;border-left:5px solid #453c31;border-radius:3px 6px 6px 3px;background:var(--cover);color:#f3ddb2;box-shadow:3px 5px 9px #3a261c40, inset 0 0 0 3px #d8bb773b;cursor:pointer;padding:6px 3px;transition:box-shadow .15s}.symbol{display:block;font:30px/1 serif}.book-title{font-size:10px;letter-spacing:.05em;display:block;margin-top:6px}.book:hover:not(:disabled){box-shadow:0 0 0 4px #f6dda2,3px 5px 9px #3a261c40}.book:focus-visible{outline:3px solid #e0b85d;outline-offset:5px}.book:disabled{cursor:default}.book.collected{filter:saturate(.5);opacity:.75}.seal{position:absolute;right:-10px;top:-9px;background:#faf1dd;color:#546346;border:1px solid #9f9c78;border-radius:50%;width:24px;height:24px;display:grid;place-content:center}.game-bar{display:flex;justify-content:space-between;align-items:center;gap:22px;padding:23px 4px;min-height:132px}h2{font-family:serif;font-size:20px;font-weight:400;margin:5px 0}p{font-size:13px;line-height:1.6;margin:7px 0;color:#80715f}.progress{font-size:11px;letter-spacing:.15em;color:#8d7e66}.feedback{min-height:21px}.primary,.quiet{font:inherit;cursor:pointer;border:1px solid #b8a789;border-radius:6px;padding:13px 20px;white-space:nowrap;background:#5d5949;color:#fff8e9;font-size:13px}.primary:disabled{opacity:.5;cursor:wait}.primary span{margin-left:20px}.quiet{padding:9px 13px;background:#fff9ee;color:#6d604d}.primary:focus-visible,.quiet:focus-visible{outline:3px solid #b99147;outline-offset:3px}@media(max-width:650px){.book-hunt{padding:18px 14px 28px}header{padding-bottom:15px}.edition{display:none}.heading{margin:20px 0 16px;align-items:flex-end}h1{font-size:24px}.eyebrow{font-size:9px}.quiet{font-size:11px;padding:9px}.stage{height:440px}.game-bar{align-items:flex-start;flex-direction:column;gap:10px;padding:18px 4px}.game-bar h2{font-size:18px}.primary{align-self:flex-end}.book{width:52px;min-height:66px}.symbol{font-size:26px}}
</style>
