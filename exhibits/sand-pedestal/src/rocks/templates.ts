import * as THREE from 'three';
import { Noise, mulberry32 } from '../noise';

/**
 * 砂地に散らばる岩の形のひな形（インスタンス描画や結合で使い回す）。
 * 細分した球の各頂点を、中心からの向きごとに決めた半径まで押し出して作る（どの細かさで作っても同じ形）。
 *  - angular：割れた平らな面で囲まれた角張った岩片
 *  - rounded：風化して角が丸まり、表面がこぶ状にでこぼこした岩
 *  - slab：平たい板状の岩（層の段差つき）
 *  - long：横長の岩
 *  - lumpy：いくつもの塊が寄り集まった岩（崩れた岩の山）
 *  - block：崖から落ちた角張った岩塊（平らな上面と層の段差）
 *  - coral：海底の緑の岩（海藻やサンゴに覆われた塊が積み重なった、こぶの多い背の高い塊）
 * 表面の凹凸は、セル状のこぶとその間の溝（風化した岩のでこぼこ）、割れた平らな面、層の段差、割れ目の溝で作る。
 * 形は横幅（x・z の大きい方）を 1 にそろえ、底面を y = 0 に置く。
 */

export type RockKind = 'angular' | 'rounded' | 'slab' | 'long' | 'lumpy' | 'block' | 'coral';

export interface RockTemplate {
  kind: RockKind;
  /** position・normal・rockAo（底とくぼみの陰影）・rockCav（くぼみの深さ 0〜1） */
  geometry: THREE.BufferGeometry;
  /**
   * 影を焼き込む点の間引き：先頭の count 個の頂点（1段粗い細分の頂点）だけで光を調べ、
   * ほかの頂点は parents（頂点ごとに2つ、粗い頂点の番号）の平均を使う
   */
  coarse: { count: number; parents: Int32Array };
  /** 影の計算用の粗い形（null なら影を落とさない） */
  proxy: THREE.BufferGeometry | null;
  /** 高さ（横幅 1 に対する比率） */
  height: number;
  /** 横幅の半分の目安（重なりの判定に使う） */
  radius: number;
}

type V3 = THREE.Vector3;

interface Sphere {
  verts: V3[];
  faces: number[];
  /** 頂点ごとの隣の頂点 */
  neighbors: number[][];
  /** 1段粗い細分の頂点の数（先頭からこの数までが粗い細分の頂点と同じ） */
  coarseCount: number;
  /** 頂点ごとの、粗い細分の頂点2つ（最後の細分で辺の中点として加わった頂点はその辺の両端、元からある頂点は自分自身） */
  parents: Int32Array;
}

const sphereCache = new Map<number, Sphere>();

