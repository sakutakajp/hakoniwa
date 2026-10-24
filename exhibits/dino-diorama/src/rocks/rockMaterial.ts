import * as THREE from 'three';
import { BAKED_VISIBILITY_FUNCTIONS, lightsBeginWithBakedVisibility } from '../bakedLighting';

export interface RockMaterialOptions {
  colors: { ivory: string; beige: string; lightBrown: string; grayBrown: string; cavity: string };
  roughness: number;
  surface: { bump: number; strataLines: number; cracks: number; grain: number };
  aoMin: number;
  /** 陰の面（環境光）に掛ける暖かい色 */
  shadeTint: string;
  shadowStrength: number;
  /** 模様の大きさの基準（台座の幅 10 のとき 1） */
  unit: number;
  seed: number;
  /**
   * 砂地の岩など、同じ岩質の別の物に使うときの設定（山では使わない）
   *  - instanced：InstancedMesh で使う（焼き込んだ影はインスタンスごとの instanceBakeUv で読む）
   *  - offsetPattern：岩ごとに模様の位置をずらす（多数の岩で地層の線の高さがそろわないように）
   *  - skyBake：焼き込んだ空の遮蔽（G）を環境光に使う
   *  - moss：苔の色。苔の量は頂点の aMoss（結合した岩）またはインスタンスの instanceMoss
   *  - vertexColors：頂点カラー（結合した岩の色の違い）を使う
   *  - cavity：頂点の rockCav（くぼみの深さ）で、溝の奥を暗くし（直接光も弱める）、苔をくぼみに寄せる
   */
  variant?: {
    instanced?: boolean;
    offsetPattern?: boolean;
    skyBake?: boolean;
    moss?: string;
    aoStrength?: number;
    vertexColors?: boolean;
    cavity?: { albedo: number; direct: number };
    /** 補助光の強さの倍率（1 で山と同じ。小さいほど陰の側が暗く、陰影がはっきりする） */
    fillScale?: number;
    /** 焼き込んだ影を2か所（bakeUv と bakeUv2）から読んで平均する（間引いた点で焼き込んだとき） */
    bakePair?: boolean;
    /** 水面（level）より下の部分を、深いほど藻の色（color）に寄せる量（amount）。海の中の岩に使う */
    underwater?: { level: number; color: string; amount: number; brightness?: number };
    /**
     * 水面（underwater.level）より下の部分を、色の画像の不透明度 0 で書いて印を付ける（島の土台の印）。
     * 水の側面のシェーダーが、ガラスの奥に見える島の土台を、近くても水の色に沈めるのに使う
     */
    waterMask?: boolean;
    /**
     * 森の地面：水面から minY より高い、上を向いた面（法線の上向き成分が slope の範囲で切り替わる）を
     * 下草と苔の色（color）に寄せる（amount）。木の間の隙間から白い岩が見えないようにする（島の岩肌に使う）
     */
    groundCover?: { color: string; minY: number; slope: [number, number]; amount: number };
    /**
     * 砂に埋まった根元：海底・砂浜の高さのテクスチャ（中心 0、一辺 size。u: +x、v: -z）を読み、
     * 砂の面から height の高さまでを砂の色（color）に寄せる（strength）。岩が砂に少し埋まって見えるように
     */
    sandLine?: {
      texture: THREE.Texture;
      size: number;
      color: string;
      height: number;
      strength: number;
      /** 水の中の部分だけに砂をかける（島の土台の根元。砂浜の崖のふもとは変えない） */
      underwaterOnly?: boolean;
    };
  };
}

/**
 * 岩肌のマテリアル。
 *  - 色：不均一な厚みの地層ごとにアイボリー〜サンドベージュを塗り分け、一部の層とくぼみに茶色・灰褐色を混ぜる
 *  - 細かな凹凸：地層の細い溝・縦の割れ目・風化のざらつきをワールド座標の3Dノイズで作り、法線を傾ける（バンプ）
 *  - 陰影：焼き込んだ主光・補助光の影（頂点ごと）と、くぼみの AO（頂点ごと）を適用
 * 形状の大きな凹凸（張り出し・割れ目・くぼみ）はジオメトリ側にある。
 */
