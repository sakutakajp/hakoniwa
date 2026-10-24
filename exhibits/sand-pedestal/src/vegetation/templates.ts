import * as THREE from 'three';
import { mulberry32 } from '../noise';

/**
 * 植生の形のひな形（インスタンス描画で使い回す）。
 *  - 葉は、乱した小さな多面体（葉の粒）をいくつも重ねた「葉の塊」で作る。粒の大きさと配置を毎回変え、
 *    同じ球が並んだ見た目や、均一なスポンジのような見た目にしない。
 *  - 木は細い幹と枝を持ち、枝先に大小の葉の塊が集まる。
 *  - 形はすべて高さ 1（根元が y = 0）にそろえ、配置のときに拡大縮小する。
 */

export type PlantKind = 'tree' | 'palm' | 'shrub' | 'ground' | 'tuft' | 'vine';

export interface PlantTemplate {
  kind: PlantKind;
  /** 葉。aShade 属性（0 = 樹冠の奥・下側、1 = 外側の葉先）を持つ */
  foliage: THREE.BufferGeometry;
  /** 幹と枝（木だけ） */
  wood: THREE.BufferGeometry | null;
  /** 影の計算用の簡易形状（null なら影を落とさない） */
  proxy: THREE.BufferGeometry | null;
  /** 横幅の半分（高さ 1 に対する比率） */
  radius: number;
  /** 光の当たり具合を調べる点（樹冠の上の中央） */
  probe: THREE.Vector3;
  /** 樹冠の中心（岩にめり込んでいないかの確認に使う） */
  crownCenter: THREE.Vector3;
  crownRadius: number;
}

type V3 = THREE.Vector3;
const v3 = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);

// 正二十面体（12 頂点・20 面、外向きが反時計回り）
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

/** 正二十面体を1回細分した形（42 頂点・80 面）。大きな葉の粒の輪郭を丸くする */
const ICO1 = (() => {
  const verts = ICO_VERTS.map((v) => v.clone());
  const faces: number[][] = [];
  const mid = new Map<string, number>();
  const midpoint = (a: number, b: number) => {
    const key = a < b ? `${a}_${b}` : `${b}_${a}`;
    let i = mid.get(key);
    if (i === undefined) {
      i = verts.length;
      verts.push(verts[a].clone().add(verts[b]).normalize());
      mid.set(key, i);
    }
    return i;
  };
  for (const [a, b, c] of ICO_FACES) {
    const ab = midpoint(a, b);
    const bc = midpoint(b, c);
    const ca = midpoint(c, a);
    faces.push([a, ab, ca], [b, bc, ab], [c, ca, bc], [ab, bc, ca]);
  }
  return { verts, faces };
})();
const ICO0 = { verts: ICO_VERTS, faces: ICO_FACES };

/** 頂点を足していき、最後に BufferGeometry にする */
class Builder {
  readonly pos: number[] = [];
  readonly nor: number[] = [];
  readonly shade: number[] = [];
  readonly idx: number[] = [];

  get count() {
    return this.pos.length / 3;
  }

  vertex(p: V3, n: V3, s = 1) {
    this.pos.push(p.x, p.y, p.z);
    this.nor.push(n.x, n.y, n.z);
    this.shade.push(s);
    return this.count - 1;
  }

  build(withShade: boolean): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3));
    if (withShade) g.setAttribute('aShade', new THREE.Float32BufferAttribute(this.shade, 1));
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

/**
 * 葉の粒を1つ足す。形は乱した正二十面体。
 * 法線は粒の向きと樹冠の中心からの向きを混ぜ、葉の塊全体がやわらかく陰影づくようにする。
 * aShade は樹冠の外側・上向きほど大きい（葉先が明るく、奥が暗い）。
 */
