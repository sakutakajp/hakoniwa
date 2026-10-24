import * as THREE from 'three';
import type { SceneConfig } from '../config';
import { mulberry32 } from '../noise';
import { faceFrame, type MassSpec } from './buildings';
import type { TownEnv } from './env';
import type { LightSource } from './localLight';
import type { Streets } from './streets';
import { createPropMaterial, PropBatch, ShapeBuilder, type ProbeSet } from './propKit';
import { foliageCards, leafTexture } from './foliage';
import {
  AWNINGS,
  BIKES,
  bollardPoints,
  FENCES,
  GOODS,
  KIOSK,
  LAMPS,
  PLANTERS,
  POLES,
  SMALL_LIGHTS,
  TREES,
  UTILITY_BOXES,
  VENDING,
  WIRES,
} from './streetData';

/**
 * 通りの物：日よけ、店先の商品の棚、街灯、街路樹、電柱と電線、車止め、柵、自転車、配電箱、自動販売機、売店、植え込み。
 * あわせて、店先と街灯の明かりを「街の明かりの地図」の光源として返す
 */
const BLACK = 0x1b1c1f;
const WARM = new THREE.Color('#ffaa55');

function rotY(x: number, y: number, z: number, angle: number, scale = 1) {
  return new THREE.Matrix4().compose(
    new THREE.Vector3(x, y, z),
    new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), angle),
    new THREE.Vector3(scale, scale, scale),
  );
}

// ---------------------------------------------------------------- 形
function lampShape() {
  const s = new ShapeBuilder();
  s.cylinder(0, 0.04, 0, 0.038, 0.08, BLACK, 10);
  s.cylinder(0, 0.75, 0, 0.016, 1.4, BLACK, 8, 0, 0.012);
  s.cylinder(0, 1.46, 0, 0.026, 0.03, BLACK, 8);
  // ランタン：光るガラスと、上の笠と飾り
  s.cylinder(0, 1.535, 0, 0.062, 0.14, 0xffd49a, 12, 1.4, 0.072);
  s.cylinder(0, 1.62, 0, 0.088, 0.04, BLACK, 10, 0, 0.022);
  s.sphere(0, 1.64, 0, 0.014, BLACK, 0, 1, 1, 1, 0);
  for (const a of [0, Math.PI / 2, Math.PI, (3 * Math.PI) / 2]) s.box(Math.cos(a) * 0.066, 1.535, Math.sin(a) * 0.066, 0.009, 0.14, 0.009, BLACK);
  return s.build();
}

/** 街路樹：幹と枝（ふつうの小物）と、葉の板の樹冠（葉のマテリアル） */
function buildTree(seed: number, h: number) {
  const rng = mulberry32(seed);
  const s = new ShapeBuilder();
  const trunkH = h * 0.52;
  s.cylinder(0, trunkH / 2, 0, 0.032, trunkH, 0x4a3d31, 7, 0, 0.022);
  for (let i = 0; i < 4; i++) {
    const a = rng() * Math.PI * 2;
    const g = new THREE.CylinderGeometry(0.007, 0.013, h * 0.3, 5);
    g.translate(0, h * 0.15, 0);
    g.rotateZ(0.5 + rng() * 0.4);
    g.rotateY(a);
    g.translate(0, trunkH * (0.85 + rng() * 0.2), 0);
    s.add(g, 0x4a3d31);
  }
  const crown = foliageCards(new THREE.Vector3(0, h * 0.7, 0), new THREE.Vector3(h * 0.17, h * 0.25, h * 0.17), 460, h * 0.09, seed * 3 + 1);
  return { trunk: s.build(), crown };
}

