import * as THREE from 'three';
import type { SceneConfig } from '../config';
import { mulberry32 } from '../noise';
import type { BuildingShells, MassSpec } from './buildings';
import type { TownEnv } from './env';
import { insidePolygon, type P2 } from './geometry2d';
import { createPropMaterial, PropBatch, ShapeBuilder, type ProbeSet } from './propKit';

/**
 * 屋上の物：室外機（小・大）、冷却塔、給水タンク、換気の筒、アンテナ、手すり、階段室、植え込みの木、鉄塔。
 * 参考画像のように、屋上の縁に沿って室外機をぎっしり並べ、ところどころに大きな機械とアンテナを立てる
 */
interface RoofPreset {
  railing?: boolean;
  /** 室外機の密度（1 あたりの個数） */
  ac?: number;
  big?: number;
  tower?: number;
  tank?: number;
  antenna?: number;
  stack?: number;
  house?: boolean;
  tree?: number;
  /** 鉄塔（RB1 の屋上） */
  lattice?: boolean;
}

const PRESETS: Record<string, RoofPreset> = {
  LB1: { railing: true, ac: 9, big: 3, tree: 1, stack: 1, house: true },
  LB1b: { ac: 6, big: 1, railing: true },
  LB1u: { railing: true, ac: 7, big: 1, antenna: 1, stack: 2, house: true },
  LB2: { railing: true, ac: 5, big: 1, antenna: 1, tank: 1, house: true },
  LB4: { railing: true, ac: 8, big: 2, house: true },
  LB3: { railing: true, ac: 9, big: 2, tower: 1, house: true },
  RB1: { railing: true, ac: 8, big: 2, tower: 1, tree: 1, lattice: true },
  RB1blue: { railing: true, ac: 6, big: 2, house: true },
  RB2: { railing: true, ac: 7, big: 1, tree: 1, antenna: 1, house: true },
  RB3: { railing: true, ac: 7, big: 1, tank: 1, house: true },
};

const METAL = 0x1d1e21;
const AC_BODY = 0x9d9891;
const AC_DARK = 0x2b2d30;

function acSmall() {
  const s = new ShapeBuilder();
  s.box(0, 0.065, 0, 0.17, 0.13, 0.085, AC_BODY);
  // 前のファンの格子（暗い円と明るい縁）
  const ring = new THREE.CylinderGeometry(0.05, 0.05, 0.006, 16);
  ring.rotateX(Math.PI / 2);
  ring.translate(-0.028, 0.066, 0.044);
  s.add(ring, 0x9d9890);
  const fan = new THREE.CylinderGeometry(0.043, 0.043, 0.008, 16);
  fan.rotateX(Math.PI / 2);
  fan.translate(-0.028, 0.066, 0.045);
  s.add(fan, AC_DARK);
  // 右の端の配管のふた、横のがらり
  s.box(0.062, 0.05, 0.044, 0.03, 0.06, 0.006, 0x8a857e);
  for (let k = 0; k < 4; k++) s.box(0.0862, 0.03 + k * 0.025, 0, 0.003, 0.008, 0.07, 0x55575a);
  // 脚
  s.box(-0.06, 0.004, 0, 0.02, 0.008, 0.08, 0x5a5a5a);
  s.box(0.06, 0.004, 0, 0.02, 0.008, 0.08, 0x5a5a5a);
  return s.build();
}

function acBig() {
  const s = new ShapeBuilder();
  s.box(0, 0.11, 0, 0.3, 0.2, 0.22, 0x8f8b85);
  // 横のがらり（暗い横の筋）
  for (let k = 0; k < 5; k++) s.box(0, 0.04 + k * 0.032, 0.112, 0.27, 0.008, 0.004, 0x55575a);
  // 上のファン
  s.cylinder(0, 0.214, 0, 0.085, 0.01, 0x8f8b85, 18);
  s.cylinder(0, 0.22, 0, 0.07, 0.006, AC_DARK, 18);
  s.box(0, 0.006, 0, 0.32, 0.012, 0.24, 0x4b4c4f);
  return s.build();
}

function coolingTower() {
  const s = new ShapeBuilder();
  s.box(0, 0.16, 0, 0.24, 0.3, 0.24, 0x8a8681);
  for (let k = 0; k < 6; k++) s.box(0, 0.05 + k * 0.035, 0.122, 0.21, 0.01, 0.004, 0x505256);
  s.cylinder(0, 0.32, 0, 0.1, 0.03, 0x9a958e, 18);
  s.cylinder(0, 0.338, 0, 0.085, 0.006, AC_DARK, 18);
  return s.build();
}

