/**
 * 海のシェーダー。役割ごとに分けたチャンクを組み合わせる。
 *  - SWELL：大きなうねり（頂点を動かす。側面の上端も同じ式で動かし、水面と隙間なくつなぐ）
 *  - RIPPLES：細かなさざ波と風浪（法線を傾ける）
 *  - WATER_COLOR：水深と、光が水中を通る距離による色・透明度（吸収と散乱）。深場は見かけの水深を足す
 *  - CAUSTICS：海底や水中の岩に映る、揺れる網目状の光
 *  - FOAM：岸（砂浜・崖のふもと・水面から出た岩）の白い泡（網目のレース）と、沖の側の台座の縁で砕ける波
 *  - WATER_VERTEX / WATER_FRAGMENT：水面（surface）と側面の断面（WATER_WALL）で共通の本体
 *  - COPY_*：不透明な物を描いた画像を、奥行きと一緒に画面へ写す
 *  - WAKE：船の航跡（FERRY_WAKE のときだけ。ニューヨークの箱庭で使う）
 */

/** 乱数と勾配ノイズ */
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

/** うねり（頂点）。uSwell = (高さ, 波長, 速さ) */
const SWELL = /* glsl */ `
// 大きなうねり（3 方向の波の重ね合わせ）。側面の上端も同じ式で動かし、水面と隙間なくつなぐ
float swellHeight( vec2 p, float t, out vec2 grad ) {
  float h = 0.0;
  grad = vec2( 0.0 );
  vec2 d[ 3 ];
  d[ 0 ] = vec2( 0.83, 0.56 );
  d[ 1 ] = vec2( -0.36, 0.93 );
  d[ 2 ] = vec2( 0.97, -0.24 );
  float lens[ 3 ];
  lens[ 0 ] = 1.0;
  lens[ 1 ] = 0.63;
  lens[ 2 ] = 0.41;
  float amps[ 3 ];
  amps[ 0 ] = 0.55;
  amps[ 1 ] = 0.3;
  amps[ 2 ] = 0.15;
  for ( int i = 0; i < 3; i ++ ) {
    float k = 6.2831853 / ( uSwell.y * lens[ i ] );
    // 波長の短い波ほどゆっくり進む（深い水の波の速さは波長の平方根に比例）
    float w = k * uSwell.z * 0.35 * sqrt( uSwell.y * lens[ i ] );
    float ph = dot( p, d[ i ] ) * k - t * w + float( i ) * 1.7;
    float a = uSwell.x * amps[ i ];
    h += a * sin( ph );
    grad += a * k * cos( ph ) * d[ i ];
  }
  return h;
}
`;

/** さざ波（法線の傾き）。uRipple = (強さ, 細かさ) */
const RIPPLES = /* glsl */ `
// さざ波の高さの勾配（3 層のノイズを別々の向きに流す）
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
// 細かな風浪：繰り返し模様の波の傾きのテクスチャ（tWaves、R/G = x/z 方向の傾き）を、大きさと向きと流れる向きを
// 変えて 2 枚重ねる。テクスチャのミップマップで遠くの細かな波は自然に平らになる（ちらつかない）。
// uWaveTex = (強さ, 1 / 模様の繰り返しの大きさ, 流れる速さ)
vec2 waveletGrad( vec2 p, float t ) {
  if ( uWaveTex.x <= 0.0 ) return vec2( 0.0 );
  vec2 g1 = texture2D( tWaves, p * uWaveTex.y + vec2( 0.011, -0.023 ) * t * uWaveTex.z ).rg * 2.0 - 1.0;
  // 2 枚目は 37 度回して細かく（同じ傾きの大きさのまま縮める）
  mat2 rot = mat2( 0.8, 0.6, -0.6, 0.8 );
  vec2 q = rot * p;
  vec2 g2 = texture2D( tWaves, q * uWaveTex.y * 1.73 + vec2( -0.017, -0.012 ) * t * uWaveTex.z + 0.37 ).rg * 2.0 - 1.0;
  // 回した座標での傾きを元の向きに戻す（rot の転置）
  g2 = vec2( rot[ 0 ][ 0 ] * g2.x + rot[ 0 ][ 1 ] * g2.y, rot[ 1 ][ 0 ] * g2.x + rot[ 1 ][ 1 ] * g2.y );
  return ( g1 + 0.55 * g2 ) * uWaveTex.x;
}
`;

