import * as THREE from 'three';
import { BAKED_VISIBILITY_FUNCTIONS, lightsBeginWithBakedVisibility } from '../bakedLighting';

export interface PlantMaterialOptions {
  /**
   * 'foliage' は葉の塊、'frond' は羽状の葉（テクスチャで切り抜く）、'card' は木の枝葉の板（テクスチャで切り抜き、
   * 法線は樹冠の外向き寄りで裏返さない）、'wood' は幹と枝
   */
  kind: 'foliage' | 'frond' | 'card' | 'wood';
  color?: string;
  /** 羽状の葉のテクスチャ */
  map?: THREE.Texture;
  /** 樹冠の奥の暗さ・葉先の明るさ・葉先の色 */
  interior: number;
  tipLight: number;
  tipColor: string;
  /** 環境光が最も遮られた所に残す明るさ */
  aoMin: number;
  shadowStrength: number;
  aoStrength: number;
  /** 葉の細かな模様の細かさ（ワールド 1 あたりの数）と強さ、すき間の暗さ */
  leafScale: number;
  leafBump: number;
  leafContrast: number;
  /** 斜めから見た面のやわらかい光沢 */
  sheen: number;
  sheenColor: string;
  /** 葉を透かして見る日の光の強さ（羽状の葉） */
  translucency: number;
  /** 光を調べる点の数（高さ方向）と、焼き込み先の横の画素数 */
  probes: number;
  bakeWidth: number;
}

/**
 * 植物のマテリアル（インスタンス描画用）。色は植物ごとのインスタンスカラー。
 *  - 葉の塊：aShade（樹冠の外側ほど 1）で葉先を明るく奥を暗く、小さな葉の模様と丸いふくらみ（苔のような質感）
 *  - 羽状の葉：テクスチャで形を切り抜き、裏から日が透ける
 *  - 幹と枝：縦の樹皮の筋
 *  - 影と空からの遮蔽：高さ方向に何か所か焼き込んだ値を、頂点の高さで補間して読む（森の下の方は暗い）
 */
