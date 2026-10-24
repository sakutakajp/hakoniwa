import * as THREE from 'three';

/**
 * 柔らかい影と AO の焼き込み。
 * 面光源（主光・補助光）や空全体を多数の方向に分け、方向ごとに遮るもの（台座と山）の深度マップを描き、
 * 受け手（床・砂地・山の各頂点）がその方向から見えているかを調べて平均する。
 * シーンは静止しているので、起動時に1回だけ行う。
 */

export interface DirectionSet {
  directions: THREE.Vector3[];
  /** 書き込む色チャンネル（0 = R, 1 = G, 2 = B） */
  channel: 0 | 1 | 2;
  /** 水平面の受け手（床・砂地）に書くか */
  planes: boolean;
  /** 頂点の受け手（山）に書くか */
  points: boolean;
}

export interface PlaneReceiver {
  target: THREE.WebGLRenderTarget;
  centerX: number;
  centerZ: number;
  y: number;
  size: number;
  /**
   * 起伏のある面（海底など）：テクセルごとの高さ（R、ワールド座標）。y はその高さに足す量になる。
   * テクスチャの範囲は受け手と同じ（中心と一辺）
   */
  heightMap?: THREE.Texture;
  /**
   * lateCasters（あとから加える遮るもの。水の塊など）の影を、この割合だけ含める（0〜1）。
   * 指定しない受け手は lateCasters の影を受けない
   */
  lateWeight?: number;
}

export interface PointReceiver {
  target: THREE.WebGLRenderTarget;
  /** インデックスなしの点群（position, normal, bakeUv） */
  geometry: THREE.BufferGeometry;
  matrixWorld: THREE.Matrix4;
  /** 自分自身の影のちらつきを防ぐため、法線方向に少しずらして調べる距離 */
  normalOffset: number;
  /** 書き込むチャンネル [R = 主光, G = 空, B = 補助光]。省略時はすべて */
  channels?: [boolean, boolean, boolean];
}

const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));

/** 光源方向を中心とした円盤状の面光源上に、方向を均等に並べる（Vogel 配置） */
export function areaLightDirections(center: THREE.Vector3, angularRadius: number, count: number): THREE.Vector3[] {
  const up = Math.abs(center.y) < 0.99 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0);
  const t = new THREE.Vector3().crossVectors(up, center).normalize();
  const b = new THREE.Vector3().crossVectors(center, t).normalize();
  const dirs: THREE.Vector3[] = [];
  for (let i = 0; i < count; i++) {
    const r = angularRadius * Math.sqrt((i + 0.5) / count);
    const phi = i * GOLDEN_ANGLE;
    const d = center
      .clone()
      .multiplyScalar(Math.cos(r))
      .addScaledVector(t, Math.sin(r) * Math.cos(phi))
      .addScaledVector(b, Math.sin(r) * Math.sin(phi))
      .normalize();
    if (d.y > 0.02) dirs.push(d);
  }
  return dirs;
}

/** 上半球のコサイン重み付き方向（空からの光の遮蔽＝AO 用） */
export function skyDirections(count: number, minElevation: number): THREE.Vector3[] {
  const dirs: THREE.Vector3[] = [];
  const minY = Math.sin(minElevation);
  for (let i = 0; i < count; i++) {
    const r = Math.sqrt((i + 0.5) / count);
    const phi = i * GOLDEN_ANGLE;
    const y = Math.max(Math.sqrt(Math.max(0, 1 - r * r)), minY);
    dirs.push(new THREE.Vector3(r * Math.cos(phi), y, r * Math.sin(phi)).normalize());
  }
  return dirs;
}

/** 加算で積み上げる焼き込み先（半精度浮動小数が使えればそれを使う） */
export function createBakeTarget(renderer: THREE.WebGLRenderer, width: number, height: number): THREE.WebGLRenderTarget {
  const canFloat =
    renderer.extensions.has('EXT_color_buffer_float') || renderer.extensions.has('EXT_color_buffer_half_float');
  return new THREE.WebGLRenderTarget(width, height, {
    type: canFloat ? THREE.HalfFloatType : THREE.UnsignedByteType,
    format: THREE.RGBAFormat,
    minFilter: THREE.LinearFilter,
    magFilter: THREE.LinearFilter,
    wrapS: THREE.ClampToEdgeWrapping,
    wrapT: THREE.ClampToEdgeWrapping,
    generateMipmaps: false,
    depthBuffer: false,
    stencilBuffer: false,
    colorSpace: THREE.NoColorSpace,
  });
}

