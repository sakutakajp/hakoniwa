import * as THREE from 'three';
import { MeshBuilder } from './meshBuilder';
import { outlinePoints, roundedRect } from './room/shape';
import { createPlateGeometry } from './pedestal';

/** 二重床をもつ小さなサーバー室。すべての形と模様は起動時に生成。 */
export function buildDatacenter() {
 const b = new MeshBuilder(.24), glow = new MeshBuilder(1);
 const V=(x:number,y:number,z:number)=>new THREE.Vector3(x,y,z);
 const f=(color:string)=>({color:new THREE.Color(color),style:0});
 const C={steel:'#a5aaac',edge:'#b9bfc0',dark:'#292d30',black:'#151c21',tile:'#b9bdc1',wall:'#b4b4b0',blue:'#008ec4',yellow:'#e5ad15',white:'#d5d1c7'};
 const box=(x:number,y:number,z:number,w:number,h:number,d:number,c:string)=>b.box([x,z],[w,d],[y-h/2,y+h/2],f(c),f(c),{bottom:f(c)});
 const line=(a:number[],q:number[],r:number,c:string)=>{
  const aa=V(...a as [number,number,number]),bb=V(...q as [number,number,number]);
  const g=new THREE.CylinderGeometry(r,r,aa.distanceTo(bb),8,1);
  g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(V(0,1,0),bb.clone().sub(aa).normalize()));g.translate((aa.x+bb.x)/2,(aa.y+bb.y)/2,(aa.z+bb.z)/2);
  const ps=g.getAttribute('position'),ns=g.getAttribute('normal'),ix=g.index!,off=b.vertexCount;
  for(let i=0;i<ps.count;i++)b.addVertex(V(ps.getX(i),ps.getY(i),ps.getZ(i)),V(ns.getX(i),ns.getY(i),ns.getZ(i)),f(c));
  for(let i=0;i<ix.count;i++)b.indices.push(off+ix.getX(i));g.dispose();
 };
 const cable=(pts:number[][],r:number,c:string)=>{
  const curve=new THREE.CatmullRomCurve3(pts.map(a=>V(...a as [number,number,number])),false,'centripetal');
  const g=new THREE.TubeGeometry(curve,Math.max(12,pts.length*7),r,6,false);
  const pos=g.getAttribute('position'),nor=g.getAttribute('normal'),ix=g.index!;const off=b.vertexCount;
  for(let i=0;i<pos.count;i++)b.addVertex(V(pos.getX(i),pos.getY(i),pos.getZ(i)),V(nor.getX(i),nor.getY(i),nor.getZ(i)),f(c));
  for(let i=0;i<ix.count;i++) b.indices.push(off+ix.getX(i));g.dispose();
 };
 const led=(x:number,y:number,z:number,w:number,h:number,d:number,c='#42c8f0')=>glow.box([x,z],[w,d],[y-h/2,y+h/2],f(c),f(c));
 const floorY=1.56, wallTop=5.15;
 const base=roundedRect(9.76,9.76,{frontRight:1.08,frontLeft:1.08,backLeft:1.08,backRight:1.08});
 const slab=new THREE.Mesh(createPlateGeometry(outlinePoints(base),{thickness:.10,topEdgeRadius:.03,bottomEdgeRadius:.02,edgeSegments:4}),new THREE.MeshStandardMaterial({color:'#8f9391',roughness:.8})); slab.position.y=.255;
 // 床下の基礎、全周に連続する二段の電線トレー。前・右を覆う壁は設けない。
 for(let k=0;k<11;k++){
  const t=-4.3+k*.86;
  for(const [x,z] of [[t,4.32],[4.32,t],[t,-4.32],[-4.32,t]]){
   box(x,.40,z,.24,.07,.24,C.steel);box(x,.92,z,.085,1.05,.085,C.edge);
   box(x,1.45,z,.22,.06,.22,C.steel);box(x,.52,z,.11,.1,.11,C.steel);
   for(const dx of [-.08,.08])for(const dz of [-.08,.08])line([x+dx,.44,z+dz],[x+dx,.47,z+dz],.018,C.dark);
  }
 }
 for(const yy of [.64,1.02]){
  for(const t of [-4.15,4.15]){box(0,yy,t,8.3,.055,.05,C.steel);box(t,yy,0,.05,.055,8.3,C.steel);}
  for(let t=-4;t<=4;t+=.28){box(t,yy,4.04,.035,.04,.42,C.steel);box(4.04,yy,t,.42,.04,.035,C.steel);}
  for(let k=0;k<7;k++){
   const r=3.91+k*.043;
   cable([[-4.25,yy+.09,r],[2.95,yy+.09,r],[3.7,yy+.09,r-.1],[r,yy+.09,3.1],[r,yy+.09,-4.25]],.018,yy<.8?C.yellow:C.blue);
  }
 }
 // 各ラック列の下にも幹線を通し、枝線を垂直に立ち上げる。
 for(const x of [-2.52,-.84,.84,2.52]){
  box(x,.79,0,.38,.05,7.7,C.steel);
  for(let k=0;k<5;k++)line([x-.12+k*.06,.85,-3.85],[x-.12+k*.06,.85,3.9],.02,k<3?C.blue:C.yellow);
  for(let z=-2.7;z<3;z+=1.35){box(x,.9,z,.08,1.1,.08,C.steel);cable([[x,.87,z],[x+.25,1,z],[x+.25,1.6,z]],.025,C.blue);}
 }
 // 60 cm角パネルに相当する正方形床。角の曲線内にだけ配置。
 for(let i=0;i<12;i++)for(let j=0;j<12;j++){
  const x=-4.4+i*.8,z=-4.4+j*.8;
  if(Math.abs(x)>3.8&&Math.abs(z)>3.8)continue;
  box(x,1.51,z,.79,.10,.79,((i+j)%3===0)?'#c9cccf':C.tile);
  // 冷気を供給する通路の有孔パネル。孔は小さな陰の凹みとして立体化。
  if([2,4,6,8].includes(i)&&j>1&&j<11){
   box(x,1.566,z,.56,.013,.62,'#7a8387');
   for(let a=0;a<7;a++)for(let q=0;q<9;q++)box(x-.23+a*.077,1.575,z-.26+q*.065,.046,.005,.025,'#313a3e');
  }
 }
 // 壁は左と奥。内側のパネル継ぎ目、角柱、巾木、笠石。
 box(0,(wallTop+floorY)/2,-4.47,8.94,wallTop-floorY,.20,C.wall);
 box(-4.47,(wallTop+floorY)/2,0,.20,wallTop-floorY,8.94,C.wall);
 for(let k=0;k<7;k++){
  const t=-4.1+k*1.35;
  box(t,3.35,-4.355,.018,3.4,.014,'#8e9494');box(-4.355,3.35,t,.014,3.4,.018,'#8e9494');
 }
 for(let y=2;y<5;y+=.62){box(0,y,-4.35,8.7,.014,.018,'#959b9b');box(-4.35,y,0,.018,.014,8.7,'#959b9b');}
 for(const t of [-4.35,-1.5,1.5,4.35]){
  box(t,3.37,-4.35,.19,3.7,.30,'#adb0ae');box(-4.35,3.37,t,.30,3.7,.19,'#adb0ae');
  box(t,5.22,-4.43,.34,.19,.40,C.white);box(-4.43,5.22,t,.40,.19,.34,C.white);
 }
 box(0,5.18,-4.46,8.95,.17,.30,C.white);box(-4.46,5.18,0,.30,.17,8.95,C.white);
 box(0,1.66,-4.29,8.7,.16,.12,C.steel);box(-4.29,1.66,0,.12,.16,8.7,C.steel);
 // 4列×5台。縦置きのラックを一直線に並べ、各列の脇に一定幅の通路。
 for(let row=0;row<4;row++)for(let n=0;n<5;n++){
  const x=-2.52+row*1.68,z=-2.8+n*1.32;
  box(x,2.73,z,.83,2.30,1.23,C.black);
  box(x,3.91,z,.88,.10,1.26,C.dark);box(x,1.65,z,.89,.12,1.26,C.dark);
  // 正面と背面にラックの柱とサーバー、ハンドル、ドライブ、LAN端子。
  for(const side of [-1,1]){
   const xx=x+side*.432;
   for(const zz of [z-.55,z+.55])box(xx,2.75,zz,.055,2.23,.055,'#4f575b');
   for(let u=0;u<16;u++){
    const yy=1.85+u*.121;
    box(xx,yy,z,.025,.105,.98,u%5===0?'#344249':'#202b31');
    for(let d=0;d<4;d++){
     const zz=z-.37+d*.245;box(xx+side*.018,yy,zz,.014,.065,.196,'#0e181d');
     for(let h=0;h<3;h++) box(xx+side*.027,yy-.022+h*.022,zz,.008,.007,.14,'#526067');
     led(xx+side*.034,yy+.025,zz+.077,.012,.014,.018,(u+d+n)%6===0?'#e7b64b':'#4ec1d3');
    }
    for(const zz of [z-.50,z+.50])box(xx+side*.02,yy,zz,.045,.064,.016,'#a9b2b2');
   }
   box(xx+side*.03,2.81,z+.53,.045,.36,.027,C.steel);
  }
  // 前後の短い面にもメッシュ、蝶番、ラベル。
  for(const ss of [-1,1]){
   box(x,2.75,z+ss*.622,.72,2.1,.025,'#343e43');
   for(let q=0;q<7;q++)box(x-.30+q*.10,2.75,z+ss*.64,.018,2.04,.009,'#151c20');
   for(let u=0;u<13;u++)box(x,1.82+u*.15,z+ss*.65,.69,.012,.01,'#647075');
   for(let k=0;k<4;k++) cable([[x-.22+k*.11,1.8,z+ss*.67],[x-.22+k*.11,2.4,z+ss*.68],[x-.2+k*.11,3.55,z+ss*.67]],.012,k===2?C.yellow:C.blue);
   box(x+.32,2.85,z+ss*.66,.028,.30,.035,C.steel);
  }
  box(x,3.97,z,.60,.025,.72,'#3f4c51');
  for(let t=0;t<8;t++)box(x-.25+t*.07,3.987,z,.023,.008,.6,'#141f25');
  // 立ち上がりの配線。架台と接続先が連続している。
  for(let k=0;k<5;k++)cable([[x-.22+k*.105,4.00,z],[x-.22+k*.105,4.23,z-.02],[x-.20+k*.10,4.50,z-.15],[x-.18+k*.09,4.52,z-.38]],.018,k<3?C.blue:C.yellow);
 }
 // 頭上のケーブルラダー：側桁・横桟・固定ボルト。
 for(const x of [-2.52,-.84,.84,2.52]){
  for(const dx of [-.28,.28])box(x+dx,4.48,-.25,.055,.14,7.5,C.edge);
  for(let z=-3.9;z<3.6;z+=.25)box(x,4.43,z,.60,.035,.035,C.steel);
  for(let k=0;k<8;k++)line([x-.21+k*.06,4.53,-3.95],[x-.21+k*.06,4.53,3.45],.019,k<5?C.blue:C.yellow);
  for(const z of [-3.8,-.4,3.2]){line([x-.32,4.42,z],[x-.32,3.97,z],.022,C.steel);box(x,4.39,z,.7,.06,.055,C.steel);}
 }
 for(const z of [-3.9]){
  for(const dz of [-.26,.26])box(0,4.53,z+dz,7.4,.14,.055,C.edge);
  for(let x=-3.7;x<=3.7;x+=.25)box(x,4.48,z,.035,.03,.58,C.steel);
  for(let k=0;k<7;k++)line([-3.7,4.58,z-.18+k*.055],[3.7,4.58,z-.18+k*.055],.018,k<4?C.blue:C.yellow);
 }
 // 左側の精密空調機。ファン、フィルター、下部パネル、冷媒配管。
 for(let n=0;n<4;n++){
  const z=-2.8+n*1.65,x=-3.88;
  box(x,2.64,z,.72,2.08,1.42,'#cbc9bf');
  box(x+.37,2.84,z,.025,1.28,1.17,'#545b5c');
  for(let k=0;k<15;k++)box(x+.39,2.26+k*.08,z,.023,.022,1.11,'#afb2ad');
  for(let k=0;k<13;k++)box(x+.405,2.84,z-.53+k*.088,.014,1.22,.012,'#313b3d');
  box(x+.38,1.83,z,.028,.34,1.14,'#b6b9b2');
  box(x+.41,2.1,z+.48,.03,.15,.1,'#505c5c');led(x+.43,2.13,z+.48,.008,.035,.055);
  for(const zz of [z-.38,z+.38]){
   line([x,3.69,zz],[x,3.75,zz],.18,'#596263');
   for(let k=0;k<3;k++)line([x-.16,3.76,zz-.08+k*.08],[x+.16,3.76,zz-.08+k*.08],.01,C.steel);
   cable([[x-.12,3.72,zz],[x-.12,4.10,zz],[x-.24,4.28,zz],[x-.42,4.28,zz],[x-.48,4.05,zz]],.065,'#aeb4b2');
  }
 }
 // 奥の配電盤と監視用のデスク。扉の前には歩ける幅を残す。
 for(const x of [2.7,3.35]){
  box(x,2.62,-4.05,.59,2.1,.48,'#aaada9');
  box(x,2.65,-3.80,.50,1.91,.028,'#bfc2bc');
  for(let j=0;j<15;j++)box(x,2.2+j*.035,-3.776,.40,.014,.01,'#717b7c');
  led(x,3.27,-3.775,.19,.065,.015,'#5cabb5');
  box(x+.19,2.75,-3.75,.027,.29,.035,C.steel);
  cable([[x,3.69,-4.05],[x,4.13,-4.05],[x-.18,4.29,-4.08],[x-.5,4.29,-4.08]],.04,C.dark);
 }
 box(4.03,2.68,-4.31,.60,2.20,.055,'#686f70');box(4.03,2.72,-4.27,.49,2.05,.022,'#989d9b');box(4.12,2.72,-4.24,.08,.55,.02,'#d0d4cd');line([3.84,2.55,-4.22],[3.93,2.55,-4.22],.025,C.steel);
 led(4.03,3.97,-4.27,.36,.07,.03,'#fff2d5');
 // 作業机。モニターは入口と椅子へ向ける。
 box(3.78,2.33,-1.92,1.38,.09,.85,C.white);
 for(const x of [3.25,4.25])box(x,1.98,-1.92,.30,.66,.67,'#b3b7b5');
 for(const x of [3.43,4.06]){
  box(x,2.66,-2.14,.56,.43,.055,C.dark);led(x,2.66,-2.106,.49,.35,.014,'#276482');
  for(let k=0;k<5;k++)led(x,2.54+k*.055,-2.09,.33,.013,.009,k%2?'#7bc3d6':'#3a8faf');
  box(x,2.40,-2.14,.07,.16,.06,C.dark);
 }
 box(3.65,2.395,-1.65,.64,.025,.24,'#4c5659');
 for(let i=0;i<10;i++)for(let j=0;j<4;j++)box(3.38+i*.055,2.411,-1.73+j*.045,.04,.008,.03,'#919c9e');
 box(3.72,2.0,-1.13,.48,.12,.44,'#373c3d');box(3.72,2.26,-.91,.46,.55,.10,'#444b4c');line([3.72,1.64,-1.13],[3.72,1.97,-1.13],.035,C.steel);
 for(let k=0;k<5;k++){const a=k*Math.PI*2/5;line([3.72,1.67,-1.13],[3.72+Math.cos(a)*.3,1.64,-1.13+Math.sin(a)*.3],.025,C.dark);}
 // 壁の配線管、照明、端子箱、消火器。
 for(const x of [-3.2,-.6,1.8]){
  box(x,4.88,-4.26,1.5,.11,.09,'#8d9799');led(x,4.87,-4.19,1.37,.052,.035,'#e2f5ff');
  cable([[x-.65,4.65,-4.26],[x-.35,4.65,-4.26],[x-.2,4.48,-4.26],[x-.2,2.00,-4.26]],.022,C.steel);
  box(x-.2,3.2,-4.20,.17,.23,.11,'#8f9998');
 }
 for(const z of [-2.8,0,2.8]){box(-4.27,4.88,z,.09,.11,1.5,'#8d9799');led(-4.19,4.87,z,.035,.052,1.37,'#e2f5ff');}
 line([3.52,1.95,-4.12],[3.52,2.41,-4.12],.075,'#af2920');box(3.52,2.45,-4.1,.13,.05,.07,C.dark);box(3.52,2.22,-4.03,.10,.13,.01,'#e5cb82');
 // 角丸の床端を一枚の連続した形にする。切断面は開いたまま。
 const deck=new THREE.Mesh(createPlateGeometry(outlinePoints(base),{thickness:.10,topEdgeRadius:.015,bottomEdgeRadius:.01,edgeSegments:3}),new THREE.MeshStandardMaterial({color:'#b9bdc1',roughness:.75}));deck.position.y=1.44;
 const geometry=b.build(),lights=glow.build();
 // 配線を見渡せるよう床下のみ25%高くする。上の機器の比率はそのまま。
 const lift=.32625;
 for(const g of [geometry,lights]){const ps=g.getAttribute('position');for(let i=0;i<ps.count;i++){const y=ps.getY(i);ps.setY(i,y<1.56?.255+(y-.255)*1.25:y+lift);}g.computeBoundingSphere();}
 deck.position.y+=lift;
 return {geometry,glow:lights,slab,deck,base,floorY:floorY+lift,wallTop:wallTop+lift};
}