/** 細分した正二十面体（球の近似）と、頂点のつながり */
function icosphere(detail: number): Sphere {
  const cached = sphereCache.get(detail);
  if (cached) return cached;
  const t = (1 + Math.sqrt(5)) / 2;
  let verts = [
    [-1, t, 0], [1, t, 0], [-1, -t, 0], [1, -t, 0],
    [0, -1, t], [0, 1, t], [0, -1, -t], [0, 1, -t],
    [t, 0, -1], [t, 0, 1], [-t, 0, -1], [-t, 0, 1],
  ].map(([x, y, z]) => new THREE.Vector3(x, y, z).normalize());
  let faces = [
    [0, 11, 5], [0, 5, 1], [0, 1, 7], [0, 7, 10], [0, 10, 11],
    [1, 5, 9], [5, 11, 4], [11, 10, 2], [10, 7, 6], [7, 1, 8],
    [3, 9, 4], [3, 4, 2], [3, 2, 6], [3, 6, 8], [3, 8, 9],
    [4, 9, 5], [2, 4, 11], [6, 2, 10], [8, 6, 7], [9, 8, 1],
  ];
  let coarseCount = verts.length;
  let pairs = new Map<number, [number, number]>();
  for (let d = 0; d < detail; d++) {
    const mid = new Map<number, number>();
    const next: number[][] = [];
    const vs = verts.slice();
    coarseCount = verts.length;
    pairs = new Map();
    const midpoint = (a: number, b: number) => {
      const key = a < b ? a * 100000 + b : b * 100000 + a;
      let i = mid.get(key);
      if (i === undefined) {
        i = vs.length;
        vs.push(vs[a].clone().add(vs[b]).normalize());
        mid.set(key, i);
        pairs.set(i, [a, b]);
      }
      return i;
    };
    for (const [a, b, c] of faces) {
      const ab = midpoint(a, b);
      const bc = midpoint(b, c);
      const ca = midpoint(c, a);
      next.push([a, ab, ca], [b, bc, ab], [c, ca, bc], [ab, bc, ca]);
    }
    verts = vs;
    faces = next;
  }
  const sets = verts.map(() => new Set<number>());
  for (const [a, b, c] of faces) {
    sets[a].add(b).add(c);
    sets[b].add(a).add(c);
    sets[c].add(a).add(b);
  }
  const parents = new Int32Array(verts.length * 2);
  for (let i = 0; i < verts.length; i++) {
    const pr = pairs.get(i) ?? [i, i];
    parents[i * 2] = pr[0];
    parents[i * 2 + 1] = pr[1];
  }
  if (detail === 0) coarseCount = verts.length;
  const sphere = { verts, faces: faces.flat(), neighbors: sets.map((s) => [...s]), coarseCount, parents };
  sphereCache.set(detail, sphere);
  return sphere;
}

/** 整数の格子点から決まる乱数（0〜1） */
function cellRand(x: number, y: number, z: number, seed: number, k: number): number {
  let h = Math.imul(x | 0, 0x8da6b343) ^ Math.imul(y | 0, 0xd8163841) ^ Math.imul(z | 0, 0xcb1ab31f);
  h ^= Math.imul((seed + k * 0x9e3779b9) | 0, 0x165667b1);
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d);
  h = Math.imul(h ^ (h >>> 12), 0x297a2d39);
  h ^= h >>> 15;
  return (h >>> 0) / 4294967296;
}

interface Cells {
  /** 最も近い点・2番目に近い点までの距離 */
  f1: number;
  f2: number;
  /** 最も近い点のセルの乱数（0〜1） */
  id: number;
}

/** セルノイズ（ボロノイ）。f2 - f1 がセルの境目で 0 になる */
function worley(px: number, py: number, pz: number, seed: number, out: Cells): Cells {
  const ix = Math.floor(px);
  const iy = Math.floor(py);
  const iz = Math.floor(pz);
  let f1 = 1e9;
  let f2 = 1e9;
  let id = 0;
  for (let a = -1; a <= 1; a++) {
    for (let b = -1; b <= 1; b++) {
      for (let c = -1; c <= 1; c++) {
        const cx = ix + a;
        const cy = iy + b;
        const cz = iz + c;
        const dx = cx + 0.1 + 0.8 * cellRand(cx, cy, cz, seed, 0) - px;
        const dy = cy + 0.1 + 0.8 * cellRand(cx, cy, cz, seed, 1) - py;
        const dz = cz + 0.1 + 0.8 * cellRand(cx, cy, cz, seed, 2) - pz;
        const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
        if (d < f1) {
          f2 = f1;
          f1 = d;
          id = cellRand(cx, cy, cz, seed, 3);
        } else if (d < f2) {
          f2 = d;
        }
      }
    }
  }
  out.f1 = f1;
  out.f2 = f2;
  out.id = id;
  return out;
}

interface Knobs {
  /** セルの細かさ（岩の半径 1 あたりのセルの数の目安） */
  freq: number;
  /** 溝の深さ（半径に対する比率） */
  amp: number;
  /** 溝の幅（セルの大きさに対する比率） */
  width: number;
  /** セルごとの高さの違い（amp に対する比率） */
  vary: number;
  seed: number;
}

