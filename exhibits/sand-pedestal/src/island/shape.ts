import { Noise, mulberry32 } from '../noise';
import type { SceneConfig } from '../config';

export type IslandConfig = SceneConfig['island'];

/** 島を置く台座と水の高さ（ワールド座標） */
export interface IslandFrame {
  /** 台座の一辺 */
  size: number;
  cornerRadius: number;
  /** 水面の高さ */
  yWater: number;
  /** 島の底（土台の上面） */
  yBottom: number;
  /** 平らな海底の水面からの深さ（水の中で島の土台が広がる割合の基準） */
  seabedDepth: number;
}

type Vec2 = [number, number];

const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);
const smoothstep = (a: number, b: number, v: number) => {
  const t = clamp((v - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};

/** Chaikin の角切りで閉じた折れ線をなめらかにする（点ごとの値も同じ割合で補間する） */
function chaikinClosed(points: Vec2[], values: number[], iterations: number): { pts: Vec2[]; vals: number[] } {
  let pts = points;
  let vals = values;
  for (let it = 0; it < iterations; it++) {
    const outP: Vec2[] = [];
    const outV: number[] = [];
    const n = pts.length;
    for (let i = 0; i < n; i++) {
      const a = pts[i];
      const b = pts[(i + 1) % n];
      const va = vals[i];
      const vb = vals[(i + 1) % n];
      outP.push([0.75 * a[0] + 0.25 * b[0], 0.75 * a[1] + 0.25 * b[1]]);
      outV.push(0.75 * va + 0.25 * vb);
      outP.push([0.25 * a[0] + 0.75 * b[0], 0.25 * a[1] + 0.75 * b[1]]);
      outV.push(0.25 * va + 0.75 * vb);
    }
    pts = outP;
    vals = outV;
  }
  return { pts, vals };
}

/** 角丸正方形までの符号付き距離（内側が正） */
export function roundedSquareInside(px: number, pz: number, half: number, r: number): number {
  const qx = Math.abs(px) - (half - r);
  const qz = Math.abs(pz) - (half - r);
  const outside = Math.hypot(Math.max(qx, 0), Math.max(qz, 0)) + Math.min(Math.max(qx, qz), 0) - r;
  return -outside;
}

/**
 * 閉じた多角形までの符号付き距離（内側が正）と、最も近い辺の上の値（辺の両端の値を補間）。
 * vals を省略したときは値を返さない。
 */
function polygonQuery(
  px: number,
  pz: number,
  xs: Float64Array,
  zs: Float64Array,
  vals: Float64Array | null,
  out: { d: number; v: number },
) {
  const n = xs.length;
  let best = Infinity;
  let bestV = 0;
  let s = 1;
  for (let i = 0, j = n - 1; i < n; j = i, i++) {
    const ex = xs[j] - xs[i];
    const ez = zs[j] - zs[i];
    const wx = px - xs[i];
    const wz = pz - zs[i];
    const t = clamp((wx * ex + wz * ez) / (ex * ex + ez * ez), 0, 1);
    const bx = wx - ex * t;
    const bz = wz - ez * t;
    const dd = bx * bx + bz * bz;
    if (dd < best) {
      best = dd;
      if (vals) bestV = vals[i] + (vals[j] - vals[i]) * t;
    }
    const c1 = pz >= zs[i];
    const c2 = pz < zs[j];
    const c3 = ex * wz > ez * wx;
    if ((c1 && c2 && c3) || (!c1 && !c2 && !c3)) s = -s;
  }
  out.d = -s * Math.sqrt(best);
  out.v = bestV;
  return out;
}

/** 折れ線までの距離と、最も近い点での値（点ごとの値を補間） */
function polylineQuery(px: number, pz: number, pts: { x: number; z: number; v: number }[], out: { d: number; v: number }) {
  let best = Infinity;
  let bestV = pts[0].v;
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i];
    const b = pts[i + 1];
    const ex = b.x - a.x;
    const ez = b.z - a.z;
    const t = clamp(((px - a.x) * ex + (pz - a.z) * ez) / (ex * ex + ez * ez), 0, 1);
    const dx = px - a.x - ex * t;
    const dz = pz - a.z - ez * t;
    const dd = dx * dx + dz * dz;
    if (dd < best) {
      best = dd;
      bestV = a.v + (b.v - a.v) * t;
    }
  }
  out.d = Math.sqrt(best);
  out.v = bestV;
  return out;
}

