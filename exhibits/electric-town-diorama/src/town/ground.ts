import * as THREE from 'three';
import type { SceneConfig } from '../config';
import { applyPlanarBake, type PlanarBake } from '../bakedLighting';
import { REFLECTION_GLSL, LOCAL_LIGHT_GLSL, TINT_APPLY, TINT_DECL, type TownEnv } from './env';
import type { P2 } from './geometry2d';
import type { Streets } from './streets';
import type { SurfaceMap } from './surfaceMap';

/**
 * 路面の塊：側面（灰色の塊）、車道の上面、歩道の上面（街区と左手前の細い歩道）、縁石の面。
 * 上面は焼き込んだ影（地面の高さの平面）と、街の明かり、濡れた路面の映り込みで描く
 */
export interface GroundMeshes {
  group: THREE.Group;
  slab: THREE.Mesh;
  road: THREE.Mesh;
  walk: THREE.Mesh;
  curbs: THREE.Mesh;
  /** 影の計算に使う形 */
  casters: THREE.Mesh[];
  /** 地面の高さのテクスチャ（影の焼き込み用。中心 0、一辺 size） */
  heightTexture: (size: number, resolution: number) => THREE.DataTexture;
  setBake: (bake: PlanarBake) => void;
}

const NOISE_GLSL = /* glsl */ `
float gnHash( vec2 p ) {
  vec3 p3 = fract( vec3( p.xyx ) * 0.1031 );
  p3 += dot( p3, p3.yzx + 33.33 );
  return fract( ( p3.x + p3.y ) * p3.z );
}
float gnNoise( vec2 p ) {
  vec2 i = floor( p );
  vec2 f = fract( p );
  vec2 u = f * f * ( 3.0 - 2.0 * f );
  return mix( mix( gnHash( i ), gnHash( i + vec2( 1.0, 0.0 ) ), u.x ), mix( gnHash( i + vec2( 0.0, 1.0 ) ), gnHash( i + vec2( 1.0, 1.0 ) ), u.x ), u.y );
}
float gnFbm( vec2 p ) {
  float v = 0.0;
  float a = 0.5;
  for ( int i = 0; i < 4; i ++ ) {
    v += a * gnNoise( p );
    p = p * 2.03 + 17.1;
    a *= 0.5;
  }
  return v;
}
`;

function triangulate(poly: readonly P2[], y: number) {
  const contour = poly.map(([x, z]) => new THREE.Vector2(x, z));
  const tris = THREE.ShapeUtils.triangulateShape(contour, []);
  const pos: number[] = [];
  const nor: number[] = [];
  for (const [x, z] of poly) {
    pos.push(x, y, z);
    nor.push(0, 1, 0);
  }
  const idx: number[] = [];
  // 上から見て、法線が上を向く巻き方にそろえる
  for (const [a, b, c] of tris) {
    const ax = poly[a][0];
    const az = poly[a][1];
    const cross = (poly[b][0] - ax) * (poly[c][1] - az) - (poly[b][1] - az) * (poly[c][0] - ax);
    if (cross < 0) idx.push(a, b, c);
    else idx.push(a, c, b);
  }
  return { pos, nor, idx };
}