const OCCLUSION_GLSL = /* glsl */ `
uniform sampler2D uDepth;
uniform float uTexel;
// 光源から見て手前に遮るものがあるか（4点で平均）。範囲外や遮るものがない場所は 0
float occlusionAt( vec3 c, float bias ) {
  if ( c.x <= 0.0 || c.x >= 1.0 || c.y <= 0.0 || c.y >= 1.0 ) return 0.0;
  float o = 0.0;
  for ( int i = 0; i < 4; i ++ ) {
    vec2 off = ( vec2( float( i & 1 ), float( i >> 1 ) ) - 0.5 ) * uTexel;
    float d = texture2D( uDepth, c.xy + off ).r;
    o += ( d < 0.99999 && c.z - bias > d ) ? 1.0 : 0.0;
  }
  return o * 0.25;
}
`;

function accumulateBlending(m: THREE.ShaderMaterial) {
  m.blending = THREE.CustomBlending;
  m.blendEquation = THREE.AddEquation;
  m.blendSrc = THREE.OneFactor;
  m.blendDst = THREE.OneFactor;
  m.blendEquationAlpha = THREE.AddEquation;
  m.blendSrcAlpha = THREE.OneFactor;
  m.blendDstAlpha = THREE.OneFactor;
  m.depthTest = false;
  m.depthWrite = false;
  m.transparent = true;
}

/**
 * 床の焼き込みを、台座から離れるほど強くぼかす。
 * 面光源を有限個の方向で近似しているため、背の高い山の影の先の方では影が縞状に分かれて見える。
 * 影のにじみは遮るものからの距離に比例して広がるので、台座の外形からの距離に比例した幅でぼかす
 * （台座のすぐ下の接地影はぼかさない）。
 */
