import * as THREE from 'three';
import type { SceneConfig } from './config';

type SandConfig = SceneConfig['sand'];

/**
 * 砂面の高さ関数（ワールド単位）。
 *  - 大きな砂紋：風上側がなだらかな非対称の波を、大小2段階のなめらかなノイズでうねらせ、
 *    波長と向きが少し違う2系統を混ぜて枝分かれ・合流を作る
 *  - 砂粒の凹凸：砂紋に沿って伸ばしたボロノイ（鱗状のセル）の細い稜線と、セルのふくらみ
 *  - ピット：まばらな小さいくぼみ
 *  - 微細なざらつき
 * 上面全体を1枚のテクスチャとして生成するため、タイルの繰り返しは発生しない。
 */
const heightGLSL = /* glsl */ `
uniform float uSeed;
uniform float uRippleWavelength;
uniform float uRippleAmp;
uniform float uRippleAngle;
uniform float uRippleWarp;
uniform float uRippleWarpScale;
uniform float uRippleBend;
uniform float uCrestSharpness;
uniform float uForkiness;
uniform float uCellSize;
uniform float uCellStretch;
uniform float uRidgeWidth;
uniform float uRidgeHeight;
uniform float uPitDensity;
uniform float uPitDepth;
uniform float uMicroHeight;

vec2 hash22( vec2 p ) {
  vec3 p3 = fract( vec3( p.xyx ) * vec3( 0.1031, 0.1030, 0.0973 ) );
  p3 += dot( p3, p3.yzx + 33.33 );
  return fract( ( p3.xx + p3.yz ) * p3.zy );
}

float hash12( vec2 p ) {
  vec3 p3 = fract( vec3( p.xyx ) * 0.1031 );
  p3 += dot( p3, p3.yzx + 33.33 );
  return fract( ( p3.x + p3.y ) * p3.z );
}

// 勾配ノイズ（おおよそ -1..1）
float gnoise( vec2 p ) {
  vec2 i = floor( p );
  vec2 f = fract( p );
  vec2 u = f * f * f * ( f * ( f * 6.0 - 15.0 ) + 10.0 );
  vec2 ga = hash22( i ) * 2.0 - 1.0;
  vec2 gb = hash22( i + vec2( 1.0, 0.0 ) ) * 2.0 - 1.0;
  vec2 gc = hash22( i + vec2( 0.0, 1.0 ) ) * 2.0 - 1.0;
  vec2 gd = hash22( i + vec2( 1.0, 1.0 ) ) * 2.0 - 1.0;
  float va = dot( ga, f );
  float vb = dot( gb, f - vec2( 1.0, 0.0 ) );
  float vc = dot( gc, f - vec2( 0.0, 1.0 ) );
  float vd = dot( gd, f - vec2( 1.0, 1.0 ) );
  return 1.6 * mix( mix( va, vb, u.x ), mix( vc, vd, u.x ), u.y );
}

float fbm( vec2 p ) {
  float s = 0.0;
  float a = 0.5;
  mat2 m = mat2( 0.8, 0.6, -0.6, 0.8 );
  for ( int i = 0; i < 4; i ++ ) {
    s += a * gnoise( p );
    p = m * p * 2.03 + 11.7;
    a *= 0.5;
  }
  return s;
}

// 低い周波数だけの滑らかなうねり（砂紋の稜線を長くなめらかに曲げる）
float smoothWarp( vec2 p ) {
  return 0.62 * gnoise( p ) + 0.26 * gnoise( mat2( 0.8, 0.6, -0.6, 0.8 ) * p * 1.9 + 11.7 );
}

mat2 rot2( float a ) {
  float c = cos( a );
  float s = sin( a );
  return mat2( c, s, -s, c );
}

// 1周期分の砂紋断面（0..1）。風上側はなだらか、風下側は急で、谷は丸く稜線は鋭い
float rippleProfile( float phase, float sharp ) {
  float t = fract( phase );
  float c = mix( 0.6, 0.9, sharp );
  float y = t < c ? t / c : ( 1.0 - t ) / ( 1.0 - c );
  float rounded = y * y * ( 3.0 - 2.0 * y );
  float pointed = pow( y, 1.7 );
  return mix( rounded, pointed, sharp );
}

// x: 最近点距離, y: 2番目の距離, z: セルID
vec3 worley( vec2 p ) {
  vec2 i = floor( p );
  vec2 f = fract( p );
  float f1 = 9.0;
  float f2 = 9.0;
  float id = 0.0;
  for ( int y = - 1; y <= 1; y ++ ) {
    for ( int x = - 1; x <= 1; x ++ ) {
      vec2 g = vec2( float( x ), float( y ) );
      vec2 o = 0.1 + 0.8 * hash22( i + g );
      vec2 r = g + o - f;
      float d = dot( r, r );
      if ( d < f1 ) {
        f2 = f1;
        f1 = d;
        id = hash12( i + g + 19.19 );
      } else if ( d < f2 ) {
        f2 = d;
      }
    }
  }
  return vec3( sqrt( f1 ), sqrt( f2 ), id );
}

struct SandSample {
  float h;
  float ripple;
  float crest;
  float ridge;
  float dome;
  float pit;
  float mottle;
};

SandSample sandHeight( vec2 p ) {
  SandSample s;
  vec2 so = vec2( uSeed * 7.31, uSeed * 3.17 );

  // --- 大きな砂紋 ---
  vec2 wp = p * uRippleWarpScale + so;
  // 大きなうねり（台座全体で砂紋の向きがゆっくり変わる）＋ 中くらいのうねり
  float warp = uRippleWarp * smoothWarp( wp ) + uRippleBend * gnoise( p * 0.045 + so * 0.37 + 2.7 );
  vec2 q1 = rot2( uRippleAngle ) * p;
  vec2 q2 = rot2( uRippleAngle + 0.09 ) * p;
  float phaseA = ( q1.y + warp ) / uRippleWavelength;
  float phaseB = ( q2.y + warp * 1.08 + 0.31 ) / ( uRippleWavelength * 1.14 );
  float forkMask = smoothstep( 0.25, 0.75, 0.5 + 0.9 * fbm( p * 0.23 + so + 41.0 ) ) * uForkiness;
  float ripple = mix( rippleProfile( phaseA, uCrestSharpness ), rippleProfile( phaseB, uCrestSharpness ), forkMask );
  float ampMod = 0.7 + 0.3 * ( 0.5 + 0.5 * fbm( p * 0.16 + so + 23.0 ) );
  s.ripple = ripple;
  s.crest = smoothstep( 0.8, 1.0, ripple );

  // --- 砂粒の凹凸：砂紋に沿って細長く伸ばし、ゆがめたセル（鱗状）の境界を細い稜線にする ---
  vec2 gq = q1 + vec2( 0.0, warp );
  vec2 gp = vec2( gq.x / ( uCellSize * uCellStretch ), gq.y / uCellSize ) + so;
  vec2 gw = vec2( gnoise( gp * 0.8 + 3.1 ), gnoise( gp * 0.8 + 8.7 ) );
  vec3 w1 = worley( gp + 0.3 * gw );
  float ridge1 = 1.0 - smoothstep( 0.0, uRidgeWidth, w1.y - w1.x );
  float dome = 1.0 - smoothstep( 0.05, 0.75, w1.x );
  // 細かいセルを薄く重ねて不規則さを足す
  vec3 w2 = worley( gp * 2.3 + 17.3 + 0.2 * gw.yx );
  float ridge2 = 1.0 - smoothstep( 0.0, uRidgeWidth * 1.3, w2.y - w2.x );

  // --- まばらなピット ---
  vec3 wpit = worley( p / ( uCellSize * 0.7 ) + so * 1.7 + 51.0 );
  float pitOn = step( 1.0 - uPitDensity, wpit.z );
  float pitSize = 0.14 + 0.1 * fract( wpit.z * 13.7 );
  float pit = pitOn * ( 1.0 - smoothstep( pitSize * 0.5, pitSize, wpit.x ) );

  // --- 微細なざらつき ---
  float micro = gnoise( p / 0.022 + so ) * 0.6 + gnoise( p / 0.011 + so + 9.0 ) * 0.4;

  s.ridge = clamp( ridge1 + 0.35 * ridge2, 0.0, 1.0 );
  s.dome = dome;
  s.pit = pit;
  s.mottle = fbm( p * 0.9 + so + 77.0 );

  s.h = uRippleAmp * ampMod * ripple
      + uRidgeHeight * ( 0.55 * ridge1 + 0.2 * ridge2 + 0.85 * dome )
      - uPitDepth * pit
      + uMicroHeight * micro;
  return s;
}
`;

