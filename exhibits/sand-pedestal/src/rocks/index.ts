import * as THREE from 'three';
import type { SceneConfig } from '../config';
import type { IslandMeshData } from '../island/buildGeometry';
import { createRockMaterial } from '../island/rockMaterial';
import { createBakeTarget, type PointReceiver } from '../lightBaker';
import { createRockTemplates, type RockTemplate } from './templates';
import { placeRocks, type RockInstance } from './placement';

export interface Rocks {
  /** 岩・海底の緑の岩・小石・砂利をまとめたグループ（名前 'rocks'）。表示の切り替えは main.ts の setRocksVisible で */
  group: THREE.Group;
  /** 影の計算に使う形（シーンには入れない） */
  casters: THREE.Mesh[];
  /** 受ける光（影）を焼き込む点：主要な岩は間引いた頂点ごと、小石と砂利は1つずつ */
  receivers: PointReceiver[];
  /** 地表の細かな砂利の密度（砂のマテリアルで使う。台座の上面全体を覆う） */
  groundDensity: THREE.DataTexture;
  /** 主要な岩と小石の位置・横幅の半分・底と上端の高さ（水面から出る岩のまわりに泡を付けるのに使う） */
  footprints: { x: number; z: number; radius: number; bottom: number; top: number }[];
  counts: Record<string, number>;
  timings: Record<string, number>;
}

/**
 * 岩・海底の緑の岩・小石・砂利を作る。
 *  - 水際の岩と緑の岩：ひな形を拡大・回転して、それぞれ1つのメッシュに結合（頂点ごとに影を焼き込み、岩ごとに色と苔）
 *  - 小石・砂利：ひな形ごとの InstancedMesh（影の当たり具合はインスタンスごと）
 *  - 影を落とす形：岩と小石の粗い形を1つのメッシュに結合（砂利は影を落とさない）
 * 岩肌は崖と同じ岩質のマテリアル（まだら・割れ目・ざらつきのバンプ）で、色は濃い灰褐色。
 * 緑の岩は同じ形に、海藻やサンゴに覆われた緑のまだらを塗る。
 */