export function createPlantMaterial(opts: PlantMaterialOptions): {
  material: THREE.MeshStandardMaterial;
  setBake: (texture: THREE.Texture) => void;
} {
  const frond = opts.kind === 'frond';
  const card = opts.kind === 'card';
  const foliage = opts.kind === 'foliage';
  const textured = frond || card;
  const material = new THREE.MeshStandardMaterial({
    color: opts.kind === 'wood' ? new THREE.Color(opts.color ?? '#5d4b3c') : 0xffffff,
    roughness: 1,
    metalness: 0,
    map: textured ? opts.map ?? null : null,
    alphaTest: textured ? 0.45 : 0,
    side: textured ? THREE.DoubleSide : THREE.FrontSide,
  });
  if (textured) material.alphaToCoverage = true;
  const placeholder = new THREE.DataTexture(new Uint8Array([0, 0, 0, 255]), 1, 1);
  placeholder.needsUpdate = true;
  const uniforms = {
    uPlBake: { value: placeholder as THREE.Texture },
    uPlProbe: { value: new THREE.Vector2(opts.probes, opts.bakeWidth) },
    uPlInterior: { value: opts.interior },
    uPlTip: { value: opts.tipLight },
    uPlTipColor: { value: new THREE.Color(opts.tipColor) },
    uPlAoMin: { value: opts.aoMin },
    uPlShadow: { value: opts.shadowStrength },
    uPlAo: { value: opts.aoStrength },
    uPlLeafScale: { value: opts.leafScale },
    uPlLeafBump: { value: opts.leafBump },
    uPlLeafContrast: { value: opts.leafContrast },
    uPlSheen: { value: opts.sheen },
    uPlSheenColor: { value: new THREE.Color(opts.sheenColor) },
    uPlTransl: { value: opts.translucency },
  };
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
${foliage || textured ? 'attribute float aShade;' : ''}
attribute vec2 instanceBakeUv;
uniform sampler2D uPlBake;
uniform vec2 uPlProbe;
varying float vPlShade;
varying vec3 vPlOcc;
varying vec3 vPlPos;
varying float vPlH;`,
      )
      .replace(
        '#include <project_vertex>',
        `#include <project_vertex>
vPlShade = ${foliage || textured ? 'aShade' : '0.5'};
{
  // 高さ方向の光を調べる点の値を、頂点の高さ（ひな形の 0〜1）で補間して読む
  float f = clamp( position.y, 0.0, 1.0 ) * ( uPlProbe.x - 1.0 );
  float k0 = floor( f );
  float k1 = min( k0 + 1.0, uPlProbe.x - 1.0 );
  vec3 o0 = texture2D( uPlBake, instanceBakeUv + vec2( k0 / uPlProbe.y, 0.0 ) ).rgb;
  vec3 o1 = texture2D( uPlBake, instanceBakeUv + vec2( k1 / uPlProbe.y, 0.0 ) ).rgb;
  vPlOcc = mix( o0, o1, f - k0 );
}
vPlPos = ( modelMatrix * instanceMatrix * vec4( transformed, 1.0 ) ).xyz;
vPlH = position.y;`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
uniform float uPlInterior;
uniform float uPlTip;
uniform vec3 uPlTipColor;
uniform float uPlAoMin;
uniform float uPlShadow;
uniform float uPlAo;
uniform float uPlLeafScale;
uniform float uPlLeafBump;
uniform float uPlLeafContrast;
uniform float uPlSheen;
uniform vec3 uPlSheenColor;
uniform float uPlTransl;
varying float vPlShade;
varying vec3 vPlOcc;
varying vec3 vPlPos;
varying float vPlH;
${BAKED_VISIBILITY_FUNCTIONS}
float plHash( vec3 p ) {
  p = fract( p * 0.3183099 + 0.1 );
  p *= 17.0;
  return fract( p.x * p.y * p.z * ( p.x + p.y + p.z ) );
}
vec3 plHash3( vec3 p ) {
  p = fract( p * vec3( 0.1031, 0.1030, 0.0973 ) );
  p += dot( p, p.yxz + 33.33 );
  return fract( ( p.xxy + p.yxx ) * p.zyx );
}
float plNoise( vec3 p ) {
  vec3 i = floor( p );
  vec3 f = fract( p );
  vec3 u = f * f * ( 3.0 - 2.0 * f );
  return mix( mix( mix( plHash( i ), plHash( i + vec3( 1, 0, 0 ) ), u.x ), mix( plHash( i + vec3( 0, 1, 0 ) ), plHash( i + vec3( 1, 1, 0 ) ), u.x ), u.y ),
    mix( mix( plHash( i + vec3( 0, 0, 1 ) ), plHash( i + vec3( 1, 0, 1 ) ), u.x ), mix( plHash( i + vec3( 0, 1, 1 ) ), plHash( i + vec3( 1, 1, 1 ) ), u.x ), u.y ), u.z );
}
// 葉の模様：空間を小さな細胞に分け、1つの細胞を1枚の葉とみなす
vec4 plLeaves( vec3 q, out vec3 rNear ) {
  vec3 ip = floor( q );
  vec3 fp = fract( q );
  float d1 = 8.0;
  float d2 = 8.0;
  vec3 id = ip;
  rNear = vec3( 0.0 );
  for ( int x = -1; x <= 1; x ++ ) {
    for ( int y = -1; y <= 1; y ++ ) {
      for ( int z = -1; z <= 1; z ++ ) {
        vec3 g = vec3( float( x ), float( y ), float( z ) );
        vec3 r = g + plHash3( ip + g ) - fp;
        float d = dot( r, r );
        if ( d < d1 ) {
          d2 = d1;
          d1 = d;
          id = ip + g;
          rNear = r;
        } else if ( d < d2 ) {
          d2 = d;
        }
      }
    }
  }
  return vec4( id, sqrt( d2 ) - sqrt( d1 ) );
}`,
      )
      .replace(
        '#include <map_fragment>',
        `#include <map_fragment>
${
  textured
    ? `#ifdef USE_MAP
{
  // 遠くで縮小されたテクスチャは切り抜きが痩せるので、縮小の度合いに応じて不透明度を補う
  vec2 plTs = vec2( textureSize( map, 0 ) );
  vec2 plDx = dFdx( vMapUv * plTs );
  vec2 plDy = dFdy( vMapUv * plTs );
  float plLod = max( 0.0, 0.5 * log2( max( dot( plDx, plDx ), dot( plDy, plDy ) ) ) );
  diffuseColor.a *= 1.0 + plLod * 0.3;
}
#endif`
    : ''
}`,
      )
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
float plS = clamp( vPlShade, 0.0, 1.0 );
${
  foliage
    ? `diffuseColor.rgb *= mix( 1.0 - uPlInterior, 1.0, plS );
