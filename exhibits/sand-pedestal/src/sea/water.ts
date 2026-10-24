import * as THREE from 'three';
import type { SceneConfig } from '../config';
import { directionFromAngles } from '../framing';
import type { SeaLayout } from './layout';
import { gridBoundary, mapToRoundedSquare, outlineNormal } from './seabed';
import { createShoreTexture, type ShoreSource } from './shore';
import { createWaveTexture } from './waveTexture';
import { COPY_FRAGMENT, COPY_VERTEX, WATER_FRAGMENT, WATER_VERTEX } from './shaders';

export interface Water {
  /** 水面と側面の断面（名前 'sea-water'）。メインのシーンには入れず、render で重ねて描く */
  group: THREE.Group;
  /**
   * 1 コマ描く：不透明な物（土台・海底・島・岩・植生）を描いた画像（必要なときだけ描き直す）を画面に写し、
   * その上に水面と断面を描く。水はその画像を通して海底を見せる（水深と光の通る距離で色が変わる）
   */
  render: (renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.PerspectiveCamera, time: number) => void;
  /** 不透明な物の画像を次のコマで描き直す（画面の大きさ・影・表示の切り替えのあと） */
  invalidate: () => void;
  /** 岸（崖・砂浜・水面から出た岩）が変わったときに、泡の位置を作り直す */
  updateShore: (source: ShoreSource) => void;
}

/** sRGB の色をリニアにした THREE.Color */
const color = (hex: string) => new THREE.Color(hex);