export function createRocks(
  renderer: THREE.WebGLRenderer,
  config: SceneConfig,
  island: IslandMeshData | null,
  /** 地面（砂浜・海底）の高さ */
  groundY: (x: number, z: number) => number,
  /** 水面の高さと深場らしさ・砂浜（海があるとき）。水の中の部分に藻の色を付ける */
  water: { level: number; deepAt: (x: number, z: number) => number; beachAt: (x: number, z: number) => number } | null,
  /** 海底・砂浜の高さのテクスチャ（岩の根元を砂の色にするのに使う） */
  ground?: { texture: THREE.Texture; size: number },
): Rocks {
  const cfg = config.rocks;
  const timings: Record<string, number> = {};
  let t0 = performance.now();
  const lib = createRockTemplates(cfg.seed);
  timings.templates = performance.now() - t0;
  t0 = performance.now();
  const layout = placeRocks(
    cfg,
    { size: config.pedestal.size, cornerRadius: config.pedestal.cornerRadius },
    island,
    lib,
    groundY,
    water ?? { level: -1e9, deepAt: () => 0, beachAt: () => 0 },
  );
  timings.placement = performance.now() - t0;
  t0 = performance.now();

  const m = config.island;
  const unit = config.pedestal.size / 10;
  const baseOptions = {
    colors: cfg.colors,
    roughness: 1,
    surface: cfg.surface,
    aoMin: m.ao.min,
    shadeTint: cfg.shadeTint,
    shadowStrength: config.shadow.strength,
    unit,
    seed: m.seed,
  };
  const underwater = water ? { level: water.level, color: config.sea.algae.color, amount: config.sea.algae.amount } : undefined;
  const sl = cfg.sandLine;
  const sandLine = ground
    ? { texture: ground.texture, size: ground.size, color: sl.color, height: sl.height * config.pedestal.size, strength: sl.strength }
    : undefined;
  const majorMat = createRockMaterial({
    ...baseOptions,
    variant: {
      offsetPattern: true,
      skyBake: true,
      moss: cfg.moss,
      vertexColors: true,
      cavity: cfg.cavity,
      fillScale: cfg.fillScale,
      bakePair: true,
      underwater,
      // 水の中の部分に印（島の土台と同じ扱い）：水の側面から見て、土台の上に載った岩だけが浮いて見えないように
      waterMask: true,
      sandLine,
    },
  });
  // 小石：水の中の藻は控えめ（灰緑色）
  const stoneMat = createRockMaterial({
    ...baseOptions,
    variant: {
      instanced: true,
      offsetPattern: true,
      skyBake: true,
      cavity: cfg.cavity,
      fillScale: cfg.fillScale,
      underwater: underwater
        ? { ...underwater, color: cfg.pebbleAlgaeColor, amount: underwater.amount * cfg.pebbleAlgae, brightness: cfg.pebbleBrightness }
        : undefined,
      sandLine: sandLine ? { ...sandLine, height: sandLine.height * 0.35 } : undefined,
    },
  });

  const group = new THREE.Group();
  group.name = 'rocks';
  const casters: THREE.Mesh[] = [];
  const receivers: PointReceiver[] = [];
  const counts: Record<string, number> = { major: 0, coral: 0, small: 0, gravel: 0 };
  for (const r of layout.instances) counts[r.cls]++;

  // ===== 主要な岩：ひな形を結合した1つのメッシュ =====
  const majors = layout.instances.filter((r) => r.cls === 'major');
  if (majors.length > 0) {
    const merged = mergeRocks(
      majors.map((r) => ({ r, geometry: lib.large[r.index].geometry, coarse: lib.large[r.index].coarse })),
      1024,
    );
    const geometry = merged.geometry;
    const mesh = new THREE.Mesh(geometry, majorMat.material);
    mesh.name = 'rocks-major';
    group.add(mesh);
    const target = createBakeTarget(renderer, merged.bakeWidth, merged.bakeHeight);
    target.texture.minFilter = THREE.NearestFilter;
    target.texture.magFilter = THREE.NearestFilter;
    majorMat.setBake(target.texture);
    // 光を調べるのは間引いた頂点だけ（残りの頂点は近くの2点の平均を使う）
    receivers.push({ target, geometry: merged.receiver!, matrixWorld: new THREE.Matrix4(), normalOffset: 0.02 * unit });
    // 影の計算用：粗い形を結合
    const proxy = mergeRocks(
      majors.map((r) => ({ r, geometry: lib.large[r.index].proxy! })),
      null,
    );
    casters.push(new THREE.Mesh(proxy.geometry));
  }

  // ===== 海底の緑の岩：主要な岩と同じ作り方で、緑のまだらのマテリアル =====
  const corals = layout.instances.filter((r) => r.cls === 'coral');
  if (corals.length > 0) {
    const cc = cfg.coralColors;
    const coralMat = createRockMaterial({
      ...baseOptions,
      colors: {
        ivory: cc.light,
        beige: cc.base,
        lightBrown: new THREE.Color(cc.base).lerp(new THREE.Color(cc.dark), 0.4).getStyle(),
        grayBrown: cc.dark,
        cavity: new THREE.Color(cc.dark).multiplyScalar(0.55).getStyle(),
      },
      shadeTint: cfg.coralShadeTint,
      aoMin: cfg.coralShade.aoMin,
      surface: cfg.coralSurface,
      variant: {
        offsetPattern: true,
        skyBake: true,
        moss: cc.light,
        vertexColors: true,
        aoStrength: cfg.coralShade.skyAo,
        cavity: cfg.coralCavity,
        fillScale: cfg.fillScale,
        bakePair: true,
        sandLine,
      },
    });
    const merged = mergeRocks(
      corals.map((r) => ({ r, geometry: lib.coral[r.index].geometry, coarse: lib.coral[r.index].coarse })),
      1024,
    );
    const mesh = new THREE.Mesh(merged.geometry, coralMat.material);
    mesh.name = 'rocks-coral';
    group.add(mesh);
    const target = createBakeTarget(renderer, merged.bakeWidth, merged.bakeHeight);
    target.texture.minFilter = THREE.NearestFilter;
    target.texture.magFilter = THREE.NearestFilter;
    coralMat.setBake(target.texture);
    receivers.push({ target, geometry: merged.receiver!, matrixWorld: new THREE.Matrix4(), normalOffset: 0.02 * unit });
    casters.push(new THREE.Mesh(mergeRocks(corals.map((r) => ({ r, geometry: lib.coral[r.index].proxy! })), null).geometry));
  }

  // ===== 小石・砂利：ひな形ごとの InstancedMesh =====
  const stones = layout.instances.filter((r) => r.cls === 'small' || r.cls === 'gravel');
  const probeBakeWidth = 512;
  const probeBakeHeight = Math.max(1, Math.ceil(stones.length / probeBakeWidth));
  const probeTarget = createBakeTarget(renderer, probeBakeWidth, probeBakeHeight);
  probeTarget.texture.minFilter = THREE.NearestFilter;
  probeTarget.texture.magFilter = THREE.NearestFilter;
  stoneMat.setBake(probeTarget.texture);
  const probePos = new Float32Array(stones.length * 3);
  const probeNor = new Float32Array(stones.length * 3);
  const probeUv = new Float32Array(stones.length * 2);
  let slot = 0;
  // 小石の影の形（ひな形の粗い形を少し小さくしたもの）。まとめて1つのメッシュにする
  // （InstancedMesh のまま影の計算に使うと、ソフトウェア描画で焼き込みが大幅に遅くなる）
  const shadowItems: { r: RockInstance; geometry: THREE.BufferGeometry }[] = [];
  const shadowShapes = lib.small.map((tpl) => {
    if (!tpl.proxy) return null;
    const g = tpl.proxy.clone();
    g.scale(cfg.smallShadowScale, cfg.smallShadowScale, cfg.smallShadowScale);
    return g;
  });
  for (const cls of ['small', 'gravel'] as const) {
    lib[cls].forEach((tpl, idx) => {
      const list = stones.filter((r) => r.cls === cls && r.index === idx);
      if (list.length === 0) return;
      const n = list.length;
      const inst = new THREE.InstancedMesh(tpl.geometry, stoneMat.material, n);
      inst.name = `rocks-${cls}-${idx}`;
      const uv = new Float32Array(n * 2);
      list.forEach((r, i) => {
        inst.setMatrixAt(i, r.matrix);
        inst.setColorAt(i, r.tint);
        const s = slot++;
        uv[i * 2] = ((s % probeBakeWidth) + 0.5) / probeBakeWidth;
        uv[i * 2 + 1] = (Math.floor(s / probeBakeWidth) + 0.5) / probeBakeHeight;
        probeUv[s * 2] = uv[i * 2];
        probeUv[s * 2 + 1] = uv[i * 2 + 1];
        // 光を調べる点：岩の上端の少し上
        probePos[s * 3] = r.x;
        probePos[s * 3 + 1] = r.top + 0.015 * unit;
        probePos[s * 3 + 2] = r.z;
        probeNor[s * 3 + 1] = 1;
      });
      tpl.geometry.setAttribute('instanceBakeUv', new THREE.InstancedBufferAttribute(uv, 2));
      inst.instanceMatrix.needsUpdate = true;
      if (inst.instanceColor) inst.instanceColor.needsUpdate = true;
      inst.computeBoundingSphere();
      group.add(inst);
      // 小石の影：形を少し小さくして、黒い点のように目立たせない。砂利は影を落とさない
      const shape = cls === 'small' ? shadowShapes[idx] : null;
      if (shape) for (const r of list) shadowItems.push({ r, geometry: shape });
    });
  }
  if (shadowItems.length > 0) casters.push(new THREE.Mesh(mergeRocks(shadowItems, null).geometry));
  if (stones.length > 0) {
    const points = new THREE.BufferGeometry();
    points.setAttribute('position', new THREE.BufferAttribute(probePos, 3));
    points.setAttribute('normal', new THREE.BufferAttribute(probeNor, 3));
    points.setAttribute('bakeUv', new THREE.BufferAttribute(probeUv, 2));
    receivers.push({ target: probeTarget, geometry: points, matrixWorld: new THREE.Matrix4(), normalOffset: 0.01 * unit });
  }
  group.updateMatrixWorld(true);

  // ===== 地表の細かな砂利の密度（台座の上面の範囲） =====
  const res = 256;
  const data = new Uint8Array(res * res * 4);
  const size = config.pedestal.size;
  for (let j = 0; j < res; j++) {
    for (let i = 0; i < res; i++) {
      const x = ((i + 0.5) / res - 0.5) * size;
      const z = ((j + 0.5) / res - 0.5) * size;
      // 小石が密集する所にだけ（何もない砂地には描かない）
      const d = THREE.MathUtils.smoothstep(layout.density(x, z), 0.4, 1.6) * 0.5 * cfg.groundGravel;
      const k = (i + j * res) * 4;
      data[k] = Math.round(THREE.MathUtils.clamp(d, 0, 1) * 255);
      data[k + 3] = 255;
    }
  }
  const groundDensity = new THREE.DataTexture(data, res, res, THREE.RGBAFormat);
  groundDensity.magFilter = THREE.LinearFilter;
  groundDensity.minFilter = THREE.LinearFilter;
  groundDensity.needsUpdate = true;
  timings.meshes = performance.now() - t0;

  const footprints = layout.instances
    .filter((r) => r.cls === 'major' || r.cls === 'small')
    .map((r) => ({ x: r.x, z: r.z, radius: r.radius, bottom: r.matrix.elements[13], top: r.top }));
  return { group, casters, receivers, groundDensity, footprints, counts, timings };
}

