import {mkdirSync} from 'node:fs';
const evidence=process.env.EVIDENCE_DIR||'test-results/assets';mkdirSync(evidence,{recursive:true});
import {test,expect} from '@playwright/test';
import {writeFileSync} from 'node:fs';
for(const slug of ['library-diorama','library-20m','nyc-diorama'])test(`${slug}: 元の全体形状・色・配置を保持`,async({page})=>{
 test.skip(!process.env.BASELINE_URL,'変更前のプレビューURLをBASELINE_URLに指定してください');
 const snapshots=[];
 for(const [label,base] of [['before',process.env.BASELINE_URL],['after',process.env.MUSEUM_URL||'http://127.0.0.1:3022']]){
  await page.goto(`${base}/exhibits/${slug}/index.html?inspect=1&hint=0&quality=low`);
  await page.waitForFunction(()=>document.querySelector('canvas[data-ready=true]')&&(window as any).__scene,null,{timeout:240000});
  snapshots.push(await page.evaluate(()=>{const scene=(window as any).__scene.scene,out:any[]=[];scene.updateMatrixWorld(true);const hash=(a:any)=>{if(!a)return null;let h=2166136261;const bytes=new Uint8Array(a.buffer,a.byteOffset,a.byteLength);for(const x of bytes)h=Math.imul(h^x,16777619);return h>>>0;};scene.traverse((o:any)=>{if(o.isMesh)out.push({name:o.name,matrix:o.matrixWorld.elements,attributes:Object.fromEntries(Object.entries(o.geometry.attributes).map(([k,v]:any)=>[k,hash(v.array)])),index:hash(o.geometry.index?.array),instance:hash(o.instanceMatrix?.array),colors:hash(o.instanceColor?.array)})});return out;}));
  if(slug==='library-diorama')await page.screenshot({path:`${evidence}/normal-library-${label}.png`});
  await page.evaluate(()=>(window as any).__disposeScene());
 }
 expect(snapshots[1]).toEqual(snapshots[0]);writeFileSync(`${evidence}/${slug}-geometry-parity.json`,JSON.stringify({matched:true,meshes:snapshots[0]},null,2));
});
