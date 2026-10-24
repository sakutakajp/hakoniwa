/**
 * 川の水のシェーダー（シリーズの海のシェーダーを、流れる川に合わせたもの）。
 *  - RIPPLES：細かなさざ波と風浪（法線を傾ける）。流れのテクスチャに乗せて下流へ動かす
 *  - WATER_COLOR：水深と、光が水中を通る距離による色・透明度（吸収と散乱）
 *  - CAUSTICS：川底や水中の岩に映る、揺れる網目状の光
 *  - FOAM：岸と水面から出た岩のまわりの白い泡、滝つぼの泡、水を飲む恐竜の口元の波紋（恐竜の模型を置いたときに使う。既定では出さない）
 *  - WATER_VERTEX / WATER_FRAGMENT：水面（surface）と断面（WATER_WALL）で共通の本体
 *  - COPY_*：不透明な物を描いた画像を、奥行きと一緒に画面へ写す
 */

const NOISE = /* glsl */ `
vec2 wHash22( vec2 p ) {
  vec3 p3 = fract( vec3( p.xyx ) * vec3( 0.1031, 0.1030, 0.0973 ) );
  p3 += dot( p3, p3.yzx + 33.33 );
  return fract( ( p3.xx + p3.yz ) * p3.zy );
}
// 勾配ノイズ（おおよそ -1〜1）
float wNoise( vec2 p ) {
  vec2 i = floor( p );
  vec2 f = fract( p );
  vec2 u = f * f * ( 3.0 - 2.0 * f );
  float a = dot( wHash22( i ) * 2.0 - 1.0, f );
  float b = dot( wHash22( i + vec2( 1.0, 0.0 ) ) * 2.0 - 1.0, f - vec2( 1.0, 0.0 ) );
  float c = dot( wHash22( i + vec2( 0.0, 1.0 ) ) * 2.0 - 1.0, f - vec2( 0.0, 1.0 ) );
  float d = dot( wHash22( i + vec2( 1.0, 1.0 ) ) * 2.0 - 1.0, f - vec2( 1.0, 1.0 ) );
  return 1.4 * mix( mix( a, b, u.x ), mix( c, d, u.x ), u.y );
}
`;

/** さざ波。uRipple = (強さ, 細かさ) */
const RIPPLES = /* glsl */ `
// さざ波の高さの勾配（3 層のノイズ）
vec2 rippleGrad( vec2 p, float t ) {
  vec2 g = vec2( 0.0 );
  const float e = 0.12;
  vec2 q = p * uRipple.y + vec2( 0.06, 0.035 ) * t;
  g += vec2( wNoise( q + vec2( e, 0.0 ) ) - wNoise( q - vec2( e, 0.0 ) ), wNoise( q + vec2( 0.0, e ) ) - wNoise( q - vec2( 0.0, e ) ) ) / ( 2.0 * e );
  q = p * uRipple.y * 2.3 + vec2( -0.05, 0.07 ) * t + 7.3;
  g += 0.5 * vec2( wNoise( q + vec2( e, 0.0 ) ) - wNoise( q - vec2( e, 0.0 ) ), wNoise( q + vec2( 0.0, e ) ) - wNoise( q - vec2( 0.0, e ) ) ) / ( 2.0 * e );
  q = p * uRipple.y * 0.45 + vec2( 0.03, -0.02 ) * t - 3.1;
  g += 0.7 * vec2( wNoise( q + vec2( e, 0.0 ) ) - wNoise( q - vec2( e, 0.0 ) ), wNoise( q + vec2( 0.0, e ) ) - wNoise( q - vec2( 0.0, e ) ) ) / ( 2.0 * e );
  return g * uRipple.x * 0.035;
}
// 細かな風浪：繰り返し模様の波の傾きのテクスチャを 2 枚重ねる
vec2 waveletGrad( vec2 p, float t ) {
  if ( uWaveTex.x <= 0.0 ) return vec2( 0.0 );
  vec2 g1 = texture2D( tWaves, p * uWaveTex.y + vec2( 0.011, -0.023 ) * t * uWaveTex.z ).rg * 2.0 - 1.0;
  mat2 rot = mat2( 0.8, 0.6, -0.6, 0.8 );
  vec2 q = rot * p;
  vec2 g2 = texture2D( tWaves, q * uWaveTex.y * 1.73 + vec2( -0.017, -0.012 ) * t * uWaveTex.z + 0.37 ).rg * 2.0 - 1.0;
  g2 = vec2( rot[ 0 ][ 0 ] * g2.x + rot[ 0 ][ 1 ] * g2.y, rot[ 1 ][ 0 ] * g2.x + rot[ 1 ][ 1 ] * g2.y );
  return ( g1 + 0.55 * g2 ) * uWaveTex.x;
}
// 流れに乗せたさざ波：流れの向きに模様をずらし、半周期ずれた 2 つを交互に混ぜる（模様が伸びきる前に入れ替える）
vec2 flowRipples( vec2 p, float t, vec3 flow ) {
  vec2 v = ( flow.xy * 2.0 - 1.0 ) * flow.z * uFlowSpeed;
  float ph0 = fract( t * 0.35 );
  float ph1 = fract( t * 0.35 + 0.5 );
  float wgt = abs( ph0 * 2.0 - 1.0 );
  float T = 1.0 / 0.35;
  vec2 p0 = p - v * ph0 * T;
  vec2 p1 = p - v * ph1 * T + vec2( 0.37, 0.71 );
  vec2 g0 = rippleGrad( p0, t * 0.3 ) + waveletGrad( p0, t * 0.3 );
  vec2 g1 = rippleGrad( p1, t * 0.3 ) + waveletGrad( p1, t * 0.3 );
  // 流れの速い所ほど波立つ
  return mix( g1, g0, wgt ) * ( 0.75 + 0.9 * flow.z );
}
`;

