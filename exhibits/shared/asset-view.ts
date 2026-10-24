import * as THREE from 'three';
type AssetKind={id:string;names?:string[];capture?:boolean};
type Part={name:string;start?:number;count?:number;instances?:boolean;geometry?:THREE.BufferGeometry};
export function showAsset(win:any,kind:AssetKind){
 const a=win.__scene, scene=a.scene as THREE.Scene, renderer=a.renderer as THREE.WebGLRenderer;
 scene.updateMatrixWorld(true);
 const parts:Part[]=kind.capture?win.__assetRecords?.[kind.id]||[]:(kind.names||[]).map(name=>({name}));
 const originals:THREE.Mesh[]=[];scene.traverse(o=>{if((o as THREE.Mesh).isMesh)originals.push(o as THREE.Mesh)});
 const group=new THREE.Group();group.name='asset-inspection';
 for(const p of parts){
  const source=originals.find(o=>o.name===p.name&&(!p.geometry||o.geometry===p.geometry));if(!source)continue;
  let geo=source.geometry.clone();let mesh:THREE.Mesh;
  if((source as THREE.InstancedMesh).isInstancedMesh){
   const src=source as THREE.InstancedMesh,start=p.instances?p.start||0:0,count=p.instances?p.count||1:1;
   for(const[name,attr]of Object.entries(geo.attributes)){if((attr as THREE.InstancedBufferAttribute).isInstancedBufferAttribute){const ar=attr as THREE.InstancedBufferAttribute;geo.setAttribute(name,new THREE.InstancedBufferAttribute(ar.array.slice(start*ar.itemSize,(start+count)*ar.itemSize),ar.itemSize,ar.normalized,ar.meshPerAttribute));}}
   const inst=new THREE.InstancedMesh(geo,source.material,count);for(let i=0;i<count;i++){const m=new THREE.Matrix4();src.getMatrixAt(start+i,m);inst.setMatrixAt(i,m);if(src.instanceColor){const c=new THREE.Color();src.getColorAt(start+i,c);inst.setColorAt(i,c)}}mesh=inst;
  }else{
   if(p.count!==undefined){const index=geo.index;if(!index)throw Error('選択範囲に索引がありません');const selected=Array.from(index.array.slice(p.start||0,(p.start||0)+p.count));const ids=[...new Set(selected)],map=new Map(ids.map((id,i)=>[id,i]));const compact=new THREE.BufferGeometry();for(const[name,attr]of Object.entries(geo.attributes)){const array=new (attr.array.constructor as any)(ids.length*attr.itemSize);ids.forEach((id,i)=>{for(let c=0;c<attr.itemSize;c++)array[i*attr.itemSize+c]=attr.array[id*attr.itemSize+c]});compact.setAttribute(name,new THREE.BufferAttribute(array,attr.itemSize,attr.normalized));}compact.setIndex(selected.map(id=>map.get(id)!));geo.dispose();geo=compact;}
   mesh=new THREE.Mesh(geo,source.material);
  }
  mesh.name=source.name;mesh.matrixAutoUpdate=false;mesh.matrix.copy(source.matrixWorld);mesh.frustumCulled=false;group.add(mesh);
 }
 if(!group.children.length)throw Error('元のシーンに対応するオブジェクトがありません');
 a.setSeaVisible?.(false);a.setWaterVisible?.(false);
 const hidden:THREE.Object3D[]=[];scene.traverse((o:any)=>{if(o.isMesh||o.isSprite||o.isLine||o.isPoints)hidden.push(o);});
 const visibility=hidden.map(o=>o.visible);hidden.forEach(o=>o.visible=false);scene.add(group);group.updateMatrixWorld(true);
 const box=new THREE.Box3().setFromObject(group),center=box.getCenter(new THREE.Vector3()),size=box.getSize(new THREE.Vector3()),radius=size.length()/2;
 const render=renderer.render;
 renderer.render=function(s,c){if(s===scene&&c===a.camera){const camera=c as THREE.PerspectiveCamera,v=a.view.get(),az=v.azimuth*Math.PI/180,el=v.elevation*Math.PI/180;camera.aspect=renderer.domElement.clientWidth/renderer.domElement.clientHeight;camera.fov=35;camera.clearViewOffset();const distance=radius/Math.sin(17.5*Math.PI/180)*1.18*Math.max(1,1/camera.aspect)/(v.zoom||1);camera.position.set(Math.cos(el)*Math.sin(az),Math.sin(el),Math.cos(el)*Math.cos(az)).multiplyScalar(distance).add(center);camera.near=Math.max(.001,distance/1000);camera.far=Math.max(100,distance*10);camera.lookAt(center);camera.updateProjectionMatrix();camera.updateMatrixWorld();}return render.call(renderer,s,c)};
 a.view.set({azimuth:45,elevation:25,zoom:1,panX:0,panY:0},{animate:false});a.requestRender?.();renderer.setRenderTarget(null);renderer.render(scene,a.camera);
 let disposed=false;
 return {size:size.toArray(),parts:group.children.length,dispose(){if(disposed)return;disposed=true;renderer.render=render;scene.remove(group);group.children.forEach(o=>{(o as THREE.Mesh).geometry.dispose();if((o as THREE.InstancedMesh).isInstancedMesh)(o as THREE.InstancedMesh).dispose();});hidden.forEach((o,i)=>o.visible=visibility[i]!);}};
}
