import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { shouldNoindex, withNoindexMeta } from '../../shared/indexing.ts';
import { tagStaticHtml } from '../../scripts/noindex-static.ts';
test('Layerの一覧とホストは除外し、Layerの子ルートだけnoindex',()=>{
  for(const p of ['/','/?campaign=x','/about','/404','/index.html','/ja/hakoniwa','/ja/hakoniwa/','/ja/hakoniwa/?campaign=x','/ja/hakoniwa/index.html','/ja/hakoniwa-other/page'])assert.equal(shouldNoindex(p),false,p);
  for(const p of ['/ja/hakoniwa/dev/assets','/ja/hakoniwa/new-world','/ja/hakoniwa/404','/ja/hakoniwa/exhibits/new/index.html','/ja/hakoniwa/future?q=x'])assert.equal(shouldNoindex(p),true,p);
});
test('既存indexやbot別指定との競合・重複を除きcanonicalを保持',()=>{
  const source='<html><head><meta name="robots" content="index"><META NAME="googlebot" content="index, follow"><link rel="canonical" href="https://example.com/"></head><body></body></html>';
  const result=withNoindexMeta(source);assert.equal((result.match(/name="robots"/g)||[]).length,1);assert.match(result,/noindex, follow/);assert.doesNotMatch(result,/content="index/);assert.match(result,/rel="canonical" href="https:\/\/example.com\/"/);assert.equal(withNoindexMeta(result),result);
});
test('Layer内の静的HTMLだけ処理し、ホストのHTML・404と公開一覧は書き換えない',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'museum-indexing-'));
  try {await mkdir(join(dir,'ja/hakoniwa/future'),{recursive:true});await mkdir(join(dir,'future'));const html='<html><head><title>x</title></head></html>';
    const untouched=['index.html','future/index.html','404.html','200.html','ja/hakoniwa/index.html'];
    const owned=['ja/hakoniwa/future/index.html','ja/hakoniwa/comparison.html'];
    for(const file of [...untouched,...owned])await writeFile(join(dir,file),html);
    await tagStaticHtml(dir);
    for(const file of untouched)assert.equal(await readFile(join(dir,file),'utf8'),html,file);
    for(const file of owned)assert.match(await readFile(join(dir,file),'utf8'),/noindex/,file);
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
