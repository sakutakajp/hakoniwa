import * as THREE from 'three';
import type { SceneConfig } from '../config';
import { Noise, mulberry32 } from '../noise';
import { createBakeTarget, type PointReceiver } from '../lightBaker';
import { roundedSquareInside, type TerrainLayout } from '../terrain/layout';
import { createRockMaterial } from './rockMaterial';
import { createRockTemplates, type RockTemplate } from './templates';
import type { ShoreRock } from '../river/shore';

export interface Rocks {
  /** 岩・川底の岩・小石をまとめたグループ（名前 'rocks'） */
  group: THREE.Group;
  /** 影の計算に使う形（シーンには入れない） */
  casters: THREE.Mesh[];
  /** 受ける光（影）を焼き込む点 */
  receivers: PointReceiver[];
  /** 水面から顔を出す岩（泡を付ける） */
  footprints: ShoreRock[];
  /** 岩の位置と大きさ（植物を置かない所） */
  disks: { x: number; z: number; r: number }[];
  counts: Record<string, number>;
}

interface Placed {
  matrix: THREE.Matrix4;
  x: number;
  z: number;
  radius: number;
  top: number;
  bottom: number;
  tint: THREE.Color;
  moss: number;
}

const smoothstep = (a: number, b: number, v: number) => {
  const t = THREE.MathUtils.clamp((v - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};

/**
 * 岩を作る。
 *  - 岸と地面の大きな岩：明るい灰褐色の丸い岩（参考画像から 1 つずつ置く）
 *  - 水の中から顔を出す岩：濡れた茶色の岩（水面から上に出す）
 *  - 川底の苔むした岩：暗いオリーブの塊（手前の淵の断面と水面越しに見える）
 *  - 小石：水際・砂浜・川底・岩のまわりに散らす
 * 大きな岩は 1 つのメッシュに結合して頂点ごとに影を焼き込み、小石はひな形ごとの InstancedMesh。
 */
export function createRocks(
  renderer: THREE.WebGLRenderer,
  config: SceneConfig,
  layout: TerrainLayout,
  ground: { texture: THREE.Texture; size: number },
): Rocks {
  const cfg = config.rocks;
  const unit = config.pedestal.size / 10;
  const lib = createRockTemplates(cfg.seed);
  const rnd = mulberry32(cfg.seed * 7 + 3);
  const noise = new Noise(cfg.seed * 13 + 5);
  const half = layout.half;
  const radius = layout.cornerRadius;
  const edgeMargin = 0.17 * unit;
  const levelDown = layout.levels[layout.levels.length - 1];

  const tmpQ = new THREE.Quaternion();
  const tilt = new THREE.Quaternion();
  const up = new THREE.Vector3(0, 1, 0);
  const tmpV = new THREE.Vector3();
  const bottomRings = new Map<RockTemplate, THREE.Vector3[]>();
  const bottomRing = (tpl: RockTemplate) => {
    let ring = bottomRings.get(tpl);
    if (!ring) {
      ring = [];
      const P = tpl.geometry.attributes.position;
      const limit = tpl.height * 0.06;
      for (let i = 0; i < P.count; i++) if (P.getY(i) < limit) ring.push(new THREE.Vector3().fromBufferAttribute(P, i));
      bottomRings.set(tpl, ring);
    }
    return ring;
  };
  const groundAt = (x: number, z: number) => layout.heightAt(x, z);

  /** 岩を 1 つ置く（底を地面に埋め、傾けた底の縁も浮かないように） */
  const place = (
    tpl: RockTemplate,
    x: number,
    z: number,
    width: number,
    yawDeg: number,
    tiltDeg: number,
    sinkRange: readonly [number, number],
    tint: THREE.Color,
    moss: number,
    minTop?: number,
  ): Placed => {
    let squash = 1;
    const h0 = tpl.height * width;
    const sink = THREE.MathUtils.lerp(sinkRange[0], sinkRange[1], rnd());
    tmpQ.setFromAxisAngle(up, THREE.MathUtils.degToRad(yawDeg));
    const ta = THREE.MathUtils.degToRad(tiltDeg);
    tilt.setFromEuler(new THREE.Euler((rnd() - 0.5) * 2 * ta, 0, (rnd() - 0.5) * 2 * ta));
    tmpQ.premultiply(tilt);
    const g = Math.min(groundAt(x, z), groundAt(x + 0.3 * width, z), groundAt(x - 0.3 * width, z), groundAt(x, z + 0.3 * width), groundAt(x, z - 0.3 * width));
    // 水面から出す岩：川底が深くて届かないときは、縦に伸ばして水面から出す
    if (minTop !== undefined) {
      const base = g - sink * h0;
      // 伸ばしすぎると柱のように見えるので、1.5 倍まで（届かない岩は水の中に沈めたまま）
      if (base + h0 < minTop) squash = Math.min(1.5, (minTop - base) / h0);
    }
    const scale = new THREE.Vector3(width, width * squash, width);
    const h = h0 * squash;
    let edge = -Infinity;
    for (const p of bottomRing(tpl)) {
      tmpV.copy(p).multiply(scale).applyQuaternion(tmpQ);
      edge = Math.max(edge, tmpV.y + g - groundAt(x + tmpV.x, z + tmpV.z));
    }
    const depth = Math.max(sink * h, Number.isFinite(edge) ? edge + 0.04 * h : 0);
    const pos = new THREE.Vector3(x, g - depth, z);
    let top = -Infinity;
    const P = tpl.geometry.attributes.position;
    for (let i = 0; i < P.count; i += 5) {
      tmpV.fromBufferAttribute(P, i).multiply(scale).applyQuaternion(tmpQ);
      top = Math.max(top, tmpV.y);
    }
    const matrix = new THREE.Matrix4().compose(pos, tmpQ.clone(), scale);
    return { matrix, x, z, radius: tpl.radius * width, top: pos.y + top, bottom: pos.y, tint, moss };
  };
  /** 台座の縁から離す（はみ出す岩は内側へずらす） */
  const keepInside = (x: number, z: number, r: number): [number, number] => {
    for (let i = 0; i < 20 && roundedSquareInside(x, z, half, radius) < r + edgeMargin; i++) {
      x -= Math.sign(x) * 0.03 * Math.min(1, Math.abs(x) / 3);
      z -= Math.sign(z) * 0.03 * Math.min(1, Math.abs(z) / 3);
    }
    return [x, z];
  };
  const tintAt = (x: number, z: number, amount = 1) => {
    const n1 = noise.fbm2(x * 0.7 + 2.1, z * 0.7 - 7.3, 2);
    return new THREE.Color(1, 1, 1).multiplyScalar(1 + amount * (0.12 * n1 + 0.1 * (rnd() - 0.5)));
  };

  const boulders: (Placed & { tpl: RockTemplate })[] = [];
  for (const [x0, z0, size, shape, yaw, moss] of cfg.boulders) {
    // 大きな岩はなめらかな丸い岩、小さな岩は割れた岩片も混ぜる
    const tpl = size >= 0.4 ? lib.boulders[shape % lib.boulders.length] : lib.large[shape % lib.large.length];
    const [x, z] = keepInside(x0, z0, tpl.radius * size);
    boulders.push({ ...place(tpl, x, z, size, yaw, 5, cfg.sink, tintAt(x, z), moss), tpl });
  }
  // 滝のまわりの岩：落ち口の両脇（水はそのあいだを落ちる）と、滝つぼの脇
  {
    const cc = cfg.cascade;
    const near = (x: number, z: number, r: number) => boulders.some((b) => Math.hypot(b.x - x, b.z - z) < (b.radius + r) * 0.7);
    layout.falls.forEach((f, i) => {
      const nx = f.tz;
      const nz = -f.tx;
      const hw = f.width / 2;
      const main = i === layout.falls.length - 1 ? 1.25 : 1;
      for (const side of [-1, 1]) {
        // 落ち口の両脇：内側の縁が水の幕の端に来るように
        const size = cc.lip * main * (0.85 + 0.35 * rnd());
        const tpl = lib.boulders[Math.floor(rnd() * lib.boulders.length)];
        const R = tpl.radius * size;
        const off = hw * cc.curtain + R * 0.92;
        const x = f.x + side * nx * off - f.tx * R * 0.35;
        const z = f.z + side * nz * off - f.tz * R * 0.35;
        if (!near(x, z, R)) boulders.push({ ...place(tpl, x, z, size, rnd() * 360, 6, cfg.sink, tintAt(x, z), cc.moss), tpl });
        // 滝つぼの脇：少し下流の岸寄り
        const size2 = cc.base * main * (0.8 + 0.4 * rnd());
        const tpl2 = lib.boulders[Math.floor(rnd() * lib.boulders.length)];
        const R2 = tpl2.radius * size2;
        const off2 = hw * 1.05 + R2 * 0.55;
        const x2 = f.x + side * nx * off2 + f.tx * (0.1 + R2 * 0.6);
        const z2 = f.z + side * nz * off2 + f.tz * (0.1 + R2 * 0.6);
        if (rnd() < 0.8 && !near(x2, z2, R2)) {
          boulders.push({ ...place(tpl2, x2, z2, size2, rnd() * 360, 6, cfg.sink, tintAt(x2, z2), cc.moss * 0.7), tpl: tpl2 });
        }
      }
    });
  }
  const wets: (Placed & { tpl: RockTemplate })[] = [];
  for (const [x0, z0, size, shape, yaw, emerge] of cfg.wet) {
    const tpl = lib.large[shape % lib.large.length];
    const [x, z] = keepInside(x0, z0, tpl.radius * size);
    const w = layout.waterAt(x, z);
    const level = w > 0 ? w : levelDown;
    const minTop = level + emerge * tpl.height * size;
    wets.push({ ...place(tpl, x, z, size, yaw, 6, cfg.sink, tintAt(x, z), 0, minTop), tpl });
  }
  const beds: (Placed & { tpl: RockTemplate })[] = [];
  for (const [x0, z0, size, shape, yaw] of cfg.bed) {
    const tpl = lib.coral[shape % lib.coral.length];
    const [x, z] = keepInside(x0, z0, tpl.radius * size);
    beds.push({ ...place(tpl, x, z, size, yaw, 8, cfg.bedSink, tintAt(x, z, 1.5), 1), tpl });
  }

  // ===== 小石：水際・砂浜・川底・岩のまわり =====
  const big = [...boulders, ...wets, ...beds];
  const density = (x: number, z: number) => {
    const h = layout.heightAt(x, z);
    const w = layout.waterAt(x, z);
    let d = 0.06;
    if (w > 0) {
      const above = h - w;
      // 水際（濡れた砂の帯）
      d += 1.2 * Math.exp(-((above / 0.06) ** 2));
      // 川底（水の中）
      if (above < 0) d += 0.45 * smoothstep(0.02, 0.15, -above);
    }
    d += 0.25 * layout.sandAt(x, z);
    for (const b of big) {
      const dist = Math.hypot(x - b.x, z - b.z) - b.radius;
      if (dist < 3 * b.radius) d += 0.9 * Math.exp(-Math.max(dist, 0) / (0.6 * b.radius));
    }
    const patch = noise.fbm2(x * 1.4 + 9.1, z * 1.4 - 2.6, 3);
    return d * (0.25 + 1.3 * smoothstep(-0.35, 0.45, patch));
  };
  type Pebble = Placed & { cls: 'small' | 'gravel'; index: number };
  const pebbles: Pebble[] = [];
  const disks: { x: number; z: number; r: number }[] = big.map((b) => ({ x: b.x, z: b.z, r: b.radius }));
  const cellSize = 0.3;
  const hash = new Map<number, { x: number; z: number; r: number }[]>();
  const hkey = (i: number, j: number) => i * 7919 + j;
  const addHash = (x: number, z: number, r: number) => {
    const k = hkey(Math.floor(x / cellSize), Math.floor(z / cellSize));
    const l = hash.get(k);
    if (l) l.push({ x, z, r });
    else hash.set(k, [{ x, z, r }]);
  };
  for (const b of big) addHash(b.x, b.z, b.radius * 0.85);
  const free = (x: number, z: number, r: number) => {
    const ci = Math.floor(x / cellSize);
    const cj = Math.floor(z / cellSize);
    for (let a = -3; a <= 3; a++) {
      for (let b = -3; b <= 3; b++) {
        const l = hash.get(hkey(ci + a, cj + b));
        if (!l) continue;
        for (const o of l) if (Math.hypot(o.x - x, o.z - z) < o.r + r) return false;
      }
    }
    return true;
  };
  const pc = cfg.pebbles;
  /** 水の中か（水面より下） */
  const underwater = (x: number, z: number, margin = 0) => layout.waterAt(x, z) > layout.heightAt(x, z) + margin;
  // 川の中の小石：決めた所に群にして置く（群の中ほどほど大きめ）
  for (const [cx, cz, cr, n] of cfg.riverPebbles) {
    let placed = 0;
    for (let k = 0; k < n * 60 && placed < n; k++) {
      const a = rnd() * Math.PI * 2;
      const rr = cr * Math.min(1, Math.sqrt(-Math.log(1 - rnd() * 0.97)) * 0.55);
      const x = cx + Math.cos(a) * rr;
      const z = cz + Math.sin(a) * rr;
      if (!underwater(x, z, 0.008)) continue;
      const cls: 'small' | 'gravel' = rnd() < 0.45 ? 'gravel' : 'small';
      const pool = lib[cls];
      const index = Math.floor(rnd() * pool.length);
      const tpl = pool[index];
      const core = 1 - rr / cr;
      const width = pc.size[0] * Math.pow(pc.size[1] / pc.size[0], Math.pow(rnd(), pc.bias * (1.2 - 0.6 * core))) * (cls === 'gravel' ? 0.65 : 1.05);
      const r = tpl.radius * width;
      if (roundedSquareInside(x, z, half, radius) < r + 0.08) continue;
      if (!free(x, z, r * 1.02)) continue;
      addHash(x, z, r);
      const tint = tintAt(x, z, 1.5).multiply(new THREE.Color(0.92, 0.84, 0.72));
      pebbles.push({ ...place(tpl, x, z, width, rnd() * 360, 15, cfg.bedSink, tint, 0), cls, index });
      placed++;
    }
  }
  // 陸の小石：水際・砂浜・岩のまわり（水の中には置かない）
  for (let k = 0, land = 0; k < pc.count * 60 && land < pc.count; k++) {
    const x = (rnd() - 0.5) * 2 * half;
    const z = (rnd() - 0.5) * 2 * half;
    if (underwater(x, z, -0.004)) continue;
    const p = Math.min(1, density(x, z) * 0.6);
    if (rnd() > p) continue;
    const cls: 'small' | 'gravel' = rnd() < 0.55 ? 'gravel' : 'small';
    const pool = lib[cls];
    const index = Math.floor(rnd() * pool.length);
    const tpl = pool[index];
    const width = pc.size[0] * Math.pow(pc.size[1] / pc.size[0], Math.pow(rnd(), pc.bias)) * (cls === 'gravel' ? 0.6 : 1);
    const r = tpl.radius * width;
    if (roundedSquareInside(x, z, half, radius) < r + 0.08) continue;
    if (!free(x, z, r * 1.05)) continue;
    addHash(x, z, r);
    const tint = tintAt(x, z, 1.5).multiply(new THREE.Color(0.95, 0.92, 0.88));
    pebbles.push({ ...place(tpl, x, z, width, rnd() * 360, 15, cfg.sink, tint, 0), cls, index });
    land++;
  }

  // ===== メッシュと焼き込み =====
  const baseOptions = {
    roughness: 1,
    surface: { bump: 1.3, strataLines: 0, cracks: 1, grain: 1.4 },
    aoMin: 0.3,
    shadeTint: '#a8846a',
    shadowStrength: config.shadow.strength,
    unit,
    seed: 7,
  };
  const soilLine = { texture: ground.texture, size: ground.size, ...cfg.soilLine };
  const bedLine = { texture: ground.texture, size: ground.size, ...cfg.bedLine };
  const group = new THREE.Group();
  group.name = 'rocks';
  const casters: THREE.Mesh[] = [];
  const receivers: PointReceiver[] = [];

  const addMerged = (name: string, list: (Placed & { tpl: RockTemplate })[], material: ReturnType<typeof createRockMaterial>) => {
    if (list.length === 0) return;
    const merged = mergeRocks(list.map((r) => ({ r, geometry: r.tpl.geometry, coarse: r.tpl.coarse })), 1024);
    const mesh = new THREE.Mesh(merged.geometry, material.material);
    mesh.name = name;
    group.add(mesh);
    const target = createBakeTarget(renderer, merged.bakeWidth, merged.bakeHeight);
    target.texture.minFilter = THREE.NearestFilter;
    target.texture.magFilter = THREE.NearestFilter;
    material.setBake(target.texture);
    receivers.push({ target, geometry: merged.receiver!, matrixWorld: new THREE.Matrix4(), normalOffset: 0.02 * unit });
    casters.push(new THREE.Mesh(mergeRocks(list.map((r) => ({ r, geometry: r.tpl.proxy ?? r.tpl.geometry })), null).geometry));
  };
  const boulderMat = createRockMaterial({
    ...baseOptions,
    surface: { bump: 0.9, strataLines: 0, cracks: 0.3, grain: 1.0 },
    colors: cfg.colors,
    variant: { offsetPattern: true, skyBake: true, moss: cfg.moss, vertexColors: true, cavity: { albedo: 0.12, direct: 0.15 }, fillScale: 0.7, bakePair: true, sandLine: soilLine },
  });
  addMerged('rocks-boulders', boulders, boulderMat);
  const wetMat = createRockMaterial({
    ...baseOptions,
    colors: cfg.wetColors,
    shadeTint: '#a0806a',
    variant: {
      offsetPattern: true,
      skyBake: true,
      vertexColors: true,
      cavity: { albedo: 0.35, direct: 0.5 },
      fillScale: 0.7,
      bakePair: true,
      underwater: { level: levelDown, color: config.water.algae.color, amount: 0.55 },
      sandLine: bedLine,
    },
  });
  addMerged('rocks-wet', wets, wetMat);
  const bc = cfg.bedColors;
  const bedMat = createRockMaterial({
    ...baseOptions,
    colors: {
      ivory: bc.light,
      beige: bc.base,
      lightBrown: new THREE.Color(bc.base).lerp(new THREE.Color(bc.dark), 0.4).getStyle(),
      grayBrown: bc.dark,
      cavity: new THREE.Color(bc.dark).multiplyScalar(0.55).getStyle(),
    },
    shadeTint: '#d8cfb8',
    aoMin: 0.26,
    surface: { bump: 1.7, strataLines: 0.9, cracks: 0.5, grain: 1.7 },
    variant: {
      offsetPattern: true,
      skyBake: true,
      moss: bc.light,
      vertexColors: true,
      aoStrength: 0.85,
      cavity: { albedo: 0.3, direct: 0.4 },
      fillScale: 0.7,
      bakePair: true,
      sandLine: bedLine,
    },
  });
  addMerged('rocks-bed', beds, bedMat);

  // 小石：ひな形ごとの InstancedMesh（光の当たり具合は石ごと）
  const stoneMat = createRockMaterial({
    ...baseOptions,
    colors: cfg.colors,
    variant: { instanced: true, offsetPattern: true, skyBake: true, cavity: { albedo: 0.35, direct: 0.5 }, fillScale: 0.7, sandLine: { ...soilLine, height: 0.015 } },
  });
  const probeW = 512;
  const probeH = Math.max(1, Math.ceil(pebbles.length / probeW));
  const probeTarget = createBakeTarget(renderer, probeW, probeH);
  probeTarget.texture.minFilter = THREE.NearestFilter;
  probeTarget.texture.magFilter = THREE.NearestFilter;
  stoneMat.setBake(probeTarget.texture);
  const probePos = new Float32Array(pebbles.length * 3);
  const probeNor = new Float32Array(pebbles.length * 3);
  const probeUv = new Float32Array(pebbles.length * 2);
  let slot = 0;
  const shadowItems: { r: Placed; geometry: THREE.BufferGeometry }[] = [];
  for (const cls of ['small', 'gravel'] as const) {
    lib[cls].forEach((tpl, idx) => {
      const list = pebbles.filter((p) => p.cls === cls && p.index === idx);
      if (list.length === 0) return;
      const inst = new THREE.InstancedMesh(tpl.geometry, stoneMat.material, list.length);
      inst.name = `rocks-${cls}-${idx}`;
      const uv = new Float32Array(list.length * 2);
      list.forEach((r, i) => {
        inst.setMatrixAt(i, r.matrix);
        inst.setColorAt(i, r.tint);
        const s = slot++;
        uv[i * 2] = ((s % probeW) + 0.5) / probeW;
        uv[i * 2 + 1] = (Math.floor(s / probeW) + 0.5) / probeH;
        probeUv[s * 2] = uv[i * 2];
        probeUv[s * 2 + 1] = uv[i * 2 + 1];
        probePos[s * 3] = r.x;
        probePos[s * 3 + 1] = r.top + 0.015 * unit;
        probePos[s * 3 + 2] = r.z;
        probeNor[s * 3 + 1] = 1;
        if (cls === 'small' && tpl.proxy) shadowItems.push({ r, geometry: tpl.proxy });
      });
      tpl.geometry.setAttribute('instanceBakeUv', new THREE.InstancedBufferAttribute(uv, 2));
      inst.instanceMatrix.needsUpdate = true;
      if (inst.instanceColor) inst.instanceColor.needsUpdate = true;
      inst.computeBoundingSphere();
      group.add(inst);
    });
  }
  if (shadowItems.length > 0) casters.push(new THREE.Mesh(mergeRocks(shadowItems, null).geometry));
  if (pebbles.length > 0) {
    const points = new THREE.BufferGeometry();
    points.setAttribute('position', new THREE.BufferAttribute(probePos, 3));
    points.setAttribute('normal', new THREE.BufferAttribute(probeNor, 3));
    points.setAttribute('bakeUv', new THREE.BufferAttribute(probeUv, 2));
    receivers.push({ target: probeTarget, geometry: points, matrixWorld: new THREE.Matrix4(), normalOffset: 0.01 * unit });
  }
  group.updateMatrixWorld(true);

  const footprints: ShoreRock[] = [...boulders, ...wets, ...pebbles.filter((p) => p.cls === 'small')].map((r) => ({
    x: r.x,
    z: r.z,
    radius: r.radius,
    bottom: r.bottom,
    top: r.top,
  }));
  return {
    group,
    casters,
    receivers,
    footprints,
    disks,
    counts: {
      boulders: boulders.length,
      wet: wets.length,
      bed: beds.length,
      pebbles: pebbles.length,
      pebblesInWater: pebbles.filter((p) => layout.waterAt(p.x, p.z) > layout.heightAt(p.x, p.z)).length,
      bouldersInWater: boulders.filter((p) => layout.waterAt(p.x, p.z) > layout.heightAt(p.x, p.z)).length,
    },
  };
}

/**
 * 岩をひな形から結合する（位置・法線・陰影・くぼみ・色・苔・模様のずれ）。
 * bakeWidth を指定すると、影を焼き込む点（receiver）と、頂点ごとにその値を読む位置（bakeUv・bakeUv2）も作る。
 */
function mergeRocks(
  items: { r: Placed; geometry: THREE.BufferGeometry; coarse?: RockTemplate['coarse'] }[],
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