export function createRockMaterial(opts: RockMaterialOptions): {
  material: THREE.MeshStandardMaterial;
  setBake: (texture: THREE.Texture) => void;
} {
  const variant = opts.variant ?? {};
  const material = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    roughness: opts.roughness,
    metalness: 0,
    vertexColors: variant.vertexColors ?? false,
  });
  const defines: Record<string, string> = {};
  if (variant.instanced) defines.ROCK_INSTANCED = '';
  if (variant.offsetPattern) defines.ROCK_OFFSET = '';
  if (variant.skyBake) defines.ROCK_SKY_BAKE = '';
  if (variant.moss) defines.ROCK_MOSS = '';
  if (variant.cavity) defines.ROCK_CAVITY = '';
  if (variant.bakePair) defines.ROCK_BAKE_PAIR = '';
  if (variant.underwater) defines.ROCK_UNDERWATER = '';
  if (variant.groundCover) defines.ROCK_GROUND_COVER = '';
  if (variant.sandLine) defines.ROCK_SAND_LINE = '';
  if (variant.waterMask && variant.underwater) defines.ROCK_WATER_MASK = '';
  if (variant.sandLine?.underwaterOnly && variant.underwater) defines.ROCK_SAND_UNDER = '';
  material.defines = { ...(material.defines ?? {}), ...defines };

  const placeholder = new THREE.DataTexture(new Uint8Array([0, 0, 0, 255]), 1, 1);
  placeholder.needsUpdate = true;
  const seedRnd = (n: number) => ((Math.sin(opts.seed * 12.9898 + n * 78.233) * 43758.5453) % 1 + 1) % 1;

  const uniforms = {
    uRockBake: { value: placeholder as THREE.Texture },
    uRkIvory: { value: new THREE.Color(opts.colors.ivory) },
    uRkBeige: { value: new THREE.Color(opts.colors.beige) },
    uRkLightBrown: { value: new THREE.Color(opts.colors.lightBrown) },
    uRkGrayBrown: { value: new THREE.Color(opts.colors.grayBrown) },
    uRkCavity: { value: new THREE.Color(opts.colors.cavity) },
    uRkBump: { value: opts.surface.bump },
    uRkStrata: { value: opts.surface.strataLines },
    uRkCracks: { value: opts.surface.cracks },
    uRkGrain: { value: opts.surface.grain },
    uRkAoMin: { value: opts.aoMin },
    uRkShadeTint: { value: new THREE.Color(opts.shadeTint) },
    uRkShadowStrength: { value: opts.shadowStrength },
    uRkUnit: { value: opts.unit },
    uRkSeed: { value: new THREE.Vector3(seedRnd(1) * 40, seedRnd(2) * 40, seedRnd(3) * 40) },
    uRkMoss: { value: new THREE.Color(variant.moss ?? '#6f7a3a') },
    uRkSkyAo: { value: variant.aoStrength ?? 0.8 },
    uRkCavAlbedo: { value: variant.cavity?.albedo ?? 0 },
    uRkCavDirect: { value: variant.cavity?.direct ?? 0 },
    uRkFillScale: { value: variant.fillScale ?? 1 },
    uRkWaterLevel: { value: variant.underwater?.level ?? 0 },
    uRkAlgae: { value: new THREE.Color(variant.underwater?.color ?? '#556b4a') },
    uRkAlgaeAmount: { value: variant.underwater?.amount ?? 0 },
    uRkUnderBright: { value: variant.underwater?.brightness ?? 1 },
    uRkCover: { value: new THREE.Color(variant.groundCover?.color ?? '#4a5a22') },
    uRkGround: { value: (variant.sandLine?.texture ?? placeholder) as THREE.Texture },
    uRkGroundSize: { value: variant.sandLine?.size ?? 1 },
    uRkSandColor: { value: new THREE.Color(variant.sandLine?.color ?? '#efe0bf') },
    uRkSandLine: { value: new THREE.Vector2(variant.sandLine?.height ?? 0, variant.sandLine?.strength ?? 0) },
    uRkCoverParams: {
      value: new THREE.Vector4(
        variant.groundCover?.minY ?? 0,
        variant.groundCover?.slope[0] ?? 0.4,
        variant.groundCover?.slope[1] ?? 0.75,
        variant.groundCover?.amount ?? 0,
      ),
    },
  };

  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);

    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