/** 水中の光の網目（コースティクス）。uCaustic = (強さ, 細かさ, 速さ, 弱まる水深) */
const CAUSTICS = /* glsl */ `
float causticLayer( vec2 p, float t ) {
  vec2 i = floor( p );
  vec2 f = fract( p );
  float d1 = 8.0;
  float d2 = 8.0;
  for ( int y = -1; y <= 1; y ++ ) {
    for ( int x = -1; x <= 1; x ++ ) {
      vec2 b = vec2( float( x ), float( y ) );
      vec2 h = wHash22( i + b );
      vec2 o = 0.5 + 0.38 * sin( t + 6.2831853 * h );
      vec2 r = b + o - f;
      float d = dot( r, r );
      if ( d < d1 ) {
        d2 = d1;
        d1 = d;
      } else if ( d < d2 ) {
        d2 = d;
      }
    }
  }
  float edge = sqrt( d2 ) - sqrt( d1 );
  return pow( 1.0 - smoothstep( 0.0, 0.15, edge ), 1.7 );
}
vec3 applyCaustics( vec3 bed, vec3 pBed, float vDepth ) {
  if ( uCaustic.x <= 0.0 || vDepth <= 0.0 ) return bed;
  vec2 cp = pBed.xz + uSunDir.xz / max( uSunDir.y, 0.25 ) * vDepth;
  float t = uTime * uCaustic.z;
  float c = causticLayer( cp * uCaustic.y, t ) * 0.6 + causticLayer( cp * uCaustic.y * 1.7 + 3.7, t * 1.25 + 2.0 ) * 0.5;
  vec2 buv = bakeUv( pBed.xz );
  float sunOcc = texture2D( tBake, buv ).r;
  float bedY = texture2D( tHeight, buv ).r;
  float onBed = 1.0 - smoothstep( 0.03, 0.12, pBed.y - bedY );
  float sunVis = mix( 0.55, 1.0 - sunOcc, onBed );
  float fade = exp( -vDepth / uCaustic.w ) * smoothstep( 0.0, 0.25, vDepth );
  return bed * ( 1.0 + uCaustic.x * c * fade * sunVis );
}
`;