/**
 * 島の体積を表す密度関数（岩の内側で正、外側で負。値はおおよそ距離）。
 *  - 足もとの外形（水面の高さ）の内側が岩。入り江側（崖らしさ 1）は切り立った崖、外側（0）は水際の岩壁から森の斜面へ
 *  - 上面の高さは尾根の線からの距離で決まり、尾根から離れるほど少し低い
 *  - 水面より下では外へ広がり、海底へ岩の土台がなだらかに続く
 *  - 崖には地層の張り出し・縦の割れ目・ふくらみ、水面のすぐ上には波に削られたくぼみ、岬の足もとには海食洞
 * 2D の補助場は先に格子へ焼いておき、3D の評価では双線形補間とノイズだけを使う。
 */
export class IslandShape {
  /** 水面の高さ（植生や岩の配置で「地面」の基準にする） */
  readonly yWater: number;
  /** 互換用：植生の配置の高さの基準（水面） */
  readonly ySand: number;
  readonly yBottom: number;
  readonly bounds: { minX: number; maxX: number; minY: number; maxY: number; minZ: number; maxZ: number };
  readonly pad: number;

  private readonly noise: Noise;
  private readonly n2x: number;
  private readonly n2z: number;
  private readonly x0: number;
  private readonly z0: number;
  private readonly step2: number;
  private readonly fPoly: Float32Array;
  private readonly fCliff: Float32Array;
  /** 崖の上の張り出し（上へ行くほど外へ出る量） */
  private readonly fOver: Float32Array;
  private readonly fThick: Float32Array;
  private readonly fHeight: Float32Array;
  private readonly fCrack: Float32Array;
  private readonly fWarp: Float32Array;
  private readonly fEdge: Float32Array;
  /** 縦の柱状の溝（0 = 柱の中ほど、1 = 柱と柱の間の溝） */
  private readonly fFlute: Float32Array;
  private readonly fluteDepth: number;

  private readonly strata: Float32Array;
  private readonly strataY0: number;
  private readonly strataStep: number;

  private readonly slopeCliff: number;
  private readonly slopeWidth: number;
  private readonly slopePower: number;
  private readonly slopeThick: number;
  private readonly lean: number;
  private readonly notchDepth: number;
  private readonly notchHeight: number;
  private readonly flare: number;
  private readonly flarePower: number;
  private readonly lumps: number;
  private readonly lumpFreq: number;
  private readonly wallGapTop: number;
  private readonly wallGapBottom: number;
  private readonly wallGapDepth: number;
  private readonly shelf: number;
  private readonly shelfDepth: number;
  private readonly seabedDepth: number;
  private readonly crackDepth: number;
  private readonly bulge: number;
  private readonly bulgeFreq: number;
  private readonly rough: number;
  private readonly roughFreq: number;
  private readonly band: number;

  /** 海食洞（楕円体）。中心・向き（tx,tz：崖に沿う向き、nx,nz：岩の奥へ向かう向き）・半径 */
  readonly cave: {
    cx: number;
    cy: number;
    cz: number;
    tx: number;
    tz: number;
    nx: number;
    nz: number;
    a: number;
    b: number;
    c: number;
    reach: number;
  };

  /** 足もとの外形（ワールド座標、なめらかにしたもの） */
  readonly outline: Vec2[];

