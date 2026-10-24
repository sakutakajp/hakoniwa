import * as THREE from 'three';
import type { BookInstance } from './context';

/**
 * 本（同じ箱の形をインスタンスで描く）。箱の局所座標：x = 厚み、y = 高さ、z = 奥行き（+z が背）。
 * 背は丸み（法線を左右へ傾ける）と、背バンドの盛り上がり、箔押しの線・題名・飾り、色の革や紙の題簽（ラベル）。
 * 上の面は頁の小口（上の棚の陰に入る所は暗く）。影はインスタンスごとに背の前の 1 点で焼き込み、
 * 上の棚との近さ（gap）から、背の上の方ほど暗くする（棚の中の空からの遮蔽）
 */
export function createBooksMesh(books: BookInstance[], material: THREE.Material, slotUv: (i: number) => [number, number]) {
  const geo = new THREE.BoxGeometry(1, 1, 1);
  const mesh = new THREE.InstancedMesh(geo, material, books.length);
  mesh.name = 'books';
  const m = new THREE.Matrix4();
  const X = new THREE.Vector3();
  const pat = new Float32Array(books.length);
  const gap = new Float32Array(books.length);
  const uv = new Float32Array(books.length * 2);
  const probes: { position: THREE.Vector3; normal: THREE.Vector3 }[] = [];
  books.forEach((b, i) => {
    X.crossVectors(b.up, b.normal).normalize();
    m.makeBasis(X.clone().multiplyScalar(b.size.x), b.up.clone().normalize().multiplyScalar(b.size.y), b.normal.clone().normalize().multiplyScalar(b.size.z));
    m.setPosition(b.position);
    mesh.setMatrixAt(i, m);
    mesh.setColorAt(i, b.color);
    pat[i] = b.pattern;
    gap[i] = b.gap ?? 1;
    uv.set(slotUv(i), i * 2);
    // 背のまん中の少し前（背の向きの法線）
    probes.push({ position: b.position.clone().addScaledVector(b.normal, b.size.z / 2 + 0.008), normal: b.normal.clone() });
  });
  geo.setAttribute('aBookPat', new THREE.InstancedBufferAttribute(pat, 1));
  geo.setAttribute('aBookGap', new THREE.InstancedBufferAttribute(gap, 1));
  geo.setAttribute('instanceBakeUv', new THREE.InstancedBufferAttribute(uv, 2));
  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  mesh.computeBoundingSphere();
  return { mesh, probes };
}

/** 背の模様の種類の数（BookInstance.pattern は 0〜BOOK_PATTERNS-1） */
export const BOOK_PATTERNS = 6;

