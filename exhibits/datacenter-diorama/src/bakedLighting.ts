import * as THREE from 'three';

/**
 * 焼き込んだ影を three.js の標準マテリアルに組み込むための共通処理。
 *
 * 平行光のループ（lights_fragment_begin）で、各ライトの光量に
 * bakedDirVisibility(ライト番号) を掛ける。ライト番号はシーンに追加した順
 * （0 = 主光、1 = 補助光、2 = 窓の日差し）。マテリアルごとに、この関数と gBakedVis を用意する。
 * 焼き込みのテクスチャは R = 主光、G = 空（AO）、B = 補助光、A = 窓の日差しが遮られる割合。
 */
const LOOP_ANCHOR = 'getDirectionalLightInfo( directionalLight, directLight );';
const LIGHT_ANCHOR = 'IncidentLight directLight;';

/** 主光・補助光・日差しの見かけの大きさ（半径、度）。影をぼかす大きさと同じ値を、光の映り込みの広がりにも使う */
const lightSizes = { key: 0, fill: 0, sun: 0 };
export function setBakedLightSizes(keyDeg: number, fillDeg: number, sunDeg = 0) {
  lightSizes.key = keyDeg;
  lightSizes.fill = fillDeg;
  lightSizes.sun = sunDeg;
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
 * gBakedVis（x: 主光、y: 補助光、z: 窓の日差しの見えている割合）を読む関数と、光源の大きさで粗さを広げる関数の定義。
 * uDirMask はマテリアルごとの光の効き（例：台座の外の床には窓の日差しを当てない）。
 * 大きな光源（柔らかい光）は、つやのある面に映っても鋭い点にならず、ぼんやり広がる
 * （Karis 2013「Real Shading in Unreal Engine 4」の球の光源の近似：α′ = α + 光源の半径 /（3 × 距離））
 */
export function bakedVisibilityFunctions(): string {
  const a = (deg: number) => (Math.tan(THREE.MathUtils.degToRad(deg)) / 3).toFixed(5);
  return /* glsl */ `
uniform vec3 uDirMask;
vec3 gBakedVis = vec3( 1.0 );
float bakedDirVisibility( const in int i ) {
  return i == 0 ? gBakedVis.x * uDirMask.x : ( i == 1 ? gBakedVis.y * uDirMask.y : ( i == 2 ? gBakedVis.z * uDirMask.z : 1.0 ) );
}
float bakedLightRoughness( const in int i, const in float r ) {
  float s = i == 0 ? ${a(lightSizes.key)} : ( i == 1 ? ${a(lightSizes.fill)} : ( i == 2 ? ${a(lightSizes.sun)} : 0.0 ) );
  // 窓の日差しは、床や机に強い照り返し（逆光のぎらつき）を作らないよう、映り込みを広くぼかす
  if ( i == 2 ) return max( sqrt( min( r * r + s, 1.0 ) ), 0.8 );
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
 * 水平な面（台座のまわりの床）に、平面に焼き込んだ影と AO を適用する。
 * テクスチャの R = 主光が遮られる割合、G = 空が遮られる割合（AO）、B = 補助光、A = 窓の日差し。
 */
export function applyPlanarBake(
  material: THREE.MeshStandardMaterial,
  bake: PlanarBake,
  opts: {
    shadowStrength: number;
    aoStrength: number;
    /** 光ごとの効き（主光・補助光・窓の日差し）。既定はすべて 1 */
    lightMask?: [number, number, number];
    /** 照明の計算後に追加で行う処理（GLSL）と、そのための宣言・uniform */
    extraFragment?: string;
    extraDeclarations?: string;
    extraUniforms?: Record<string, THREE.IUniform>;
  },
): void {
  const uniforms: Record<string, THREE.IUniform> = {
    uBakeMap: { value: bake.texture },
    uBakeCenter: { value: new THREE.Vector2(bake.centerX, bake.centerZ) },
    uBakeInvSize: { value: 1 / bake.size },
    uShadowStrength: { value: opts.shadowStrength },
    uAoStrength: { value: opts.aoStrength },
    uDirMask: { value: new THREE.Vector3(...(opts.lightMask ?? [1, 1, 1])) },
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
varying vec3 vBakeWorld;
${opts.extraDeclarations ?? ''}
${bakedVisibilityFunctions()}
vec4 gBakedOcc = vec4( 0.0 );`,
      )
      .replace(
        '#include <lights_fragment_begin>',
        `{
  // 焼き込み範囲（u: +x, v: -z）。範囲の外は影なし。端に近づくほど影を弱めて境目を出さない
  vec2 bakeUv = vec2( ( vBakeWorld.x - uBakeCenter.x ) * uBakeInvSize + 0.5, 0.5 - ( vBakeWorld.z - uBakeCenter.y ) * uBakeInvSize );
  vec2 edgeDist = min( bakeUv, 1.0 - bakeUv );
  float fadeIn = smoothstep( 0.0, 0.04, min( edgeDist.x, edgeDist.y ) );
  gBakedOcc = clamp( texture2D( uBakeMap, clamp( bakeUv, 0.0, 1.0 ) ), 0.0, 1.0 ) * fadeIn;
  gBakedVis = 1.0 - uShadowStrength * gBakedOcc.rba;
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