const vertexShader = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4( position.xy, 0.0, 1.0 );
}
`;

const normalFragment = /* glsl */ `
precision highp float;
varying vec2 vUv;
uniform float uWorldSize;
uniform float uTexel;
${heightGLSL}
void main() {
  // テクセル中心のワールド座標（x, z）。u は +x、v は -z 方向
  vec2 p = vec2( ( vUv.x - 0.5 ) * uWorldSize, ( 0.5 - vUv.y ) * uWorldSize );
  float e = uTexel;
  float hL = sandHeight( p - vec2( e, 0.0 ) ).h;
  float hR = sandHeight( p + vec2( e, 0.0 ) ).h;
  float hB = sandHeight( p - vec2( 0.0, e ) ).h; // -z
  float hF = sandHeight( p + vec2( 0.0, e ) ).h; // +z
  float dhdx = ( hR - hL ) / ( 2.0 * e );
  float dhdz = ( hF - hB ) / ( 2.0 * e );
  // 接空間：T = +x (u), B = -z (v), N = +y
  vec3 n = normalize( vec3( - dhdx, dhdz, 1.0 ) );
  gl_FragColor = vec4( n * 0.5 + 0.5, 1.0 );
}
`;

const colorFragment = /* glsl */ `
precision highp float;
varying vec2 vUv;
uniform float uWorldSize;
uniform vec3 uBaseColor;
uniform vec3 uShadeColor;
uniform vec3 uHighlightColor;
${heightGLSL}
void main() {
  vec2 p = vec2( ( vUv.x - 0.5 ) * uWorldSize, ( 0.5 - vUv.y ) * uWorldSize );
  SandSample s = sandHeight( p );
  vec3 col = uBaseColor;
  // 砂紋の谷はわずかに濃く、稜線は細く明るい線に
  col = mix( col, uShadeColor, 0.16 * ( 1.0 - s.ripple ) );
  col = mix( col, uHighlightColor, 0.6 * s.crest );
  // 鱗状のセルの縁は少し濃く、網目の稜線は明るく
  col = mix( col, uShadeColor, 0.14 * ( 1.0 - s.dome ) );
  col = mix( col, uHighlightColor, 0.7 * s.ridge );
  // ピットは濃いオレンジ寄り
  col = mix( col, uShadeColor * 0.72, 0.8 * s.pit );
  // ごく弱いまだら
  col *= 1.0 + 0.03 * s.mottle;
  gl_FragColor = vec4( col, 1.0 );
}
`;

export interface SandTextures {
  normalMap: THREE.Texture;
  colorMap: THREE.Texture;
  dispose(): void;
}

/**
 * 砂のノーマルマップとカラーマップを GPU で生成する（外部素材不要）。
 * 台座の上面 UV（0..1）がワールド座標 [-size/2, size/2] に対応する。
 */
export function generateSandTextures(
  renderer: THREE.WebGLRenderer,
  sand: SandConfig,
  worldSize: number,
): SandTextures {
  const maxSize = renderer.capabilities.maxTextureSize;
  const size = Math.min(sand.textureSize, maxSize);
  const anisotropy = renderer.capabilities.getMaxAnisotropy();

  const makeTarget = (colorSpace: THREE.ColorSpace) =>
    new THREE.WebGLRenderTarget(size, size, {
      type: THREE.UnsignedByteType,
      format: THREE.RGBAFormat,
      minFilter: THREE.LinearMipmapLinearFilter,
      magFilter: THREE.LinearFilter,
      wrapS: THREE.ClampToEdgeWrapping,
      wrapT: THREE.ClampToEdgeWrapping,
      generateMipmaps: true,
      depthBuffer: false,
      stencilBuffer: false,
      anisotropy,
      colorSpace,
    });

  const normalTarget = makeTarget(THREE.NoColorSpace);
  const colorTarget = makeTarget(THREE.SRGBColorSpace);

  const r = sand.ripple;
  const g = sand.grain;
  const toLinear = (hex: string) => new THREE.Color(hex); // Color は内部的にリニア
  const shared = {
    uWorldSize: { value: worldSize },
    uTexel: { value: worldSize / size },
    uSeed: { value: sand.seed },
    uRippleWavelength: { value: r.wavelength },
    uRippleAmp: { value: r.amplitude },
    uRippleAngle: { value: THREE.MathUtils.degToRad(r.angle) },
    uRippleWarp: { value: r.warp },
    uRippleWarpScale: { value: r.warpScale },
    uRippleBend: { value: r.bend },
    uCrestSharpness: { value: r.crestSharpness },
    uForkiness: { value: r.forkiness },
    uCellSize: { value: g.cellSize },
    uCellStretch: { value: g.cellStretch },
    uRidgeWidth: { value: g.ridgeWidth },
    uRidgeHeight: { value: g.ridgeHeight },
    uPitDensity: { value: g.pitDensity },
    uPitDepth: { value: g.pitDepth },
    uMicroHeight: { value: g.microHeight },
  };

  const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2));
  quad.frustumCulled = false;
  const scene = new THREE.Scene();
  scene.add(quad);
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

  const normalMaterial = new THREE.ShaderMaterial({
    vertexShader,
    fragmentShader: normalFragment,
    uniforms: shared,
    depthTest: false,
    depthWrite: false,
  });
  const colorMaterial = new THREE.ShaderMaterial({
    vertexShader,
    fragmentShader: colorFragment,
    uniforms: {
      ...shared,
      uBaseColor: { value: toLinear(sand.color) },
      uShadeColor: { value: toLinear(sand.shadeColor) },
      uHighlightColor: { value: toLinear(sand.highlightColor) },
    },
    depthTest: false,
    depthWrite: false,
  });

  const prevTarget = renderer.getRenderTarget();

  quad.material = normalMaterial;
  renderer.setRenderTarget(normalTarget);
  renderer.render(scene, camera);

  quad.material = colorMaterial;
  renderer.setRenderTarget(colorTarget);
  renderer.render(scene, camera);

  renderer.setRenderTarget(prevTarget);

  quad.geometry.dispose();
  normalMaterial.dispose();
  colorMaterial.dispose();

  return {
    normalMap: normalTarget.texture,
    colorMap: colorTarget.texture,
    dispose() {
      normalTarget.dispose();
      colorTarget.dispose();
    },
  };
}
