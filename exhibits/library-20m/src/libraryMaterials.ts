import * as THREE from 'three';
import { bakedVisibilityFunctions, lightsBeginWithBakedVisibility } from './bakedLighting';

/**
 * 図書館の形に使う模様（頂点の aStyle で選ぶ）。
 * 模様は面の上の座標（aFacade = 面の上の横位置 u、高さ v、面の幅と高さ）で描く。
 *  kind 0 = 無地、1 = 大理石の石積み（目地と筋）、2 = 木目（板ごとの色むら）、3 = 鏡板（四角い板の縁の溝と面取りの光）、
 *  4 = 窓の外の景色（明るい空と庭。自ら光る）、5 = 自ら光る（ランプの笠・燭台の火屋）、6 = 金属（真鍮）、
 *  7 = 漆喰・石のむら、8 = 床板（板の継ぎ目をずらした張り方）、9 = 葉、10 = 紙（本の小口・開いた頁）、11 = 革（むらと型押しの粒）、
 *  12 = 色ガラスの笠、13 = 金文字の帯（木の板に、テクスチャの字の形の金箔。字の色は joint）
 */
export interface PatternStyle {
  kind: number;
  /** 模様のくり返しの大きさ（u 方向、v 方向）。石の大きさ・板の幅・鏡板の大きさなど */
  scale: [number, number];
  /** 目地・溝・筋の色 */
  joint: string;
  /** 目地の幅（くり返しに対する割合） */
  jointWidth: number;
  /** 色のばらつき */
  variation: number;
  roughness: number;
  metalness: number;
  /** 自ら光る強さ（kind 4・5） */
  emissive?: number;
  /** 大理石の筋・木目の強さ */
  vein?: number;
  /** 木目の向き（0 = u に沿う、1 = v に沿う） */
  grain?: number;
  /** 部屋の外側の面（壁の外・笠石・柱・台）。部屋の中の光の弱め方を掛けない */
  exterior?: boolean;
  /** 映り込み（環境マップ）の強さの倍率（既定 1） */
  specular?: number;
  /** 大理石の雲のようなむらの強さ（kind 1） */
  mottle?: number;
  /** 年輪の間隔（kind 2・3・8。ワールド単位、既定 0.03） */
  ring?: number;
}

export const MAX_STYLES = 32;
export const MAX_LAMPS = 24;

export interface LampLight {
  position: THREE.Vector3;
  color: THREE.Color;
  /** 光の届く距離 */
  range: number;
  intensity: number;
}

/** 部屋の内側（窓の日差しが入る範囲）：左の壁の内側の x、奥の壁の内側の z、奥の左の角の弧の中心と内側の半径 */
export interface RoomInterior {
  leftX: number;
  backZ: number;
  arcCenter: [number, number];
  arcRadius: number;
  /** 床（これより下は部屋の外） */
  minY: number;
  /** 部屋の中の光の効き（主光・補助光・空の光の倍率） */
  light?: { key: number; fill: number; ambient: number; tint?: [number, number, number] };
}

const placeholder = (() => {
  const t = new THREE.DataTexture(new Uint8Array([0, 0, 0, 0]), 1, 1);
  t.needsUpdate = true;
  return t;
})();

const PATTERN_GLSL = /* glsl */ `
uniform vec4 uStyA[${MAX_STYLES}];
uniform vec4 uStyB[${MAX_STYLES}];
uniform vec4 uStyC[${MAX_STYLES}];
uniform vec4 uStyD[${MAX_STYLES}];
uniform vec3 uGlassTop;
uniform vec3 uGlassBottom;
varying vec4 vFacade;
varying float vStyle;
varying float vSeed;
varying vec4 vEdge;
varying vec2 vLbUv;
uniform float uBevel;
#ifdef INSCRIPTION
uniform sampler2D uInscription;
#endif
float gEmissive = 0.0;
float gKeepDiffuse = 0.0;
`;

/**
 * 箱の辺の丸み（面取り）の見せかけ：辺から uBevel 以内では法線を辺の外へ傾ける（Blender の Bevel シェーダーと同じ考え方）。
 * 面の上の向き（u・v の向き）は、辺までの距離の画面上の変化（dFdx・dFdy）から求める（法線マップの接線を微分で求めるのと同じ方法）。
 * 丸みは 1.3 画素より細くしない（細すぎるとちらつく）。面の幅の 1/4 を超えない（細い材がすべて丸くならないように）
 */
const BEVEL_GLSL = /* glsl */ `
{
  vec4 e = vEdge;
  float emin = min( min( e.x, e.y ), min( e.z, e.w ) );
  if ( uBevel > 0.0 && emin < 0.1 ) {
    vec3 dpx = dFdx( -vViewPosition );
    vec3 dpy = dFdy( -vViewPosition );
    float px = max( length( dpx ), length( dpy ) );
    float bw = min( max( uBevel, px * 1.3 ), 0.25 * min( e.x + e.y, e.z + e.w ) );
    vec2 du = vec2( dFdx( e.x ), dFdy( e.x ) );
    vec2 dv = vec2( dFdx( e.z ), dFdy( e.z ) );
    float det = du.x * dv.y - du.y * dv.x;
    if ( abs( det ) > 1e-14 && bw > 1e-5 ) {
      vec3 T = normalize( ( dpx * dv.y - dpy * dv.x ) / det );
      vec3 B = normalize( ( dpy * du.x - dpx * du.y ) / det );
      vec4 w = vec4( 1.0 ) - smoothstep( vec4( 0.0 ), vec4( bw ), e );
      vec3 tilt = -T * w.x + T * w.y - B * w.z + B * w.w;
      normal = normalize( normal + tilt * 0.9 );
    }
  }
}
`;