function mergeParts(parts: { pos: number[]; nor: number[]; idx: number[] }[]) {
  const pos: number[] = [];
  const nor: number[] = [];
  const idx: number[] = [];
  for (const p of parts) {
    const base = pos.length / 3;
    pos.push(...p.pos);
    nor.push(...p.nor);
    for (const i of p.idx) idx.push(i + base);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setIndex(idx);
  g.computeBoundingSphere();
  return g;
}

/** 折れ線に沿った縦の帯（下 y0、上 y1）。法線は折れ線の向きの右（side=1）か左（side=-1）。上の縁は丸める */
function wallStrip(pts: readonly P2[], y0: number, y1: number, side: 1 | -1, round = 0) {
  const pos: number[] = [];
  const nor: number[] = [];
  const idx: number[] = [];
  const n = pts.length;
  const rows: [number, number, number][] = [];
  // 断面：[外へのずれ, 高さ, 法線の上向き成分の角度]
  rows.push([0, y0, 0]);
  if (round > 0) {
    rows.push([0, y1 - round, 0]);
    for (let k = 1; k <= 3; k++) {
      const a = (k / 3) * (Math.PI / 2);
      rows.push([-round + round * Math.cos(a), y1 - round + round * Math.sin(a), a]);
    }
  } else rows.push([0, y1, 0]);
  for (let i = 0; i < n; i++) {
    const a = pts[Math.max(0, i - 1)];
    const b = pts[Math.min(n - 1, i + 1)];
    let tx = b[0] - a[0];
    let tz = b[1] - a[1];
    const tl = Math.hypot(tx, tz) || 1;
    tx /= tl;
    tz /= tl;
    // 右の法線（x→z の向きで、進む向きの右）：(-tz, tx)…上から見て
    const nx = side * -tz;
    const nz = side * tx;
    for (const [o, y, ang] of rows) {
      pos.push(pts[i][0] + nx * o, y, pts[i][1] + nz * o);
      const c = Math.cos(ang);
      nor.push(nx * c, Math.sin(ang), nz * c);
    }
  }
  const m = rows.length;
  for (let i = 0; i < n - 1; i++) {
    for (let r = 0; r < m - 1; r++) {
      const a = i * m + r;
      const b = (i + 1) * m + r;
      if (side === 1) idx.push(a, b, a + 1, a + 1, b, b + 1);
      else idx.push(a, a + 1, b, a + 1, b + 1, b);
    }
  }
  return { pos, nor, idx };
}

export function createGround(config: SceneConfig, streets: Streets, surface: SurfaceMap, env: TownEnv): GroundMeshes {
  const t = config.town;
  const G = t.ground;
  const C = t.curb;
  const plateTop = config.pedestal.thickness;
  const group = new THREE.Group();
  group.name = 'ground';

  // --- 上面
  const roadGeo = mergeParts([triangulate(streets.road, G)]);
  const walkParts = [triangulate(streets.block, G + C)];
  if (streets.farLeft.length > 2) walkParts.push(triangulate(streets.farLeft, G + C));
  if (streets.farRight.length > 2) walkParts.push(triangulate(streets.farRight, G + C));
  const walkGeo = mergeParts(walkParts);
  // --- 縁石の面：街区の縁石（折れ線の右が車道）と、向かいの歩道の縁石（折れ線の左が車道）
  const curbParts = [wallStrip(streets.curbInside, G - 0.002, G + C, 1, t.curbStone.radius)];
  if (streets.nearLeft.length > 1) curbParts.push(wallStrip(streets.nearLeft, G - 0.002, G + C, -1, t.curbStone.radius));
  if (streets.nearRight.length > 1) curbParts.push(wallStrip(streets.nearRight, G - 0.002, G + C, -1, t.curbStone.radius));
  const curbGeo = mergeParts(curbParts);
  // --- 側面：外周に沿って、土台の上面から路面（歩道の所は歩道の高さ）まで。上の縁は丸める
  const slabParts: { pos: number[]; nor: number[]; idx: number[] }[] = [];
  {
    const out = streets.outline;
    const n = out.length;
    // 外周の点ごとの上端の高さ
    const tops = out.map(([x, z]) => {
      const inX = x * 0.995;
      const inZ = z * 0.995;
      return streets.raised(inX, inZ) ? G + C : G;
    });
    // 高さの同じ区間ごとに帯を作る（外周は反時計回りでなく、x→z の向きで時計回り＝右が外）
    let start = 0;
    for (let i = 1; i <= n; i++) {
      if (i === n || tops[i] !== tops[start]) {
        const seg: P2[] = [];
        for (let k = start; k <= Math.min(i, n - 1); k++) seg.push(out[k]);
        if (i === n) seg.push(out[0]);
        if (seg.length >= 2) slabParts.push(wallStrip(seg, plateTop, tops[start], -1, t.slab.edgeRadius));
        start = i;
      }
    }
  }
  const slabGeo = mergeParts(slabParts);

  // ===== マテリアル =====
  const road = createRoadMaterial(config, surface, env);
  const walk = createWalkMaterial(config, surface, env);
  const curbMat = createCurbMaterial(config, env);
  const slabMat = createSlabMaterial(config);

  const roadMesh = new THREE.Mesh(roadGeo, road.material);
  roadMesh.name = 'road';
  const walkMesh = new THREE.Mesh(walkGeo, walk.material);
  walkMesh.name = 'sidewalk';
  const curbMesh = new THREE.Mesh(curbGeo, curbMat);
  curbMesh.name = 'curbs';
  const slabMesh = new THREE.Mesh(slabGeo, slabMat);
  slabMesh.name = 'slab';
  group.add(roadMesh, walkMesh, curbMesh, slabMesh);

  const heightTexture = (size: number, resolution: number) => {
    const data = new Float32Array(resolution * resolution);
    for (let j = 0; j < resolution; j++) {
      const z = (0.5 - (j + 0.5) / resolution) * size;
      for (let i = 0; i < resolution; i++) {
        const x = ((i + 0.5) / resolution - 0.5) * size;
        data[i + j * resolution] = streets.heightAt(x, z);
      }
    }
    const tex = new THREE.DataTexture(data, resolution, resolution, THREE.RedFormat, THREE.FloatType);
    tex.minFilter = THREE.NearestFilter;
    tex.magFilter = THREE.NearestFilter;
    tex.needsUpdate = true;
    return tex;
  };

  return {
    group,
    slab: slabMesh,
    road: roadMesh,
    walk: walkMesh,
    curbs: curbMesh,
    casters: [new THREE.Mesh(roadGeo), new THREE.Mesh(walkGeo), new THREE.Mesh(curbGeo), new THREE.Mesh(slabGeo)],
    heightTexture,
    setBake: (bake) => {
      road.setBake(bake);
      walk.setBake(bake);
    },
  };
}

/** 路面の模様の地図を読む共通の宣言。台座の縁の明るい石の縁取り（小さな点の並ぶ帯）も */
const SURFACE_GLSL = /* glsl */ `
uniform sampler2D uSurface;
uniform float uSurfaceSize;
uniform vec3 uRim;
uniform vec3 uRimColor;
vec4 surfaceAt( vec2 xz ) {
  return texture2D( uSurface, xz / uSurfaceSize + 0.5 );
}
// 台座の外周からの距離（内側が正）
float rimDistance( vec2 p ) {
  vec2 q = abs( p ) - ( uRim.x - uRim.y );
  float d = length( max( q, 0.0 ) ) + min( max( q.x, q.y ), 0.0 ) - uRim.y;
  return -d;
}
// 縁取りの帯：0〜1（帯の中で 1）と、帯の色
float rimMask( vec2 p ) {
  float d = rimDistance( p );
  return 1.0 - smoothstep( uRim.z, uRim.z + 0.006, d );
}
vec3 rimColorAt( vec2 p, float grain ) {
  // 縁に沿って小さな暗い点が並ぶ
  vec2 g = fract( p * 42.0 ) - 0.5;
  float dotM = 1.0 - smoothstep( 0.16, 0.24, length( g ) );
  return uRimColor * ( 0.9 + 0.15 * grain ) * ( 1.0 - 0.35 * dotM );
}
`;

/** 平面に焼き込んだ影を後から差し替える */
function setPlanarBake(u: Record<string, THREE.IUniform>, b: PlanarBake) {
  u.uBakeMap.value = b.texture;
  (u.uBakeCenter.value as THREE.Vector2).set(b.centerX, b.centerZ);
  u.uBakeInvSize.value = 1 / b.size;
}

/** 平面に焼き込んだ影を後から設定できるようにする（最初は空の焼き込みで作る） */
function bakeHolder() {
  const placeholder = new THREE.DataTexture(new Uint8Array([0, 0, 0, 255]), 1, 1);
  placeholder.needsUpdate = true;
  return { texture: placeholder as THREE.Texture, centerX: 0, centerZ: 0, size: 1 };
}

/**
 * 濡れたアスファルト：暗い灰色に細かな骨材のむら。水たまり（ノイズ）は平らでつやがあり、街の明かりと景色が映る。
 * 雨の小さな波紋で映り込みがゆらぎ、光は縦の筋に伸びる。白線はつやが少ない
 */
function createRoadMaterial(config: SceneConfig, surface: SurfaceMap, env: TownEnv) {
  const r = config.town.road;
  const material = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1, metalness: 0 });
  const bake = bakeHolder();
  const uniforms = {
    uSurface: { value: surface.texture },
    uSurfaceSize: { value: surface.size },
    uRim: { value: new THREE.Vector3(config.pedestal.size / 2, config.pedestal.cornerRadius, config.town.rim.width) },
    uRimColor: { value: new THREE.Color(config.town.rim.color) },
    uRoadColor: { value: new THREE.Color(r.color) },
    uRoadLight: { value: new THREE.Color(r.light) },
    uPaint: { value: new THREE.Color(config.town.lanes.color) },
    uPuddle: { value: new THREE.Vector2(r.puddles.amount, 1 / r.puddles.size) },
    uRefl2: { value: new THREE.Vector4(r.reflection.strength, r.reflection.wetRoughness, r.reflection.dryRoughness, r.reflection.streak) },
    uRipple: { value: new THREE.Vector2(r.ripple.strength, 1 / r.ripple.size) },
  };
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms, env.uniforms);
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
${NOISE_GLSL}
${SURFACE_GLSL}
${REFLECTION_GLSL}
${LOCAL_LIGHT_GLSL}
${TINT_DECL}
uniform vec3 uRoadColor;
uniform vec3 uRoadLight;
uniform vec3 uPaint;
uniform vec2 uPuddle;
uniform vec4 uRefl2;
uniform vec2 uRipple;
float gWet = 0.0;
float gPaint = 0.0;
vec2 gRippleOff = vec2( 0.0 );`,
      )
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
{
  vec2 q = vBakeWorld.xz;
  vec4 sm = surfaceAt( q );
  // アスファルト：大きなむら、細かな骨材の明暗
  float big = gnFbm( q * 0.9 + 3.1 );
  float grain = gnNoise( q * 180.0 ) * 0.6 + gnNoise( q * 420.0 ) * 0.4;
  vec3 asph = mix( uRoadColor, uRoadLight, 0.35 * big + 0.25 * grain );
  // 水たまり：大きさのばらつくノイズ（白線の上にもかかる）
  float pn = gnFbm( q * uPuddle.y + 11.7 ) + 0.18 * gnNoise( q * uPuddle.y * 4.0 );
  gWet = smoothstep( 0.62 - uPuddle.x * 0.25, 0.7 - uPuddle.x * 0.25, pn );
  gPaint = sm.r;
  vec3 paint = uPaint * ( 0.9 + 0.1 * grain );
  // 白線はところどころかすれる
  gPaint *= 0.75 + 0.25 * smoothstep( 0.3, 0.7, gnNoise( q * 22.0 ) );
  vec3 c = mix( asph, paint, gPaint );
  // マンホールのふた（暗い鉄の円）
  float mh = smoothstep( 0.3, 0.6, sm.g ) * ( 1.0 - smoothstep( 0.8, 0.95, sm.g ) );
  c = mix( c, vec3( 0.06, 0.06, 0.065 ) * ( 0.8 + 0.4 * grain ), mh );
  // 濡れた所は色が濃い
  c *= mix( 1.0, 0.72, gWet * ( 1.0 - gPaint ) );
  // 台座の縁の石の縁取り（乾いていて、つやが少ない）
  float rim = rimMask( q );
  c = mix( c, rimColorAt( q, grain ), rim );
  gWet *= 1.0 - rim;
  gPaint = max( gPaint, rim * 0.6 );
  diffuseColor.rgb = c;
}`,
      )
      .replace(
        '#include <roughnessmap_fragment>',
        `#include <roughnessmap_fragment>
roughnessFactor = mix( uRefl2.z, uRefl2.y, gWet );
roughnessFactor = mix( roughnessFactor, 0.7, gPaint );`,
      )
      .replace(
        '#include <normal_fragment_maps>',
        `#include <normal_fragment_maps>
{
  // 雨の小さな波紋：水たまりの上で強く、乾いた所は弱い
  vec2 q = vBakeWorld.xz * uRipple.y;
  float e = 0.15;
  float h0 = gnNoise( q ) + 0.5 * gnNoise( q * 2.7 + 5.0 );
  float hx = gnNoise( q + vec2( e, 0.0 ) ) + 0.5 * gnNoise( ( q + vec2( e, 0.0 ) ) * 2.7 + 5.0 );
  float hz = gnNoise( q + vec2( 0.0, e ) ) + 0.5 * gnNoise( ( q + vec2( 0.0, e ) ) * 2.7 + 5.0 );
  vec2 g = vec2( hx - h0, hz - h0 ) / e;
  float k = uRipple.x * mix( 0.35, 1.0, gWet );
  gRippleOff = g * k * 0.0045;
  vec3 nW = normalize( vec3( -g.x * k * 0.25, 1.0, -g.y * k * 0.25 ) );
  normal = normalize( ( viewMatrix * vec4( nW, 0.0 ) ).xyz );
}`,
      );
  };
  material.customProgramCacheKey = () => 'town-road';
  const bakeUniforms = applyPlanarBake(material, bake, {
    shadowStrength: config.shadow.strength,
    aoStrength: config.shadow.groundAoStrength,
    extraFragment: `${TINT_APPLY}
{
  // 街の明かり（拡散）
  reflectedLight.indirectDiffuse += diffuseColor.rgb * localLightAt( vBakeWorld, vec3( 0.0, 1.0, 0.0 ) );
  // 濡れた路面の映り込み（斜めから見るほど強い）
  vec3 V = normalize( cameraPosition - vBakeWorld );
  float cosV = clamp( V.y, 0.0, 1.0 );
  float fres = 0.04 + 0.96 * pow( 1.0 - cosV, 5.0 );
  float wetK = mix( 0.28, 1.0, gWet ) * ( 1.0 - 0.7 * gPaint );
  float rough = mix( uRefl2.z, uRefl2.y, gWet );
  vec3 refl = reflectionAt( vBakeWorld, gRippleOff, rough, uRefl2.w * mix( 1.3, 1.0, gWet ) );
  // 暗い物は弱く、明るい物（灯り・看板・店先）は強く映す。色は少し金色に寄せる
  refl = refl * 0.13 + max( refl - vec3( 0.45 ), vec3( 0.0 ) ) * 0.95;
  float rl = dot( refl, vec3( 0.299, 0.587, 0.114 ) );
  refl = mix( refl, rl * vec3( 1.3, 0.92, 0.5 ), 0.5 );
  reflectedLight.indirectSpecular += refl * uRefl2.x * wetK * mix( 0.45, 1.0, fres );
}`,
  });
  return {
    material,
    setBake: (b: PlanarBake) => setPlanarBake(bakeUniforms, b),
  };
}