function addLeafBlob(
  b: Builder,
  rnd: () => number,
  c: V3,
  r: number,
  scale: V3,
  crown: Crown,
  rot: THREE.Quaternion,
  clump: Crown = crown,
  detail: 0 | 1 = 0,
) {
  const base = b.count;
  const tmp = v3();
  const n = v3();
  const toCrown = v3();
  const toClump = v3();
  const mesh = detail === 1 ? ICO1 : ICO0;
  // なめらかなこぶ（いくつかの向きへのふくらみ）＋わずかな乱れで、角張らない不規則な形にする
  const bumps = [0, 1, 2, 3].map(() => ({ d: randomUnit(rnd), a: -0.25 + 0.65 * rnd() }));
  for (const iv of mesh.verts) {
    let jitter = 1 + (rnd() - 0.5) * (detail === 1 ? 0.12 : 0.4);
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
    // 粒ごとの丸みは控えめにし、塊・樹冠の丸みで陰影をつける（球が並んだ見た目にしない）
    const nn = n.clone().multiplyScalar(0.2).addScaledVector(toClump, 0.5).addScaledVector(toCrown, 0.3).normalize();
    const s = THREE.MathUtils.clamp(
      0.04 + 0.34 * dCrown + 0.26 * dClump + 0.12 * n.dot(toClump) + 0.24 * nn.y,
      0,
      1,
    );
    b.vertex(p, nn, s);
  }
  for (const [a, c2, d] of mesh.faces) b.idx.push(base + a, base + c2, base + d);
}

