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
  dropShadow?: { strength: number; offset: [number, number]; blur: number; spread: number; half: number; radius: number };
  /**
   * 遠くの床を背景の色に溶け込ませる（縦長の画面で地平線の近くまで見えても、床の端や境目が見えないように）。
   * color はトーンマッピング前のリニアな色、start / end は中心からの距離
   */
  horizon?: { color: THREE.Color; start: number; end: number };
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
      uDropBox: { value: new THREE.Vector2((ds?.half ?? 1) + (ds?.spread ?? 0), ds?.radius ?? 0.1) },
    },
    extraDeclarations: `
uniform vec2 uGradientDir;
uniform float uGradient;
uniform float uGradientInvDist;
uniform vec4 uDropShadow;
uniform vec2 uDropBox;`,
    extraFragment: `{
  // 端で頭打ちにならない、なめらかな明るさのグラデーション
  float gt = dot( vBakeWorld.xz, uGradientDir ) * uGradientInvDist;
  float gradient = 1.0 + 0.7071 * uGradient * gt / sqrt( 1.0 + gt * gt );
  // 台座のまわりの柔らかい影（ずらした角丸正方形からの距離でぼかす）
  vec2 dq = abs( vBakeWorld.xz - uDropShadow.yz ) - ( uDropBox.x - uDropBox.y );
  float dd = length( max( dq, 0.0 ) ) + min( max( dq.x, dq.y ), 0.0 ) - uDropBox.y;
  float drop = uDropShadow.x * ( 1.0 - smoothstep( -0.25 * uDropShadow.w, uDropShadow.w, dd ) );
  reflectedLight.directDiffuse *= gradient * ( 1.0 - drop );
  reflectedLight.indirectDiffuse *= gradient * ( 1.0 - drop );
}`,
  });

  if (opts.horizon) {
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