/**
 * 歩道の石畳：暖かい灰色の四角い敷石を、通りの向きにそろえて並べる（目地は暗い）。
 * 縁石の帯は白っぽい石。濡れて少しつやがあり、店の明かりが映る
 */
function createWalkMaterial(config: SceneConfig, surface: SurfaceMap, env: TownEnv) {
  const p = config.town.paving;
  const material = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.6, metalness: 0 });
  const bake = bakeHolder();
  const uniforms = {
    uSurface: { value: surface.texture },
    uSurfaceSize: { value: surface.size },
    uRim: { value: new THREE.Vector3(config.pedestal.size / 2, config.pedestal.cornerRadius, config.town.rim.width) },
    uRimColor: { value: new THREE.Color(config.town.rim.color) },
    uPave: { value: new THREE.Color(p.color) },
    uPaveLight: { value: new THREE.Color(p.light) },
    uPaveDark: { value: new THREE.Color(p.dark) },
    uJoint: { value: new THREE.Color(p.joint) },
    uCurbStone: { value: new THREE.Color(config.town.curbStone.color) },
    uTile: { value: new THREE.Vector2(1 / p.size[0], 1 / p.size[1]) },
    uPaveWet: { value: p.wet },
    uRoadRefl: { value: config.town.road.reflection.strength },
  };
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms, env.uniforms);
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
${NOISE_GLSL}
${SURFACE_GLSL}
${REFLECTION_GLSL}
${LOCAL_LIGHT_GLSL}
${TINT_DECL}
uniform vec3 uPave;
uniform vec3 uPaveLight;
uniform vec3 uPaveDark;
uniform vec3 uJoint;
uniform vec3 uCurbStone;
uniform vec2 uTile;
uniform float uPaveWet;
uniform float uRoadRefl;
float gJoint = 0.0;
float gStone = 0.0;
float gWetW = 0.0;`,
      )
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
{
  vec2 q = vBakeWorld.xz;
  vec4 sm = surfaceAt( q );
  float ang = sm.b * 3.14159265;
  vec2 dir = vec2( cos( ang ), sin( ang ) );
  vec2 lq = vec2( dot( q, dir ), dot( q, vec2( -dir.y, dir.x ) ) ) * uTile;
  // 1 列ごとに半分ずらす（馬目地）
  lq.x += 0.5 * mod( floor( lq.y ), 2.0 );
  vec2 cell = floor( lq );
  vec2 f = fract( lq );
  float aa = fwidth( lq.x ) + fwidth( lq.y );
  float jw = 0.06;
  float jx = smoothstep( jw, jw + aa, f.x ) * smoothstep( jw, jw + aa, 1.0 - f.x );
  float jz = smoothstep( jw, jw + aa, f.y ) * smoothstep( jw, jw + aa, 1.0 - f.y );
  gJoint = 1.0 - jx * jz;
  float h = gnHash( cell + 7.3 );
  vec3 c = mix( uPaveDark, uPave, smoothstep( 0.0, 0.6, h ) );
  c = mix( c, uPaveLight, smoothstep( 0.72, 1.0, h ) * 0.7 );
  c *= 0.9 + 0.12 * gnNoise( q * 90.0 );
  c = mix( c, uJoint, gJoint * 0.85 );
  // 縁石の石の帯
  gStone = smoothstep( 0.5, 0.7, sm.g ) * step( sm.g, 0.98 + 1.0 );
  c = mix( c, uCurbStone * ( 0.9 + 0.15 * gnNoise( q * 60.0 ) ), gStone );
  // 濡れたむら（目地にたまる水、大きなむら）
  gWetW = uPaveWet * smoothstep( 0.35, 0.75, gnFbm( q * 0.8 + 4.2 ) );
  c *= 1.0 - 0.25 * gWetW;
  float rim = rimMask( q );
  c = mix( c, rimColorAt( q, gnNoise( q * 90.0 ) ), rim );
  gJoint = mix( gJoint, 0.0, rim );
  diffuseColor.rgb = c;
}`,
      )
      .replace(
        '#include <roughnessmap_fragment>',
        `#include <roughnessmap_fragment>
roughnessFactor = mix( 0.62, 0.3, gWetW ) + 0.2 * gJoint;`,
      );
  };
  material.customProgramCacheKey = () => 'town-walk';
  const bakeUniforms = applyPlanarBake(material, bake, {
    shadowStrength: config.shadow.strength,
    aoStrength: config.shadow.groundAoStrength,
    extraFragment: `${TINT_APPLY}
{
  reflectedLight.indirectDiffuse += diffuseColor.rgb * localLightAt( vBakeWorld, vec3( 0.0, 1.0, 0.0 ) );
  vec3 V = normalize( cameraPosition - vBakeWorld );
  float fres = 0.04 + 0.96 * pow( 1.0 - clamp( V.y, 0.0, 1.0 ), 5.0 );
  vec3 refl = reflectionAt( vBakeWorld - vec3( 0.0, ${config.town.curb.toFixed(3)}, 0.0 ), vec2( 0.0 ), mix( 0.75, 0.35, gWetW ), 0.02 );
  reflectedLight.indirectSpecular += refl * uRoadRefl * ( 0.12 + 0.45 * gWetW ) * ( 1.0 - 0.6 * gJoint ) * mix( 0.5, 1.0, fres );
}`,
  });
  return {
    material,
    setBake: (b: PlanarBake) => setPlanarBake(bakeUniforms, b),
  };
}

