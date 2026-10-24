import * as THREE from 'three';
import type { SceneConfig } from '../config';
import { directionFromAngles } from '../framing';
import type { TerrainLayout } from '../terrain/layout';
import type { TerrainMeshes } from '../terrain/mesh';
import { createFlowTexture, createShoreTexture, type ShoreRock } from './shore';
import { createWaveTexture } from './waveTexture';
import { COPY_FRAGMENT, COPY_VERTEX, FALL_FRAGMENT, FALL_VERTEX, WATER_FRAGMENT, WATER_VERTEX } from './shaders';

export interface Water {
  /** 水面・断面・滝（名前 'river-water'）。メインのシーンには入れず、render で重ねて描く */
  group: THREE.Group;
  /**
   * 1 コマ描く：不透明な物（土台・地面・岩・植物）を描いた画像（必要なときだけ描き直す）を画面に写し、
   * その上に水面・断面・滝を描く
   */
  render: (renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.PerspectiveCamera, time: number) => void;
  /** 不透明な物の画像を次のコマで描き直す */
  invalidate: () => void;
  /** 水面から出た岩が変わったときに、泡の位置を作り直す */
  updateShore: (rocks: ShoreRock[]) => void;
  /** 水を飲む恐竜の口元から広がる波紋（中心 x, z と半径）。強さ 0 で消す（既定では出さない。恐竜の模型を置いたときに使う） */
  setRing: (x: number, z: number, radius: number, strength: number) => void;
}

const color = (hex: string) => new THREE.Color(hex);
/** 滝つぼの泡を付ける滝の数の上限（シェーダーの配列の大きさと同じ） */
const MAX_FALLS = 6;

