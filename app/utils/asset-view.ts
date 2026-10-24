import type { AssetKind } from '~/data/asset-catalog';
export function showAsset(win:any,kind:AssetKind):{size:number[];parts:number;dispose:()=>void} { return win.__showAsset(kind); }