function poleShape(h: number) {
  const s = new ShapeBuilder();
  s.cylinder(0, h / 2, 0, 0.042, h, 0x8e8c88, 10, 0, 0.03);
  // 腕木と碍子
  for (const [y, w] of [
    [h - 0.08, 0.56],
    [h - 0.3, 0.46],
  ]) {
    s.box(0, y, 0, w, 0.03, 0.03, 0x6d6b67);
    for (const x of [-w / 2 + 0.03, -0.08, 0.08, w / 2 - 0.03]) s.cylinder(x, y + 0.03, 0, 0.012, 0.035, 0xe8e4dc, 6);
  }
  // 変圧器と足場の釘
  s.cylinder(0.075, h * 0.72, 0, 0.065, 0.2, 0x7d807f, 10);
  s.cylinder(0.075, h * 0.72 + 0.11, 0, 0.068, 0.02, 0x5f6261, 10);
  for (let y = 0.9; y < h - 0.5; y += 0.17) s.box(0, y, 0, 0.12, 0.008, 0.008, 0x55534f, 0, (y * 7) % Math.PI);
  // 黄色と黒の巻き付け（足もと）
  s.cylinder(0, 0.25, 0, 0.044, 0.22, 0xe0b52a, 10);
  return s.build();
}

function bollardShape() {
  const s = new ShapeBuilder();
  s.cylinder(0, 0.1, 0, 0.022, 0.2, BLACK, 10);
  s.sphere(0, 0.205, 0, 0.026, BLACK, 0, 1, 0.8, 1, 1);
  s.cylinder(0, 0.15, 0, 0.0235, 0.018, 0xc8c2b8, 10);
  return s.build();
}

function bikeShape() {
  const s = new ShapeBuilder();
  const wheel = new THREE.TorusGeometry(0.065, 0.007, 5, 18);
  for (const x of [-0.105, 0.105]) {
    const w = wheel.clone();
    w.translate(x, 0.072, 0);
    s.add(w, BLACK);
  }
  const tube = (x0: number, y0: number, x1: number, y1: number, r = 0.0055) => {
    const len = Math.hypot(x1 - x0, y1 - y0);
    const g = new THREE.CylinderGeometry(r, r, len, 5);
    g.rotateZ(-Math.atan2(x1 - x0, y1 - y0));
    g.translate((x0 + x1) / 2, (y0 + y1) / 2, 0);
    s.add(g, 0x9aa3ad);
  };
  tube(-0.105, 0.072, -0.02, 0.15);
  tube(-0.02, 0.15, 0.07, 0.15);
  tube(0.07, 0.15, 0.105, 0.072);
  tube(-0.02, 0.15, 0.0, 0.072);
  tube(0.0, 0.072, -0.105, 0.072);
  tube(0.07, 0.15, 0.08, 0.19);
  s.box(0.08, 0.19, 0, 0.012, 0.01, 0.1, BLACK);
  s.box(-0.03, 0.172, 0, 0.05, 0.012, 0.025, BLACK);
  s.box(0.12, 0.14, 0, 0.04, 0.03, 0.05, 0x3a3d40);
  return s.build();
}

function utilityBoxShape() {
  const s = new ShapeBuilder();
  s.box(0, 0.2, 0, 0.22, 0.38, 0.17, 0x557560);
  s.box(0, 0.395, 0, 0.24, 0.016, 0.19, 0x6c8a74);
  s.box(0, 0.2, 0.0865, 0.003, 0.32, 0.002, 0x3c5242);
  s.box(0, 0.012, 0, 0.24, 0.024, 0.19, 0x8a8782);
  return s.build();
}

function vendingShape() {
  const s = new ShapeBuilder();
  s.box(0, 0.19, 0, 0.21, 0.38, 0.16, 0xffffff);
  // 前の明るい見本の窓と、取り出し口
  s.box(0, 0.27, 0.081, 0.17, 0.16, 0.004, 0xfff4dc, 1);
  for (let r = 0; r < 3; r++) for (let c = 0; c < 6; c++) {
    const col = new THREE.Color().setHSL((c * 0.17 + r * 0.31) % 1, 0.7, 0.5);
    s.box(-0.07 + c * 0.028, 0.215 + r * 0.05, 0.084, 0.016, 0.03, 0.004, col, 0.6);
  }
  s.box(0, 0.08, 0.081, 0.14, 0.05, 0.004, 0x1a1a1c);
  return s.build();
}

