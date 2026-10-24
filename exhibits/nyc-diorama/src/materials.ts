import * as THREE from 'three';
import { bakedVisibilityFunctions, lightsBeginWithBakedVisibility } from './bakedLighting';

/**
 * 外壁の様式（窓の並び・色・つや）。番号は aStyle 属性で頂点に持たせる。
 *  kind 0 = 無地、1 = 四角い窓の並び、2 = 縦の窓の帯（アール・デコ）、3 = ガラスのカーテンウォール、
 *  4 = 横の帯のガラス、5 = 大きな窓枠のガラス（桟橋の上屋）、6 = 石積み（板張りにも使う）、
 *  7 = 斜めの格子（橋のトラス。部材のない所は抜く）、8 = 手すり（柱と横木。ほかは抜く）、9 = 縦の板と帯（給水タンク）
 */
export interface FacadeStyle {
  kind: number;
  /** 窓の列の間隔と階の高さ */
  bay: number;
  floor: number;
  /** 窓の幅と高さ（列の間隔・階の高さに対する割合） */
  winW: number;
  winH: number;
  /** 窓の色 */
  window: string;
  /** 窓枠・柱・帯の色 */
  frame: string;
  /** 1 階の高さ（店の大きな窓）。0 でなし */
  ground: number;
  /** ガラスらしさ（0〜1。窓の部分のつやと映り込み） */
  glass: number;
  /** 窓ごとの明るさのばらつき */
  variation: number;
  /** 面の端の窓のない幅 */
  margin: number;
  /** 上端の帯（コーニス）の高さ */
  cornice: number;
  /**
   * 建物らしい仕上げの強さ（0〜1）：足もとほど暗い高さのグラデーション、窓の上端のくぼみの影、明るい窓台。
   * 船・桟橋・橋の部材など、建物でない形には 0
   */
  grade?: number;
  /** 屋上の手すり壁の上面を白に寄せる割合（既定は config.buildings.parapetLighten） */
  parapet?: number;
  /** 屋上（段の上面）の色。既定は明るい灰色（config.wallColors.roof）。石の塔は外壁と同じ石の色にする */
  roofColor?: string;
}

export const MAX_STYLES = 24;

export interface BakeSource {
  texture: THREE.Texture;
}

const placeholder = (() => {
  const t = new THREE.DataTexture(new Uint8Array([0, 0, 0, 255]), 1, 1);
  t.needsUpdate = true;
  return t;
})();

const FACADE_GLSL = /* glsl */ `
uniform vec4 uFacadeA[${MAX_STYLES}];
uniform vec4 uFacadeB[${MAX_STYLES}];
uniform vec4 uFacadeC[${MAX_STYLES}];
uniform vec4 uFacadeD[${MAX_STYLES}];
uniform vec4 uFacadeE[${MAX_STYLES}];
uniform vec4 uFacadeGrad;
varying vec4 vFacade;
varying float vStyle;
float fcHash( vec2 p ) {
  p = fract( p * vec2( 123.34, 456.21 ) );
  p += dot( p, p + 45.32 );
  return fract( p.x * p.y );
}
// 0〜1 の範囲の帯（境目をなめらかに。aa は 1 画素の幅）
float fcBand( float x, float a, float b, float aa ) {
  return smoothstep( a - aa, a + aa, x ) * ( 1.0 - smoothstep( b - aa, b + aa, x ) );
}
`;

/**
 * 焼き込んだ影（主光・補助光）と空からの遮蔽を使う標準マテリアル。
 * vertex: 頂点ごとの焼き込み（bakeUv）、instance: インスタンスごと（instanceBakeUv）、plane: 水平面に焼き込んだテクスチャ（ワールド座標で読む）
 * facade: 外壁の模様（aFacade, aStyle 属性）
 */
