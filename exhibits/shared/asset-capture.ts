/** Records boundaries without adding geometry, consuming randomness or changing builder groups. */
export type AssetPart = { name:string; start?:number; count?:number; instances?:boolean; geometry?:unknown };
export const capturedAssets:Record<string,AssetPart[]> = {};
export function captureAsset<T>(id:string, builders:Array<[string,{indices:number[]}]>, run:()=>T):T {
  const starts=builders.map(([,b])=>b.indices.length);
  const result=run();
  if(!capturedAssets[id])capturedAssets[id]=builders.map(([name,b],i)=>({name,start:starts[i],count:b.indices.length-starts[i]})).filter(p=>p.count);
  return result;
}
export function captureFurniture<T>(id:string,ctx:any,run:()=>T):T {
  const first=!capturedAssets[id], books=ctx.books.length, textures=ctx.textured.length;
  const result=captureAsset(id,[['library',ctx.mb],['plants',ctx.foliage],['case-glass',ctx.clearGlass],['window-glass',ctx.glass]],run);
  if(first){
    if(ctx.books.length>books)capturedAssets[id].push({name:'books',start:books,count:ctx.books.length-books,instances:true});
    for(const t of ctx.textured.slice(textures))capturedAssets[id].push({name:t.name,geometry:t.geometry});
  }
  return result;
}
if(typeof window!=='undefined')(window as any).__assetRecords=capturedAssets;