const NOISE_GLSL = /* glsl */ `
// 0〜1 の範囲の帯（境目をなめらかに。aa は 1 画素の幅）
float lbBand( float x, float a, float b, float aa ) {
  return smoothstep( a - aa, a + aa, x ) * ( 1.0 - smoothstep( b - aa, b + aa, x ) );
}
// 格子の点（整数の座標）ごとの乱数。大きな座標でも偏らないよう、整数のビット演算で混ぜる
float lbHash( vec2 p ) {
  uvec2 q = uvec2( ivec2( floor( p ) ) + ivec2( 40503 ) );
  uint h = q.x * 0x8da6b343u + q.y * 0xd8163841u;
  h ^= h >> 15u; h *= 0x2c1b3c6du; h ^= h >> 12u; h *= 0x297a2d39u; h ^= h >> 15u;
  return float( h >> 8u ) * ( 1.0 / 16777216.0 );
}
// 1 つの値（部品の番号など）の乱数
float lbHash1( float x ) {
  uint h = floatBitsToUint( x ) * 0x9e3779b9u;
  h ^= h >> 16u; h *= 0x7feb352du; h ^= h >> 15u; h *= 0x846ca68bu; h ^= h >> 16u;
  return float( h >> 8u ) * ( 1.0 / 16777216.0 );
}
float lbNoise( vec2 p ) {
  vec2 i = floor( p );
  vec2 f = fract( p );
  vec2 w = f * f * ( 3.0 - 2.0 * f );
  return mix( mix( lbHash( i ), lbHash( i + vec2( 1.0, 0.0 ) ), w.x ), mix( lbHash( i + vec2( 0.0, 1.0 ) ), lbHash( i + vec2( 1.0, 1.0 ) ), w.x ), w.y );
}
float lbFbm( vec2 p ) {
  float s = 0.0;
  float a = 0.5;
  for ( int i = 0; i < 4; i++ ) {
    s += a * lbNoise( p );
    p = p * 2.03 + vec2( 17.1, 9.3 );
    a *= 0.5;
  }
  return s;
}
// 1 画素より細かい模様を消す割合（Inigo Quilez「bandlimiting」：周期が 1 画素に近づいたら平均の値へ）。
// freqPx は模様の 1 周期あたりの画素の逆数（= 周波数 × 1 画素の幅）
float lbKeep( float freqPx ) {
  return smoothstep( 1.0, 0.45, freqPx );
}
// 帯域を制限した fBm：オクターブごとに、1 画素より細かくなったものを平均の値に置き換える。w は p の 1 画素の幅
float lbFbmB( vec2 p, float w ) {
  float s = 0.0;
  float a = 0.5;
  for ( int i = 0; i < 4; i++ ) {
    s += a * mix( 0.5, lbNoise( p ), lbKeep( w * 1.4 ) );
    p = p * 2.03 + vec2( 17.1, 9.3 );
    w *= 2.03;
    a *= 0.5;
  }
  return s;
}

// 木目（Octane の Woodgrain の考え方と、Liu ら 2016「Simulating the structure and texture of solid wood」の年輪・導管を 2 次元に簡略化）。
// 板の上の年輪は「丸太の芯からの距離」の等高線：芯を板の面の下（深さ）に置き、板の長さの向きに少し傾けると、
// 板目の山形（カテドラル）が現れる。年輪のゆがみ、晩材（年輪の終わり）の暗く細い帯、繊維の細い筋、導管の小さな点、
// 板の長さの向きの大きなむら（杢）を重ねる。along は木目に沿う座標、across は板の中心からの横の座標（ワールド単位）。
// ringW は年輪の間隔、fw は 1 画素の幅。返り値は明るさの倍率、late は晩材の濃さ（0〜1）
float lbWood( float along, float across, float seed, float ringW, float fw, out float late ) {
  float h1 = lbHash1( seed + 0.11 );
  float h2 = lbHash1( seed + 0.37 );
  float h3 = lbHash1( seed + 0.73 );
  float a = along / ringW;
  float x = across / ringW;
  float wob = ( lbNoise( vec2( a * 0.06 + h1 * 40.0, x * 0.11 + 5.0 ) ) - 0.5 ) * 1.7;
  wob += ( lbNoise( vec2( a * 0.45 + 11.0, x * 0.3 + h2 * 30.0 ) ) - 0.5 ) * 0.45;
  float r = length( vec2( x - ( h1 - 0.5 ) * 8.0, 1.0 + h2 * 7.0 + a * ( h3 - 0.5 ) * 0.14 ) ) + wob;
  float f = fract( r );
  late = smoothstep( 0.45, 0.9, f ) * ( 1.0 - smoothstep( 0.9, 1.0, f ) ) * smoothstep( 0.75, 0.3, fw / ringW );
  float fib = mix( 0.5, lbNoise( vec2( along * 2.2 + h3 * 50.0, across * 230.0 ) ), lbKeep( fw * 230.0 ) );
  float pore = smoothstep( 0.8, 0.95, lbNoise( vec2( along * 42.0 + h2 * 70.0, across * 470.0 ) ) ) * lbKeep( fw * 470.0 ) * ( 1.0 - late );
  float fig = lbNoise( vec2( along * 1.1 + h1 * 60.0, across * 5.0 + h3 * 9.0 ) );
  float fig2 = lbNoise( vec2( along * 3.7 + h2 * 20.0, across * 11.0 + h1 * 7.0 ) );
  return 1.0 - 0.2 * late + 0.1 * ( fib - 0.5 ) - 0.16 * pore + 0.16 * ( fig - 0.5 ) + 0.07 * ( fig2 - 0.5 );
}

// 古材の仕上げ：箱の角のすれ（ニスがはげて明るい木地が出る。所々だけ）と、色あせ（少し灰色がかった黄味へ寄せる、むらのある色の抜け）。
// emin は箱の辺までの距離（箱でない面は遠い値）、p は面の座標、fw は 1 画素の幅。wear は角のすれの強さ（つやを鈍くするのに使う）
vec3 lbAged( vec3 col, float emin, vec2 p, float fw, out float wear ) {
  float wn = lbNoise( p * 37.0 );
  wear = ( 1.0 - smoothstep( 0.003, 0.016 + fw, emin ) ) * smoothstep( 0.3, 0.7, wn );
  col = mix( col, col * 1.24 + vec3( 0.02, 0.016, 0.01 ), wear * 0.75 );
  float pat = lbFbm( p * 2.3 + 7.0 );
  vec3 grey = vec3( dot( col, vec3( 0.32, 0.5, 0.18 ) ) ) * vec3( 1.06, 1.0, 0.86 );
  return mix( col, grey, 0.1 + 0.14 * pat );
}

// 大理石（クレマ・マルフィルのような淡いベージュ）。Inigo Quilez の「domain warping」で雲のようなむらを作り（q, r が途中の値）、
// むらとは別のワープした fBm の等高線を細い筋にする（Shader Lab「procedural marble」の |sin| のくぼみを fBm の等高線に置き換えた形）。
// 細かな粒と、トラバーチンのような小さな穴を重ねる。返り値：x = むら（0〜1）、y = 筋（0〜1）、z = 粒と穴（-1〜1）
vec3 lbMarble( vec2 p, float fw ) {
  // 大きな雲（1 単位に 1 つほど）
  vec2 q = vec2( lbFbm( p * 1.2 ), lbFbm( p * 1.2 + vec2( 5.2, 1.3 ) ) );
  float big = lbFbm( p * 1.2 + 2.5 * q );
  // 中くらいのむら（参考画像の台の石の、濃い淡褐色の斑）：ワープした fBm
  vec2 q2 = vec2( lbFbmB( p * 4.5 + 3.0 * q, fw * 4.5 ), lbFbmB( p * 4.5 + vec2( 2.7, 8.1 ), fw * 4.5 ) );
  float med = lbFbmB( p * 4.5 + 2.2 * q2, fw * 4.5 );
  // 細かな海綿のような粒立ち（化石の殻の欠片）
  float fine = lbFbmB( p * 16.0 + 4.0 * q2, fw * 16.0 );
  // 細い筋：ワープした fBm の等高線
  float vf = lbFbm( p * 0.9 + 2.2 * q + vec2( 3.1, 7.7 ) );
  float vw = 0.008 + fw * 1.2;
  float vein = ( 1.0 - smoothstep( vw * 0.35, vw, abs( vf - 0.47 ) ) ) * ( 0.35 + 0.65 * smoothstep( 0.3, 0.62, q.x ) );
  float sp = mix( 0.5, lbNoise( p * 60.0 ), lbKeep( fw * 60.0 ) );
  float pore = smoothstep( 0.86, 0.95, lbNoise( p * 120.0 + 7.0 ) ) * lbKeep( fw * 120.0 );
  // 小さな不規則な濃い斑（化石の欠片・気孔の集まり）
  float pit = smoothstep( 0.64, 0.8, lbNoise( p * 34.0 + 4.0 * q2 ) ) * lbKeep( fw * 34.0 );
  float m = clamp( big * 0.3 + med * 0.85 + ( fine - 0.47 ) * 1.4 - 0.05, 0.0, 1.0 );
  return vec3( m, vein, ( sp - 0.5 ) * 0.8 - pore - pit * 0.9 );
}
`;