/** 水中の光の網目（コースティクス）。uCaustic = (強さ, 細かさ, 速さ, 弱まる水深) */
const CAUSTICS = /* glsl */ `
// 網目状の光（動くボロノイの境目）
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
// 海底や岩の表面（pBed、水深 vDepth）に網目の光を足す。光の来る向きにずらして、表面に沿わせる。
// 深いほど弱く、焼き込んだ影の中（海底）では弱くして、影を白く塗りつぶさない
vec3 applyCaustics( vec3 bed, vec3 pBed, float vDepth, float extra ) {
  if ( uCaustic.x <= 0.0 || vDepth <= 0.0 ) return bed;
  vec2 cp = pBed.xz + uSunDir.xz / max( uSunDir.y, 0.25 ) * vDepth;
  float t = uTime * uCaustic.z;
  float c = causticLayer( cp * uCaustic.y, t ) * 0.6 + causticLayer( cp * uCaustic.y * 1.7 + 3.7, t * 1.25 + 2.0 ) * 0.5;
  vec2 buv = bakeUv( pBed.xz );
  float sunOcc = texture2D( tBake, buv ).r;
  float seabedY = texture2D( tHeight, buv ).r;
  // 海底では焼き込んだ影（主光）を使う。岩や崖の面では控えめに
  float onBed = 1.0 - smoothstep( 0.03, 0.12, pBed.y - seabedY );
  float sunVis = mix( 0.55, 1.0 - sunOcc, onBed );
  float fade = exp( -( vDepth + extra ) / uCaustic.w ) * smoothstep( 0.0, 0.25, vDepth );
  return bed * ( 1.0 + uCaustic.x * c * fade * sunVis );
}
`;

/** 岸の白い泡。uFoam = (幅, 量, 速さ)。tShore = 岸からの距離 */
const FOAM = /* glsl */ `
// 泡の網目（泡粒の縁がつながったレース）。width は線の太さ（セルの大きさに対する割合、0.5 でほぼ埋まる）、
// aa は 1 画素の大きさ（セル単位）。画素の大きさでぼかして、細い線がちらつかないようにする
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
  // 線が画素より細いときは、薄くして面積の割合を保つ
  float cover = clamp( width / aa, 0.0, 1.0 );
  return ( 1.0 - smoothstep( width - aa * 0.5, width + aa * 0.5, edge ) ) * mix( cover, 1.0, cover );
}
// 岸の泡：岸に接した所はほぼ白く、その外側は網目のレース（岸から離れるほど線が細く、まばらに）。
// 砂浜では寄せては返す波の線も。px は 1 画素の大きさ（ワールド）
float shoreFoam( vec2 xz, float px, float shallow ) {
  if ( uFoam.y <= 0.0 ) return 0.0;
  vec2 shoreUv = vec2( xz.x / uShoreSize + 0.5, 0.5 - xz.y / uShoreSize );
  float dist = texture2D( tShore, shoreUv ).r * uShoreMax;
  float w = uFoam.x;
  if ( dist > w * 3.2 ) return 0.0;
  float ft = uTime * uFoam.z;
  float n1 = wNoise( xz * 1.3 + vec2( 0.0, ft * 0.04 ) ) * 0.5 + 0.5;
  float n2 = wNoise( xz * 3.7 - vec2( ft * 0.05, 0.0 ) ) * 0.5 + 0.5;
  // 場所によって幅を変え、境目を不規則にする
  float wl = w * ( 0.5 + 0.9 * n1 );
  float dj = dist + 0.18 * ( n2 - 0.5 ) * w;
  float core = 1.0 - smoothstep( 0.03 * wl, 0.2 * wl, dj );
  float L = 1.0 - smoothstep( 0.05 * wl, wl, dj );
  float s1 = uFoamScale;
  float s2 = uFoamScale * 0.42;
  float lace1 = foamLace( xz * s1 + vec2( ft * 0.35, -ft * 0.1 ), mix( 0.02, 0.42, L * L ), px * s1 );
  float lace2 = foamLace( xz * s2 - vec2( 0.0, ft * 0.2 ) + 4.1, mix( 0.015, 0.2, L ), px * s2 );
  float lace = max( lace1, 0.85 * lace2 ) * smoothstep( 0.0, 0.25, L );
  // 寄せては返す波の線（2 本）。線は細く、泡の網目で途切れさせる
  float cycle = fract( ft * 0.13 + n1 * 0.9 );
  float reach = cycle * w * 2.0;
  float lw = w * 0.07 + px;
  float wash = ( 1.0 - smoothstep( lw * 0.4, lw * 1.4, abs( dj - reach ) ) ) * ( 1.0 - cycle ) * smoothstep( 0.0, 0.15, cycle );
  float cycle2 = fract( ft * 0.11 + n2 * 0.7 + 0.5 );
  float reach2 = w * ( 1.0 + cycle2 * 1.7 );
  float wash2 = ( 1.0 - smoothstep( lw * 0.3, lw * 1.1, abs( dj - reach2 ) ) ) * ( 1.0 - cycle2 ) * 0.8;
  float washLace = foamLace( xz * s1 * 1.4 + 2.0, 0.3, px * s1 * 1.4 );
  // 寄せては返す波の線は、遠浅の砂浜（岸の近くが浅い所）だけ。深い所に立つ崖や岩のまわりには付けない
  float foam = max( max( core, lace ), max( wash, wash2 ) * mix( 0.35, 1.0, washLace ) * shallow );
  return clamp( foam * uFoam.y, 0.0, 1.0 );
}
`;

