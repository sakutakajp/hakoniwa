import * as THREE from 'three';
import { BAKED_VISIBILITY_FUNCTIONS, lightsBeginWithBakedVisibility } from '../bakedLighting';

export interface PlantMaterialOptions {
  /** 'foliage' は葉（樹冠の奥を暗く、葉先を明るく）、'wood' は幹と枝 */
  kind: 'foliage' | 'wood';
  /** 幹の色（wood のとき） */
  color?: string;
  roughness: number;
  /** 樹冠の奥の暗さ 0〜1 */
  interior: number;
  /** 葉先の明るさ 0〜1 */
  tipLight: number;
  /** 葉先の色（日の当たった明るい黄緑） */
  tipColor: string;
  /** 環境光が最も遮られた所に残す明るさ（真っ黒につぶれないように） */
  aoMin: number;
  shadowStrength: number;
  aoStrength: number;
  /** 葉の細かな凹凸の細かさ（ワールド 1 あたりの数）と強さ */
  leafScale?: number;
  leafBump?: number;
  /** 葉と葉のすき間の暗さ（0 で模様なし、1 で強い） */
  leafContrast?: number;
  /** 斜めから見た面がほんのり明るくなる、苔のようなやわらかい光沢の強さと色 */
  sheen?: number;
  sheenColor?: string;
}

/**
 * 植生のマテリアル（インスタンス描画用）。
 *  - 色は木や群落ごとのインスタンスカラー（葉ごとにばらばらの色にはしない）
 *  - 葉の粒の aShade（樹冠の外側・上向きほど 1）で、葉先を明るく、樹冠の奥を暗くする
 *  - 主光・補助光の影と空からの遮蔽は、インスタンスごとに焼き込んだ値を使う（他の木や山の影が落ちる）
 *  - 光沢のないマットな質感
 */
