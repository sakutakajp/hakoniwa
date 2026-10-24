import * as THREE from 'three';
import { mulberry32 } from '../noise';

/**
 * 植物の形のひな形（インスタンス描画で使い回す）。形はすべて高さ 1（根元が y = 0）にそろえ、配置のときに拡大する。
 *  - 葉の塊：乱した小さな多面体（葉の粒）を重ねる（シリーズの苔のような質感）。aShade は樹冠の外側・上ほど 1
 *  - 羽状の葉（シダ・ソテツ）：中央で浅く折れた細長い板に、葉の形のテクスチャを貼って切り抜く
 *  - 幹と枝：先細りの管
 *  - 影の計算用の簡易形状（正二十面体の塊と管）
 * 木は、高さ方向の何か所かで光の当たり具合を調べる（森の下の方は暗く、梢は明るい）。
 */

export type PlantKind = 'araucaria' | 'pine' | 'spruce' | 'broadleaf' | 'cycad' | 'fern' | 'shrub' | 'tuft';

export interface PlantTemplate {
  kind: PlantKind;
  /** 葉の塊（aShade 属性付き） */
  foliage: THREE.BufferGeometry | null;
  /** 羽状の葉（uv・aShade 属性付き） */
  fronds: THREE.BufferGeometry | null;
  /** 針葉樹の枝葉の板（uv・aShade 属性付き。枝葉のテクスチャで切り抜く） */
  sprays: THREE.BufferGeometry | null;
  /** 広葉樹の葉の房の板（uv・aShade 属性付き。放射状の葉のテクスチャで切り抜く） */
  rosettes: THREE.BufferGeometry | null;
  /** 幹と枝 */
  wood: THREE.BufferGeometry | null;
  /** 影の計算用の簡易形状 */
  proxy: THREE.BufferGeometry | null;
  /** 横幅の半分（高さ 1 に対する比率） */
  radius: number;
  /** 高さ方向の各位置（0〜1）での樹冠の半径（光を調べる点を樹冠の外側に置くのに使う） */
  crownAt: (t: number) => number;
}

type V3 = THREE.Vector3;
const v3 = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);

// 正二十面体（12 頂点・20 面）
const T = (1 + Math.sqrt(5)) / 2;
const ICO_VERTS = [
  [-1, T, 0], [1, T, 0], [-1, -T, 0], [1, -T, 0],
  [0, -1, T], [0, 1, T], [0, -1, -T], [0, 1, -T],
  [T, 0, -1], [T, 0, 1], [-T, 0, -1], [-T, 0, 1],
].map(([x, y, z]) => v3(x, y, z).normalize());
const ICO_FACES = [
  [0, 11, 5], [0, 5, 1], [0, 1, 7], [0, 7, 10], [0, 10, 11],
  [1, 5, 9], [5, 11, 4], [11, 10, 2], [10, 7, 6], [7, 1, 8],
  [3, 9, 4], [3, 4, 2], [3, 2, 6], [3, 6, 8], [3, 8, 9],
  [4, 9, 5], [2, 4, 11], [6, 2, 10], [8, 6, 7], [9, 8, 1],
];
// 正八面体（小さな葉の粒用。6 頂点・8 面）
const OCT_VERTS = [
  [1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1],
].map(([x, y, z]) => v3(x, y, z));
const OCT_FACES = [
  [0, 2, 4], [4, 2, 1], [1, 2, 5], [5, 2, 0],
  [4, 3, 0], [1, 3, 4], [5, 3, 1], [0, 3, 5],
];
/** この大きさより小さな葉の粒は八面体にする（ひな形の高さ 1 に対する比率） */
const SMALL_BLOB = 0.0115;

class Builder {
  readonly pos: number[] = [];
  readonly nor: number[] = [];
  readonly shade: number[] = [];
  readonly uv: number[] = [];
  readonly idx: number[] = [];
  get count() {
    return this.pos.length / 3;
  }
  vertex(p: V3, n: V3, s = 1, u = 0, v = 0) {
    this.pos.push(p.x, p.y, p.z);
    this.nor.push(n.x, n.y, n.z);
    this.shade.push(s);
    this.uv.push(u, v);
    return this.count - 1;
  }
  build(opts: { shade?: boolean; uv?: boolean } = {}): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3));
    if (opts.shade) g.setAttribute('aShade', new THREE.Float32BufferAttribute(this.shade, 1));
    if (opts.uv) g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setIndex(this.idx);
    g.computeBoundingSphere();
    g.computeBoundingBox();
    return g;
  }
}

interface Crown {
  center: V3;
  radius: number;
}

const randomUnit = (rnd: () => number) => {
  const z = rnd() * 2 - 1;
  const t = rnd() * Math.PI * 2;
  const s = Math.sqrt(1 - z * z);
  return v3(s * Math.cos(t), z, s * Math.sin(t));
};
const randomRotation = (rnd: () => number) =>
  new THREE.Quaternion().setFromEuler(new THREE.Euler(rnd() * Math.PI, rnd() * Math.PI * 2, rnd() * Math.PI));