/**
 * 船の航跡（FERRY_WAKE のときだけ）。船の向きの座標で、船尾のすぐ後ろの乱れた白い泡、そこから伸びる泡の筋、
 * ハの字に広がる波の腕、船首から斜め後ろへ広がる白波、船体に沿った泡。uFerry = (中心 x, z, 船首の向き x, z)、
 * uFerrySize = (長さ, 幅)、uWake = (強さ, 航跡の長さ, 腕の広がり)
 */
const WAKE = /* glsl */ `
#ifdef FERRY_WAKE
float wkHash( vec2 p ) {
  p = fract( p * vec2( 234.34, 435.345 ) );
  p += dot( p, p + 34.23 );
  return fract( p.x * p.y );
}
float wkNoise( vec2 p ) {
  vec2 i = floor( p );
  vec2 f = fract( p );
  vec2 u = f * f * ( 3.0 - 2.0 * f );
  return mix( mix( wkHash( i ), wkHash( i + vec2( 1.0, 0.0 ) ), u.x ), mix( wkHash( i + vec2( 0.0, 1.0 ) ), wkHash( i + vec2( 1.0, 1.0 ) ), u.x ), u.y );
}
float wkFbm( vec2 p ) {
  float s = 0.0;
  float a = 0.5;
  for ( int i = 0; i < 4; i ++ ) {
    s += a * wkNoise( p );
    p = mat2( 1.6, 1.2, -1.2, 1.6 ) * p;
    a *= 0.5;
  }
  return s;
}
float ferryWake( vec2 p, float t ) {
  if ( uWake.x <= 0.0 ) return 0.0;
  vec2 fd = normalize( uFerry.zw );
  vec2 fl = vec2( fd.y, -fd.x );
  vec2 rel = p - uFerry.xy;
  float s = dot( rel, fd );
  float w = dot( rel, fl );
  float L = uFerrySize.x;
  float B = uFerrySize.y;
  float len = uWake.y;
  float behind = -( s + L * 0.5 );
  float foam = 0.0;
  if ( behind < -L * 1.1 || behind > len + 0.2 || abs( w ) > B * 0.5 + len * uWake.z + 0.3 ) return 0.0;
  float d = max( behind, 0.0 );
  // 船尾のすぐ後ろの大きく乱れた白い泡と、そこから伸びる泡の筋
  float tw = B * ( 0.6 + 0.32 * d );
  float core = exp( -pow( w / tw, 2.0 ) * 2.0 ) * smoothstep( -0.04, 0.06, behind );
  float n1 = wkFbm( vec2( s * 3.0 - t * 1.1, w * 8.0 ) );
  float n2 = wkNoise( vec2( s * 7.0 - t * 1.9, w * 20.0 ) );
  float near = 1.0 - smoothstep( 0.0, 1.0, d );
  float turb = core * ( 1.0 - smoothstep( 0.4, len, d ) );
  foam = max( foam, turb * smoothstep( 0.38 - 0.3 * near, 0.55 - 0.2 * near, n1 * 0.7 + n2 * 0.3 ) );
  float wash = exp( -pow( w / ( B * 0.75 ), 2.0 ) * 2.0 ) * ( 1.0 - smoothstep( 0.1, 0.95, d ) ) * smoothstep( -0.05, 0.02, behind );
  foam = max( foam, wash * smoothstep( 0.2, 0.42, n1 * 0.6 + n2 * 0.4 + 0.12 ) );
  // ハの字に広がる波（2 本の腕）。途切れ途切れに
  float arm = abs( w ) - ( B * 0.5 + d * uWake.z );
  float armW = 0.03 + 0.05 * d;
  float armN = wkNoise( vec2( s * 6.0 - t * 1.0, w * 6.0 ) ) * 0.6 + wkNoise( vec2( s * 15.0, w * 15.0 - t ) ) * 0.4;
  float arms = ( 1.0 - smoothstep( 0.0, armW, abs( arm ) ) ) * smoothstep( 0.0, 0.15, behind ) * ( 1.0 - smoothstep( 0.6, len, d ) );
  foam = max( foam, arms * smoothstep( 0.36, 0.6, armN ) * 0.9 );
  // 船首から斜め後ろへ広がる白い波
  float fb = L * 0.5 - s;
  float bowArm = abs( w ) - ( 0.03 + fb * 0.62 );
  float bw = 0.02 + 0.03 * clamp( fb, 0.0, 1.5 );
  float bn = wkNoise( vec2( s * 10.0 + t * 1.4, w * 10.0 ) );
  float bowArms = ( 1.0 - smoothstep( 0.0, bw, abs( bowArm ) ) ) * step( 0.0, fb ) * ( 1.0 - smoothstep( 0.8, 2.2, fb ) );
  foam = max( foam, bowArms * smoothstep( 0.25, 0.5, bn ) * 0.95 );
  // 船首の白波と、船体に沿った泡（船首に近いほど多い）
  if ( fb > -0.15 && fb < L ) {
    float hw = B * 0.5 * clamp( fb / 0.5, 0.0, 1.0 );
    float side = abs( w ) - hw;
    float reach = 0.045 + 0.08 * clamp( fb, 0.0, 0.8 );
    float spray = ( 1.0 - smoothstep( 0.0, reach, side ) ) * step( -0.02, side );
    float sprayN = wkNoise( vec2( s * 12.0 + t * 1.6, w * 22.0 ) );
    float bowZone = 1.0 - smoothstep( 0.0, 0.9, fb );
    foam = max( foam, spray * smoothstep( 0.22, 0.55, sprayN ) * ( 0.5 + 0.5 * bowZone ) );
    float bowWave = ( 1.0 - smoothstep( 0.0, 0.07, length( vec2( max( -fb, 0.0 ), w ) ) - 0.02 ) ) * step( fb, 0.05 );
    foam = max( foam, bowWave * 0.85 );
  }
  return clamp( foam * uWake.x, 0.0, 1.0 );
}
#endif
`;

