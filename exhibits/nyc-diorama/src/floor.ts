import * as THREE from 'three';
import { applyPlanarBake, type PlanarBake } from './bakedLighting';

export interface FloorOptions {
  color: THREE.ColorRepresentation;
  size: number;
  bake: PlanarBake;
  shadowStrength: number;
  aoStrength: number;
  /** 床の明るさのグラデーション量（0で均一） */
  gradient: number;
  /** 明るくなる方位（度、カメラと同じ基準） */
  gradientAzimuth: number;
  /** グラデーションがかかる距離（ワールド単位） */
  gradientDistance: number;
  /** 台座のまわりの柔らかい影（台座の外形 half / radius をずらし、ぼかしたもの） */
  dropShadow?: { strength: number; offset: [number, number]; blur: number; spread: number; half: number | [number, number]; radius: number };
  /**
   * 遠くの床を背景の色に溶け込ませる（縦長の画面で地平線の近くまで見えても、床の端や境目が見えないように）。
   * color はトーンマッピング前のリニアな色、start / end は中心からの距離
   */
  horizon?: { color: THREE.Color; start: number; end: number };
  /**
   * 照明で明るさを決めず、この色（トーンマッピング前のリニアな色）に影と AO を掛けた色にする。
   * 画面の背景と床の色を正確にそろえたいときに使う。lightWeights は主光・補助光・空の光の重み（影の濃さの割合）
   */
  unlit?: {
    color: THREE.Color;
    /** 主光・補助光・空の光の遮られ方を影の濃さにする重み */
    lightWeights: [number, number, number];
    /** いちばん濃い影の色の割合（R・G・B。影は空の光で青みを帯びる） */
    shadowTint: [number, number, number];
    /**
     * 画面の上の位置で変わる背景の色（スタジオの背景紙の明るさのむら）。画面の位置 (x, y)（-1〜1）の 2 次式
     * [1, x, y, x², y², xy] の係数を R・G・B ごとに（リニアな色、トーンマッピング後の値）。knee と exposure はトーンマッピングの逆算用
     */
    screenGradient?: { coef: [number[], number[], number[]]; knee: number; exposure: number; saturation?: number; darkSaturation?: number };
  };
}

/**
 * 床：通常の MeshStandardMaterial に、焼き込んだ影（台座と山）と AO を適用する。
 * あわせて、スタジオ照明のムラのように床の明るさへゆるやかなグラデーションを付ける。
 */