export function createWater(
  renderer: THREE.WebGLRenderer,
  config: SceneConfig,
  layout: TerrainLayout,
  meshes: TerrainMeshes,
  opts: {
    lowPower: boolean;
    /** 地面の上面に焼き込んだ影と、その範囲の一辺。水面の日陰と、水中の光の網目の影に使う */
    bake: { texture: THREE.Texture; size: number; height: THREE.Texture };
    rocks: ShoreRock[];
  },
): Water {
  const W = config.pedestal.size;
  const wc = config.water;
  const group = new THREE.Group();
  group.name = 'river-water';

  // --- 岸からの距離（泡）と流れ
  const shoreSize = W * 1.02;
  const shoreMax = 0.6 * (W / 10);
  const shore = createShoreTexture({
    size: shoreSize,
    resolution: opts.lowPower ? 384 : 640,
    maxDistance: shoreMax,
    layout,
    rocks: opts.rocks,
  });
  const flowTexture = createFlowTexture(layout, opts.bake.size, 256);

  const wl = wc.waves.wavelets;
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
  const dpr = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1;
  const samples = dpr > 1.5 ? 0 : Math.max(0, Math.floor(wc.msaa));
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

  // --- 水のマテリアル（水面と断面で共通）
  const key = config.lights.key;
  const sunDir = directionFromAngles(key.azimuth, key.elevation);
  const scatter = Math.log(2) / (wc.clarity * W);
  const falls = layout.falls;
  const uniforms = {
    tScene: { value: sceneTarget.texture as THREE.Texture },
    tDepth: { value: depthTexture as THREE.Texture },
    tShore: { value: shore.texture as THREE.Texture },
    tBake: { value: opts.bake.texture },
    tHeight: { value: opts.bake.height },
    tFlow: { value: flowTexture as THREE.Texture },
    uResolution: { value: new THREE.Vector2(1, 1) },
    uProjInv: { value: new THREE.Matrix4() },
    uCamWorld: { value: new THREE.Matrix4() },
    uViewProj: { value: new THREE.Matrix4() },
    uTime: { value: 0 },
    uShallow: { value: color(wc.colors.shallow) },
    uMid: { value: color(wc.colors.mid) },
    uDeep: { value: color(wc.colors.deep) },
    uColorDepths: { value: new THREE.Vector2(wc.colorDepths[0] * W, wc.colorDepths[1] * W) },
    uAbsorb: { value: new THREE.Vector3(...wc.absorption).multiplyScalar(scatter) },
    uScatter: { value: scatter },
    uSunDir: { value: sunDir },
    uSunColor: { value: color(key.color) },
    uHorizon: { value: color(wc.reflection.horizon) },
    uZenith: { value: color(wc.reflection.zenith) },
    uReflect: { value: wc.reflection.strength },
    uGlint: { value: wc.reflection.glint },
    uRefraction: { value: wc.refraction },
    uWallClarity: { value: wc.wallClarity },
    uWallClear: { value: wc.wallClear * W },
    uWallHaze: { value: wc.wallHaze },
    uWallTint: { value: color(wc.wallTint) },
    uWallReflect: { value: wc.wallReflection },
    uSheen: { value: wc.waves.sheen },
    uRipple: { value: new THREE.Vector2(wc.waves.ripple, 1 / (wc.waves.rippleSize * W)) },
    tWaves: { value: waveTexture as THREE.Texture },
    uWaveTex: { value: new THREE.Vector4(wl.strength, 1 / (wl.tile * W), wl.speed, 0) },
    uFlowSpeed: { value: 0.35 * (W / 10) },
    uFoamScale: { value: 1 / (wc.foam.cell * W) },
    uShoreSize: { value: shoreSize },
    uShoreMax: { value: shoreMax },
    uFoam: { value: new THREE.Vector3(wc.foam.width * W, wc.foam.amount, wc.foam.speed) },
    uCaustic: {
      value: new THREE.Vector4(wc.caustics.strength, 1 / (wc.caustics.size * W), wc.caustics.speed, wc.caustics.fadeDepth * W),
    },
    uBakeSize: { value: opts.bake.size },
    uRim: { value: new THREE.Vector2(wc.rim.width * W, wc.rim.strength) },
    uWallGrad: {
      value: new THREE.Vector4(wc.wallGradient.range[0], wc.wallGradient.range[1], 1 / (wc.wallGradient.noiseSize * W), wc.wallGradient.unevenness),
    },
    uWallGradPath: { value: wc.wallGradient.path * W },
    uWallTopColor: { value: color(wc.wallGradient.topColor) },
    uWallGradMisc: { value: new THREE.Vector3(wc.wallGradient.strength, wc.wallGradient.near[0], wc.wallGradient.near[1] * W) },
    // 滝つぼ：滝の下の位置（滝から下流へ少し進んだ所）と泡の範囲の半径
    uFalls: {
      value: Array.from({ length: MAX_FALLS }, (_, i) => {
        const f = falls[i];
        if (!f) return new THREE.Vector4(0, 0, 0, 0);
        return new THREE.Vector4(f.x + f.tx * 0.1, f.z + f.tz * 0.1, 0, f.width * 0.7);
      }),
    },
    uFallDirs: { value: Array.from({ length: MAX_FALLS }, (_, i) => new THREE.Vector2(falls[i]?.tx ?? 0, falls[i]?.tz ?? 1)) },
    uRing: { value: new THREE.Vector4(0, 0, 1, 0) },
  };
  const makeMaterial = (wall: boolean) =>
    new THREE.ShaderMaterial({
      name: wall ? 'river-section' : 'river-surface',
      uniforms,
      vertexShader: WATER_VERTEX,
      fragmentShader: WATER_FRAGMENT,
      defines: wall ? { WATER_WALL: '' } : {},
      side: THREE.FrontSide,
    });

  // --- 水面：地面の上面と同じ格子のうち、水の中の所。水面の高さが違う所（滝）では頂点を分ける
  const n = meshes.n;
  const topPos = meshes.top.attributes.position.array as Float32Array;
  const level = meshes.water;
  const ringSet = new Set<number>();
  {
    for (let i = 0; i <= n; i++) {
      ringSet.add(i);
      ringSet.add(i + n * (n + 1));
      ringSet.add(i * (n + 1));
      ringSet.add(n + i * (n + 1));
    }
  }
  const vertexMap = new Map<number, number>();
  const sPos: number[] = [];
  const sIdx: number[] = [];
  const bevel = meshes.bevel;
  const half = layout.half - bevel;
  const vert = (k: number, L: number) => {
    const li = layout.levels.findIndex((v) => Math.abs(v - L) < 1e-3);
    const key = k * 4 + Math.max(li, 0);
    let v = vertexMap.get(key);
    if (v === undefined) {
      let x = topPos[k * 3];
      let z = topPos[k * 3 + 2];
      // 外周の頂点は、断面の上端（外形の上）まで延ばす
      if (ringSet.has(k)) {
        const c = half - (layout.cornerRadius - bevel);
        const ax = Math.abs(x);
        const az = Math.abs(z);
        let ox = 0;
        let oz = 0;
        if (ax > c - 1e-6 && az > c - 1e-6) {
          const dx = ax - c;
          const dz = az - c;
          const l = Math.hypot(dx, dz) || 1;
          ox = (Math.sign(x) * dx) / l;
          oz = (Math.sign(z) * dz) / l;
        } else if (ax - c > az - c) ox = Math.sign(x);
        else oz = Math.sign(z);
        x += ox * bevel;
        z += oz * bevel;
      }
      v = sPos.length / 3;
      sPos.push(x, L, z);
      vertexMap.set(key, v);
    }
    return v;
  };
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const a = i + j * (n + 1);
      const b = a + 1;
      const c = a + (n + 1);
      const d = c + 1;
      const La = level[a];
      if (!Number.isFinite(La) || level[b] !== La || level[c] !== La || level[d] !== La) continue;
      // いずれかの頂点が水面より下なら水面を張る（地面が上に出ている所は、奥行きで隠れる）
      const minH = Math.min(topPos[a * 3 + 1], topPos[b * 3 + 1], topPos[c * 3 + 1], topPos[d * 3 + 1]);
      if (minH > La + 0.002) continue;
      const va = vert(a, La);
      const vb = vert(b, La);
      const vc = vert(c, La);
      const vd = vert(d, La);
      sIdx.push(va, vc, vb, vb, vc, vd);
    }
  }
  const surfaceGeometry = new THREE.BufferGeometry();
  surfaceGeometry.setAttribute('position', new THREE.Float32BufferAttribute(sPos, 3));
  surfaceGeometry.setIndex(sIdx);
  surfaceGeometry.computeBoundingSphere();
  const surface = new THREE.Mesh(surfaceGeometry, makeMaterial(false));
  surface.name = 'river-surface';
  surface.renderOrder = 1;
  surface.frustumCulled = false;

  // --- 断面：外周のうち、川底が水面より下の所（手前と奥）。川底から水面まで
  const rim = meshes.rim;
  const m = rim.length;
  const wPos: number[] = [];
  const wNor: number[] = [];
  const wLevel: number[] = [];
  const wBed: number[] = [];
  const wIdx: number[] = [];
  for (let r = 0; r < m; r++) {
    const A = rim[r];
    const B = rim[(r + 1) % m];
    const LA = Number.isFinite(A.water) ? A.water : -Infinity;
    const LB = Number.isFinite(B.water) ? B.water : -Infinity;
    const L = Math.max(LA, LB);
    if (!Number.isFinite(L)) continue;
    if (A.top >= L && B.top >= L) continue;
    const base = wPos.length / 3;
    for (const P of [A, B]) {
      const bot = Math.min(P.top, L);
      // わずかに外へ出して、切り口の面と重ならないように
      const x = P.x + P.nx * 0.002;
      const z = P.z + P.nz * 0.002;
      wPos.push(x, bot, z, x, L, z);
      wNor.push(P.nx, 0, P.nz, P.nx, 0, P.nz);
      wLevel.push(L, L);
      wBed.push(Math.min(P.top, L), Math.min(P.top, L));
    }
    // 外向きの面（外周の切り口と同じ向き）
    wIdx.push(base + 1, base + 3, base, base, base + 3, base + 2);
  }
  const wallGeometry = new THREE.BufferGeometry();
  wallGeometry.setAttribute('position', new THREE.Float32BufferAttribute(wPos, 3));
  wallGeometry.setAttribute('normal', new THREE.Float32BufferAttribute(wNor, 3));
  wallGeometry.setAttribute('aLevel', new THREE.Float32BufferAttribute(wLevel, 1));
  wallGeometry.setAttribute('aBed', new THREE.Float32BufferAttribute(wBed, 1));
  wallGeometry.setIndex(wIdx);
  wallGeometry.computeBoundingSphere();
  const walls = new THREE.Mesh(wallGeometry, makeMaterial(true));
  walls.name = 'river-section';
  walls.renderOrder = 1;
  walls.frustumCulled = false;
  group.add(surface, walls);

  // --- 滝の水の幕：滝の線（流れに直交）から下の水面まで、前へ弧を描いて落ちる
  const fallMaterial = new THREE.ShaderMaterial({
    name: 'river-fall',
    uniforms: {
      uTime: uniforms.uTime,
      uSunDir: uniforms.uSunDir,
      uSunColor: { value: color(key.color).multiplyScalar(key.intensity * 0.32) },
      uWaterColor: { value: color('#7fd8d2') },
      uAmbient: { value: color('#cfe6e4').multiplyScalar(0.55) },
      tBake: uniforms.tBake,
      uBakeSize: uniforms.uBakeSize,
    },
    vertexShader: FALL_VERTEX,
    fragmentShader: FALL_FRAGMENT,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  falls.forEach((f, fi) => {
    const U = 14;
    const Vn = 10;
    const pos: number[] = [];
    const nor: number[] = [];
    const uv: number[] = [];
    const idx: number[] = [];
    const lat = new THREE.Vector2(-f.tz, f.tx);
    // 水は落ち口の両脇の岩のあいだを落ちる（川幅より狭い幕。滝ごとに幅と位置を少し変える）
    const jitter = Math.sin(fi * 12.9898 + 4.1) * 0.5;
    const w = f.width * 0.5 * config.rocks.cascade.curtain * (0.92 + 0.16 * jitter);
    const shift = f.width * 0.06 * Math.sin(fi * 7.31 + 1.7);
    const drop = f.top - f.bottom;
    const throwDist = 0.06 + 0.18 * drop;
    for (let j = 0; j <= Vn; j++) {
      const v = j / Vn;
      for (let i = 0; i <= U; i++) {
        const u = i / U;
        const s = (u - 0.5) * 2;
        // 横は少しふくらみ（中央ほど前へ出る）、縦は放物線（はじめゆっくり前へ、下へ行くほど垂直に）
        const bulge = 0.04 * (1 - s * s);
        const fwd = throwDist * Math.sqrt(v) + bulge - 0.02;
        const x = f.x + lat.x * (s * w + shift) + f.tx * fwd;
        const z = f.z + lat.y * (s * w + shift) + f.tz * fwd;
        const y = f.top + 0.004 - (drop + 0.03) * v;
        pos.push(x, y, z);
        // 法線：前向き（流れの向き）と上向きの間
        const nn = new THREE.Vector3(f.tx, 0.35 * (1 - v), f.tz).normalize();
        nor.push(nn.x, nn.y, nn.z);
        uv.push(u, v);
      }
    }
    for (let j = 0; j < Vn; j++) {
      for (let i = 0; i < U; i++) {
        const a = i + j * (U + 1);
        const b = a + 1;
        const c = a + U + 1;
        const d = c + 1;
        idx.push(a, c, b, b, c, d);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
    g.setAttribute('aFall', new THREE.Float32BufferAttribute(uv, 2));
    g.setIndex(idx);
    g.computeBoundingSphere();
    const mesh = new THREE.Mesh(g, fallMaterial);
    mesh.name = 'river-fall';
    mesh.renderOrder = 2;
    mesh.frustumCulled = false;
    group.add(mesh);
  });

  // --- 不透明な物の画像を画面に写す板（奥行きも書き戻す）
  const copyMaterial = new THREE.ShaderMaterial({
    name: 'river-copy',
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
    updateShore: (rocks) => shore.update(rocks),
    setRing: (x, z, radius, strength) => uniforms.uRing.value.set(x, z, radius, strength),
  };
}