function waterTank() {
  const s = new ShapeBuilder();
  s.cylinder(0, 0.13, 0, 0.085, 0.13, 0xbfc3c4, 16);
  s.cylinder(0, 0.2, 0, 0.088, 0.012, 0x9ea2a3, 16);
  for (const [x, z] of [
    [-0.06, -0.06],
    [0.06, -0.06],
    [-0.06, 0.06],
    [0.06, 0.06],
  ])
    s.box(x, 0.032, z, 0.012, 0.064, 0.012, METAL);
  s.box(0, 0.066, 0, 0.16, 0.008, 0.16, METAL);
  return s.build();
}

function stack() {
  const s = new ShapeBuilder();
  s.cylinder(0, 0.11, 0, 0.022, 0.22, 0x8c8a86, 10);
  s.cylinder(0, 0.235, 0, 0.034, 0.02, 0x6a6966, 10);
  return s.build();
}

function antenna(h: number) {
  const s = new ShapeBuilder();
  s.cylinder(0, h / 2, 0, 0.009, h, METAL, 6);
  s.box(0, 0.03, 0, 0.08, 0.06, 0.08, 0x3a3b3e);
  // 横の棒と、先の丸い部品
  for (const [y, w] of [
    [h * 0.62, 0.16],
    [h * 0.8, 0.12],
  ]) {
    s.box(0, y, 0, w, 0.008, 0.008, METAL);
    s.sphere(-w / 2, y, 0, 0.016, METAL, 0, 1, 1, 1, 0);
    s.sphere(w / 2, y, 0, 0.016, METAL, 0, 1, 1, 1, 0);
  }
  s.box(0, h * 0.95, 0, 0.008, 0.008, 0.1, METAL);
  return s.build();
}

function stairHouse() {
  const s = new ShapeBuilder();
  s.box(0, 0.17, 0, 0.38, 0.34, 0.32, 0x7a746f);
  s.box(0, 0.345, 0, 0.4, 0.015, 0.34, 0xa29b94);
  s.box(0.06, 0.12, 0.162, 0.12, 0.22, 0.006, 0x4a4643);
  return s.build();
}

function planterTree() {
  const s = new ShapeBuilder();
  s.box(0, 0.05, 0, 0.32, 0.1, 0.32, 0x5b524b);
  s.cylinder(0, 0.18, 0, 0.018, 0.22, 0x4a3a2c, 6);
  const leaves = [
    [0, 0.36, 0, 0.14],
    [0.09, 0.3, 0.04, 0.11],
    [-0.08, 0.31, -0.03, 0.11],
    [0.02, 0.29, -0.09, 0.1],
    [-0.03, 0.42, 0.05, 0.1],
  ];
  const rng = mulberry32(7);
  for (const [x, y, z, r] of leaves) {
    const g = 0x3d5a2a + Math.floor(rng() * 3) * 0x020300;
    s.sphere(x, y, z, r, g, 0, 1, 0.85, 1, 1);
  }
  return s.build();
}

/** 2 点を結ぶ細い棒（円柱） */
function strut(s: ShapeBuilder, a: THREE.Vector3, b: THREE.Vector3, r: number, color: number) {
  const d = new THREE.Vector3().subVectors(b, a);
  const len = d.length();
  const g = new THREE.CylinderGeometry(r, r, len, 5);
  g.translate(0, len / 2, 0);
  const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize());
  g.applyQuaternion(q);
  g.translate(a.x, a.y, a.z);
  s.add(g, color);
}

