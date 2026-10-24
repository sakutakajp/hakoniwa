import * as THREE from 'three';
import type { SceneConfig } from '../config';
import { BAKED_VISIBILITY_FUNCTIONS, lightsBeginWithBakedVisibility } from '../bakedLighting';

/** GLSL の共通の乱数・ノイズ・セルノイズ */
export const TERRAIN_NOISE = /* glsl */ `
float tnHash12( vec2 p ) {
  vec3 p3 = fract( vec3( p.xyx ) * 0.1031 );
  p3 += dot( p3, p3.yzx + 33.33 );
  return fract( ( p3.x + p3.y ) * p3.z );
}
vec2 tnHash22( vec2 p ) {
  vec3 p3 = fract( vec3( p.xyx ) * vec3( 0.1031, 0.1030, 0.0973 ) );
  p3 += dot( p3, p3.yzx + 33.33 );
  return fract( ( p3.xx + p3.yz ) * p3.zy );
}
vec3 tnHash33( vec3 p ) {
  p = fract( p * vec3( 0.1031, 0.1030, 0.0973 ) );
  p += dot( p, p.yxz + 33.33 );
  return fract( ( p.xxy + p.yxx ) * p.zyx );
}
// 値ノイズ（0〜1）
float tnNoise( vec2 p ) {
  vec2 i = floor( p );
  vec2 f = fract( p );
  vec2 u = f * f * ( 3.0 - 2.0 * f );
  return mix( mix( tnHash12( i ), tnHash12( i + vec2( 1.0, 0.0 ) ), u.x ), mix( tnHash12( i + vec2( 0.0, 1.0 ) ), tnHash12( i + vec2( 1.0, 1.0 ) ), u.x ), u.y );
}
float tnFbm( vec2 p ) {
  float s = 0.0;
  float a = 0.5;
  for ( int i = 0; i < 4; i ++ ) {
    s += a * tnNoise( p );
    p = p * 2.03 + vec2( 17.1, -9.7 );
    a *= 0.5;
  }
  return s / 0.9375;
}
float tnNoise3( vec3 p ) {
  vec3 i = floor( p );
  vec3 f = fract( p );
  vec3 u = f * f * ( 3.0 - 2.0 * f );
  float a = tnHash33( i ).x;
  float b = tnHash33( i + vec3( 1.0, 0.0, 0.0 ) ).x;
  float c = tnHash33( i + vec3( 0.0, 1.0, 0.0 ) ).x;
  float d = tnHash33( i + vec3( 1.0, 1.0, 0.0 ) ).x;
  float e = tnHash33( i + vec3( 0.0, 0.0, 1.0 ) ).x;
  float g = tnHash33( i + vec3( 1.0, 0.0, 1.0 ) ).x;
  float h = tnHash33( i + vec3( 0.0, 1.0, 1.0 ) ).x;
  float k = tnHash33( i + vec3( 1.0, 1.0, 1.0 ) ).x;
  return mix( mix( mix( a, b, u.x ), mix( c, d, u.x ), u.y ), mix( mix( e, g, u.x ), mix( h, k, u.x ), u.y ), u.z );
}
// 2D のセルノイズ：x = 最も近い点までの距離, y = 2 番目との差（境目で 0）, z = セルの乱数
vec3 tnCells( vec2 p, float jitter ) {
  vec2 i = floor( p );
  vec2 f = fract( p );
  float d1 = 8.0;
  float d2 = 8.0;
  float id = 0.0;
  for ( int y = -1; y <= 1; y ++ ) {
    for ( int x = -1; x <= 1; x ++ ) {
      vec2 b = vec2( float( x ), float( y ) );
      vec2 h = tnHash22( i + b );
      vec2 r = b + 0.5 + jitter * ( h - 0.5 ) - f;
      float d = dot( r, r );
      if ( d < d1 ) {
        d2 = d1;
        d1 = d;
        id = tnHash12( i + b + 7.7 );
      } else if ( d < d2 ) {
        d2 = d;
      }
    }
  }
  return vec3( sqrt( d1 ), sqrt( d2 ) - sqrt( d1 ), id );
}
// 3D のセルノイズ（切り口の石の塊。角を回っても模様が続く）
vec3 tnCells3( vec3 p ) {
  vec3 i = floor( p );
  vec3 f = fract( p );
  float d1 = 8.0;
  float d2 = 8.0;
  float id = 0.0;
  for ( int z = -1; z <= 1; z ++ ) {
    for ( int y = -1; y <= 1; y ++ ) {
      for ( int x = -1; x <= 1; x ++ ) {
        vec3 b = vec3( float( x ), float( y ), float( z ) );
        vec3 h = tnHash33( i + b );
        vec3 r = b + 0.15 + 0.7 * h - f;
        float d = dot( r, r );
        if ( d < d1 ) {
          d2 = d1;
          d1 = d;
          id = tnHash33( i + b + 3.3 ).x;
        } else if ( d < d2 ) {
          d2 = d;
        }
      }
    }
  }
  return vec3( sqrt( d1 ), sqrt( d2 ) - sqrt( d1 ), id );
}
`;