  constructor(cfg: IslandConfig, frame: IslandFrame) {
    const W = frame.size;
    const rel = cfg.relief;
    this.yWater = frame.yWater;
    this.ySand = frame.yWater;
    this.yBottom = frame.yBottom;
    this.seabedDepth = frame.seabedDepth;
    this.noise = new Noise(cfg.seed);
    const half = W / 2;

    // --- 足もとの外形（なめらかにして、崖らしさも一緒に補間）
    const raw: Vec2[] = cfg.footprint.map(([x, z]) => [x * W, z * W]);
    const rawCliff = cfg.footprint.map((p) => p[2]);
    const rawOver = cfg.footprint.map((p) => (p[3] ?? 0) * W);
    const sm = chaikinClosed(raw, rawCliff, 3);
    const smOver = chaikinClosed(raw, rawOver, 3);
    this.outline = sm.pts;
    const xs = new Float64Array(sm.pts.map((p) => p[0]));
    const zs = new Float64Array(sm.pts.map((p) => p[1]));
    const cliffVals = new Float64Array(sm.vals);
    const overVals = new Float64Array(smOver.vals);

    // --- 尾根の線
    const crest = cfg.crest.map(([x, z, h]) => ({ x: x * W, z: z * W, v: h * W }));
    const maxCrest = Math.max(...crest.map((c) => c.v));

    // --- 寸法
    this.slopeCliff = cfg.slope.cliffFraction;
    this.slopeWidth = cfg.slope.width * W;
    this.slopePower = cfg.slope.power;
    this.slopeThick = cfg.slope.thickness;
    this.lean = cfg.cliff.lean * W;
    this.notchDepth = cfg.cliff.notchDepth * W;
    this.notchHeight = cfg.cliff.notchHeight * W;
    this.flare = cfg.flare * W;
    this.flarePower = cfg.flarePower;
    this.lumps = cfg.underwater.lumps * W;
    this.lumpFreq = 1 / (cfg.underwater.lumpSize * W);
    this.wallGapTop = cfg.wallGap.top * W;
    this.wallGapBottom = cfg.wallGap.bottom * W;
    this.wallGapDepth = Math.max(cfg.wallGap.depth * W, 1e-4);
    this.shelf = cfg.shelf.width * W;
    this.shelfDepth = cfg.shelf.depth * W;
    this.crackDepth = rel.crackDepth * W;
    this.bulge = rel.bulge * W;
    this.bulgeFreq = 1 / (rel.bulgeSize * W);
    this.rough = rel.rough * W;
    this.roughFreq = 1 / (rel.roughSize * W);
    this.pad = this.bulge * 1.3 + this.rough + this.lumps + 0.1;
    this.band = this.bulge * 0.95 + this.rough + this.lumps + 0.12;

    // --- 格子の範囲（足もとの外形＋水中の広がり＋余白。台座の内側に限る）
    let minX = Infinity;
    let maxX = -Infinity;
    let minZ = Infinity;
    let maxZ = -Infinity;
    for (const [x, z] of sm.pts) {
      minX = Math.min(minX, x);
      maxX = Math.max(maxX, x);
      minZ = Math.min(minZ, z);
      maxZ = Math.max(maxZ, z);
    }
    const grow = this.flare + this.shelf + this.pad + 0.15;
    this.bounds = {
      minX: Math.max(-half, minX - grow),
      maxX: Math.min(half, maxX + grow),
      minZ: Math.max(-half, minZ - grow),
      maxZ: Math.min(half, maxZ + grow),
      minY: frame.yBottom + 0.004 * (W / 10),
      maxY: frame.yWater + maxCrest + rel.topNoise * W * 1.6 + this.pad + 0.2,
    };

    // --- 2D の補助場
    const step2 = 0.03 * (W / 10);
    this.step2 = step2;
    this.x0 = this.bounds.minX - step2 * 2;
    this.z0 = this.bounds.minZ - step2 * 2;
    this.n2x = Math.ceil((this.bounds.maxX - this.x0) / step2) + 3;
    this.n2z = Math.ceil((this.bounds.maxZ - this.z0) / step2) + 3;
    const n2 = this.n2x * this.n2z;
    this.fPoly = new Float32Array(n2);
    this.fCliff = new Float32Array(n2);
    this.fOver = new Float32Array(n2);
    this.fThick = new Float32Array(n2);
    this.fHeight = new Float32Array(n2);
    this.fCrack = new Float32Array(n2);
    this.fWarp = new Float32Array(n2);
    this.fEdge = new Float32Array(n2);
    this.fFlute = new Float32Array(n2);
    this.fluteDepth = rel.fluteDepth * W;
    const fluteFreq = 1 / (rel.fluteScale * W);
    const fluteBands = rel.fluteBands;
    const topAmp = rel.topNoise * W;
    const topFreq = 1 / (0.07 * W);
    const crackFreq = 1 / (rel.crackSpacing * W);
    const warpAmp = rel.strataWarp * W;
    const warpFreq = 1 / (0.25 * W);
    const fallAmt = cfg.crestFalloff.amount;
    const fallDist = cfg.crestFalloff.distance * W;
    const nz = this.noise;
    const q = { d: 0, v: 0 };
    const g0 = { d: 0, v: 0 };
    for (let iz = 0; iz < this.n2z; iz++) {
      const z = this.z0 + iz * step2;
      for (let ix = 0; ix < this.n2x; ix++) {
        const x = this.x0 + ix * step2;
        const k = ix + iz * this.n2x;
        polygonQuery(x, z, xs, zs, cliffVals, q);
        this.fPoly[k] = q.d;
        this.fCliff[k] = q.v;
        this.fOver[k] = polygonQuery(x, z, xs, zs, overVals, g0).v;
        this.fEdge[k] = roundedSquareInside(x, z, half, frame.cornerRadius) - 0.004 * W;
        polylineQuery(x, z, crest, q);
        // 尾根から離れるほど少し低く。上面はとがった起伏（溶けたような丸みにしない）
        const ridged = 1 - Math.abs(nz.fbm2(x * topFreq + 3.1, z * topFreq - 7.7, 3)) * 2.2;
        this.fHeight[k] = q.v * (1 - fallAmt * smoothstep(0, fallDist, q.d)) + topAmp * ridged;
        const r1 = smoothstep(0.17, 0, Math.abs(nz.noise2(x * crackFreq + 11.3, z * crackFreq - 5.1)));
        const r2 = smoothstep(0.12, 0, Math.abs(nz.noise2(x * crackFreq * 2.1 - 3.7, z * crackFreq * 2.1 + 8.2)));
        this.fCrack[k] = Math.max(r1, 0.6 * r2);
        this.fWarp[k] = warpAmp * nz.fbm2(x * warpFreq - 21.4, z * warpFreq + 2.6, 2);
        // 柱状の溝：ゆるやかなノイズの等高線に沿った帯（崖の面と交わる所が縦の溝になる）。柱は丸く、溝は細い
        const nb = nz.fbm2(x * fluteFreq + 41.3, z * fluteFreq - 17.9, 2) * fluteBands;
        const bf = nb - Math.floor(nb);
        const cc = 2 * bf - 1;
        this.fFlute[k] = 1 - Math.sqrt(Math.max(0, 1 - cc * cc));
      }
    }
    // 崖らしさは凹んだ角で急に切り替わらないよう、少しぼかす
    blur2D(this.fCliff, this.n2x, this.n2z, Math.max(1, Math.round((0.02 * W) / step2)));
    blur2D(this.fOver, this.n2x, this.n2z, Math.max(1, Math.round((0.02 * W) / step2)));
    // 島の局所的な厚み（足もとからの距離の近傍の最大値）。細い所では外側の斜面を浅くして、尾根を削りすぎない
    this.fThick.set(this.fPoly);
    maxFilter2D(this.fThick, this.n2x, this.n2z, Math.round((0.12 * W) / step2));

    // --- 地層：厚みと張り出しを乱数で決めた1次元の断面表（水面からの高さ）
    const rnd = mulberry32(cfg.seed * 7919 + 13);
    const [tMin, tMax] = rel.strataThickness;
    const depth = rel.strataDepth * W;
    const yStart = frame.yBottom - frame.yWater - 1;
    const yEnd = this.bounds.maxY - frame.yWater + 1;
    const layers: { y0: number; t: number; a: number }[] = [];
    let y = yStart;
    let a = 0;
    while (y < yEnd) {
      const t = (tMin + (tMax - tMin) * Math.pow(rnd(), 1.4)) * W;
      a = clamp(0.45 * a + (rnd() * 2 - 1) * 0.95, -1, 1);
      layers.push({ y0: y, t, a });
      y += t;
    }
    this.strataStep = 0.004 * (W / 10);
    this.strataY0 = yStart;
    const nS = Math.ceil((yEnd - yStart) / this.strataStep) + 2;
    const rawS = new Float32Array(nS);
    let li = 0;
    for (let i = 0; i < nS; i++) {
      const yy = yStart + i * this.strataStep;
      while (li < layers.length - 1 && yy >= layers[li + 1].y0) li++;
      const L = layers[li];
      const local = yy - L.y0;
      const notchW = Math.min(0.06 * (W / 10), L.t * 0.3);
      rawS[i] = L.a * depth - depth * 0.85 * (1 - smoothstep(0, notchW, local));
    }
    this.strata = new Float32Array(nS);
    for (let i = 0; i < nS; i++) {
      let s = 0;
      let c = 0;
      for (let k = -2; k <= 2; k++) {
        const j = i + k;
        if (j >= 0 && j < nS) {
          s += rawS[j];
          c++;
        }
      }
      this.strata[i] = s / c;
    }

    // --- 海食洞：足もとの線上に中心を置き、半分を岩へ食い込ませる
    const [ccx, ccz] = [cfg.cave.center[0] * W, cfg.cave.center[1] * W];
    const e = 0.02;
    const g1 = { d: 0, v: 0 };
    const gx = polygonQuery(ccx + e, ccz, xs, zs, null, g1).d - polygonQuery(ccx - e, ccz, xs, zs, null, g1).d;
    const gz = polygonQuery(ccx, ccz + e, xs, zs, null, g1).d - polygonQuery(ccx, ccz - e, xs, zs, null, g1).d;
    const gl = Math.hypot(gx, gz) || 1;
    const nIn = [gx / gl, gz / gl];
    const [ca, cb, cc] = cfg.cave.size.map((v) => v * W);
    this.cave = {
      cx: ccx,
      cy: frame.yWater + cfg.cave.elevation * W,
      cz: ccz,
      nx: nIn[0],
      nz: nIn[1],
      tx: -nIn[1],
      tz: nIn[0],
      a: ca,
      b: cb,
      c: cc,
      reach: Math.max(ca, cb, cc) * 1.6,
    };
  }