/** 鉄塔：四角い骨組みが上へ細くなる。上にアンテナと赤い灯 */
function latticeTower(h: number) {
  const s = new ShapeBuilder();
  const b0 = 0.17;
  const b1 = 0.055;
  const levels = 8;
  const corner = (k: number, y: number) => {
    const w = b0 + (b1 - b0) * (y / h);
    const sx = k === 0 || k === 3 ? -1 : 1;
    const sz = k < 2 ? -1 : 1;
    return new THREE.Vector3(sx * w, y, sz * w);
  };
  for (let k = 0; k < 4; k++) strut(s, corner(k, 0), corner(k, h), 0.011, METAL);
  for (let l = 0; l <= levels; l++) {
    const y = (l / levels) * h;
    for (let k = 0; k < 4; k++) strut(s, corner(k, y), corner((k + 1) % 4, y), 0.006, METAL);
    if (l < levels) {
      const y1 = ((l + 1) / levels) * h;
      for (let k = 0; k < 4; k++) {
        strut(s, corner(k, y), corner((k + 1) % 4, y1), 0.005, METAL);
        strut(s, corner((k + 1) % 4, y), corner(k, y1), 0.005, METAL);
      }
    }
  }
  // 途中の足場
  s.box(0, h * 0.55, 0, 0.26, 0.012, 0.26, METAL);
  // 上のアンテナ
  s.cylinder(0, h + 0.18, 0, 0.012, 0.36, METAL, 6);
  s.cylinder(0.04, h + 0.1, 0, 0.006, 0.2, METAL, 5);
  s.cylinder(-0.04, h + 0.12, 0.02, 0.006, 0.24, METAL, 5);
  s.box(0, h + 0.08, 0, 0.14, 0.008, 0.008, METAL);
  s.sphere(0, h + 0.37, 0, 0.018, 0xff3020, 1, 1, 1, 1, 1);
  s.box(0, 0.02, 0, 0.42, 0.04, 0.42, 0x3a3b3e);
  return s.build();
}