/** 葉の粒を1つ足す（乱した正二十面体）。法線は粒・塊・樹冠の向きを混ぜ、葉の塊全体がやわらかく陰影づく */
function addLeafBlob(b: Builder, rnd: () => number, c: V3, r: number, scale: V3, crown: Crown, clump: Crown, rot: THREE.Quaternion) {
  const base = b.count;
  const tmp = v3();
  const n = v3();
  const toCrown = v3();
  const toClump = v3();
  const bumps = [0, 1, 2].map(() => ({ d: randomUnit(rnd), a: -0.25 + 0.6 * rnd() }));
  const small = r < SMALL_BLOB;
  const verts = small ? OCT_VERTS : ICO_VERTS;
  const faces = small ? OCT_FACES : ICO_FACES;
  for (const iv of verts) {
    let jitter = 1 + (rnd() - 0.5) * 0.4;
    for (const bp of bumps) {
      const t = iv.dot(bp.d);
      if (t > 0) jitter += bp.a * t * t;
    }
    tmp.copy(iv).multiply(scale).multiplyScalar(r * jitter).applyQuaternion(rot);
    const p = tmp.clone().add(c);
    n.copy(iv).divide(scale).applyQuaternion(rot).normalize();
    toCrown.copy(p).sub(crown.center);
    const dCrown = Math.min(1.2, toCrown.length() / crown.radius);
    toCrown.normalize();
    toClump.copy(p).sub(clump.center);
    const dClump = Math.min(1.2, toClump.length() / Math.max(clump.radius, 1e-6));
    toClump.normalize();
    const nn = n.clone().multiplyScalar(0.2).addScaledVector(toClump, 0.55).addScaledVector(toCrown, 0.25).normalize();
    const s = THREE.MathUtils.clamp(0.04 + 0.3 * dCrown + 0.3 * dClump + 0.12 * n.dot(toClump) + 0.24 * nn.y, 0, 1);
    b.vertex(p, nn, s);
  }
  for (const [a, c2, d] of faces) b.idx.push(base + a, base + c2, base + d);
}

/** 先細りの管（幹・枝）。sides 角の断面 */
function addTube(b: Builder, a: V3, e: V3, ra: number, re: number, sides = 6, shade = 0.5) {
  const axis = e.clone().sub(a);
  const len = axis.length();
  if (len < 1e-6) return;
  axis.divideScalar(len);
  const helper = Math.abs(axis.y) < 0.9 ? v3(0, 1, 0) : v3(1, 0, 0);
  const u = v3().crossVectors(axis, helper).normalize();
  const w = v3().crossVectors(axis, u).normalize();
  const base = b.count;
  for (let ring = 0; ring < 2; ring++) {
    const c = ring === 0 ? a : e;
    const r = ring === 0 ? ra : re;
    for (let i = 0; i < sides; i++) {
      const t = (i / sides) * Math.PI * 2;
      const n = u.clone().multiplyScalar(Math.cos(t)).addScaledVector(w, Math.sin(t));
      b.vertex(c.clone().addScaledVector(n, r), n, shade, i / sides, ring);
    }
  }
  for (let i = 0; i < sides; i++) {
    const i0 = base + i;
    const i1 = base + ((i + 1) % sides);
    const j0 = i0 + sides;
    const j1 = i1 + sides;
    b.idx.push(i0, j0, j1, i0, j1, i1);
  }
}

/** 曲がった枝（点の列を管でつなぐ） */
function addPath(b: Builder, pts: V3[], r0: number, r1: number, sides = 5) {
  for (let i = 0; i < pts.length - 1; i++) {
    const t0 = i / (pts.length - 1);
    const t1 = (i + 1) / (pts.length - 1);
    addTube(b, pts[i], pts[i + 1], r0 + (r1 - r0) * t0, r0 + (r1 - r0) * t1, sides);
  }
}

/** 影の計算用の簡易な塊 */
function addProxyBlob(b: Builder, c: V3, r: number, squash: number) {
  const base = b.count;
  for (const iv of ICO_VERTS) b.vertex(v3(iv.x * r, iv.y * r * squash, iv.z * r).add(c), iv, 1);
  for (const [a, c2, d] of ICO_FACES) b.idx.push(base + a, base + c2, base + d);
}

/**
 * 羽状の葉 1 枚：付け根 p0 から、向き az（水平の角度）と仰角 el で伸び、先へ行くほど垂れる（droop）。
 * 断面は中央の軸で浅く折れた形（両側がわずかに上がる）。幅 width は葉の幅の最大値（テクスチャの横いっぱい）
 */
function addFrond(b: Builder, p0: V3, az: number, el: number, droop: number, length: number, width: number, fold = 0.25, steps = 7) {
  const base = b.count;
  const side = v3(-Math.sin(az), 0, Math.cos(az));
  let p = p0.clone();
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const e = el - droop * t * t;
    const dir = v3(Math.cos(az) * Math.cos(e), Math.sin(e), Math.sin(az) * Math.cos(e));
    if (i > 0) p = p.clone().addScaledVector(dir, length / steps);
    // 板の向き（法線）：進む向きと横向きに直交（上向き寄り）
    const n = new THREE.Vector3().crossVectors(side, dir).normalize();
    if (n.y < 0) n.negate();
    const w = width * 0.5;
    const lift = w * fold;
    const shade = 0.35 + 0.65 * t;
    const nl = n.clone().addScaledVector(side, 0.35).normalize();
    const nr = n.clone().addScaledVector(side, -0.35).normalize();
    b.vertex(p.clone().addScaledVector(side, w).add(v3(0, lift, 0)), nl, shade, 0, t);
    b.vertex(p.clone(), n, Math.min(1, shade + 0.1), 0.5, t);
    b.vertex(p.clone().addScaledVector(side, -w).add(v3(0, lift, 0)), nr, shade, 1, t);
  }
  for (let i = 0; i < steps; i++) {
    const a = base + i * 3;
    const c = a + 3;
    b.idx.push(a, c, a + 1, a + 1, c, c + 1, a + 1, c + 1, a + 2, a + 2, c + 1, c + 2);
  }
}