export function createBakedMaterial(opts: {
  mode: 'vertex' | 'instance' | 'plane';
  /** 外壁の模様。gradient は高さのグラデーション（足もとの明るさ、戻る高さ、高い所の上乗せ）、groundY はその高さを測る地面の高さ（ワールド） */
  facade?: { styles: FacadeStyle[]; gradient?: [number, number, number]; groundY?: number };
  /** 焼き込んだ空の遮蔽を、日の当たる面の明るさにも掛ける割合（0〜1。すき間や足もとを暗く） */
  aoOnDirect?: number;
  color?: THREE.ColorRepresentation;
  map?: THREE.Texture;
  vertexColors?: boolean;
  roughness?: number;
  metalness?: number;
  shadowStrength: number;
  aoStrength: number;
  /** 空からの遮蔽が最も強い所に残す明るさ */
  aoMin?: number;
  /** plane のとき：焼き込みの範囲 */
  plane?: { centerX: number; centerZ: number; size: number };
  /** 色を決めたあと（照明の前）に足す処理（GLSL。diffuseColor を変えられる） */
  colorFragment?: string;
  /** 法線を決めたあと（照明の前）に足す処理（GLSL。normal を変えられる） */
  normalFragment?: string;
  /** 照明の後に足す処理（GLSL）と宣言・uniform */
  extraFragment?: string;
  extraDeclarations?: string;
  extraUniforms?: Record<string, THREE.IUniform>;
  side?: THREE.Side;
  /** 環境マップを直接持たせるとき（scene.environment ではなく）。envMapIntensity はこのときだけ効く */
  envMap?: THREE.Texture;
  envMapIntensity?: number;
  /** ガラスの映り込みの強め方（1 + glassBoost 倍） */
  glassBoost?: number;
  /** 空からの光（環境光）の色の補正（R・G・B の倍率）。陰の面の色味を調整する */
  ambientTint?: [number, number, number];
  /**
   * 環境マップを拡散光にも使うか（既定は使う）。false では映り込み（つやのある面の反射）だけに使い、
   * 拡散光は半球光（空と床の色）から受ける（シリーズの照明）
   */
  envDiffuse?: boolean;
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
  });
  const styles = opts.facade?.styles ?? [];
  const pack = (fn: (s: FacadeStyle) => [number, number, number, number]) => {
    const arr = Array.from({ length: MAX_STYLES }, () => new THREE.Vector4());
    styles.forEach((s, i) => arr[i].set(...fn(s)));
    return arr;
  };
  const col = (c: string) => new THREE.Color(c);
  const uniforms: Record<string, THREE.IUniform> = {
    uBake: { value: placeholder as THREE.Texture },
    uShadowStrength: { value: opts.shadowStrength },
    uAoStrength: { value: opts.aoStrength },
    uAoMin: { value: opts.aoMin ?? 0.25 },
    uGlassBoost: { value: opts.glassBoost ?? 1.6 },
    uAmbientTint: { value: new THREE.Color(...(opts.ambientTint ?? [1, 1, 1])) },
    uBakePlane: { value: new THREE.Vector3(opts.plane?.centerX ?? 0, opts.plane?.centerZ ?? 0, 1 / (opts.plane?.size ?? 1)) },
    uFacadeA: { value: pack((s) => [s.bay, s.floor, s.winW, s.winH]) },
    uFacadeB: { value: pack((s) => [...col(s.window).toArray(), s.kind] as [number, number, number, number]) },
    uFacadeC: { value: pack((s) => [...col(s.frame).toArray(), s.ground] as [number, number, number, number]) },
    uFacadeD: { value: pack((s) => [s.glass, s.variation, s.margin, s.cornice]) },
    uFacadeE: { value: pack((s) => [s.grade ?? 0, 0, 0, 0]) },
    // 高さのグラデーション：地面の近くの明るさ、明るさが戻る高さ、高い所の明るさの上乗せ
    uFacadeGrad: { value: new THREE.Vector4(...(opts.facade?.gradient ?? [1, 1, 0]), opts.facade?.groundY ?? 0) },
    uAoDirect: { value: opts.aoOnDirect ?? 0 },
    ...opts.extraUniforms,
  };
  const defines: Record<string, string> = {};
  defines[`BAKE_${opts.mode.toUpperCase()}`] = '';
  if (opts.facade) defines.FACADE = '';
  if (opts.envDiffuse === false) defines.BAKE_NO_IBL_DIFFUSE = '';
  material.defines = { ...(material.defines ?? {}), ...defines };

  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