const ROOM_GLSL = /* glsl */ `
uniform vec4 uRoomA;
uniform vec2 uRoomB;
uniform vec3 uRoomLight;
uniform vec3 uRoomTint;
float gInterior = 0.0;
float gExterior = 0.0;
float gSpec = 1.0;
// 部屋の内側なら 1（窓の日差しはここだけに当たる。壁の外の面・笠石・台座の外の床には当てない）
float roomInterior( vec3 p ) {
  float inside = step( uRoomA.x - 0.03, p.x ) * step( uRoomA.y - 0.03, p.z ) * step( uRoomB.y, p.y );
  vec2 q = p.xz - uRoomA.zw;
  if ( q.x < 0.0 && q.y < 0.0 ) inside *= step( length( q ), uRoomB.x + 0.03 );
  return inside;
}
`;

const LAMP_GLSL = /* glsl */ `
uniform vec4 uLampPos[${MAX_LAMPS}];
uniform vec4 uLampCol[${MAX_LAMPS}];
uniform int uLampCount;
uniform float uLampAo;
`;

/**
 * 図書館のマテリアル：焼き込んだ影（主光・補助光・窓の日差し）と空からの遮蔽、模様、ランプの灯り。
 * vertex: 頂点ごとの焼き込み（bakeUv）、instance: インスタンスごと（instanceBakeUv）、plane: 水平面に焼き込んだテクスチャ（ワールド座標で読む）
 */