/**
 * 針葉樹の枝葉の板 1 枚：p0 から dir の向きへ length 伸び、先へ行くほど下へ曲がる（droop はラジアン）。
 * 幅 width はテクスチャの横いっぱい。fold が負なら両側が下がる（枝葉の両脇が垂れる）。
 * 法線は板の向きと樹冠の外向きを混ぜる（樹冠全体がやわらかく陰影づく）
 */
function addSpray(
  b: Builder,
  p0: V3,
  dir: V3,
  droop: number,
  length: number,
  width: number,
  crown: Crown,
  fold = -0.18,
  steps = 4,
) {
  const base = b.count;
  const d0 = dir.clone().normalize();
  const side = Math.abs(d0.y) > 0.98 ? v3(1, 0, 0) : v3().crossVectors(d0, v3(0, 1, 0)).normalize();
  const out = v3();
  let p = p0.clone();
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const d = d0.clone().applyAxisAngle(side, -droop * t);
    if (i > 0) p = p.clone().addScaledVector(d, length / steps);
    const n = v3().crossVectors(side, d).normalize();
    if (n.y < 0) n.negate();
    out.copy(p).sub(crown.center);
    const dc = Math.min(1.25, out.length() / crown.radius);
    out.normalize();
    const nn = n.clone().multiplyScalar(0.45).addScaledVector(out, 0.55).add(v3(0, 0.12, 0)).normalize();
    const s = THREE.MathUtils.clamp(0.06 + 0.5 * dc + 0.28 * t + 0.12 * nn.y, 0, 1);
    const w = width * 0.5 * (0.55 + 0.45 * Math.sin(Math.PI * Math.min(1, 0.25 + t)));
    const drop = n.clone().multiplyScalar(w * fold);
    b.vertex(p.clone().addScaledVector(side, w).add(drop), nn, s, 0, t);
    b.vertex(p.clone(), nn, Math.min(1, s + 0.05), 0.5, t);
    b.vertex(p.clone().addScaledVector(side, -w).add(drop), nn, s, 1, t);
  }
  for (let i = 0; i < steps; i++) {
    const a = base + i * 3;
    const c = a + 3;
    b.idx.push(a, c, a + 1, a + 1, c, c + 1, a + 1, c + 1, a + 2, a + 2, c + 1, c + 2);
  }
}

/**
 * 広葉樹の葉の房の板 1 枚（中心 c、向き normal、一辺 size）。縁ほど下がる傘の形。
 * テクスチャの向きは乱数で回す
 */
function addRosette(b: Builder, rnd: () => number, c: V3, normal: V3, size: number, crown: Crown, droop = 0.18) {
  const n = normal.clone().normalize();
  const helper = Math.abs(n.y) < 0.9 ? v3(0, 1, 0) : v3(1, 0, 0);
  const t1 = v3().crossVectors(n, helper).normalize().applyAxisAngle(n, rnd() * Math.PI * 2);
  const t2 = v3().crossVectors(n, t1).normalize();
  const out = c.clone().sub(crown.center);
  const dc = Math.min(1.25, out.length() / crown.radius);
  out.normalize();
  const base = b.count;
  for (let j = 0; j <= 2; j++) {
    for (let i = 0; i <= 2; i++) {
      const a = i - 1;
      const e = j - 1;
      const r2 = a * a + e * e;
      const p = c.clone().addScaledVector(t1, a * size * 0.5).addScaledVector(t2, e * size * 0.5).addScaledVector(n, -droop * size * r2 * 0.5);
      const nn = n.clone().multiplyScalar(0.4).addScaledVector(out, 0.6).add(v3(a, 0, e).multiplyScalar(0.0)).normalize();
      const s = THREE.MathUtils.clamp(0.08 + 0.55 * dc + 0.15 * nn.y + (r2 > 0 ? 0.12 : 0), 0, 1);
      b.vertex(p, nn, s, i / 2, j / 2);
    }
  }
  for (let j = 0; j < 2; j++) {
    for (let i = 0; i < 2; i++) {
      const a = base + j * 3 + i;
      b.idx.push(a, a + 1, a + 3, a + 1, a + 4, a + 3);
    }
  }
}

/** 樹冠の芯（暗い塊）：板の葉のすき間から空が透けないように、内側を埋める */
function addCore(b: Builder, c: V3, r: number, squash: number, shade = 0.06) {
  const base = b.count;
  for (const iv of ICO_VERTS) b.vertex(v3(iv.x * r, iv.y * r * squash, iv.z * r).add(c), iv, shade);
  for (const [a, c2, d] of ICO_FACES) b.idx.push(base + a, base + c2, base + d);
}