#ifdef ROCK_INSTANCED
attribute vec2 instanceBakeUv;
#else
attribute vec2 bakeUv;
#ifdef ROCK_BAKE_PAIR
attribute vec2 bakeUv2;
#endif
#endif
#ifdef ROCK_MOSS
#ifdef ROCK_INSTANCED
attribute float instanceMoss;
#else
attribute float aMoss;
#endif
varying float vRkMoss;
#endif
#if defined( ROCK_OFFSET ) && !defined( ROCK_INSTANCED )
attribute vec3 aRkOffset;
#endif
#ifdef ROCK_CAVITY
attribute float rockCav;
varying float vRkCav;
#endif
#ifdef ROCK_GROUND_COVER
attribute float aCover;
varying float vRkCoverMask;
#endif
attribute float rockAo;
uniform sampler2D uRockBake;
varying vec3 vRkPos;
varying vec3 vRkNormal;
varying float vRkAo;
varying vec3 vRkOcc;
varying vec3 vRkOffset;`,
      )
      .replace(
        '#include <project_vertex>',
        `#include <project_vertex>
#ifdef ROCK_INSTANCED
vRkPos = ( modelMatrix * instanceMatrix * vec4( transformed, 1.0 ) ).xyz;
vRkNormal = normalize( mat3( modelMatrix ) * mat3( instanceMatrix ) * objectNormal );
vRkOcc = texture2D( uRockBake, instanceBakeUv ).rgb;
#else
vRkPos = ( modelMatrix * vec4( transformed, 1.0 ) ).xyz;
vRkNormal = normalize( mat3( modelMatrix ) * objectNormal );
#ifdef ROCK_BAKE_PAIR
vRkOcc = 0.5 * ( texture2D( uRockBake, bakeUv ).rgb + texture2D( uRockBake, bakeUv2 ).rgb );
#else
vRkOcc = texture2D( uRockBake, bakeUv ).rgb;
#endif
#endif
vRkAo = rockAo;
#ifdef ROCK_GROUND_COVER
vRkCoverMask = aCover;
#endif
#ifdef ROCK_CAVITY
vRkCav = rockCav;
#endif
vRkOffset = vec3( 0.0 );
#ifdef ROCK_OFFSET
#ifdef ROCK_INSTANCED
// 岩ごとに模様をずらす（位置から決まる乱数）
vRkOffset = fract( sin( instanceMatrix[ 3 ].xyz * vec3( 12.9898, 78.233, 37.719 ) + instanceMatrix[ 3 ].zxy * 4.1 ) * 43758.5453 ) * 60.0;
#else
vRkOffset = aRkOffset;
#endif
#endif
#ifdef ROCK_MOSS
#ifdef ROCK_INSTANCED
vRkMoss = instanceMoss;
#else
vRkMoss = aMoss;
#endif
#endif`,
      );

    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