export function createRooftops(
  config: SceneConfig,
  env: TownEnv,
  probes: ProbeSet,
  shells: BuildingShells,
  masses: readonly MassSpec[],
) {
  void config;
  const group = new THREE.Group();
  group.name = 'rooftops';
  const mat = createPropMaterial(env, probes, { roughness: 0.7, metalness: 0.0, glow: 3, key: 'roof' });
  const batch = (name: string, g: THREE.BufferGeometry) => new PropBatch(name, g, mat, probes);
  const B = {
    ac: batch('roof-ac', acSmall()),
    big: batch('roof-big', acBig()),
    tower: batch('roof-tower', coolingTower()),
    tank: batch('roof-tank', waterTank()),
    stack: batch('roof-stack', stack()),
    antenna: batch('roof-antenna', antenna(0.78)),
    house: batch('roof-house', stairHouse()),
    tree: batch('roof-tree', planterTree()),
    lattice: batch('roof-lattice', latticeTower(1.55)),
  };
  // 物の高さ（構図合わせ用の上端）
  const TOPS = new Map<PropBatch, number>([
    [B.ac, 0.14],
    [B.big, 0.23],
    [B.tower, 0.35],
    [B.tank, 0.21],
    [B.stack, 0.25],
    [B.antenna, 0.8],
    [B.house, 0.36],
    [B.tree, 0.5],
    [B.lattice, 1.55 + 0.38],
  ]);
  const topPoints: THREE.Vector3[] = [];
  // 手すりは屋上ごとにつないで 1 つの形にする
  const rails = new ShapeBuilder();
  let railCount = 0;

  const tops = masses.map((m) => ({ m, top: (m.base ?? config.town.ground + config.town.curb) + m.height }));
  const m4 = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const UP = new THREE.Vector3(0, 1, 0);

  for (const roof of shells.roofs) {
    const preset = PRESETS[roof.id] ?? { ac: 3.5, big: 1, railing: false, stack: 1 };
    const rng = mulberry32(roof.id.split('').reduce((a, c) => a * 31 + c.charCodeAt(0), 7));
    const poly = roof.polygon;
    const y = roof.y;
    // 屋上の向き：最初の辺に沿った向き u と、内側 v
    const o = poly[0];
    const ux = poly[1][0] - o[0];
    const uz = poly[1][1] - o[1];
    const ul = Math.hypot(ux, uz);
    const u: P2 = [ux / ul, uz / ul];
    const cx = poly.reduce((s, p) => s + p[0], 0) / poly.length;
    const cz = poly.reduce((s, p) => s + p[1], 0) / poly.length;
    let v: P2 = [-u[1], u[0]];
    if (v[0] * (cx - o[0]) + v[1] * (cz - o[1]) < 0) v = [u[1], -u[0]];
    const yaw = Math.atan2(-u[1], u[0]);
    // 置ける所：屋上の内側（縁から離す）で、より高い別の塊に隠れない
    const covered = (x: number, z: number) =>
      tops.some(({ m, top }) => m.id !== roof.id && top > y + 0.05 && insidePolygon(x, z, m.corners));
    const inner = (x: number, z: number, margin: number) => {
      if (!insidePolygon(x, z, poly)) return false;
      for (let i = 0; i < poly.length; i++) {
        const a = poly[i];
        const b = poly[(i + 1) % poly.length];
        const dx = b[0] - a[0];
        const dz = b[1] - a[1];
        const l = Math.hypot(dx, dz) || 1;
        const d = Math.abs((x - a[0]) * dz - (z - a[1]) * dx) / l;
        if (d < margin) return false;
      }
      return true;
    };
    const taken: { x: number; z: number; r: number }[] = [];
    const free = (x: number, z: number, r: number) => taken.every((t) => Math.hypot(t.x - x, t.z - z) > t.r + r);
    const place = (b: PropBatch, x: number, z: number, r: number, rot: number, scale = 1, probeH = 0.15) => {
      q.setFromAxisAngle(UP, yaw + rot);
      m4.compose(new THREE.Vector3(x, y, z), q, new THREE.Vector3(scale, scale, scale));
      const shade = 0.9 + rng() * 0.18;
      const top = TOPS.get(b) ?? 0.3;
      // 焼き込みの点は物の上端のすぐ上（中に入ると自分の影で真っ黒になる）
      void probeH;
      b.add(m4, new THREE.Color(shade, shade, shade * (0.97 + rng() * 0.05)), new THREE.Vector3(x, y + Math.min(top * scale, 0.45) + 0.04, z));
      taken.push({ x, z, r });
      topPoints.push(new THREE.Vector3(x, y + top * scale, z));
    };
    // 屋上の広さ
    let area = 0;
    for (let i = 0; i < poly.length; i++) {
      const a = poly[i];
      const b = poly[(i + 1) % poly.length];
      area += a[0] * b[1] - b[0] * a[1];
    }
    area = Math.abs(area) / 2;
    const tryPlace = (b: PropBatch, r: number, margin: number, edgePref: number, rotFn: () => number, scale = 1, probeH = 0.15) => {
      for (let attempt = 0; attempt < 40; attempt++) {
        // 縁に寄せた候補：多角形の辺の近くの点
        let x: number;
        let z: number;
        if (rng() < edgePref) {
          const i = Math.floor(rng() * poly.length);
          const a = poly[i];
          const bb = poly[(i + 1) % poly.length];
          const t = rng();
          const px = a[0] + (bb[0] - a[0]) * t;
          const pz = a[1] + (bb[1] - a[1]) * t;
          const k = margin + r + 0.01;
          // 辺から内側へ k
          const dx = bb[0] - a[0];
          const dz = bb[1] - a[1];
          const l = Math.hypot(dx, dz) || 1;
          let nx = -dz / l;
          let nz = dx / l;
          if (nx * (cx - px) + nz * (cz - pz) < 0) {
            nx = -nx;
            nz = -nz;
          }
          x = px + nx * k;
          z = pz + nz * k;
        } else {
          const su = (rng() - 0.5) * 2.2;
          const sv = rng() * 1.6;
          x = cx + u[0] * su * 0.5 + v[0] * (sv - 0.8) * 0.5;
          z = cz + u[1] * su * 0.5 + v[1] * (sv - 0.8) * 0.5;
        }
        if (!inner(x, z, margin + r * 0.7)) continue;
        if (covered(x, z)) continue;
        if (!free(x, z, r)) continue;
        place(b, x, z, r, rotFn(), scale, probeH);
        return true;
      }
      return false;
    };
    const quarter = () => Math.floor(rng() * 4) * (Math.PI / 2);
    if (preset.lattice) {
      // 鉄塔は屋上の奥の左寄り
      const x = cx + u[0] * -0.25 + v[0] * 0.15;
      const z = cz + u[1] * -0.25 + v[1] * 0.15;
      place(B.lattice, x, z, 0.26, 0, 1, 0.3);
    }
    if (preset.house) tryPlace(B.house, 0.24, 0.08, 0.3, quarter, 1, 0.36);
    for (let i = 0; i < (preset.tree ?? 0); i++) tryPlace(B.tree, 0.2, 0.06, 0.9, quarter, 0.9 + rng() * 0.3, 0.3);
    for (let i = 0; i < (preset.tower ?? 0); i++) tryPlace(B.tower, 0.18, 0.08, 0.4, quarter, 1, 0.34);
    for (let i = 0; i < (preset.big ?? 0) + 1; i++) {
      const before = taken.length;
      tryPlace(B.big, 0.22, 0.06, 0.5, quarter, 1.0 + rng() * 0.3, 0.22);
      // 大きな機械の上に、小さな室外機を積む（半分ほど）
      if (taken.length > before && rng() < 0.55) {
        const t = taken[taken.length - 1];
        q.setFromAxisAngle(UP, yaw + quarter());
        m4.compose(new THREE.Vector3(t.x, y + 0.24, t.z), q, new THREE.Vector3(1.05, 1.05, 1.05));
        B.ac.add(m4, new THREE.Color(0.95, 0.95, 0.93), new THREE.Vector3(t.x, y + 0.45, t.z));
        topPoints.push(new THREE.Vector3(t.x, y + 0.39, t.z));
      }
    }
    for (let i = 0; i < (preset.tank ?? 0); i++) tryPlace(B.tank, 0.11, 0.08, 0.3, () => rng() * 6.3, 1, 0.2);
    for (let i = 0; i < (preset.antenna ?? 0); i++) tryPlace(B.antenna, 0.1, 0.1, 0.6, () => rng() * 6.3, 0.85 + rng() * 0.4, 0.1);
    for (let i = 0; i < (preset.stack ?? 0); i++) tryPlace(B.stack, 0.04, 0.06, 0.5, () => 0, 0.8 + rng() * 0.5, 0.2);
    const nAc = Math.round(area * (preset.ac ?? 3) * 1.3);
    for (let i = 0; i < nAc; i++) tryPlace(B.ac, 0.12, 0.035, 0.75, quarter, 1.0 + rng() * 0.45, 0.12);
    // 手すり：屋上の縁に沿って（隠れない所だけ）
    if (preset.railing) {
      const ry = y + 0.05;
      const hgt = 0.11;
      for (let i = 0; i < poly.length; i++) {
        const a = poly[i];
        const b = poly[(i + 1) % poly.length];
        const dx = b[0] - a[0];
        const dz = b[1] - a[1];
        const l = Math.hypot(dx, dz);
        if (l < 0.1) continue;
        let nx = -dz / l;
        let nz = dx / l;
        if (nx * (cx - a[0]) + nz * (cz - a[1]) < 0) {
          nx = -nx;
          nz = -nz;
        }
        const inset = 0.03;
        const n = Math.max(1, Math.round(l / 0.15));
        let runStart = -1;
        const flush = (k0: number, k1: number) => {
          if (k1 <= k0) return;
          const p0 = [a[0] + (dx * k0) / n + nx * inset, a[1] + (dz * k0) / n + nz * inset];
          const p1 = [a[0] + (dx * k1) / n + nx * inset, a[1] + (dz * k1) / n + nz * inset];
          for (const hh of [hgt, hgt * 0.5]) {
            strutTo(rails, new THREE.Vector3(p0[0], ry + hh, p0[1]), new THREE.Vector3(p1[0], ry + hh, p1[1]), 0.006);
          }
          railCount++;
        };
        for (let k = 0; k <= n; k++) {
          const px = a[0] + (dx * k) / n + nx * inset;
          const pz = a[1] + (dz * k) / n + nz * inset;
          const ok = !covered(px, pz);
          if (ok) {
            rails.box(px, ry + hgt / 2, pz, 0.012, hgt, 0.012, METAL);
            if (runStart < 0) runStart = k;
          } else if (runStart >= 0) {
            flush(runStart, k - 1);
            runStart = -1;
          }
        }
        if (runStart >= 0) flush(runStart, n);
      }
    }
  }

  const meshes: THREE.Mesh[] = [];
  const counts: Record<string, number> = {};
  for (const [k, b] of Object.entries(B)) {
    const mesh = b.build();
    counts[k] = b.count;
    if (mesh) {
      group.add(mesh);
      meshes.push(mesh);
    }
  }
  if (railCount) {
    const g = rails.build();
    // 手すりは細いので、遮るもののない高い所の点で代える
    g.setAttribute('aProbe', new THREE.Float32BufferAttribute(new Float32Array(g.getAttribute('position').count).fill(probes.add(new THREE.Vector3(0, 30, 0))), 1));
    const railMesh = new THREE.Mesh(g, mat);
    railMesh.name = 'roof-rails';
    group.add(railMesh);
  }
  counts.railRuns = railCount;
  return { group, casters: meshes, counts, topPoints };
}

/** 2 点を結ぶ細い角棒（手すり） */
function strutTo(s: ShapeBuilder, a: THREE.Vector3, b: THREE.Vector3, r: number) {
  const d = new THREE.Vector3().subVectors(b, a);
  const len = d.length();
  if (len < 1e-4) return;
  const g = new THREE.BoxGeometry(r * 2, len, r * 2);
  g.translate(0, len / 2, 0);
  g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize()));
  g.translate(a.x, a.y, a.z);
  s.add(g, METAL);
}