  /** 2D の補助場を双線形補間で読む（範囲外は端の値） */
  private sample2D(field: Float32Array, x: number, z: number): number {
    const gx = Math.min(Math.max((x - this.x0) / this.step2, 0), this.n2x - 1.001);
    const gz = Math.min(Math.max((z - this.z0) / this.step2, 0), this.n2z - 1.001);
    const ix = gx | 0;
    const iz = gz | 0;
    const tx = gx - ix;
    const tz = gz - iz;
    const k = ix + iz * this.n2x;
    return (
      (field[k] * (1 - tx) + field[k + 1] * tx) * (1 - tz) +
      (field[k + this.n2x] * (1 - tx) + field[k + this.n2x + 1] * tx) * tz
    );
  }

  /** 足もとの外形（水面の高さ）までの距離。島の内側で正、海の側で負 */
  footprintAt(x: number, z: number): number {
    return this.sample2D(this.fPoly, x, z);
  }

  /** 崖らしさ（1 = 入り江側の切り立った崖、0 = 外側の斜面） */
  cliffAt(x: number, z: number): number {
    return this.sample2D(this.fCliff, x, z);
  }

  /** 上面の高さ（水面から） */
  heightAt(x: number, z: number): number {
    return this.sample2D(this.fHeight, x, z);
  }