export function createLibraryMaterial(opts: {
  mode: 'vertex' | 'instance' | 'plane';
  styles?: PatternStyle[];
  color?: THREE.ColorRepresentation;
  map?: THREE.Texture;
  vertexColors?: boolean;
  roughness?: number;
  metalness?: number;
  shadowStrength: number;
  aoStrength: number;
  /** 空からの遮蔽が最も強い所に残す明るさ */
  aoMin?: number;
  /** 焼き込んだ空の遮蔽を、日の当たる面の明るさにも掛ける割合（すき間や足もとを暗く） */
  aoOnDirect?: number;
  plane?: { centerX: number; centerZ: number; size: number };
  /** 部屋の内側（窓の日差しを当てる範囲）。なければ日差しはどこにも当てない */
  room?: RoomInterior;
  lamps?: LampLight[];
  glass?: { top: string; bottom: string };
  colorFragment?: string;
  normalFragment?: string;
  extraFragment?: string;
  extraDeclarations?: string;
  extraUniforms?: Record<string, THREE.IUniform>;
  vertexDeclarations?: string;
  vertexFragment?: string;
  side?: THREE.Side;
  envMap?: THREE.Texture;
  envMapIntensity?: number;
  /** 環境マップを拡散光にも使うか（既定は使わない：シリーズの照明では拡散光は半球光から受ける） */
  envDiffuse?: boolean;
  emissive?: THREE.ColorRepresentation;
  emissiveIntensity?: number;
  /** 箱の辺の丸みの幅（ワールド単位。0 で丸めない） */
  bevel?: number;
  /** 金文字の帯（kind 13）の字の形のテクスチャ（アルファが字） */
  inscription?: THREE.Texture;
}) {
  const material = new THREE.MeshStandardMaterial({
    color: opts.color ?? 0xffffff,
    map: opts.map ?? null,
    roughness: opts.roughness ?? 0.9,
    metalness: opts.metalness ?? 0,
    vertexColors: opts.vertexColors ?? false,
    side: opts.side ?? THREE.FrontSide,
    envMap: opts.envMap ?? null,
    envMapIntensity: opts.envMapIntensity ?? 1,
    emissive: opts.emissive ?? 0x000000,
    emissiveIntensity: opts.emissiveIntensity ?? 1,
  });
  const styles = opts.styles ?? [];
  const pack = (fn: (s: PatternStyle) => [number, number, number, number]) => {
    const arr = Array.from({ length: MAX_STYLES }, () => new THREE.Vector4());
    styles.forEach((s, i) => arr[i].set(...fn(s)));
    return arr;
  };
  const col = (c: string) => new THREE.Color(c);
  const lamps = (opts.lamps ?? []).slice(0, MAX_LAMPS);
  const room = opts.room;
  const uniforms: Record<string, THREE.IUniform> = {
    uBake: { value: placeholder as THREE.Texture },
    uShadowStrength: { value: opts.shadowStrength },
    uAoStrength: { value: opts.aoStrength },
    uAoMin: { value: opts.aoMin ?? 0.25 },
    uAoDirect: { value: opts.aoOnDirect ?? 0 },
    uBakePlane: { value: new THREE.Vector3(opts.plane?.centerX ?? 0, opts.plane?.centerZ ?? 0, 1 / (opts.plane?.size ?? 1)) },
    uDirMask: { value: new THREE.Vector3(1, 1, room ? 1 : 0) },
    uRoomA: { value: new THREE.Vector4(room?.leftX ?? 0, room?.backZ ?? 0, room?.arcCenter[0] ?? 0, room?.arcCenter[1] ?? 0) },
    uRoomB: { value: new THREE.Vector2(room?.arcRadius ?? 0, room?.minY ?? 0) },
    uRoomLight: { value: new THREE.Vector3(room?.light?.key ?? 1, room?.light?.fill ?? 1, room?.light?.ambient ?? 1) },
    uRoomTint: { value: new THREE.Vector3(...(room?.light?.tint ?? [1, 1, 1])) },
    uStyA: { value: pack((s) => [s.kind, s.scale[0], s.scale[1], s.jointWidth]) },
    uStyB: { value: pack((s) => [...col(s.joint).toArray(), s.variation] as [number, number, number, number]) },
    uStyC: { value: pack((s) => [s.roughness, s.metalness, s.emissive ?? 0, s.vein ?? 0]) },
    uStyD: { value: pack((s) => [s.grain ?? 0, s.exterior ? 1 : 0, s.specular ?? 1, s.mottle ?? s.ring ?? 0]) },
    uGlassTop: { value: new THREE.Color(opts.glass?.top ?? '#ffffff') },
    uGlassBottom: { value: new THREE.Color(opts.glass?.bottom ?? '#ffffff') },
    uLampPos: { value: Array.from({ length: MAX_LAMPS }, (_, i) => (lamps[i] ? new THREE.Vector4(lamps[i].position.x, lamps[i].position.y, lamps[i].position.z, lamps[i].range) : new THREE.Vector4())) },
    uLampCol: {
      value: Array.from({ length: MAX_LAMPS }, (_, i) =>
        lamps[i] ? new THREE.Vector4(lamps[i].color.r * lamps[i].intensity, lamps[i].color.g * lamps[i].intensity, lamps[i].color.b * lamps[i].intensity, 0) : new THREE.Vector4(),
      ),
    },
    uLampCount: { value: lamps.length },
    uLampAo: { value: 0.6 },
    uBevel: { value: opts.bevel ?? 0 },
    uInscription: { value: opts.inscription ?? placeholder },
    ...opts.extraUniforms,
  };
  const defines: Record<string, string> = {};
  defines[`BAKE_${opts.mode.toUpperCase()}`] = '';
  if (styles.length > 0) defines.PATTERN = '';
  if (lamps.length > 0) defines.LAMPS = '';
  if (room) defines.ROOM_SUN = '';
  if (opts.inscription && styles.length > 0) defines.INSCRIPTION = '';
  if (!opts.envDiffuse) defines.BAKE_NO_IBL_DIFFUSE = '';
  material.defines = { ...(material.defines ?? {}), ...defines };

  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
uniform sampler2D uBake;
varying vec4 vOcc;
varying vec3 vBkWorld;
#ifdef BAKE_VERTEX
attribute vec2 bakeUv;
#endif
#ifdef BAKE_INSTANCE
attribute vec2 instanceBakeUv;
#endif
#ifdef PATTERN
attribute vec4 aFacade;
attribute float aStyle;
attribute float aSeed;
attribute vec4 aEdge;
attribute vec2 aUv;
varying vec4 vFacade;
varying float vStyle;
varying float vSeed;
varying vec4 vEdge;
varying vec2 vLbUv;
#endif
${opts.vertexDeclarations ?? ''}`,
      )
      .replace(
        '#include <project_vertex>',
        `#include <project_vertex>
{
  vec4 bkWorld = vec4( transformed, 1.0 );
  #ifdef USE_INSTANCING
  bkWorld = instanceMatrix * bkWorld;
  #endif
  vBkWorld = ( modelMatrix * bkWorld ).xyz;
}
vOcc = vec4( 0.0 );
#ifdef BAKE_VERTEX
vOcc = texture2D( uBake, bakeUv );
#endif
#ifdef BAKE_INSTANCE
vOcc = texture2D( uBake, instanceBakeUv );
#endif
#ifdef PATTERN
vFacade = aFacade;
vStyle = aStyle;
vSeed = aSeed;
vEdge = aEdge;
vLbUv = aUv;
#endif
${opts.vertexFragment ?? ''}`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
uniform sampler2D uBake;
uniform float uShadowStrength;
uniform float uAoStrength;
uniform float uAoMin;
uniform float uAoDirect;
uniform vec3 uBakePlane;
varying vec4 vOcc;
varying vec3 vBkWorld;
${bakedVisibilityFunctions()}
vec4 gBakedOcc = vec4( 0.0 );
float gRough = -1.0;
float gMetal = -1.0;
${NOISE_GLSL}
${ROOM_GLSL}
#ifdef PATTERN
${PATTERN_GLSL}
#endif
#ifdef LAMPS
${LAMP_GLSL}
#endif
${opts.extraDeclarations ?? ''}`,
      )
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
#ifdef PATTERN
{
  int si = int( vStyle + 0.5 );
  vec4 A = uStyA[ si ];
  vec4 B = uStyB[ si ];
  vec4 C = uStyC[ si ];
  vec4 D = uStyD[ si ];
  float kind = A.x;
  float u = vFacade.x;
  float v = vFacade.y;
  float H = vFacade.w;
  vec3 base = diffuseColor.rgb;
  vec3 col = base;
  vec3 joint = B.rgb;
  float jw = A.w;
  float vari = B.w;
  gRough = C.x;
  gMetal = C.y;
  gExterior = D.y;
  gSpec = D.z;
  float fw = max( max( fwidth( u ), fwidth( v ) ), 1e-4 );
  float part = floor( vSeed + 0.5 );
  if ( kind > 0.5 && kind < 1.5 ) {
    // 大理石・切石の石積み：段ごとに半分ずらした目地。石ごとに色と模様の場所を変え（別の石から切り出した見え方）、
    // 雲のようなむら（D.w の強さ）、細い筋（C.w）、細かな粒と小さな穴、磨いた面の粗さのむら
    float sv = max( A.z, 1e-3 );
    float su = max( A.y, 1e-3 );
    float row = floor( v / sv );
    float cu = u / su + mod( row, 2.0 ) * 0.5;
    float cell = floor( cu );
    float aaU = max( fwidth( cu ), 1e-4 );
    float aaV = max( fwidth( v / sv ), 1e-4 );
    float jU = 1.0 - lbBand( fract( cu ), jw * sv / su, 1.0 - jw * sv / su, aaU );
    float jV = 1.0 - lbBand( fract( v / sv ), jw, 1.0 - jw, aaV );
    float h = lbHash( vec2( cell, row ) + vec2( 3.0, 7.0 ) );
    vec3 mm = lbMarble( vec2( u, v ) * 0.9 + vec2( h * 31.0, h * 17.0 ), fw * 0.9 );
    col = base * ( 1.0 + vari * ( h - 0.5 ) * 2.0 );
    col *= vec3( 1.0 + 0.035 * ( h - 0.5 ), 1.0, 1.0 - 0.05 * ( h - 0.5 ) );
    float cloud = smoothstep( 0.18, 0.82, mm.x );
    col = mix( col * ( 1.0 + 0.06 * D.w ), col * mix( vec3( 1.0 ), vec3( 0.86, 0.79, 0.7 ), D.w ), cloud );
    col *= 1.0 + 0.15 * mm.z * min( 1.0, D.w + 0.3 );
    col = mix( col, joint * 0.97, mm.y * C.w );
    // 箱（柱・笠石）の面の端に目地の半分が出ないように（段ごとに半分ずれるので、角に点線のような目地ができる）
    float ejU = step( 2.0 * jw * sv, min( vEdge.x, vEdge.y ) );
    float ejV = step( 2.0 * jw * sv, min( vEdge.z, vEdge.w ) );
    col = mix( col, joint * 0.88, max( jU * ejU, jV * ejV ) * 0.85 );
    gRough = C.x + 0.08 * ( mm.x - 0.5 ) - 0.05 * mm.y;
  } else if ( ( kind > 1.5 && kind < 2.5 ) || ( kind > 12.5 && kind < 13.5 ) ) {
    // 木の板（幅 A.y）：部品と板ごとに丸太の芯の位置を変えた年輪、色むら（少し赤い板・黄色い板）、晩材はつやが少し鈍い
    float across = D.x < 0.5 ? v : u;
    float along = D.x < 0.5 ? u : v;
    float bw = max( A.y, 1e-3 );
    float board = floor( across / bw );
    float sd = part * 13.0 + board * 7.0;
    float h = lbHash1( sd );
    float late;
    float t = lbWood( along + h * 5.0, across - ( board + 0.5 ) * bw, sd, D.w > 0.0 ? D.w : 0.03, fw, late );
    col = base * ( 1.0 + vari * ( h - 0.5 ) * 2.0 ) * vec3( 1.0 + 0.05 * ( h - 0.5 ), 1.0, 1.0 - 0.07 * ( h - 0.5 ) );
    col *= mix( 1.0, t, C.w );
    col = mix( col, col * vec3( 0.9, 0.78, 0.68 ), late * C.w * 0.5 );
    float aa = max( fwidth( across / bw ), 1e-4 );
    float seam = 1.0 - lbBand( fract( across / bw ), jw, 1.0 - jw, aa );
    col = mix( col, joint, seam * 0.6 * step( 0.001, jw ) * step( kind, 2.5 ) );
    float wear;
    col = lbAged( col, min( min( vEdge.x, vEdge.y ), min( vEdge.z, vEdge.w ) ), vec2( u, v ) + part * 1.7, fw, wear );
    gRough = C.x + 0.06 * late * C.w + 0.15 * wear;
    #ifdef INSCRIPTION
    if ( kind > 12.5 ) {
      // 金文字：字の形（テクスチャのアルファ）だけ金箔。箔のわずかなむらと、すれて薄くなった所
      float a = texture2D( uInscription, vLbUv ).a;
      float leaf = 0.9 + 0.2 * lbNoise( vec2( u, v ) * 140.0 );
      a *= 0.82 + 0.18 * smoothstep( 0.2, 0.6, lbNoise( vec2( u, v ) * 23.0 + 3.0 ) );
      col = mix( col, joint * leaf, a );
      gMetal = a;
      gRough = mix( gRough, 0.3, a );
    }
    #endif
  } else if ( kind > 2.5 && kind < 3.5 ) {
    // 鏡板：四角い板の縁に細い溝、上と左の縁は光り、下と右は陰る（板の厚みの見せかけ）。
    // 板と縦框は縦の木目、横框は横の木目（框組みの継ぎ目で木目の向きが変わる）
    float pu = u / max( A.y, 1e-3 );
    float pv = v / max( A.z, 1e-3 );
    vec2 cid = floor( vec2( pu, pv ) );
    vec2 f = vec2( fract( pu ), fract( pv ) );
    vec2 aa = max( vec2( fwidth( pu ), fwidth( pv ) ), vec2( 1e-4 ) );
    float m = jw;
    float inside = lbBand( f.x, m, 1.0 - m, aa.x ) * lbBand( f.y, m, 1.0 - m, aa.y );
    float groove = lbBand( f.x, m - 0.03, m + 0.012, aa.x ) + lbBand( f.x, 1.0 - m - 0.012, 1.0 - m + 0.03, aa.x );
    groove += lbBand( f.y, m - 0.03, m + 0.012, aa.y ) + lbBand( f.y, 1.0 - m - 0.012, 1.0 - m + 0.03, aa.y );
    groove = clamp( groove, 0.0, 1.0 ) * ( 1.0 - inside * 0.6 );
    float top = lbBand( f.y, 1.0 - m - 0.07, 1.0 - m, aa.y ) * lbBand( f.x, m, 1.0 - m, aa.x );
    float bottom = lbBand( f.y, m, m + 0.07, aa.y ) * lbBand( f.x, m, 1.0 - m, aa.x );
    float rail = ( 1.0 - step( m, f.y ) * step( f.y, 1.0 - m ) ) * step( m, f.x ) * step( f.x, 1.0 - m );
    float panelIn = step( m, f.x ) * step( f.x, 1.0 - m ) * step( m, f.y ) * step( f.y, 1.0 - m );
    float along = rail > 0.5 ? u : v;
    float across = rail > 0.5 ? v : u;
    float sd = cid.x * 3.0 + cid.y * 11.0 + rail * 5.0 + panelIn * 2.0 + floor( vFacade.z * 7.0 + vFacade.w * 3.0 );
    float late;
    float t = lbWood( along, across - ( cid.x + 0.5 ) * A.y, sd, D.w > 0.0 ? D.w : 0.03, fw, late );
    float h = lbHash1( sd + 0.5 );
    col = base * ( 1.0 + vari * ( h - 0.5 ) * 2.0 );
    col *= mix( 1.0, t, C.w );
    col = mix( col, col * vec3( 0.9, 0.78, 0.68 ), late * C.w * 0.5 );
    col *= mix( 1.06, 1.0, inside );
    col = mix( col, joint, groove * 0.8 );
    col *= 1.0 + 0.16 * top - 0.18 * bottom;
    float wear;
    col = lbAged( col, min( min( vEdge.x, vEdge.y ), min( vEdge.z, vEdge.w ) ), vec2( u, v ), fw, wear );
    gRough = C.x + 0.06 * late * C.w + 0.08 * groove + 0.15 * wear;
  } else if ( kind > 3.5 && kind < 4.5 ) {
    // 窓の外：上は明るい空、下は淡い緑の庭（自ら光る）。A.y = 窓の下端の高さ、A.z = 窓の高さ（ワールド）
    float t = clamp( ( vBkWorld.y - A.y ) / max( A.z, 1e-3 ), 0.0, 1.0 );
    float n = lbFbm( vec2( vBkWorld.x + vBkWorld.z, vBkWorld.y ) * 2.5 + 2.0 );
    vec3 sky = mix( uGlassBottom, uGlassTop, smoothstep( 0.15, 0.85, t ) );
    sky = mix( sky, sky * vec3( 0.95, 0.98, 0.9 ), ( 1.0 - smoothstep( 0.0, 0.4, t ) ) * n * 0.45 );
    col = sky;
    gEmissive = C.z;
  } else if ( kind > 4.5 && kind < 5.5 ) {
    gEmissive = C.z;
  } else if ( kind > 11.5 && kind < 12.5 ) {
    // 色ガラスの笠：上の方は濃く、下の縁は内の灯りが透けて明るい。拡散の色は残し（光と映り込みを受ける）、わずかに光る
    float t = clamp( v / max( H, 1e-3 ), 0.0, 1.0 );
    col = base * mix( 1.25, 0.8, sin( 3.14159 * t ) );
    gEmissive = C.z;
    gKeepDiffuse = 1.0;
  } else if ( kind > 5.5 && kind < 6.5 ) {
    // 真鍮：磨いた面のわずかなくすみと、粗さのむら（映り込みが均一なプラスチックのように見えないように）
    float n = lbFbm( vBkWorld.xz * 11.0 + vBkWorld.y * 9.0 );
    col = base * ( 0.9 + 0.2 * n );
    gRough = C.x + 0.14 * ( n - 0.5 );
  } else if ( kind > 10.5 && kind < 11.5 ) {
    // 革：大きなむら（使い込んだ所は明るく、しわの所は暗く）と、細かな型押しの粒（近づいたときだけ見える）。粗さもむらにする
    vec3 wp = vBkWorld;
    float fww = max( max( fwidth( wp.x ), fwidth( wp.y ) ), fwidth( wp.z ) ) + 1e-4;
    float big = lbFbm( wp.xy * 5.0 + wp.zx * 3.7 );
    float grain = mix( 0.5, lbNoise( wp.xz * 160.0 + wp.y * 113.0 ), lbKeep( fww * 160.0 ) );
    col = base * ( 0.86 + 0.28 * big ) * ( 0.95 + 0.1 * grain );
    gRough = C.x + 0.1 * ( grain - 0.5 ) + 0.14 * ( big - 0.5 );
  } else if ( kind > 6.5 && kind < 7.5 ) {
    // 漆喰・石のむら
    float n = lbFbm( vBkWorld.xy * 2.1 + vBkWorld.zx * 1.7 );
    col = base * ( 1.0 + vari * ( n - 0.5 ) * 2.0 );
  } else if ( kind > 7.5 && kind < 8.5 ) {
    // 床板・段板：幅 A.z の板を u の向きに張り、板ごとに継ぎ目の位置をずらす。板ごとの年輪と色むら、継ぎ目の際のわずかな面取りの陰
    float sv = max( A.z, 1e-3 );
    float row = floor( v / sv );
    float h = lbHash( vec2( row, 11.0 ) + vec2( part, 0.0 ) );
    float cu = u / max( A.y, 1e-3 ) + h;
    float cell = floor( cu );
    float h2 = lbHash( vec2( cell, row ) + vec2( 0.0, part ) );
    float aaU = max( fwidth( cu ), 1e-4 );
    float aaV = max( fwidth( v / sv ), 1e-4 );
    float jU = 1.0 - lbBand( fract( cu ), 0.008, 0.992, aaU );
    float jV = 1.0 - lbBand( fract( v / sv ), jw, 1.0 - jw, aaV );
    float late;
    float t = lbWood( u + h2 * 7.0, v - ( row + 0.5 ) * sv, cell * 17.0 + row * 5.0 + part, D.w > 0.0 ? D.w : 0.03, fw, late );
    col = base * ( 1.0 + vari * ( h2 - 0.5 ) * 2.0 ) * vec3( 1.0 + 0.05 * ( h2 - 0.5 ), 1.0, 1.0 - 0.07 * ( h2 - 0.5 ) );
    col *= mix( 1.0, t, C.w );
    col = mix( col, col * vec3( 0.9, 0.78, 0.68 ), late * C.w * 0.5 );
    float ev = min( fract( v / sv ), 1.0 - fract( v / sv ) ) * sv;
    col *= 1.0 - 0.12 * ( 1.0 - smoothstep( 0.0, 0.012 + fw, ev ) );
    col = mix( col, joint, max( jU, jV ) * 0.7 );
    float wear;
    col = lbAged( col, min( min( vEdge.x, vEdge.y ), min( vEdge.z, vEdge.w ) ), vec2( u, v ) + part * 1.7, fw, wear );
    gRough = C.x + 0.05 * late * C.w + 0.06 * ( h2 - 0.5 ) + 0.15 * wear;
  } else if ( kind > 8.5 && kind < 9.5 ) {
    // 葉：葉の中ほどの筋と、先ほど明るい色
    float t = clamp( v / max( H, 1e-3 ), 0.0, 1.0 );
    col = base * mix( 0.8, 1.15, t );
  } else if ( kind > 9.5 && kind < 10.5 ) {
    // 紙：頁の重なりの細い線
    float l = lbNoise( vec2( u * 3.0, v * 260.0 ) );
    col = base * ( 0.94 + 0.08 * l );
  }
  diffuseColor.rgb = col;
}
#endif`,
      )
      .replace(
        '#include <normal_fragment_maps>',
        `#include <normal_fragment_maps>
#ifdef PATTERN
${BEVEL_GLSL}
#endif
${opts.normalFragment ?? ''}`,
      )
      .replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
