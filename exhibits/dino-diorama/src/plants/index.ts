import * as THREE from 'three';
import type { SceneConfig } from '../config';
import { Noise, mulberry32 } from '../noise';
import { createBakeTarget, type PointReceiver } from '../lightBaker';
import { directionFromAngles } from '../framing';
import { polygonInside, roundedSquareInside, type TerrainLayout } from '../terrain/layout';
import { createPlantTemplates, type PlantKind, type PlantLibrary, type PlantTemplate } from './templates';
import { createPlantMaterial } from './material';
import { createFrondTexture } from './frondTexture';

export interface Plants {
  group: THREE.Group;
  casters: THREE.Mesh[];
  receiver: PointReceiver;
  /** 画角合わせ用の点（木の梢） */
  outlinePoints: THREE.Vector3[];
  counts: Record<string, number>;
}

interface Instance {
  kind: PlantKind;
  tpl: PlantTemplate;
  x: number;
  y: number;
  z: number;
  height: number;
  width: number;
  yaw: number;
  color: THREE.Color;
}

const smoothstep = (a: number, b: number, v: number) => {
  const t = THREE.MathUtils.clamp((v - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};

/** 光を調べる点の数（高さ方向） */
const PROBES = 5;
/** 焼き込み先の 1 行に並べる植物の数 */
const PER_ROW = 256;

/**
 * 植物（森・下草）を作る。目立つ木は設定の位置に、残りは場所ごとの密度に従って重ならないように散らす。
 * 同じ形はひな形を InstancedMesh で使い回し、色はインスタンスカラーで付ける。
 */
export function createPlants(
  renderer: THREE.WebGLRenderer,
  config: SceneConfig,
  layout: TerrainLayout,
  blocked: { x: number; z: number; r: number }[],
  /** 木だけを置かない所（恐竜の体のまわりなど） */
  treeBlocked: { x: number; z: number; r: number }[] = [],
): Plants {
  const cfg = config.plants;
  const lib = createPlantTemplates(cfg.seed);
  const rnd = mulberry32(cfg.seed * 31 + 7);
  const noise = new Noise(cfg.seed * 17 + 3);
  const half = layout.half;
  const radius = layout.cornerRadius;
  const instances: Instance[] = [];
  const sandPoly = config.terrain.sand.clearing;
  treeBlocked = [...treeBlocked, ...cfg.clear.map(([x, z, r]) => ({ x, z, r }))];

  // --- 置けるかどうか：水・岸・砂地・岩・恐竜の足もとを避け、台座の縁から離す
  const hashCell = 0.25;
  /** 置いた物の円：r は木どうしの間隔、under は下草から見た大きさ（木は幹の根元だけ。下草は木の下にも生える） */
  type Disk = { x: number; z: number; r: number; under: number; tree: boolean };
  const hash = new Map<number, Disk[]>();
  const key = (i: number, j: number) => i * 7919 + j;
  const addDisk = (x: number, z: number, r: number, tree: boolean, under = r) => {
    const k = key(Math.floor(x / hashCell), Math.floor(z / hashCell));
    const d = { x, z, r, under, tree };
    const l = hash.get(k);
    if (l) l.push(d);
    else hash.set(k, [d]);
  };
  // 岩・倒木・恐竜を置く場所：木からも下草からも避ける
  for (const b of blocked) addDisk(b.x, b.z, b.r, true);
  /**
   * 近くの物との間隔の確認。mode が 'tree' なら木（と岩など）との間隔、'under' なら木の幹の根元・岩など・ほかの下草との間隔、
   * 'tuft'（地面の草むら）なら木の幹の根元と岩などだけを見る
   */
  const free = (x: number, z: number, r: number, factor: number, mode: 'tree' | 'under' | 'tuft') => {
    const ci = Math.floor(x / hashCell);
    const cj = Math.floor(z / hashCell);
    const span = 3;
    for (let a = -span; a <= span; a++) {
      for (let b = -span; b <= span; b++) {
        const l = hash.get(key(ci + a, cj + b));
        if (!l) continue;
        for (const o of l) {
          if (mode !== 'under' && !o.tree) continue;
          const orad = mode === 'tree' ? o.r : o.under;
          if (Math.hypot(o.x - x, o.z - z) < (orad + r) * factor) return false;
        }
      }
    }
    return true;
  };
  /** 川（水の中と岸）からの距離の目安：岸の斜面の上と水の中は置かない */
  const nearWater = (x: number, z: number) => {
    const w = layout.waterAt(x, z);
    if (w <= 0) return 99;
    return layout.heightAt(x, z) - w;
  };
  const okGround = (x: number, z: number, r: number, margin: number) => {
    if (roundedSquareInside(x, z, half, radius) < r * 0.6 + margin) return false;
    if (nearWater(x, z) < 0.06) return false;
    return true;
  };

  // --- 森の密度（奥・左の縁・左の中ほど・右岸）
  const sandAt = (x: number, z: number) => smoothstep(-0.25, 0.25, polygonInside(x, z, sandPoly));
  /** 奥と左の林（右岸の林は含めない）の濃さ */
  const woods = (x: number, z: number) => {
    let d = 0;
    d = Math.max(d, smoothstep(-1.6, -3.0, z) * smoothstep(2.6, 1.6, x));
    d = Math.max(d, smoothstep(-2.7, -3.6, x) * smoothstep(2.3, 1.3, z));
    d = Math.max(d, smoothstep(-0.6, -1.4, x) * smoothstep(0.8, -0.2, z));
    return d * (1 - sandAt(x, z));
  };
  const forestDensity = (x: number, z: number) => {
    let d = smoothstep(-1.6, -3.0, z);
    d = Math.max(d, smoothstep(-2.7, -3.6, x) * smoothstep(2.3, 1.3, z));
    d = Math.max(d, smoothstep(-0.6, -1.4, x) * smoothstep(0.8, -0.2, z));
    // 右岸：川の右の水際から右（木と木のあいだをあけて、明るく）
    const f = layout.riverFrame(x, z);
    // （主光は右手前から差すので、川の近くに高い木があると川岸と水面が木の影で暗くなる。木は岸から離す）
    if (f && f.d > 0) d = Math.max(d, cfg.rightBank.density * smoothstep(f.w + 0.85, f.w + 1.35, f.d) * smoothstep(2.9, 2.0, z));
    d *= 1 - sandAt(x, z);
    const patch = noise.fbm2(x * 0.9 + 3.3, z * 0.9 - 1.7, 2);
    return d * (0.75 + 0.35 * patch);
  };

  const colors = cfg.colors;
  const tint = (hex: string, x: number, z: number, amount = 1) => {
    const n = noise.fbm2(x * 0.6 - 4.2, z * 0.6 + 8.1, 2);
    const c = new THREE.Color(hex);
    const hsl = { h: 0, s: 0, l: 0 };
    c.getHSL(hsl);
    hsl.h += amount * (0.025 * n + 0.02 * (rnd() - 0.5));
    hsl.l *= 1 + amount * (0.12 * n + 0.14 * (rnd() - 0.5));
    hsl.s *= 1 + amount * 0.1 * (rnd() - 0.5);
    return new THREE.Color().setHSL(hsl.h, hsl.s, hsl.l);
  };
  const pick = (pool: PlantTemplate[]) => pool[Math.floor(rnd() * pool.length)];
  const add = (kind: PlantKind, tpl: PlantTemplate, x: number, z: number, height: number, yaw: number, colorHex: string, amount = 1) => {
    const y = layout.heightAt(x, z) - 0.01 * height;
    const width = 0.9 + 0.22 * rnd();
    instances.push({ kind, tpl, x, y, z, height, width, yaw, color: tint(colorHex, x, z, amount) });
  };

  // --- 1. 目立つ木
  for (const [type, x, z, h, yaw] of cfg.hero) {
    const kind = type as PlantKind;
    const pool = (lib as unknown as Record<string, PlantTemplate[]>)[kind];
    const tpl = pool[Math.floor(rnd() * pool.length)];
    add(kind, tpl, x, z, h, (yaw * Math.PI) / 180, (colors as Record<string, string>)[kind]);
    addDisk(x, z, tpl.radius * h * 0.45, true, 0.06 + 0.025 * h);
  }

  // --- 2. 森：密度に従って木を散らす（場所ごとに種類と高さを変える）
  let forestPlaced = 0;
  {
    let placed = 0;
    for (let k = 0; k < cfg.forest.count * 120 && placed < cfg.forest.count; k++) {
      const x = (rnd() - 0.5) * 2 * half;
      const z = (rnd() - 0.5) * 2 * half;
      const d = forestDensity(x, z);
      if (rnd() > d) continue;
      // 種類：奥は背の高いアラウカリアとマツ、左はマツとトウヒ、右岸はトウヒとマツ。明るい広葉樹がところどころ
      const back = smoothstep(-2.0, -3.6, z);
      const right = x > 1.8 ? 1 : 0;
      const r = rnd();
      let kind: PlantKind;
      // 左と奥の林には、枝が地面まで垂れるトウヒや背の低い木は置かない（高い幹が並ぶ林）
      if (right) kind = r < 0.3 ? 'spruce' : r < 0.82 ? 'pine' : 'araucaria';
      else if (r < 0.2 + 0.12 * back) kind = 'araucaria';
      else if (r < 0.34 + 0.1 * back) kind = 'broadleaf';
      else kind = 'pine';
      let h = THREE.MathUtils.lerp(2.4, 3.5, rnd()) + 0.8 * back;
      if (kind === 'araucaria') h += 0.5;
      if (right) h = THREE.MathUtils.lerp(1.4, 2.3, rnd()) + 0.7 * smoothstep(0, -3.5, z);
      // 右岸の森の縁（川の近く）は低め
      else h *= 0.9 + 0.1 * smoothstep(0.3, 0.8, d);
      if (right) {
        // 川に近い木ほど低く
        const fr = layout.riverFrame(x, z);
        const shore = fr && fr.e < 0 ? -fr.e : 3;
        h *= 0.72 + 0.28 * smoothstep(0.9, 2.0, shore);
      }
      const tpl = pick(lib[kind] as PlantTemplate[]);
      // 右岸は間をあけて、木の形が 1 本ずつ見えるように
      const rr = tpl.radius * h * 0.42 * cfg.forest.spacing * 2 * (right ? cfg.rightBank.spacing : 1);
      if (!okGround(x, z, tpl.radius * h * 0.5, 0.12)) continue;
      if (!free(x, z, rr, 1, 'tree')) continue;
      // 恐竜の体のまわりには、樹冠が重ならないように木を置かない
      if (treeBlocked.some((b) => Math.hypot(b.x - x, b.z - z) < b.r + tpl.radius * h * 0.45)) continue;
      add(kind, tpl, x, z, h, rnd() * Math.PI * 2, right && kind !== 'araucaria' ? cfg.rightBank.color : (colors as Record<string, string>)[kind]);
      addDisk(x, z, rr, true, 0.06 + 0.025 * h);
      placed++;
    }
    forestPlaced = placed;
  }

  // --- 3. 下草：ソテツ（森の縁と開けた所）、シダ（どこにでも。砂地の真ん中と水際は避ける）、低木（森の中）、草むら
  const understory = (kind: 'cycad' | 'fern' | 'shrub' | 'tuft', count: number, [h0, h1]: [number, number], density: (x: number, z: number) => number, spacing: number) => {
    let placed = 0;
    for (let k = 0; k < count * 80 && placed < count; k++) {
      const x = (rnd() - 0.5) * 2 * half;
      const z = (rnd() - 0.5) * 2 * half;
      // 左と奥の林の中には下草を置かない（林の縁にだけ）
      const inWoods = smoothstep(cfg.woodsClear[0], cfg.woodsClear[1], woods(x, z));
      if (rnd() > density(x, z) * (1 - inWoods)) continue;
      const tpl = pick(lib[kind] as PlantTemplate[]);
      const h = THREE.MathUtils.lerp(h0, h1, Math.pow(rnd(), 1.3));
      const rr = tpl.radius * h * spacing;
      if (!okGround(x, z, tpl.radius * h * 0.75, 0.04)) continue;
      if (!free(x, z, rr, 1, kind === 'tuft' ? 'tuft' : 'under')) continue;
      add(kind, tpl, x, z, h, rnd() * Math.PI * 2, (colors as Record<string, string>)[kind], kind === 'tuft' ? 1.4 : 1);
      if (kind !== 'tuft') addDisk(x, z, rr * 0.8, false);
      placed++;
    }
  };
  const openness = (x: number, z: number) => 1 - forestDensity(x, z);
  /** 砂の多い所（川岸の砂浜と、開けた所の砂のまだら）を避ける割合。開けた所の草のまだらには下草がまばらに生える */
  const sandEdge = (x: number, z: number) => {
    const open = sandAt(x, z);
    const sand = layout.sandAt(x, z);
    return (1 - smoothstep(0.42, 0.62, sand)) * (1 - 0.7 * open);
  };
  understory('cycad', cfg.cycads.count, cfg.cycads.height, (x, z) => {
    const f = forestDensity(x, z);
    // 森の縁（密度が中くらい）と開けた所の縁
    return (0.25 + 0.75 * Math.exp(-(((f - 0.45) / 0.3) ** 2))) * sandEdge(x, z) * 0.8;
  }, 0.55);
  // 低木（葉の茂み）は森の中と縁に。シダより先に置く（シダはすき間を埋める）
  understory('shrub', cfg.shrubs.count, cfg.shrubs.height, (x, z) => (0.08 + 0.92 * forestDensity(x, z)) * (1 - sandAt(x, z)), 0.6);
  understory('fern', cfg.ferns.count, cfg.ferns.height, (x, z) => {
    const patch = 0.5 + 0.5 * noise.fbm2(x * 1.3 - 2.2, z * 1.3 + 5.5, 2);
    return (0.35 + 0.65 * patch) * sandEdge(x, z);
  }, 0.24);
  understory('tuft', cfg.tufts.count, cfg.tufts.height, (x, z) => {
    const s = sandAt(x, z);
    // 森の地面と草地（砂地には置かない）
    return (0.25 + 0.6 * openness(x, z)) * (1 - smoothstep(0.1, 0.5, s));
  }, 0.6);

  // ===== メッシュ =====
  const sh = cfg.shading;
  const bakeWidth = PER_ROW * PROBES;
  const common = {
    interior: sh.interior,
    tipLight: sh.tipLight,
    tipColor: colors.tip,
    aoMin: sh.aoMin,
    shadowStrength: config.shadow.strength,
    aoStrength: sh.aoStrength,
    leafScale: 1 / sh.leafSize,
    leafBump: sh.leafBump,
    leafContrast: sh.leafContrast,
    sheen: sh.sheen,
    sheenColor: colors.sheen,
    translucency: sh.translucency,
    probes: PROBES,
    bakeWidth,
  };
  const leafMat = createPlantMaterial({ kind: 'foliage', ...common });
  const fernTex = createFrondTexture('fern', 11);
  const cycadTex = createFrondTexture('cycad', 23);
  const fernMat = createPlantMaterial({ kind: 'frond', map: fernTex, ...common });
  const cycadMat = createPlantMaterial({ kind: 'frond', map: cycadTex, ...common });
  const cardCommon = { ...common, ...cfg.cardShading };
  const sprayMat = createPlantMaterial({ kind: 'card', map: createFrondTexture('spray', 37), ...cardCommon });
  const palmMat = createPlantMaterial({ kind: 'card', map: createFrondTexture('palm', 41), ...cardCommon });
  const woodMats = {
    trunk: createPlantMaterial({ kind: 'wood', color: colors.trunk, ...common, interior: 0, tipLight: 0 }),
    araucaria: createPlantMaterial({ kind: 'wood', color: colors.araucariaTrunk, ...common, interior: 0, tipLight: 0 }),
    cycad: createPlantMaterial({ kind: 'wood', color: colors.cycadTrunk, ...common, interior: 0, tipLight: 0 }),
  };
  const total = instances.length;
  const bakeHeight = Math.max(1, Math.ceil(total / PER_ROW));
  const target = createBakeTarget(renderer, bakeWidth, bakeHeight);
  target.texture.minFilter = THREE.NearestFilter;
  target.texture.magFilter = THREE.NearestFilter;
  for (const m of [leafMat, fernMat, cycadMat, sprayMat, palmMat, woodMats.trunk, woodMats.araucaria, woodMats.cycad]) m.setBake(target.texture);

  // 光を調べる点：植物ごとに高さ方向に PROBES 個（樹冠の、日の当たる側の外側）
  const probePos = new Float32Array(total * PROBES * 3);
  const probeNor = new Float32Array(total * PROBES * 3);
  const probeUv = new Float32Array(total * PROBES * 2);
  const sun = directionFromAngles(config.lights.key.azimuth, 0).setY(0).normalize();

  const byTemplate = new Map<PlantTemplate, Instance[]>();
  for (const inst of instances) {
    const l = byTemplate.get(inst.tpl);
    if (l) l.push(inst);
    else byTemplate.set(inst.tpl, [inst]);
  }
  const group = new THREE.Group();
  group.name = 'plants';
  const casters: THREE.Mesh[] = [];
  const casterMaterial = new THREE.MeshBasicMaterial();
  const counts: Record<string, number> = { forest: forestPlaced };
  let slot = 0;
  const m4 = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const outlinePoints: THREE.Vector3[] = [];
  for (const [tpl, list] of byTemplate) {
    const n = list.length;
    counts[tpl.kind] = (counts[tpl.kind] ?? 0) + n;
    const uv = new Float32Array(n * 2);
    const matrices: THREE.Matrix4[] = [];
    list.forEach((inst, i) => {
      const s = slot++;
      const u0 = ((s % PER_ROW) * PROBES + 0.5) / bakeWidth;
      const v0 = (Math.floor(s / PER_ROW) + 0.5) / bakeHeight;
      uv[i * 2] = u0;
      uv[i * 2 + 1] = v0;
      q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), inst.yaw);
      m4.compose(new THREE.Vector3(inst.x, inst.y, inst.z), q, new THREE.Vector3(inst.height * inst.width, inst.height, inst.height * inst.width));
      matrices.push(m4.clone());
      for (let k = 0; k < PROBES; k++) {
        const t = k / (PROBES - 1);
        const cr = tpl.crownAt(t) * inst.height * inst.width;
        const p = new THREE.Vector3(inst.x, inst.y + (0.04 + 0.94 * t) * inst.height + 0.02, inst.z).addScaledVector(sun, cr + 0.04);
        const pi = s * PROBES + k;
        p.toArray(probePos, pi * 3);
        probeNor[pi * 3 + 1] = 1;
        probeUv[pi * 2] = u0 + k / bakeWidth;
        probeUv[pi * 2 + 1] = v0;
      }
      if (['araucaria', 'pine', 'spruce', 'broadleaf'].includes(tpl.kind)) {
        outlinePoints.push(new THREE.Vector3(inst.x, inst.y + inst.height, inst.z));
      }
    });
    const uvAttr = new THREE.InstancedBufferAttribute(uv, 2);
    const makeInst = (geometry: THREE.BufferGeometry, material: THREE.Material, name: string) => {
      geometry.setAttribute('instanceBakeUv', uvAttr);
      const mesh = new THREE.InstancedMesh(geometry, material, n);
      mesh.name = name;
      list.forEach((inst, i) => {
        mesh.setMatrixAt(i, matrices[i]);
        mesh.setColorAt(i, inst.color);
      });
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      mesh.computeBoundingSphere();
      group.add(mesh);
      return mesh;
    };
    if (tpl.foliage) makeInst(tpl.foliage, leafMat.material, `plants-${tpl.kind}-leaves`);
    if (tpl.fronds) makeInst(tpl.fronds, tpl.kind === 'cycad' ? cycadMat.material : fernMat.material, `plants-${tpl.kind}-fronds`);
    if (tpl.sprays) makeInst(tpl.sprays, sprayMat.material, `plants-${tpl.kind}-sprays`);
    if (tpl.rosettes) makeInst(tpl.rosettes, palmMat.material, `plants-${tpl.kind}-rosettes`);
    if (tpl.wood) {
      const wm = tpl.kind === 'araucaria' ? woodMats.araucaria : tpl.kind === 'cycad' ? woodMats.cycad : woodMats.trunk;
      const mesh = makeInst(tpl.wood, wm.material, `plants-${tpl.kind}-wood`);
      // 幹の色は葉の色に引きずられないよう、明るさだけを変える
      list.forEach((inst, i) => mesh.setColorAt(i, new THREE.Color(1, 1, 1).multiplyScalar(0.85 + 0.3 * ((inst.x * 7.31 + inst.z * 3.17) % 1 + 1) % 1)));
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    }
    if (tpl.proxy && tpl.kind !== 'tuft' && tpl.kind !== 'fern') {
      const proxy = new THREE.InstancedMesh(tpl.proxy, casterMaterial, n);
      list.forEach((_, i) => proxy.setMatrixAt(i, matrices[i]));
      proxy.instanceMatrix.needsUpdate = true;
      proxy.computeBoundingSphere();
      casters.push(proxy);
    }
  }
  group.updateMatrixWorld(true);
  const points = new THREE.BufferGeometry();
  points.setAttribute('position', new THREE.BufferAttribute(probePos, 3));
  points.setAttribute('normal', new THREE.BufferAttribute(probeNor, 3));
  points.setAttribute('bakeUv', new THREE.BufferAttribute(probeUv, 2));
  return {
    group,
    casters,
    receiver: { target, geometry: points, matrixWorld: new THREE.Matrix4(), normalOffset: 0.0, channels: [true, true, true] },
    outlinePoints,
    counts,
  };
}

export type { PlantLibrary };
