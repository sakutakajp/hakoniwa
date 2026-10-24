import * as THREE from 'three';

/**
 * 空の環境マップ（映り込みと、空からの柔らかい光）。
 * 天頂の青から地平線の白っぽい水色へのグラデーションに、地平線の近くの淡い雲と、遠くの街並みの青灰色の帯を足す。
 * 太陽のまわりの空は明るく、地平線の下（床）は太陽の側ほど明るく、反対側は影の落ちた濃い空色にする
 * （方位で明るさが変わる環境光。日なたの面と陰の面の差がはっきりし、ガラスの面ごとに映る明るさが変わる）。
 * ガラスの塔に映ったとき、のっぺりしないように少しだけ模様を入れる。
 */
export function createSkyEnvironment(
  renderer: THREE.WebGLRenderer,
  sky: {
    zenith: string;
    horizon: string;
    ground: string;
    /** 太陽のまわりの空の明るさの上乗せ（太陽に近い空ほど明るい） */
    sunGlow?: number;
    /** 地平線の下：太陽の側の床（日なた）の明るさの上乗せと、反対側（台座の影の側）の色と混ぜる割合 */
    groundSun?: number;
    shadowFloor?: string;
    shadowFloorMix?: number;
  },
  /** 太陽（主光）の向き（光源へ向かう単位ベクトル） */
  sun: THREE.Vector3 = new THREE.Vector3(0, 1, 0),
): THREE.Texture {
  const material = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    uniforms: {
      uZenith: { value: new THREE.Color(sky.zenith) },
      uHorizon: { value: new THREE.Color(sky.horizon) },
      uGround: { value: new THREE.Color(sky.ground) },
      uSun: { value: sun.clone().normalize() },
      uSunK: { value: new THREE.Vector3(sky.sunGlow ?? 0, sky.groundSun ?? 0, sky.shadowFloorMix ?? 0) },
      uShadowFloor: { value: new THREE.Color(sky.shadowFloor ?? sky.ground) },
    },
    vertexShader: /* glsl */ `
      varying vec3 vDir;
      void main() {
        vDir = normalize( position );
        gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uZenith;
      uniform vec3 uHorizon;
      uniform vec3 uGround;
      uniform vec3 uSun;
      uniform vec3 uSunK;
      uniform vec3 uShadowFloor;
      varying vec3 vDir;
      float h2( vec2 p ) { return fract( sin( dot( p, vec2( 127.1, 311.7 ) ) ) * 43758.5453 ); }
      float n2( vec2 p ) {
        vec2 i = floor( p ); vec2 f = fract( p ); f = f * f * ( 3.0 - 2.0 * f );
        return mix( mix( h2( i ), h2( i + vec2( 1, 0 ) ), f.x ), mix( h2( i + vec2( 0, 1 ) ), h2( i + vec2( 1, 1 ) ), f.x ), f.y );
      }
      void main() {
        vec3 d = normalize( vDir );
        float y = d.y;
        float az = atan( d.z, d.x );
        vec3 col = mix( uHorizon, uZenith, pow( smoothstep( 0.0, 1.0, y ), 0.6 ) );
        // 地平線の近くの淡い雲（方位で途切れる）
        float cl = n2( vec2( az * 3.0, y * 9.0 ) ) * 0.6 + n2( vec2( az * 7.0, y * 20.0 ) ) * 0.4;
        float band = smoothstep( 0.02, 0.12, y ) * ( 1.0 - smoothstep( 0.18, 0.42, y ) );
        col = mix( col, vec3( 1.0 ), smoothstep( 0.5, 0.8, cl ) * band * 0.55 );
        // 遠くの街並み（地平線のすぐ上の青灰色の帯。高さが方位でばらつく）
        float sky = n2( vec2( az * 12.0, 0.5 ) ) * 0.05 + n2( vec2( az * 40.0, 1.5 ) ) * 0.025;
        float city = 1.0 - smoothstep( sky - 0.004, sky + 0.004, y );
        col = mix( col, vec3( 0.55, 0.64, 0.74 ), city * step( 0.0, y ) * 0.8 );
        // 太陽のまわりの空は明るく白っぽい（日なた側の面に空の光が多く当たり、ガラスにも明るい空が映る）
        col += uSunK.x * vec3( 1.0, 0.97, 0.9 ) * pow( max( dot( d, uSun ), 0.0 ), 3.0 );
        // 地平線の下：床の淡い空色。地平線の近くには、ほかの建物が映ったような濃い青と白の縦の帯
        vec3 below = uGround;
        float yb = -y;
        float tall = n2( vec2( az * 10.0, 0.7 ) );
        float cityMask = smoothstep( 0.0, 0.04, yb ) * ( 1.0 - smoothstep( 0.12 + 0.3 * tall, 0.2 + 0.3 * tall, yb ) );
        float stripe = n2( vec2( az * 26.0, yb * 3.0 ) );
        vec3 cityC = mix( vec3( 0.3, 0.42, 0.6 ), vec3( 0.88, 0.92, 0.96 ), smoothstep( 0.45, 0.6, stripe ) );
        // 太陽の側は日なたの床で明るく、反対側は台座の影が落ちた、濃い空色の床
        float sunAz = dot( normalize( d.xz + vec2( 1e-5 ) ), normalize( uSun.xz + vec2( 1e-5 ) ) );
        below = mix( below, uShadowFloor, smoothstep( -0.1, -0.85, sunAz ) * uSunK.z );
        below *= 1.0 + uSunK.y * smoothstep( -0.2, 0.9, sunAz );
        below = mix( below, cityC, cityMask * 0.75 * smoothstep( 0.35, 0.55, tall ) );
        col = mix( col, below, smoothstep( 0.0, -0.03, y ) );
        gl_FragColor = vec4( col, 1.0 );
      }`,
  });
  const scene = new THREE.Scene();
  scene.add(new THREE.Mesh(new THREE.SphereGeometry(10, 64, 32), material));
  const pmrem = new THREE.PMREMGenerator(renderer);
  const target = pmrem.fromScene(scene, 0, 0.1, 100);
  pmrem.dispose();
  material.dispose();
  return target.texture;
}