/** 先細りの管（幹・枝）。端のふたは見えないので作らない */
function addTube(b: Builder, a: V3, e: V3, ra: number, re: number, sides = 5) {
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
      b.vertex(c.clone().addScaledVector(n, r), n, 0.5);
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

/** 影の計算用の簡易な塊（正二十面体1つ） */
function addProxyBlob(b: Builder, c: V3, r: number, squash: number) {
  const base = b.count;
  for (const iv of ICO_VERTS) b.vertex(v3(iv.x * r, iv.y * r * squash, iv.z * r).add(c), iv, 1);
  for (const [a, c2, d] of ICO_FACES) b.idx.push(base + a, base + c2, base + d);
}

const randomUnit = (rnd: () => number) => {
  const z = rnd() * 2 - 1;
  const t = rnd() * Math.PI * 2;
  const s = Math.sqrt(1 - z * z);
  return v3(s * Math.cos(t), z, s * Math.sin(t));
};

const randomRotation = (rnd: () => number) =>
  new THREE.Quaternion().setFromEuler(new THREE.Euler(rnd() * Math.PI, rnd() * Math.PI * 2, rnd() * Math.PI));

interface ClumpSpec {
  center: V3;
  radius: number;
  /** 縦のつぶれ具合（1 で丸、小さいほど平たい） */
  squash: number;
  /** 葉の粒の数 */
  blobs: number;
  /** 上半分に粒を寄せる度合い（0〜1） */
  topBias: number;
}

/** 葉の塊（大小の粒を重ねる）。塊の輪郭に細かな凹凸と隙間ができる */
function addClump(b: Builder, rnd: () => number, spec: ClumpSpec, crown: Crown, blobSize: number, detail: 0 | 1 = 1) {
  const clump: Crown = { center: spec.center, radius: spec.radius };
  for (let i = 0; i < spec.blobs; i++) {
    const d = randomUnit(rnd);
    d.y = d.y * (1 - spec.topBias) + Math.abs(d.y) * spec.topBias;
    d.normalize();
    // 中心付近より外側寄りに粒を置き、塊の中を詰めすぎない
    const dist = spec.radius * (0.25 + 0.7 * Math.sqrt(rnd()));
    const c = spec.center.clone().add(v3(d.x * dist, d.y * dist * spec.squash, d.z * dist));
    // 大きな粒と小さな粒を混ぜる
    const r = blobSize * (rnd() < 0.3 ? 0.55 + 0.3 * rnd() : 0.85 + 0.45 * rnd());
    const sc = v3(1, 0.72 + 0.3 * rnd(), 1);
    addLeafBlob(b, rnd, c, r, sc, crown, randomRotation(rnd), clump, detail);
  }
}

/** ひな形の大きさを高さ 1 にそろえる（根元 y = 0 はそのまま） */
function normalizeHeight(geos: (THREE.BufferGeometry | null)[], top: number) {
  const s = 1 / top;
  for (const g of geos) {
    if (!g) continue;
    g.scale(s, s, s);
    g.computeBoundingSphere();
    g.computeBoundingBox();
  }
  return s;
}

function crownOf(clumps: ClumpSpec[]): Crown {
  const center = v3();
  for (const c of clumps) center.add(c.center);
  center.divideScalar(clumps.length);
  let radius = 0;
  for (const c of clumps) radius = Math.max(radius, c.center.distanceTo(center) + c.radius);
  return { center, radius };
}

function finishTemplate(
  kind: PlantKind,
  clumps: ClumpSpec[],
  leaf: Builder,
  wood: Builder | null,
  proxy: Builder | null,
): PlantTemplate {
  const foliage = leaf.build(true);
  const woodGeo = wood ? wood.build(false) : null;
  const proxyGeo = proxy ? proxy.build(false) : null;
  foliage.computeBoundingBox();
  const top = foliage.boundingBox!.max.y;
  const s = normalizeHeight([foliage, woodGeo, proxyGeo], top);
  const box = foliage.boundingBox!;
  const radius = Math.max(-box.min.x, box.max.x, -box.min.z, box.max.z);
  const crown = crownOf(clumps);
  crown.center.multiplyScalar(s);
  crown.radius *= s;
  const probe = v3(crown.center.x, 1.04, crown.center.z);
  return { kind, foliage, wood: woodGeo, proxy: proxyGeo, radius, probe, crownCenter: crown.center, crownRadius: crown.radius };
}

/**
 * 広葉樹。form = 0 で丸い樹冠、1 で幹が高く枝が横へ張る傘形の樹冠。
 * 細い幹から枝が分かれ、枝先に大小の葉の塊が集まる。
 */
function makeTree(seed: number, form: number): PlantTemplate {
  const rnd = mulberry32(seed);
  const leaf = new Builder();
  const wood = new Builder();
  const proxy = new Builder();

  const trunkTop = THREE.MathUtils.lerp(0.4, 0.6, form) + 0.08 * (rnd() - 0.5);
  const lean = v3((rnd() - 0.5) * 0.08, 0, (rnd() - 0.5) * 0.08);
  const trunkMid = v3(lean.x * 0.4 + (rnd() - 0.5) * 0.03, trunkTop * 0.5, lean.z * 0.4 + (rnd() - 0.5) * 0.03);
  const trunkEnd = v3(lean.x, trunkTop, lean.z);
  const rBase = 0.026;
  addTube(wood, v3(0, -0.08, 0), trunkMid, rBase * 1.15, rBase * 0.8);
  addTube(wood, trunkMid, trunkEnd, rBase * 0.8, rBase * 0.55);

  const clumps: ClumpSpec[] = [];
  const nBranch = 2 + Math.floor(rnd() * (form > 0.5 ? 3 : 4));
  const az0 = rnd() * Math.PI * 2;
  for (let i = 0; i < nBranch; i++) {
    const az = az0 + (i / nBranch) * Math.PI * 2 + (rnd() - 0.5) * 0.9;
    const el = THREE.MathUtils.degToRad(THREE.MathUtils.lerp(55, 25, form) + (rnd() - 0.5) * 22);
    const len = THREE.MathUtils.lerp(0.17, 0.3, form) * (0.75 + 0.5 * rnd());
    const start = trunkEnd.clone().lerp(trunkMid, rnd() * 0.45);
    const dir = v3(Math.cos(az) * Math.cos(el), Math.sin(el), Math.sin(az) * Math.cos(el));
    const end = start.clone().addScaledVector(dir, len);
    addTube(wood, start, end, rBase * 0.45, rBase * 0.22, 4);
    // 枝先の葉の塊（大小をばらつかせる）
    const r = THREE.MathUtils.lerp(0.16, 0.2, form) * (0.7 + 0.55 * rnd());
    clumps.push({
      center: end.clone().add(v3(0, r * 0.35, 0)),
      radius: r,
      squash: THREE.MathUtils.lerp(0.85, 0.6, form) * (0.85 + 0.25 * rnd()),
      blobs: 6 + Math.floor(rnd() * 5),
      topBias: THREE.MathUtils.lerp(0.35, 0.7, form),
    });
    // 枝の途中にも小さな塊を付けることがある（輪郭に段差を作る）
    if (rnd() < 0.45) {
      const mid = start.clone().lerp(end, 0.55);
      const rm = r * (0.5 + 0.25 * rnd());
      clumps.push({ center: mid.add(v3(0, rm * 0.3, 0)), radius: rm, squash: 0.75, blobs: 3 + Math.floor(rnd() * 3), topBias: 0.5 });
    }
  }
  // 幹の先の塊
  const rTop = THREE.MathUtils.lerp(0.19, 0.17, form) * (0.8 + 0.4 * rnd());
  clumps.push({
    center: trunkEnd.clone().add(v3((rnd() - 0.5) * 0.05, rTop * 0.55, (rnd() - 0.5) * 0.05)),
    radius: rTop,
    squash: THREE.MathUtils.lerp(0.9, 0.65, form),
    blobs: 7 + Math.floor(rnd() * 5),
    topBias: 0.5,
  });

  const crown = crownOf(clumps);
  for (const c of clumps) {
    // 葉の粒は正二十面体（細分しない）。数が多い木の三角形を抑え、見る向きを変えるときも軽く描けるように
    addClump(leaf, rnd, { ...c, blobs: Math.round(c.blobs * 1.45) }, crown, c.radius * 0.44, 0);
    addProxyBlob(proxy, c.center, c.radius * 0.95, c.squash);
  }
  addTube(proxy, v3(0, -0.05, 0), trunkEnd, rBase * 1.4, rBase, 4);
  return finishTemplate('tree', clumps, leaf, wood, proxy);
}

/** 低木：幹は見せず、地面近くに葉の塊が集まる */
function makeShrub(seed: number): PlantTemplate {
  const rnd = mulberry32(seed);
  const leaf = new Builder();
  const proxy = new Builder();
  const clumps: ClumpSpec[] = [];
  const n = 2 + Math.floor(rnd() * 3);
  for (let i = 0; i < n; i++) {
    const a = rnd() * Math.PI * 2;
    const d = i === 0 ? 0 : 0.18 + 0.2 * rnd();
    const r = (i === 0 ? 0.32 : 0.2 + 0.12 * rnd()) * (0.85 + 0.3 * rnd());
    clumps.push({
      center: v3(Math.cos(a) * d, r * (0.55 + 0.25 * rnd()), Math.sin(a) * d),
      radius: r,
      squash: 0.7 + 0.25 * rnd(),
      blobs: 5 + Math.floor(rnd() * 5),
      topBias: 0.45,
    });
  }
  const crown = crownOf(clumps);
  for (const c of clumps) {
    // 低木は小さいので、葉の粒は細分しない形で十分（三角形の数を抑える）
    addClump(leaf, rnd, { ...c, blobs: Math.round(c.blobs * 1.6) }, crown, c.radius * 0.35, 0);
    addProxyBlob(proxy, c.center, c.radius * 0.9, c.squash);
  }
  return finishTemplate('shrub', clumps, leaf, null, proxy);
}

/** 地表を覆う草（平たく広がる低い茂み）。影は落とさない */
function makeGround(seed: number): PlantTemplate {
  const rnd = mulberry32(seed);
  const leaf = new Builder();
  const clumps: ClumpSpec[] = [{ center: v3(0, 0.25, 0), radius: 1, squash: 0.35, blobs: 0, topBias: 0 }];
  const crown: Crown = { center: v3(0, 0.1, 0), radius: 1.2 };
  const n = 12 + Math.floor(rnd() * 6);
  for (let i = 0; i < n; i++) {
    const a = rnd() * Math.PI * 2;
    const d = Math.sqrt(rnd()) * 0.95;
    const r = 0.2 + 0.14 * rnd();
    const c = v3(Math.cos(a) * d, r * 0.45, Math.sin(a) * d);
    addLeafBlob(leaf, rnd, c, r, v3(1, 0.55 + 0.25 * rnd(), 1), crown, randomRotation(rnd));
  }
  return finishTemplate('ground', clumps, leaf, null, null);
}

/** 崖の段差や割れ目に生える草むら（縦に伸びた細い葉の束） */
function makeTuft(seed: number): PlantTemplate {
  const rnd = mulberry32(seed);
  const leaf = new Builder();
  const proxy = new Builder();
  const clumps: ClumpSpec[] = [{ center: v3(0, 0.45, 0), radius: 0.5, squash: 1, blobs: 0, topBias: 0 }];
  const crown: Crown = { center: v3(0, 0.3, 0), radius: 0.7 };
  const n = 5 + Math.floor(rnd() * 4);
  for (let i = 0; i < n; i++) {
    const a = rnd() * Math.PI * 2;
    const d = 0.1 + 0.25 * rnd();
    const h = 0.25 + 0.3 * rnd();
    const r = 0.12 + 0.08 * rnd();
    // 外側へ少し傾いた細長い粒
    const tilt = new THREE.Quaternion().setFromEuler(new THREE.Euler(Math.sin(a) * 0.45, rnd() * 3, -Math.cos(a) * 0.45));
    addLeafBlob(leaf, rnd, v3(Math.cos(a) * d, h, Math.sin(a) * d), r, v3(0.55, 2.2, 0.55), crown, tilt);
  }
  addProxyBlob(proxy, v3(0, 0.4, 0), 0.35, 1.1);
  return finishTemplate('tuft', clumps, leaf, null, proxy);
}

/** つるの葉の小さな房（崖に沿って垂れ下がる。z 方向が崖の外向き） */
function makeVine(seed: number): PlantTemplate {
  const rnd = mulberry32(seed);
  const leaf = new Builder();
  const proxy = new Builder();
  const clumps: ClumpSpec[] = [{ center: v3(0, 0.5, 0), radius: 0.5, squash: 1, blobs: 0, topBias: 0 }];
  const crown: Crown = { center: v3(0, 0.5, -0.25), radius: 0.7 };
  const n = 2 + Math.floor(rnd() * 3);
  for (let i = 0; i < n; i++) {
    const c = v3((rnd() - 0.5) * 0.5, 0.25 + 0.5 * rnd(), 0.05 * rnd());
    addLeafBlob(leaf, rnd, c, 0.22 + 0.12 * rnd(), v3(1, 1.1, 0.6), crown, randomRotation(rnd));
  }
  addProxyBlob(proxy, v3(0, 0.5, 0), 0.3, 1.2);
  return finishTemplate('vine', clumps, leaf, null, proxy);
}

/**
 * ヤシ：細く少し曲がった幹の先に、放射状に広がって先が垂れる羽状の葉。
 * 葉は中央の葉脈で浅く折れた細長い帯で、表と裏の両方を作る（どちらから見ても描かれる）。
 */
function makePalm(seed: number): PlantTemplate {
  const rnd = mulberry32(seed);
  const leaf = new Builder();
  const wood = new Builder();
  const proxy = new Builder();
  // 幹：わずかに弓なりに傾く
  const top = v3((rnd() - 0.5) * 0.18, 0.78 + 0.06 * rnd(), (rnd() - 0.5) * 0.18);
  const bend = v3(top.x * 0.25 + (rnd() - 0.5) * 0.05, 0, top.z * 0.25 + (rnd() - 0.5) * 0.05);
  const segs = 4;
  let prev = v3(0, -0.05, 0);
  for (let i = 1; i <= segs; i++) {
    const t = i / segs;
    const p = v3(top.x * t * t + bend.x * Math.sin(Math.PI * t), top.y * t, top.z * t * t + bend.z * Math.sin(Math.PI * t));
    addTube(wood, prev, p, 0.024 * (1 - 0.35 * (t - 1 / segs)), 0.024 * (1 - 0.35 * t), 5);
    prev = p;
  }
  addTube(proxy, v3(0, -0.05, 0), top, 0.03, 0.025, 4);
  // 葉：根元から外へ伸び、弧を描いて先が垂れる
  const nLeaves = 8 + Math.floor(rnd() * 4);
  const a0 = rnd() * Math.PI * 2;
  const crown: Crown = { center: top.clone().add(v3(0, 0.02, 0)), radius: 0.42 };
  const steps = 7;
  for (let k = 0; k < nLeaves; k++) {
    const az = a0 + (k / nLeaves) * Math.PI * 2 + (rnd() - 0.5) * 0.5;
    const dir = v3(Math.cos(az), 0, Math.sin(az));
    const side = v3(-dir.z, 0, dir.x);
    const len = 0.36 + 0.14 * rnd();
    const rise = 0.35 + 0.35 * rnd();
    const droop = 0.9 + 0.5 * rnd();
    const width = 0.075 + 0.025 * rnd();
    const base = leaf.count;
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      // 弧：始めは上へ、先は下へ
      const along = len * t;
      const up = len * (rise * t - droop * t * t * 0.9);
      const c = top.clone().addScaledVector(dir, along).add(v3(0, up, 0));
      // 幅：根元は細く、中ほどで広く、先は細い
      const w = width * Math.sin(Math.PI * Math.min(1, t * 1.1)) * (1 - 0.3 * t);
      // 中央の葉脈で浅く折れた形（両側が少し下がる）
      const fold = 0.35 * w;
      const left = c.clone().addScaledVector(side, w).add(v3(0, -fold, 0));
      const right = c.clone().addScaledVector(side, -w).add(v3(0, -fold, 0));
      const shade = 0.35 + 0.65 * t;
      const n = v3(0, 1, 0);
      leaf.vertex(left, n, shade);
      leaf.vertex(c, n, Math.min(1, shade + 0.1));
      leaf.vertex(right, n, shade);
    }
    for (let i = 0; i < steps; i++) {
      const a = base + i * 3;
      const b = a + 3;
      // 表
      leaf.idx.push(a, b, a + 1, a + 1, b, b + 1, a + 1, b + 1, a + 2, a + 2, b + 1, b + 2);
    }
    // 裏（同じ頂点を逆向きの面で）。法線は表のものを共有するが、葉は薄いので陰影の違いは目立たない
    for (let i = 0; i < steps; i++) {
      const a = base + i * 3;
      const b = a + 3;
      leaf.idx.push(a, a + 1, b, a + 1, b + 1, b, a + 1, a + 2, b + 1, a + 2, b + 2, b + 1);
    }
  }
  // 法線：面の向きから求める（表の面だけで平均）
  const pos = leaf.pos;
  const nor = leaf.nor;
  for (let i = 0; i < nor.length; i++) nor[i] = 0;
  for (let f = 0; f < leaf.idx.length; f += 3) {
    // 表の面は各葉の前半に並んでいる。裏の面も同じ向きの法線を足すと打ち消すので、y が正になる向きにそろえて足す
    const ia = leaf.idx[f] * 3;
    const ib = leaf.idx[f + 1] * 3;
    const ic = leaf.idx[f + 2] * 3;
    const ux = pos[ib] - pos[ia];
    const uy = pos[ib + 1] - pos[ia + 1];
    const uz = pos[ib + 2] - pos[ia + 2];
    const vx = pos[ic] - pos[ia];
    const vy = pos[ic + 1] - pos[ia + 1];
    const vz = pos[ic + 2] - pos[ia + 2];
    let nx = uy * vz - uz * vy;
    let ny = uz * vx - ux * vz;
    let nz = ux * vy - uy * vx;
    if (ny < 0) {
      nx = -nx;
      ny = -ny;
      nz = -nz;
    }
    for (const i of [ia, ib, ic]) {
      nor[i] += nx;
      nor[i + 1] += ny;
      nor[i + 2] += nz;
    }
  }
  for (let i = 0; i < nor.length; i += 3) {
    const l = Math.hypot(nor[i], nor[i + 1], nor[i + 2]) || 1;
    nor[i] /= l;
    nor[i + 1] /= l;
    nor[i + 2] /= l;
  }
  addProxyBlob(proxy, crown.center.clone().add(v3(0, -0.04, 0)), 0.3, 0.35);
  const clumps: ClumpSpec[] = [{ center: crown.center, radius: 0.3, squash: 0.4, blobs: 0, topBias: 0 }];
  return finishTemplate('palm', clumps, leaf, wood, proxy);
}