uniform sampler2D uBake;
varying vec3 vOcc;
varying vec3 vBkWorld;
#ifdef BAKE_VERTEX
attribute vec2 bakeUv;
#endif
#ifdef BAKE_INSTANCE
attribute vec2 instanceBakeUv;
#endif
#ifdef FACADE
attribute vec4 aFacade;
attribute float aStyle;
varying vec4 vFacade;
varying float vStyle;
#endif`,
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
vOcc = vec3( 0.0 );
#ifdef BAKE_VERTEX
vOcc = texture2D( uBake, bakeUv ).rgb;
#endif
#ifdef BAKE_INSTANCE
vOcc = texture2D( uBake, instanceBakeUv ).rgb;
#endif
#ifdef FACADE
vFacade = aFacade;
vStyle = aStyle;
#endif`,
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
uniform float uGlassBoost;
uniform vec3 uAmbientTint;
uniform vec3 uBakePlane;
varying vec3 vOcc;
varying vec3 vBkWorld;
${bakedVisibilityFunctions()}
vec3 gBakedOcc = vec3( 0.0 );
float gGlass = 0.0;
#ifdef FACADE
${FACADE_GLSL}
#endif
${opts.extraDeclarations ?? ''}`,
      )
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
#ifdef FACADE
{
  int si = int( vStyle + 0.5 );
  vec4 A = uFacadeA[ si ];
  vec4 B = uFacadeB[ si ];
  vec4 C = uFacadeC[ si ];
  vec4 D = uFacadeD[ si ];
  vec4 E = uFacadeE[ si ];
  float kind = B.w;
  float u = vFacade.x;
  float v = vFacade.y;
  float W = vFacade.z;
  float H = vFacade.w;
  vec3 wall = diffuseColor.rgb;
  vec3 winCol = B.rgb;
  vec3 frame = C.rgb;
  float gf = C.w;
  float bay = max( A.x, 1e-3 );
  float flr = max( A.y, 1e-3 );
  // 面の中心から数えた列（左右対称にそろえる）
  float cu = u - W * 0.5;
  float su = cu / bay;
  float iu = floor( su + 0.5 );
  float fu = su - iu;
  float aaU = max( fwidth( su ), 1e-4 );
  float vv = ( v - gf ) / flr;
  float iv = floor( vv );
  float fv = vv - iv;
  float aaV = max( fwidth( vv ), 1e-4 );
  float h = fcHash( vec2( iu + 17.0 * vStyle, iv ) );
  float edge = min( u, W - u );
  float inside = smoothstep( D.z - 0.004, D.z + 0.004, edge );
  float topBand = 1.0 - smoothstep( D.w - 0.004, D.w + 0.004, H - v );
  vec3 col = wall;
  float glassMask = 0.0;
  if ( kind > 0.5 && kind < 1.5 ) {
    // 四角い窓の並び
    float m = fcBand( fu, -A.z * 0.5, A.z * 0.5, aaU ) * fcBand( fv, 0.5 - A.w * 0.5, 0.5 + A.w * 0.5, aaV );
    m *= inside * step( gf, v ) * ( 1.0 - topBand );
    // 窓枠（窓のまわりの細い明るい縁）
    float fm = fcBand( fu, -A.z * 0.5 - 0.08, A.z * 0.5 + 0.08, aaU ) * fcBand( fv, 0.5 - A.w * 0.5 - 0.07, 0.5 + A.w * 0.5 + 0.07, aaV );
    fm *= inside * step( gf, v ) * ( 1.0 - topBand );
    col = mix( col, frame, fm * 0.85 );
    vec3 w = winCol * mix( 1.0 - D.y, 1.0 + D.y, h );
    // 窓の上の方は空が映って明るい
    w = mix( w, w * 1.35 + 0.08, smoothstep( 0.2, 0.95, fv ) * 0.5 );
    // 窓は壁より奥にあるので、上端にまぐさの影が落ちる（奥行きの見せかけ）
    float wy = clamp( ( fv - ( 0.5 - A.w * 0.5 ) ) / max( A.w, 1e-3 ), 0.0, 1.0 );
    w *= mix( 1.0, 0.6, smoothstep( 0.66, 0.98, wy ) * E.x );
    col = mix( col, w, m );
    // 窓の下の明るい窓台（光を受ける水平な縁）
    float sill = fcBand( fv, 0.5 - A.w * 0.5 - 0.09, 0.5 - A.w * 0.5 - 0.015, aaV ) * fcBand( fu, -A.z * 0.5 - 0.1, A.z * 0.5 + 0.1, aaU );
    sill *= inside * step( gf, v ) * ( 1.0 - topBand );
    col = mix( col, mix( frame, vec3( 1.0 ), 0.35 ), sill * 0.75 * E.x );
    glassMask = m;
  } else if ( kind > 1.5 && kind < 2.5 ) {
    // 縦の窓の帯（柱が上まで通る）。階ごとの腰壁は少し暗い
    float colMask = fcBand( fu, -A.z * 0.5, A.z * 0.5, aaU ) * inside * step( gf, v ) * ( 1.0 - topBand );
    float win = fcBand( fv, 0.5 - A.w * 0.5, 0.5 + A.w * 0.5, aaV );
    vec3 spandrel = mix( wall, winCol, 0.72 );
    vec3 w = winCol * mix( 1.0 - D.y, 1.0 + D.y, h );
    float wy2 = clamp( ( fv - ( 0.5 - A.w * 0.5 ) ) / max( A.w, 1e-3 ), 0.0, 1.0 );
    w *= mix( 1.0, 0.68, smoothstep( 0.6, 0.98, wy2 ) * E.x );
    vec3 strip = mix( spandrel, w, win );
    col = mix( col, strip, colMask );
    glassMask = colMask * win;
  } else if ( kind > 2.5 && kind < 3.5 ) {
    // ガラスのカーテンウォール：細い縦の方立てと、うっすらした階の線。
    // 映り込みの代わりに、上ほど空の明るさ、下ほど街の濃い青になるむらと、ところどころ明るい縦の筋を入れる
    float mull = 1.0 - fcBand( fu, -0.5 + 0.06, 0.5 - 0.06, aaU );
    float floorLine = 1.0 - fcBand( fv, 0.04, 0.96, aaV );
    vec3 g = winCol * mix( 1.0 - D.y, 1.0 + D.y, h );
    float ht = clamp( v / max( H, 1e-3 ), 0.0, 1.0 );
    g *= mix( 0.85, 1.5, smoothstep( 0.05, 0.95, ht ) );
    float streak = smoothstep( 0.55, 0.95, fcHash( vec2( floor( u / 0.16 ), 7.0 ) ) ) * smoothstep( 0.25, 0.7, ht );
    g = mix( g, vec3( 0.86, 0.93, 1.0 ), streak * 0.35 + smoothstep( 0.8, 1.0, ht ) * 0.25 );
    col = mix( g, frame, max( mull * 0.8, floorLine * 0.35 ) );
    glassMask = 1.0 - mull * 0.8;
  } else if ( kind > 3.5 && kind < 4.5 ) {
    // 横の帯のガラス：階ごとの白い帯と縦の白い方立て
    float band = 1.0 - fcBand( fv, 0.0, 1.0 - A.w, aaV );
    float mull = 1.0 - fcBand( fu, -0.5 + A.z * 0.5, 0.5 - A.z * 0.5, aaU );
    vec3 g = winCol * mix( 1.0 - D.y, 1.0 + D.y, h );
    g = mix( g, g * 1.3 + 0.05, smoothstep( 0.0, 1.0, fv ) * 0.4 );
    col = mix( g, frame, max( band, mull ) );
    glassMask = ( 1.0 - band ) * ( 1.0 - mull );
    if ( v < gf ) {
      col = mix( frame, g, 0.6 );
    }
  } else if ( kind > 4.5 && kind < 5.5 ) {
    // 大きな窓枠のガラス
    float mull = 1.0 - fcBand( fu, -0.5 + A.z * 0.5, 0.5 - A.z * 0.5, aaU );
    float bandV = 1.0 - fcBand( fv, 0.5 - A.w * 0.5, 0.5 + A.w * 0.5, aaV );
    vec3 g = winCol * mix( 1.0 - D.y, 1.0 + D.y, h );
    g = mix( g * 0.85, g * 1.15, fv );
    col = mix( g, frame, max( mull, bandV ) );
    glassMask = ( 1.0 - mull ) * ( 1.0 - bandV );
  } else if ( kind > 6.5 && kind < 7.5 ) {
    // 斜めの格子（橋のトラス）：上下の弦材と、斜めの部材
    float t1 = fract( ( u + v ) / bay );
    float t2 = fract( ( u - v ) / bay );
    float aa = max( fwidth( ( u + v ) / bay ), 1e-4 );
    float diag = max( 1.0 - fcBand( t1, A.z, 1.0 - A.z, aa ), 1.0 - fcBand( t2, A.z, 1.0 - A.z, aa ) );
    float chord = max( 1.0 - smoothstep( 0.0, 0.012, v ), 1.0 - smoothstep( 0.0, 0.012, H - v ) );
    float m = max( diag, chord );
    // 部材のない所は抜く（向こうが透けて見える）
    if ( m < 0.5 ) discard;
    col = wall;
    glassMask = 0.0;
  } else if ( kind > 7.5 && kind < 8.5 ) {
    // 手すり：一定の間隔の細い柱と、上・中ほど・下の横木。ほかは抜く
    float sp = u / bay;
    float fp = fract( sp );
    float aap = max( fwidth( sp ), 1e-4 );
    float post = 1.0 - fcBand( fp, A.z * 0.5, 1.0 - A.z * 0.5, aap );
    float aav = max( fwidth( v ), 1e-5 );
    float rail = max( 1.0 - smoothstep( D.w - aav, D.w + aav, H - v ), 1.0 - smoothstep( gf - aav, gf + aav, v ) );
    rail = max( rail, fcBand( v, H * 0.5 - D.w * 0.4, H * 0.5 + D.w * 0.4, aav ) );
    if ( max( post, rail ) < 0.5 ) discard;
    col = wall;
    glassMask = 0.0;
  } else if ( kind > 8.5 && kind < 9.5 ) {
    // 木の板を縦に並べた樽（屋上の給水タンク）：そろった縦の継ぎ目と、等間隔の帯（鉄の輪）
    float sx = u / bay;
    float jx = fract( sx );
    float aax = max( fwidth( sx ), 1e-4 );
    float joint = 1.0 - fcBand( jx, 0.07, 0.93, aax );
    float hv = v / flr;
    float jy = fract( hv );
    float aay = max( fwidth( hv ), 1e-4 );
    float hoop = 1.0 - fcBand( jy, 0.08, 0.92, aay );
    float hs = fcHash( vec2( floor( sx ), 3.0 ) );
    col = wall * mix( 1.0 - D.y, 1.0 + D.y, hs );
    col = mix( col, frame, max( joint * 0.45, hoop * 0.85 ) );
    glassMask = 0.0;
  } else if ( kind > 5.5 && kind < 6.5 ) {
    // 石積み：横の目地と、段ごとにずらした縦の目地。石ごとにわずかに色が違う
    float row = floor( v / flr );
    float off = mod( row, 2.0 ) * 0.5;
    float sx = u / bay + off;
    float jx = fract( sx );
    float jy = fract( v / flr );
    float aax = max( fwidth( sx ), 1e-4 );
    float aay = max( fwidth( v / flr ), 1e-4 );
    float joint = max( 1.0 - fcBand( jx, 0.035, 0.965, aax ), 1.0 - fcBand( jy, 0.06, 0.94, aay ) );
    float hs = fcHash( vec2( floor( sx ), row ) );
    col = wall * mix( 1.0 - D.y, 1.0 + D.y, hs );
    col = mix( col, frame, joint * 0.6 );
  }
  // 1 階（店の大きな窓）
  if ( gf > 0.0 && v < gf && ( kind > 0.5 && kind < 2.5 ) ) {
    float sf = fcBand( fu, -0.42, 0.42, aaU ) * fcBand( v / gf, 0.12, 0.85, max( fwidth( v / gf ), 1e-4 ) ) * inside;
    col = mix( frame, winCol * 1.1, sf );
    glassMask = sf;
  }
  // 上端の帯（コーニス）
  col = mix( col, frame, topBand * 0.7 );
  // 高さのグラデーション：足もとほど暗く落ち着き、高い所はわずかに明るい（別々の形を地面になじませる）
  {
    float hy = vBkWorld.y - uFacadeGrad.w;
    float g = mix( uFacadeGrad.x, 1.0, smoothstep( 0.0, uFacadeGrad.y, hy ) ) * ( 1.0 + uFacadeGrad.z * smoothstep( 1.5, 6.5, hy ) );
    col *= mix( 1.0, g, E.x );
  }
  diffuseColor.rgb = col;
  gGlass = glassMask * D.x;
}
#endif`,
      )
      .replace(
        '#include <normal_fragment_maps>',
        `#include <normal_fragment_maps>
${opts.normalFragment ?? ''}`,
      )
      .replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
