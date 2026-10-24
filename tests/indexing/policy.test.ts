import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { shouldNoindex, withNoindexMeta } from '../../shared/indexing.ts';
import { tagStaticHtml } from '../../scripts/noindex-static.ts';
test('トップだけ除外し、将来ルート・404・静的HTMLも既定noindex',()=>{
  for(const p of ['/','/?campaign=x'])assert.equal(shouldNoindex(p),false);
  for(const p of ['/dev/assets','/hakoniwa/new-world','/future/page','/404','/index.html','/exhibits/new/index.html','/future?q=x'])assert.equal(shouldNoindex(p),true);
});
test('既存indexやbot別指定との競合・重複を除きcanonicalを保持',()=>{
  const source='<html><head><meta name="robots" content="index"><META NAME="googlebot" content="index, follow"><link rel="canonical" href="https://example.com/"></head><body></body></html>';
  const result=withNoindexMeta(source);assert.equal((result.match(/name="robots"/g)||[]).length,1);assert.match(result,/noindex, follow/);assert.doesNotMatch(result,/content="index/);assert.match(result,/rel="canonical" href="https:\/\/example.com\/"/);assert.equal(withNoindexMeta(result),result);
});
test('将来追加の静的HTMLと生成404を処理し、トップは書き換えない',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'museum-indexing-'));
  try {await mkdir(join(dir,'future'));const html='<html><head><title>x</title></head></html>';
    for(const file of ['index.html','future/index.html','404.html','200.html'])await writeFile(join(dir,file),html);
    await tagStaticHtml(dir);assert.equal(await readFile(join(dir,'index.html'),'utf8'),html);
    for(const file of ['future/index.html','404.html','200.html'])assert.match(await readFile(join(dir,file),'utf8'),/noindex/);
  }finally{await rm(dir,{recursive:true,force:true});}
});

test("head省略の既存リダイレクトも対象", () => {
 const html='<html><meta charset="utf-8"><title>redirect</title></html>';
 assert.match(withNoindexMeta(html), /noindex, follow/);
 assert.equal(withNoindexMeta(withNoindexMeta(html)),withNoindexMeta(html));
});

test('引用符を省略したrobotsも置換し、indexとの競合を残さない',()=>{
 const result=withNoindexMeta('<html><head><meta name=robots content=index><meta name=googlebot content=index><meta name=bingbot content=index></head></html>');
 assert.doesNotMatch(result,/content=index/);assert.equal((result.match(/name="robots"/g)||[]).length,1);
});