uniform vec3 uRkIvory;
uniform vec3 uRkBeige;
uniform vec3 uRkLightBrown;
uniform vec3 uRkGrayBrown;
uniform vec3 uRkCavity;
uniform float uRkBump;
uniform float uRkStrata;
uniform float uRkCracks;
uniform float uRkGrain;
uniform float uRkAoMin;
uniform vec3 uRkShadeTint;
uniform float uRkShadowStrength;
uniform float uRkUnit;
uniform vec3 uRkSeed;
uniform vec3 uRkMoss;
uniform float uRkSkyAo;
uniform float uRkCavAlbedo;
uniform float uRkCavDirect;
uniform float uRkFillScale;
uniform float uRkWaterLevel;
uniform vec3 uRkAlgae;
uniform float uRkAlgaeAmount;
uniform float uRkUnderBright;
uniform vec3 uRkCover;
uniform vec4 uRkCoverParams;
uniform sampler2D uRkGround;
uniform float uRkGroundSize;
uniform vec3 uRkSandColor;
uniform vec2 uRkSandLine;
varying vec3 vRkPos;
varying vec3 vRkNormal;
varying float vRkAo;
varying vec3 vRkOcc;
varying vec3 vRkOffset;
#ifdef ROCK_MOSS
varying float vRkMoss;
#endif
#ifdef ROCK_CAVITY
varying float vRkCav;
#endif
#ifdef ROCK_GROUND_COVER
varying float vRkCoverMask;
#endif
${BAKED_VISIBILITY_FUNCTIONS}

vec3 rkHash( vec3 p ) {
  p = fract( p * vec3( 0.1031, 0.1030, 0.0973 ) );
  p += dot( p, p.yxz + 33.33 );
  return fract( ( p.xxy + p.yxx ) * p.zyx ) * 2.0 - 1.0;
}
float rkHash1( float n ) {
  return fract( sin( n * 12.9898 + uRkSeed.x ) * 43758.5453 );
}
// 3D 勾配ノイズ（おおよそ -1〜1）
float rkNoise( vec3 p ) {
  vec3 i = floor( p );
  vec3 f = fract( p );
  vec3 u = f * f * f * ( f * ( f * 6.0 - 15.0 ) + 10.0 );
  float a = dot( rkHash( i ), f );
  float b = dot( rkHash( i + vec3( 1.0, 0.0, 0.0 ) ), f - vec3( 1.0, 0.0, 0.0 ) );
  float c = dot( rkHash( i + vec3( 0.0, 1.0, 0.0 ) ), f - vec3( 0.0, 1.0, 0.0 ) );
  float d = dot( rkHash( i + vec3( 1.0, 1.0, 0.0 ) ), f - vec3( 1.0, 1.0, 0.0 ) );
  float e = dot( rkHash( i + vec3( 0.0, 0.0, 1.0 ) ), f - vec3( 0.0, 0.0, 1.0 ) );
  float g = dot( rkHash( i + vec3( 1.0, 0.0, 1.0 ) ), f - vec3( 1.0, 0.0, 1.0 ) );
  float h = dot( rkHash( i + vec3( 0.0, 1.0, 1.0 ) ), f - vec3( 0.0, 1.0, 1.0 ) );
  float k = dot( rkHash( i + vec3( 1.0, 1.0, 1.0 ) ), f - vec3( 1.0, 1.0, 1.0 ) );
  return 1.6 * mix( mix( mix( a, b, u.x ), mix( c, d, u.x ), u.y ), mix( mix( e, g, u.x ), mix( h, k, u.x ), u.y ), u.z );
}