diffuseColor.rgb = mix( diffuseColor.rgb, uPlTipColor * ( 0.55 + 0.45 * plS ), uPlTip * smoothstep( 0.62, 1.0, plS ) );
vec3 plNear;
vec4 plLeaf = plLeaves( vPlPos * uPlLeafScale, plNear );
diffuseColor.rgb *= 1.0 + uPlLeafContrast * 0.3 * ( plHash( plLeaf.xyz ) - 0.5 );
diffuseColor.rgb *= mix( 1.0 - 0.4 * uPlLeafContrast, 1.0, smoothstep( 0.02, 0.2, plLeaf.w ) );`
    : ''
}${
  frond
    ? `// 羽状の葉：付け根は暗く、先は明るい黄緑に
diffuseColor.rgb *= mix( 0.7, 1.05, plS );
diffuseColor.rgb = mix( diffuseColor.rgb, uPlTipColor * diffuseColor.rgb * 1.6, uPlTip * smoothstep( 0.55, 1.0, plS ) * 0.5 );`
    : ''
}${
  card
    ? `// 枝葉の板：樹冠の奥は暗く、外側の葉先は明るい黄緑に
diffuseColor.rgb *= mix( 1.0 - uPlInterior, 1.0, plS );
diffuseColor.rgb = mix( diffuseColor.rgb, uPlTipColor * ( 0.35 + 0.9 * diffuseColor.rgb ), uPlTip * smoothstep( 0.55, 1.0, plS ) * 0.8 );`
    : ''
}${
  opts.kind === 'wood'
    ? `// 樹皮：縦の筋と、ところどころ明るい所。根元はやや暗い
{
  float bark = plNoise( vec3( vPlPos.x * 60.0, vPlPos.y * 6.0, vPlPos.z * 60.0 ) );
  float bark2 = plNoise( vPlPos * vec3( 140.0, 18.0, 140.0 ) );
  diffuseColor.rgb *= 0.78 + 0.32 * bark + 0.12 * ( bark2 - 0.5 );
}`
    : ''
}`,
      )
      .replace(
        '#include <normal_fragment_begin>',
        card
          ? `float faceDirection = gl_FrontFacing ? 1.0 : - 1.0;
vec3 normal = normalize( vNormal );
vec3 nonPerturbedNormal = normal;`
          : '#include <normal_fragment_begin>',
      )
      .replace(
        '#include <normal_fragment_maps>',
        `#include <normal_fragment_maps>
${
  foliage
    ? `{
  vec3 dome = -plNear * 1.6 + 0.35 * ( plHash3( plLeaf.xyz + 17.0 ) * 2.0 - 1.0 );
  vec3 tv = ( viewMatrix * vec4( dome, 0.0 ) ).xyz;
  normal = normalize( normal + uPlLeafBump * ( tv - normal * dot( normal, tv ) ) );
}`
    : ''
}`,
      )
      .replace(
        '#include <lights_fragment_begin>',
        `gBakedVis = 1.0 - uPlShadow * clamp( vPlOcc.rb, 0.0, 1.0 );
${lightsBeginWithBakedVisibility()}`,
      )
      .replace(
        '#include <lights_fragment_end>',
        `#include <lights_fragment_end>
reflectedLight.indirectDiffuse *= max( 1.0 - uPlAo * clamp( vPlOcc.g, 0.0, 1.0 ), ${frond ? '0.55' : '0.35'} ) * mix( ${frond ? 'max( uPlAoMin, 0.62 )' : 'uPlAoMin'}, 1.0, plS );
${frond ? '// 薄い葉は陰でも光が透けて、真っ黒にならない\nreflectedLight.indirectDiffuse += diffuseColor.rgb * 0.1;' : ''}
${
  foliage || card
    ? `{
  float plNdV = clamp( dot( normal, normalize( vViewPosition ) ), 0.0, 1.0 );
  float plRim = pow( 1.0 - plNdV, 2.2 );
  reflectedLight.directDiffuse += diffuseColor.rgb * uPlSheenColor * ( uPlSheen * plRim * ( 0.35 + 0.65 * gBakedVis.x ) );
}`
    : ''
}${
  textured
    ? `
#if NUM_DIR_LIGHTS > 0
{
  // 葉を透かして見る日の光（裏から日が当たると明るい黄緑に光る）
  float back = max( -dot( normal, directionalLights[ 0 ].direction ), 0.0 );
  reflectedLight.directDiffuse += diffuseColor.rgb * directionalLights[ 0 ].color * back * uPlTransl * gBakedVis.x;
}
#endif`
    : ''
}`,
      );
  };
  material.customProgramCacheKey = () => `dino-plant-${opts.kind}`;
  return {
    material,
    setBake: (texture: THREE.Texture) => {
      uniforms.uPlBake.value = texture;
    },
  };
}
