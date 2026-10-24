import {mkdirSync} from 'node:fs';
const evidence=process.env.EVIDENCE_DIR||'test-results/assets';mkdirSync(evidence,{recursive:true});
import {test,expect} from '@playwright/test';
test('スマホの椅子: タッチ回転・拡大・履歴復元',async({browser})=>{
 const context=await browser.newContext({viewport:{width:390,height:844},deviceScaleFactor:3,isMobile:true,hasTouch:true});const page=await context.newPage();const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto(`${process.env.MUSEUM_URL||'http://127.0.0.1:3021'}/ja/hakoniwa/dev/assets/library-diorama/chair`);const ready=()=>expect(page.getByRole('button',{name:'向きを戻す'})).toBeEnabled({timeout:240000});await ready();
 const getView=()=>page.locator('iframe').evaluate((f:any)=>f.contentWindow.__scene.view.get());const before=await getView();const bounds=(await page.locator('iframe').boundingBox())!;const cdp=await context.newCDPSession(page);const x=bounds.x+bounds.width*.4,y=bounds.y+bounds.height*.5;
 await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x,y}]});for(let i=1;i<=8;i++)await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:x+i*10,y:y+i*2}]});await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await expect.poll(async()=>(await getView()).azimuth).not.toBe(before.azimuth);
 await page.getByRole('button',{name:'＋ 拡大'}).tap();await expect.poll(async()=>(await getView()).zoom).toBeGreaterThan(1);await page.screenshot({path:`${evidence}/chair-touch-mobile.png`,fullPage:true});
 const old=await page.locator('iframe').evaluate((f:any)=>f.contentWindow.__scene.scene.uuid);await page.evaluate(()=>window.dispatchEvent(new PageTransitionEvent('pagehide',{persisted:true})));await Promise.all([page.waitForNavigation(),page.evaluate(()=>window.dispatchEvent(new PageTransitionEvent('pageshow',{persisted:true})))]);await ready();expect(await page.locator('iframe').evaluate((f:any)=>f.contentWindow.__scene.scene.uuid)).not.toBe(old);expect(errors).toEqual([]);await context.close();
});