function goodsShape(seed: number) {
  const rng = mulberry32(seed);
  const s = new ShapeBuilder();
  const W = 0.26;
  const H = 0.36;
  const D = 0.14;
  const white = 0xf3f1ec;
  // 白い棚の箱（側板・天板・底板・背板）と、段ごとの照明（光る細い帯）
  for (const x of [-W / 2, W / 2]) s.box(x, H / 2, 0, 0.012, H, D, white);
  s.box(0, H, 0, W + 0.012, 0.014, D, white);
  s.box(0, 0.015, 0, W, 0.03, D, white);
  s.box(0, H / 2, -D / 2 + 0.004, W, H, 0.008, 0xe9e6e0);
  const rows = 3;
  const rowH = (H - 0.04) / rows;
  const palette = ['#2f6fd8', '#e0453c', '#f2c43a', '#ffffff', '#ffffff', '#3ab0e6', '#e874a8', '#58b66a', '#ff8a3a'];
  for (let r = 0; r < rows; r++) {
    const y0 = 0.03 + r * rowH;
    if (r > 0) s.box(0, y0, 0, W - 0.01, 0.008, D - 0.01, white);
    s.box(0, y0 + rowH - 0.012, 0.0, W - 0.03, 0.006, D * 0.6, 0xfff6e2, 0.3);
    let x = -W / 2 + 0.012;
    while (x < W / 2 - 0.03) {
      const w = 0.03 + rng() * 0.035;
      if (x + w > W / 2 - 0.008) break;
      const hh = rowH * (0.45 + rng() * 0.4);
      const col = palette[Math.floor(rng() * palette.length)];
      s.box(x + w / 2, y0 + 0.004 + hh / 2, 0.01, w * 0.92, hh, D * 0.6, col, 0.05);
      x += w + 0.006;
    }
  }
  // 上に積んだ箱と、色の帯の札
  s.box(0, H + 0.02, D / 2 - 0.004, W * 0.9, 0.028, 0.006, palette[Math.floor(rng() * 3)], 0.2);
  for (let i = 0; i < 2; i++) {
    if (rng() < 0.5) continue;
    const col = palette[Math.floor(rng() * palette.length)];
    s.box(-0.06 + i * 0.12, H + 0.05, -0.01, 0.1, 0.06, 0.09, col, 0.05);
  }
  return s.build();
}

function kioskShape() {
  const s = new ShapeBuilder();
  s.box(0, 0.24, 0, 0.56, 0.48, 0.42, 0x8a6d52);
  s.box(0, 0.3, 0.212, 0.5, 0.32, 0.004, 0xffd8a8, 0.35);
  // 売り台の商品
  const rng = mulberry32(5);
  for (let i = 0; i < 9; i++) {
    const col = new THREE.Color().setHSL(rng(), 0.7, 0.55);
    s.box(-0.22 + i * 0.055, 0.18, 0.24, 0.045, 0.08, 0.05, col, 0.5);
  }
  // 屋根（青）
  const roof = new THREE.BoxGeometry(0.66, 0.03, 0.56);
  roof.rotateX(-0.18);
  roof.translate(0, 0.52, 0.05);
  s.add(roof, 0x2a5aa8);
  return s.build();
}

function smallLightShape() {
  const s = new ShapeBuilder();
  s.box(0, 0.05, 0, 0.09, 0.1, 0.09, BLACK);
  s.box(0, 0.1, 0, 0.075, 0.08, 0.075, 0xffe2b0, 1);
  s.box(0, 0.15, 0, 0.1, 0.02, 0.1, BLACK);
  return s.build();
}

function planterShape() {
  const s = new ShapeBuilder();
  s.box(0, 0.06, 0, 0.5, 0.12, 0.22, 0x5b524b);
  s.box(0, 0.115, 0, 0.46, 0.012, 0.18, 0x3a3028);
  return { box: s.build(), leaves: foliageCards(new THREE.Vector3(0, 0.2, 0), new THREE.Vector3(0.24, 0.1, 0.12), 40, 0.12, 11) };
}