/**
 * 部屋の中の映り込み用の環境マップ（真鍮・金箔・ニス・磨いた石のつやのある面だけに使う）。
 * 奥（-z）と左（-x）は暗い木の本棚、その上の奥に明るい格子の窓（両脇のアーチの窓とまん中のセルリアーナ）。開いた手前（+z）と右（+x）、上は明るい外（背景の淡いベージュ）。
 * 下は寄木の床。明るい所と暗い所の差が大きいので、金属の面に強い光と濃い陰が映り、均一なプラスチックのように見えない
 * （物理ベースの描画では、金属の見え方は映り込む環境で決まる）
 */
export function createInteriorEnvironment(
  renderer: THREE.WebGLRenderer,
  colors: { open: string; wood: string; floor: string; window: string; top: string },
): THREE.Texture {
  const material = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    uniforms: {
      uOpen: { value: new THREE.Color(colors.open) },
      uWood: { value: new THREE.Color(colors.wood) },
      uFloor: { value: new THREE.Color(colors.floor) },
      uWindow: { value: new THREE.Color(colors.window) },
      uTop: { value: new THREE.Color(colors.top) },
    },
    vertexShader: /* glsl */ `
      varying vec3 vDir;
      void main() {
        vDir = normalize( position );
        gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uOpen;
      uniform vec3 uWood;
      uniform vec3 uFloor;
      uniform vec3 uWindow;
      uniform vec3 uTop;
      varying vec3 vDir;
      float h2( vec2 p ) { return fract( sin( dot( p, vec2( 127.1, 311.7 ) ) ) * 43758.5453 ); }
      float n2( vec2 p ) {
        vec2 i = floor( p ); vec2 f = fract( p ); f = f * f * ( 3.0 - 2.0 * f );
        return mix( mix( h2( i ), h2( i + vec2( 1, 0 ) ), f.x ), mix( h2( i + vec2( 0, 1 ) ), h2( i + vec2( 1, 1 ) ), f.x ), f.y );
      }
      void main() {
        vec3 d = normalize( vDir );
        float az = atan( d.x, d.z );   // 0 = 手前、+π/2 = 右、±π = 奥
        // まわりは暗い木の本棚（本の背の明るさのむらの縦の帯）。開いた手前の右（見ている人の側）にだけ、柔らかく明るい外が見える
        float shelves = 0.75 + 0.5 * n2( vec2( az * 18.0, d.y * 6.0 ) );
        vec3 wall = uWood * shelves;
        // 開いた手前と右（壁がない側）は柔らかく明るい外
        float open = max( smoothstep( 0.45, 0.92, dot( d, normalize( vec3( 0.55, 0.3, 0.78 ) ) ) ), smoothstep( 0.35, 0.9, dot( d, normalize( vec3( 0.95, 0.25, 0.1 ) ) ) ) );
        vec3 col = mix( wall, uOpen, open );
        // 奥の高い所の窓（両脇のアーチの窓と、まん中のセルリアーナ。格子の桟は暗い線）
        float back = smoothstep( -0.75, -0.92, d.z );
        float el = asin( clamp( d.y, -1.0, 1.0 ) );
        float wx = d.x / max( -d.z, 0.2 );
        float win = 0.0;
        for ( int k = 0; k < 3; k++ ) {
          float cx = k == 0 ? -0.58 : ( k == 1 ? -0.054 : 0.47 );
          float hw = k == 1 ? 0.25 : 0.093;
          float inX = smoothstep( hw + 0.02, hw, abs( wx - cx ) );
          float inY = smoothstep( 0.3, 0.33, el ) * ( 1.0 - smoothstep( 0.6, 0.64, el ) );
          float bars = 1.0 - 0.75 * ( smoothstep( 0.012, 0.0, abs( fract( ( wx - cx ) * 14.0 + 0.5 ) - 0.5 ) / 14.0 )
                     + smoothstep( 0.015, 0.0, abs( fract( el * 16.0 ) - 0.5 ) / 16.0 ) );
          win = max( win, inX * inY * clamp( bars, 0.2, 1.0 ) );
        }
        col = mix( col, uWindow * 2.2, win * back );
        // 壁の燭台と机のランプの小さな明るい点（曲がった真鍮の面に小さな光の点として映る）
        for ( int k = 0; k < 7; k++ ) {
          float fk = float( k );
          float a = -2.6 + fk * 0.62 + 0.2 * sin( fk * 3.1 );
          float e = 0.1 + 0.18 * fract( fk * 0.37 + 0.2 );
          vec3 L = normalize( vec3( sin( a ) * cos( e ), sin( e ), cos( a ) * cos( e ) ) );
          col += vec3( 1.0, 0.82, 0.55 ) * 3.0 * smoothstep( 0.9994, 0.99985, dot( d, L ) );
        }
        // 上は明るい外（天井がない）。天頂のまわりだけ
        col = mix( col, uTop, smoothstep( 0.7, 0.97, d.y ) );
        // 下は寄木の床（日の当たる床のむら）
        vec3 below = uFloor * ( 0.8 + 0.4 * n2( vec2( az * 5.0, d.y * 4.0 ) ) );
        col = mix( col, below, smoothstep( 0.02, -0.12, d.y ) );
        gl_FragColor = vec4( col, 1.0 );
      }`,
  });
  const scene = new THREE.Scene();
  scene.add(new THREE.Mesh(new THREE.SphereGeometry(10, 96, 48), material));
  const pmrem = new THREE.PMREMGenerator(renderer);
  const target = pmrem.fromScene(scene, 0, 0.1, 100);
  pmrem.dispose();
  material.dispose();
  return target.texture;
}