// 細かな凹凸の高さ。地層の細い溝（不均一な間隔）・縦の割れ目・風化のざらつき。
// cavity には溝や割れ目の深さ（色を暗くするのに使う）を返す。
float rkDetail( vec3 q, float steep, out float cavity ) {
  // 細い地層：間隔は不均一でうねり、溝が見える境目は一部だけ（機械的な横縞にしない）
  float u = q.y * 4.2 + 1.4 * rkNoise( vec3( q.x * 0.45, q.y * 0.6, q.z * 0.45 ) + uRkSeed ) + 0.35 * rkNoise( q * 1.9 + 3.0 );
  float fu = fract( u );
  float lid = floor( u );
  float lw = smoothstep( 0.45, 0.95, rkHash1( lid ) );
  float groove = 1.0 - smoothstep( 0.0, 0.16, fu ) * smoothstep( 1.0, 0.9, fu );
  // 地層の溝は切り立った面にだけ出す（上面に等高線のような線を出さない）
  lw *= smoothstep( 0.05, 0.6, steep );
  float strata = ( 0.25 * fu * ( 0.3 + 0.7 * rkHash1( lid + 3.0 ) ) - groove * lw ) * ( 0.25 + 0.75 * steep );

  // 縦の割れ目：縦長に引き伸ばし、途切れ途切れにする（網目にしない）。細かな縦溝も重ねる
  float n1 = rkNoise( vec3( q.x * 2.2, q.y * 0.35, q.z * 2.2 ) + 7.3 );
  float seg = smoothstep( 0.05, 0.45, rkNoise( vec3( q.x * 1.1, q.y * 0.9, q.z * 1.1 ) + 19.0 ) );
  float n2 = rkNoise( vec3( q.x * 5.5, q.y * 0.6, q.z * 5.5 ) - 2.9 );
  float crack = max( ( 1.0 - smoothstep( 0.0, 0.09, abs( n1 ) ) ) * seg, 0.55 * ( 1.0 - smoothstep( 0.0, 0.12, abs( n2 ) ) ) ) * steep;

  // 風化：細かなざらつきと小さなくぼみ
  float grain = rkNoise( q * 11.0 ) * 0.6 + rkNoise( q * 23.0 + 5.0 ) * 0.3;
  float pit = smoothstep( 0.55, 0.85, rkNoise( q * 6.0 - 11.0 ) );

  cavity = clamp( groove * lw * 0.4 * uRkStrata + crack * 0.3 * min( uRkCracks, 1.0 ) + pit * 0.25 * uRkGrain, 0.0, 1.0 );
  return uRkStrata * 0.04 * strata - uRkCracks * 0.05 * crack + uRkGrain * ( 0.014 * grain - 0.02 * pit );
}

