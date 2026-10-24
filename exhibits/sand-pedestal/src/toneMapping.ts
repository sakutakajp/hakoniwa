import * as THREE from 'three';

const PLACEHOLDER = 'vec3 CustomToneMapping( vec3 color ) { return color; }';

/**
 * 白飛びを抑えるトーンマッピングを設定する。
 * knee までは線形（色味をそのまま保つ）で、それを超える明るさだけを 1.0 に漸近させる。
 * 明るいベージュの画面でも砂の細かな陰影が潰れにくい。
 * three.js の CustomToneMapping の差し替え口を使う（WebGLRenderer の公式な拡張方法）。
 * マテリアルのコンパイル前に呼ぶこと。
 */
export function useSoftHighlightToneMapping(renderer: THREE.WebGLRenderer, knee: number, exposure: number): void {
  const chunk = THREE.ShaderChunk.tonemapping_pars_fragment;
  const k = Math.min(Math.max(knee, 0.5), 0.99).toFixed(4);
  if (chunk.includes(PLACEHOLDER)) {
    THREE.ShaderChunk.tonemapping_pars_fragment = chunk.replace(
      PLACEHOLDER,
      /* glsl */ `vec3 CustomToneMapping( vec3 color ) {
  color *= toneMappingExposure;
  const float k = ${k};
  vec3 over = max( color - k, 0.0 );
  vec3 rolled = k + ( 1.0 - k ) * ( 1.0 - exp( - over / ( 1.0 - k ) ) );
  return mix( color, rolled, step( k, color ) );
}`,
    );
    renderer.toneMapping = THREE.CustomToneMapping;
  } else {
    // three.js の内部が変わって差し替えできない場合でも破綻しないように
    renderer.toneMapping = THREE.NeutralToneMapping;
  }
  renderer.toneMappingExposure = exposure;
}
