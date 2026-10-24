import * as THREE from 'three';
import type { Layout } from './layout';
import { mulberry32 } from './noise';

/**
 * 街路樹と公園の木：丸い葉のかたまりを数個寄せた、ふっくらした樹冠と細い幹。
 * 形は数種類のひな形を InstancedMesh で使い回し、葉の色は木ごとに少しずつ変える。
 * 葉のかたまりの上の方ほど明るく黄緑に、下と奥ほど暗くする（頂点色）。
 */
export interface TreeInstance {
  x: number;
  z: number;
  /** 樹冠の大きさ（半径）と高さの倍率 */
  scale: number;
  kind: number;
  rot: number;
  /** 葉の色の明るさ・黄みのばらつき 0〜1 */
  tone: number;
  /** 根元の高さ（歩道・芝生の面） */
  y: number;
}

const KINDS = 4;
/** 木の大きさの倍率 */
const SIZE = 1.3;

/** 樹冠のひな形：単位の大きさ（半径およそ 1、根元 y=0） */
function crownTemplate(seed: number) {
  const rnd = mulberry32(seed);
  const lobes: { c: THREE.Vector3; r: number }[] = [{ c: new THREE.Vector3(0, 1.05, 0), r: 0.62 }];
  const n = 4 + Math.floor(rnd() * 3);
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + rnd() * 0.6;
    const d = 0.38 + rnd() * 0.18;
    lobes.push({ c: new THREE.Vector3(Math.cos(a) * d, 0.75 + rnd() * 0.45, Math.sin(a) * d), r: 0.42 + rnd() * 0.12 });
  }
  lobes.push({ c: new THREE.Vector3((rnd() - 0.5) * 0.2, 1.45, (rnd() - 0.5) * 0.2), r: 0.38 });
  // 樹冠の中心（法線をなめらかにするのに使う）
  const center = new THREE.Vector3(0, 1.05, 0);
  const pos: number[] = [];
  const nor: number[] = [];
  const col: number[] = [];
  const idx: number[] = [];
  let off = 0;
  const p = new THREE.Vector3();
  const nl = new THREE.Vector3();
  const nc = new THREE.Vector3();
  for (const l of lobes) {
    const g = new THREE.IcosahedronGeometry(l.r, 2);
    const pa = g.attributes.position;
    for (let i = 0; i < pa.count; i++) {
      p.fromBufferAttribute(pa, i).add(l.c);
      // 葉のかたまりの丸みと、樹冠全体の丸みを混ぜた法線（ふっくらした陰影）
      nl.copy(p).sub(l.c).normalize();
      nc.copy(p).sub(center).normalize();
      const n = nl.multiplyScalar(0.68).addScaledVector(nc, 0.32).normalize();
      pos.push(p.x, p.y, p.z);
      nor.push(n.x, n.y, n.z);
      // 上向きの面ほど明るく、低い所ほど暗い。明るい所は黄みを足す
      const up = THREE.MathUtils.smoothstep(n.y, -0.6, 0.9);
      const hgt = THREE.MathUtils.smoothstep(p.y, 0.3, 1.7);
      // 葉のかたまりどうしが接する所（くぼみ）は、となりのかたまりに遮られて暗い（遮蔽を頂点色に焼き込む）
      let occ = 0;
      for (const o of lobes) {
        if (o === l) continue;
        const d = p.distanceTo(o.c) - o.r;
        occ += THREE.MathUtils.clamp(1 - d / (o.r * 0.7), 0, 1) ** 2 * 0.55;
      }
      occ = Math.min(occ, 1);
      // 参考画像の木は陰影が強い（下側と奥はかなり暗い）
      const k = (0.26 + 0.82 * (0.6 * up + 0.4 * hgt)) * (1 - 0.5 * occ);
      // 日の当たる上の方は黄緑に明るく
      const tip = THREE.MathUtils.smoothstep(up * hgt * (1 - occ), 0.25, 0.75);
      col.push(k * (1 + 0.85 * tip), k * (1 + 0.3 * tip), k * (1 - 0.75 * tip));
    }
    // IcosahedronGeometry はインデックスなし（3 頂点ずつ三角形）
    for (let i = 0; i < pa.count; i++) idx.push(off + i);
    off += pa.count;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  geo.setIndex(idx);
  return geo;
}

function trunkTemplate() {
  const g = new THREE.CylinderGeometry(0.07, 0.1, 1, 6, 1, true);
  g.translate(0, 0.5, 0);
  return g;
}

/**
 * 木の位置：layout.trees（歩道の並木と公園の木）から、建物・池・砦・橋の坂道に近い物を除いて置く。
 * avoid は、ほかに避ける所（中心 x, z と樹冠の半径 r で、置けないなら true）。y は地面の高さ（歩道・芝生）
 */
