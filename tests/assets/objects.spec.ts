import {mkdirSync} from 'node:fs';
const evidence=process.env.EVIDENCE_DIR||'test-results/assets';mkdirSync(evidence,{recursive:true});
import {test,expect} from '@playwright/test';
import {assetCatalog} from '../../data/asset-catalog';
for(const exhibit of assetCatalog)test(`${exhibit.slug}: 実物の範囲・単体表示`,async({page})=>{
 const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto(`/ja/hakoniwa/dev/assets/${exhibit.slug}/${exhibit.objects[0]!.id}`);
 await expect(page.getByRole('button',{name:'向きを戻す'})).toBeEnabled({timeout:240000});
 const inventory=await page.locator('iframe').evaluate((f:any)=>{const w=f.contentWindow,names:string[]=[];w.__scene.scene.traverse((o:any)=>{if(o.isMesh&&o.parent.name!=='asset-inspection')names.push(o.name)});return {names,captures:Object.keys(w.__assetRecords||{}),visible:w.__scene.scene.getObjectByName('asset-inspection').children.map((o:any)=>({name:o.name,count:o.isInstancedMesh?o.count:1}))}});
 for(const o of exhibit.objects)expect(o.capture?inventory.captures.includes(o.id):o.names!.some(n=>inventory.names.includes(n)),o.id).toBe(true);
 const inspected=await page.locator('iframe').evaluate((f:any,kinds)=>{const w=f.contentWindow;const results=kinds.map(kind=>{const selected=w.__showAsset(kind);return {id:kind.id,size:selected.size,parts:selected.parts};});w.__showAsset(kinds[0]);return results;},exhibit.objects);
 for(const item of inspected){expect(item.parts,item.id).toBeGreaterThan(0);expect(item.size.every((n:number)=>Number.isFinite(n)&&n>0),item.id).toBe(true);}
 expect(inventory.visible.length).toBeGreaterThan(0);if(!exhibit.objects[0]!.capture)expect(inventory.visible.every((o:{count:number})=>o.count===1)).toBe(true);
 await expect(page.locator('.asset-dimensions')).not.toContainText('NaN');
 expect(errors).toEqual([]);await page.waitForTimeout(200);
 await page.screenshot({path:`${evidence}/${exhibit.slug}-pc.png`,fullPage:true});
 await page.getByRole('button',{name:'＋ 拡大'}).click();expect(await page.locator('iframe').evaluate((f:any)=>f.contentWindow.__scene.view.get().zoom)).toBeGreaterThan(1);
 await page.setViewportSize({width:390,height:844});await page.waitForTimeout(300);
 await page.screenshot({path:`${evidence}/${exhibit.slug}-mobile.png`,fullPage:true});
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 await page.evaluate(()=>{(window as any).oldScene=(document.querySelector('iframe') as any).contentWindow.__scene});
 await page.getByRole('link',{name:`← ${exhibit.title}の一覧`}).click();await expect(page.locator('iframe')).toHaveCount(0);
 expect(await page.evaluate(()=>(window as any).oldScene.renderer.getContext().isContextLost())).toBe(true);
 expect(errors).toEqual([]);
});
test('直リンク・404・検索除外・一覧導線',async({request,page})=>{
 for(const p of ['/ja/hakoniwa/dev/assets','/ja/hakoniwa/dev/assets/library-diorama','/ja/hakoniwa/dev/assets/library-diorama/chair','/ja/hakoniwa/dev/assets/unknown','/ja/hakoniwa/dev/assets/library-diorama/unknown']){const r=await request.get(p);expect(r.status()).toBe(p.includes('unknown')?404:200);expect((await r.text()).includes('noindex')||r.headers()['x-robots-tag']==='noindex, follow').toBe(true);}
 await page.goto('/ja/hakoniwa/dev/assets');await page.screenshot({path:`${evidence}/catalog-pc.png`,fullPage:true});await page.setViewportSize({width:390,height:844});await page.screenshot({path:`${evidence}/catalog-mobile.png`,fullPage:true});await page.getByRole('link',{name:'図書館 18種類をみる →',exact:true}).click();await page.getByRole('link',{name:'ラウンジチェア 回してみる →',exact:true}).click();await expect(page).toHaveURL(/armchair$/);
});
