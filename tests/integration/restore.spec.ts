import { test,expect } from '@playwright/test';
import {mkdirSync} from 'node:fs';
const evidence=process.env.EVIDENCE_DIR||'test-results/integration';mkdirSync(evidence,{recursive:true});
for(const kind of ['assets','comparison'])test(`${kind}: 解放後の履歴復元で再初期化する`,async({page})=>{
 const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
 const url=kind==='assets'?'/ja/hakoniwa/dev/assets/mesh-review':'/ja/hakoniwa/library-comparison.html?quality=low';
 await page.goto(url,{waitUntil:'domcontentloaded'});
 const waitReady=async()=>{await page.waitForFunction(()=>[...document.querySelectorAll('iframe')].length>0&&[...document.querySelectorAll('iframe')].every(f=>f.contentDocument?.querySelector('canvas[data-ready=true]')&&(f.contentWindow as any).__scene),{},{timeout:240000});if(kind==='assets')await expect(page.locator('select').nth(1)).toBeEnabled();};
 await waitReady();await expect(page.locator('meta[name=robots]')).toHaveAttribute('content','noindex, follow');
 const before=await page.locator('iframe').first().evaluate((f:any)=>f.contentWindow.__scene.scene.uuid);
 await page.screenshot({path:`${evidence}/${kind}-before.png`,fullPage:true});
 const disposed=await page.evaluate(()=>{const apps=[...document.querySelectorAll('iframe')].map(f=>(f.contentWindow as any).__scene);window.dispatchEvent(new PageTransitionEvent('pagehide',{persisted:true}));return apps.map(a=>a.renderer.getContext().isContextLost());});
 expect(disposed.every(Boolean)).toBe(true);
 // BFCacheの採用可否に左右されず復元イベントの契約を検証する。
 await Promise.all([page.waitForNavigation({waitUntil:'domcontentloaded'}),page.evaluate(()=>window.dispatchEvent(new PageTransitionEvent('pageshow',{persisted:true})))]);
 await waitReady();expect(await page.locator('iframe').first().evaluate((f:any)=>f.contentWindow.__scene.scene.uuid)).not.toBe(before);
 await page.screenshot({path:`${evidence}/${kind}-after.png`,fullPage:true});
 if(kind==='assets'){
  await page.locator('select').nth(1).selectOption({label:'pedestal-plate'});await page.getByRole('checkbox').check();expect(await page.locator('iframe').evaluate((f:any)=>{let n=0;f.contentWindow.__scene.scene.traverse((o:any)=>{if(o.isMesh&&o.visible)n++});return n})).toBe(1);
  await page.getByRole('button',{name:'全体に戻す'}).click();await page.getByRole('button',{name:'＋ 拡大'}).click();expect(await page.locator('iframe').evaluate((f:any)=>f.contentWindow.__scene.view.get().zoom)).toBeGreaterThan(1);
 }else{
  await page.locator('#zoom').fill('1.5');await page.locator('#zoom').dispatchEvent('input');
  await expect.poll(()=>page.evaluate(()=>[...document.querySelectorAll('iframe')].map(f=>(f.contentWindow as any).__scene.view.get().zoom))).toEqual([1.5,1.5]);
 }
 expect(errors).toEqual([]);
});
test('トップ・本探し・展示・404のnoindexと公開導線を維持',async({request})=>{
 for(const path of ['/ja/hakoniwa/','/ja/hakoniwa/play/library-books','/ja/hakoniwa/dev/assets','/ja/hakoniwa/library-diorama','/ja/hakoniwa/library-comparison.html','/ja/hakoniwa/future-unlisted-page']){
  const r=await request.get(path);const html=await r.text();if(path==='/ja/hakoniwa/'){expect(r.status()).toBe(200);expect(html).not.toMatch(/name="robots"[^>]*noindex/);expect(html).not.toContain('/ja/hakoniwa/dev/assets');expect(html).not.toContain('/ja/hakoniwa/play/library-books');}
  else{expect(r.status()).toBe(path==='/ja/hakoniwa/future-unlisted-page'?404:200);expect(html.includes('name="robots" content="noindex, follow"')||r.headers()['x-robots-tag']==='noindex, follow').toBe(true);}
 }
});