// ---------------------------------------------------------------- 日よけ
function buildAwnings(config: SceneConfig, masses: readonly MassSpec[], probes: ProbeSet) {
  const walk = config.town.ground + config.town.curb;
  const byId = new Map(masses.map((m) => [m.id, m]));
  const pos: number[] = [];
  const nor: number[] = [];
  const col: number[] = [];
  const prb: number[] = [];
  const quad = (p: THREE.Vector3[], n: THREE.Vector3, c: THREE.Color, glow: number, probe: number) => {
    const tri = [0, 1, 2, 0, 2, 3];
    // 表が法線の側を向くように
    const e1 = new THREE.Vector3().subVectors(p[1], p[0]);
    const e2 = new THREE.Vector3().subVectors(p[2], p[0]);
    const order = e1.cross(e2).dot(n) < 0 ? [0, 2, 1, 0, 3, 2] : tri;
    for (const k of order) {
      pos.push(p[k].x, p[k].y, p[k].z);
      nor.push(n.x, n.y, n.z);
      col.push(c.r, c.g, c.b, glow);
      prb.push(probe);
    }
  };
  for (const a of AWNINGS) {
    const m = byId.get(a.mass);
    if (!m) continue;
    const f = faceFrame(m, a.face, walk);
    const T = new THREE.Vector3(f.t[0], 0, f.t[1]);
    const N = new THREE.Vector3(f.n[0], 0, f.n[1]);
    const yTop = f.base + a.y;
    const at = (u: number, out: number, y: number) =>
      new THREE.Vector3(f.a[0] + f.t[0] * u + f.n[0] * out, y, f.a[1] + f.t[1] * u + f.n[1] * out);
    const slope = new THREE.Vector3().copy(N).multiplyScalar(a.depth).add(new THREE.Vector3(0, -a.drop, 0)).normalize();
    const nTop = new THREE.Vector3().crossVectors(slope, T);
    if (nTop.y < 0) nTop.negate();
    const nUnder = nTop.clone().negate();
    const mid = at((a.u0 + a.u1) / 2, a.depth * 0.5, yTop + 0.05);
    const probe = probes.add(mid);
    const stripe = a.stripe ?? a.u1 - a.u0;
    const colors = a.colors.map((c) => new THREE.Color(c));
    let u = a.u0;
    let k = 0;
    while (u < a.u1 - 1e-4) {
      const u2 = Math.min(a.u1, u + stripe);
      const c = colors[k % colors.length];
      // 上の傾いた面と、下の面（店の明かりで明るい）
      quad([at(u, 0.005, yTop), at(u2, 0.005, yTop), at(u2, a.depth, yTop - a.drop), at(u, a.depth, yTop - a.drop)], nTop, c, 0, probe);
      quad([at(u, 0.005, yTop - 0.004), at(u, a.depth, yTop - a.drop - 0.004), at(u2, a.depth, yTop - a.drop - 0.004), at(u2, 0.005, yTop - 0.004)], nUnder, c.clone().multiplyScalar(0.8), 0.22, probe);
      // 前の垂れ幕
      const yb = yTop - a.drop - a.valance;
      quad([at(u, a.depth, yTop - a.drop), at(u2, a.depth, yTop - a.drop), at(u2, a.depth, yb), at(u, a.depth, yb)], N, c, 0.05, probe);
      quad([at(u, a.depth - 0.003, yb), at(u2, a.depth - 0.003, yb), at(u2, a.depth - 0.003, yTop - a.drop), at(u, a.depth - 0.003, yTop - a.drop)], N.clone().negate(), c.clone().multiplyScalar(0.7), 0.2, probe);
      u = u2;
      k++;
    }
    // 両端の三角の布
    for (const [uu, sgn] of [
      [a.u0, -1],
      [a.u1, 1],
    ] as [number, number][]) {
      const nS = T.clone().multiplyScalar(sgn);
      const c = colors[0];
      const p0 = at(uu, 0.005, yTop);
      const p1 = at(uu, a.depth, yTop - a.drop);
      const p2 = at(uu, a.depth, yTop - a.drop - a.valance);
      quad([p0, p1, p2, p2], nS, c.clone().multiplyScalar(0.85), 0.05, probe);
      quad([p0, p2, p1, p1], nS.clone().negate(), c.clone().multiplyScalar(0.7), 0.15, probe);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 4));
  g.setAttribute('aProbe', new THREE.Float32BufferAttribute(prb, 1));
  g.computeBoundingSphere();
  return g;
}

