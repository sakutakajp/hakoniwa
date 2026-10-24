import * as THREE from 'three';

/**
 * 焼き込んだ影を three.js の標準マテリアルに組み込むための共通処理。
 *
 * 平行光のループ（lights_fragment_begin）で、各ライトの光量に
 * bakedDirVisibility(ライト番号) を掛ける。ライト番号はシーンに追加した順
 * （0 = 主光、1 = 補助光）。マテリアルごとに、この関数と gBakedVis を用意する。
 */
const LOOP_ANCHOR = 'getDirectionalLightInfo( directionalLight, directLight );';
const LIGHT_ANCHOR = 'IncidentLight directLight;';

/** 主光・補助光の見かけの大きさ（半径、度）。影をぼかす大きさと同じ値を、光の映り込みの広がりにも使う */
const lightSizes = { key: 0, fill: 0 };
export function setBakedLightSizes(keyDeg: number, fillDeg: number) {
  lightSizes.key = keyDeg;
  lightSizes.fill = fillDeg;
}

export function lightsBeginWithBakedVisibility(): string {
  const chunk = THREE.ShaderChunk.lights_fragment_begin;
  if (!chunk.includes(LOOP_ANCHOR) || !chunk.includes(LIGHT_ANCHOR)) {
    console.warn('three.js の照明シェーダーの構成が想定と異なるため、焼き込んだ影を適用できません');
    return chunk;
  }
  // 平行光ごとに、焼き込んだ影を掛け、光源の大きさに合わせて映り込みの光の点を広げる（ループの後で粗さを戻す）
  return (
    chunk
      .replace(LIGHT_ANCHOR, `${LIGHT_ANCHOR}\nfloat bakedRoughBase = material.roughness;`)
      .replace(
        LOOP_ANCHOR,
        `${LOOP_ANCHOR}\n\t\tdirectLight.color *= bakedDirVisibility( UNROLLED_LOOP_INDEX );\n\t\tmaterial.roughness = bakedLightRoughness( UNROLLED_LOOP_INDEX, bakedRoughBase );`,
      ) + '\nmaterial.roughness = bakedRoughBase;\n'
  );
}

/**
 * gBakedVis（x: 主光、y: 補助光の見えている割合）を読む関数と、光源の大きさで粗さを広げる関数の定義。
 * 大きな光源（柔らかい光）は、つやのある面に映っても鋭い点にならず、ぼんやり広がる
 * （Karis 2013「Real Shading in Unreal Engine 4」の球の光源の近似：α′ = α + 光源の半径 /（3 × 距離））
 */
export function bakedVisibilityFunctions(): string {
  const a = (deg: number) => (Math.tan(THREE.MathUtils.degToRad(deg)) / 3).toFixed(5);
  return /* glsl */ `
vec2 gBakedVis = vec2( 1.0 );
float bakedDirVisibility( const in int i ) {
  return i == 0 ? gBakedVis.x : ( i == 1 ? gBakedVis.y : 1.0 );
}
float bakedLightRoughness( const in int i, const in float r ) {
  float s = i == 0 ? ${a(lightSizes.key)} : ( i == 1 ? ${a(lightSizes.fill)} : 0.0 );
  return sqrt( min( r * r + s, 1.0 ) );
}
`;
}

export interface PlanarBake {
  texture: THREE.Texture;
  /** 焼き込み範囲の中心（x, z）と一辺の長さ */
  centerX: number;
  centerZ: number;
  size: number;
}

/**
 * 水平な面（床・砂地）に、平面に焼き込んだ影と AO を適用する。
 * テクスチャの R = 主光が遮られる割合、G = 空が遮られる割合（AO）、B = 補助光が遮られる割合。
 */
