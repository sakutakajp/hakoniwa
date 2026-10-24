import * as THREE from 'three';
import type { SceneConfig } from '../config';
import { Noise } from '../noise';

/**
 * 地面の塊の形（上面の高さ）と、川の位置・水面の高さ・砂地などの範囲。
 *  - 地面（ground）：森の地面の高さ。奥がわずかに高く、右奥の滝の上は一段高い台地になる
 *  - 川：流れに沿った中心線（なめらかな曲線）からの横の距離で、U 字の谷を削る。水面は上流から 3 段（2 つの滝）
 *  - 岸：水際から地面の高さまで上がる斜面（左岸は広い砂浜、右岸は短い土手）
 * 形は関数として直接求められ（メッシュの頂点ごと）、格子にも焼いて補間で速く読める（植物や岩の配置）。
 */

export interface RiverFrame {
  /** 流れに沿った距離（上流の端から） */
  s: number;
  /** 中心線からの横の距離（画面の左が負） */
  d: number;
  /** 中心線からの距離（符号なし） */
  dist: number;
  /** その場所の水面の高さ */
  level: number;
  /** 水際までの幅（d の側） */
  w: number;
  /** 水面から川底までの深さ（中心で） */
  depth: number;
  /** 壁の切り立ち（1 で垂直） */
  cut: number;
  /** 岸の斜面の幅（d の側） */
  bank: number;
  /** 流れの向き（下流へ、単位ベクトル） */
  tx: number;
  tz: number;
  /** 水際からの距離（水の中が正、岸の側が負） */
  e: number;
  /** 左右（-1 が左岸の側、+1 が右岸の側。川の中ほどでなめらかに変わる） */
  side: number;
}

export interface TerrainSample {
  /** 上面の高さ */
  height: number;
  /** 川で削る前の地面の高さ（断面の表土の厚みの基準） */
  ground: number;
  /** 水面の高さ（川の中・岸の近くだけ。それ以外は -Infinity） */
  water: number;
  /** 川の水の中か（0〜1。水際でなめらか） */
  wet: number;
  /** 砂地らしさ（0〜1） */
  sand: number;
}

