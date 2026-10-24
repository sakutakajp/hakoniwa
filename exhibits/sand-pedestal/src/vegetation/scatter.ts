import * as THREE from 'three';
import { Noise, mulberry32 } from '../noise';
import type { IslandMeshData } from '../island/buildGeometry';
import type { SceneConfig } from '../config';
import type { PlantTemplate, TemplateLibrary } from './templates';

export type VegetationConfig = SceneConfig['vegetation'];
export type TemplateGroup = keyof TemplateLibrary;

export interface PlantInstance {
  /** どの配置処理で置いたか（調整用） */
  source: string;
  group: TemplateGroup;
  /** ひな形の番号（group の中で） */
  index: number;
  matrix: THREE.Matrix4;
  /** 葉の色（リニア） */
  color: THREE.Color;
  /** 光の当たり具合を調べる点と、その向き（ワールド座標） */
  probe: THREE.Vector3;
  probeNormal: THREE.Vector3;
}

const smoothstep = (a: number, b: number, v: number) => {
  const t = THREE.MathUtils.clamp((v - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};

/**
 * 近くの植物を調べるための格子。木は水平方向（xz）の距離で、
 * 崖に貼り付く植物は高さも含めた 3 次元の距離で間隔を取る。
 */
class SpatialHash {
  private readonly cells = new Map<number, { x: number; y: number; z: number; r: number }[]>();
  constructor(
    private readonly cell: number,
    private readonly use3D = false,
  ) {}
  private key(ix: number, iy: number, iz: number) {
    return ix * 73856093 + iy * 83492791 + iz * 19349663;
  }
  private iy(y: number) {
    return this.use3D ? Math.floor(y / this.cell) : 0;
  }
  add(x: number, z: number, r: number, y = 0) {
    const k = this.key(Math.floor(x / this.cell), this.iy(y), Math.floor(z / this.cell));
    const list = this.cells.get(k);
    if (list) list.push({ x, y, z, r });
    else this.cells.set(k, [{ x, y, z, r }]);
  }
  /** 半径 r の円（球）が、登録済みのもの（半径 × factor）と重ならないか */
  free(x: number, z: number, r: number, factor: number, reach: number, y = 0) {
    const ix = Math.floor(x / this.cell);
    const iy = this.iy(y);
    const iz = Math.floor(z / this.cell);
    const span = Math.ceil(reach / this.cell);
    const spanY = this.use3D ? span : 0;
    for (let a = -span; a <= span; a++) {
      for (let c = -spanY; c <= spanY; c++) {
        for (let b = -span; b <= span; b++) {
          const list = this.cells.get(this.key(ix + a, iy + c, iz + b));
          if (!list) continue;
          for (const o of list) {
            const d = this.use3D ? Math.hypot(o.x - x, o.y - y, o.z - z) : Math.hypot(o.x - x, o.z - z);
            if (d < (o.r + r) * factor) return false;
          }
        }
      }
    }
    return true;
  }
}

/**
 * 山の表面に植生を配置する。
 *  - 山のメッシュの三角形から面積に比例して点を取り、その点の高さと傾きで種類を決める
 *    （緩斜面：樹木、やや急な斜面や崖の上端：低木、地表：草、崖の段差や割れ目：草むら、崖の上端から：つる）
 *  - マスク（砂地からの高さ、足もとの形、洞窟の入口、除外範囲）の外には置かない
 *  - 根元は表面に合わせて少し沈め、樹冠が岩にめり込む場所には置かない
 *  - 乱数はシード固定なので、何度読み込んでも同じ配置になる
 */
export function scatterVegetation(
  data: IslandMeshData,
  cfg: VegetationConfig,
  pedestal: { size: number },
  lib: TemplateLibrary,
  /** 調整用：候補が採用されなかった理由の集計（任意） */
  stats?: Record<string, number>,
): PlantInstance[] {
  const count = (key: string) => {
    if (stats) stats[key] = (stats[key] ?? 0) + 1;
  };
  const W = pedestal.size;
  const u = W / 10;
  const ySand = data.shape.ySand;
  const rnd = mulberry32(cfg.seed);
  const noise = new Noise(cfg.seed * 31 + 7);
  const F = data.sampleField;
  const shape = data.shape;
  const density = Math.max(0.05, cfg.density);

  // --- マスク：植生を置いてよい範囲（0 = 置かない、1 = 置く）
  const minH = cfg.mask.minHeight * W;
  const cave = shape.cave;
  const clear = cfg.mask.caveClearance;
  const exclude = cfg.mask.exclude.map(([x, z, r]) => ({ x: x * W, z: z * W, r: r * W }));
  // 尾根の小道（木と低木を置かない細い帯）
  const trailPts = cfg.trail.path.map(([x, z]) => [x * W, z * W] as [number, number]);
  const trailW = cfg.trail.width * W;
  const trailDist = (x: number, z: number) => {
    let best = Infinity;
    for (let i = 0; i < trailPts.length - 1; i++) {
      const [ax, az] = trailPts[i];
      const [bx, bz] = trailPts[i + 1];
      const ex = bx - ax;
      const ez = bz - az;
      const t = THREE.MathUtils.clamp(((x - ax) * ex + (z - az) * ez) / (ex * ex + ez * ez), 0, 1);
      best = Math.min(best, Math.hypot(x - ax - ex * t, z - az - ez * t));
    }
    return best;
  };
  const mask = (x: number, y: number, z: number, allowOverhang = 0): number => {
    if (y < ySand + minH) return 0;
    // 崖のふもとの線より砂地側（崖の張り出しの分だけは許す）
    if (shape.footprintAt(x, z) < -(0.05 + allowOverhang) * u) return 0;
    // 洞窟の入口とその前は空ける
    const dx = x - cave.cx;
    const dz = z - cave.cz;
    const lx = (dx * cave.tx + dz * cave.tz) / cave.a;
    const ly = (y - cave.cy) / cave.b;
    const lz = (dx * cave.nx + dz * cave.nz) / cave.c;
    if (Math.abs(lx) < clear && ly < 1 + (clear - 1) * 1.6 && lz > -3 && lz < 1.5) return 0;
    for (const e of exclude) if (Math.hypot(x - e.x, z - e.z) < e.r) return 0;
    return 1;
  };

  // --- 密度場の勾配（外向きの法線）と、表面への射影
  const grad = (x: number, y: number, z: number, out: THREE.Vector3) => {
    const e = 0.02 * u;
    out.set(
      F(x - e, y, z) - F(x + e, y, z),
      F(x, y - e, z) - F(x, y + e, z),
      F(x, y, z - e) - F(x, y, z + e),
    );
    const l = out.length();
    if (l > 1e-8) out.divideScalar(l);
    else out.set(0, 1, 0);
    return out;
  };
  const project = (p: THREE.Vector3, n: THREE.Vector3) => {
    for (let i = 0; i < 4; i++) {
      const f = F(p.x, p.y, p.z);
      grad(p.x, p.y, p.z, n);
      // f > 0 は岩の中：外向きの法線の方へ押し出す
      p.addScaledVector(n, f * 0.9);
      if (Math.abs(f) < 0.002 * u) break;
    }
    grad(p.x, p.y, p.z, n);
    return p;
  };

  /** 崖の上端までの水平距離（近くに大きな段差がなければ大きな値） */
  const edgeInfo = (p: THREE.Vector3) => {
    let best = Infinity;
    let dirX = 0;
    let dirZ = 0;
    for (const d of [0.08, 0.16, 0.28]) {
      for (let k = 0; k < 10; k++) {
        const a = (k / 10) * Math.PI * 2;
        const x = p.x + Math.cos(a) * d * u;
        const z = p.z + Math.sin(a) * d * u;
        // その先が 0.35 以上低くなっていれば崖の上端とみなす
        if (F(x, p.y - 0.35 * u, z) < 0 && F(x, p.y + 0.02 * u, z) < 0.02) {
          if (d * u < best) {
            best = d * u;
            dirX = Math.cos(a);
            dirZ = Math.sin(a);
          }
        }
      }
      if (best < Infinity) break;
    }
    return { dist: best, dirX, dirZ };
  };

  // --- 三角形を面積つきで集める
  const P = data.positions;
  const N = data.normals;
  const I = data.indices;
  const triCount = I.length / 3;
  type Tri = { i: number; area: number; ny: number };
  const gentle: Tri[] = [];
  const ledges: Tri[] = [];
  const steep: Tri[] = [];
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const c = new THREE.Vector3();
  const ab = new THREE.Vector3();
  const ac = new THREE.Vector3();
  for (let t = 0; t < triCount; t++) {
    a.fromArray(P, I[t * 3] * 3);
    b.fromArray(P, I[t * 3 + 1] * 3);
    c.fromArray(P, I[t * 3 + 2] * 3);
    ab.subVectors(b, a);
    ac.subVectors(c, a);
    const cr = ab.cross(ac);
    const area2 = cr.length();
    if (area2 < 1e-10) continue;
    const ny = cr.y / area2;
    const cy = (a.y + b.y + c.y) / 3;
    if (cy < ySand + minH) continue;
    const tri = { i: t, area: area2 / 2, ny };
    if (ny >= 0.45) gentle.push(tri);
    if (ny >= 0.18 && ny < 0.78) ledges.push(tri);
    if (ny < 0.35 && ny > -0.2) steep.push(tri);
  }
  const makeSampler = (tris: Tri[]) => {
    const cum = new Float64Array(tris.length);
    let s = 0;
    for (let k = 0; k < tris.length; k++) {
      s += tris[k].area;
      cum[k] = s;
    }
    const total = s;
    return {
      total,
      sample(p: THREE.Vector3, n: THREE.Vector3) {
        const r = rnd() * total;
        let lo = 0;
        let hi = cum.length - 1;
        while (lo < hi) {
          const mid = (lo + hi) >> 1;
          if (cum[mid] < r) lo = mid + 1;
          else hi = mid;
        }
        const t = tris[lo].i;
        let r1 = rnd();
        let r2 = rnd();
        if (r1 + r2 > 1) {
          r1 = 1 - r1;
          r2 = 1 - r2;
        }
        const w0 = 1 - r1 - r2;
        const i0 = I[t * 3] * 3;
        const i1 = I[t * 3 + 1] * 3;
        const i2 = I[t * 3 + 2] * 3;
        p.set(
          P[i0] * w0 + P[i1] * r1 + P[i2] * r2,
          P[i0 + 1] * w0 + P[i1 + 1] * r1 + P[i2 + 1] * r2,
          P[i0 + 2] * w0 + P[i1 + 2] * r1 + P[i2 + 2] * r2,
        );
        n.set(
          N[i0] * w0 + N[i1] * r1 + N[i2] * r2,
          N[i0 + 1] * w0 + N[i1 + 1] * r1 + N[i2 + 1] * r2,
          N[i0 + 2] * w0 + N[i1 + 2] * r1 + N[i2 + 2] * r2,
        ).normalize();
        return tris[lo];
      },
    };
  };
  const gentleSampler = makeSampler(gentle);
  const ledgeSampler = makeSampler(ledges);
  const steepSampler = makeSampler(steep);

  // --- 色：群落ごとにまとまった色の変化（場所の大きなノイズ）＋木ごとのわずかな違い
  const deep = new THREE.Color(cfg.colors.deep);
  const olive = new THREE.Color(cfg.colors.olive);
  const yellow = new THREE.Color(cfg.colors.yellowGreen);
  const patch = 1 / (cfg.colorPatchSize * W);
  const colorAt = (x: number, z: number, kind: 'tree' | 'shrub' | 'ground' | 'vine') => {
    const n1 = noise.fbm2(x * patch + 3.3, z * patch - 1.7, 2);
    const n2 = noise.fbm2(x * patch * 1.7 - 8.1, z * patch * 1.7 + 4.4, 2);
    const col = deep.clone().lerp(olive, smoothstep(-0.45, 0.45, n1));
    let yg = 0.32 * smoothstep(0.05, 0.6, n2);
    if (kind === 'ground') yg += 0.18;
    if (kind === 'vine') yg -= 0.04;
    col.lerp(yellow, THREE.MathUtils.clamp(yg, 0, 0.6));
    // 個体ごとの小さな明るさの違い
    col.multiplyScalar(0.9 + 0.2 * rnd());
    return col;
  };

  const out: PlantInstance[] = [];
  let pass = '';
  const tmpDown = new THREE.Vector3();
  const tmpRing = new THREE.Vector3();
  /** 根元の接地を確かめる輪の半径（ひな形の単位） */
  const SETTLE_RING: Record<TemplateGroup, number> = { trees: 0.03, palms: 0.03, shrubs: 0.18, ground: 0.8, tufts: 0.15, vines: 0 };
  const tmpProbeN = new THREE.Vector3();
  const up = new THREE.Vector3(0, 1, 0);
  const q = new THREE.Quaternion();
  const qTilt = new THREE.Quaternion();
  const m = new THREE.Matrix4();
  const tmpV = new THREE.Vector3();

  const add = (
    group: TemplateGroup,
    index: number,
    pos: THREE.Vector3,
    quat: THREE.Quaternion,
    scale: THREE.Vector3,
    color: THREE.Color,
    probeNormal: THREE.Vector3,
    probeAt?: THREE.Vector3,
  ) => {
    const tpl = lib[group][index];
    const base = pos.clone();
    // 根元が浮かないように：根元の輪がすべて岩の中に入るまで、少しずつ沈める
    if (group !== 'vines') {
      const ringR = SETTLE_RING[group];
      const down = group === 'trees' || group === 'palms' ? tmpDown.set(0, -1, 0) : tmpDown.set(0, -1, 0).applyQuaternion(quat);
      for (let iter = 0; iter < 4; iter++) {
        let minF = Infinity;
        for (let k = 0; k < 8; k++) {
          const a = (k / 8) * Math.PI * 2;
          tmpRing.set(Math.cos(a) * ringR, 0, Math.sin(a) * ringR).multiply(scale).applyQuaternion(quat).add(base);
          minF = Math.min(minF, F(tmpRing.x, tmpRing.y, tmpRing.z));
        }
        if (minF > -0.006 * u) break;
        base.addScaledVector(down, -minF + 0.006 * u);
      }
    }
    const shift = base.clone().sub(pos);
    const matrix = new THREE.Matrix4().compose(base, quat, scale);
    const probe = probeAt ? probeAt.clone().add(shift) : tpl.probe.clone().applyMatrix4(matrix);
    // 調べる点が岩の中に入っていたら外へ出す（入っていると常に影になり、真っ黒になる）
    for (let i = 0; i < 8 && F(probe.x, probe.y, probe.z) > -0.01 * u; i++) {
      grad(probe.x, probe.y, probe.z, tmpProbeN);
      probe.addScaledVector(tmpProbeN, 0.03 * u);
    }
    out.push({ source: pass, group, index, matrix, color, probe, probeNormal: probeNormal.clone() });
  };
  /** 表面に貼り付く小さな植物の光を調べる点：表面から少し外 */
  const surfaceProbe = (pos: THREE.Vector3, normal: THREE.Vector3, h: number) =>
    pos.clone().addScaledVector(normal, Math.max(0.03 * u, h * 0.8));

  /** 樹冠や葉の塊が岩にめり込まないか（中心は岩の外、外周も深くは入らない） */
  const crownClear = (tpl: PlantTemplate, matrix: THREE.Matrix4, scaleY: number) => {
    const cc = tpl.crownCenter.clone().applyMatrix4(matrix);
    const cr = tpl.crownRadius * scaleY;
    if (F(cc.x, cc.y, cc.z) > -0.1 * cr) return false;
    for (let k = 0; k < 6; k++) {
      const ang = (k / 6) * Math.PI * 2;
      if (F(cc.x + Math.cos(ang) * cr * 0.8, cc.y, cc.z + Math.sin(ang) * cr * 0.8) > 0.5 * cr) return false;
    }
    return F(cc.x, cc.y + cr * 0.8, cc.z) < 0;
  };

  /**
   * 茂り具合（0〜1）。横に長く縦に短い大きなノイズで、崖の途中では緑が層に沿った帯や群れになり、
   * 一面に点々と散らばった見た目にしない
   */
  const lush = (x: number, y: number, z: number) =>
    0.5 + 0.5 * noise.fbm3((x * 0.75) / u + 3.7, (y * 2.2) / u - 1.3, (z * 0.75) / u + 8.8, 2);
  /** 崖の途中の狭い段（前は落ち込み、背後には岩壁が続く）か。山頂や広い上面は false */
  const terraceAt = (pt: THREE.Vector3) => {
    const e = edgeInfo(pt);
    if (e.dist > 0.22 * u) return false;
    // 背後のすぐ上にまだ岩壁が続く所だけ（島の上面のなだらかな高まりは段とみなさない）
    const bx = pt.x - e.dirX * 0.15 * u;
    const bz = pt.z - e.dirZ * 0.15 * u;
    return F(bx, pt.y + 0.45 * u, bz) > 0 && F(bx, pt.y + 0.7 * u, bz) > 0;
  };

  pass = 'trees';
  // ===== 樹木：緩斜面と山頂。森の濃い所ほど間隔が狭く背が高い =====
  const trees = cfg.trees;
  const treeHash = new SpatialHash(0.3 * u);
  const trunkHash = new SpatialHash(0.3 * u);
  const palmHash = new SpatialHash(0.3 * u);
  const palms = cfg.palms;
  const [pMin, pMax] = palms.height.map((v) => v * W);
  const palmColor = new THREE.Color(palms.color);
  const maxTreeSlope = Math.cos(THREE.MathUtils.degToRad(trees.maxSlope));
  const p = new THREE.Vector3();
  const n = new THREE.Vector3();
  const spacing = (trees.spacing * W) / Math.sqrt(density);
  const treeTries = Math.ceil((gentleSampler.total / (spacing * spacing)) * 5);
  const [hMin, hMax] = trees.height.map((v) => v * W);
  for (let k = 0; k < treeTries && gentle.length > 0; k++) {
    gentleSampler.sample(p, n);
    if (n.y < maxTreeSlope) {
      count('tree:slope');
      continue;
    }
    if (mask(p.x, p.y, p.z) < 1) {
      count('tree:mask');
      continue;
    }
    if (terraceAt(p)) {
      count('tree:terrace');
      continue;
    }
    if (trailDist(p.x, p.z) < trailW * 2.2) {
      count('tree:trail');
      continue;
    }
    // ヤシ：森から頭を出す細い幹の木（緩やかな所だけ）
    if (rnd() < palms.fraction && n.y > 0.8) {
      const ph = THREE.MathUtils.lerp(pMin, pMax, rnd());
      const pr = spacing * 0.45;
      if (!palmHash.free(p.x, p.z, pr, 1, 1.2 * u) || !trunkHash.free(p.x, p.z, 0.04 * u, 1, 0.6 * u)) continue;
      const pIdx = Math.floor(rnd() * lib.palms.length);
      q.setFromAxisAngle(up, rnd() * Math.PI * 2);
      const pScale = new THREE.Vector3(ph, ph, ph);
      const pBase = p.clone();
      pBase.y -= 0.01 * u;
      m.compose(pBase, q, pScale);
      if (!crownClear(lib.palms[pIdx], m, ph)) continue;
      palmHash.add(p.x, p.z, pr);
      trunkHash.add(p.x, p.z, 0.04 * u);
      add('palms', pIdx, pBase, q.clone(), pScale, palmColor.clone().multiplyScalar(0.85 + 0.3 * rnd()), up);
      continue;
    }
    const forest = 0.5 + 0.5 * noise.fbm2(p.x / (0.13 * W) + 11.2, p.z / (0.13 * W) - 4.6, 3);
    const edge = edgeInfo(p);
    // 崖の縁は風当たりが強く小さな木、森の濃い所は背が高い
    const rim = smoothstep(0.06 * u, 0.3 * u, edge.dist);
    let t = THREE.MathUtils.clamp(0.15 + trees.heightVariation * (forest - 0.5) * 1.6 + 0.55 * rnd(), 0, 1);
    t *= 0.55 + 0.45 * rim;
    // 急な斜面ほど小さな木
    t *= 0.5 + 0.5 * smoothstep(maxTreeSlope, 0.92, n.y);
    let h = THREE.MathUtils.lerp(hMin, hMax, t);
    // ところどころ森から頭を出す背の高い木（幹と枝の張った樹冠が稜線に見える）
    const emergent = rim > 0.6 && rnd() < trees.emergent;
    if (emergent) h = hMax * (1.35 + 0.35 * rnd());
    const localSpacing = spacing * (1.3 - 0.55 * forest) * (0.75 + 0.45 * (h / hMax));
    const r = localSpacing * 0.5;
    if (!treeHash.free(p.x, p.z, r, 0.92, 1.2 * u)) {
      count('tree:spacing');
      continue;
    }
    // 高い木ほど傘形（枝が横へ張る形）を選びやすい
    const form = emergent ? 1 : t + (rnd() - 0.5) * 0.5;
    const idx = form > 0.55 ? 4 + Math.floor(rnd() * 4) : Math.floor(rnd() * 4);
    const tpl = lib.trees[idx];
    const yaw = rnd() * Math.PI * 2;
    q.setFromAxisAngle(up, yaw);
    // わずかな傾き
    qTilt.setFromEuler(new THREE.Euler((rnd() - 0.5) * 0.08, 0, (rnd() - 0.5) * 0.08));
    q.premultiply(qTilt);
    const wide = trees.crownScale * (0.9 + 0.25 * rnd());
    const scale = new THREE.Vector3(h * wide, h, h * wide);
    // 根元：斜面の低い側でも浮かないように、傾きに合わせて沈める
    const slopeTan = Math.sqrt(Math.max(0, 1 - n.y * n.y)) / Math.max(n.y, 0.2);
    const base = p.clone();
    base.y -= 0.03 * h * wide * slopeTan + 0.008 * u;
    m.compose(base, q, scale);
    if (!crownClear(tpl, m, h)) {
      count('tree:crown');
      continue;
    }
    count('tree:ok');
    treeHash.add(p.x, p.z, r);
    trunkHash.add(p.x, p.z, 0.05 * u);
    add('trees', idx, base, q.clone(), scale, colorAt(p.x, p.z, 'tree'), up);
  }

  pass = 'shrubs';
  // ===== 低木：木の間、崖の上端、やや急な斜面 =====
  const shrubs = cfg.shrubs;
  const shrubHash = new SpatialHash(0.2 * u, true);
  const maxShrubSlope = Math.cos(THREE.MathUtils.degToRad(shrubs.maxSlope));
  const sSpacing = (shrubs.spacing * W) / Math.sqrt(density);
  const shrubTries = Math.ceil((gentleSampler.total / (sSpacing * sSpacing)) * 3);
  const [sMin, sMax] = shrubs.height.map((v) => v * W);
  for (let k = 0; k < shrubTries && gentle.length > 0; k++) {
    gentleSampler.sample(p, n);
    if (n.y < maxShrubSlope) continue;
    if (mask(p.x, p.y, p.z) < 1) continue;
    if (trailDist(p.x, p.z) < trailW * 1.5) continue;
    const onTerrace = terraceAt(p);
    if (onTerrace && lush(p.x, p.y, p.z) < 0.6) continue;
    const h = THREE.MathUtils.lerp(sMin, sMax, rnd()) * (onTerrace ? 0.8 : 1);
    const r = sSpacing * 0.5 * (0.7 + 0.6 * (h / sMax)) * (onTerrace ? 0.75 : 1);
    if (!shrubHash.free(p.x, p.z, r, 0.9, 0.8 * u, p.y)) continue;
    if (!trunkHash.free(p.x, p.z, r * 0.5, 1, 0.6 * u)) continue;
    const idx = Math.floor(rnd() * lib.shrubs.length);
    q.setFromAxisAngle(up, rnd() * Math.PI * 2);
    // 斜面に沿うように少し傾ける
    qTilt.setFromUnitVectors(up, tmpV.copy(up).lerp(n, 0.45).normalize());
    q.premultiply(qTilt);
    const wide = 0.9 + 0.3 * rnd();
    const scale = new THREE.Vector3(h * wide * 1.15, h, h * wide * 1.15);
    const base = p.clone().addScaledVector(n, -0.12 * h);
    m.compose(base, q, scale);
    if (!crownClear(lib.shrubs[idx], m, h)) continue;
    shrubHash.add(p.x, p.z, r, p.y);
    add('shrubs', idx, base, q.clone(), scale, colorAt(p.x, p.z, 'shrub'), n);
  }

  pass = 'rim';
  // ===== 崖の縁の低木：縁から少しはみ出して垂れ、森の端が崖の上に自然にかぶさる =====
  const rimTries = Math.ceil(gentleSampler.total * 60 * density);
  const rimHash = new SpatialHash(0.2 * u, true);
  const outward = new THREE.Vector3();
  const lip = new THREE.Vector3();
  const lipN = new THREE.Vector3();
  for (let k = 0; k < rimTries && gentle.length > 0; k++) {
    gentleSampler.sample(p, n);
    if (n.y < 0.5 || mask(p.x, p.y, p.z) < 1) continue;
    const edge = edgeInfo(p);
    if (edge.dist > 0.12 * u) continue;
    if (!rimHash.free(p.x, p.z, 0.07 * u, 1, 0.4 * u, p.y)) continue;
    if (terraceAt(p) && lush(p.x, p.y, p.z) < 0.6) continue;
    // 縁の角へ寄せる
    lip.set(p.x + edge.dirX * edge.dist * 0.85, p.y - 0.03 * u, p.z + edge.dirZ * edge.dist * 0.85);
    project(lip, lipN);
    if (mask(lip.x, lip.y, lip.z, 0.4) < 1) continue;
    const h = THREE.MathUtils.lerp(sMin, sMax, 0.3 + 0.7 * rnd());
    const idx = Math.floor(rnd() * lib.shrubs.length);
    q.setFromAxisAngle(up, rnd() * Math.PI * 2);
    // 崖の外側へ 30〜55° 傾ける
    outward.set(edge.dirX, 0, edge.dirZ);
    const lean = THREE.MathUtils.degToRad(30 + 25 * rnd());
    qTilt.setFromUnitVectors(up, tmpV.set(0, Math.cos(lean), 0).addScaledVector(outward, Math.sin(lean)));
    q.premultiply(qTilt);
    const wide = 0.9 + 0.35 * rnd();
    const scale = new THREE.Vector3(h * wide * 1.15, h, h * wide * 1.15);
    const base = lip.clone().addScaledVector(lipN, -0.18 * h);
    m.compose(base, q, scale);
    if (!crownClear(lib.shrubs[idx], m, h)) continue;
    rimHash.add(p.x, p.z, 0.07 * u, p.y);
    add('shrubs', idx, base, q.clone(), scale, colorAt(p.x, p.z, 'shrub'), lipN);
  }

  pass = 'drape';
  // ===== 崖の上端から少し下まで垂れかかる緑（森の縁が崖の上部にかぶさる。下端は不揃い） =====
  const drape = cfg.drape;
  const drapeDepth = drape.depth * W;
  const drapeHash = new SpatialHash(0.15 * u, true);
  const drapeTries = Math.ceil(steepSampler.total * 60 * drape.amount * density);
  const hang = new THREE.Vector3();
  const zAxisD = new THREE.Vector3();
  const yAxisD = new THREE.Vector3();
  const xAxisD = new THREE.Vector3();
  const basisD = new THREE.Matrix4();
  for (let k = 0; k < drapeTries && steep.length > 0; k++) {
    steepSampler.sample(p, n);
    if (mask(p.x, p.y, p.z, 0.5) < 1) continue;
    // 崖の上端までの高さ：面のすぐ奥に岩がなくなる高さを探す
    const bx = p.x - n.x * 0.06 * u;
    const bz = p.z - n.z * 0.06 * u;
    let top = -1;
    for (let d = 0.04 * u; d <= drapeDepth * 1.5; d += 0.04 * u) {
      if (F(bx, p.y + d, bz) < 0) {
        top = d;
        break;
      }
    }
    if (top < 0) continue;
    // 本当の上端か（さらに奥の上にも岩がない）。寝た斜面の途中を上端と取り違えない
    if (F(p.x - n.x * 0.32 * u, p.y + top + 0.5 * u, p.z - n.z * 0.32 * u) > 0) continue;
    const reachNoise = 0.5 + 0.5 * noise.fbm2(p.x * 2.4 / u + 5.1, (p.z * 2.4) / u - 2.2, 2);
    const reach = drapeDepth * (0.3 + 1.0 * reachNoise);
    if (top > reach) continue;
    // 縁に近いほど密に、下へ行くほどまばらに（ばらばらの点にならないよう、縁から続く帯にする）
    if (rnd() > Math.pow(1 - top / reach, 1.3) * smoothstep(0.22, 0.55, lush(p.x, p.y, p.z))) continue;
    if (!drapeHash.free(p.x, p.z, 0.04 * u, 1, 0.3 * u, p.y)) continue;
    const useVine = rnd() < 0.35;
    const groupName: TemplateGroup = useVine ? 'vines' : 'shrubs';
    const idx = Math.floor(rnd() * lib[groupName].length);
    const h = useVine
      ? cfg.vines.leafSize * W * (1.1 + 0.6 * rnd())
      : THREE.MathUtils.lerp(sMin, sMax, 0.15 + 0.55 * rnd()) * 0.8;
    if (useVine) {
      // つるの房は崖の面に貼り付ける（z を外向きに）
      zAxisD.copy(n);
      yAxisD.set(0, 1, 0).addScaledVector(zAxisD, -zAxisD.y).normalize();
      xAxisD.crossVectors(yAxisD, zAxisD).normalize();
      q.setFromRotationMatrix(basisD.makeBasis(xAxisD, yAxisD, zAxisD));
    } else {
      // 低木は外へ張り出すように傾ける
      q.setFromAxisAngle(up, rnd() * Math.PI * 2);
      hang.set(n.x, 0, n.z).normalize().multiplyScalar(0.8).add(tmpV.set(0, 0.5, 0)).normalize();
      qTilt.setFromUnitVectors(up, hang);
      q.premultiply(qTilt);
    }
    const scale = new THREE.Vector3(h, h, h);
    const base = p.clone().addScaledVector(n, useVine ? h * 0.15 : -0.12 * h);
    const center = base.clone().addScaledVector(useVine ? n : hang, h * 0.5);
    if (F(center.x, center.y, center.z) > 0) continue;
    drapeHash.add(p.x, p.z, 0.045 * u, p.y);
    add(groupName, idx, base, q.clone(), scale, colorAt(p.x, p.z, useVine ? 'vine' : 'shrub'), n, surfaceProbe(p, n, h));
  }

  pass = 'ground';
  // ===== 地表を覆う草：上面と緩斜面の地面を埋める =====
  const ground = cfg.ground;
  const groundHash = new SpatialHash(0.15 * u, true);
  const gSpacing = (ground.spacing * W) / Math.sqrt(density);
  const groundTries = Math.ceil((gentleSampler.total / (gSpacing * gSpacing)) * 2.5);
  const [gMin, gMax] = ground.height.map((v) => v * W);
  const maxGroundSlope = Math.cos(THREE.MathUtils.degToRad(ground.maxSlope));
  for (let k = 0; k < groundTries && gentle.length > 0; k++) {
    gentleSampler.sample(p, n);
    if (n.y < maxGroundSlope) continue;
    if (mask(p.x, p.y, p.z) < 1) continue;
    if (trailDist(p.x, p.z) < trailW * 0.8) continue;
    if (terraceAt(p) && lush(p.x, p.y, p.z) < 0.6) continue;
    const h = THREE.MathUtils.lerp(gMin, gMax, rnd());
    const tpl = lib.ground[Math.floor(rnd() * lib.ground.length)];
    const r = tpl.radius * h * 0.75;
    if (!groundHash.free(p.x, p.z, r, 0.8, 0.5 * u, p.y)) continue;
    const idx = lib.ground.indexOf(tpl);
    q.setFromAxisAngle(up, rnd() * Math.PI * 2);
    qTilt.setFromUnitVectors(up, n);
    q.premultiply(qTilt);
    const scale = new THREE.Vector3(h, h, h);
    const base = p.clone().addScaledVector(n, -0.15 * h);
    groundHash.add(p.x, p.z, r, p.y);
    add('ground', idx, base, q.clone(), scale, colorAt(p.x, p.z, 'ground'), n, surfaceProbe(p, n, h));
  }

  pass = 'ledges';
  // ===== 崖の段差と割れ目の草むら（岩肌が見えるよう、まばらに） =====
  const ledgeCfg = cfg.ledges;
  const ledgeHash = new SpatialHash(0.2 * u, true);
  const [lMin, lMax] = ledgeCfg.height.map((v) => v * W);
  const ledgeTries = Math.ceil(ledgeSampler.total * 4 * ledgeCfg.amount * density);
  const behind = new THREE.Vector3();
  for (let k = 0; k < ledgeTries && ledges.length > 0; k++) {
    ledgeSampler.sample(p, n);
    if (n.y < 0.4) continue;
    if (mask(p.x, p.y, p.z, 0.4) < 1) continue;
    if (lush(p.x, p.y, p.z) < 0.6) continue;
    // 崖の途中の段差：背後の上方にまだ岩がある所だけ（山頂の緩斜面は除く）
    behind.set(p.x - n.x * 0.12 * u, p.y + 0.3 * u, p.z - n.z * 0.12 * u);
    if (F(behind.x, behind.y, behind.z) <= 0) continue;
    const h = THREE.MathUtils.lerp(lMin, lMax, rnd());
    if (!ledgeHash.free(p.x, p.z, 0.08 * u, 1, 0.4 * u, p.y)) continue;
    const useShrub = rnd() < 0.3;
    const groupName: TemplateGroup = useShrub ? 'shrubs' : 'tufts';
    const idx = Math.floor(rnd() * lib[groupName].length);
    q.setFromAxisAngle(up, rnd() * Math.PI * 2);
    qTilt.setFromUnitVectors(up, tmpV.copy(up).lerp(n, 0.35).normalize());
    q.premultiply(qTilt);
    const s = useShrub ? h * 0.8 : h;
    const scale = new THREE.Vector3(s, s, s);
    const base = p.clone().addScaledVector(n, -0.1 * s);
    ledgeHash.add(p.x, p.z, 0.08 * u, p.y);
    const col = colorAt(p.x, p.z, 'shrub');
    add(groupName, idx, base, q.clone(), scale, col, n, surfaceProbe(p, n, s));
    // 段に沿って横へ数株つなげ、層に沿った小さな帯にする
    const along = new THREE.Vector3(-n.z, 0, n.x);
    if (along.lengthSq() < 1e-6) along.set(1, 0, 0);
    along.normalize();
    const bandLen = 1 + Math.floor(rnd() * 5);
    for (const sign of [1, -1]) {
      const ep = p.clone();
      const en = new THREE.Vector3();
      for (let e = 0; e < bandLen; e++) {
        ep.addScaledVector(along, sign * (0.05 + 0.04 * rnd()) * u);
        project(ep, en);
        if (en.y < 0.25 || mask(ep.x, ep.y, ep.z, 0.4) < 1) break;
        const es = s * (0.55 + 0.45 * rnd());
        const useS = rnd() < 0.25;
        const g: TemplateGroup = useS ? 'shrubs' : 'tufts';
        const eIdx = Math.floor(rnd() * lib[g].length);
        q.setFromAxisAngle(up, rnd() * Math.PI * 2);
        qTilt.setFromUnitVectors(up, tmpV.copy(up).lerp(en, 0.4).normalize());
        q.premultiply(qTilt);
        const sz = useS ? es * 0.8 : es;
        const eb = ep.clone().addScaledVector(en, -0.1 * sz);
        add(g, eIdx, eb, q.clone(), new THREE.Vector3(sz, sz, sz), col.clone().multiplyScalar(0.94 + 0.12 * rnd()), en, surfaceProbe(ep, en, sz));
      }
    }
  }
  pass = 'cracks';
  const crackTries = Math.ceil(steepSampler.total * 2.5 * ledgeCfg.amount * density);
  const crackHash = new SpatialHash(0.2 * u, true);
  for (let k = 0; k < crackTries && steep.length > 0; k++) {
    steepSampler.sample(p, n);
    if (shape.crackAt(p.x, p.z) < 0.65) continue;
    if (mask(p.x, p.y, p.z, 0.4) < 1) continue;
    if (!crackHash.free(p.x, p.z, 0.1 * u, 1, 0.4 * u, p.y) || !ledgeHash.free(p.x, p.z, 0.06 * u, 1, 0.4 * u, p.y)) continue;
    const h = THREE.MathUtils.lerp(lMin, lMax, rnd()) * 0.85;
    const idx = Math.floor(rnd() * lib.tufts.length);
    // 割れ目から外へ伸び、先は上を向く
    q.setFromAxisAngle(up, rnd() * Math.PI * 2);
    qTilt.setFromUnitVectors(up, tmpV.copy(up).lerp(n, 0.6).normalize());
    q.premultiply(qTilt);
    const scale = new THREE.Vector3(h, h, h);
    const base = p.clone().addScaledVector(n, -0.12 * h);
    crackHash.add(p.x, p.z, 0.1 * u, p.y);
    add('tufts', idx, base, q.clone(), scale, colorAt(p.x, p.z, 'shrub'), n, surfaceProbe(p, n, h));
  }

  pass = 'vines';
  // ===== つる植物：崖の上端から岩壁に沿って垂れ下がる =====
  const vines = cfg.vines;
  const [vMin, vMax] = vines.length.map((v) => v * W);
  const leaf = vines.leafSize * W;
  const vineGroups = Math.round(vines.amount * vines.groups * density);
  const vinePos = new THREE.Vector3();
  const vineN = new THREE.Vector3();
  const tangent = new THREE.Vector3();
  const zAxis = new THREE.Vector3();
  const xAxis = new THREE.Vector3();
  const yAxis = new THREE.Vector3();
  const basis = new THREE.Matrix4();
  let made = 0;
  for (let k = 0; k < vineGroups * 40 && made < vineGroups && gentle.length > 0; k++) {
    gentleSampler.sample(p, n);
    if (n.y < 0.55 || mask(p.x, p.y, p.z) < 1) continue;
    const edge = edgeInfo(p);
    if (edge.dist > 0.16 * u) continue;
    // 崖の途中の段から垂れるつるは茂った所だけ。山頂の縁は大半の場所から垂れる
    if (lush(p.x, p.y, p.z) < (terraceAt(p) ? 0.68 : 0.28)) continue;
    made++;
    const strands = 3 + Math.floor(rnd() * 5);
    tangent.set(-edge.dirZ, 0, edge.dirX);
    for (let sIdx = 0; sIdx < strands; sIdx++) {
      const off = (rnd() - 0.5) * 0.42 * u;
      vinePos.set(p.x + edge.dirX * edge.dist + tangent.x * off, p.y - 0.02 * u, p.z + edge.dirZ * edge.dist + tangent.z * off);
      project(vinePos, vineN);
      const length = THREE.MathUtils.lerp(vMin, vMax, Math.pow(rnd(), 1.4));
      const step = leaf * 0.75;
      const steps = Math.ceil(length / step);
      const wiggle = rnd() * 10;
      for (let st = 0; st < steps; st++) {
        vinePos.y -= step;
        vinePos.addScaledVector(tangent, noise.noise2(wiggle, st * 0.35) * 0.25 * step);
        // 崖の面へ寄せる（張り出しの下では面の外にとどまる）
        project(vinePos, vineN);
        if (vineN.y > 0.7 && st > 2) break; // 段差に届いたら止まる
        if (mask(vinePos.x, vinePos.y, vinePos.z, 0.6) < 1) break;
        const taper = 1 - 0.45 * (st / steps);
        const sz = leaf * (0.75 + 0.5 * rnd()) * taper;
        // 向き：z を崖の外向き、y を上向き（崖の面に沿う）
        zAxis.copy(vineN);
        yAxis.set(0, 1, 0).addScaledVector(zAxis, -zAxis.y).normalize();
        if (yAxis.lengthSq() < 1e-6) yAxis.set(0, 0, 1);
        xAxis.crossVectors(yAxis, zAxis).normalize();
        basis.makeBasis(xAxis, yAxis, zAxis);
        q.setFromRotationMatrix(basis);
        qTilt.setFromAxisAngle(zAxis, (rnd() - 0.5) * 0.9);
        q.premultiply(qTilt);
        const pos = vinePos.clone().addScaledVector(vineN, sz * 0.2);
        const idx = Math.floor(rnd() * lib.vines.length);
        add('vines', idx, pos, q.clone(), new THREE.Vector3(sz, sz, sz), colorAt(pos.x, pos.z, 'vine'), vineN, surfaceProbe(pos, vineN, sz));
      }
    }
  }

  return out;
}