/** 本の背と小口の模様（createLibraryMaterial の頂点・法線・色の処理に足す GLSL） */
export const BOOK_VERTEX_DECL = /* glsl */ `
attribute float aBookPat;
attribute float aBookGap;
varying vec3 vBookLocal;
varying float vBookPat;
varying float vBookGap;
varying float vBookSeed;
varying vec3 vBookSize;
varying vec3 vBookX;
varying vec3 vBookY;
`;
export const BOOK_VERTEX = /* glsl */ `
vBookLocal = position;
vBookPat = aBookPat;
vBookGap = aBookGap;
// 箱の厚み・高さ・奥行き（インスタンスの行列の列の長さ）と、1 冊ごとの乱数
vBookSize = vec3( length( instanceMatrix[ 0 ].xyz ), length( instanceMatrix[ 1 ].xyz ), length( instanceMatrix[ 2 ].xyz ) );
vBookSeed = fract( sin( dot( instanceMatrix[ 3 ].xyz, vec3( 12.9898, 78.233, 37.719 ) ) ) * 43758.5453 );
// 背の横の向きと上の向き（視点の座標）。背の丸みと背バンドの盛り上がりで法線を傾けるのに使う
vBookX = normalize( ( modelViewMatrix * vec4( instanceMatrix[ 0 ].xyz, 0.0 ) ).xyz );
vBookY = normalize( ( modelViewMatrix * vec4( instanceMatrix[ 1 ].xyz, 0.0 ) ).xyz );
`;
export const BOOK_FRAGMENT_DECL = /* glsl */ `
uniform vec3 uBookGold;
uniform vec3 uBookPaper;
varying vec3 vBookLocal;
varying float vBookPat;
varying float vBookGap;
varying float vBookSeed;
varying vec3 vBookSize;
varying vec3 vBookX;
varying vec3 vBookY;
// 背バンド（綴じ糸の上の盛り上がり）の位置。革の本（模様 0・5）だけ
float bookBandAt( float k ) { return 0.2 + k * 0.155; }
// 盛り上がりの断面（中心からの距離 d、半幅 w）：高さと傾き
float bookRidge( float d, float w ) { float t = clamp( 1.0 - abs( d ) / w, 0.0, 1.0 ); return t * t * ( 3.0 - 2.0 * t ); }
// 文字の見せかけ：四角い範囲の中の字の並び（行 rows、1 行の字の数 ncol）。1 画素より細かいときは平均の濃さにする
float bookText( vec2 p, vec2 a, vec2 b, float rows, float ncol, float seed, vec2 aa ) {
  float inside = lbBand( p.x, a.x, b.x, aa.x ) * lbBand( p.y, a.y, b.y, aa.y );
  vec2 q = ( p - a ) / max( b - a, vec2( 1e-4 ) );
  float row = floor( q.y * rows );
  float fy = fract( q.y * rows );
  float cx = q.x * ncol;
  float ci = floor( cx );
  float fx = fract( cx );
  float on = step( 0.28, lbHash( vec2( ci, row ) + vec2( floor( seed * 977.0 ), 3.0 ) ) );
  float glyph = on * lbBand( fx, 0.14, 0.86, 0.1 ) * lbBand( fy, 0.16, 0.84, 0.12 );
  float px = max( aa.x * ncol / max( b.x - a.x, 1e-4 ), aa.y * rows / max( b.y - a.y, 1e-4 ) );
  return inside * mix( 0.4, glyph, smoothstep( 0.7, 0.3, px ) );
}
`;

/** 法線：背の丸み（左右の端ほど横を向く）と、背バンドの盛り上がり（上下に傾ける） */
export const BOOK_NORMAL = /* glsl */ `
{
  vec3 lp = vBookLocal;
  if ( lp.z > 0.499 ) {
    float a = clamp( lp.x * 2.0, -1.0, 1.0 ) * 0.95;
    normal = normalize( normal * cos( a ) + vBookX * sin( a ) );
    float pat = floor( vBookPat + 0.5 );
    if ( pat < 0.5 || pat > 4.5 ) {
      float y = lp.y + 0.5;
      float w = 0.022 * 0.25 / max( vBookSize.y, 0.08 );
      float slope = 0.0;
      for ( int k = 0; k < 5; k++ ) {
        float d = y - bookBandAt( float( k ) );
        float t = clamp( 1.0 - abs( d ) / w, 0.0, 1.0 );
        slope += -sign( d ) * 6.0 * t * ( 1.0 - t ) * step( abs( d ), w );
      }
      normal = normalize( normal + vBookY * slope * 0.35 );
    }
  }
}
`;