/** 泡。uFoam = (幅, 量, 速さ)。tShore = 岸からの距離 */
const FOAM = /* glsl */ `
float foamLace( vec2 p, float width, float aa ) {
  vec2 i = floor( p );
  vec2 f = fract( p );
  float d1 = 8.0;
  float d2 = 8.0;
  for ( int y = -1; y <= 1; y ++ ) {
    for ( int x = -1; x <= 1; x ++ ) {
      vec2 b = vec2( float( x ), float( y ) );
      vec2 r = b + 0.15 + 0.7 * wHash22( i + b ) - f;
      float d = dot( r, r );
      if ( d < d1 ) {
        d2 = d1;
        d1 = d;
      } else if ( d < d2 ) {
        d2 = d;
      }
    }
  }
  float edge = sqrt( d2 ) - sqrt( d1 );
  aa = max( aa, 0.01 );
  float cover = clamp( width / aa, 0.0, 1.0 );
  return ( 1.0 - smoothstep( width - aa * 0.5, width + aa * 0.5, edge ) ) * mix( cover, 1.0, cover );
}
// 岸の泡：岸に接した所は白く、その外側は網目のレース。流れに沿って下流へ伸びる
float shoreFoam( vec2 xz, float px, vec2 flowV ) {
  if ( uFoam.y <= 0.0 ) return 0.0;
  vec2 shoreUv = vec2( xz.x / uShoreSize + 0.5, 0.5 - xz.y / uShoreSize );
  float dist = texture2D( tShore, shoreUv ).r * uShoreMax;
  float w = uFoam.x;
  if ( dist > w * 3.2 ) return 0.0;
  float ft = uTime * uFoam.z;
  vec2 q = xz - flowV * ft * 0.5;
  float n1 = wNoise( q * 1.3 ) * 0.5 + 0.5;
  float n2 = wNoise( q * 3.7 ) * 0.5 + 0.5;
  float wl = w * ( 0.45 + 0.9 * n1 );
  float dj = dist + 0.18 * ( n2 - 0.5 ) * w;
  float core = 1.0 - smoothstep( 0.03 * wl, 0.22 * wl, dj );
  float L = 1.0 - smoothstep( 0.05 * wl, wl, dj );
  float s1 = uFoamScale;
  float s2 = uFoamScale * 0.42;
  float lace1 = foamLace( q * s1, mix( 0.02, 0.42, L * L ), px * s1 );
  float lace2 = foamLace( q * s2 + 4.1, mix( 0.015, 0.2, L ), px * s2 );
  // 水際の白い線はところどころ切れ、外側のレースは淡く（細かな泡）
  float breakUp = smoothstep( 0.25, 0.6, wNoise( q * 2.2 + 3.7 ) * 0.5 + 0.5 );
  float lace = max( lace1, 0.85 * lace2 ) * smoothstep( 0.0, 0.25, L ) * 0.45;
  return clamp( max( core * mix( 0.45, 1.0, breakUp ), lace ) * uFoam.y, 0.0, 1.0 );
}
// 滝つぼの泡（滝の下の円い範囲、下流へ伸びる）
float fallFoam( vec2 xz, float px, vec2 flowV ) {
  float f = 0.0;
  for ( int i = 0; i < 6; i ++ ) {
    vec4 fp = uFalls[ i ];
    if ( fp.w <= 0.0 ) continue;
    vec2 d = xz - fp.xy;
    // 流れの向きに伸ばした距離
    vec2 dir = normalize( vec2( uFallDirs[ i ].x, uFallDirs[ i ].y ) );
    float along = dot( d, dir );
    float side = dot( d, vec2( -dir.y, dir.x ) );
    float r = length( vec2( side, max( along, 0.0 ) * 0.45 + min( along, 0.0 ) * 1.6 ) ) / fp.w;
    float k = 1.0 - smoothstep( 0.35, 1.0, r + 0.25 * wNoise( xz * 6.0 - flowV * uTime * 0.6 ) );
    float lace = foamLace( ( xz - flowV * uTime * 0.6 ) * uFoamScale * 0.8, mix( 0.05, 0.5, k ), px * uFoamScale * 0.8 );
    f = max( f, max( k * k, lace * k * 1.4 ) );
  }
  return clamp( f, 0.0, 1.0 );
}
// 水を飲む恐竜の口元から広がる波紋（法線の傾きと、明るい輪）
vec3 drinkRings( vec2 xz ) {
  if ( uRing.w <= 0.0 ) return vec3( 0.0 );
  vec2 d = xz - uRing.xy;
  float r = length( d );
  if ( r > uRing.z * 1.3 ) return vec3( 0.0 );
  float k = 6.2831853 / ( uRing.z * 0.17 );
  float ph = r * k - uTime * 2.2;
  float env = smoothstep( 0.0, uRing.z * 0.08, r ) * ( 1.0 - smoothstep( uRing.z * 0.4, uRing.z * 1.3, r ) );
  float slope = cos( ph ) * env * uRing.w;
  vec2 g = ( r > 1e-4 ? d / r : vec2( 0.0 ) ) * slope * 0.22;
  float bright = smoothstep( 0.6, 1.0, sin( ph ) ) * env * uRing.w;
  return vec3( g, bright );
}
`;

