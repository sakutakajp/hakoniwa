import * as THREE from 'three';

/**
 * 砂地の表面に、細かな砂利を模様として描く（個別のメッシュを大量に置かずに済むように）。
 * 小さな格子ごとに砂利の粒を置くかどうかを、岩の配置から求めた密度テクスチャで決め、
 * 粒は砂より少し暗い色と小さなふくらみ（法線の傾き）で表す。
 */
export function applyGroundGravel(
  material: THREE.MeshStandardMaterial,
  opts: {
    /** 台座の上面全体を覆う密度（R チャンネル、u が +x、v が +z） */
    density: THREE.Texture;
    /** 台座の一辺 */
    size: number;
    /** 粒を置く格子の大きさ（ワールド単位） */
    cell: number;
    /** 粒の色（砂の色に掛ける） */
    tint: THREE.Color;
  },
): { setEnabled: (on: boolean) => void } {
  const uniforms = {
    uGrDensity: { value: opts.density },
    uGrInvSize: { value: 1 / opts.size },
    uGrCell: { value: opts.cell },
    uGrTint: { value: opts.tint },
    uGrOn: { value: 1 },
  };
  const prev = material.onBeforeCompile;
  material.onBeforeCompile = (shader, renderer) => {
    prev.call(material, shader, renderer);
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vGrWorld;')
      .replace(
        '#include <project_vertex>',
        '#include <project_vertex>\nvGrWorld = ( modelMatrix * vec4( transformed, 1.0 ) ).xyz;',
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
uniform sampler2D uGrDensity;
uniform float uGrInvSize;
uniform float uGrCell;
uniform vec3 uGrTint;
uniform float uGrOn;
varying vec3 vGrWorld;
vec3 grHash3( vec2 p ) {
  vec3 q = fract( vec3( p.xyx ) * vec3( 0.1031, 0.1030, 0.0973 ) );
  q += dot( q, q.yzx + 33.33 );
  return fract( ( q.xxy + q.yzz ) * q.zyx );
}`,
      )
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
// 細かな砂利の粒（密度の高い所ほど多い）
float grMask = 0.0;
vec2 grDome = vec2( 0.0 );
{
  float grD = uGrOn * texture2D( uGrDensity, vGrWorld.xz * uGrInvSize + 0.5 ).r;
  if ( grD > 0.01 ) {
    vec2 gq = vGrWorld.xz / uGrCell;
    vec2 gi = floor( gq );
    vec2 gf = fract( gq );
    float shade = 1.0;
    for ( int a = -1; a <= 1; a ++ ) {
      for ( int b = -1; b <= 1; b ++ ) {
        vec2 o = vec2( float( a ), float( b ) );
        vec3 h = grHash3( gi + o );
        if ( h.z < grD * 0.85 ) {
          vec2 c = gf - ( o + 0.2 + 0.6 * h.xy );
          float r = 0.16 + 0.24 * fract( h.z * 17.31 );
          float d = length( c ) / r;
          float m = 1.0 - smoothstep( 0.72, 1.0, d );
          if ( m > grMask ) {
            grMask = m;
            grDome = c / r;
            shade = 0.72 + 0.32 * fract( h.x * 9.7 );
          }
        }
      }
    }
    diffuseColor.rgb = mix( diffuseColor.rgb, diffuseColor.rgb * uGrTint * shade, grMask );
  }
}`,
      )
      .replace(
        '#include <normal_fragment_maps>',
        `#include <normal_fragment_maps>
if ( grMask > 0.0 ) {
  // 粒の丸いふくらみ
  vec3 domeN = normalize( vec3( grDome.x, 1.2 * sqrt( max( 0.0, 1.0 - dot( grDome, grDome ) ) ) + 0.15, grDome.y ) );
  vec3 domeV = normalize( ( viewMatrix * vec4( domeN, 0.0 ) ).xyz );
  normal = normalize( mix( normal, domeV, 0.85 * grMask ) );
}`,
      );
  };
  return {
    setEnabled: (on: boolean) => {
      uniforms.uGrOn.value = on ? 1 : 0;
    },
  };
}