export function placeTrees(
  layout: Layout,
  opts: { groundAt: (x: number, z: number) => number; avoid?: (x: number, z: number, r: number) => boolean },
  seed = 3,
): TreeInstance[] {
  const rnd = mulberry32(seed);
  const out: TreeInstance[] = [];
  // 建物の足もと（地面に接する部品）
  const footprints = layout.buildings.flatMap((b) =>
    b.parts
      .filter((p) => (p.type === 'box' || p.type === 'antiprism' || p.type === 'taper') && p.y[0] <= 0.01)
      .map((p) => {
        const size = p.type === 'antiprism' ? [p.size, p.size] : (p as { size: [number, number] }).size;
        return { x0: p.c[0] - size[0] / 2, x1: p.c[0] + size[0] / 2, z0: p.c[1] - size[1] / 2, z1: p.c[1] + size[1] / 2 };
      }),
  );
  const ponds = layout.parks.flatMap((p) => (p.pond ? [p.pond] : []));
  const forts = layout.parks.flatMap((p) => (p.fort ? [p.fort] : []));
  const free = (x: number, z: number, r: number) => {
    // 樹冠は建物の壁に少しかかってもよい（幹は歩道の上）
    const rb = r * 0.55;
    for (const f of footprints) if (x > f.x0 - rb && x < f.x1 + rb && z > f.z0 - rb && z < f.z1 + rb) return false;
    for (const pd of ponds) if (((x - pd.c[0]) / (pd.r[0] + 0.1)) ** 2 + ((z - pd.c[1]) / (pd.r[1] + 0.1)) ** 2 < 1) return false;
    for (const ft of forts) if (Math.hypot(x - ft.c[0], z - ft.c[1]) < ft.r + r * 0.6) return false;
    for (const [lx, lz] of layout.lamps) if (Math.hypot(x - lx, z - lz) < 0.11) return false;
    if (opts.avoid?.(x, z, r)) return false;
    for (const t of out) if (Math.hypot(t.x - x, t.z - z) < (t.scale + r) * 0.62) return false;
    return true;
  };
  for (const [x, z, size] of layout.trees) {
    // 参考画像の木は街並みに比べて大きめ（おもちゃのような大きさ）
    const s = size * SIZE * (0.85 + 0.3 * rnd());
    const kind = Math.floor(rnd() * KINDS);
    const rot = rnd() * Math.PI * 2;
    const tone = rnd();
    if (!free(x, z, s)) continue;
    out.push({ x, z, y: opts.groundAt(x, z), scale: s, kind, rot, tone });
  }
  return out;
}

/**
 * 木を並べる（幹は 1 つの InstancedMesh、樹冠はひな形ごと）。
 * slotUv は木の番号から、焼き込み先（インスタンスごとの影）の位置を返す。probes はその番号順の、光を調べる点（樹冠の上の方）
 */
export function createTrees(
  trees: TreeInstance[],
  material: THREE.Material,
  trunkMaterial: THREE.Material,
  slotUv: (i: number) => [number, number],
) {
  const group = new THREE.Group();
  group.name = 'trees';
  const greens = [new THREE.Color('#5aa42c'), new THREE.Color('#70b42e'), new THREE.Color('#4c982a'), new THREE.Color('#82bc34')];
  const meshes: THREE.InstancedMesh[] = [];
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const up = new THREE.Vector3(0, 1, 0);
  const uvFor = (indices: number[]) => {
    const uv = new Float32Array(indices.length * 2);
    indices.forEach((ti, j) => {
      const [u, v] = slotUv(ti);
      uv[j * 2] = u;
      uv[j * 2 + 1] = v;
    });
    return new THREE.InstancedBufferAttribute(uv, 2);
  };
  const trunkGeo = trunkTemplate();
  trunkGeo.setAttribute('instanceBakeUv', uvFor(trees.map((_, i) => i)));
  const trunk = new THREE.InstancedMesh(trunkGeo, trunkMaterial, trees.length);
  trunk.name = 'tree-trunks';
  trees.forEach((t, i) => {
    q.setFromAxisAngle(up, t.rot);
    m.compose(new THREE.Vector3(t.x, t.y - 0.002, t.z), q, new THREE.Vector3(t.scale * 0.55, t.scale * 1.5, t.scale * 0.55));
    trunk.setMatrixAt(i, m);
  });
  trunk.computeBoundingSphere();
  meshes.push(trunk);
  for (let k = 0; k < KINDS; k++) {
    const list = trees.map((t, i) => ({ t, i })).filter((e) => e.t.kind === k);
    if (list.length === 0) continue;
    const geo = crownTemplate(101 + k * 17);
    geo.setAttribute('instanceBakeUv', uvFor(list.map((e) => e.i)));
    const mesh = new THREE.InstancedMesh(geo, material, list.length);
    mesh.name = `tree-crowns-${k}`;
    list.forEach(({ t }, j) => {
      q.setFromAxisAngle(up, t.rot);
      const s = t.scale;
      m.compose(new THREE.Vector3(t.x, t.y + s * 0.62, t.z), q, new THREE.Vector3(s, s * 1.0, s));
      mesh.setMatrixAt(j, m);
      const c = greens[Math.floor(t.tone * greens.length) % greens.length].clone();
      c.offsetHSL((t.tone - 0.5) * 0.03, 0, (t.tone - 0.5) * 0.06);
      mesh.setColorAt(j, c);
    });
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    mesh.computeBoundingSphere();
    meshes.push(mesh);
  }
  meshes.forEach((mm) => group.add(mm));
  // 光を調べる点は樹冠の上端の少し上（樹冠の中だと、自分の葉で影になってしまう）
  const probes = trees.map((t) => new THREE.Vector3(t.x, t.y + t.scale * 2.7, t.z));
  const outline = trees.map((t) => new THREE.Vector3(t.x, t.y + t.scale * 2.5, t.z));
  return { group, meshes, trunk, probes, outline };
}
