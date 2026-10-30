import { test, expect } from '@playwright/test';
import { mkdirSync } from 'node:fs';
const evidence=process.env.EVIDENCE_DIR||'test-results/book-hunt';mkdirSync(evidence,{recursive:true});
test('開始・誤答・正答・クリア・再挑戦・鑑賞復帰・タブ復帰・解放',async({page,context},info)=>{
  const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
  const response=await page.goto('/ja/hakoniwa/play/library-books',{waitUntil:'domcontentloaded'});expect(response?.status()).toBe(200);
  await expect(page.locator('meta[name=robots]')).toHaveAttribute('content','noindex, follow');
  const start=page.getByRole('button',{name:'本を探す'});await expect(start).toBeEnabled({timeout:180000});
  const frame=page.frames().find(f=>f.url().includes('/ja/hakoniwa/exhibits/'))!;expect(frame.url()).toContain('/library-diorama/');
  await page.screenshot({path:`${evidence}/${info.project.name}-view.png`,fullPage:true});
  const tap=async(selector:string)=>{const locator=page.locator(selector);if(info.project.name.includes('mobile'))await locator.tap();else await locator.click();};
  await start.click();await expect(page.locator('[data-book]')).toHaveCount(3);
  const stage=(await page.locator('.stage').boundingBox())!;
  const bounds=await page.locator('[data-book]').evaluateAll(els=>els.map(e=>{const b=e.getBoundingClientRect();return{x:b.x,y:b.y,width:b.width,height:b.height}}));
  for(const b of bounds){expect(b.width).toBeGreaterThanOrEqual(44);expect(b.height).toBeGreaterThanOrEqual(44);expect(b.x).toBeGreaterThan(stage.x);expect(b.x+b.width).toBeLessThan(stage.x+stage.width);expect(b.y).toBeGreaterThan(stage.y);expect(b.y+b.height).toBeLessThan(stage.y+stage.height);}
  for(let i=0;i<bounds.length;i++)for(let j=i+1;j<bounds.length;j++){const a=bounds[i]!,b=bounds[j]!;expect(a.x+a.width<=b.x||b.x+b.width<=a.x||a.y+a.height<=b.y||b.y+b.height<=a.y).toBe(true);}
  await page.screenshot({path:`${evidence}/${info.project.name}-play.png`,fullPage:true});
  const view=await frame.evaluate(()=>(window as any).__scene.view.get());
  const box=bounds[0]!;const x=box.x+box.width/2,y=box.y+box.height/2;
  if(info.project.name.includes('mobile')){const session=await context.newCDPSession(page);await session.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x,y,id:1}]});await session.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:x+40,y:y+20,id:1}]});await session.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await session.detach();}
  else{await page.mouse.move(x,y);await page.mouse.down();await page.mouse.move(x+40,y+20,{steps:4});await page.mouse.up();}
  await expect(page.locator('.progress')).toHaveText('0 / 3 冊');expect(await frame.evaluate(()=>(window as any).__scene.view.get())).toEqual(view);
  await tap('[data-book=forest]');await expect(page.getByRole('status')).toHaveText('別の本みたい。もう一度。');await expect(page.locator('.progress')).toHaveText('0 / 3 冊');
  await tap('[data-book=stars]');await expect(page.locator('.progress')).toHaveText('1 / 3 冊');await expect(page.locator('[data-book=stars]')).toBeDisabled();
  const other=await context.newPage();await other.goto('about:blank');await page.bringToFront();await other.close();
  // OSの可視状態に依存せず、visibilitychange後も選択状態を保持することも確認。
  await page.evaluate(()=>{Object.defineProperty(document,'hidden',{configurable:true,value:true});document.dispatchEvent(new Event('visibilitychange'));Object.defineProperty(document,'hidden',{configurable:true,value:false});document.dispatchEvent(new Event('visibilitychange'));});
  await expect(page.locator('[data-book]')).toHaveCount(3);await expect(page.locator('.progress')).toHaveText('1 / 3 冊');
  await page.getByRole('button',{name:'次のヒント'}).click();await tap('[data-book=forest]');await page.getByRole('button',{name:'次のヒント'}).click();await tap('[data-book=sea]');
  await expect(page.getByText('3つの物語が、そろいました。')).toBeVisible();await expect(page.locator('.progress')).toHaveText('3 / 3 冊');await page.screenshot({path:`${evidence}/${info.project.name}-clear.png`,fullPage:true});
  await page.getByRole('button',{name:'もう一度あそぶ'}).click();await expect(page.locator('.progress')).toHaveText('0 / 3 冊');await expect(page.locator('[data-book=stars]')).toBeEnabled();
  await page.getByRole('button',{name:'箱庭を眺める'}).click();await expect(page.locator('[data-book]')).toHaveCount(0);await expect(start).toBeEnabled();expect(await frame.evaluate(()=>(window as any).__scene.view.get().zoom)).toBe(1);
  const canvas=page.frameLocator('iframe').locator('canvas');await canvas.press('ArrowRight');await expect.poll(()=>frame.evaluate(()=>(window as any).__scene.view.get().azimuth)).not.toBe(22);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth)).toBe(false);
  await page.evaluate(()=>{const f=document.querySelector('iframe')!,w=f.contentWindow as any;const old=w.__disposeScene;(window as any).__disposed=false;w.__disposeScene=()=>{old();(window as any).__disposed=w.__scene.renderer.getContext().isContextLost();};window.dispatchEvent(new PageTransitionEvent('pagehide'));});
  expect(await page.evaluate(()=>(window as any).__disposed)).toBe(true);expect(errors).toEqual([]);
});