  /** 縦の割れ目の強さ 0〜1 */
  crackAt(x: number, z: number): number {
    return this.sample2D(this.fCrack, x, z);
  }

  private lookup(table: Float32Array, y: number): number {
    const f = (y - this.strataY0) / this.strataStep;
    const i = Math.floor(f);
    if (i < 0) return table[0];
    if (i >= table.length - 1) return table[table.length - 1];
    const t = f - i;
    return table[i] * (1 - t) + table[i + 1] * t;
  }

  /**
   * 高さ方向の1列（x, z 固定）をまとめて評価する。岩の内側で正、外側で負。
   * 2D の補助場は列ごとに1回だけ補間すればよいので、点ごとに評価するより速い。
   */
  evalColumn(x: number, z: number, y0: number, dy: number, count: number, out: Float32Array, offset: number, stride: number) {
    const gx = (x - this.x0) / this.step2;
    const gz = (z - this.z0) / this.step2;
    if (gx < 0 || gz < 0 || gx >= this.n2x - 1 || gz >= this.n2z - 1) {
      for (let j = 0; j < count; j++) out[offset + j * stride] = -1;
      return;
    }
    const ix = gx | 0;
    const iz = gz | 0;
    const tx = gx - ix;
    const tz = gz - iz;
    const k00 = ix + iz * this.n2x;
    const k10 = k00 + 1;
    const k01 = k00 + this.n2x;
    const k11 = k01 + 1;
    const w00 = (1 - tx) * (1 - tz);
    const w10 = tx * (1 - tz);
    const w01 = (1 - tx) * tz;
    const w11 = tx * tz;
    const at = (f: Float32Array) => f[k00] * w00 + f[k10] * w10 + f[k01] * w01 + f[k11] * w11;
    const poly = at(this.fPoly);
    const edge = at(this.fEdge);
    const band = this.band;
    if (poly < -band - this.flare - this.shelf) {
      // 島から十分に離れた列
      const v = Math.min(edge, poly + this.flare + this.shelf);
      for (let j = 0; j < count; j++) out[offset + j * stride] = v;
      return;
    }
    const H = Math.max(at(this.fHeight), 0.05);
    const cliff = clamp(at(this.fCliff), 0, 1);
    const over = at(this.fOver);
    const crack = at(this.fCrack);
    const warp = at(this.fWarp);
    const thick = Math.max(at(this.fThick), 0.02);
    const invH = 1 / H;
    // 外側の斜面の幅（細い所では浅く）
    const slopeW = Math.min(this.slopeWidth, this.slopeThick * thick) * (1 - cliff);
    // 水際の岩壁の高さの割合：崖らしいほど高い（1 で全体が崖）
    const c0 = this.slopeCliff + (1 - this.slopeCliff) * cliff;
    const crackTop = crack * this.crackDepth * 0.6;
    const fluteK = this.fluteDepth * at(this.fFlute) * smoothstep(0.15, 0.6, cliff);
    const crackWall = this.crackDepth * crack * (0.4 + 0.6 * cliff);
    const bf = this.bulgeFreq;
    const rf = this.roughFreq;
    const cv = this.cave;
    const cdx = x - cv.cx;
    const cdz = z - cv.cz;
    const nearCave = cdx * cdx + cdz * cdz < cv.reach * cv.reach;
    const noise = this.noise;
    const yW = this.yWater;
    const invSea = 1 / Math.max(this.seabedDepth, 0.1);
    const nh = this.notchHeight;

    for (let j = 0; j < count; j++) {
      const y = y0 + j * dy;
      const yy = y - yW;
      // 上面
      const fTop = H - yy - crackTop;
      // 壁の凹凸：地層の張り出しと溝、縦の割れ目
      let relief = this.lookup(this.strata, yy + warp);
      if (crackWall > 1e-4) relief -= crackWall * (0.6 + 0.4 * (0.55 + 0.45 * noise.noise2(x * 0.8 + 13.1, y * 1.6 - 4.2)));
      // 柱状の溝（水面より上の崖。高さ方向に途切れさせる）
      if (fluteK > 0 && yy > 0) relief -= fluteK * (0.55 + 0.45 * noise.noise2(x * 1.7 - 2.3, y * 0.9 + z * 1.7 + 6.1));
      let wall: number;
      if (yy >= 0) {
        const u = yy * invH > 1 ? 1 : yy * invH;
        // 入り江側：わずかに奥へ傾いた崖と、水面のすぐ上の波に削られたくぼみ。張り出しのある所は上ほど外へ出る
        const notch = this.notchDepth * Math.exp(-(((yy - nh * 0.6) / nh) ** 2));
        const recCliff = this.lean * u + notch - over * u * Math.sqrt(u);
        // 外側：水際は岩壁、上ほど内側へ寝て森の斜面になる
        const t = u > c0 ? (u - c0) / (1 - c0) : 0;
        const recSlope = slopeW * Math.pow(t, this.slopePower);
        wall = poly - (cliff * recCliff + recSlope) + relief;
      } else {
        // 水の中：水面のすぐ下の浅い岩棚と、海底へ向かって外へ広がる岩くずの土台（地層や割れ目は弱く）
        const s = -yy * invSea;
        const shelfT = this.shelf * smoothstep(0, this.shelfDepth, -yy) * (0.6 + 0.4 * cliff);
        // 外側の海岸（崖らしさの小さい所）は水の中の広がりを控えめに（台座の縁の水の壁から砂地が見えるように）
        wall = poly + shelfT + this.flare * (0.55 + 0.45 * cliff) * Math.pow(s > 1 ? 1 : s, this.flarePower) + relief * 0.3;
      }
      let f = fTop < wall ? fTop : wall;
      if (f > -band && f < band) {
        f += this.bulge * noise.fbm3(x * bf + 1.7, y * bf * 1.25 - 2.3, z * bf + 5.9, 2);
        f += this.rough * noise.noise3(x * rf - 8.1, y * rf * 1.4 + 0.6, z * rf + 3.3);
        // 水の中の岩くずのこぶ（水面のすぐ下から深くなるほど）
        if (yy < 0 && this.lumps > 0) {
          const lf = this.lumpFreq;
          const k = smoothstep(0, this.shelfDepth * 1.5, -yy);
          f += this.lumps * k * (0.35 + noise.fbm3(x * lf - 4.4, y * lf * 1.2 + 9.1, z * lf + 2.7, 2));
        }
      }
      // 海食洞
      if (nearCave) {
        const ddy = y - cv.cy;
        if (Math.abs(ddy) < cv.reach) {
          const lx = (cdx * cv.tx + cdz * cv.tz) / cv.a;
          const ly = ddy / cv.b;
          const lz = (cdx * cv.nx + cdz * cv.nz) / cv.c;
          const k0 = Math.hypot(lx, ly, lz);
          const k1 = Math.hypot(lx / cv.a, ly / cv.b, lz / cv.c);
          let dCave = k1 > 1e-6 ? (k0 * (k0 - 1)) / k1 : -cv.b;
          dCave += 0.35 * this.rough * noise.noise3(x * 3.1, y * 3.1, z * 3.1);
          if (dCave < f) f = dCave;
        }
      }
      // 台座の外へは出さない。水の中では縁から離す（側面のガラスと島の土台の間に水の層を残し、深いほど広く離して下の方に海底の砂を見せる）
      const lim =
        yy < 0
          ? edge -
            this.wallGapTop * smoothstep(0, this.wallGapDepth, -yy) -
            (this.wallGapBottom - this.wallGapTop) * Math.min(-yy * invSea, 1)
          : edge;
      out[offset + j * stride] = f < lim ? f : lim;
    }
  }
}