/** 水深に応じた水の色（浅瀬 → 中ほど → 深場） */
const WATER_COLOR = /* glsl */ `
vec3 depthColor( float d ) {
  vec3 c = mix( uShallow, uMid, smoothstep( 0.0, uColorDepths.x, d ) );
  return mix( c, uDeep, smoothstep( uColorDepths.x, uColorDepths.y, d ) );
}
`;

export const WATER_VERTEX = /* glsl */ `
uniform float uTime;
uniform float uWaterY;
uniform vec4 uSwell; // x: 高さ, y: 波長, z: 速さ
#ifdef WATER_WALL
attribute float aTop;
varying float vTop;
#endif
varying vec3 vWorld;
varying vec3 vNormalW;

${SWELL}
void main() {
  vec3 p = ( modelMatrix * vec4( position, 1.0 ) ).xyz;
  vec2 g;
  float h = swellHeight( p.xz, uTime, g );
#ifdef WATER_WALL
  p.y += aTop * h;
  vTop = aTop;
  vNormalW = normalize( mat3( modelMatrix ) * normal );
#else
  p.y += h;
  vNormalW = normalize( vec3( -g.x, 1.0, -g.y ) );
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
uniform sampler2D tSurfaceBake; // 水面の高さに焼き込んだ影（なければ海底の影と同じ）
uniform sampler2D tHeight;
uniform sampler2D tDeep;
uniform vec2 uResolution;
uniform mat4 uProjInv;
uniform mat4 uCamWorld;
uniform mat4 uViewProj;
uniform float uTime;
uniform float uWaterY;
uniform float uWaterBottom;
uniform vec3 uShallow;
uniform vec3 uMid;
uniform vec3 uDeep;
uniform vec2 uColorDepths;
uniform vec3 uAbsorb;
uniform float uScatter;
uniform float uDeepExtra;
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
uniform float uWallReflect; // 側面の映り込みの強さの倍率
uniform vec2 uRipple; // x: 強さ, y: 細かさ（1 / 大きさ）
uniform sampler2D tWaves;
uniform vec4 uWaveTex; // x: 強さ, y: 1 / 模様の繰り返しの大きさ, z: 流れる速さ
uniform float uFoamScale; // 泡の網目の細かさ（1 / 網目の大きさ）
uniform float uShoreSize;
uniform float uShoreMax;
uniform vec3 uFoam; // x: 幅, y: 量, z: 速さ
uniform vec4 uCaustic; // x: 強さ, y: 細かさ, z: 速さ, w: 弱まる水深
uniform float uBakeSize;
uniform float uSheen;
uniform vec2 uOutline; // x: 外周の半分の幅, y: 角の半径
uniform vec2 uRim; // x: 縁の照り返しの幅, y: 強さ
uniform vec4 uWallGrad; // 通常の海の側面の縦のグラデーション x: 薄くなり始める深さ, y: 消える深さ（側面の高さに対する割合）, z: むらの細かさ, w: むらの強さ
uniform vec2 uWallGradDeep; // 深場の側面 x: 薄くなり始める深さ, y: 消える深さ
uniform vec2 uWallGradPath; // 水面のすぐ下で足す水の厚み x: 通常の海, y: 深場
uniform vec3 uWallTopColor; // 通常の海の側面の、水の中で散らばる光の色（水面の近くの青緑）
uniform vec3 uWallTopDeep; // 深場の側面の、水の中で散らばる光の色（濃い青）
uniform vec3 uWallGradMisc; // x: 強さ, y: ガラスのすぐ奥の物（見通す距離 0）での強さの割合, z: 強さが最大になる見通す距離
uniform float uWallBase; // ガラスの奥の島の土台に、少なくとも足す水の厚み（水面の近く。下へ行くほど少なく）
uniform float uWallDeepFloor; // 深場の側面で、下の方まで少なくとも足す水の厚み
uniform vec4 uFerry; // 船の中心 x, z と船首の向き
uniform vec2 uFerrySize; // 船の長さと幅
uniform vec3 uWake; // 航跡の強さ、長さ、腕の広がり
#ifdef WATER_WALL
varying float vTop;
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
// 角丸正方形の外周までの距離（内側が正）
float outlineInside( vec2 p ) {
  vec2 q = abs( p ) - ( uOutline.x - uOutline.y );
  return -( length( max( q, 0.0 ) ) + min( max( q.x, q.y ), 0.0 ) - uOutline.y );
}
${WATER_COLOR}
${CAUSTICS}
${FOAM}
${WAKE}
void main() {
  vec2 suv = gl_FragCoord.xy / uResolution;
  vec3 V = normalize( cameraPosition - vWorld );

  // --- 法線：うねり＋さざ波
  vec3 n = normalize( vNormalW );
#ifdef WATER_WALL
  // 側面はほぼ平らに（わずかなゆらぎだけ）
  vec2 wg = rippleGrad( vec2( vWorld.x + vWorld.z, vWorld.y * 2.0 ), uTime ) * 0.25;
  n = normalize( n + vec3( wg.x * n.z, wg.y, -wg.x * n.x ) );
#else
  // 1 画素の大きさ（ワールド。手前に傾いて見える向きでは大きい）
  vec2 fw = fwidth( vWorld.xz );
  float px = max( fw.x, fw.y );
  // 入り江の中（浅い所）は波が穏やか：風浪を弱める
  float calm = mix( 0.55, 1.0, texture2D( tDeep, bakeUv( vWorld.xz ) ).r );
  vec2 rg = rippleGrad( vWorld.xz, uTime ) + waveletGrad( vWorld.xz, uTime ) * calm;
  n = normalize( n + vec3( -rg.x, 0.0, -rg.y ) );
#endif

  // --- 屈折：水底の見える位置を、水面の傾きと水深に応じて少しずらす
  float dScene = texture2D( tDepth, suv ).r;
  vec3 pBehind = worldFromDepth( suv, dScene );
  float depthBelow = max( uWaterY - pBehind.y, 0.0 );
#ifdef WATER_WALL
  vec3 shiftW = ( n - normalize( vNormalW ) ) * min( depthBelow, 1.2 ) * 0.3 * uRefraction;
#else
  vec3 shiftW = vec3( n.x, 0.0, n.z ) * min( depthBelow, 1.2 ) * 0.22 * uRefraction;
#endif
  vec2 ruv = screenUv( pBehind + shiftW );
  float dR = texture2D( tDepth, ruv ).r;
  // ずらした先が水より手前（水面から出た崖など）なら、ずらさない
  vec3 pTest = worldFromDepth( ruv, dR );
  if ( dot( pTest - vWorld, -V ) < 0.002 || ruv.x < 0.0 || ruv.y < 0.0 || ruv.x > 1.0 || ruv.y > 1.0 ) {
    ruv = suv;
    dR = dScene;
  }
  vec3 bed = texture2D( tScene, ruv ).rgb;
  vec3 pBed = worldFromDepth( ruv, dR );
  float path = max( distance( pBed, vWorld ), 0.0 );
  float vDepth = max( uWaterY - pBed.y, 0.0 );
  // 深場らしさ（見かけの水深を足す）。水面では見ている場所、側面では少し奥の場所で読む
#ifdef WATER_WALL
  // 側面から見る所は深場の境目のぼかしの裾を拾わない（手前の砂地が青くかすまないように）
  // 側面は見かけの水深をごく控えめに（深場の濃い青は下の縦のグラデーションで付け、ガラスの近くの岩や下の方の海底は、
  // ほんのり青みがかった明るい色を残す）
  float deep = texture2D( tDeep, bakeUv( mix( vWorld.xz, pBed.xz, 0.35 ) ) ).r * 0.15;
#else
  float deep = texture2D( tDeep, bakeUv( vWorld.xz ) ).r;
#endif
  // 見かけの水深は深場らしさの 2 乗に比例させる。水の色は見かけの水深が小さいうちに大きく変わるので、
  // 始まりをゆっくりにして、濃い青への移り変わりを深場らしさの変わる範囲いっぱいに広くぼかす
  float extra = uDeepExtra * deep * deep;

  // --- 水中の光の網目（海底や岩の表面に沿う）
  bed = applyCaustics( bed, pBed, vDepth, extra );

  // --- 水による吸収と散乱（光が水中を通る距離と水深で決まる）
#ifdef WATER_WALL
  // 側面（切り口）は、奥の海底や岩がよく見えるよう、水の厚みを控えめに数える。
  // ガラスのすぐ奥（短い距離）はほとんど色が付かず、遠くを見通す所ほど水の色になる
  float pathW = uWallClarity * path * path / ( path + uWallClear ) + extra;
  // 側面の色は、水の中を見通す距離で決める（遠くまで水が続く上の方ほど色が濃い）
  vec3 waterCol = depthColor( 0.22 * path * uWallClarity + extra );
#else
  float pathW = path + extra;
  vec3 waterCol = depthColor( vDepth + extra );
#endif
  // 海底から目に届く光は、吸収と散乱の両方で弱まる
  vec3 tView = exp( -( uAbsorb + uScatter ) * pathW );
  vec3 tSun = exp( -uAbsorb * ( vDepth + extra ) / max( uSunDir.y, 0.25 ) );
  float scatter = 1.0 - exp( -uScatter * pathW );
  // 水面の位置での日陰（崖の影）
  float shade = 1.0 - 0.45 * texture2D( tSurfaceBake, bakeUv( vWorld.xz ) ).r;
#ifdef WATER_WALL
  // 側面から見る海底は近いので、日の光の色の変化を控えめに（砂の暖かい色が見える）
  vec3 col = bed * tView * mix( vec3( 1.0 ), tSun, 0.15 ) + waterCol * scatter * shade;
  // 側面のすぐ奥も、水の色がほんのりかかり（暗い所が青緑に持ち上がる）、全体がわずかに黄緑がかって沈む
  col = mix( col, waterCol * shade, uWallHaze ) * uWallTint;
#else
  vec3 col = bed * tView * mix( vec3( 1.0 ), tSun, 0.45 ) + waterCol * scatter * shade;
#endif

#ifndef WATER_WALL
  // --- 水面の小さな波の明暗（日の向きに傾いた面は明るく、反対は暗い）。底の見えない深い所ほど目立つ
  float sheen = dot( n, uSunDir ) - dot( normalize( vNormalW ), uSunDir );
  col *= 1.0 + uSheen * sheen * ( 0.3 + 0.7 * scatter );
  // 小さなきらめき（波の頂で日の光がちらつく）
  float sp = smoothstep( 0.55, 0.85, wNoise( vWorld.xz * 7.0 + vec2( uTime * 0.21, -uTime * 0.17 ) ) )
    * smoothstep( 0.45, 0.85, wNoise( vWorld.xz * 19.0 - vec2( uTime * 0.37, uTime * 0.29 ) ) );
  col += uSunColor * sp * uGlint * 0.55 * scatter * shade;
#endif

#ifdef WATER_WALL
  // --- 側面の縦のグラデーション：水面の近くほど厚い水を通して見るように、赤から順に光を吸い、水の中で散らばる光の色
  // （通常の海は青緑、深場は濃い青）が加わる。下へ行くほど水が薄くなり、海底の明るい色に戻る。深場ほど濃い色が深くまで残る。
  // 境目は側面に沿って縦長のむらでゆらし、混ざり方を均一にしない。ガラスのすぐ奥の物（手前の岩や砂の断面）には控えめに
  {
    float hW = clamp( ( uWaterY - vWorld.y ) / max( uWaterY - uWaterBottom, 1e-4 ), 0.0, 1.0 );
    float deepS = texture2D( tDeep, bakeUv( vWorld.xz ) ).r;
    float sAlong = vWorld.x + vWorld.z * 1.37;
    // むら：側面に沿った大きなうねり（雲のようなまだら）と、縦長の細かなゆらぎ
    float gn = wNoise( vec2( sAlong * uWallGrad.z * 0.3 - 3.7, vWorld.y * uWallGrad.z * 0.45 + 1.9 ) ) * 0.5
      + wNoise( vec2( sAlong * uWallGrad.z, vWorld.y * uWallGrad.z * 0.55 ) ) * 0.35
      + wNoise( vec2( sAlong * uWallGrad.z * 2.6 + 5.1, vWorld.y * uWallGrad.z * 1.7 - 2.3 ) ) * 0.2;
    float ga = mix( uWallGrad.x, uWallGradDeep.x, deepS );
    float gb = mix( uWallGrad.y, uWallGradDeep.y, deepS );
    float gw = 1.0 - smoothstep( ga, gb, hW + uWallGrad.w * gn );
    // 上の方は厚く、下へ長くなだらかに薄くなる
    gw *= gw;
    float nearK = mix( uWallGradMisc.y, 1.0, smoothstep( 0.0, uWallGradMisc.z, path ) );
    // ガラスの奥の島の土台（不透明度 0 の印）は、近くても遠くと同じように水の色に沈める
    float baseMask = 1.0 - texture2D( tScene, ruv ).a;
    nearK = mix( nearK, 1.0, baseMask );
    // 水面のすぐ下は、奥の物が近くても同じように濃い色の帯にする
    gw *= mix( 1.0, nearK, smoothstep( 0.04, 0.16, hW ) );
    float gp = gw * uWallGradMisc.x * mix( uWallGradPath.x, uWallGradPath.y, smoothstep( 0.0, 0.85, deepS ) );
    // 島の土台は下の方でも少し水の色をまとわせる（岩の地の色がそのまま見えて濁った色にならないように）
    gp = max( gp, baseMask * uWallBase * ( 1.0 - 0.6 * hW ) );
    // 深場の側面は、下の方の海底もうっすら青みがかった明るい色に（濃い青から海底の薄い青へのグラデーション）
    gp = max( gp, uWallDeepFloor * smoothstep( 0.0, 0.85, deepS ) );
    vec3 topCol = mix( uWallTopColor, uWallTopDeep, smoothstep( 0.0, 0.85, deepS ) );
    // 散らばる光の色にも少しむらを付ける（明るい所と暗い所）
    topCol *= 1.0 + 0.18 * gn;
    col = col * exp( -( uAbsorb + uScatter ) * gp ) + topCol * mix( 1.0, shade, 0.5 ) * ( 1.0 - exp( -uScatter * gp ) );
  }
#endif
  // --- 反射：視線が浅いほど強い（フレネル）＋日差しのきらめき
  float cosV = clamp( dot( n, V ), 0.0, 1.0 );
  float fres = 0.02 + 0.98 * pow( 1.0 - cosV, 5.0 );
  vec3 R = reflect( -V, n );
  vec3 env = mix( uHorizon, uZenith, smoothstep( 0.0, 0.8, R.y ) );
#ifdef WATER_WALL
  // 側面のガラスの映り込みは控えめに（水面の近くの濃い青緑が白っぽく浮かないように）
  col = mix( col, env, clamp( fres * uReflect * uWallReflect, 0.0, 1.0 ) );
#else
  // 穏やかな入り江では空の映り込みを控えめにして、水の色を鮮やかに見せる
  col = mix( col, env, clamp( fres * uReflect * mix( 0.22, 1.0, deep ), 0.0, 1.0 ) );
#endif
  vec3 H = normalize( uSunDir + V );
  float nh = max( dot( n, H ), 0.0 );
  float glint = pow( nh, 900.0 ) * 6.0 + pow( nh, 90.0 ) * 0.12;
  col += uSunColor * glint * uGlint * shade;

  // --- 水の塊の上の縁（丸みを帯びた縁が空と日差しを映して光る）
  float rimW = max( uRim.x, 1e-4 );
#ifdef WATER_WALL
  float rimT = 1.0 - smoothstep( 0.0, rimW, uWaterY - vWorld.y );
#else
  float rimT = 1.0 - smoothstep( 0.0, rimW, outlineInside( vWorld.xz ) );
#endif
  col = mix( col, mix( env, vec3( 1.0 ), 0.35 ), rimT * uRim.y );

#ifndef WATER_WALL
  // --- 岸の白い泡と沖の白波（側面の断面には付けない）。沖の側の台座の縁にも波が当たって白く砕ける
  float edgeIn = outlineInside( vWorld.xz );
  float edgeN = wNoise( vWorld.xz * 4.0 + uTime * 0.1 ) * 0.5 + 0.5;
  float eL = 1.0 - smoothstep( 0.0, uFoam.x * ( 0.2 + 0.45 * edgeN ), edgeIn );
  float es = uFoamScale * 0.9;
  float edgeFoam = eL * smoothstep( 0.3, 0.8, deep ) * smoothstep( 0.25, 0.6, edgeN + 0.15 )
    * foamLace( vWorld.xz * es + uTime * 0.05, mix( 0.02, 0.3, eL * eL ), px * es );
  float bedHere = texture2D( tHeight, bakeUv( vWorld.xz ) ).r;
  float shallow = 1.0 - smoothstep( 0.45 * uFoam.x, 1.3 * uFoam.x, uWaterY - bedHere );
  float foam = max( shoreFoam( vWorld.xz, px, shallow ), 0.9 * edgeFoam );
#ifdef FERRY_WAKE
  foam = max( foam, ferryWake( vWorld.xz, uTime ) );
#endif
  vec3 foamCol = vec3( 1.0, 0.995, 0.97 ) * ( 0.72 + 0.28 * shade );
  col = mix( col, foamCol, foam );
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
  // 不透明な物の奥行きも書き戻し、水がその前後関係どおりに隠れるようにする
  gl_FragDepth = texture2D( tDepth, vUv ).r;
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;