const WATER_COLOR = /* glsl */ `
vec3 depthColor( float d ) {
  vec3 c = mix( uShallow, uMid, smoothstep( 0.0, uColorDepths.x, d ) );
  return mix( c, uDeep, smoothstep( uColorDepths.x, uColorDepths.y, d ) );
}
`;

export const WATER_VERTEX = /* glsl */ `
#ifdef WATER_WALL
attribute float aLevel;
attribute float aBed;
varying float vLevel;
varying float vBed;
#endif
varying vec3 vWorld;
varying vec3 vNormalW;
void main() {
  vec3 p = ( modelMatrix * vec4( position, 1.0 ) ).xyz;
#ifdef WATER_WALL
  vLevel = aLevel;
  vBed = aBed;
  vNormalW = normalize( mat3( modelMatrix ) * normal );
#else
  vNormalW = vec3( 0.0, 1.0, 0.0 );
#endif
  vWorld = p;
  gl_Position = projectionMatrix * viewMatrix * vec4( p, 1.0 );
}
`;

export const WATER_FRAGMENT = /* glsl */ `
uniform sampler2D tScene;
uniform sampler2D tDepth;
uniform sampler2D tShore;
uniform sampler2D tBake;
uniform sampler2D tHeight;
uniform sampler2D tFlow;
uniform vec2 uResolution;
uniform mat4 uProjInv;
uniform mat4 uCamWorld;
uniform mat4 uViewProj;
uniform float uTime;
uniform vec3 uShallow;
uniform vec3 uMid;
uniform vec3 uDeep;
uniform vec2 uColorDepths;
uniform vec3 uAbsorb;
uniform float uScatter;
uniform vec3 uSunDir;
uniform vec3 uSunColor;
uniform vec3 uHorizon;
uniform vec3 uZenith;
uniform float uReflect;
uniform float uGlint;
uniform float uRefraction;
uniform float uWallClarity;
uniform float uWallClear;
uniform float uWallHaze;
uniform vec3 uWallTint;
uniform float uWallReflect;
uniform vec2 uRipple;
uniform sampler2D tWaves;
uniform vec4 uWaveTex;
uniform float uFlowSpeed;
uniform float uFoamScale;
uniform float uShoreSize;
uniform float uShoreMax;
uniform vec3 uFoam;
uniform vec4 uCaustic;
uniform float uBakeSize;
uniform float uSheen;
uniform vec2 uRim;
uniform vec4 uWallGrad;
uniform float uWallGradPath;
uniform vec3 uWallTopColor;
uniform vec3 uWallGradMisc;
uniform vec4 uFalls[ 6 ];
uniform vec2 uFallDirs[ 6 ];
uniform vec4 uRing;
#ifdef WATER_WALL
varying float vLevel;
varying float vBed;
#endif
varying vec3 vWorld;
varying vec3 vNormalW;

${NOISE}
${RIPPLES}
vec3 worldFromDepth( vec2 uv, float d ) {
  vec4 v = uProjInv * vec4( uv * 2.0 - 1.0, d * 2.0 - 1.0, 1.0 );
  v /= v.w;
  return ( uCamWorld * v ).xyz;
}
vec2 screenUv( vec3 p ) {
  vec4 c = uViewProj * vec4( p, 1.0 );
  return c.xy / c.w * 0.5 + 0.5;
}
vec2 bakeUv( vec2 xz ) {
  return vec2( xz.x / uBakeSize + 0.5, 0.5 - xz.y / uBakeSize );
}
${WATER_COLOR}
${CAUSTICS}
${FOAM}
void main() {
  vec2 suv = gl_FragCoord.xy / uResolution;
  vec3 V = normalize( cameraPosition - vWorld );
#ifdef WATER_WALL
  float level = vLevel;
#else
  float level = vWorld.y;
#endif
  vec3 flow = texture2D( tFlow, bakeUv( vWorld.xz ) ).rgb;
  vec2 flowV = ( flow.xy * 2.0 - 1.0 ) * flow.z * uFlowSpeed;

  // --- 法線：流れに乗せたさざ波（断面はほぼ平ら）
  vec3 n = normalize( vNormalW );
  vec2 fw = fwidth( vWorld.xz );
  float px = max( max( fw.x, fw.y ), 1e-4 );
  vec3 ring = vec3( 0.0 );
#ifdef WATER_WALL
  vec2 wg = rippleGrad( vec2( vWorld.x + vWorld.z, vWorld.y * 2.0 ), uTime ) * 0.25;
  n = normalize( n + vec3( wg.x * n.z, wg.y, -wg.x * n.x ) );
#else
  vec2 rg = flowRipples( vWorld.xz, uTime, flow );
  ring = drinkRings( vWorld.xz );
  rg += ring.xy;
  n = normalize( n + vec3( -rg.x, 0.0, -rg.y ) );
#endif

  // --- 屈折：川底の見える位置を、水面の傾きと水深に応じて少しずらす
  float dScene = texture2D( tDepth, suv ).r;
  vec3 pBehind = worldFromDepth( suv, dScene );
  float depthBelow = max( level - pBehind.y, 0.0 );
#ifdef WATER_WALL
  vec3 shiftW = ( n - normalize( vNormalW ) ) * min( depthBelow, 1.2 ) * 0.3 * uRefraction;
#else
  vec3 shiftW = vec3( n.x, 0.0, n.z ) * min( depthBelow, 1.2 ) * 0.22 * uRefraction;
#endif
  vec2 ruv = screenUv( pBehind + shiftW );
  float dR = texture2D( tDepth, ruv ).r;
  vec3 pTest = worldFromDepth( ruv, dR );
  if ( dot( pTest - vWorld, -V ) < 0.002 || ruv.x < 0.0 || ruv.y < 0.0 || ruv.x > 1.0 || ruv.y > 1.0 ) {
    ruv = suv;
    dR = dScene;
  }
  vec3 bed = texture2D( tScene, ruv ).rgb;
  vec3 pBed = worldFromDepth( ruv, dR );
  float path = max( distance( pBed, vWorld ), 0.0 );
  float vDepth = max( level - pBed.y, 0.0 );

  // --- 水中の光の網目（断面から斜めに遠くの川底を見るときは、網目が細かく詰まって見えるので弱める）
#ifdef WATER_WALL
  bed = mix( bed, applyCaustics( bed, pBed, vDepth ), exp( -path * 1.6 ) );
#else
  bed = applyCaustics( bed, pBed, vDepth );
#endif

  // --- 水による吸収と散乱
#ifdef WATER_WALL
  float pathW = uWallClarity * path * path / ( path + uWallClear );
  vec3 waterCol = depthColor( 0.22 * path * uWallClarity );
#else
  float pathW = path;
  vec3 waterCol = depthColor( vDepth );
#endif
  vec3 tView = exp( -( uAbsorb + uScatter ) * pathW );
  vec3 tSun = exp( -uAbsorb * vDepth / max( uSunDir.y, 0.25 ) );
  float scatter = 1.0 - exp( -uScatter * pathW );
  // 水面の位置での日陰（木や岸の影）
  // 木の影の中でも水は暗くなりすぎない（水の中で光が散らばる）
  float shade = 1.0 - 0.32 * texture2D( tBake, bakeUv( vWorld.xz ) ).r;
#ifdef WATER_WALL
  vec3 col = bed * tView * mix( vec3( 1.0 ), tSun, 0.15 ) + waterCol * scatter * shade;
  col = mix( col, waterCol * shade, uWallHaze ) * uWallTint;
#else
  vec3 col = bed * tView * mix( vec3( 1.0 ), tSun, 0.45 ) + waterCol * scatter * shade;
#endif

#ifndef WATER_WALL
  // --- 水面の小さな波の明暗と、きらめき
  float sheen = dot( n, uSunDir ) - uSunDir.y;
  col *= 1.0 + uSheen * sheen * ( 0.3 + 0.7 * scatter );
  float sp = smoothstep( 0.55, 0.85, wNoise( vWorld.xz * 7.0 - flowV * uTime ) )
    * smoothstep( 0.45, 0.85, wNoise( vWorld.xz * 19.0 - flowV * uTime * 1.3 ) );
  col += uSunColor * sp * uGlint * 0.55 * scatter * shade;
#endif

#ifdef WATER_WALL
  // --- 断面の縦のグラデーション：水面の近くほど厚い水を通して見るように色を付ける（下へ行くほど川底の明るい色に戻る）
  {
    float hW = clamp( ( level - vWorld.y ) / max( level - vBed, 1e-3 ), 0.0, 1.0 );
    float sAlong = vWorld.x + vWorld.z * 1.37;
    float gn = wNoise( vec2( sAlong * uWallGrad.z * 0.3 - 3.7, vWorld.y * uWallGrad.z * 0.45 + 1.9 ) ) * 0.5
      + wNoise( vec2( sAlong * uWallGrad.z, vWorld.y * uWallGrad.z * 0.55 ) ) * 0.35
      + wNoise( vec2( sAlong * uWallGrad.z * 2.6 + 5.1, vWorld.y * uWallGrad.z * 1.7 - 2.3 ) ) * 0.2;
    float gw = 1.0 - smoothstep( uWallGrad.x, uWallGrad.y, hW + uWallGrad.w * gn );
    gw *= gw;
    float nearK = mix( uWallGradMisc.y, 1.0, smoothstep( 0.0, uWallGradMisc.z, path ) );
    gw *= mix( 1.0, nearK, smoothstep( 0.04, 0.16, hW ) );
    float gp = gw * uWallGradMisc.x * uWallGradPath;
    vec3 topCol = uWallTopColor * ( 1.0 + 0.18 * gn );
    col = col * exp( -( uAbsorb + uScatter ) * gp ) + topCol * mix( 1.0, shade, 0.5 ) * ( 1.0 - exp( -uScatter * gp ) );
  }
#endif
  // --- 反射（フレネル）＋日差しのきらめき
  float cosV = clamp( dot( n, V ), 0.0, 1.0 );
  float fres = 0.02 + 0.98 * pow( 1.0 - cosV, 5.0 );
  vec3 R = reflect( -V, n );
  vec3 env = mix( uHorizon, uZenith, smoothstep( 0.0, 0.8, R.y ) );
#ifdef WATER_WALL
  col = mix( col, env, clamp( fres * uReflect * uWallReflect, 0.0, 1.0 ) );
#else
  col = mix( col, env, clamp( fres * uReflect * 0.35, 0.0, 1.0 ) );
#endif
  vec3 H = normalize( uSunDir + V );
  float nh = max( dot( n, H ), 0.0 );
  float glint = pow( nh, 900.0 ) * 6.0 + pow( nh, 90.0 ) * 0.12;
  col += uSunColor * glint * uGlint * shade;

#ifdef WATER_WALL
  // --- 断面の上の縁（水面の線）：白く光る細い線
  {
    float rimW = max( uRim.x, 1e-4 );
    float rimT = 1.0 - smoothstep( 0.0, rimW, level - vWorld.y );
    col = mix( col, mix( env, vec3( 1.0 ), 0.55 ), rimT * uRim.y );
  }
#else
  // --- 岸と岩のまわりの白い泡、滝つぼの泡、口元の波紋の明るい輪
  {
    float foam = max( shoreFoam( vWorld.xz, px, flowV ), fallFoam( vWorld.xz, px, flowV ) );
    vec3 foamCol = vec3( 1.0, 0.995, 0.97 ) * ( 0.72 + 0.28 * shade );
    col = mix( col, foamCol, foam );
    col += vec3( 0.55, 0.62, 0.6 ) * ring.z * shade;
  }
#endif

  gl_FragColor = vec4( col, 1.0 );
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

export const COPY_VERTEX = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4( position.xy, 0.0, 1.0 );
}
`;