/** ひな形を高さ 1 にそろえる */
function finish(
  kind: PlantKind,
  parts: { foliage?: Builder; fronds?: Builder; sprays?: Builder; rosettes?: Builder; wood?: Builder; proxy?: Builder },
): PlantTemplate {
  const foliage = parts.foliage && parts.foliage.count > 0 ? parts.foliage.build({ shade: true }) : null;
  const fronds = parts.fronds && parts.fronds.count > 0 ? parts.fronds.build({ shade: true, uv: true }) : null;
  const sprays = parts.sprays && parts.sprays.count > 0 ? parts.sprays.build({ shade: true, uv: true }) : null;
  const rosettes = parts.rosettes && parts.rosettes.count > 0 ? parts.rosettes.build({ shade: true, uv: true }) : null;
  const wood = parts.wood && parts.wood.count > 0 ? parts.wood.build({ uv: true }) : null;
  const proxy = parts.proxy && parts.proxy.count > 0 ? parts.proxy.build() : null;
  let top = 0;
  for (const g of [foliage, fronds, sprays, rosettes]) if (g) top = Math.max(top, g.boundingBox!.max.y);
  if (top <= 0 && wood) top = wood.boundingBox!.max.y;
  const s = 1 / top;
  let radius = 0;
  for (const g of [foliage, fronds, sprays, rosettes, wood, proxy]) {
    if (!g) continue;
    g.scale(s, s, s);
    g.computeBoundingBox();
    g.computeBoundingSphere();
    const bb = g.boundingBox!;
    if (g !== proxy) radius = Math.max(radius, -bb.min.x, bb.max.x, -bb.min.z, bb.max.z);
  }
  // 高さ方向の樹冠の半径（10 段）
  const bins = new Float32Array(11);
  for (const g of [foliage, fronds, sprays, rosettes]) {
    if (!g) continue;
    const P = g.attributes.position;
    for (let i = 0; i < P.count; i++) {
      const y = P.getY(i);
      const k = Math.round(THREE.MathUtils.clamp(y, 0, 1) * 10);
      bins[k] = Math.max(bins[k], Math.hypot(P.getX(i), P.getZ(i)));
    }
  }
  const crownAt = (t: number) => {
    const f = THREE.MathUtils.clamp(t, 0, 1) * 10;
    const k = Math.min(9, Math.floor(f));
    return bins[k] + (bins[k + 1] - bins[k]) * (f - k);
  };
  return { kind, foliage, fronds, sprays, rosettes, wood, proxy, radius, crownAt };
}

/**
 * アラウカリア（ナンヨウスギの仲間）：まっすぐ高い幹の上の方に、輪生する長い枝が横へ張り出して先が上へ反り、
 * 枝に沿って上向きの枝葉が並ぶ（燭台のような段。下の段ほど枝が長く、全体は平たい傘のような樹冠）
 */