// ---------------------------------------------------------------- 電線
function catenary(a: THREE.Vector3, b: THREE.Vector3, sag: number, segs = 14) {
  const pts: THREE.Vector3[] = [];
  for (let i = 0; i <= segs; i++) {
    const t = i / segs;
    pts.push(new THREE.Vector3().lerpVectors(a, b, t).add(new THREE.Vector3(0, -sag * 4 * t * (1 - t), 0)));
  }
  return pts;
}

export function createStreet(
  config: SceneConfig,
  env: TownEnv,
  probes: ProbeSet,
  masses: readonly MassSpec[],
  streets: Streets,
  opts: { lowPower: boolean },
) {
  void opts;
  const walk = config.town.ground + config.town.curb;
  const group = new THREE.Group();
  group.name = 'street';
  const lights: LightSource[] = [];
  const casters: THREE.Mesh[] = [];
  const counts: Record<string, number> = {};
  const mat = createPropMaterial(env, probes, { roughness: 0.55, metalness: 0.1, glow: 3.2, key: 'street' });
  const foliageMat = createPropMaterial(env, probes, { roughness: 0.85, side: THREE.DoubleSide, keepNormal: true, key: 'foliage', local: 1.3 });
  foliageMat.map = leafTexture();
  foliageMat.alphaTest = 0.42;
  foliageMat.alphaToCoverage = !opts.lowPower;
  const byId = new Map(masses.map((m) => [m.id, m]));
  const batches: PropBatch[] = [];
  const batch = (name: string, g: THREE.BufferGeometry, m: THREE.Material = mat) => {
    const b = new PropBatch(name, g, m, probes);
    batches.push(b);
    return b;
  };

  // --- 日よけ
  {
    const g = buildAwnings(config, masses, probes);
    const mesh = new THREE.Mesh(g, createPropMaterial(env, probes, { roughness: 0.75, glow: 1.2, side: THREE.FrontSide, key: 'awning', local: 0.7 }));
    mesh.name = 'awnings';
    group.add(mesh);
    casters.push(mesh);
    counts.awnings = AWNINGS.length;
  }

  // --- 店先の商品の棚と、店先の明かり
  {
    const goodsMat = createPropMaterial(env, probes, { roughness: 0.5, glow: 3.2, key: 'goods', local: 0.55 });
    const variants = [0, 1, 2, 3].map((k) => batch(`goods-${k}`, goodsShape(100 + k), goodsMat));
    const rng = mulberry32(42);
    for (const gs of GOODS) {
      const m = byId.get(gs.mass);
      if (!m) continue;
      const f = faceFrame(m, gs.face, walk);
      const yaw = Math.atan2(f.n[0], f.n[1]);
      for (let i = 0; i < gs.count; i++) {
        const u = gs.u0 + ((i + 0.5) / gs.count) * (gs.u1 - gs.u0) + (rng() - 0.5) * 0.05;
        const off = gs.off + (rng() - 0.5) * 0.04;
        const x = f.a[0] + f.t[0] * u + f.n[0] * off;
        const z = f.a[1] + f.t[1] * u + f.n[1] * off;
        const b = variants[Math.floor(rng() * variants.length)];
        b.add(rotY(x, f.base, z, yaw + (rng() - 0.5) * 0.15, 0.95 + rng() * 0.15), 0xffffff, new THREE.Vector3(x, f.base + 0.55, z));
      }
      // 店先の明かり：間口に沿った線の光で、店の前の歩道を暖かく照らす（車道の手前で弱まる）
      lights.push({
        x: f.a[0] + f.t[0] * (gs.u0 - 0.05) + f.n[0] * 0.03,
        z: f.a[1] + f.t[1] * (gs.u0 - 0.05) + f.n[1] * 0.03,
        x2: f.a[0] + f.t[0] * (gs.u1 + 0.05) + f.n[0] * 0.03,
        z2: f.a[1] + f.t[1] * (gs.u1 + 0.05) + f.n[1] * 0.03,
        radius: 1.1,
        color: WARM,
        intensity: 2.2,
        facing: f.n,
        back: 0.0,
      });
    }
  }

  // --- 街灯
  {
    const b = batch('lamps', lampShape());
    for (const [x, z] of LAMPS) {
      b.add(rotY(x, walk, z, 0), 0xffffff, new THREE.Vector3(x, walk + 1.72, z));
      lights.push({ x, z, radius: 1.35, color: new THREE.Color('#ffbd6e'), intensity: 2.4 });
    }
    counts.lamps = LAMPS.length;
  }

  // --- 街路樹
  {
    const shapes = [0, 1, 2].map((k) => buildTree(300 + k * 17, 2.1));
    const trunks = shapes.map((t, k) => batch(`tree-trunks-${k}`, t.trunk));
    const crowns = shapes.map((t, k) => batch(`tree-crowns-${k}`, t.crown, foliageMat));
    const rng = mulberry32(9);
    for (const [x, z, h] of TREES) {
      const k = Math.floor(rng() * shapes.length);
      const sc = h / 2.1;
      const m = rotY(x, walk, z, rng() * 6.28, sc);
      const tone = 0.9 + rng() * 0.2;
      trunks[k].add(m, 0xffffff, new THREE.Vector3(x, walk + h + 0.05, z));
      crowns[k].add(m, new THREE.Color(tone, tone, tone * 0.95), new THREE.Vector3(x, walk + h + 0.05, z));
    }
    counts.trees = TREES.length;
  }

  // --- 植え込みと足もとの灯り（左手前の角。車道の上）
  {
    const ps = planterShape();
    const pb = batch('planters', ps.box);
    const pl = batch('planter-leaves', ps.leaves, foliageMat);
    for (const [x, z, a] of PLANTERS) {
      const y = streets.heightAt(x, z);
      pb.add(rotY(x, y, z, a), 0xffffff, new THREE.Vector3(x, y + 0.2, z));
      pl.add(rotY(x, y, z, a), 0xffffff, new THREE.Vector3(x, y + 0.25, z));
    }
    const sl = batch('small-lights', smallLightShape());
    for (const [x, z] of SMALL_LIGHTS) {
      const y = streets.heightAt(x, z);
      sl.add(rotY(x, y, z, 0.6), 0xffffff, new THREE.Vector3(x, y + 0.2, z));
      lights.push({ x, z, radius: 0.55, color: WARM, intensity: 1.2 });
    }
  }

  // --- 電柱と電線
  {
    const poleTops: THREE.Vector3[][] = [];
    for (const [x, z, h] of POLES) {
      const g = poleShape(h);
      const b = batch(`pole-${x.toFixed(1)}`, g);
      // 腕木は左の通りの向きにそろえる
      const yaw = -(config.town.curbRight.dir * Math.PI) / 180;
      b.add(rotY(x, walk, z, yaw), 0xffffff, new THREE.Vector3(x, walk + h + 0.1, z));
      const ends: THREE.Vector3[] = [];
      for (const [dy, w] of [
        [h - 0.06, 0.56],
        [h - 0.28, 0.46],
      ]) {
        for (const sx of [-1, 1]) {
          const lx = (sx * w) / 2 - sx * 0.03;
          ends.push(new THREE.Vector3(x + Math.cos(yaw) * lx, walk + dy + 0.045, z - Math.sin(yaw) * lx));
        }
      }
      poleTops.push(ends);
    }
    const wire = new ShapeBuilder();
    for (const w of WIRES) {
      const from = poleTops[w.from];
      const toPts = typeof w.to === 'number' ? poleTops[w.to] : null;
      const count = toPts ? 3 : 2;
      for (let k = 0; k < count; k++) {
        const a = from[k % from.length];
        let b: THREE.Vector3;
        if (toPts) b = toPts[k % toPts.length];
        else {
          const [tx, ty, tz] = w.to as [number, number, number];
          b = new THREE.Vector3(tx, ty + walk - config.town.ground - k * 0.08, tz);
        }
        const curve = new THREE.CatmullRomCurve3(catenary(a, b, w.sag + k * 0.02));
        wire.add(new THREE.TubeGeometry(curve, 16, 0.0045, 3, false), 0x161618);
      }
    }
    const wg = wire.build();
    wg.setAttribute('aProbe', new THREE.Float32BufferAttribute(new Float32Array(wg.getAttribute('position').count).fill(probes.add(new THREE.Vector3(0, 30, 0))), 1));
    const wm = new THREE.Mesh(wg, mat);
    wm.name = 'wires';
    group.add(wm);
    counts.poles = POLES.length;
  }

  // --- 車止め
  {
    const b = batch('bollards', bollardShape());
    const pts = bollardPoints();
    for (const [x, z] of pts) {
      const y = walk;
      b.add(rotY(x, y, z, 0), 0xffffff, new THREE.Vector3(x, y + 0.25, z));
    }
    counts.bollards = pts.length;
  }

  // --- 低い柵
  {
    const s = new ShapeBuilder();
    for (const [a, b] of FENCES) {
      const dx = b[0] - a[0];
      const dz = b[1] - a[1];
      const l = Math.hypot(dx, dz);
      const n = Math.max(1, Math.round(l / 0.28));
      const yaw = Math.atan2(-dz, dx);
      for (let k = 0; k <= n; k++) {
        const t = k / n;
        s.box(a[0] + dx * t, walk + 0.09, a[1] + dz * t, 0.014, 0.18, 0.014, BLACK);
      }
      for (const hh of [0.17, 0.08]) s.box((a[0] + b[0]) / 2, walk + hh, (a[1] + b[1]) / 2, l, 0.012, 0.01, BLACK, 0, yaw);
    }
    const g = s.build();
    g.setAttribute('aProbe', new THREE.Float32BufferAttribute(new Float32Array(g.getAttribute('position').count).fill(probes.add(new THREE.Vector3(-2, walk + 0.4, 1.2))), 1));
    const mesh = new THREE.Mesh(g, mat);
    mesh.name = 'fences';
    group.add(mesh);
  }

  // --- 自転車・配電箱・自動販売機・売店
  {
    const b = batch('bikes', bikeShape());
    for (const [x, z, a] of BIKES) b.add(rotY(x, walk, z, a), 0xffffff, new THREE.Vector3(x, walk + 0.2, z));
    const ub = batch('utility-boxes', utilityBoxShape());
    for (const [x, z, a] of UTILITY_BOXES) {
      for (const k of [-1, 1]) {
        const ox = Math.cos(a) * 0.125 * k;
        const oz = -Math.sin(a) * 0.125 * k;
        ub.add(rotY(x + ox, walk, z + oz, a), 0xffffff, new THREE.Vector3(x + ox, walk + 0.42, z + oz));
      }
    }
    const vb = batch('vending', vendingShape());
    for (const [x, z, a, c] of VENDING) {
      vb.add(rotY(x, walk, z, a), c, new THREE.Vector3(x, walk + 0.4, z));
      lights.push({ x: x + Math.sin(a) * 0.2, z: z + Math.cos(a) * 0.2, radius: 0.45, color: new THREE.Color('#fff2d8'), intensity: 0.35 });
    }
    const kb = batch('kiosk', kioskShape());
    kb.add(rotY(KIOSK[0], walk, KIOSK[1], KIOSK[2]), 0xffffff, new THREE.Vector3(KIOSK[0], walk + 0.6, KIOSK[1]));
    lights.push({ x: KIOSK[0] + Math.sin(KIOSK[2]) * 0.35, z: KIOSK[1] + Math.cos(KIOSK[2]) * 0.35, radius: 0.8, color: WARM, intensity: 0.6 });
  }

  for (const b of batches) {
    const mesh = b.build();
    if (!mesh) continue;
    group.add(mesh);
    casters.push(mesh);
    counts[b.name] = b.count;
  }
  // 構図合わせ用の上端：街灯・街路樹・電柱
  const topPoints: THREE.Vector3[] = [];
  for (const [x, z] of LAMPS) topPoints.push(new THREE.Vector3(x, walk + 1.65, z));
  for (const [x, z, h] of TREES) topPoints.push(new THREE.Vector3(x, walk + h, z));
  for (const [x, z, h] of POLES) topPoints.push(new THREE.Vector3(x, walk + h, z));
  return { group, casters, lights, counts, topPoints };
}
