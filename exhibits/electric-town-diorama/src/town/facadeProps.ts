import * as THREE from 'three';
import type { SceneConfig } from '../config';
import { mulberry32 } from '../noise';
import { faceFrame, type MassSpec } from './buildings';
import type { TownEnv } from './env';
import { createPropMaterial, PropBatch, ShapeBuilder, type ProbeSet } from './propKit';

/**
 * 外壁に付く物：非常階段（踊り場と折り返しの階段と手すり）、壁の室外機、縦の雨どい、ベランダの手すり
 */
export interface FireEscapeSpec {
  mass: string;
  face: number;
  /** 面に沿った左端と幅 */
  u: number;
  w: number;
  /** 一番下の踊り場の高さと、一番上の高さ（歩道から） */
  y0: number;
  y1: number;
  /** 階の高さ */
  step: number;
  /** 壁から出る奥行き */
  depth?: number;
}

export interface WallUnitsSpec {
  mass: string;
  face: number;
  /** 置く数と、範囲（面に沿った割合 0〜1） */
  count: number;
  from?: number;
  to?: number;
  seed?: number;
}

const METAL = 0x232427;

function strutBetween(s: ShapeBuilder, a: THREE.Vector3, b: THREE.Vector3, r: number, color: number) {
  const d = new THREE.Vector3().subVectors(b, a);
  const len = d.length();
  if (len < 1e-4) return;
  const g = new THREE.BoxGeometry(r * 2, len, r * 2);
  g.translate(0, len / 2, 0);
  g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize()));
  g.translate(a.x, a.y, a.z);
  s.add(g, color);
}

/** 非常階段を、面の座標（u：面に沿って、v：上、d：壁から外へ）で組み立てる */
function buildFireEscape(s: ShapeBuilder, f: ReturnType<typeof faceFrame>, spec: FireEscapeSpec) {
  const depth = spec.depth ?? 0.27;
  const P = (u: number, y: number, d: number) =>
    new THREE.Vector3(f.a[0] + f.t[0] * u + f.n[0] * d, f.base + y, f.a[1] + f.t[1] * u + f.n[1] * d);
  const u0 = spec.u;
  const u1 = spec.u + spec.w;
  const yaw = Math.atan2(-f.t[1], f.t[0]);
  const levels: number[] = [];
  for (let y = spec.y0; y <= spec.y1 + 1e-3; y += spec.step) levels.push(y);
  const railH = 0.11;
  levels.forEach((y, k) => {
    // 踊り場：薄い板（面に沿って長い）
    const c = P((u0 + u1) / 2, y, depth / 2 + 0.01);
    s.box(c.x, c.y, c.z, spec.w, 0.022, depth, METAL, 0, yaw);
    // 手すり：外側の縁と両端
    const corners = [P(u0, y, 0.02), P(u0, y, depth), P(u1, y, depth), P(u1, y, 0.02)];
    for (let i = 0; i < 3; i++) {
      const a = corners[i];
      const b = corners[i + 1];
      strutBetween(s, a.clone().setY(a.y + railH), b.clone().setY(b.y + railH), 0.006, METAL);
      strutBetween(s, a.clone().setY(a.y + railH * 0.5), b.clone().setY(b.y + railH * 0.5), 0.004, METAL);
      const n = Math.max(1, Math.round(a.distanceTo(b) / 0.1));
      for (let j = 0; j <= n; j++) {
        const p = a.clone().lerp(b, j / n);
        strutBetween(s, p, p.clone().setY(p.y + railH), 0.004, METAL);
      }
    }
    // 次の踊り場への折り返しの階段（左右交互）
    if (k < levels.length - 1) {
      const y2 = levels[k + 1];
      const leftToRight = k % 2 === 0;
      const ua = leftToRight ? u0 + 0.06 : u1 - 0.06;
      const ub = leftToRight ? u1 - 0.12 : u0 + 0.12;
      const dmid = depth * 0.62;
      const a = P(ua, y + 0.01, dmid);
      const b = P(ub, y2 - 0.01, dmid);
      // 段（細い板）と、両側の桁
      const steps = Math.max(4, Math.round((y2 - y) / 0.045));
      for (let j = 1; j < steps; j++) {
        const p = a.clone().lerp(b, j / steps);
        s.box(p.x, p.y, p.z, 0.03, 0.006, 0.12, METAL, 0, yaw);
      }
      for (const dd of [-0.065, 0.065]) {
        const off = new THREE.Vector3(f.n[0] * dd, 0, f.n[1] * dd);
        strutBetween(s, a.clone().add(off), b.clone().add(off), 0.007, METAL);
        strutBetween(s, a.clone().add(off).setY(a.y + railH), b.clone().add(off).setY(b.y + railH), 0.004, METAL);
      }
    }
    // 壁への支え
    strutBetween(s, P(u0 + 0.04, y - 0.12, 0.0), P(u0 + 0.04, y - 0.01, depth * 0.8), 0.006, METAL);
    strutBetween(s, P(u1 - 0.04, y - 0.12, 0.0), P(u1 - 0.04, y - 0.01, depth * 0.8), 0.006, METAL);
  });
}