export const COPY_FRAGMENT = /* glsl */ `
uniform sampler2D tScene;
uniform sampler2D tDepth;
varying vec2 vUv;
void main() {
  gl_FragColor = vec4( texture2D( tScene, vUv ).rgb, 1.0 );
  gl_FragDepth = texture2D( tDepth, vUv ).r;
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

/** 滝の水の幕：流れ落ちる白い筋と、透けるターコイズ。下ほど泡立って白い */
export const FALL_VERTEX = /* glsl */ `
attribute vec2 aFall;
varying vec2 vFall;
varying vec3 vWorld;
varying vec3 vNormalW;
void main() {
  vFall = aFall;
  vec3 p = ( modelMatrix * vec4( position, 1.0 ) ).xyz;
  vWorld = p;
  vNormalW = normalize( mat3( modelMatrix ) * normal );
  gl_Position = projectionMatrix * viewMatrix * vec4( p, 1.0 );
}
`;

export const FALL_FRAGMENT = /* glsl */ `
uniform float uTime;
uniform vec3 uSunDir;
uniform vec3 uSunColor;
uniform vec3 uWaterColor;
uniform vec3 uAmbient;
uniform sampler2D tBake;
uniform float uBakeSize;
varying vec2 vFall;
varying vec3 vWorld;
varying vec3 vNormalW;
${NOISE}
void main() {
  // vFall.x：幕の横（0〜1）、vFall.y：落ちる向き（0 = 上の縁、1 = 下の水面）
  float u = vFall.x;
  float v = vFall.y;
  float t = uTime;
  // 落ちる白い筋（縦に長いノイズを下へ流す）
  float s1 = wNoise( vec2( u * 26.0, v * 2.2 - t * 2.6 ) ) * 0.5 + 0.5;
  float s2 = wNoise( vec2( u * 61.0 + 3.0, v * 4.5 - t * 3.4 ) ) * 0.5 + 0.5;
  float streak = smoothstep( 0.35, 0.8, s1 * 0.65 + s2 * 0.45 );
  // 下ほど泡立って白い。上の縁は滑らかで透ける
  float aer = smoothstep( 0.15, 0.95, v );
  float white = clamp( 0.35 + 0.65 * streak + 0.5 * aer, 0.0, 1.0 );
  vec3 base = mix( uWaterColor, vec3( 0.98, 0.99, 1.0 ), white );
  vec2 buv = vec2( vWorld.x / uBakeSize + 0.5, 0.5 - vWorld.z / uBakeSize );
  float shade = 1.0 - 0.45 * texture2D( tBake, buv ).r;
  vec3 n = normalize( vNormalW );
  float lit = 0.55 + 0.45 * max( dot( n, uSunDir ), 0.0 );
  vec3 col = base * ( uAmbient + uSunColor * lit * shade * 0.9 );
  // 上の縁の光る線
  col += uSunColor * 0.35 * ( 1.0 - smoothstep( 0.0, 0.08, v ) ) * shade;
  // 幕の端は不ぞろいにほつれ、下へ行くほど何本かの筋に分かれる（岩のあいだを落ちる水）
  float seed = vWorld.x * 7.3 + vWorld.z * 3.1;
  float fray = wNoise( vec2( v * 3.0 + seed, seed * 1.7 ) ) * 0.5 + 0.5;
  float edge = smoothstep( 0.0, 0.12 + 0.2 * fray, u ) * smoothstep( 1.0, 0.88 - 0.2 * ( 1.0 - fray ), u );
  float strands = smoothstep( 0.18, 0.55, wNoise( vec2( u * 5.5 + seed, v * 0.6 - t * 0.4 ) ) * 0.5 + 0.5 + 0.35 * ( 1.0 - v ) );
  float alpha = clamp( ( 0.5 + 0.5 * white ) * edge * mix( 1.0, strands, smoothstep( 0.15, 0.8, v ) ) * smoothstep( 0.0, 0.04, v ), 0.0, 1.0 );
  gl_FragColor = vec4( col, alpha );
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;