vec3 rkAlbedo( vec3 q, vec3 n, float cavity ) {
  // 太い地層ごとの色（厚みは不均一）
  float u = q.y * 1.25 + 0.75 * rkNoise( vec3( q.x * 0.22, q.y * 0.3, q.z * 0.22 ) + 2.0 + uRkSeed );
  float layer = floor( u );
  float blend = smoothstep( 0.8, 1.0, fract( u ) );
  float tone = mix( rkHash1( layer + 17.0 ), rkHash1( layer + 18.0 ), blend );
  vec3 col = mix( uRkIvory, uRkBeige, smoothstep( 0.1, 0.9, tone ) );
  float brown = smoothstep( 0.66, 0.9, mix( rkHash1( layer + 31.0 ), rkHash1( layer + 32.0 ), blend ) );
  float gray = smoothstep( 0.84, 0.98, mix( rkHash1( layer + 47.0 ), rkHash1( layer + 48.0 ), blend ) );
  col = mix( col, uRkLightBrown, 0.7 * brown );
  col = mix( col, uRkGrayBrown, 0.5 * gray );
  // 大きなまだら
  float m = rkNoise( q * 0.55 + 9.0 ) * 0.5 + rkNoise( q * 1.6 - 4.0 ) * 0.25;
  col = mix( col, uRkLightBrown, clamp( 0.12 + 0.35 * m, 0.0, 0.3 ) );
  // 切り立った面の縦の雨筋（灰色のすじ）。縦に長く引き伸ばしたノイズ
  float steepA = smoothstep( 0.3, 0.8, 1.0 - abs( n.y ) );
  float streak = rkNoise( vec3( q.x * 2.6, q.y * 0.18, q.z * 2.6 ) + 31.0 ) * 0.7 + rkNoise( vec3( q.x * 6.0, q.y * 0.4, q.z * 6.0 ) - 5.0 ) * 0.3;
  col = mix( col, uRkGrayBrown, 0.45 * smoothstep( 0.1, 0.55, streak ) * steepA * uRkCracks / max( uRkCracks, 1.0 ) );
  // 上を向いた面には砂ぼこりがのって少し明るい
  col = mix( col, uRkIvory, 0.25 * smoothstep( 0.55, 0.95, n.y ) );
  // 溝や割れ目の奥
  col = mix( col, uRkCavity, cavity * 0.45 );
  return col;
}`,
      )
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
vec3 rkN = normalize( vRkNormal );
vec3 rkQ = vRkPos / uRkUnit + vRkOffset;
float rkSteep = smoothstep( 0.15, 0.7, 1.0 - abs( rkN.y ) );
float rkCavity = 0.0;
float rkC1;
float rkC2;
float rkC3;
const float rkE = 0.004;
float rkH0 = rkDetail( rkQ, rkSteep, rkCavity );
vec3 rkGrad = vec3(
  rkDetail( rkQ + vec3( rkE, 0.0, 0.0 ), rkSteep, rkC1 ) - rkH0,
  rkDetail( rkQ + vec3( 0.0, rkE, 0.0 ), rkSteep, rkC2 ) - rkH0,
  rkDetail( rkQ + vec3( 0.0, 0.0, rkE ), rkSteep, rkC3 ) - rkH0
) / rkE;
diffuseColor.rgb *= rkAlbedo( rkQ, rkN, rkCavity );
float rkCav = 0.0;
#ifdef ROCK_CAVITY
rkCav = clamp( vRkCav, 0.0, 1.0 );
// 溝やこぶの間の奥（砂ぼこりと陰で暗い）
diffuseColor.rgb *= 1.0 - uRkCavAlbedo * rkCav;
#endif
float rkUnder = 0.0;
float rkCover = 0.0;
#ifdef ROCK_GROUND_COVER
// 森の地面：上を向いた面を下草と苔の色に（まだらに濃淡）
{
  float n1 = rkNoise( rkQ * 1.3 + 4.0 ) * 0.5 + 0.5;
  float n2 = rkNoise( rkQ * 6.5 - 2.0 ) * 0.5 + 0.5;
  float up = smoothstep( uRkCoverParams.y, uRkCoverParams.z, rkN.y + 0.25 * ( n1 - 0.5 ) );
  float above = smoothstep( uRkCoverParams.x, uRkCoverParams.x + 0.12 * uRkUnit, vRkPos.y );
  rkCover = uRkCoverParams.w * up * above * clamp( vRkCoverMask, 0.0, 1.0 );
  vec3 cover = uRkCover * mix( 0.6, 1.25, n1 ) * mix( 0.8, 1.15, n2 );
  diffuseColor.rgb = mix( diffuseColor.rgb, cover, rkCover );
}
#endif
#ifdef ROCK_UNDERWATER
// 水の中の部分：水面のすぐ下から藻に覆われる（濃淡のまだら。上を向いた面は明るい黄緑）
{
  rkUnder = smoothstep( 0.02 * uRkUnit, 0.16 * uRkUnit, uRkWaterLevel - vRkPos.y );
  float patchA = 0.8 + 0.2 * smoothstep( -0.3, 0.4, rkNoise( rkQ * 1.7 + 21.0 ) );
  float tone = 0.5 + 0.5 * rkNoise( rkQ * 3.1 - 7.0 );
  vec3 algae = uRkAlgae * mix( 0.7, 1.15, tone ) * ( 0.9 + 0.2 * rkNoise( rkQ * 11.0 ) );
  algae = mix( algae, algae * vec3( 1.12, 1.15, 0.85 ), smoothstep( 0.3, 0.9, rkN.y ) );
  diffuseColor.rgb = mix( diffuseColor.rgb, algae, uRkAlgaeAmount * rkUnder * patchA );
  diffuseColor.rgb *= mix( 1.0, uRkUnderBright, rkUnder );
}
#endif
#ifdef ROCK_SAND_LINE
// 砂に埋まった根元：砂の面のすぐ上は、まわりの砂がかかって砂の色になる（境目は不規則に）
{
  vec2 rkGuv = vec2( vRkPos.x / uRkGroundSize + 0.5, 0.5 - vRkPos.z / uRkGroundSize );
  float rkAbove = vRkPos.y - texture2D( uRkGround, rkGuv ).r;
  float rkN1 = rkNoise( rkQ * 3.3 + 7.0 ) * 0.5 + 0.5;
  float rkLine = 1.0 - smoothstep( 0.0, uRkSandLine.x * ( 0.45 + 1.1 * rkN1 ), rkAbove );
  // 上を向いた面ほど砂が積もる
  rkLine *= mix( 0.55, 1.0, smoothstep( -0.3, 0.6, rkN.y ) );
#ifdef ROCK_SAND_UNDER
  rkLine *= rkUnder;
#endif
  diffuseColor.rgb = mix( diffuseColor.rgb, uRkSandColor * ( 0.88 + 0.24 * rkN1 ), uRkSandLine.y * rkLine );
}
#endif
#ifdef ROCK_MOSS
// 苔：上を向いた面のくぼみを中心に、まだらに控えめなオリーブ色
{
  float mossNoise = rkNoise( rkQ * 2.6 + 11.0 ) * 0.6 + rkNoise( rkQ * 7.0 - 3.0 ) * 0.4 + 0.5 * rkCav;
  float mossAmt = vRkMoss * smoothstep( 0.35, 0.8, rkN.y + 0.25 * rkCav ) * smoothstep( -0.2, 0.25, mossNoise );
  diffuseColor.rgb = mix( diffuseColor.rgb, uRkMoss * ( 0.75 + 0.4 * rkNoise( rkQ * 14.0 ) ), clamp( mossAmt, 0.0, 1.0 ) );
}
#endif`,
      )
      .replace(
        '#include <normal_fragment_maps>',
        `#include <normal_fragment_maps>
{
  vec3 g = rkGrad - rkN * dot( rkN, rkGrad );
  // 藻に覆われた水の中の部分は、地層の溝や割れ目の細かな凹凸を弱める
  vec3 nW = normalize( rkN - uRkBump * ( 1.0 - 0.6 * rkUnder ) * ( 1.0 - 0.7 * rkCover ) * g );
  normal = normalize( ( viewMatrix * vec4( nW, 0.0 ) ).xyz );
}`,
      )
      .replace(
        '#include <lights_fragment_begin>',
        `gBakedVis = 1.0 - uRkShadowStrength * clamp( vRkOcc.rb, 0.0, 1.0 );
gBakedVis.y *= uRkFillScale;
${lightsBeginWithBakedVisibility()}`,
      )
      .replace(
        '#include <lights_fragment_end>',
        `#include <lights_fragment_end>
reflectedLight.indirectDiffuse *= mix( uRkAoMin, 1.0, clamp( vRkAo, 0.0, 1.0 ) ) * ( 1.0 - 0.3 * rkCavity ) * uRkShadeTint;
#ifdef ROCK_CAVITY
// 深い溝の奥には直接の光も届きにくい
reflectedLight.directDiffuse *= 1.0 - uRkCavDirect * rkCav;
#endif
#ifdef ROCK_SKY_BAKE
reflectedLight.indirectDiffuse *= max( 1.0 - uRkSkyAo * clamp( vRkOcc.g, 0.0, 1.0 ), 0.45 );
#endif`,
      )
      .replace(
        '#include <dithering_fragment>',
        `#include <dithering_fragment>
#ifdef ROCK_WATER_MASK
// 水の中の部分に印を付ける（色の画像の不透明度を 0 に。画面に写すときは不透明度を使わない）
gl_FragColor.a = vRkPos.y < uRkWaterLevel ? 0.0 : 1.0;
#endif`,
      );
  };
  const cacheKey = `rock-material-${Object.keys(defines).sort().join('-')}`;
  material.customProgramCacheKey = () => cacheKey;

  return {
    material,
    setBake: (texture: THREE.Texture) => {
      uniforms.uRockBake.value = texture;
    },
  };
}