/** 壁の室外機（壁に向けた背中、前にファン、下に支えの金具） */
function wallUnit() {
  const s = new ShapeBuilder();
  s.box(0, 0, 0.045, 0.16, 0.12, 0.08, 0xc6c1b9);
  const ring = new THREE.CylinderGeometry(0.045, 0.045, 0.006, 16);
  ring.rotateX(Math.PI / 2);
  ring.translate(-0.025, 0.0, 0.087);
  s.add(ring, 0x99948c);
  const fan = new THREE.CylinderGeometry(0.038, 0.038, 0.008, 16);
  fan.rotateX(Math.PI / 2);
  fan.translate(-0.025, 0.0, 0.088);
  s.add(fan, 0x2b2d30);
  s.box(0, -0.066, 0.045, 0.17, 0.008, 0.09, 0x3a3b3e);
  s.box(-0.07, -0.08, 0.03, 0.008, 0.03, 0.06, 0x3a3b3e);
  s.box(0.07, -0.08, 0.03, 0.008, 0.03, 0.06, 0x3a3b3e);
  // 配管
  s.box(0.06, -0.02, 0.005, 0.012, 0.1, 0.012, 0x8a8680);
  return s.build();
}

export function createFacadeProps(
  config: SceneConfig,
  env: TownEnv,
  probes: ProbeSet,
  masses: readonly MassSpec[],
  escapes: readonly FireEscapeSpec[],
  units: readonly WallUnitsSpec[],
) {
  const walk = config.town.ground + config.town.curb;
  const byId = new Map(masses.map((m) => [m.id, m]));
  const mat = createPropMaterial(env, probes, { roughness: 0.6, metalness: 0.2, key: 'facade-props' });
  const group = new THREE.Group();
  group.name = 'facade-props';
  const casters: THREE.Mesh[] = [];

  // --- 非常階段（建物ごとに 1 つの形）
  for (const e of escapes) {
    const m = byId.get(e.mass);
    if (!m) continue;
    const f = faceFrame(m, e.face, walk);
    const s = new ShapeBuilder();
    buildFireEscape(s, f, e);
    const g = s.build();
    const mid = new THREE.Vector3(f.a[0] + f.t[0] * (e.u + e.w / 2) + f.n[0] * 0.3, f.base + (e.y0 + e.y1) / 2, f.a[1] + f.t[1] * (e.u + e.w / 2) + f.n[1] * 0.3);
    g.setAttribute('aProbe', new THREE.Float32BufferAttribute(new Float32Array(g.getAttribute('position').count).fill(probes.add(mid, new THREE.Vector3(f.n[0], 0.5, f.n[1]).normalize())), 1));
    const mesh = new THREE.Mesh(g, mat);
    mesh.name = `fire-escape-${e.mass}`;
    group.add(mesh);
    casters.push(mesh);
  }

  // --- 壁の室外機
  const ub = new PropBatch('wall-units', wallUnit(), mat, probes);
  for (const spec of units) {
    const m = byId.get(spec.mass);
    if (!m) continue;
    const f = faceFrame(m, spec.face, walk);
    const rng = mulberry32(spec.seed ?? spec.mass.length * 31 + spec.face);
    const floorH = m.floor ?? config.town.buildings.floor;
    const ground = m.ground ?? config.town.buildings.ground;
    const floors = Math.max(1, Math.floor((m.height - ground) / floorH + 0.3));
    const fh = (m.height - ground) / floors;
    const yaw = Math.atan2(f.n[0], f.n[1]);
    const used = new Set<string>();
    for (let i = 0; i < spec.count; i++) {
      for (let tries = 0; tries < 12; tries++) {
        const fl = 1 + Math.floor(rng() * (floors - 1));
        const t = (spec.from ?? 0.08) + rng() * ((spec.to ?? 0.92) - (spec.from ?? 0.08));
        const key = `${fl}-${Math.round(t * 6)}`;
        if (used.has(key)) continue;
        used.add(key);
        const u = t * f.len;
        // 窓の下の高さ（各階の床から少し上）
        const y = f.base + ground + fl * fh - fh + 0.1 + (fl === 0 ? 0 : 0);
        const x = f.a[0] + f.t[0] * u;
        const z = f.a[1] + f.t[1] * u;
        const mm = new THREE.Matrix4().compose(
          new THREE.Vector3(x, y + 0.08, z),
          new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw),
          new THREE.Vector3(1, 1, 1),
        );
        const shade = 0.85 + rng() * 0.2;
        ub.add(mm, new THREE.Color(shade, shade, shade), new THREE.Vector3(x + f.n[0] * 0.12, y + 0.1, z + f.n[1] * 0.12), new THREE.Vector3(f.n[0], 0.4, f.n[1]).normalize());
        break;
      }
    }
  }
  const um = ub.build();
  if (um) {
    group.add(um);
    casters.push(um);
  }
  return { group, casters, counts: { fireEscapes: escapes.length, wallUnits: ub.count } };
}