export function applyPlanarBake(
  material: THREE.MeshStandardMaterial,
  bake: PlanarBake,
  opts: {
    shadowStrength: number;
    aoStrength: number;
    /**
     * 水面（level）より下では、主光の影を strength 倍、補助光の影を fillStrength 倍、AO を aoStrength 倍にする
     * （fade の深さで切り替え）。水が光を散らすので、水の中の影は薄い
     */
    underwater?: { level: number; strength: number; fillStrength: number; aoStrength: number; fade: number };
    /** 照明の計算後に追加で行う処理（GLSL）と、そのための宣言・uniform */
    extraFragment?: string;
    extraDeclarations?: string;
    extraUniforms?: Record<string, THREE.IUniform>;
  },
): void {
  const uniforms: Record<string, THREE.IUniform> = {
    uBakeUnderwater: {
      value: new THREE.Vector2(opts.underwater?.level ?? -1e6, Math.max(opts.underwater?.fade ?? 1, 1e-4)),
    },
    uBakeUnderwaterK: {
      value: new THREE.Vector3(
        opts.underwater?.strength ?? 1,
        opts.underwater?.aoStrength ?? 1,
        opts.underwater?.fillStrength ?? 1,
      ),
    },
    uBakeMap: { value: bake.texture },
    uBakeCenter: { value: new THREE.Vector2(bake.centerX, bake.centerZ) },
    uBakeInvSize: { value: 1 / bake.size },
    uShadowStrength: { value: opts.shadowStrength },
    uAoStrength: { value: opts.aoStrength },
    ...opts.extraUniforms,
  };
  const prev = material.onBeforeCompile;
  material.onBeforeCompile = (shader, renderer) => {
    prev.call(material, shader, renderer);
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vBakeWorld;')
      .replace(
        '#include <project_vertex>',
        '#include <project_vertex>\nvBakeWorld = ( modelMatrix * vec4( transformed, 1.0 ) ).xyz;',
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
uniform sampler2D uBakeMap;
uniform vec2 uBakeCenter;
uniform float uBakeInvSize;
uniform float uShadowStrength;
uniform float uAoStrength;
uniform vec2 uBakeUnderwater;
uniform vec3 uBakeUnderwaterK;
varying vec3 vBakeWorld;
${opts.extraDeclarations ?? ''}
${bakedVisibilityFunctions()}
vec3 gBakedOcc = vec3( 0.0 );`,
      )
      .replace(
        '#include <lights_fragment_begin>',
        `{
  // 焼き込み範囲（u: +x, v: -z）。範囲の外は影なし。端に近づくほど影を弱めて境目を出さない
  vec2 bakeUv = vec2( ( vBakeWorld.x - uBakeCenter.x ) * uBakeInvSize + 0.5, 0.5 - ( vBakeWorld.z - uBakeCenter.y ) * uBakeInvSize );
  vec2 edgeDist = min( bakeUv, 1.0 - bakeUv );
  float fadeIn = smoothstep( 0.0, 0.04, min( edgeDist.x, edgeDist.y ) );
  gBakedOcc = clamp( texture2D( uBakeMap, clamp( bakeUv, 0.0, 1.0 ) ).rgb, 0.0, 1.0 ) * fadeIn;
  // 水の中では影を薄く
  gBakedOcc *= mix( vec3( 1.0 ), uBakeUnderwaterK, smoothstep( 0.0, uBakeUnderwater.y, uBakeUnderwater.x - vBakeWorld.y ) );
  gBakedVis = 1.0 - uShadowStrength * gBakedOcc.rb;
}
${lightsBeginWithBakedVisibility()}`,
      )
      .replace(
        '#include <lights_fragment_end>',
        `#include <lights_fragment_end>
reflectedLight.indirectDiffuse *= 1.0 - uAoStrength * gBakedOcc.g;
${opts.extraFragment ?? ''}`,
      );
  };
  // シェーダーの内容がマテリアルごとに違うので、プログラムのキャッシュも分ける
  const key = `planar-bake-${++bakeMaterialId}`;
  material.customProgramCacheKey = () => key;
}

let bakeMaterialId = 0;