interface ShapeParams {
  kind: RockKind;
  /** 伸び縮み（x, y, z） */
  stretch: V3;
  /** 割れた平らな面（法線・中心からの距離・面に残す丸み 0〜1） */
  cuts: { n: V3; d: number; keep: number }[];
  /** 塊（lumpy 用）：中心と半径 */
  lobes: { c: V3; r: number }[];
  /** 低い周波数のふくらみの量 */
  bulge: number;
  /** セル状のこぶと溝（粗いものから細かいものへ） */
  knobs: Knobs[];
  /** 層状の段差の量と間隔 */
  strata: number;
  strataFreq: number;
  strataPhase: number;
  /** 割れ目の溝 */
  cracks: { n: V3; o: number; w: number; depth: number }[];
  /** 底を平らにする高さ（-1〜1） */
  floor: number;
  noise: Noise;
  noiseOffset: V3;
}

const randomUnit = (rnd: () => number) => {
  const z = rnd() * 2 - 1;
  const a = rnd() * Math.PI * 2;
  const s = Math.sqrt(1 - z * z);
  return new THREE.Vector3(s * Math.cos(a), z, s * Math.sin(a));
};

const cellsTmp: Cells = { f1: 0, f2: 0, id: 0 };

const smoothstepN = (a: number, b: number, v: number) => {
  const t = Math.min(1, Math.max(0, (v - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/** 向き v（単位ベクトル）の表面の位置を求める。どの細かさで作っても同じ形になる */
function surfacePoint(v: V3, s: ShapeParams, out: V3): V3 {
  let r = 1;
  if (s.lobes.length > 0) {
    // 塊の集まり：原点から v の向きに進んだとき、最も外側にある塊の表面
    r = 0;
    for (const l of s.lobes) {
      const b = v.dot(l.c);
      const disc = b * b - (l.c.lengthSq() - l.r * l.r);
      if (disc >= 0) r = Math.max(r, b + Math.sqrt(disc));
    }
    if (r <= 0) r = 0.3;
  }
  const nz = s.noise;
  const o = s.noiseOffset;
  // ゆるやかなふくらみ
  r *= 1 + s.bulge * nz.fbm3(v.x * 1.3 + o.x, v.y * 1.3 + o.y, v.z * 1.3 + o.z, 2);
  // こぶと溝：表面の位置でセルを求め、境目に溝を、セルごとに高さの違いを付ける
  const px = v.x * r * s.stretch.x;
  const py = v.y * r * s.stretch.y;
  const pz = v.z * r * s.stretch.z;
  for (const k of s.knobs) {
    // セルの形を不揃いにする（ゆがめた位置でセルを求める）
    const qx = px * k.freq + 0.35 * nz.noise3(px * 1.3 + 11.1, py * 1.3 + o.y, pz * 1.3 - 4.7);
    const qy = py * k.freq + 0.35 * nz.noise3(px * 1.3 - 7.3, py * 1.3 + 2.9 + o.z, pz * 1.3 + 3.3);
    const qz = pz * k.freq + 0.35 * nz.noise3(px * 1.3 + 5.9, py * 1.3 - 8.1, pz * 1.3 + o.x);
    const c = worley(qx, qy, qz, k.seed, cellsTmp);
    const t = Math.min(1, (c.f2 - c.f1) / k.width);
    const dome = 1 - (1 - t) * (1 - t) * (1 - t);
    // 溝の深さも場所によって変える（深い割れ目と浅い継ぎ目が混ざる）
    const deep = 0.3 + 0.7 * smoothstepN(-0.35, 0.45, nz.noise3(px * 1.9 + 5.3, py * 1.9 - 3.1, pz * 1.9 + 7.7));
    r *= 1 + k.amp * ((dome - 1) * deep + k.vary * (c.id - 0.5));
  }
  out.set(v.x * r * s.stretch.x, v.y * r * s.stretch.y, v.z * r * s.stretch.z);
  // 割れた面：その面より外へ出た部分を面の上へ押し戻す
  for (const c of s.cuts) {
    const over = out.dot(c.n) - c.d;
    if (over > 0) out.addScaledVector(c.n, -over * (1 - c.keep));
  }
  // 層状の段差（横の面だけ）。層の境目に溝、層の中ほどがわずかに張り出す（段差で面が途切れないよう連続に変える）
  if (s.strata > 0) {
    const side = 1 - Math.min(1, Math.abs(v.y) * 1.4);
    const u = out.y * s.strataFreq + s.strataPhase + 0.35 * nz.noise3(out.x * 2 + o.x, out.y * 2, out.z * 2 + o.z);
    const f = u - Math.floor(u);
    const g = Math.min(f, 1 - f) / 0.1;
    const step = 0.25 * Math.sin(Math.PI * f) - Math.exp(-g * g);
    const grow = 1 + s.strata * step * side;
    out.x *= grow;
    out.z *= grow;
  }
  // 割れ目の溝
  for (const c of s.cracks) {
    const dist = out.dot(c.n) - c.o;
    const g = Math.exp(-(dist * dist) / (c.w * c.w));
    if (g > 0.01) out.multiplyScalar(1 - c.depth * g);
  }
  // 細かな凹凸
  out.multiplyScalar(1 + 0.02 * nz.noise3(out.x * 7 + o.x, out.y * 7 + o.y, out.z * 7 + o.z));
  // 底を平らに（砂に埋まる側）
  const fy = s.floor * s.stretch.y;
  if (out.y < fy) out.y = fy + (out.y - fy) * 0.15;
  return out;
}

function makeParams(kind: RockKind, seed: number, large: boolean): ShapeParams {
  const rnd = mulberry32(seed);
  const noise = new Noise(seed + 17);
  const p: ShapeParams = {
    kind,
    stretch: new THREE.Vector3(1, 1, 1),
    cuts: [],
    lobes: [],
    bulge: 0.06,
    knobs: [],
    strata: 0,
    strataFreq: 6,
    strataPhase: rnd() * 10,
    cracks: [],
    floor: -0.45,
    noise,
    noiseOffset: new THREE.Vector3(rnd() * 50, rnd() * 50, rnd() * 50),
  };
  const knob = (freq: number, amp: number, width: number, vary: number) => {
    p.knobs.push({ freq: freq * (0.85 + 0.3 * rnd()), amp, width, vary, seed: (seed * 31 + p.knobs.length * 977 + 5) >>> 0 });
  };
  /** 割れた面を加える。maxUp で面の向きの上下を制限（横向きの面だけにする等） */
  const addCuts = (n: number, dMin: number, dMax: number, keep: number, maxUp = 1) => {
    for (let i = 0; i < n; i++) {
      const dir = randomUnit(rnd);
      if (dir.y < -0.3) dir.y = -dir.y * 0.4; // 底側の面は作らない（砂に埋まる）
      dir.y = THREE.MathUtils.clamp(dir.y, -maxUp, maxUp);
      dir.normalize();
      p.cuts.push({ n: dir, d: dMin + (dMax - dMin) * rnd(), keep });
    }
  };
  switch (kind) {
    case 'angular':
      p.stretch.set(1, 0.62 + 0.25 * rnd(), 0.72 + 0.25 * rnd());
      addCuts(7 + Math.floor(rnd() * 4), 0.42, 0.78, 0.04);
      knob(1.5, 0.06, 0.3, 0.6);
      knob(3.5, 0.03, 0.25, 0.5);
      p.bulge = 0.05;
      p.strata = large ? 0.05 : 0;
      p.strataFreq = 5 + 3 * rnd();
      break;
    case 'rounded':
      p.stretch.set(1, 0.76 + 0.16 * rnd(), 0.8 + 0.2 * rnd());
      addCuts(2 + Math.floor(rnd() * 2), 0.72, 0.9, 0.3);
      knob(1.25, 0.14, 0.32, 0.8);
      knob(3.0, 0.05, 0.28, 0.6);
      p.bulge = 0.1;
      p.strata = large ? 0.03 : 0;
      break;
    case 'slab':
      p.stretch.set(1, 0.32 + 0.12 * rnd(), 0.7 + 0.25 * rnd());
      addCuts(4 + Math.floor(rnd() * 3), 0.55, 0.85, 0.05, 0.35);
      knob(1.8, 0.05, 0.3, 0.5);
      knob(4.2, 0.025, 0.25, 0.4);
      p.bulge = 0.05;
      p.strata = large ? 0.08 : 0;
      p.strataFreq = 9 + 3 * rnd();
      p.floor = -0.6;
      break;
    case 'long':
      p.stretch.set(1.7 + 0.4 * rnd(), 0.52 + 0.15 * rnd(), 0.68 + 0.15 * rnd());
      addCuts(5 + Math.floor(rnd() * 3), 0.5, 0.85, 0.05);
      knob(1.5, 0.08, 0.3, 0.6);
      knob(3.5, 0.035, 0.25, 0.5);
      p.strata = large ? 0.05 : 0;
      break;
    case 'lumpy': {
      p.stretch.set(1, 0.86 + 0.14 * rnd(), 1);
      const n = 3 + Math.floor(rnd() * 4);
      for (let i = 0; i < n; i++) {
        const a = rnd() * Math.PI * 2;
        const d = i === 0 ? 0 : 0.28 + 0.3 * rnd();
        p.lobes.push({
          c: new THREE.Vector3(Math.cos(a) * d, (rnd() - 0.35) * 0.3, Math.sin(a) * d),
          r: i === 0 ? 0.7 : 0.38 + 0.24 * rnd(),
        });
      }
      addCuts(3 + Math.floor(rnd() * 2), 0.7, 0.92, 0.2);
      knob(1.4, 0.14, 0.3, 1.0);
      knob(3.2, 0.06, 0.28, 0.6);
      p.bulge = 0.06;
      p.strata = large ? 0.03 : 0;
      break;
    }
    case 'coral': {
      // 塊を積み重ねた背の高い山。表面は小さなこぶで覆われ、横に層の段差が入る（砂に埋めて下の方を隠す）
      p.stretch.set(1, 1.2 + 0.5 * rnd(), 0.85 + 0.2 * rnd());
      const n = 5 + Math.floor(rnd() * 4);
      for (let i = 0; i < n; i++) {
        const a = rnd() * Math.PI * 2;
        const lvl = i === 0 ? 0 : rnd();
        const d = i === 0 ? 0 : (0.2 + 0.35 * rnd()) * (1 - 0.45 * lvl);
        p.lobes.push({
          c: new THREE.Vector3(Math.cos(a) * d, -0.15 + lvl * 0.6, Math.sin(a) * d),
          r: i === 0 ? 0.62 : (0.32 + 0.2 * rnd()) * (1 - 0.3 * lvl),
        });
      }
      knob(2.4, 0.13, 0.34, 0.7);
      knob(5.5, 0.07, 0.3, 0.6);
      p.bulge = 0.08;
      p.strata = 0.07;
      p.strataFreq = 6 + 3 * rnd();
      p.floor = -0.5;
      break;
    }
    case 'block': {
      p.stretch.set(1, 0.8 + 0.2 * rnd(), 0.76 + 0.2 * rnd());
      // 箱のような横の4面と、平らな上面
      const a0 = rnd() * Math.PI * 2;
      for (let i = 0; i < 4; i++) {
        const a = a0 + (i * Math.PI) / 2 + (rnd() - 0.5) * 0.35;
        const n = new THREE.Vector3(Math.cos(a), (rnd() - 0.5) * 0.25, Math.sin(a)).normalize();
        p.cuts.push({ n, d: 0.56 + 0.12 * rnd(), keep: 0.03 });
      }
      p.cuts.push({
        n: new THREE.Vector3((rnd() - 0.5) * 0.45, 1, (rnd() - 0.5) * 0.45).normalize(),
        d: (0.58 + 0.14 * rnd()) * p.stretch.y,
        keep: 0.03,
      });
      addCuts(3, 0.64, 0.82, 0.04);
      knob(1.8, 0.05, 0.3, 0.5);
      knob(4.0, 0.025, 0.25, 0.4);
      p.bulge = 0.04;
      p.strata = 0.07;
      p.strataFreq = 6 + 2 * rnd();
      break;
    }
  }
  if (large) {
    const nCracks = 1 + Math.floor(rnd() * 2);
    for (let i = 0; i < nCracks; i++) {
      const dir = randomUnit(rnd);
      dir.y *= 0.4;
      dir.normalize();
      p.cracks.push({ n: dir, o: (rnd() - 0.5) * 0.6, w: 0.035 + 0.03 * rnd(), depth: 0.05 + 0.05 * rnd() });
    }
  }
  return p;
}

/**
 * くぼみの深さ（0〜1）：まわりの頂点の平均位置が法線の向きにどれだけ外にあるか（溝やこぶの間で大きい）。
 * 近い範囲と広い範囲の2段階で調べる。
 */
function computeCavity(pos: Float32Array, nor: Float32Array, sphere: Sphere, wideIterations: number): Float32Array {
  const n = pos.length / 3;
  let cur = pos.slice();
  let next = new Float32Array(pos.length);
  const near = new Float32Array(n);
  const wide = new Float32Array(n);
  for (let it = 1; it <= wideIterations; it++) {
    for (let i = 0; i < n; i++) {
      const nb = sphere.neighbors[i];
      let x = 0;
      let y = 0;
      let z = 0;
      for (const j of nb) {
        x += cur[j * 3];
        y += cur[j * 3 + 1];
        z += cur[j * 3 + 2];
      }
      next[i * 3] = x / nb.length;
      next[i * 3 + 1] = y / nb.length;
      next[i * 3 + 2] = z / nb.length;
    }
    const tmp = cur;
    cur = next;
    next = tmp;
    if (it === 1 || it === wideIterations) {
      const dst = it === 1 ? near : wide;
      for (let i = 0; i < n; i++) {
        dst[i] =
          (cur[i * 3] - pos[i * 3]) * nor[i * 3] +
          (cur[i * 3 + 1] - pos[i * 3 + 1]) * nor[i * 3 + 1] +
          (cur[i * 3 + 2] - pos[i * 3 + 2]) * nor[i * 3 + 2];
      }
    }
  }
  const cav = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const a = THREE.MathUtils.clamp(near[i] / 0.008, 0, 1);
    const b = THREE.MathUtils.clamp(wide[i] / 0.03, 0, 1);
    cav[i] = Math.min(1, 0.45 * a + 0.75 * b);
  }
  return cav;
}

/** 形のパラメータから、指定の細かさのメッシュを作る（横幅 1・底 y = 0 にそろえる） */
function buildGeometry(
  params: ShapeParams,
  detail: number,
  shading: { wideIterations: number } | null,
): { geo: THREE.BufferGeometry; box: THREE.Box3; sphere: Sphere } {
  const sphere = icosphere(detail);
  const { verts } = sphere;
  const pos = new Float32Array(verts.length * 3);
  const p = new THREE.Vector3();
  for (let i = 0; i < verts.length; i++) {
    surfacePoint(verts[i], params, p);
    p.toArray(pos, i * 3);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setIndex(sphere.faces);
  geo.computeBoundingBox();
  const box = geo.boundingBox!.clone();
  const width = Math.max(box.max.x - box.min.x, box.max.z - box.min.z);
  const cx = (box.max.x + box.min.x) / 2;
  const cz = (box.max.z + box.min.z) / 2;
  geo.translate(-cx, -box.min.y, -cz);
  geo.scale(1 / width, 1 / width, 1 / width);
  geo.computeVertexNormals();
  geo.computeBoundingBox();
  geo.computeBoundingSphere();
  if (shading) {
    const P = geo.attributes.position.array as Float32Array;
    const N = geo.attributes.normal.array as Float32Array;
    const cav = computeCavity(P, N, sphere, shading.wideIterations);
    // 陰影：底に近いほど（砂からの遮蔽）、またくぼみの奥ほど暗い
    const h = geo.boundingBox!.max.y;
    const ao = new Float32Array(cav.length);
    for (let i = 0; i < cav.length; i++) {
      const low = THREE.MathUtils.smoothstep(P[i * 3 + 1], 0, h * 0.55);
      ao[i] = THREE.MathUtils.lerp(0.5, 1, low) * (1 - 0.6 * cav[i]);
    }
    geo.setAttribute('rockAo', new THREE.BufferAttribute(ao, 1));
    geo.setAttribute('rockCav', new THREE.BufferAttribute(cav, 1));
  }
  return { geo, box: geo.boundingBox!, sphere };
}

function makeRock(
  kind: RockKind,
  seed: number,
  detail: number,
  proxyDetail: number | null,
  large: boolean,
  wideIterations: number,
): RockTemplate {
  const params = makeParams(kind, seed, large);
  const { geo, box, sphere } = buildGeometry(params, detail, { wideIterations });
  const proxy = proxyDetail === null ? null : buildGeometry(params, proxyDetail, null).geo;
  const height = box.max.y - box.min.y;
  const radius = Math.max(box.max.x - box.min.x, box.max.z - box.min.z) / 2;
  return { kind, geometry: geo, coarse: { count: sphere.coarseCount, parents: sphere.parents }, proxy, height, radius };
}

export interface RockLibrary {
  /** 大きめの岩と中くらいの岩（割れ目と層の段差あり） */
  large: RockTemplate[];
  /** 海底の緑の岩（こぶの多い背の高い塊） */
  coral: RockTemplate[];
  /** 小石 */
  small: RockTemplate[];
  /** 細かな砂利（影は落とさない） */
  gravel: RockTemplate[];
}

/**
 * 主要な岩の形の一覧（config の rocks.major の「形の番号」に対応）。
 * 0・5・9 角張った岩片、1・7 丸い岩、2・8 平たい岩、3・11 横長の岩、4・6・10 塊の寄り集まった岩、
 * 12・13 崖から落ちた角張った岩塊
 */
export const LARGE_KINDS: RockKind[] = [
  'angular', 'rounded', 'slab', 'long', 'lumpy', 'angular', 'lumpy',
  'rounded', 'slab', 'angular', 'lumpy', 'long', 'block', 'block',
];
const SMALL_KINDS: RockKind[] = ['angular', 'rounded', 'slab', 'long', 'angular', 'lumpy', 'rounded', 'block'];
const GRAVEL_KINDS: RockKind[] = ['angular', 'rounded', 'slab', 'angular', 'rounded'];

/** 岩の形を種類ごとにいくつか作る（同じシードなら同じ形） */
export function createRockTemplates(seed: number): RockLibrary {
  const s = (k: number) => (seed * 7919 + k * 104729) >>> 0;
  return {
    large: LARGE_KINDS.map((k, i) => makeRock(k, s(i + 1), 4, 2, true, 6)),
    coral: Array.from({ length: 6 }, (_, i) => makeRock('coral', s(i + 301), 4, 2, false, 6)),
    // 小石は小さく数が多いので、1 段粗い細分で作る（見る向きを変えるときも軽く描けるように）
    small: SMALL_KINDS.map((k, i) => makeRock(k, s(i + 101), 2, 1, false, 3)),
    gravel: GRAVEL_KINDS.map((k, i) => makeRock(k, s(i + 201), 2, null, false, 2)),
  };
}