const col = (hex: string) => new THREE.Color(hex);

/**
 * 地面の上面のマテリアル。
 *  - 森の地面：苔・下草・土・落ち葉を、大小のまだらで混ぜる
 *  - 砂地：左岸の砂浜と林の中の開けた砂地（細かな砂粒と、散らばる小石の点）
 *  - 川岸の斜面：土がのぞく。水際は濡れて暗い砂
 *  - 川底：明るい砂と小石。切り立った壁は石
 *  - 影と空からの遮蔽は、上面に焼き込んだもの（水の中では薄く）
 */
export function createGroundMaterial(
  config: SceneConfig,
  opts: {
    mask: THREE.Texture;
    maskSize: number;
    levelRange: [number, number];
  },
): { material: THREE.MeshStandardMaterial; setBake: (bake: { texture: THREE.Texture; size: number }) => void } {
  const c = config.terrain.groundColors;
  const material = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1, metalness: 0 });
  const placeholder = new THREE.DataTexture(new Uint8Array([0, 0, 0, 255]), 1, 1);
  placeholder.needsUpdate = true;
  const uniforms = {
    uGrMask: { value: opts.mask },
    uGrMaskSize: { value: opts.maskSize },
    uGrLevelRange: { value: new THREE.Vector2(...opts.levelRange) },
    uGrBake: { value: placeholder as THREE.Texture },
    uGrBakeSize: { value: 1 },
    uGrShadow: { value: config.shadow.strength },
    uGrAo: { value: config.shadow.groundAoStrength },
    uGrBedShadow: { value: config.water.bedShadow },
    uGrMoss: { value: col(c.moss) },
    uGrMossLight: { value: col(c.mossLight) },
    uGrGrass: { value: col(c.grass) },
    uGrSoil: { value: col(c.soil) },
    uGrLitter: { value: col(c.litter) },
    uGrSand: { value: col(c.sand) },
    uGrSandLight: { value: col(c.sandLight) },
    uGrWetSand: { value: col(c.wetSand) },
    uGrBed: { value: col(c.bed) },
    uGrBedStone: { value: col(c.bedStone) },
  };
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vGrPos;\nvarying vec3 vGrN;')
      .replace(
        '#include <project_vertex>',
        `#include <project_vertex>
vGrPos = ( modelMatrix * vec4( transformed, 1.0 ) ).xyz;
vGrN = normalize( mat3( modelMatrix ) * objectNormal );`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
uniform sampler2D uGrMask;
uniform float uGrMaskSize;
uniform vec2 uGrLevelRange;
uniform sampler2D uGrBake;
uniform float uGrBakeSize;
uniform float uGrShadow;
uniform float uGrAo;
uniform float uGrBedShadow;
uniform vec3 uGrMoss;
uniform vec3 uGrMossLight;
uniform vec3 uGrGrass;
uniform vec3 uGrSoil;
uniform vec3 uGrLitter;
uniform vec3 uGrSand;
uniform vec3 uGrSandLight;
uniform vec3 uGrWetSand;
uniform vec3 uGrBed;
uniform vec3 uGrBedStone;
varying vec3 vGrPos;
varying vec3 vGrN;
${BAKED_VISIBILITY_FUNCTIONS}
${TERRAIN_NOISE}
float grUnder = 0.0;
vec3 gGrOcc = vec3( 0.0 );
// 細かな凹凸の高さ（苔の粒・砂粒・小石）。fade は遠くで細かな模様を弱める割合
float grDetail( vec2 p, float sandM, float under, float fade ) {
  float moss = tnNoise( p * 55.0 ) * 0.6 + tnNoise( p * 130.0 ) * 0.4 * fade;
  vec3 pc = tnCells( p * 26.0, 0.9 );
  float pebble = ( 1.0 - smoothstep( 0.18, 0.32, pc.x ) ) * step( 0.72, pc.z );
  float grain = tnNoise( p * 160.0 ) * fade;
  float land = mix( moss * 0.8, grain * 0.35 + pebble * 0.9, sandM );
  return mix( land, grain * 0.3 + pebble * 0.7, under );
}`,
      )
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
vec3 grP = vGrPos;
vec3 grN0 = normalize( vGrN );
vec2 grUv = vec2( grP.x / uGrMaskSize + 0.5, 0.5 - grP.z / uGrMaskSize );
vec4 grMask = texture2D( uGrMask, grUv );
float grSandM = grMask.r;
float grHasWater = step( 0.003, grMask.a );
float grLevel = uGrLevelRange.x + grMask.a * ( uGrLevelRange.y - uGrLevelRange.x );
grUnder = grHasWater * smoothstep( 0.0, 0.025, grLevel - grP.y );
float grWet = grHasWater * ( 1.0 - smoothstep( 0.0, 0.07, grP.y - grLevel ) ) * ( 1.0 - grUnder ) * grMask.b;
float grSteep = 1.0 - smoothstep( 0.5, 0.86, grN0.y );
float grPx = max( length( fwidth( grP.xz ) ), 1e-4 );
float grFade = 1.0 - smoothstep( 0.004, 0.012, grPx );
{
  // 崖のような急な面では、上から見た座標の模様が縦に伸びないよう、面に沿った座標を使う
  vec2 q = mix( grP.xz, vec2( grP.x * 0.8 + grP.z * 0.6, grP.y * 1.3 ), smoothstep( 0.35, 0.8, grSteep ) );
  float n1 = tnFbm( q * 0.85 + 3.0 );
  float n2 = tnFbm( q * 2.6 - 5.0 );
  float n3 = tnNoise( q * 9.0 + 1.3 );
  float n4 = tnNoise( q * 31.0 - 2.1 );
  // 森の地面：苔と下草のまとまり、ところどころ土と落ち葉
  vec3 floorC = mix( uGrMoss, uGrGrass, smoothstep( 0.35, 0.65, n1 ) );
  floorC = mix( floorC, uGrMossLight, 0.75 * smoothstep( 0.55, 0.8, n2 ) );
  floorC = mix( floorC, uGrSoil, 0.85 * smoothstep( 0.58, 0.82, 1.0 - n1 + 0.25 * ( n3 - 0.5 ) ) );
  floorC = mix( floorC, uGrLitter, 0.55 * smoothstep( 0.6, 0.85, n2 * 0.6 + n3 * 0.4 ) );
  floorC *= 0.82 + 0.3 * mix( 0.5, n4, grFade );
  // 砂地：明るい砂に、粒のむらと、散らばる小石の暗い点。縁には草がまだらに残る
  vec3 sandC = mix( uGrSand, uGrSandLight, smoothstep( 0.3, 0.75, n2 ) );
  sandC *= 0.93 + 0.12 * mix( 0.5, tnNoise( q * 120.0 ), grFade );
  vec3 pc = tnCells( q * 26.0, 0.9 );
  float pebble = ( 1.0 - smoothstep( 0.12, 0.26, pc.x ) ) * step( 0.84, pc.z );
  sandC = mix( sandC, uGrSoil * ( 0.8 + 0.5 * pc.z ), pebble * 0.6 * grFade );
  // 砂地の草：小さなまだら（縁ほど多い）
  float n5 = tnNoise( q * 22.0 + 7.7 );
  float tuft = smoothstep( 0.66, 0.82, n5 * 0.65 + n3 * 0.45 ) * ( 1.0 - smoothstep( 0.45, 0.9, grSandM ) );
  sandC = mix( sandC, uGrGrass * 1.05, tuft * 0.75 );
  vec3 c = mix( floorC, sandC, smoothstep( 0.15, 0.85, grSandM ) );
  // 川岸の斜面：土がのぞく（落ち葉と、ところどころ苔）。砂地の岸は砂のまま
  vec3 bankC = mix( uGrSoil * 0.85, uGrLitter, 0.4 * n3 ) * ( 0.82 + 0.28 * mix( 0.5, n4, grFade ) );
  bankC = mix( bankC, sandC * 0.94, smoothstep( 0.3, 0.75, grSandM ) );
  bankC = mix( bankC, mix( uGrMoss, uGrMossLight, 0.3 * n3 ), 0.5 * smoothstep( 0.42, 0.72, n2 ) );
  // 切り立った所（滝のまわりの谷の壁）は、苔むした灰褐色の岩肌がのぞく（不ぞろいな割れ目）
  float rn = tnFbm( q * 3.1 + 7.0 );
  float ridge = 1.0 - abs( 2.0 * tnNoise( q * vec2( 4.5, 10.0 ) + 2.0 ) - 1.0 );
  vec3 stoneC = mix( uGrBedStone * 0.92, uGrSandLight * 0.78, smoothstep( 0.35, 0.75, rn ) ) * ( 0.86 + 0.2 * mix( 0.5, n4, grFade ) );
  stoneC *= 1.0 - 0.32 * smoothstep( 0.86, 0.98, ridge );
  stoneC = mix( stoneC, uGrMoss * 0.85, smoothstep( 0.55, 0.8, n2 ) * 0.5 );
  bankC = mix( bankC, stoneC, smoothstep( 0.78, 0.95, grSteep ) * smoothstep( 0.32, 0.55, rn ) );
  c = mix( c, bankC, grSteep * ( 1.0 - grUnder ) * 0.85 );
  // 水際：濡れて暗い砂
  c = mix( c, uGrWetSand * ( 0.9 + 0.2 * n3 ), grWet * 0.85 );
  // 川底：明るい砂と小石。切り立った壁は石
  vec3 bedC = mix( uGrBed, uGrBed * vec3( 0.93, 0.95, 0.9 ), n2 );
  // 川底の小石：大きさも濃さも不ぞろいに、まばらに（規則正しい点の並びに見えないように）
  vec3 bc = tnCells( q * 13.0 + 3.1, 0.95 );
  float bedR = 0.12 + 0.16 * fract( bc.z * 7.31 );
  float bedPebble = ( 1.0 - smoothstep( bedR, bedR + 0.12, bc.x ) ) * step( 0.68, bc.z ) * smoothstep( 0.3, 0.6, n2 + 0.3 * n3 );
  bedC = mix( bedC, uGrBedStone * ( 0.8 + 0.45 * fract( bc.z * 3.7 ) ), bedPebble * 0.45 );
  bedC = mix( bedC, uGrBedStone * ( 0.85 + 0.3 * n4 ), smoothstep( 0.35, 0.8, grSteep ) );
  c = mix( c, bedC, grUnder );
  // 滝のまわり：しぶきで濡れた暗い岩肌と苔（滝の段の壁は水の中でも岩肌）
  float grSpray = grMask.g;
  vec3 wetRock = mix( uGrBedStone * vec3( 0.5, 0.52, 0.48 ), uGrMoss * 0.62, 0.4 * smoothstep( 0.4, 0.7, n2 ) ) * ( 0.85 + 0.3 * n4 );
  c = mix( c, wetRock, grSpray * smoothstep( 0.2, 0.6, grSteep ) * 0.9 );
  c *= 1.0 - 0.15 * grSpray * ( 1.0 - grUnder );
  diffuseColor.rgb *= c;
}`,
      )
      .replace(
        '#include <normal_fragment_maps>',
        `#include <normal_fragment_maps>
{
  // 細かな凹凸（苔・砂粒・小石）を法線に
  const float e = 0.0025;
  vec2 q = grP.xz;
  float h0 = grDetail( q, grSandM, grUnder, grFade );
  float hx = grDetail( q + vec2( e, 0.0 ), grSandM, grUnder, grFade );
  float hz = grDetail( q + vec2( 0.0, e ), grSandM, grUnder, grFade );
  vec3 g = vec3( hx - h0, 0.0, hz - h0 ) / e * 0.004;
  vec3 nW = normalize( grN0 - ( g - grN0 * dot( grN0, g ) ) * ( 1.0 - 0.5 * grSteep ) );
  normal = normalize( ( viewMatrix * vec4( nW, 0.0 ) ).xyz );
}`,
      )
      .replace(
        '#include <lights_fragment_begin>',
        `{
  vec2 bUv = vec2( grP.x / uGrBakeSize + 0.5, 0.5 - grP.z / uGrBakeSize );
  gGrOcc = clamp( texture2D( uGrBake, bUv ).rgb, 0.0, 1.0 );
  // 水の中は光が散らばって影が薄い
  gGrOcc.rb *= mix( 1.0, uGrBedShadow, grUnder );
  gGrOcc.g *= mix( 1.0, 0.4, grUnder );
  gBakedVis = 1.0 - uGrShadow * gGrOcc.rb;
}
${lightsBeginWithBakedVisibility()}`,
      )
      .replace(
        '#include <lights_fragment_end>',
        `#include <lights_fragment_end>
reflectedLight.indirectDiffuse *= 1.0 - uGrAo * gGrOcc.g;`,
      )
      .replace(
        '#include <dithering_fragment>',
        `#include <dithering_fragment>
// 水の中の部分に印（色の画像の不透明度を 0.5 に）：断面のシェーダーが川底と岸を見分けるのに使う
gl_FragColor.a = grUnder > 0.5 ? 0.5 : 1.0;`,
      );
  };
  material.customProgramCacheKey = () => 'dino-ground';
  return {
    material,
    setBake: (bake) => {
      uniforms.uGrBake.value = bake.texture;
      uniforms.uGrBakeSize.value = bake.size;
    },
  };
}