export function createPlantMaterial(opts: PlantMaterialOptions): {
  material: THREE.MeshStandardMaterial;
  setBake: (texture: THREE.Texture) => void;
} {
  const material = new THREE.MeshStandardMaterial({
    color: opts.kind === 'wood' ? new THREE.Color(opts.color ?? '#5d4b3c') : 0xffffff,
    roughness: opts.roughness,
    metalness: 0,
  });
  const placeholder = new THREE.DataTexture(new Uint8Array([0, 0, 0, 255]), 1, 1);
  placeholder.needsUpdate = true;
  const uniforms = {
    uVgBake: { value: placeholder as THREE.Texture },
    uVgInterior: { value: opts.interior },
    uVgTip: { value: opts.tipLight },
    uVgTipColor: { value: new THREE.Color(opts.tipColor) },
    uVgAoMin: { value: opts.aoMin },
    uVgShadowStrength: { value: opts.shadowStrength },
    uVgAoStrength: { value: opts.aoStrength },
    uVgLeafScale: { value: opts.leafScale ?? 28 },
    uVgLeafBump: { value: opts.leafBump ?? 0.3 },
    uVgLeafContrast: { value: opts.leafContrast ?? 1 },
    uVgSheen: { value: opts.sheen ?? 0 },
    uVgSheenColor: { value: new THREE.Color(opts.sheenColor ?? '#d8e08a') },
  };
  const foliage = opts.kind === 'foliage';

  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
${foliage ? 'attribute float aShade;' : ''}
attribute vec2 instanceBakeUv;
uniform sampler2D uVgBake;
varying float vVgShade;
varying vec3 vVgOcc;
varying vec3 vVgPos;`,
      )
      .replace(
        '#include <project_vertex>',
        `#include <project_vertex>
vVgShade = ${foliage ? 'aShade' : '0.5'};
vVgOcc = texture2D( uVgBake, instanceBakeUv ).rgb;
vVgPos = ( modelMatrix * instanceMatrix * vec4( transformed, 1.0 ) ).xyz;`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
uniform float uVgInterior;
uniform float uVgTip;
uniform vec3 uVgTipColor;
uniform float uVgAoMin;
uniform float uVgShadowStrength;
uniform float uVgAoStrength;
uniform float uVgLeafScale;
uniform float uVgLeafBump;
uniform float uVgLeafContrast;
uniform float uVgSheen;
uniform vec3 uVgSheenColor;
varying float vVgShade;
varying vec3 vVgOcc;
varying vec3 vVgPos;
${BAKED_VISIBILITY_FUNCTIONS}
float vgHash( vec3 p ) {
  p = fract( p * 0.3183099 + 0.1 );
  p *= 17.0;
  return fract( p.x * p.y * p.z * ( p.x + p.y + p.z ) );
}
vec3 vgHash3( vec3 p ) {
  p = fract( p * vec3( 0.1031, 0.1030, 0.0973 ) );
  p += dot( p, p.yxz + 33.33 );
  return fract( ( p.xxy + p.yxx ) * p.zyx );
}
// 葉の模様：空間を小さな細胞に分け、1つの細胞を1枚の葉とみなす（最も近い点と2番目に近い点の距離）
vec4 vgLeaves( vec3 q, out vec3 rNear ) {
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
        vec3 r = g + vgHash3( ip + g ) - fp;
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
        '#include <color_fragment>',
        `#include <color_fragment>
float vgS = clamp( vVgShade, 0.0, 1.0 );
${
  foliage
    ? `// 樹冠の奥ほど暗く、外側の葉先ほど明るい黄緑に寄せる
diffuseColor.rgb *= mix( 1.0 - uVgInterior, 1.0, vgS );
diffuseColor.rgb = mix( diffuseColor.rgb, uVgTipColor * ( 0.55 + 0.45 * vgS ), uVgTip * smoothstep( 0.62, 1.0, vgS ) );
// 一枚一枚の葉：葉ごとのわずかな明暗と、葉の間の暗いすき間（色相は変えない）
vec3 vgNear;
vec4 vgLeaf = vgLeaves( vVgPos * uVgLeafScale, vgNear );
diffuseColor.rgb *= 1.0 + uVgLeafContrast * 0.28 * ( vgHash( vgLeaf.xyz ) - 0.5 );
diffuseColor.rgb *= mix( 1.0 - 0.38 * uVgLeafContrast, 1.0, smoothstep( 0.02, 0.2, vgLeaf.w ) );`
    : ''
}`,
      )
      .replace(
        '#include <normal_fragment_maps>',
        `#include <normal_fragment_maps>
${
  foliage
    ? `// 小さな丸いふくらみ（苔やブロッコリーの房のように、細胞ごとに中心から外へ向かって法線を傾ける）と、
// 細胞ごとのわずかな向きの違い
{
  vec3 dome = -vgNear * 1.6 + 0.35 * ( vgHash3( vgLeaf.xyz + 17.0 ) * 2.0 - 1.0 );
  vec3 tv = ( viewMatrix * vec4( dome, 0.0 ) ).xyz;
  normal = normalize( normal + uVgLeafBump * ( tv - normal * dot( normal, tv ) ) );
}`
    : ''
}`,
      )
      .replace(
        '#include <lights_fragment_begin>',
        `gBakedVis = 1.0 - uVgShadowStrength * clamp( vVgOcc.rb, 0.0, 1.0 );
${lightsBeginWithBakedVisibility()}`,
      )
      .replace(
        '#include <lights_fragment_end>',
        `#include <lights_fragment_end>
// 空からの光が遮られた所も、緑の重なりが読み取れる明るさは残す
reflectedLight.indirectDiffuse *= max( 1.0 - uVgAoStrength * clamp( vVgOcc.g, 0.0, 1.0 ), 0.4 ) * mix( uVgAoMin, 1.0, vgS );
${
  foliage
    ? `// 苔のようなやわらかい光沢：斜めから見た面（樹冠の輪郭）がほんのり明るい。日の当たる所ほど強い
{
  float vgNdV = clamp( dot( normal, normalize( vViewPosition ) ), 0.0, 1.0 );
  float vgRim = pow( 1.0 - vgNdV, 2.2 );
  reflectedLight.directDiffuse += diffuseColor.rgb * uVgSheenColor * ( uVgSheen * vgRim * ( 0.35 + 0.65 * gBakedVis.x ) );
}`
    : ''
}`,
      );
  };
  material.customProgramCacheKey = () => `plant-${opts.kind}`;

  return {
    material,
    setBake: (texture: THREE.Texture) => {
      uniforms.uVgBake.value = texture;
    },
  };
}