export function blurPlanarBake(
  renderer: THREE.WebGLRenderer,
  plane: PlaneReceiver,
  opts: {
    /** 台座（角丸の長方形）の半分の幅（x, z。数値ひとつなら正方形）と角の半径 */
    boxHalf: number | [number, number];
    boxRadius: number;
    /** 距離 1 あたりのぼかしの幅（標準偏差、ワールド単位） */
    spread: number;
    /** ぼかしの幅の上限（ワールド単位） */
    maxSigma: number;
  },
): void {
  const src = plane.target;
  const temp = createBakeTarget(renderer, src.width, src.height);
  const material = new THREE.ShaderMaterial({
    uniforms: {
      uSource: { value: src.texture as THREE.Texture },
      uDir: { value: new THREE.Vector2() },
      uCenter: { value: new THREE.Vector2(plane.centerX, plane.centerZ) },
      uSize: { value: plane.size },
      uTexels: { value: src.width },
      uBox: {
        value: (() => {
          const [hx, hz] = typeof opts.boxHalf === 'number' ? [opts.boxHalf, opts.boxHalf] : opts.boxHalf;
          return new THREE.Vector3(hx, hz, opts.boxRadius);
        })(),
      },
      uSpread: { value: opts.spread },
      uMaxSigma: { value: opts.maxSigma },
    },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = vec4( position.xy, 0.0, 1.0 );
      }`,
    fragmentShader: /* glsl */ `
      uniform sampler2D uSource;
      uniform vec2 uDir;
      uniform vec2 uCenter;
      uniform float uSize;
      uniform float uTexels;
      uniform vec3 uBox;
      uniform float uSpread;
      uniform float uMaxSigma;
      varying vec2 vUv;
      void main() {
        vec2 wp = vec2( uCenter.x + ( vUv.x - 0.5 ) * uSize, uCenter.y - ( vUv.y - 0.5 ) * uSize );
        // 台座の外形（角丸正方形）からの距離
        vec2 q = abs( wp ) - ( uBox.xy - uBox.z );
        float dist = max( length( max( q, 0.0 ) ) + min( max( q.x, q.y ), 0.0 ) - uBox.z, 0.0 );
        float sigma = min( uMaxSigma, uSpread * dist ) / uSize; // UV 単位
        vec4 sum = texture2D( uSource, vUv );
        if ( sigma * uTexels < 0.35 ) {
          gl_FragColor = sum;
          return;
        }
        float wsum = 1.0;
        float stepUv = sigma * 2.5 / 8.0;
        for ( int i = 1; i <= 8; i ++ ) {
          float o = float( i ) * stepUv;
          float w = exp( -0.5 * ( o * o ) / ( sigma * sigma ) );
          sum += w * ( texture2D( uSource, vUv + uDir * o ) + texture2D( uSource, vUv - uDir * o ) );
          wsum += 2.0 * w;
        }
        gl_FragColor = sum / wsum;
      }`,
    depthTest: false,
    depthWrite: false,
  });
  const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), material);
  quad.frustumCulled = false;
  const scene = new THREE.Scene();
  scene.add(quad);
  const cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const prevTarget = renderer.getRenderTarget();
  // 横 → 縦の2回に分けてぼかす
  material.uniforms.uSource.value = src.texture;
  material.uniforms.uDir.value.set(1, 0);
  renderer.setRenderTarget(temp);
  renderer.render(scene, cam);
  material.uniforms.uSource.value = temp.texture;
  material.uniforms.uDir.value.set(0, 1);
  renderer.setRenderTarget(src);
  renderer.render(scene, cam);
  renderer.setRenderTarget(prevTarget);
  temp.dispose();
  material.dispose();
  quad.geometry.dispose();
}

export function bakeVisibility(
  renderer: THREE.WebGLRenderer,
  opts: {
    casters: THREE.Mesh[];
    /** lateWeight を指定した平面だけが受ける、あとから加える遮るもの（半透明な水の塊の影を薄く落とすため） */
    lateCasters?: THREE.Mesh[];
    sets: DirectionSet[];
    planes: PlaneReceiver[];
    points?: PointReceiver[];
    mapSize: number;
    /** 深度比較の余裕（ワールド単位） */
    bias: number;
  },
): void {
  const size = opts.mapSize;
  const depthTexture = new THREE.DepthTexture(size, size, THREE.UnsignedIntType);
  depthTexture.format = THREE.DepthFormat;
  depthTexture.minFilter = THREE.NearestFilter;
  depthTexture.magFilter = THREE.NearestFilter;
  const depthTarget = new THREE.WebGLRenderTarget(size, size, { depthTexture, depthBuffer: true });

  // 遮るもの（深度だけ書く）
  const casterScene = new THREE.Scene();
  const lateScene = new THREE.Scene();
  const depthMaterial = new THREE.MeshBasicMaterial({ colorWrite: false, side: THREE.DoubleSide });
  const sphere = new THREE.Sphere();
  const tmp = new THREE.Sphere();
  let first = true;
  const lateSet = new Set(opts.lateCasters ?? []);
  for (const m of [...opts.casters, ...(opts.lateCasters ?? [])]) {
    m.updateMatrixWorld(true);
    let proxy: THREE.Mesh;
    if (m instanceof THREE.InstancedMesh) {
      // 植生などのインスタンス描画：位置の行列はそのまま共有する
      const inst = new THREE.InstancedMesh(m.geometry, depthMaterial, m.count);
      inst.instanceMatrix = m.instanceMatrix;
      if (!m.boundingSphere) m.computeBoundingSphere();
      tmp.copy(m.boundingSphere!).applyMatrix4(m.matrixWorld);
      proxy = inst;
    } else {
      proxy = new THREE.Mesh(m.geometry, depthMaterial);
      if (!m.geometry.boundingSphere) m.geometry.computeBoundingSphere();
      tmp.copy(m.geometry.boundingSphere!).applyMatrix4(m.matrixWorld);
    }
    proxy.matrixAutoUpdate = false;
    proxy.matrix.copy(m.matrixWorld);
    proxy.frustumCulled = false;
    (lateSet.has(m) ? lateScene : casterScene).add(proxy);
    if (first) sphere.copy(tmp);
    else sphere.union(tmp);
    first = false;
  }
  const R = sphere.radius * 1.02;
  const lightCam = new THREE.OrthographicCamera(-R, R, R, -R, R * 0.5, R * 3.5);
  const depthRange = lightCam.far - lightCam.near;
  const lightVP = new THREE.Matrix4();

  // 水平面の受け手
  const planeMaterial = new THREE.ShaderMaterial({
    uniforms: {
      uDepth: { value: depthTexture },
      uTexel: { value: 1 / size },
      uLightVP: { value: lightVP },
      uWeight: { value: new THREE.Vector4() },
      uCenter: { value: new THREE.Vector2() },
      uSize: { value: 1 },
      uY: { value: 0 },
      uHeightMap: { value: null as THREE.Texture | null },
      uUseHeight: { value: 0 },
      uBias: { value: opts.bias / depthRange },
    },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = vec4( position.xy, 0.0, 1.0 );
      }`,
    fragmentShader: /* glsl */ `
      uniform mat4 uLightVP;
      uniform vec4 uWeight;
      uniform vec2 uCenter;
      uniform float uSize;
      uniform float uY;
      uniform sampler2D uHeightMap;
      uniform float uUseHeight;
      uniform float uBias;
      varying vec2 vUv;
      ${OCCLUSION_GLSL}
      void main() {
        float h = uUseHeight > 0.5 ? texture2D( uHeightMap, vUv ).r : 0.0;
        vec3 wp = vec3( uCenter.x + ( vUv.x - 0.5 ) * uSize, uY + h, uCenter.y - ( vUv.y - 0.5 ) * uSize );
        vec4 lp = uLightVP * vec4( wp, 1.0 );
        vec3 c = lp.xyz / lp.w * 0.5 + 0.5;
        gl_FragColor = uWeight * occlusionAt( c, uBias );
      }`,
  });
  accumulateBlending(planeMaterial);
  const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), planeMaterial);
  quad.frustumCulled = false;
  const quadScene = new THREE.Scene();
  quadScene.add(quad);
  const quadCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

  // 頂点の受け手（各頂点を焼き込み先の1テクセルに描く）
  const pointReceivers = opts.points ?? [];
  let pointMaterial: THREE.ShaderMaterial | null = null;
  const pointScenes: THREE.Scene[] = [];
  if (pointReceivers.length > 0) {
    pointMaterial = new THREE.ShaderMaterial({
      uniforms: {
        uDepth: { value: depthTexture },
        uTexel: { value: 1 / size },
        uLightVP: { value: lightVP },
        uWeight: { value: new THREE.Vector4() },
        uLightDir: { value: new THREE.Vector3() },
        uNormalOffset: { value: 0 },
        uBias: { value: (opts.bias * 0.5) / depthRange },
      },
      vertexShader: /* glsl */ `
        attribute vec2 bakeUv;
        uniform mat4 uLightVP;
        uniform vec3 uLightDir;
        uniform float uNormalOffset;
        varying vec3 vCoord;
        varying float vFacing;
        void main() {
          vec3 wp = ( modelMatrix * vec4( position, 1.0 ) ).xyz;
          vec3 wn = normalize( mat3( modelMatrix ) * normal );
          vFacing = dot( wn, uLightDir );
          wp += wn * uNormalOffset;
          vec4 lp = uLightVP * vec4( wp, 1.0 );
          vCoord = lp.xyz / lp.w * 0.5 + 0.5;
          gl_Position = vec4( bakeUv * 2.0 - 1.0, 0.0, 1.0 );
          gl_PointSize = 1.0;
        }`,
      fragmentShader: /* glsl */ `
        uniform vec4 uWeight;
        uniform float uBias;
        varying vec3 vCoord;
        varying float vFacing;
        ${OCCLUSION_GLSL}
        void main() {
          // 光源に背を向けた面は、光が当たらない（遮られている）とみなす
          float o = vFacing <= 0.0 ? 1.0 : occlusionAt( vCoord, uBias );
          gl_FragColor = uWeight * o;
        }`,
    });
    accumulateBlending(pointMaterial);
    for (const r of pointReceivers) {
      const pts = new THREE.Points(r.geometry, pointMaterial);
      pts.matrixAutoUpdate = false;
      pts.matrix.copy(r.matrixWorld);
      pts.frustumCulled = false;
      const sc = new THREE.Scene();
      sc.add(pts);
      pointScenes.push(sc);
    }
  }

  const prev = {
    target: renderer.getRenderTarget(),
    autoClear: renderer.autoClear,
    clearColor: renderer.getClearColor(new THREE.Color()),
    clearAlpha: renderer.getClearAlpha(),
  };
  renderer.autoClear = false;
  renderer.setClearColor(0x000000, 0);
  for (const t of [...opts.planes.map((p) => p.target), ...pointReceivers.map((r) => r.target)]) {
    renderer.setRenderTarget(t);
    renderer.clear(true, false, false);
  }

  const weight = new THREE.Vector4();
  for (const set of opts.sets) {
    if (set.directions.length === 0) continue;
    weight.set(0, 0, 0, 0).setComponent(set.channel, 1 / set.directions.length);
    for (const d of set.directions) {
      lightCam.position.copy(sphere.center).addScaledVector(d, R * 2);
      lightCam.up.set(0, 1, 0);
      if (Math.abs(d.y) > 0.99) lightCam.up.set(0, 0, 1);
      lightCam.lookAt(sphere.center);
      lightCam.updateMatrixWorld();
      lightVP.multiplyMatrices(lightCam.projectionMatrix, lightCam.matrixWorldInverse);

      renderer.setRenderTarget(depthTarget);
      renderer.clear(false, true, false);
      renderer.render(casterScene, lightCam);

      const renderPlane = (p: PlaneReceiver, scale: number) => {
        planeMaterial.uniforms.uWeight.value.copy(weight).multiplyScalar(scale);
        planeMaterial.uniforms.uCenter.value.set(p.centerX, p.centerZ);
        planeMaterial.uniforms.uSize.value = p.size;
        planeMaterial.uniforms.uY.value = p.y;
        planeMaterial.uniforms.uHeightMap.value = p.heightMap ?? null;
        planeMaterial.uniforms.uUseHeight.value = p.heightMap ? 1 : 0;
        renderer.setRenderTarget(p.target);
        renderer.render(quadScene, quadCam);
      };
      const hasLate = lateScene.children.length > 0;
      if (set.planes) {
        for (const p of opts.planes) {
          // あとから加える遮るものの影を一部だけ受ける面は、加える前の影を残りの割合で書く
          const w = hasLate && p.lateWeight !== undefined ? 1 - p.lateWeight : 1;
          if (w > 0) renderPlane(p, w);
        }
      }
      if (set.points && pointMaterial) {
        pointMaterial.uniforms.uWeight.value.copy(weight);
        pointMaterial.uniforms.uLightDir.value.copy(d);
        pointReceivers.forEach((r, i) => {
          if (r.channels && !r.channels[set.channel]) return;
          pointMaterial!.uniforms.uNormalOffset.value = r.normalOffset;
          renderer.setRenderTarget(r.target);
          renderer.render(pointScenes[i], quadCam);
        });
      }
      // あとから加える遮るもの（水の塊）を同じ深度マップに描き足し、それを受ける面だけ書く
      if (set.planes && hasLate) {
        renderer.setRenderTarget(depthTarget);
        renderer.render(lateScene, lightCam);
        for (const p of opts.planes) {
          if (p.lateWeight !== undefined && p.lateWeight > 0) renderPlane(p, p.lateWeight);
        }
      }
    }
  }

  renderer.autoClear = prev.autoClear;
  renderer.setClearColor(prev.clearColor, prev.clearAlpha);
  renderer.setRenderTarget(prev.target);

  depthTarget.dispose();
  depthTexture.dispose();
  depthMaterial.dispose();
  planeMaterial.dispose();
  quad.geometry.dispose();
  pointMaterial?.dispose();
}