/** 縁石の面：白っぽい石。街の明かりを受ける */
function createCurbMaterial(config: SceneConfig, env: TownEnv) {
  const material = new THREE.MeshStandardMaterial({ color: new THREE.Color(config.town.curbStone.color).multiplyScalar(0.85), roughness: 0.75, metalness: 0 });
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, env.uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vCbWorld;')
      .replace('#include <project_vertex>', '#include <project_vertex>\nvCbWorld = ( modelMatrix * vec4( transformed, 1.0 ) ).xyz;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\nvarying vec3 vCbWorld;\n${LOCAL_LIGHT_GLSL}\n${TINT_DECL}`)
      .replace(
        '#include <lights_fragment_end>',
        `#include <lights_fragment_end>
${TINT_APPLY}
reflectedLight.indirectDiffuse += diffuseColor.rgb * localLightAt( vCbWorld + vec3( 0.0, 0.0, 0.0 ), vec3( 0.0, 1.0, 0.0 ) ) * 0.8;`,
      );
  };
  material.customProgramCacheKey = () => 'town-curb';
  return material;
}

/** 路面の塊の側面：暖かい灰色の、細かな粒の混じったコンクリート。上の縁はわずかに明るい */
function createSlabMaterial(config: SceneConfig) {
  const s = config.town.slab;
  const material = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.85, metalness: 0 });
  const uniforms = {
    uSlab: { value: new THREE.Color(s.color) },
    uSlabLight: { value: new THREE.Color(s.light) },
    uSlabDark: { value: new THREE.Color(s.dark) },
    uSlabTop: { value: config.town.ground },
    uSlabBase: { value: config.pedestal.thickness },
  };
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vSlWorld;\nvarying vec3 vSlN;')
      .replace(
        '#include <project_vertex>',
        '#include <project_vertex>\nvSlWorld = ( modelMatrix * vec4( transformed, 1.0 ) ).xyz;\nvSlN = normalize( mat3( modelMatrix ) * objectNormal );',
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
${NOISE_GLSL}
uniform vec3 uSlab;
uniform vec3 uSlabLight;
uniform vec3 uSlabDark;
uniform float uSlabTop;
uniform float uSlabBase;
varying vec3 vSlWorld;
varying vec3 vSlN;`,
      )
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
{
  // 外周に沿った座標（角を回っても続く）と高さで、粒とむらを付ける
  vec2 q = vec2( vSlWorld.x + vSlWorld.z, vSlWorld.y );
  float big = gnFbm( q * 1.3 + 2.0 );
  float fine = gnNoise( q * 140.0 ) * 0.6 + gnNoise( q * 330.0 + 3.0 ) * 0.4;
  float speck = smoothstep( 0.82, 0.95, gnNoise( q * 210.0 + 9.0 ) );
  vec3 c = mix( uSlabDark, uSlab, 0.55 + 0.45 * big );
  c = mix( c, uSlabLight, speck * 0.45 );
  c *= 0.9 + 0.16 * fine;
  // 上の縁の丸み（上を向いた面）は明るく、下の方はわずかに暗い
  c = mix( c, uSlabLight * 1.05, smoothstep( 0.3, 0.9, vSlN.y ) * 0.6 );
  c *= mix( 0.86, 1.0, smoothstep( uSlabBase, uSlabBase + 0.35, vSlWorld.y ) );
  diffuseColor.rgb = c;
}`,
      );
  };
  material.customProgramCacheKey = () => 'town-slab';
  return material;
}