function makeAraucaria(seed: number): PlantTemplate {
  const rnd = mulberry32(seed);
  const leaf = new Builder();
  const spray = new Builder();
  const wood = new Builder();
  const proxy = new Builder();
  const lean = v3((rnd() - 0.5) * 0.03, 0, (rnd() - 0.5) * 0.03);
  const trunkTop = 0.96;
  const trunkPts = [0, 0.3, 0.6, 0.8, trunkTop].map((y, i) =>
    v3(lean.x * y + (i > 0 && i < 4 ? (rnd() - 0.5) * 0.008 : 0), i === 0 ? -0.04 : y, lean.z * y + (i > 0 && i < 4 ? (rnd() - 0.5) * 0.008 : 0)),
  );
  addPath(wood, trunkPts, 0.013, 0.004, 7);
  addTube(proxy, v3(0, -0.03, 0), trunkPts[trunkPts.length - 1], 0.016, 0.006, 4);
  const crown: Crown = { center: v3(lean.x * 0.85, 0.82, lean.z * 0.85), radius: 0.22 };
  const trunkAt = (y: number) => v3(lean.x * y, y, lean.z * y);
  const nWhorl = 6 + Math.floor(rnd() * 2);
  for (let k = 0; k < nWhorl; k++) {
    const f = k / (nWhorl - 1);
    const y = 0.58 + 0.35 * Math.pow(f, 0.85) + (rnd() - 0.5) * 0.015;
    const nb = 5 + Math.floor(rnd() * 2);
    const a0 = rnd() * Math.PI * 2;
    const len = (0.23 - 0.16 * f) * (0.85 + 0.3 * rnd());
    for (let i = 0; i < nb; i++) {
      const az = a0 + (i / nb) * Math.PI * 2 + (rnd() - 0.5) * 0.6;
      const d = v3(Math.cos(az), 0, Math.sin(az));
      const p0 = trunkAt(y);
      // 枝：はじめ少し下がり、先は上へ反る（燭台の形）
      const p1 = p0.clone().addScaledVector(d, len * 0.45).add(v3(0, -0.012 - 0.02 * (1 - f), 0));
      const p2 = p0.clone().addScaledVector(d, len * 0.82);
      const p3 = p0.clone().addScaledVector(d, len).add(v3(0, 0.035 + 0.02 * (1 - f), 0));
      addPath(wood, [p0, p1, p2, p3], 0.0032 - 0.001 * f, 0.0012, 4);
      // 枝に沿った枝葉：左右へ斜め上に開く（瓶洗いのブラシのよう）。先ほど短い
      const path = [p0, p1, p2, p3];
      const along = (t: number) => {
        const x = t * 3;
        const j = Math.min(2, Math.floor(x));
        return path[j].clone().lerp(path[j + 1], x - j);
      };
      const nSp = Math.max(3, Math.round(len / 0.02));
      for (let s = 1; s <= nSp; s++) {
        const t = 0.08 + (0.92 * s) / nSp;
        const p = along(t);
        const tangent = along(Math.min(1, t + 0.05)).sub(along(Math.max(0, t - 0.05))).normalize();
        for (const sd of [-1, 1]) {
          const dir = tangent.clone().applyAxisAngle(v3(0, 1, 0), sd * (0.7 + 0.35 * rnd())).add(v3(0, 0.35 + 0.35 * rnd(), 0)).normalize();
          const L = (0.09 - 0.03 * t) * (0.85 + 0.3 * rnd()) * (0.8 + 0.4 * (1 - f));
          addSpray(spray, p, dir, 0.55, L, L * 0.7, crown, -0.12, 3);
        }
        // 枝の上に立つ枝葉（段の上面を埋める）
        if (s % 2 === 0) {
          const dir = tangent.clone().add(v3(0, 1.4, 0)).normalize();
          addSpray(spray, p, dir, 0.7, 0.06 * (0.85 + 0.3 * rnd()), 0.045, crown, -0.1, 3);
        }
      }
      // 枝先の房：上と外へ開く数枚
      for (let s = 0; s < 4; s++) {
        const dir = d.clone().applyAxisAngle(v3(0, 1, 0), (s - 1.5) * 0.6).add(v3(0, 0.9 + 0.4 * rnd(), 0)).normalize();
        addSpray(spray, p3, dir, 0.6, 0.075 * (0.85 + 0.3 * rnd()), 0.055, crown, -0.1, 3);
      }
      addProxyBlob(proxy, p0.clone().lerp(p3, 0.75).add(v3(0, 0.015, 0)), len * 0.35, 0.5);
    }
  }
  // 梢：上を向いた枝葉の房
  const topC = trunkAt(trunkTop);
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2 + rnd();
    const dir = v3(Math.cos(a) * 0.6, 1, Math.sin(a) * 0.6).normalize();
    addSpray(spray, topC.clone().add(v3(0, -0.04, 0)), dir, 0.5, 0.075, 0.05, crown, -0.1, 3);
  }
  addProxyBlob(proxy, topC, 0.06, 0.8);
  return finish('araucaria', { foliage: leaf, sprays: spray, wood, proxy });
}

/**
 * マツ：幹の下の方は枝がなく、上の方に、横へ広がる雲形の枝葉の固まりがいくつも付く（向きも高さも不ぞろい）。
 * 固まりは、枝の先から外へ放射状に広がる枝葉の板と、上を向いた板でできている。樹冠は丸みのある円錐形
 */
function makePine(seed: number): PlantTemplate {
  const rnd = mulberry32(seed);
  const leaf = new Builder();
  const spray = new Builder();
  const wood = new Builder();
  const proxy = new Builder();
  const lean = v3((rnd() - 0.5) * 0.06, 0, (rnd() - 0.5) * 0.06);
  const trunkAt = (y: number) => v3(lean.x * y + 0.01 * Math.sin(y * 9 + seed), y, lean.z * y + 0.01 * Math.cos(y * 7 + seed));
  addPath(wood, [-0.04, 0.3, 0.6, 0.85, 0.97].map((y) => trunkAt(y)), 0.014, 0.004, 7);
  addTube(proxy, v3(0, -0.03, 0), trunkAt(0.95), 0.016, 0.006, 4);
  const crownBase = 0.42 + 0.1 * rnd();
  const crown: Crown = { center: trunkAt(0.72), radius: 0.24 };
  const maxR = 0.2 + 0.06 * rnd();
  const n = 15 + Math.floor(rnd() * 5);
  let az = rnd() * Math.PI * 2;
  for (let k = 0; k < n; k++) {
    const f = (k + 0.5 * rnd()) / n;
    const y = crownBase + (0.92 - crownBase) * f;
    // 樹冠の輪郭：下は少し狭く、中ほどが広く、上へ尖る
    const prof = Math.min(1, (f + 0.25) * 1.8) * Math.pow(1 - f, 0.6);
    const R = maxR * (0.4 + 0.6 * prof) * (0.85 + 0.3 * rnd());
    az += 2.4 + (rnd() - 0.5) * 0.6;
    const d = v3(Math.cos(az), 0.1 + 0.15 * rnd(), Math.sin(az)).normalize();
    const p0 = trunkAt(y);
    const tip = p0.clone().addScaledVector(d, R * 0.62);
    addPath(wood, [p0, p0.clone().lerp(tip, 0.5).add(v3(0, -0.01, 0)), tip], 0.0045 * (1 - 0.4 * f), 0.0016, 4);
    // 雲形の固まり：枝のまわりに、外へ扇形に開く板と、上面を埋める板
    const fan = 6 + Math.floor(rnd() * 2);
    for (let s = 0; s < fan; s++) {
      const a = (s / (fan - 1) - 0.5) * 2.4 + (rnd() - 0.5) * 0.3;
      const dir = d.clone().applyAxisAngle(v3(0, 1, 0), a);
      dir.y = 0.04 + 0.16 * rnd();
      const st = p0.clone().addScaledVector(d, R * (0.15 + 0.2 * Math.abs(a) / 1.2));
      addSpray(spray, st, dir, 0.4, R * (0.68 + 0.3 * rnd()) * (1 - 0.2 * Math.abs(a) / 1.2), R * 0.6, crown, -0.15, 4);
    }
    for (let s = 0; s < 3; s++) {
      const dir = d.clone().applyAxisAngle(v3(0, 1, 0), (s - 1) * 0.8).add(v3(0, 1.0 + 0.4 * rnd(), 0)).normalize();
      addSpray(spray, p0.clone().addScaledVector(d, R * (0.25 + 0.15 * s)), dir, 0.7, R * 0.45, R * 0.4, crown, -0.1, 3);
    }
    addProxyBlob(proxy, p0.clone().addScaledVector(d, R * 0.5), R * 0.5, 0.4);
  }
  // 梢：上を向いた枝葉
  const top = trunkAt(0.95);
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2 + rnd();
    addSpray(spray, top.clone().add(v3(0, -0.04, 0)), v3(Math.cos(a) * 0.55, 1, Math.sin(a) * 0.55), 0.45, 0.075, 0.05, crown, -0.1, 3);
  }
  addProxyBlob(proxy, top, 0.045, 1.2);
  return finish('pine', { foliage: leaf, sprays: spray, wood, proxy });
}