const smoothstep = (a: number, b: number, v: number) => {
  const t = Math.min(1, Math.max(0, (v - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/** 閉じた多角形までの符号付き距離（内側が正） */
export function polygonInside(px: number, pz: number, pts: readonly (readonly [number, number])[]): number {
  const n = pts.length;
  let best = Infinity;
  let s = 1;
  for (let i = 0, j = n - 1; i < n; j = i, i++) {
    const [xi, zi] = pts[i];
    const [xj, zj] = pts[j];
    const ex = xj - xi;
    const ez = zj - zi;
    const wx = px - xi;
    const wz = pz - zi;
    const t = Math.min(1, Math.max(0, (wx * ex + wz * ez) / (ex * ex + ez * ez)));
    const bx = wx - ex * t;
    const bz = wz - ez * t;
    best = Math.min(best, bx * bx + bz * bz);
    const c1 = pz >= zi;
    const c2 = pz < zj;
    const c3 = ex * wz > ez * wx;
    if ((c1 && c2 && c3) || (!c1 && !c2 && !c3)) s = -s;
  }
  return -s * Math.sqrt(best);
}

/** 角丸正方形の内側か（外周までの距離、内側が正） */
export function roundedSquareInside(x: number, z: number, half: number, radius: number): number {
  const qx = Math.abs(x) - (half - radius);
  const qz = Math.abs(z) - (half - radius);
  const outside = Math.hypot(Math.max(qx, 0), Math.max(qz, 0)) + Math.min(Math.max(qx, qz), 0) - radius;
  return -outside;
}

/** 川の中心線（なめらかな曲線を細かく区切った点の列）と、近い点を速く探すための区画 */
class RiverLine {
  readonly xs: Float64Array;
  readonly zs: Float64Array;
  readonly ss: Float64Array;
  /** 点ごとの値 [左の幅, 右の幅, 深さ, 切り立ち, 左岸, 右岸] */
  readonly params: Float64Array;
  readonly count: number;
  readonly length: number;
  private readonly cell: number;
  private readonly buckets = new Map<number, number[]>();
  /** 区画を探す範囲（この距離より遠い点は川の影響を受けない） */
  readonly reach: number;

  constructor(nodes: readonly (readonly number[])[], step: number) {
    // Catmull-Rom 曲線で点のあいだを補間する
    const pts: number[][] = [];
    const n = nodes.length;
    for (let i = 0; i < n - 1; i++) {
      const p0 = nodes[Math.max(0, i - 1)];
      const p1 = nodes[i];
      const p2 = nodes[i + 1];
      const p3 = nodes[Math.min(n - 1, i + 2)];
      const segLen = Math.hypot(p2[0] - p1[0], p2[1] - p1[1]);
      const k = Math.max(2, Math.ceil(segLen / step));
      for (let j = 0; j < k; j++) {
        const t = j / k;
        const t2 = t * t;
        const t3 = t2 * t;
        const cr = (a: number, b: number, c: number, d: number) =>
          0.5 * (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3);
        const row = [cr(p0[0], p1[0], p2[0], p3[0]), cr(p0[1], p1[1], p2[1], p3[1])];
        // 幅・深さなどは、隣り合う点のあいだをなめらかにつなぐ
        const u = t * t * (3 - 2 * t);
        for (let q = 2; q < p1.length; q++) row.push(p1[q] + (p2[q] - p1[q]) * u);
        pts.push(row);
      }
    }
    pts.push([...nodes[n - 1]]);
    this.count = pts.length;
    this.xs = new Float64Array(this.count);
    this.zs = new Float64Array(this.count);
    this.ss = new Float64Array(this.count);
    this.params = new Float64Array(this.count * 6);
    let s = 0;
    let reach = 0;
    for (let i = 0; i < this.count; i++) {
      const p = pts[i];
      if (i > 0) s += Math.hypot(p[0] - pts[i - 1][0], p[1] - pts[i - 1][1]);
      this.xs[i] = p[0];
      this.zs[i] = p[1];
      this.ss[i] = s;
      for (let q = 0; q < 6; q++) this.params[i * 6 + q] = p[2 + q];
      reach = Math.max(reach, Math.max(p[2] + p[6], p[3] + p[7]));
    }
    this.length = s;
    this.reach = reach + 0.3;
    this.cell = 0.5;
    for (let i = 0; i < this.count; i++) {
      const key = this.key(Math.floor(this.xs[i] / this.cell), Math.floor(this.zs[i] / this.cell));
      const b = this.buckets.get(key);
      if (b) b.push(i);
      else this.buckets.set(key, [i]);
    }
  }

  private key(i: number, j: number) {
    return (i + 512) * 2048 + (j + 512);
  }

  /** いちばん近い点の番号（reach より遠ければ -1） */
  nearest(x: number, z: number): number {
    const ci = Math.floor(x / this.cell);
    const cj = Math.floor(z / this.cell);
    const r = Math.ceil(this.reach / this.cell);
    let best = -1;
    let bestD = this.reach * this.reach;
    for (let dj = -r; dj <= r; dj++) {
      for (let di = -r; di <= r; di++) {
        const b = this.buckets.get(this.key(ci + di, cj + dj));
        if (!b) continue;
        for (const i of b) {
          const dx = this.xs[i] - x;
          const dz = this.zs[i] - z;
          const d = dx * dx + dz * dz;
          if (d < bestD) {
            bestD = d;
            best = i;
          }
        }
      }
    }
    return best;
  }
}

const SIDE_BLEND = 0.3;

/**
 * 川の範囲を、中心線の点ごとの円（左右で半径が違う）を重ねた形として求める。
 * 円の中への入り込み（e = 半径 − 距離）のいちばん大きい値が、その場所の「水際からの距離」になる（どこでも連続）。
 * 幅・深さ・流れに沿った距離などは、e の大きい点ほど重く平均する（川の曲がり角でも値が飛ばない）
 */
class RiverField {
  private readonly n: number;
  private readonly xs: Float64Array;
  private readonly zs: Float64Array;
  private readonly tx: Float64Array;
  private readonly tz: Float64Array;
  private readonly ss: Float64Array;
  private readonly p: Float64Array;
  private readonly reach: Float64Array;
  private readonly cell = 0.25;
  private readonly lists = new Map<number, Int32Array>();
  private readonly tau: number;
  private readonly sc = { e: new Float64Array(0), b: new Float64Array(0), idx: new Int32Array(0) };

  constructor(line: RiverLine, stride: number, extra: number, tau: number) {
    const ids: number[] = [];
    for (let i = 0; i < line.count; i += stride) ids.push(i);
    if (ids[ids.length - 1] !== line.count - 1) ids.push(line.count - 1);
    this.n = ids.length;
    this.tau = tau;
    this.xs = new Float64Array(this.n);
    this.zs = new Float64Array(this.n);
    this.tx = new Float64Array(this.n);
    this.tz = new Float64Array(this.n);
    this.ss = new Float64Array(this.n);
    this.p = new Float64Array(this.n * 6);
    this.reach = new Float64Array(this.n);
    const tmp = new Map<number, number[]>();
    ids.forEach((li, k) => {
      const a = Math.max(0, li - 2);
      const b = Math.min(line.count - 1, li + 2);
      let tx = line.xs[b] - line.xs[a];
      let tz = line.zs[b] - line.zs[a];
      const tl = Math.hypot(tx, tz) || 1;
      tx /= tl;
      tz /= tl;
      this.xs[k] = line.xs[li];
      this.zs[k] = line.zs[li];
      this.tx[k] = tx;
      this.tz[k] = tz;
      this.ss[k] = line.ss[li];
      for (let q = 0; q < 6; q++) this.p[k * 6 + q] = line.params[li * 6 + q];
      const P = line.params;
      const R = Math.max(P[li * 6], P[li * 6 + 1]) + Math.max(P[li * 6 + 4], P[li * 6 + 5]) + extra;
      this.reach[k] = R;
      const i0 = Math.floor((this.xs[k] - R) / this.cell);
      const i1 = Math.floor((this.xs[k] + R) / this.cell);
      const j0 = Math.floor((this.zs[k] - R) / this.cell);
      const j1 = Math.floor((this.zs[k] + R) / this.cell);
      for (let j = j0; j <= j1; j++) {
        for (let i = i0; i <= i1; i++) {
          const key = this.key(i, j);
          const l = tmp.get(key);
          if (l) l.push(k);
          else tmp.set(key, [k]);
        }
      }
    });
    let longest = 0;
    for (const [key, l] of tmp) {
      this.lists.set(key, Int32Array.from(l));
      longest = Math.max(longest, l.length);
    }
    this.sc = { e: new Float64Array(longest), b: new Float64Array(longest), idx: new Int32Array(longest) };
  }

  private key(i: number, j: number) {
    return (i + 1024) * 4096 + (j + 1024);
  }

  /** その場所の川の値。川から遠ければ false */
  query(x: number, z: number, out: { e: number; w: number; side: number; s: number; tx: number; tz: number; depth: number; cut: number; bank: number }): boolean {
    const list = this.lists.get(this.key(Math.floor(x / this.cell), Math.floor(z / this.cell)));
    if (!list) return false;
    const { e: E, b: B, idx: I } = this.sc;
    let m = 0;
    let emax = -Infinity;
    for (let q = 0; q < list.length; q++) {
      const k = list[q];
      const vx = x - this.xs[k];
      const vz = z - this.zs[k];
      const r = Math.hypot(vx, vz);
      if (r > this.reach[k]) continue;
      // 横の向き（右が +）：右の岸ほど右の幅
      const c = r > 1e-6 ? (vx * this.tz[k] - vz * this.tx[k]) / r : 0;
      const b = smoothstep(-SIDE_BLEND, SIDE_BLEND, c);
      const w = this.p[k * 6] + (this.p[k * 6 + 1] - this.p[k * 6]) * b;
      const e = w - r;
      E[m] = e;
      B[m] = b;
      I[m] = k;
      m++;
      if (e > emax) emax = e;
    }
    if (m === 0) return false;
    const cutoff = emax - 7 * this.tau;
    let W = 0;
    let sw = 0;
    let sb = 0;
    let ss = 0;
    let stx = 0;
    let stz = 0;
    let sd = 0;
    let scut = 0;
    let sbank = 0;
    for (let q = 0; q < m; q++) {
      if (E[q] < cutoff) continue;
      const k = I[q];
      const om = Math.exp((E[q] - emax) / this.tau);
      const b = B[q];
      const P = this.p;
      W += om;
      sw += om * (P[k * 6] + (P[k * 6 + 1] - P[k * 6]) * b);
      sb += om * (2 * b - 1);
      ss += om * (this.ss[k] + (x - this.xs[k]) * this.tx[k] + (z - this.zs[k]) * this.tz[k]);
      stx += om * this.tx[k];
      stz += om * this.tz[k];
      sd += om * P[k * 6 + 2];
      scut += om * P[k * 6 + 3];
      sbank += om * (P[k * 6 + 4] + (P[k * 6 + 5] - P[k * 6 + 4]) * b);
    }
    const tl = Math.hypot(stx, stz) || 1;
    out.e = emax;
    out.w = sw / W;
    out.side = sb / W;
    out.s = ss / W;
    out.tx = stx / tl;
    out.tz = stz / tl;
    out.depth = sd / W;
    out.cut = scut / W;
    out.bank = sbank / W;
    return true;
  }
}

export interface TerrainLayout {
  /** 土台の上面（地面の塊の底） */
  yBase: number;
  half: number;
  cornerRadius: number;
  /** 水面の高さ（上流から） */
  levels: number[];
  /** その場所の値をまとめて求める（関数で直接） */
  sample: (x: number, z: number, out?: TerrainSample) => TerrainSample;
  /** 川の中心線からの位置（川から遠ければ null） */
  riverFrame: (x: number, z: number) => RiverFrame | null;
  /** 格子に焼いた値を補間で読む（速い） */
  heightAt: (x: number, z: number) => number;
  groundAt: (x: number, z: number) => number;
  waterAt: (x: number, z: number) => number;
  sandAt: (x: number, z: number) => number;
  /** 水の中か（0〜1） */
  wetAt: (x: number, z: number) => number;
  /** 水面の高さの格子値（川の外は -1） */
  /** 滝の位置（上の水面・下の水面・流れの向き・幅） */
  falls: { x: number; z: number; top: number; bottom: number; tx: number; tz: number; width: number; s: number }[];
  /** 川の中心線（水の流れの向きなどに使う） */
  line: { xs: Float64Array; zs: Float64Array; ss: Float64Array; count: number; length: number };
  /** 上面の高さのテクスチャ（中心 0、一辺 size。u: +x、v: -z。焼き込みの起伏と岩の根元の砂に使う） */
  heightTexture: (size: number, resolution: number) => THREE.DataTexture;
  /**
   * 地面の色分けのテクスチャ（同じ範囲）：R = 砂地らしさ、G = 滝のしぶきのかかる所、B = 水際の近さ（水際から離れるほど 0）、
   * A = 水面の高さ（川の外は 0。水面のシェーダーで使う）を 0〜1 に収めた値
   */
  maskTexture: (size: number, resolution: number) => THREE.DataTexture;
  /** 水面の高さを 0〜1 に収めるための範囲 */
  levelRange: [number, number];
}

export function createTerrainLayout(config: SceneConfig): TerrainLayout {
  const ped = config.pedestal;
  const W = ped.size;
  const half = W / 2;
  const t = config.terrain;
  const rv = config.river;
  const yBase = ped.thickness;
  const noise = new Noise(91);
  const line = new RiverLine(rv.path, 0.02);
  const levels = rv.levels.slice();

  // 滝：中心線の上の位置（流れに沿った距離）
  const fallS = rv.falls.map(([fx, fz]) => {
    const i = line.nearest(fx, fz);
    return i >= 0 ? line.ss[i] : 0;
  });
  const lastFallS = fallS.length > 0 ? Math.max(...fallS) : -Infinity;
  const levelAtS = (s: number) => {
    let k = 0;
    for (let i = 0; i < fallS.length; i++) if (s > fallS[i]) k = i + 1;
    return levels[Math.min(k, levels.length - 1)];
  };

  // 台地の段の線（x の関数として z を補間）
  const ledge = t.plateau.ledge;
  const ledgeZ = (x: number) => {
    if (x <= ledge[0][0]) return ledge[0][1];
    for (let i = 0; i < ledge.length - 1; i++) {
      const [x0, z0] = ledge[i];
      const [x1, z1] = ledge[i + 1];
      if (x <= x1) return z0 + ((x - x0) / (x1 - x0)) * (z1 - z0);
    }
    return ledge[ledge.length - 1][1];
  };

  /** 川で削る前の地面の高さ */
  const groundRaw = (x: number, z: number) => {
    let h = t.ground;
    h += t.backRise * smoothstep(-1.5, -5, z);
    h -= t.frontRightDrop * smoothstep(1.0, 4.0, x) * smoothstep(1.5, 5.0, z);
    h += t.undulation.amount * noise.fbm2(x / t.undulation.size + 3.1, z / t.undulation.size - 7.4, 3);
    h += t.roughness.amount * noise.fbm2(x / t.roughness.size - 11.3, z / t.roughness.size + 2.9, 2);
    for (const [mx, mz, mr, mh] of t.mounds) {
      const d = Math.hypot(x - mx, z - mz) / mr;
      if (d < 1) h += mh * (1 - d * d) * (1 - d * d);
    }
    // 右奥の台地（滝の上）
    const p = t.plateau;
    const behind = ledgeZ(x) - z;
    // 段の線をわずかにゆらして、まっすぐな崖にしない
    const wob = 0.06 * noise.noise2(x * 1.7 + 4.2, 0.3);
    h += p.height * smoothstep(-p.edge * 0.5, p.edge * 0.5, behind + wob) * smoothstep(p.fadeLeft[0], p.fadeLeft[1], x);
    return h;
  };

  const field = new RiverField(line, 3, 0.5, 0.08);
  const fq = { e: 0, w: 0, side: 0, s: 0, tx: 0, tz: 1, depth: 0, cut: 0, bank: 0 };
  const wobble = rv.shoreWobble;
  const frameAt = (x: number, z: number): RiverFrame | null => {
    if (!field.query(x, z, fq)) return null;
    // 水際のゆらぎ：流れに沿って左右別々に、小さな入り江と出っ張りを付ける（滝のまわりは付けない）。
    // 左右の値は side でなめらかにつなぐ（川の中ほどで値が飛ばないように）
    if (wobble.amount > 0) {
      const k = smoothstep(lastFallS + 0.2, lastFallS + 0.9, fq.s);
      const wl = noise.fbm2(fq.s / wobble.size + 3.1, 0.37, 2);
      const wr = noise.fbm2(fq.s / wobble.size + 17.3, 5.81, 2);
      fq.e += wobble.amount * k * (wl + (wr - wl) * (fq.side * 0.5 + 0.5));
    }
    // 中心線からの距離のめやす（中心 0、水際で w）。画面の左（流れが手前へ向かうとき -x の側）が負
    const dist = Math.max(0, fq.w - fq.e);
    return {
      s: fq.s,
      d: fq.side < 0 ? -dist : dist,
      dist,
      level: levelAtS(fq.s),
      w: fq.w,
      depth: fq.depth,
      cut: fq.cut,
      bank: fq.bank,
      tx: fq.tx,
      tz: fq.tz,
      e: fq.e,
      side: fq.side,
    };
  };

  /** 川の断面の深さの割合（中心 1、水際 0）。t は水際までの割合、cut は切り立ち、round は壁の丸み */
  const profile = (tt: number, cut: number, round: number) => {
    if (tt >= 1) return 0;
    const soft = 1 - smoothstep(0.22, 1.0, tt);
    const t0 = 1 - round;
    const hard = tt <= t0 ? 1 : Math.sqrt(Math.max(0, 1 - ((tt - t0) / round) ** 2));
    return soft + (hard - soft) * cut;
  };

  const sandPoly = t.sand.clearing;
  const sample = (x: number, z: number, out?: TerrainSample): TerrainSample => {
    const o = out ?? { height: 0, ground: 0, water: -Infinity, wet: 0, sand: 0 };
    const g = groundRaw(x, z);
    let h = g;
    let water = -Infinity;
    let wet = 0;
    let beach = 0;
    const f = frameAt(x, z);
    if (f) {
      const L = f.level;
      // 左岸らしさ（川の中ほどでなめらかに右岸へ移る）
      const leftness = smoothstep(0.3, -0.3, f.side);
      if (f.e > 0) {
        // 川の中：U 字の谷（左の壁はほぼ垂直、右の壁は下の方で丸く川底へ曲がる）
        const round = rv.poolRound + (0.05 - rv.poolRound) * leftness;
        // 手前の切り口のすぐ奥では、右の壁を切り立たせる（断面に川の形がはっきり出るように）。
        // 左は砂浜から続く浅い棚のまま、なだらかに深くなる
        const faceK = smoothstep(half - 0.5, half - 0.12, z);
        const cutL = Math.max(f.cut, 0.3 * faceK);
        const cutR = Math.max(f.cut, faceK);
        const cut = cutR + (cutL - cutR) * leftness;
        const k = profile(Math.min(1, Math.max(0, 1 - f.e / f.w)), cut, Math.max(round, 0.05 + 0.4 * (1 - cut)));
        const und = rv.bedUndulation * noise.fbm2(x * 1.3 - 4.4, z * 1.3 + 8.8, 2) * k;
        h = Math.min(g, L - f.depth * k + und - 0.004);
        water = L;
        wet = 1;
      } else {
        // 岸：水際から地面の高さまでの斜面
        const e = -f.e;
        // 右岸の砂地：水際に沿って、ところどころ（まだらに）
        const rs = t.sand.right;
        const rPatch = smoothstep(rs.patch[0], rs.patch[1], noise.fbm2(x * rs.patchSize + 5.3, z * rs.patchSize - 1.9, 2));
        const rWob = 0.05 * noise.fbm2(x * 4.1 - 2.2, z * 4.1 + 6.4, 2);
        const right = (1 - leftness) * rPatch * (1 - smoothstep(rs.width * 0.5, rs.width, e + rWob));
        // 砂浜は滝の下の川だけ（滝のまわりの斜面は苔と岩）
        const below = smoothstep(lastFallS + 0.1, lastFallS + 0.7, f.s);
        // 右岸の砂地の所は岸の斜面を広げて、なだらかな砂の岸にする
        const rightSand = rPatch * (1 - leftness) * below;
        const bank = f.bank * (1 + rs.widen * rightSand);
        if (e < bank && g > L) {
          const u = smoothstep(0, bank, e);
          // 砂浜はなだらかに（はじめゆっくり上がる）
          const ex = 0.8 + 0.55 * Math.max(leftness * below, rightSand * 0.8);
          const bankH = L + 0.004 + (g - L) * Math.pow(u, ex);
          h = Math.min(g, bankH);
        }
        // 滝の斜面で地面が池の水面より低い所：水際に低い土手を残して水をせき止める（土手の外へ水は広がらない）
        const lip = 0.035;
        if (g < L + lip && e < 0.16) {
          const rim = L + 0.004 + lip * (1 - smoothstep(0.05, 0.16, e)) * smoothstep(0, 0.04, e);
          h = Math.max(h, rim);
        }
        // 岸の水面の高さ（濡れた砂の帯・泡に使う）。水面より低い陸（土手の外）には水を張らない
        if (e < f.bank + 0.4 && h > L - 0.001) water = L;
        beach = Math.max(leftness * (1 - smoothstep(t.sand.beachWidth * 0.6, t.sand.beachWidth * 1.3, e)), right * rs.amount) * below;
      }
    }
    // 砂地：左岸の砂浜と、林の中の開けた砂地（境目はゆらす）
    const wob = 0.18 * noise.fbm2(x * 1.6 + 1.7, z * 1.6 - 5.2, 3);
    const clearing = smoothstep(-t.sand.edge, t.sand.edge, polygonInside(x, z, sandPoly) + wob);
    o.height = h;
    o.ground = g;
    o.water = water;
    o.wet = wet;
    // 開けた所は砂と草の混ざった地面（草のまだらと、砂の多い所がまじる）、川岸の砂浜は明るい砂
    const patch = smoothstep(-0.25, 0.3, noise.fbm2(x * 1.15 - 7.3, z * 1.15 + 2.9, 3));
    o.sand = Math.max(clearing * (0.32 + 0.4 * patch), beach * smoothstep(-0.4, 0.2, wob + 0.1));
    return o;
  };

  // ===== 格子に焼く（植物や岩の配置・テクスチャ用） =====
  const res = 512;
  const ext = half + 0.1;
  const cell = (2 * ext) / (res - 1);
  const H = new Float32Array(res * res);
  const G = new Float32Array(res * res);
  const Wl = new Float32Array(res * res);
  const S = new Float32Array(res * res);
  const Wet = new Float32Array(res * res);
  /** 水際からの距離（陸の側。水の中は 0、川から遠い所は大きな値） */
  const ED = new Float32Array(res * res);
  const tmp: TerrainSample = { height: 0, ground: 0, water: -Infinity, wet: 0, sand: 0 };
  for (let j = 0; j < res; j++) {
    const z = -ext + j * cell;
    for (let i = 0; i < res; i++) {
      const x = -ext + i * cell;
      sample(x, z, tmp);
      const k = i + j * res;
      H[k] = tmp.height;
      G[k] = tmp.ground;
      Wl[k] = Number.isFinite(tmp.water) ? tmp.water : -1;
      S[k] = tmp.sand;
      Wet[k] = tmp.water > tmp.height ? 1 : 0;
      const fr = frameAt(x, z);
      ED[k] = fr ? Math.max(0, -fr.e) : 9;
    }
  }
  const read = (grid: Float32Array, x: number, z: number) => {
    const gx = Math.min(Math.max((x + ext) / cell, 0), res - 1.001);
    const gz = Math.min(Math.max((z + ext) / cell, 0), res - 1.001);
    const ix = gx | 0;
    const iz = gz | 0;
    const fx = gx - ix;
    const fz = gz - iz;
    const k = ix + iz * res;
    return (grid[k] * (1 - fx) + grid[k + 1] * fx) * (1 - fz) + (grid[k + res] * (1 - fx) + grid[k + res + 1] * fx) * fz;
  };

  const falls = rv.falls.map(([fx, fz], i) => {
    const f = frameAt(fx, fz)!;
    return {
      x: fx,
      z: fz,
      top: levels[i],
      bottom: levels[i + 1],
      tx: f.tx,
      tz: f.tz,
      width: f.w * 2,
      s: fallS[i],
    };
  });

  const levelRange: [number, number] = [yBase, Math.max(...levels) + 0.5];
  const texture = (size: number, resolution: number, channels: 1 | 4, fn: (x: number, z: number, out: number[]) => void) => {
    const data = channels === 1 ? new Float32Array(resolution * resolution) : new Uint8Array(resolution * resolution * 4);
    const v = [0, 0, 0, 0];
    for (let j = 0; j < resolution; j++) {
      const z = (0.5 - (j + 0.5) / resolution) * size;
      for (let i = 0; i < resolution; i++) {
        const x = ((i + 0.5) / resolution - 0.5) * size;
        fn(x, z, v);
        const k = i + j * resolution;
        if (channels === 1) data[k] = v[0];
        else for (let c = 0; c < 4; c++) data[k * 4 + c] = Math.round(THREE.MathUtils.clamp(v[c], 0, 1) * 255);
      }
    }
    const tex =
      channels === 1
        ? new THREE.DataTexture(data, resolution, resolution, THREE.RedFormat, THREE.FloatType)
        : new THREE.DataTexture(data, resolution, resolution, THREE.RGBAFormat);
    tex.minFilter = channels === 1 ? THREE.NearestFilter : THREE.LinearFilter;
    tex.magFilter = channels === 1 ? THREE.NearestFilter : THREE.LinearFilter;
    tex.needsUpdate = true;
    return tex;
  };

  return {
    yBase,
    half,
    cornerRadius: ped.cornerRadius,
    levels,
    sample,
    riverFrame: frameAt,
    heightAt: (x, z) => read(H, x, z),
    groundAt: (x, z) => read(G, x, z),
    waterAt: (x, z) => read(Wl, x, z),
    sandAt: (x, z) => read(S, x, z),
    wetAt: (x, z) => read(Wet, x, z),
    falls,
    line: { xs: line.xs, zs: line.zs, ss: line.ss, count: line.count, length: line.length },
    heightTexture: (size, resolution) => texture(size, resolution, 1, (x, z, v) => (v[0] = read(H, x, z))),
    maskTexture: (size, resolution) =>
      texture(size, resolution, 4, (x, z, v) => {
        const wl = read(Wl, x, z);
        v[0] = read(S, x, z);
        // 滝のしぶきのかかる所（滝の落ち口と滝つぼのまわり。岩肌が濡れて暗い）
        let spray = 0;
        for (const f of falls) {
          const dx = x - f.x;
          const dz = z - f.z;
          const along = dx * f.tx + dz * f.tz;
          const lat = Math.abs(dx * f.tz - dz * f.tx) - f.width * 0.55;
          const dist = Math.hypot(Math.max(0, Math.abs(along - 0.04) - 0.08), Math.max(0, lat));
          spray = Math.max(spray, 1 - smoothstep(0.03, 0.3, dist));
        }
        v[1] = spray;
        // 水際の近さ（水際から離れるほど 0。濡れた砂の帯を水際の近くだけにする）
        v[2] = 1 - smoothstep(0.1, 0.3, read(ED, x, z));
        v[3] = wl > 0 ? (wl - levelRange[0]) / (levelRange[1] - levelRange[0]) : 0;
      }),
    levelRange,
  };
}