export function createFloor(opts: FloorOptions): THREE.Mesh {
  const material = new THREE.MeshStandardMaterial({
    color: opts.color,
    roughness: 1,
    metalness: 0,
  });
  const ga = THREE.MathUtils.degToRad(opts.gradientAzimuth);
  const ds = opts.dropShadow;

  applyPlanarBake(material, opts.bake, {
    shadowStrength: opts.shadowStrength,
    aoStrength: opts.aoStrength,
    extraUniforms: {
      uGradientDir: { value: new THREE.Vector2(Math.sin(ga), Math.cos(ga)) },
      uGradient: { value: opts.gradient },
      uGradientInvDist: { value: 1 / Math.max(opts.gradientDistance, 1e-3) },
      uDropShadow: { value: new THREE.Vector4(ds?.strength ?? 0, ds?.offset[0] ?? 0, ds?.offset[1] ?? 0, ds?.blur ?? 1) },
      uUnlit: { value: new THREE.Vector4(opts.unlit?.color.r ?? 0, opts.unlit?.color.g ?? 0, opts.unlit?.color.b ?? 0, opts.unlit ? 1 : 0) },
      uUnlitW: { value: new THREE.Vector3(...(opts.unlit?.lightWeights ?? [1, 0, 0])) },
      uShadowTint: { value: new THREE.Vector3(...(opts.unlit?.shadowTint ?? [0.5, 0.5, 0.5])) },
      uBgCoef: {
        value: (() => {
          const g = opts.unlit?.screenGradient;
          // 6 つの係数を、RGB をまとめた vec3 の 6 個に並べ替える
          return Array.from({ length: 6 }, (_, i) => new THREE.Vector3(g?.coef[0][i] ?? 0, g?.coef[1][i] ?? 0, g?.coef[2][i] ?? 0));
        })(),
      },
      uBgTone: { value: new THREE.Vector3(opts.unlit?.screenGradient?.knee ?? 0.82, opts.unlit?.screenGradient?.exposure ?? 1, opts.unlit?.screenGradient ? 1 : 0) },
      uBgSat: { value: new THREE.Vector2(opts.unlit?.screenGradient?.saturation ?? 1, opts.unlit?.screenGradient?.darkSaturation ?? 0) },
      uDropBox: {
        value: (() => {
          const h = ds?.half ?? 1;
          const [hx, hz] = typeof h === 'number' ? [h, h] : h;
          const sp = ds?.spread ?? 0;
          return new THREE.Vector3(hx + sp, hz + sp, ds?.radius ?? 0.1);
        })(),
      },
    },
    extraDeclarations: `
uniform vec2 uGradientDir;
uniform float uGradient;
uniform float uGradientInvDist;
uniform vec4 uDropShadow;
uniform vec3 uDropBox;
uniform vec4 uUnlit;
uniform vec3 uUnlitW;
uniform vec3 uShadowTint;
uniform vec3 uBgCoef[6];
uniform vec3 uBgTone;
uniform vec2 uBgSat;
varying vec4 vFlClip;
// トーンマッピング（toneMapping.ts）の逆：仕上げの彩度を戻してから、明るい所の丸めを戻す
vec3 flInvTone( vec3 v ) {
  float lum = dot( v, vec3( 0.2126, 0.7152, 0.0722 ) );
  float sat = uBgSat.x + uBgSat.y * ( 1.0 - smoothstep( 0.0, 0.5, lum ) );
  v = lum + ( v - lum ) / sat;
  float k = uBgTone.x;
  vec3 over = k - ( 1.0 - k ) * log( max( 1.0 - ( v - k ) / ( 1.0 - k ), 1e-4 ) );
  return mix( v, over, step( k, v ) ) / uBgTone.y;
}`,
    extraFragment: `{
  // 端で頭打ちにならない、なめらかな明るさのグラデーション
  float gt = dot( vBakeWorld.xz, uGradientDir ) * uGradientInvDist;
  float gradient = 1.0 + 0.7071 * uGradient * gt / sqrt( 1.0 + gt * gt );
  // 台座のまわりの柔らかい影（ずらした角丸正方形からの距離でぼかす）
  vec2 dq = abs( vBakeWorld.xz - uDropShadow.yz ) - ( uDropBox.xy - uDropBox.z );
  float dd = length( max( dq, 0.0 ) ) + min( max( dq.x, dq.y ), 0.0 ) - uDropBox.z;
  float drop = uDropShadow.x * ( 1.0 - smoothstep( -0.25 * uDropShadow.w, uDropShadow.w, dd ) );
  if ( uUnlit.w > 0.5 ) {
    // 照明によらない色：影と AO の割合だけ、青みを帯びた影の色へ近づける
    float occ = uUnlitW.x * ( 1.0 - gBakedVis.x ) + uUnlitW.y * ( 1.0 - gBakedVis.y ) + uUnlitW.z * uAoStrength * gBakedOcc.g;
    occ = 1.0 - ( 1.0 - clamp( occ, 0.0, 1.0 ) ) * ( 1.0 - drop );
    vec3 shade = mix( vec3( 1.0 ), uShadowTint, occ );
    reflectedLight.directDiffuse = vec3( 0.0 );
    reflectedLight.directSpecular = vec3( 0.0 );
    reflectedLight.indirectSpecular = vec3( 0.0 );
    vec3 bg = uUnlit.rgb;
    if ( uBgTone.z > 0.5 ) {
      vec2 q = vFlClip.xy / vFlClip.w;
      vec3 c = uBgCoef[ 0 ] + uBgCoef[ 1 ] * q.x + uBgCoef[ 2 ] * q.y + uBgCoef[ 3 ] * q.x * q.x + uBgCoef[ 4 ] * q.y * q.y + uBgCoef[ 5 ] * q.x * q.y;
      bg = flInvTone( clamp( c, 0.0, 0.995 ) );
    }
    reflectedLight.indirectDiffuse = bg * shade * gradient;
  } else {
    reflectedLight.directDiffuse *= gradient * ( 1.0 - drop );
    reflectedLight.indirectDiffuse *= gradient * ( 1.0 - drop );
  }
}`,
  });

  {
    // 画面の上の位置（背景の色のむら用）
    const prev = material.onBeforeCompile;
    material.onBeforeCompile = (shader, renderer) => {
      prev.call(material, shader, renderer);
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec4 vFlClip;')
        .replace('#include <project_vertex>', '#include <project_vertex>\nvFlClip = gl_Position;');
    };
  }

  if (opts.horizon && !opts.unlit) {
    const hz = opts.horizon;
    const prev = material.onBeforeCompile;
    material.onBeforeCompile = (shader, renderer) => {
      prev.call(material, shader, renderer);
      shader.uniforms.uHorizonColor = { value: hz.color };
      shader.uniforms.uHorizonRange = { value: new THREE.Vector2(hz.start, hz.end) };
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', '#include <common>\nuniform vec3 uHorizonColor;\nuniform vec2 uHorizonRange;')
        .replace(
          '#include <opaque_fragment>',
          `outgoingLight = mix( outgoingLight, uHorizonColor, smoothstep( uHorizonRange.x, uHorizonRange.y, length( vBakeWorld.xz ) ) );
#include <opaque_fragment>`,
        );
    };
  }

  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(opts.size, opts.size).rotateX(-Math.PI / 2), material);
  mesh.name = 'floor';
  return mesh;
}