/** トウヒ（モミ）のような円錐形の木：下から上まで、垂れ気味の枝葉の段が密に重なり、梢は尖る */
function makeSpruce(seed: number): PlantTemplate {
  const rnd = mulberry32(seed);
  const leaf = new Builder();
  const spray = new Builder();
  const wood = new Builder();
  const proxy = new Builder();
  const trunkAt = (y: number) => v3(0.006 * Math.sin(y * 8 + seed), y, 0.006 * Math.cos(y * 6 + seed));
  addPath(wood, [-0.04, 0.3, 0.6, 0.9, 0.98].map((y) => trunkAt(y)), 0.013, 0.003, 6);
  addTube(proxy, v3(0, -0.03, 0), trunkAt(0.95), 0.015, 0.005, 4);
  const crownBase = 0.1 + 0.12 * rnd();
  const crown: Crown = { center: trunkAt(0.42), radius: 0.36 };
  const maxR = 0.3 + 0.06 * rnd();
  const nTier = 13 + Math.floor(rnd() * 3);
  for (let k = 0; k < nTier; k++) {
    const f = k / (nTier - 1);
    const y = crownBase + (0.92 - crownBase) * f + (rnd() - 0.5) * 0.012;
    const R = maxR * Math.pow(1 - f, 0.95) + 0.03;
    const nb = Math.max(4, Math.round((6 + Math.floor(rnd() * 3)) * (0.6 + 0.4 * (1 - f))));
    const a0 = rnd() * Math.PI * 2;
    for (let i = 0; i < nb; i++) {
      const az = a0 + (i / nb) * Math.PI * 2 + (rnd() - 0.5) * 0.45;
      const el = -0.22 + 0.2 * f + (rnd() - 0.5) * 0.1;
      const d = v3(Math.cos(az) * Math.cos(el), Math.sin(el), Math.sin(az) * Math.cos(el));
      const p0 = trunkAt(y);
      if (R > 0.07) addTube(wood, p0, p0.clone().addScaledVector(d, R * 0.6), 0.003, 0.0012, 4);
      // 枝葉：付け根から先まで垂れる板と、途中から左右に分かれる板
      addSpray(spray, p0.clone().addScaledVector(d, 0.01), d, 0.55, R * 1.02, Math.max(0.05, R * 0.72), crown, -0.2, 4);
      if (R > 0.075) {
        for (const sd of [-1, 1]) {
          const dir = d.clone().applyAxisAngle(v3(0, 1, 0), sd * (0.55 + 0.2 * rnd()));
          dir.y -= 0.08;
          addSpray(spray, p0.clone().addScaledVector(d, R * 0.38), dir, 0.5, R * 0.58, R * 0.48, crown, -0.2, 3);
        }
      }
    }
    if (k % 2 === 0) {
      addCore(leaf, trunkAt(y - 0.01), R * 0.55, 0.55, 0.06);
      addProxyBlob(proxy, trunkAt(y - 0.02), R * 0.75 + 0.02, 0.45);
    }
  }
  // 梢：細く尖った上向きの枝葉
  const top = trunkAt(0.9);
  addSpray(spray, top, v3(0, 1, 0), 0.0, 0.1, 0.04, crown, -0.05, 3);
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2 + rnd();
    addSpray(spray, top.clone().add(v3(0, -0.02, 0)), v3(Math.cos(a) * 0.55, 1, Math.sin(a) * 0.55), 0.3, 0.06, 0.035, crown, -0.1, 3);
  }
  return finish('spruce', { foliage: leaf, sprays: spray, wood, proxy });
}

