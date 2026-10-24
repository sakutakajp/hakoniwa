import * as THREE from 'three';

/**
 * 街の明かりと路面の映り込みを、いろいろなマテリアルで共有するための uniform と GLSL。
 *  - 街の明かり（localLight）：店先・街灯・看板が地面と壁を照らす、上から見た光の地図（HDR の RGB）。
 *    地面からの高さで弱め、上を向いた面ほど強く受ける
 *  - 映り込み（reflection）：路面の高さの水平な鏡に映した景色（毎回描き直す）。
 *    濡れた路面は、ゆらぎと縦の光の筋を付けて読む
 */
export interface TownEnv {
  uniforms: {
    uLocalLight: { value: THREE.Texture };
    uLocalSize: { value: number };
    uGroundY: { value: number };
    uLocalFalloff: { value: number };
    uRefl: { value: THREE.Texture };
    uReflMatrix: { value: THREE.Matrix4 };
    uReflOn: { value: number };
    uSunTint: { value: THREE.Vector3 };
    uShadeTint: { value: THREE.Vector3 };
  };
}

/**
 * 夕方の街の色調：街の物だけ、日差し（主光・補助光）を暖かく、空からの光（半球光）を青く寄せる。
 * 光の向きと強さはシリーズのまま。照明の計算の後（lights_fragment_end の後）、街の明かりを足す前に使う
 */
export const TINT_DECL = /* glsl */ `
uniform vec3 uSunTint;
uniform vec3 uShadeTint;
`;
export const TINT_APPLY = /* glsl */ `
reflectedLight.directDiffuse *= uSunTint;
reflectedLight.directSpecular *= uSunTint;
reflectedLight.indirectDiffuse *= uShadeTint;
`;

const blank = (() => {
  const t = new THREE.DataTexture(new Uint8Array([0, 0, 0, 255]), 1, 1);
  t.needsUpdate = true;
  return t;
})();

export function createTownEnv(groundY: number, size: number, tint: { sun: number[]; shade: number[] }): TownEnv {
  return {
    uniforms: {
      uLocalLight: { value: blank },
      uLocalSize: { value: size },
      uGroundY: { value: groundY },
      uLocalFalloff: { value: 1.5 },
      uRefl: { value: blank },
      uReflMatrix: { value: new THREE.Matrix4() },
      uReflOn: { value: 0 },
      uSunTint: { value: new THREE.Vector3(...tint.sun) },
      uShadeTint: { value: new THREE.Vector3(...tint.shade) },
    },
  };
}

/** 街の明かりを読む関数（ワールドの位置と法線から、受ける光の量 RGB） */
export const LOCAL_LIGHT_GLSL = /* glsl */ `
uniform sampler2D uLocalLight;
uniform float uLocalSize;
uniform float uGroundY;
uniform float uLocalFalloff;
vec3 localLightAt( vec3 wp, vec3 nW ) {
  vec2 uv = wp.xz / uLocalSize + 0.5;
  if ( uv.x < 0.0 || uv.y < 0.0 || uv.x > 1.0 || uv.y > 1.0 ) return vec3( 0.0 );
  vec3 L = texture2D( uLocalLight, uv ).rgb;
  float h = max( wp.y - uGroundY, 0.0 );
  return L * exp( -h / uLocalFalloff ) * ( 0.55 + 0.45 * max( nW.y, 0.0 ) );
}
`;

/** 路面の映り込みを読む関数 */
export const REFLECTION_GLSL = /* glsl */ `
uniform sampler2D uRefl;
uniform mat4 uReflMatrix;
uniform float uReflOn;
// wp：路面の位置、distort：ゆらぎ（テクスチャ座標のずれ）、rough：ぼけ（0〜1）、streak：縦の光の筋の長さ（テクスチャ座標）
vec3 reflectionAt( vec3 wp, vec2 distort, float rough, float streak ) {
  if ( uReflOn < 0.5 ) return vec3( 0.0 );
  vec4 p = uReflMatrix * vec4( wp, 1.0 );
  vec2 uv = p.xy / p.w + distort;
  float lod = rough * 4.0;
  vec3 c = textureLod( uRefl, uv, lod ).rgb;
  // 縦の光の筋：明るい所（灯り・看板・店先）だけを、縦に長くぼかして足す
  vec3 s = vec3( 0.0 );
  float w = 0.0;
  for ( int i = -7; i <= 7; i ++ ) {
    float fi = float( i ) / 7.0;
    float wi = exp( -fi * fi * 2.2 );
    vec3 t = textureLod( uRefl, uv + vec2( 0.0, fi * streak ), lod + 1.2 ).rgb;
    s += max( t - vec3( 0.55 ), vec3( 0.0 ) ) * wi;
    w += wi;
  }
  return c + s / w * 1.6;
}
`;

/** マテリアルの onBeforeCompile で、街の明かりを拡散光に足す（照明の計算の後）。vWorld3 と vNormalW3 を使う */
export function addLocalLight(material: THREE.Material, env: TownEnv, opts: { strength?: number; key?: string } = {}) {
  const prev = material.onBeforeCompile;
  const strength = opts.strength ?? 1;
  material.onBeforeCompile = (shader, renderer) => {
    prev.call(material, shader, renderer);
    Object.assign(shader.uniforms, env.uniforms, { uLocalStrength: { value: strength } });
    if (!shader.vertexShader.includes('varying vec3 vWorld3;')) {
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vWorld3;\nvarying vec3 vNormalW3;')
        .replace(
          '#include <project_vertex>',
          `#include <project_vertex>
#ifdef USE_INSTANCING
vWorld3 = ( modelMatrix * instanceMatrix * vec4( transformed, 1.0 ) ).xyz;
vNormalW3 = normalize( mat3( modelMatrix ) * mat3( instanceMatrix ) * objectNormal );
#else
vWorld3 = ( modelMatrix * vec4( transformed, 1.0 ) ).xyz;
vNormalW3 = normalize( mat3( modelMatrix ) * objectNormal );
#endif`,
        );
      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <common>',
        '#include <common>\nvarying vec3 vWorld3;\nvarying vec3 vNormalW3;',
      );
    }
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\nuniform float uLocalStrength;\n${LOCAL_LIGHT_GLSL}\n${TINT_DECL}`)
      .replace(
        '#include <lights_fragment_end>',
        `#include <lights_fragment_end>
${TINT_APPLY}
reflectedLight.indirectDiffuse += diffuseColor.rgb * localLightAt( vWorld3, normalize( vNormalW3 ) ) * uLocalStrength;`,
      );
  };
  const prevKey = material.customProgramCacheKey.bind(material);
  material.customProgramCacheKey = () => `${prevKey()}-local${opts.key ?? ''}`;
}
