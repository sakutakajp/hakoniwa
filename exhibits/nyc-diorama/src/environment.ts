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