export interface TemplateLibrary {
  trees: PlantTemplate[];
  palms: PlantTemplate[];
  shrubs: PlantTemplate[];
  ground: PlantTemplate[];
  tufts: PlantTemplate[];
  vines: PlantTemplate[];
}

/** 種類ごとに形の違うひな形をいくつか作る（同じシードなら同じ形） */
export function createTemplates(seed: number): TemplateLibrary {
  const s = (k: number) => (seed * 7349 + k * 104729) >>> 0;
  return {
    trees: [
      makeTree(s(1), 0.1),
      makeTree(s(2), 0.3),
      makeTree(s(3), 0.2),
      makeTree(s(4), 0.45),
      makeTree(s(5), 0.75),
      makeTree(s(6), 0.95),
      makeTree(s(7), 0.85),
      makeTree(s(8), 0.6),
    ],
    palms: [makePalm(s(51)), makePalm(s(52)), makePalm(s(53)), makePalm(s(54))],
    shrubs: [makeShrub(s(11)), makeShrub(s(12)), makeShrub(s(13)), makeShrub(s(14)), makeShrub(s(15))],
    ground: [makeGround(s(21)), makeGround(s(22)), makeGround(s(23))],
    tufts: [makeTuft(s(31)), makeTuft(s(32)), makeTuft(s(33))],
    vines: [makeVine(s(41)), makeVine(s(42)), makeVine(s(43))],
  };
}