${opts.colorFragment ?? ''}`,
      )
      .replace(
        '#include <roughnessmap_fragment>',
        `#include <roughnessmap_fragment>
roughnessFactor = mix( roughnessFactor, 0.07, gGlass );`,
      )
      .replace(
        '#include <metalnessmap_fragment>',
        `#include <metalnessmap_fragment>
metalnessFactor = mix( metalnessFactor, 0.25, gGlass );`,
      )
      .replace(
        '#include <lights_fragment_begin>',
        `{
  vec3 occ = vOcc;
  #ifdef BAKE_PLANE
  vec2 bakeUv = vec2( ( vBkWorld.x - uBakePlane.x ) * uBakePlane.z + 0.5, 0.5 - ( vBkWorld.z - uBakePlane.y ) * uBakePlane.z );
  vec2 edgeDist = min( bakeUv, 1.0 - bakeUv );
  float fadeIn = smoothstep( 0.0, 0.03, min( edgeDist.x, edgeDist.y ) );
  occ = clamp( texture2D( uBake, clamp( bakeUv, 0.0, 1.0 ) ).rgb, 0.0, 1.0 ) * fadeIn;
  #endif
  gBakedOcc = clamp( occ, 0.0, 1.0 );
  gBakedVis = 1.0 - uShadowStrength * gBakedOcc.rb;
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
  // 暖かい照り返しの色味は石やれんがの壁だけ（ガラスは空と床の青が映る）
  reflectedLight.indirectDiffuse *= ao * mix( uAmbientTint, vec3( 1.0 ), gGlass );
  reflectedLight.directDiffuse *= mix( 1.0, ao, uAoDirect );
  reflectedLight.indirectSpecular *= mix( 1.0, ao, 0.7 );
  // ガラスは空と街の映り込みを強く
  reflectedLight.indirectSpecular *= 1.0 + uGlassBoost * gGlass;
}
${opts.extraFragment ?? ''}`,
      );
  };
  const key = `baked-${opts.mode}-${opts.facade ? 'facade' : 'plain'}-${opts.envDiffuse === false ? 'spec' : 'ibl'}-${++materialId}`;
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