export function createWater(
  renderer: THREE.WebGLRenderer,
  config: SceneConfig,
  layout: SeaLayout,
  opts: {
    lowPower: boolean;
    /** 砂地（海底）に焼き込んだ影と、その範囲の一辺。水面の日陰と、水中の光の網目の影に使う */
    bake: { texture: THREE.Texture; size: number; height: THREE.Texture };
    shore: ShoreSource;
  },
): Water {
  const W = config.pedestal.size;
  const sea = config.sea;
  const group = new THREE.Group();
  group.name = 'sea-water';

  // --- 岸からの距離（泡）
  const shoreSize = W;
  const shoreMax = 1.0 * (W / 10);
  const shore = createShoreTexture({
    size: shoreSize,
    resolution: opts.lowPower ? 384 : 640,
    waterY: layout.yWater,
    maxDistance: shoreMax,
    source: opts.shore,
  });

  // --- 深場らしさ
  const deepTexture = layout.deepTexture(opts.bake.size, 256);

  // --- 細かな風浪の傾き（繰り返し模様）
  const wl = sea.waves.wavelets;
  const waveTexture = createWaveTexture({
    resolution: opts.lowPower ? 128 : 256,
    tile: wl.tile * W,
    wavelength: [wl.wavelength[0] * W, wl.wavelength[1] * W],
    angle: THREE.MathUtils.degToRad(wl.angle),
    spread: THREE.MathUtils.degToRad(wl.spread),
    count: wl.count,
    seed: 17,
  });

  // --- 不透明な物を描く画像（色と奥行き）
  const canHalf =
    renderer.extensions.has('EXT_color_buffer_float') || renderer.extensions.has('EXT_color_buffer_half_float');
  const depthTexture = new THREE.DepthTexture(1, 1, THREE.UnsignedIntType);
  // 高精細な画面（ピクセル比が大きい）では、アンチエイリアスを省いて負荷とメモリを抑える
  const dpr = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1;
  const samples = dpr > 1.5 ? 0 : Math.max(0, Math.floor(sea.msaa));
  const sceneTarget = new THREE.WebGLRenderTarget(1, 1, {
    samples,
    type: canHalf ? THREE.HalfFloatType : THREE.UnsignedByteType,
    format: THREE.RGBAFormat,
    minFilter: THREE.LinearFilter,
    magFilter: THREE.LinearFilter,
    generateMipmaps: false,
    depthBuffer: true,
    depthTexture,
    colorSpace: THREE.NoColorSpace,
  });
  let dirty = true;

  // --- 水のマテリアル（水面と側面で共通。側面は泡なし・ほぼ平ら）
  const key = config.lights.key;
  const sunDir = directionFromAngles(key.azimuth, key.elevation);
  const ln2 = Math.log(2);
  const scatter = ln2 / (sea.clarity * W);
  const uniforms = {
    tScene: { value: sceneTarget.texture as THREE.Texture },
    tDepth: { value: depthTexture as THREE.Texture },
    tShore: { value: shore.texture as THREE.Texture },
    tBake: { value: opts.bake.texture },
    tHeight: { value: opts.bake.height },
    tDeep: { value: deepTexture as THREE.Texture },
    uResolution: { value: new THREE.Vector2(1, 1) },
    uProjInv: { value: new THREE.Matrix4() },
    uCamWorld: { value: new THREE.Matrix4() },
    uViewProj: { value: new THREE.Matrix4() },
    uTime: { value: 0 },
    uWaterY: { value: layout.yWater },
    uWaterBottom: { value: layout.yDeep },
    uSwell: {
      value: new THREE.Vector4(sea.waves.height * W, sea.waves.length * W, sea.waves.speed, 0),
    },
    uShallow: { value: color(sea.colors.shallow) },
    uMid: { value: color(sea.colors.mid) },
    uDeep: { value: color(sea.colors.deep) },
    uColorDepths: { value: new THREE.Vector2(sea.colorDepths[0] * W, sea.colorDepths[1] * W) },
    uAbsorb: { value: new THREE.Vector3(...sea.absorption).multiplyScalar(scatter) },
    uScatter: { value: scatter },
    uDeepExtra: { value: sea.deep.extraDepth * W },
    uSunDir: { value: sunDir },
    uSunColor: { value: color(key.color) },
    uHorizon: { value: color(sea.reflection.horizon) },
    uZenith: { value: color(sea.reflection.zenith) },
    uReflect: { value: sea.reflection.strength },
    uGlint: { value: sea.reflection.glint },
    uRefraction: { value: sea.refraction },
    uWallClarity: { value: sea.wallClarity },
    uWallClear: { value: sea.wallClear * W },
    uWallHaze: { value: sea.wallHaze },
    uWallTint: { value: color(sea.wallTint) },
    uWallReflect: { value: sea.wallReflection },
    uSheen: { value: sea.waves.sheen },
    uRipple: { value: new THREE.Vector2(sea.waves.ripple, 1 / (sea.waves.rippleSize * W)) },
    tWaves: { value: waveTexture as THREE.Texture },
    uWaveTex: { value: new THREE.Vector4(wl.strength, 1 / (wl.tile * W), wl.speed, 0) },
    uFoamScale: { value: 1 / (sea.foam.cell * W) },
    uShoreSize: { value: shoreSize },
    uShoreMax: { value: shoreMax },
    uFoam: { value: new THREE.Vector3(sea.foam.width * W, sea.foam.amount, sea.foam.speed) },
    uCaustic: {
      value: new THREE.Vector4(
        sea.caustics.strength,
        1 / (sea.caustics.size * W),
        sea.caustics.speed,
        sea.caustics.fadeDepth * W,
      ),
    },
    uBakeSize: { value: opts.bake.size },
    uOutline: { value: new THREE.Vector2(layout.half, layout.cornerRadius) },
    uRim: { value: new THREE.Vector2(sea.rim.width * W, sea.rim.strength) },
    uWallGrad: {
      value: new THREE.Vector4(
        sea.wallGradient.range[0],
        sea.wallGradient.range[1],
        1 / (sea.wallGradient.noiseSize * W),
        sea.wallGradient.unevenness,
      ),
    },
    uWallGradDeep: { value: new THREE.Vector2(sea.wallGradient.rangeDeep[0], sea.wallGradient.rangeDeep[1]) },
    uWallGradPath: { value: new THREE.Vector2(sea.wallGradient.path[0] * W, sea.wallGradient.path[1] * W) },
    uWallTopColor: { value: color(sea.wallGradient.topColor) },
    uWallTopDeep: { value: color(sea.wallGradient.topColorDeep) },
    uWallGradMisc: {
      value: new THREE.Vector3(sea.wallGradient.strength, sea.wallGradient.near[0], sea.wallGradient.near[1] * W),
    },
    uWallBase: { value: sea.wallGradient.base * W },
    uWallDeepFloor: { value: sea.wallGradient.deepFloor * W },
  };
  const makeMaterial = (wall: boolean) =>
    new THREE.ShaderMaterial({
      name: wall ? 'sea-wall' : 'sea-surface',
      uniforms,
      vertexShader: WATER_VERTEX,
      fragmentShader: WATER_FRAGMENT,
      defines: wall ? { WATER_WALL: '' } : {},
      side: THREE.FrontSide,
    });

  // --- 水面：海底と同じ写し方の格子（外周の頂点が側面の上端と一致する）
  const n = opts.lowPower ? 140 : 220;
  const count = (n + 1) * (n + 1);
  const pos = new Float32Array(count * 3);
  for (let j = 0; j <= n; j++) {
    for (let i = 0; i <= n; i++) {
      const [x, z] = mapToRoundedSquare((i / n) * 2 - 1, (j / n) * 2 - 1, layout.half, layout.cornerRadius);
      pos.set([x, layout.yWater, z], (i + j * (n + 1)) * 3);
    }
  }
  const index: number[] = [];
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const a = i + j * (n + 1);
      index.push(a, a + n + 1, a + 1, a + 1, a + n + 1, a + n + 2);
    }
  }
  const surfaceGeometry = new THREE.BufferGeometry();
  surfaceGeometry.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  surfaceGeometry.setIndex(index);
  surfaceGeometry.computeBoundingSphere();
  const surface = new THREE.Mesh(surfaceGeometry, makeMaterial(false));
  surface.name = 'sea-surface';
  surface.renderOrder = 1;
  surface.frustumCulled = false;

  // --- 側面の断面：水面の外周から土台の上面まで
  const ring = gridBoundary(n);
  const m = ring.length;
  const wp = new Float32Array(m * 2 * 3);
  const wn = new Float32Array(m * 2 * 3);
  const wt = new Float32Array(m * 2);
  for (let r = 0; r < m; r++) {
    const k = ring[r];
    const x = pos[k * 3];
    const z = pos[k * 3 + 2];
    const [ox, oz] = outlineNormal(x, z, layout.half, layout.cornerRadius);
    wp.set([x, layout.yDeep, z, x, layout.yWater, z], r * 6);
    wn.set([ox, 0, oz, ox, 0, oz], r * 6);
    wt[r * 2] = 0;
    wt[r * 2 + 1] = 1;
  }
  const wi: number[] = [];
  for (let r = 0; r < m; r++) {
    const a = r * 2;
    const b = ((r + 1) % m) * 2;
    wi.push(a, a + 1, b, a + 1, b + 1, b);
  }
  const wallGeometry = new THREE.BufferGeometry();
  wallGeometry.setAttribute('position', new THREE.BufferAttribute(wp, 3));
  wallGeometry.setAttribute('normal', new THREE.BufferAttribute(wn, 3));
  wallGeometry.setAttribute('aTop', new THREE.BufferAttribute(wt, 1));
  wallGeometry.setIndex(wi);
  wallGeometry.computeBoundingSphere();
  const walls = new THREE.Mesh(wallGeometry, makeMaterial(true));
  walls.name = 'sea-section';
  walls.renderOrder = 1;
  walls.frustumCulled = false;
  group.add(surface, walls);

  // --- 不透明な物の画像を画面に写す板（奥行きも書き戻す）
  const copyMaterial = new THREE.ShaderMaterial({
    name: 'sea-copy',
    uniforms: { tScene: uniforms.tScene, tDepth: uniforms.tDepth },
    vertexShader: COPY_VERTEX,
    fragmentShader: COPY_FRAGMENT,
    depthTest: true,
    depthWrite: true,
    depthFunc: THREE.AlwaysDepth,
  });
  const copyQuad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), copyMaterial);
  copyQuad.frustumCulled = false;
  copyQuad.renderOrder = -1;
  const overlay = new THREE.Scene();
  overlay.add(copyQuad, group);

  const size = new THREE.Vector2();
  const render = (r: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.PerspectiveCamera, time: number) => {
    r.getDrawingBufferSize(size);
    if (sceneTarget.width !== size.x || sceneTarget.height !== size.y) {
      sceneTarget.setSize(size.x, size.y);
      dirty = true;
    }
    if (dirty) {
      const prev = r.getRenderTarget();
      r.setRenderTarget(sceneTarget);
      r.render(scene, camera);
      r.setRenderTarget(prev);
      dirty = false;
    }
    camera.updateMatrixWorld();
    uniforms.uResolution.value.copy(size);
    uniforms.uProjInv.value.copy(camera.projectionMatrixInverse);
    uniforms.uCamWorld.value.copy(camera.matrixWorld);
    uniforms.uViewProj.value.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    uniforms.uTime.value = time;
    r.render(overlay, camera);
  };

  return {
    group,
    render,
    invalidate: () => {
      dirty = true;
    },
    updateShore: (source: ShoreSource) => shore.update(source),
  };
}