/**
 * 明るい緑の広葉樹（グロッソプテリスやイチョウのような古い木）：幹が途中で何本かの太い枝に分かれ、
 * 枝先ごとに、星形に開いた葉の房がたくさん集まって、ふんわりした丸い樹冠をつくる
 */
function makeBroadleaf(seed: number): PlantTemplate {
  const rnd = mulberry32(seed);
  const leaf = new Builder();
  const ros = new Builder();
  const wood = new Builder();
  const proxy = new Builder();
  const fork = 0.42 + 0.1 * rnd();
  const lean = v3((rnd() - 0.5) * 0.05, 0, (rnd() - 0.5) * 0.05);
  const forkP = v3(lean.x, fork, lean.z);
  addPath(wood, [v3(0, -0.04, 0), v3(lean.x * 0.4, fork * 0.5, lean.z * 0.4), forkP], 0.022, 0.014, 7);
  addTube(proxy, v3(0, -0.03, 0), forkP, 0.024, 0.015, 4);
  const crown: Crown = { center: v3(lean.x, 0.74, lean.z), radius: 0.3 };
  /** 葉の房の集まり（中心 c、半径 r）：上半分に多く、外向きの板を並べる */
  const cluster = (c: V3, r: number, n: number) => {
    for (let i = 0; i < n; i++) {
      const d = randomUnit(rnd);
      d.y = Math.abs(d.y) * 0.8 + d.y * 0.2;
      d.normalize();
      const dist = r * (0.55 + 0.45 * Math.sqrt(rnd()));
      const p = c.clone().addScaledVector(d, dist);
      p.y -= r * 0.15;
      const nrm = d.clone().multiplyScalar(0.7).add(v3(0, 0.55, 0));
      addRosette(ros, rnd, p, nrm, r * (0.7 + 0.25 * rnd()), crown, 0.22);
    }
    addCore(leaf, c.clone().add(v3(0, -r * 0.15, 0)), r * 0.5, 0.7, 0.03);
  };
  const nLimb = 3 + Math.floor(rnd() * 3);
  const a0 = rnd() * Math.PI * 2;
  for (let i = 0; i < nLimb; i++) {
    const az = a0 + (i / nLimb) * Math.PI * 2 + (rnd() - 0.5) * 0.7;
    const el = THREE.MathUtils.degToRad(45 + 25 * rnd());
    const len = 0.22 + 0.12 * rnd();
    const d = v3(Math.cos(az) * Math.cos(el), Math.sin(el), Math.sin(az) * Math.cos(el));
    const p1 = forkP.clone().addScaledVector(d, len);
    addPath(wood, [forkP, forkP.clone().lerp(p1, 0.5).add(v3(0, -0.015, 0)), p1], 0.011, 0.005, 5);
    const r = 0.11 + 0.05 * rnd();
    cluster(p1.clone().add(v3(0, r * 0.3, 0)), r, 50);
    addProxyBlob(proxy, p1.clone().add(v3(0, r * 0.3, 0)), r * 1.0, 0.75);
    if (rnd() < 0.7) {
      const pm = forkP.clone().lerp(p1, 0.55).addScaledVector(v3(Math.cos(az), 0, Math.sin(az)), 0.06);
      cluster(pm, r * 0.7, 24);
    }
  }
  const rt = 0.13 + 0.04 * rnd();
  cluster(forkP.clone().add(v3(0, 0.36, 0)), rt, 60);
  addProxyBlob(proxy, forkP.clone().add(v3(0, 0.36, 0)), rt, 0.75);
  return finish('broadleaf', { foliage: leaf, rosettes: ros, wood, proxy });
}

/** ソテツ（木生シダ）：太く短い幹の上に、かたい羽状の葉が放射状に広がって先がゆるく垂れる */
function makeCycad(seed: number): PlantTemplate {
  const rnd = mulberry32(seed);
  const fronds = new Builder();
  const wood = new Builder();
  const proxy = new Builder();
  const trunkH = 0.26 + 0.2 * rnd();
  const top = v3((rnd() - 0.5) * 0.05, trunkH, (rnd() - 0.5) * 0.05);
  addPath(wood, [v3(0, -0.03, 0), v3(top.x * 0.5, trunkH * 0.5, top.z * 0.5), top], 0.065, 0.052, 8);
  // 幹の頂の、葉の付け根のふくらみ
  addTube(wood, top, top.clone().add(v3(0, 0.045, 0)), 0.058, 0.025, 8);
  const n = 14 + Math.floor(rnd() * 7);
  const a0 = rnd() * Math.PI * 2;
  for (let i = 0; i < n; i++) {
    const az = a0 + (i / n) * Math.PI * 2 + (rnd() - 0.5) * 0.4;
    const inner = i % 3 === 0;
    const el = THREE.MathUtils.degToRad(inner ? 55 + 15 * rnd() : 25 + 22 * rnd());
    const len = (inner ? 0.55 : 0.72) * (0.85 + 0.3 * rnd());
    addFrond(fronds, top.clone().add(v3(Math.cos(az) * 0.025, 0.035, Math.sin(az) * 0.025)), az, el, 0.9 + 0.5 * rnd(), len, len * 0.4, 0.18, 7);
  }
  addProxyBlob(proxy, top.clone().add(v3(0, 0.08, 0)), 0.4, 0.3);
  addTube(proxy, v3(0, -0.03, 0), top, 0.07, 0.06, 4);
  return finish('cycad', { fronds, wood, proxy });
}