#ifdef PATTERN
totalEmissiveRadiance += diffuseColor.rgb * gEmissive;
if ( gEmissive > 0.0 && gKeepDiffuse < 0.5 ) diffuseColor.rgb *= 0.35;
#endif
${opts.colorFragment ?? ''}`,
      )
      .replace(
        '#include <roughnessmap_fragment>',
        `#include <roughnessmap_fragment>
if ( gRough >= 0.0 ) roughnessFactor = gRough;`,
      )
      .replace(
        '#include <metalnessmap_fragment>',
        `#include <metalnessmap_fragment>
if ( gMetal >= 0.0 ) metalnessFactor = gMetal;`,
      )
      .replace(
        '#include <lights_fragment_begin>',
        `{
  vec4 occ = vOcc;
  #ifdef BAKE_PLANE
  vec2 bakeUv = vec2( ( vBkWorld.x - uBakePlane.x ) * uBakePlane.z + 0.5, 0.5 - ( vBkWorld.z - uBakePlane.y ) * uBakePlane.z );
  vec2 edgeDist = min( bakeUv, 1.0 - bakeUv );
  float fadeIn = smoothstep( 0.0, 0.03, min( edgeDist.x, edgeDist.y ) );
  occ = clamp( texture2D( uBake, clamp( bakeUv, 0.0, 1.0 ) ), 0.0, 1.0 ) * fadeIn;
  #endif
  gBakedOcc = clamp( occ, 0.0, 1.0 );
  gBakedVis = 1.0 - uShadowStrength * gBakedOcc.rba;
  #ifdef ROOM_SUN
  gInterior = roomInterior( vBkWorld ) * ( 1.0 - gExterior );
  gBakedVis.z *= gInterior;
  // 部屋の中は主光・補助光を弱める（窓の日差しとランプの灯りを際立たせる）
  gBakedVis.xy *= mix( vec2( 1.0 ), uRoomLight.xy, gInterior );
  #else
  gBakedVis.z = 0.0;
  #endif
}
${lightsBeginWithBakedVisibility()}`,
      )
      .replace(
        '#include <lights_fragment_maps>',
        `#include <lights_fragment_maps>