/** 2D の格子を箱型フィルタでぼかす（縦横に分けて半径 r） */
function blur2D(field: Float32Array, nx: number, nz: number, r: number) {
  const tmp = new Float32Array(field.length);
  for (let z = 0; z < nz; z++) {
    for (let x = 0; x < nx; x++) {
      let s = 0;
      let c = 0;
      for (let k = -r; k <= r; k++) {
        const xx = x + k;
        if (xx < 0 || xx >= nx) continue;
        s += field[xx + z * nx];
        c++;
      }
      tmp[x + z * nx] = s / c;
    }
  }
  for (let z = 0; z < nz; z++) {
    for (let x = 0; x < nx; x++) {
      let s = 0;
      let c = 0;
      for (let k = -r; k <= r; k++) {
        const zz = z + k;
        if (zz < 0 || zz >= nz) continue;
        s += tmp[x + zz * nx];
        c++;
      }
      field[x + z * nx] = s / c;
    }
  }
}

/** 2D の格子の近傍の最大値（縦横に分けて半径 r の正方形） */
function maxFilter2D(field: Float32Array, nx: number, nz: number, r: number) {
  const tmp = new Float32Array(field.length);
  for (let z = 0; z < nz; z++) {
    for (let x = 0; x < nx; x++) {
      let m = -Infinity;
      const a = Math.max(0, x - r);
      const b = Math.min(nx - 1, x + r);
      for (let xx = a; xx <= b; xx++) m = Math.max(m, field[xx + z * nx]);
      tmp[x + z * nx] = m;
    }
  }
  for (let z = 0; z < nz; z++) {
    for (let x = 0; x < nx; x++) {
      let m = -Infinity;
      const a = Math.max(0, z - r);
      const b = Math.min(nz - 1, z + r);
      for (let zz = a; zz <= b; zz++) m = Math.max(m, tmp[x + zz * nx]);
      field[x + z * nx] = m;
    }
  }
}