/** シダ：地面から、やわらかい羽状の葉が放射状に弧を描いて広がる */
function makeFern(seed: number): PlantTemplate {
  const rnd = mulberry32(seed);
  const fronds = new Builder();
  const proxy = new Builder();
  const n = 9 + Math.floor(rnd() * 6);
  const a0 = rnd() * Math.PI * 2;
  for (let i = 0; i < n; i++) {
    const az = a0 + (i / n) * Math.PI * 2 + (rnd() - 0.5) * 0.5;
    const inner = rnd() < 0.3;
    const el = THREE.MathUtils.degToRad(inner ? 62 + 15 * rnd() : 38 + 18 * rnd());
    const len = (inner ? 0.75 : 1.0) * (0.8 + 0.35 * rnd());
    addFrond(fronds, v3(Math.cos(az) * 0.02, 0, Math.sin(az) * 0.02), az, el, 1.1 + 0.6 * rnd(), len, len * 0.38, 0.22, 7);
  }
  addProxyBlob(proxy, v3(0, 0.25, 0), 0.5, 0.45);
  return finish('fern', { fronds, proxy });
}

/** 低木：幹は見せず、地面近くに、星形に開いた葉の房がこんもりと集まる */
function makeShrub(seed: number): PlantTemplate {
  const rnd = mulberry32(seed);
  const leaf = new Builder();
  const ros = new Builder();
  const proxy = new Builder();
  const crown: Crown = { center: v3(0, 0.3, 0), radius: 0.6 };
  const n = 2 + Math.floor(rnd() * 3);
  for (let i = 0; i < n; i++) {
    const a = rnd() * Math.PI * 2;
    const d = i === 0 ? 0 : 0.2 + 0.22 * rnd();
    const r = (i === 0 ? 0.34 : 0.22 + 0.12 * rnd()) * (0.85 + 0.3 * rnd());
    const c = v3(Math.cos(a) * d, r * (0.55 + 0.25 * rnd()), Math.sin(a) * d);
    const m = Math.round(10 + 22 * r);
    for (let k = 0; k < m; k++) {
      const u = randomUnit(rnd);
      u.y = Math.abs(u.y) * 0.85 + u.y * 0.15;
      u.normalize();
      const p = c.clone().addScaledVector(u, r * (0.6 + 0.4 * Math.sqrt(rnd())));
      addRosette(ros, rnd, p, u.clone().multiplyScalar(0.7).add(v3(0, 0.6, 0)), r * (0.85 + 0.3 * rnd()), crown, 0.25);
    }
    addCore(leaf, c, r * 0.6, 0.7, 0.05);
    addProxyBlob(proxy, c, r * 0.9, 0.75);
  }
  return finish('shrub', { foliage: leaf, rosettes: ros, proxy });
}

/** 地面の草むら・苔の小さな盛り上がり（影は落とさない） */
function makeTuft(seed: number): PlantTemplate {
  const rnd = mulberry32(seed);
  const leaf = new Builder();
  const crown: Crown = { center: v3(0, 0.2, 0), radius: 1.2 };
  const n = 9 + Math.floor(rnd() * 5);
  for (let i = 0; i < n; i++) {
    const a = rnd() * Math.PI * 2;
    const d = Math.sqrt(rnd()) * 0.9;
    const r = 0.2 + 0.14 * rnd();
    const c = v3(Math.cos(a) * d, r * 0.5, Math.sin(a) * d);
    addLeafBlob(leaf, rnd, c, r, v3(1, 0.6 + 0.3 * rnd(), 1), crown, { center: v3(0, 0.25, 0), radius: 1 }, randomRotation(rnd));
  }
  return finish('tuft', { foliage: leaf });
}

export interface PlantLibrary {
  araucaria: PlantTemplate[];
  pine: PlantTemplate[];
  spruce: PlantTemplate[];
  broadleaf: PlantTemplate[];
  cycad: PlantTemplate[];
  fern: PlantTemplate[];
  shrub: PlantTemplate[];
  tuft: PlantTemplate[];
}

export function createPlantTemplates(seed: number): PlantLibrary {
  const s = (k: number) => (seed * 7349 + k * 104729) >>> 0;
  return {
    araucaria: [makeAraucaria(s(1)), makeAraucaria(s(2)), makeAraucaria(s(3))],
    pine: [makePine(s(11)), makePine(s(12)), makePine(s(13)), makePine(s(14))],
    spruce: [makeSpruce(s(21)), makeSpruce(s(22)), makeSpruce(s(23))],
    broadleaf: [makeBroadleaf(s(31)), makeBroadleaf(s(32)), makeBroadleaf(s(33))],
    cycad: [makeCycad(s(41)), makeCycad(s(42)), makeCycad(s(43))],
    fern: [makeFern(s(51)), makeFern(s(52)), makeFern(s(53)), makeFern(s(54))],
    shrub: [makeShrub(s(61)), makeShrub(s(62)), makeShrub(s(63))],
    tuft: [makeTuft(s(71)), makeTuft(s(72))],
  };
}
