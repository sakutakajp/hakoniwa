import * as THREE from 'three';

/**
 * 窓から差し込む日差しの筋（光の柱の見せかけ）。窓の中の数か所から日差しの進む向きへ、細長い帯を伸ばす。
 * 帯は軸のまわりで回して、いつも見ている人の方を向ける（レーザーや光の柱の描き方：軸と視線の両方に直交する向きに幅を取る）。
 * 加算で淡く光らせ、奥行きは書かない（奥行きの比較はするので、壁や家具の向こうは隠れる）。
 * 窓の近くで濃く、床へ向かって消える。帯の縁はぼかし、ほこりのむらを少し入れる。軸の向きから見るときは薄くする
 */
export interface BeamWindow {
  /** 窓の部屋の側の面の中心（x, z）と、窓の横の向き（水平） */
  center: THREE.Vector3;
  right: THREE.Vector3;
  width: number;
  sill: number;
  top: number;
}

export function createSunBeams(windows: BeamWindow[], sunDirection: THREE.Vector3, opts: { length: number; color: THREE.ColorRepresentation; opacity: number }) {
  const travel = sunDirection.clone().normalize().negate();
  const pos: number[] = [];
  const beam: number[] = [];
  const idx: number[] = [];
  /** 帯 1 本：始まりの点 p、半分の幅 hw、乱数の種 */
  const ribbon = (p: THREE.Vector3, hw: number, seed: number) => {
    const base = pos.length / 3;
    for (const [t, s] of [
      [0, -1],
      [0, 1],
      [1, 1],
      [1, -1],
    ]) {
      pos.push(p.x, p.y, p.z);
      beam.push(t, s, hw, seed);
    }
    idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
  };
  windows.forEach((w, wi) => {
    const at = (s: number, y: number) => w.center.clone().addScaledVector(w.right, s * w.width).setY(y);
    const h = w.top - w.sill;
    // 窓の中の 3 か所（左右と高さを少しずらす）から
    ribbon(at(-0.22, w.sill + h * 0.38), w.width * 0.32, wi * 3 + 0.1);
    ribbon(at(0.2, w.sill + h * 0.55), w.width * 0.32, wi * 3 + 1.3);
    ribbon(at(0.0, w.sill + h * 0.72), w.width * 0.28, wi * 3 + 2.6);
  });
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('aBeam', new THREE.Float32BufferAttribute(beam, 4));
  geo.setIndex(idx);
  // 帯は頂点の位置から伸ばすので、範囲は窓から光の届く先までを含める
  {
    const box = new THREE.Box3();
    for (let i = 0; i < pos.length; i += 3) {
      const p = new THREE.Vector3(pos[i], pos[i + 1], pos[i + 2]);
      box.expandByPoint(p);
      box.expandByPoint(p.clone().addScaledVector(travel, opts.length));
    }
    box.expandByScalar(1);
    geo.boundingBox = box;
    geo.boundingSphere = box.getBoundingSphere(new THREE.Sphere());
  }
  const material = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending,
    uniforms: {
      uColor: { value: new THREE.Color(opts.color) },
      uOpacity: { value: opts.opacity },
      uTravel: { value: travel },
      uLength: { value: opts.length },
    },
    vertexShader: /* glsl */ `
      attribute vec4 aBeam;
      uniform vec3 uTravel;
      uniform float uLength;
      varying vec2 vUv;
      varying float vSeed;
      varying float vAlong;
      void main() {
        vec3 axisP = ( modelMatrix * vec4( position, 1.0 ) ).xyz + uTravel * uLength * aBeam.x;
        vec3 toCam = normalize( cameraPosition - axisP );
        vec3 side = cross( uTravel, toCam );
        float sl = length( side );
        side = sl > 1e-4 ? side / sl : vec3( 1.0, 0.0, 0.0 );
        vec3 wp = axisP + side * aBeam.y * aBeam.z;
        vUv = vec2( aBeam.y * 0.5 + 0.5, aBeam.x );
        vSeed = aBeam.w;
        // 軸の向きから見るほど帯が細く重なって見えるので薄くする
        vAlong = 1.0 - pow( abs( dot( uTravel, toCam ) ), 6.0 );
        gl_Position = projectionMatrix * viewMatrix * vec4( wp, 1.0 );
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor;
      uniform float uOpacity;
      varying vec2 vUv;
      varying float vSeed;
      varying float vAlong;
      float h2( vec2 p ) { return fract( sin( dot( p, vec2( 127.1, 311.7 ) ) ) * 43758.5453 ); }
      float n2( vec2 p ) {
        vec2 i = floor( p ); vec2 f = fract( p ); f = f * f * ( 3.0 - 2.0 * f );
        return mix( mix( h2( i ), h2( i + vec2( 1, 0 ) ), f.x ), mix( h2( i + vec2( 0, 1 ) ), h2( i + vec2( 1, 1 ) ), f.x ), f.y );
      }
      void main() {
        float across = vUv.x;
        float along = vUv.y;
        float d = abs( across - 0.5 ) * 2.0;
        float edge = 1.0 - smoothstep( 0.2, 1.0, d );
        float fade = smoothstep( 0.0, 0.04, along ) * ( 1.0 - smoothstep( 0.2, 0.8, along ) );
        // ほこりのむら（光の進む向きに長い筋）
        float dust = 0.65 + 0.35 * n2( vec2( across * 7.0 + vSeed * 13.0, along * 3.0 + vSeed ) );
        float a = uOpacity * edge * edge * fade * dust * vAlong;
        gl_FragColor = vec4( uColor, a );
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
  const mesh = new THREE.Mesh(geo, material);
  mesh.name = 'sunbeams';
  mesh.renderOrder = 9;
  mesh.frustumCulled = false;
  return mesh;
}