/**
 * 岩をひな形から結合する（位置・法線・陰影・くぼみ・色・苔・模様のずれ）。
 * bakeWidth を指定すると、影を焼き込む点（receiver）と、頂点ごとにその値を読む位置（bakeUv・bakeUv2）も作る。
 * coarse があるひな形は、粗い細分の頂点だけを焼き込み、ほかの頂点は辺の両端の2点の平均を読む。
 */
function mergeRocks(
  items: { r: RockInstance; geometry: THREE.BufferGeometry; coarse?: RockTemplate['coarse'] }[],
  bakeWidth: number | null,
) {
  let total = 0;
  let indexTotal = 0;
  let bakeTotal = 0;
  for (const { geometry, coarse } of items) {
    total += geometry.attributes.position.count;
    indexTotal += geometry.index!.count;
    bakeTotal += coarse ? coarse.count : geometry.attributes.position.count;
  }
  const pos = new Float32Array(total * 3);
  const nor = new Float32Array(total * 3);
  const ao = new Float32Array(total);
  const cav = new Float32Array(total);
  const col = new Float32Array(total * 3);
  const moss = new Float32Array(total);
  const off = new Float32Array(total * 3);
  const uvA = new Float32Array(total * 2);
  const uvB = new Float32Array(total * 2);
  const index = new Uint32Array(indexTotal);
  const width = bakeWidth ?? 1;
  const bakeHeight = Math.max(1, Math.ceil(bakeTotal / width));
  const rPos = new Float32Array(bakeTotal * 3);
  const rNor = new Float32Array(bakeTotal * 3);
  const rUv = new Float32Array(bakeTotal * 2);
  const slotU = (slot: number) => ((slot % width) + 0.5) / width;
  const slotV = (slot: number) => (Math.floor(slot / width) + 0.5) / bakeHeight;
  const v = new THREE.Vector3();
  const nm = new THREE.Matrix3();
  let vo = 0;
  let io = 0;
  let so = 0;
  items.forEach(({ r, geometry: g, coarse }, rockIndex) => {
    const P = g.attributes.position;
    const N = g.attributes.normal;
    const A = g.attributes.rockAo as THREE.BufferAttribute | undefined;
    const C = g.attributes.rockCav as THREE.BufferAttribute | undefined;
    const count = coarse ? coarse.count : P.count;
    nm.getNormalMatrix(r.matrix);
    // 岩ごとに模様の位置をずらす
    const ox = ((rockIndex * 37.17) % 53) + 3.1;
    const oy = ((rockIndex * 19.73) % 41) + 7.7;
    const oz = ((rockIndex * 29.31) % 47) + 1.3;
    for (let i = 0; i < P.count; i++) {
      const k = vo + i;
      v.fromBufferAttribute(P, i).applyMatrix4(r.matrix);
      v.toArray(pos, k * 3);
      if (i < count) v.toArray(rPos, (so + i) * 3);
      v.fromBufferAttribute(N, i).applyMatrix3(nm).normalize();
      v.toArray(nor, k * 3);
      if (i < count) v.toArray(rNor, (so + i) * 3);
      ao[k] = A ? A.getX(i) : 1;
      cav[k] = C ? C.getX(i) : 0;
      col[k * 3] = r.tint.r;
      col[k * 3 + 1] = r.tint.g;
      col[k * 3 + 2] = r.tint.b;
      moss[k] = r.moss;
      off[k * 3] = ox;
      off[k * 3 + 1] = oy;
      off[k * 3 + 2] = oz;
      const pa = so + (coarse ? coarse.parents[i * 2] : i);
      const pb = so + (coarse ? coarse.parents[i * 2 + 1] : i);
      uvA[k * 2] = slotU(pa);
      uvA[k * 2 + 1] = slotV(pa);
      uvB[k * 2] = slotU(pb);
      uvB[k * 2 + 1] = slotV(pb);
      if (i < count) {
        rUv[(so + i) * 2] = slotU(so + i);
        rUv[(so + i) * 2 + 1] = slotV(so + i);
      }
    }
    const I = g.index!;
    for (let i = 0; i < I.count; i++) index[io + i] = I.getX(i) + vo;
    vo += P.count;
    io += I.count;
    so += count;
  });
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geometry.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  geometry.setIndex(new THREE.BufferAttribute(index, 1));
  geometry.computeBoundingSphere();
  geometry.computeBoundingBox();
  if (bakeWidth === null) return { geometry, receiver: null, bakeWidth: width, bakeHeight };
  geometry.setAttribute('rockAo', new THREE.BufferAttribute(ao, 1));
  geometry.setAttribute('rockCav', new THREE.BufferAttribute(cav, 1));
  geometry.setAttribute('color', new THREE.BufferAttribute(col, 3));
  geometry.setAttribute('aMoss', new THREE.BufferAttribute(moss, 1));
  geometry.setAttribute('aRkOffset', new THREE.BufferAttribute(off, 3));
  geometry.setAttribute('bakeUv', new THREE.BufferAttribute(uvA, 2));
  geometry.setAttribute('bakeUv2', new THREE.BufferAttribute(uvB, 2));
  const receiver = new THREE.BufferGeometry();
  receiver.setAttribute('position', new THREE.BufferAttribute(rPos, 3));
  receiver.setAttribute('normal', new THREE.BufferAttribute(rNor, 3));
  receiver.setAttribute('bakeUv', new THREE.BufferAttribute(rUv, 2));
  return { geometry, receiver, bakeWidth: width, bakeHeight };
}
