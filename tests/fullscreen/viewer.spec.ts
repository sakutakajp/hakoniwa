import {test,expect} from '@playwright/test';
import {mkdirSync} from 'node:fs';
const evidence=process.env.EVIDENCE_DIR||'test-results/fullscreen';mkdirSync(evidence,{recursive:true});
for(const device of ['desktop','mobile'])test(`${device}: 全画面・操作・ヘッダー・復帰`,async({browser})=>{
 const mobile=device==='mobile',context=await browser.newContext({viewport:mobile?{width:390,height:844}:{width:1440,height:1000},isMobile:mobile,hasTouch:mobile,deviceScaleFactor:mobile?2:1,reducedMotion:'reduce'}),page=await context.newPage();const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto(`${process.env.MUSEUM_URL||'http://127.0.0.1:3023'}/ja/hakoniwa/${mobile?'sand-pedestal':'library-diorama'}?inspect=1&quality=low`);
 await page.waitForFunction(()=>document.querySelector('iframe')?.contentDocument?.querySelector('canvas[data-ready=true]'),null,{timeout:240000});await expect(page.locator('.loading-note')).toHaveCount(0);
 await page.evaluate(()=>document.fonts.ready);expect(await page.evaluate(()=>document.fonts.check('500 17px "Hakoniwa M PLUS Rounded 1c"','MIRAI MUSEUM'))).toBe(true);
 const dimensions=()=>page.evaluate(()=>{const r=document.querySelector('iframe')!.getBoundingClientRect();return {x:r.x,y:r.y,w:r.width,h:r.height,vw:innerWidth,vh:innerHeight,scroll:document.documentElement.scrollHeight,body:document.body.classList.contains('hakoniwa-immersive-view')}});
 let d=await dimensions();expect(d.x).toBe(0);expect(d.y).toBe(0);expect(d.w).toBe(d.vw);expect(d.h).toBe(d.vh);expect(d.scroll).toBeLessThanOrEqual(d.vh);expect(d.body).toBe(true);
 const before=await page.locator('iframe').evaluate((f:any)=>f.contentWindow.__scene.view.get());
 if(mobile){const cdp=await context.newCDPSession(page);await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:150,y:420}]});for(let i=1;i<=8;i++)await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:150+i*10,y:420}]});await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});}
 else{await page.mouse.move(620,510);await page.mouse.down();await page.mouse.move(760,540,{steps:10});await page.mouse.up();}
 await expect.poll(()=>page.locator('iframe').evaluate((f:any)=>f.contentWindow.__scene.view.get().azimuth)).not.toBe(before.azimuth);
 await page.locator('iframe').evaluate((f:any)=>f.contentWindow.__scene.view.reset({animate:false}));await page.waitForTimeout(300);await page.screenshot({path:`${evidence}/fullscreen-${device}.png`});
 await page.getByText('操作・箱庭',{exact:true}).click();await expect(page.getByRole('navigation',{name:'箱庭を選ぶ'})).toBeVisible();await page.screenshot({path:`${evidence}/menu-${device}.png`});await page.keyboard.press('Escape');await expect(page.locator('.viewer-menu')).not.toHaveAttribute('open','');
 if(mobile){await page.setViewportSize({width:844,height:390});await page.waitForTimeout(300);d=await dimensions();expect(d.h).toBe(d.vh);expect(d.scroll).toBeLessThanOrEqual(d.vh);await page.screenshot({path:`${evidence}/fullscreen-landscape.png`});await page.setViewportSize({width:390,height:700});await page.waitForTimeout(100);d=await dimensions();expect(d.h).toBe(700);}
 await page.evaluate(()=>{(window as any).oldScene=(document.querySelector('iframe') as any).contentWindow.__scene});await page.getByRole('link',{name:'展示室にもどる',exact:true}).click();await expect(page.locator('iframe')).toHaveCount(0);expect(await page.evaluate(()=>(window as any).oldScene.renderer.getContext().isContextLost())).toBe(true);await expect(page.locator('body')).not.toHaveClass(/hakoniwa-immersive-view/);expect(await page.evaluate(()=>document.documentElement.scrollHeight>innerHeight)).toBe(true);
 await page.evaluate(()=>document.fonts.ready);await page.screenshot({path:`${evidence}/header-${device}.png`,fullPage:true});expect(await page.locator('.brand-name').first().textContent()).toBe('MIRAI MUSEUM');expect(await page.evaluate(()=>performance.getEntriesByType('resource').filter((x:any)=>x.name.includes('/fonts/')).length)).toBe(1);expect(errors).toEqual([]);await context.close();
});
test('全5ルートとオブジェクト画面の分離',async({page,request})=>{
 await page.route('**/exhibits/**',route=>route.fulfill({status:200,contentType:'text/html',body:'<canvas id="scene" data-ready="true"></canvas>'}));
 for(const slug of ['sand-pedestal','nyc-diorama','library-diorama','dino-diorama','electric-town-diorama']){await page.goto(`/ja/hakoniwa/${slug}`);await expect(page.locator('.fullscreen-room')).toHaveCount(1);expect(await page.locator('iframe').evaluate(e=>e.getBoundingClientRect().height===innerHeight)).toBe(true);}
 await page.goto('/ja/hakoniwa/dev/assets/library-diorama/chair');await expect(page.locator('.fullscreen-room')).toHaveCount(0);await expect(page.locator('.asset-browser')).toHaveCount(1);expect((await request.get('/ja/hakoniwa/unknown')).status()).toBe(404);
});