/**
 * 外周の切り口のマテリアル：上に暗い茶色の表土（ぼろぼろとした土と小石・細い根）、
 * その下にひび割れた明るい石灰岩の塊（大小の丸みのある石と、石のあいだのひびに詰まった小石）。
 * 表土の厚みは川で削る前の地面の高さ（aGround）から測る（川の断面の壁は石灰岩になる）。
 */
export function createStrataMaterial(
  config: SceneConfig,
  yBase: number,
  outline: { half: number; radius: number },
): THREE.MeshStandardMaterial {
  const t = config.terrain;
  const c = t.strataColors;
  const material = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1, metalness: 0 });
  const uniforms = {
    uStSoil: { value: col(c.soil) },
    uStSoilDark: { value: col(c.soilDark) },
    uStSoilLight: { value: col(c.soilLight) },
    uStRootMat: { value: col(c.rootMat) },
    uStStone: { value: col(c.stone) },
    uStStoneLight: { value: col(c.stoneLight) },
    uStStoneDark: { value: col(c.stoneDark) },
    uStCrack: { value: col(c.crack) },
    uStPebble: { value: col(c.pebble) },
    uStSoilParams: { value: new THREE.Vector3(t.soil.thickness, t.soil.wave, 1 / t.soil.waveSize) },
    uStStoneSize: { value: new THREE.Vector3(t.stones.size[0], t.stones.size[1], t.stones.crack) },
    uStBase: { value: yBase },
    // 外周の形（角丸の正方形の半分の幅と角の半径）と、外周 1 周に並べる石の数（1 周でちょうど継ぎ目なくつながるように）
    uStOutline: {
      value: (() => {
        const a = outline.half - outline.radius;
        const perimeter = 8 * a + 2 * Math.PI * outline.radius;
        const n = Math.max(1, Math.round(perimeter / t.stones.size[0]));
        return new THREE.Vector4(outline.half, outline.radius, perimeter, n);
      })(),
    },
  };
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        '#include <common>\nattribute float aGround;\nvarying float vStGround;\nvarying vec3 vStPos;\nvarying vec3 vStN;',
      )
      .replace(
        '#include <project_vertex>',
        `#include <project_vertex>
vStGround = aGround;
vStPos = ( modelMatrix * vec4( transformed, 1.0 ) ).xyz;
vStN = normalize( mat3( modelMatrix ) * objectNormal );`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
uniform vec3 uStSoil;
uniform vec3 uStSoilDark;
uniform vec3 uStSoilLight;
uniform vec3 uStRootMat;
uniform vec3 uStStone;
uniform vec3 uStStoneLight;
uniform vec3 uStStoneDark;
uniform vec3 uStCrack;
uniform vec3 uStPebble;
uniform vec3 uStSoilParams;
uniform vec3 uStStoneSize;
uniform float uStBase;
uniform vec4 uStOutline;
varying float vStGround;
varying vec3 vStPos;
varying vec3 vStN;
${TERRAIN_NOISE}
float stCav = 0.0;
// 外周に沿った長さ（右の面の奥の端から、上から見て反時計回り。角の丸みも長さどおりに進む）
float stAlong( vec3 p ) {
  float a = uStOutline.x - uStOutline.y;
  float r = uStOutline.y;
  vec2 q = vec2( p.x, p.z );
  vec2 d = q - clamp( q, -a, a );
  const float HP = 1.5707963;
  if ( d.x > 0.0 && d.y == 0.0 ) return q.y + a;
  if ( d.y > 0.0 && d.x == 0.0 ) return 2.0 * a + r * HP + ( a - q.x );
  if ( d.x < 0.0 && d.y == 0.0 ) return 4.0 * a + 2.0 * r * HP + ( a - q.y );
  if ( d.y < 0.0 && d.x == 0.0 ) return 6.0 * a + 3.0 * r * HP + ( q.x + a );
  // 角：角の円の中心から見た向き
  float th = atan( d.y, d.x );
  if ( th < 0.0 ) th += 6.2831853;
  if ( th < HP ) return 2.0 * a + r * th;
  if ( th < 2.0 * HP ) return 4.0 * a + r * th;
  if ( th < 3.0 * HP ) return 6.0 * a + r * th;
  return 8.0 * a + r * th;
}
// 横方向に period 個で 1 周する石組みのセル（継ぎ目なし）。戻り値は tnCells と同じ
vec3 stCellsWrap( vec2 p, float jitter, float period ) {
  vec2 i = floor( p );
  vec2 f = fract( p );
  float d1 = 8.0;
  float d2 = 8.0;
  float id = 0.0;
  for ( int y = -1; y <= 1; y ++ ) {
    for ( int x = -1; x <= 1; x ++ ) {
      vec2 b = vec2( float( x ), float( y ) );
      vec2 cid = vec2( mod( i.x + b.x, period ), i.y + b.y );
      vec2 h = tnHash22( cid );
      vec2 r = b + 0.5 + jitter * ( h - 0.5 ) - f;
      float d = dot( r, r );
      if ( d < d1 ) {
        d2 = d1;
        d1 = d;
        id = tnHash12( cid + 7.7 );
      } else if ( d < d2 ) {
        d2 = d;
      }
    }
  }
  return vec3( sqrt( d1 ), sqrt( d2 ) - sqrt( d1 ), id );
}
// 切り口の細かな凹凸の高さと色。soilK は表土らしさ
float stHeight( vec3 p, out vec3 albedo, out float soilK, out float cav ) {
  float along = stAlong( p );
  // 表土と石灰岩の境目（うねり、ところどころ石が表土に食い込む）
  float wave = uStSoilParams.y * ( tnNoise3( vec3( p.x, 3.7, p.z ) * uStSoilParams.z ) * 2.0 - 1.0 )
    + 0.025 * ( tnNoise3( vec3( p.x, 1.1, p.z ) * 6.0 ) - 0.5 );
  float boundary = vStGround - uStSoilParams.x + wave;
  // 石灰岩の塊：横長のセル（下の方ほどひびが少し広い）
  float low = 1.0 - smoothstep( uStBase + 0.06, uStBase + 0.32, p.y );
  // 外周に沿った長さと高さで、面の上の 2 次元の石組みにする（角を回っても、1 周しても続く）
  vec2 q = vec2( along * uStOutline.w / uStOutline.z, p.y / uStStoneSize.y );
  // 石の輪郭を少しゆがめる（空間の模様なので継ぎ目はない）
  vec3 wp = p / uStStoneSize.x * 2.3;
  q += 0.16 * vec2( tnNoise3( wp ) - 0.5, tnNoise3( wp + 5.0 ) - 0.5 );
  vec3 cell = stCellsWrap( q, 0.85, uStOutline.w );
  float crackW = uStStoneSize.z * mix( 1.0, 1.35, low );
  float edge = smoothstep( 0.0, crackW * 2.2, cell.y );
  float crack = 1.0 - smoothstep( crackW * 0.4, crackW, cell.y );
  // 石の表面：丸みと、細かなざらつき・小さな穴
  float grit = tnNoise3( p * 30.0 ) * 0.45 + tnNoise3( p * 71.0 + 3.0 ) * 0.33 + tnNoise3( p * 160.0 - 2.0 ) * 0.22;
  float pit = smoothstep( 0.68, 0.88, tnNoise3( p * 40.0 + 4.0 ) );
  float stoneH = 0.6 * sqrt( edge ) + 0.08 * grit - 0.12 * pit;
  vec3 stoneC = mix( uStStoneDark, uStStone, smoothstep( 0.1, 0.6, cell.z ) );
  stoneC = mix( stoneC, uStStoneLight, smoothstep( 0.55, 0.95, cell.z ) * 0.8 );
  stoneC *= 0.9 + 0.16 * grit;
  stoneC = mix( stoneC, uStStoneDark * 0.9, pit * 0.18 );
  // 石の縁ほど暗く、真ん中は明るい（丸みのある塊に見せる）
  stoneC *= mix( 0.8, 1.04, smoothstep( 0.0, 0.75, edge ) );
  // ひびの奥：暗い土と、詰まった白っぽい小石
  vec3 pc = tnCells3( p * 26.0 );
  float peb = ( 1.0 - smoothstep( 0.25, 0.4, pc.x ) ) * step( 0.45, pc.z );
  vec3 crackC = mix( uStCrack, uStPebble * ( 0.8 + 0.25 * pc.z ), peb );
  vec3 stone = mix( stoneC, crackC, crack * 0.7 );
  float stoneHeight = mix( stoneH, -0.15 + 0.35 * peb, crack );
  // 表土：ぼろぼろの土（暗いすき間、明るい粒）、小石と細い根
  float s1 = tnNoise3( p * 18.0 );
  float s2 = tnNoise3( p * 52.0 + 2.0 );
  vec3 soilC = mix( uStSoilDark, uStSoil, smoothstep( 0.2, 0.75, s1 ) );
  soilC = mix( soilC, uStSoilLight, smoothstep( 0.72, 0.95, s2 ) * 0.7 );
  vec3 sp = tnCells3( p * vec3( 30.0, 34.0, 30.0 ) + 9.0 );
  float sPeb = ( 1.0 - smoothstep( 0.2, 0.34, sp.x ) ) * step( 0.78, sp.z );
  soilC = mix( soilC, uStPebble * 0.85, sPeb * 0.8 );
  float root = ( 1.0 - smoothstep( 0.0, 0.03, abs( tnNoise3( vec3( p.x * 3.0, p.y * 14.0, p.z * 3.0 ) ) - 0.5 ) ) )
    * step( 0.55, tnNoise3( vec3( p.x * 1.3, p.y * 3.0, p.z * 1.3 ) + 2.0 ) );
  soilC = mix( soilC, uStSoilLight * 0.9, root * 0.5 );
  float soilH = 0.35 * s1 + 0.25 * s2 + 0.4 * sPeb;
  // 境目：石が表土に食い込む所（石の上の方）と、表土が石のひびに入り込む所
  float into = smoothstep( -0.03, 0.03, p.y - boundary - 0.06 * ( 1.0 - edge ) );
  soilK = into;
  albedo = mix( stone, soilC, into );
  // 表土のすぐ下（境目の帯）は少し暗い
  albedo *= 1.0 - 0.12 * ( 1.0 - smoothstep( 0.0, 0.08, boundary - p.y ) ) * ( 1.0 - into );
  // 表土の上の縁：草の根の混じったオリーブ色の層（上面の地面の色へなじむ）
  float mat = smoothstep( vStGround - 0.11 + 0.03 * s1, vStGround - 0.035, p.y );
  albedo = mix( albedo, uStRootMat * ( 0.88 + 0.24 * s2 ), mat * into * 0.85 );
  // 上の縁（上面との境の丸み）は土と草の色
  cav = mix( crack * 0.8 + pit * 0.3, 0.3 * ( 1.0 - s1 ), into );
  return mix( stoneHeight, soilH, into );
}`,
      )
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
vec3 stAlb;
float stSoilK;
float stH0 = stHeight( vStPos, stAlb, stSoilK, stCav );
diffuseColor.rgb *= stAlb;`,
      )
      .replace(
        '#include <normal_fragment_maps>',
        `#include <normal_fragment_maps>
{
  vec3 n0 = normalize( vStN );
  // 面に沿った 2 方向で高さの差をとってバンプにする
  vec3 tA = normalize( vec3( -n0.z, 0.0, n0.x ) );
  vec3 tB = vec3( 0.0, 1.0, 0.0 );
  const float e = 0.004;
  vec3 a1;
  float k1;
  float c1;
  float hA = stHeight( vStPos + tA * e, a1, k1, c1 );
  float hB = stHeight( vStPos + tB * e, a1, k1, c1 );
  float bump = mix( 0.022, 0.012, stSoilK );
  // 上を向いた縁の丸みには付けない
  bump *= 1.0 - smoothstep( 0.4, 0.8, n0.y );
  vec3 nW = normalize( n0 - bump * ( tA * ( hA - stH0 ) + tB * ( hB - stH0 ) ) / e );
  normal = normalize( ( viewMatrix * vec4( nW, 0.0 ) ).xyz );
}`,
      )
      .replace(
        '#include <lights_fragment_end>',
        `#include <lights_fragment_end>
{
  // ひびの奥と、土台に近い下の方は暗い
  float lowAo = smoothstep( uStBase, uStBase + 0.25, vStPos.y );
  reflectedLight.indirectDiffuse *= ( 1.0 - 0.55 * stCav ) * mix( 0.7, 1.0, lowAo );
  reflectedLight.directDiffuse *= 1.0 - 0.45 * stCav;
}`,
      );
  };
  material.customProgramCacheKey = () => 'dino-strata';
  return material;
}