export const BOOK_COLOR = /* glsl */ `
{
  vec3 lp = vBookLocal;
  vec3 an = abs( lp );
  vec3 cover = diffuseColor.rgb;
  float sd = vBookSeed;
  float pat = floor( vBookPat + 0.5 );
  float Hh = vBookSize.y;
  float Tk = vBookSize.x;
  float Dp = vBookSize.z;
  vec3 col = cover;
  float gold = 0.0;
  float rough = 0.78;
  // 上の棚からの距離（背の上の方ほど、上の棚に空をさえぎられて暗い）
  float dTop = max( vBookGap, 0.0 ) + ( 0.5 - lp.y ) * Hh;
  float occ = ( 1.0 - 0.5 * exp( -dTop / 0.085 ) ) * ( 0.86 + 0.14 * smoothstep( 0.0, 0.05, ( lp.y + 0.5 ) * Hh ) );
  bool leather = pat < 0.5 || ( pat > 2.5 && pat < 3.5 ) || pat > 4.5;
  if ( lp.z > 0.499 ) {
    float y = lp.y + 0.5;
    float x = lp.x;
    vec2 aa = vec2( max( fwidth( x ), 1e-4 ), max( fwidth( y ), 1e-4 ) );
    vec2 sp = vec2( x, y );
    // 張り地：革は大きなむらと型押しの粒、布は細かな織り目（どちらも近づいたときだけ見える）
    vec2 wpos = vec2( x * Tk, y * Hh );
    float fwW = max( aa.x * Tk, aa.y * Hh );
    float big = lbNoise( vec2( sd * 91.0, y * 4.0 ) );
    if ( leather ) {
      float g = mix( 0.5, lbNoise( wpos * 520.0 + sd * 40.0 ), lbKeep( fwW * 520.0 ) );
      col = cover * ( 0.88 + 0.22 * big ) * ( 0.94 + 0.12 * g );
      rough = 0.5 + 0.12 * ( g - 0.5 );
    } else {
      float wv = mix( 0.5, 0.5 + 0.5 * sin( wpos.x * 2400.0 ) * sin( wpos.y * 2400.0 ), lbKeep( fwW * 380.0 ) );
      col = cover * ( 0.9 + 0.16 * big ) * ( 0.95 + 0.1 * wv );
      rough = 0.86;
    }
    // 日焼け（上の方が少し色あせる本がある）と、背の端・天地のすれ（明るく、色が抜ける）
    float fade = step( 0.6, lbHash1( sd * 31.0 ) ) * smoothstep( 0.3, 1.0, y ) * 0.18;
    col = mix( col, vec3( dot( col, vec3( 0.3, 0.5, 0.2 ) ) ) * 1.15, fade );
    float wear = smoothstep( 0.4, 0.5, an.x ) + smoothstep( 0.035, 0.0, min( y, 1.0 - y ) );
    col = mix( col, col * 1.3 + 0.025, clamp( wear, 0.0, 1.0 ) * ( leather ? 0.35 : 0.2 ) );
    float label = 0.0;
    // 題簽の色：えんじ・朱・緑・黒（背の色と近いときは黒）
    float lh = lbHash1( sd * 17.0 );
    vec3 labelCol = lh < 0.3 ? vec3( 0.36, 0.07, 0.05 ) : ( lh < 0.55 ? vec3( 0.62, 0.22, 0.07 ) : ( lh < 0.7 ? vec3( 0.1, 0.22, 0.12 ) : vec3( 0.05, 0.045, 0.04 ) ) );
    if ( cover.r > cover.g * 1.6 && lh < 0.55 ) labelCol = vec3( 0.05, 0.045, 0.04 );
    if ( pat < 0.5 || pat > 4.5 ) {
      // 革装：5 本の背バンド（盛り上がり。上下の端の 2 本だけ縁に箔の細い線）、上から 2 つ目の区画に色革の題簽と箔の題名
      for ( int k = 0; k < 5; k++ ) {
        float c = bookBandAt( float( k ) );
        float ridge = bookRidge( y - c, 0.022 * 0.25 / max( Hh, 0.08 ) );
        col *= 1.0 + 0.14 * ridge;
        if ( k == 0 || k == 4 || pat > 4.5 ) gold = max( gold, lbBand( y, c - 0.028, c - 0.023, aa.y ) + lbBand( y, c + 0.023, c + 0.028, aa.y ) );
      }
      label = lbBand( y, bookBandAt( 3.0 ) + 0.03, bookBandAt( 4.0 ) - 0.03, aa.y ) * lbBand( x, -0.44, 0.44, aa.x );
      col = mix( col, labelCol * ( 0.9 + 0.2 * big ), label );
      gold = max( gold, bookText( sp, vec2( -0.34, bookBandAt( 3.0 ) + 0.05 ), vec2( 0.34, bookBandAt( 4.0 ) - 0.05 ), 2.0, 6.0, sd, aa ) );
      if ( pat > 4.5 ) {
        // 区画の小さな菱形の飾り
        for ( int k = 0; k < 3; k++ ) {
          float cy = ( bookBandAt( float( k ) ) + bookBandAt( float( k + 1 ) ) ) * 0.5;
          vec2 d = vec2( abs( x ) / 0.3, abs( y - cy ) / 0.045 );
          float orn = 1.0 - smoothstep( 0.75, 1.0, d.x + d.y );
          gold = max( gold, orn * ( 0.35 + 0.65 * smoothstep( 0.8, 0.3, aa.y * 20.0 ) ) );
        }
      }
      gold = max( gold, lbBand( y, 0.042, 0.05, aa.y ) + lbBand( y, 0.95, 0.958, aa.y ) );
      if ( pat > 4.5 ) {
        // 総箔押し：区画の中の斜めの網目
        float net = lbBand( fract( ( x * 2.2 + y * Hh / max( Tk, 0.02 ) * 0.9 ) * 1.0 ), 0.0, 0.08, aa.y * 8.0 ) + lbBand( fract( ( -x * 2.2 + y * Hh / max( Tk, 0.02 ) * 0.9 ) ), 0.0, 0.08, aa.y * 8.0 );
        float inPanels = lbBand( y, 0.21, 0.66, aa.y ) * lbBand( x, -0.4, 0.4, aa.x );
        gold = max( gold, clamp( net, 0.0, 1.0 ) * inPanels * 0.8 );
      }
    } else if ( pat < 1.5 ) {
      // 布装：天地の箔の 2 本線、上の方に題名と著者、下に出版社の印
      gold = lbBand( y, 0.915, 0.925, aa.y ) + lbBand( y, 0.94, 0.95, aa.y ) + lbBand( y, 0.05, 0.06, aa.y ) + lbBand( y, 0.075, 0.085, aa.y );
      gold = max( gold, bookText( sp, vec2( -0.34, 0.74 ), vec2( 0.34, 0.86 ), 2.0, 6.0, sd, aa ) );
      gold = max( gold, bookText( sp, vec2( -0.28, 0.64 ), vec2( 0.28, 0.68 ), 1.0, 5.0, sd + 0.3, aa ) );
      gold = max( gold, bookText( sp, vec2( -0.2, 0.11 ), vec2( 0.2, 0.15 ), 1.0, 3.0, sd + 0.6, aa ) );
    } else if ( pat < 2.5 ) {
      // 布装に紙の題簽（古びた生成りの紙に黒い字、細い枠）と、下の分類の小さな札
      float lab = lbBand( y, 0.68, 0.84, aa.y ) * lbBand( x, -0.36, 0.36, aa.x );
      vec3 paper = vec3( 0.78, 0.7, 0.53 ) * ( 0.9 + 0.2 * big );
      col = mix( col, paper, lab );
      float frame = lab * ( 1.0 - lbBand( y, 0.695, 0.825, aa.y ) * lbBand( x, -0.32, 0.32, aa.x ) );
      float ink = bookText( sp, vec2( -0.28, 0.71 ), vec2( 0.28, 0.81 ), 2.0, 5.0, sd, aa );
      col = mix( col, vec3( 0.08, 0.06, 0.05 ), max( frame * 0.6, ink * 0.85 ) );
      float tag = lbBand( y, 0.08, 0.13, aa.y ) * lbBand( x, -0.3, 0.3, aa.x );
      col = mix( col, vec3( 0.86, 0.8, 0.66 ), tag );
      col = mix( col, vec3( 0.1, 0.08, 0.06 ), bookText( sp, vec2( -0.18, 0.09 ), vec2( 0.18, 0.12 ), 1.0, 3.0, sd + 0.5, aa ) * tag );
      rough = mix( rough, 0.9, lab );
    } else if ( pat < 3.5 ) {
      // 半革装：背は濃い革、天地に箔の太い帯、黒い題簽に箔の題名
      col = mix( col, col * 0.55 + vec3( 0.03, 0.015, 0.0 ), 0.7 );
      gold = lbBand( y, 0.86, 0.885, aa.y ) + lbBand( y, 0.9, 0.906, aa.y ) + lbBand( y, 0.115, 0.14, aa.y ) + lbBand( y, 0.094, 0.1, aa.y );
      label = lbBand( y, 0.7, 0.83, aa.y ) * lbBand( x, -0.42, 0.42, aa.x );
      col = mix( col, vec3( 0.045, 0.04, 0.035 ), label );
      gold = max( gold, bookText( sp, vec2( -0.32, 0.72 ), vec2( 0.32, 0.81 ), 2.0, 6.0, sd, aa ) );
      rough = 0.52;
    } else {
      // 新しい布装：背のまん中に縦書きの題名（箔または白）と、天地の細い線
      float t = bookText( vec2( y, x ), vec2( 0.3, -0.16 ), vec2( 0.86, 0.16 ), 1.0, 11.0, sd, aa.yx );
      if ( lbHash1( sd * 7.0 ) > 0.5 ) gold = t;
      else col = mix( col, vec3( 0.85, 0.82, 0.74 ), t * 0.9 );
      gold = max( gold, lbBand( y, 0.94, 0.947, aa.y ) + lbBand( y, 0.053, 0.06, aa.y ) );
    }
    gold = clamp( gold, 0.0, 1.0 );
    // 背の端（溝）の陰
    col *= 0.86 + 0.14 * ( 1.0 - pow( an.x * 2.0, 4.0 ) );
  } else if ( lp.y > 0.499 ) {
    // 天（頁の小口）：表紙の板の縁と紙の層。上の棚の陰に入る奥は暗い（日の当たるのは背に近い細い帯だけ）
    float s = ( 0.5 - lp.z ) * Dp;
    float lit = 1.0 - smoothstep( vBookGap * 0.6, vBookGap * 1.1 + 0.006, s );
    float board = 1.0 - step( an.x, 0.38 ) * step( lp.z, 0.44 ) * step( -0.47, lp.z );
    float layers = mix( 0.5, lbNoise( vec2( lp.x * Tk * 700.0, lp.z * 2.0 + sd * 13.0 ) ), lbKeep( max( fwidth( lp.x ), 1e-4 ) * Tk * 700.0 ) );
    vec3 paper = uBookPaper * ( 0.78 + 0.2 * layers ) * vec3( 1.0, 0.94, 0.84 );
    col = mix( paper * 0.6, cover * 0.7, board );
    col *= mix( 0.16, 0.6, lit ) * ( 0.5 + 0.5 * smoothstep( 0.0, 0.08, vBookGap ) );
    rough = 0.9;
  } else if ( lp.z < -0.499 ) {
    // 前小口（棚の奥）
    col = uBookPaper * 0.35;
    rough = 0.9;
  } else {
    // 表紙（平）：張り地の色、少し濃い縁、背に近い溝
    float hinge = smoothstep( 0.42, 0.47, lp.z ) * ( 1.0 - smoothstep( 0.47, 0.5, lp.z ) );
    col = cover * ( 0.86 + 0.1 * lbNoise( lp.yz * vec2( Hh, Dp ) * 60.0 + sd * 10.0 ) ) * ( 1.0 - 0.25 * hinge );
    rough = leather ? 0.55 : 0.86;
  }
  diffuseColor.rgb = mix( col, uBookGold * ( 0.92 + 0.16 * lbNoise( vec2( lp.x * 20.0, lp.y * 60.0 ) + sd * 5.0 ) ), gold ) * occ;
  roughnessFactor = mix( rough, 0.34, gold );
  metalnessFactor = gold;
}
`;