#ifdef BAKE_NO_IBL_DIFFUSE
iblIrradiance = vec3( 0.0 );
#endif`,
      )
      .replace(
        '#include <lights_fragment_end>',
        `#include <lights_fragment_end>
{
  float ao = max( 1.0 - uAoStrength * gBakedOcc.g, uAoMin );
  reflectedLight.indirectDiffuse *= ao * mix( vec3( 1.0 ), uRoomLight.z * uRoomTint, gInterior );
  reflectedLight.directDiffuse *= mix( 1.0, ao, uAoDirect );
  reflectedLight.indirectSpecular *= mix( 1.0, ao, 0.7 ) * gSpec;
  #ifdef LAMPS
  // ランプと燭台の灯り（影なし。届く距離で弱め、狭いすき間ほど AO で弱める）
  vec3 lampSum = vec3( 0.0 );
  for ( int i = 0; i < ${MAX_LAMPS}; i++ ) {
    if ( i >= uLampCount ) break;
    vec4 lp = uLampPos[ i ];
    vec3 Lw = lp.xyz - vBkWorld;
    float d = length( Lw );
    float fall = clamp( 1.0 - d / lp.w, 0.0, 1.0 );
    fall *= fall;
    vec3 Lv = ( viewMatrix * vec4( Lw / max( d, 1e-4 ), 0.0 ) ).xyz;
    float ndl = max( dot( normal, Lv ), 0.0 ) * 0.8 + 0.2;
    lampSum += uLampCol[ i ].rgb * fall * ndl;
  }
  reflectedLight.directDiffuse += lampSum * mix( 1.0, ao, uLampAo ) * BRDF_Lambert( diffuseColor.rgb );
  #endif
}
${opts.extraFragment ?? ''}`,
      );
  };
  const key = `library-${opts.mode}-${styles.length ? 'pattern' : 'plain'}-${++materialId}`;
  material.customProgramCacheKey = () => key;
  return {
    material,
    uniforms,
    setBake: (texture: THREE.Texture) => {
      uniforms.uBake.value = texture;
    },
  };
}

let materialId = 0;
