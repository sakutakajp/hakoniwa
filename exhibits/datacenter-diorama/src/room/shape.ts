import * as THREE from 'three';

/**
 * 角の半径が角ごとに違う角丸の長方形（台座の外形）。
 * 角の順：手前右（+x, +z）→ 手前左 → 奥左 → 奥右。角度は +x から +z の向きへ測る（上から見た向き）
 */
export interface RoundedRect {
  /** x と z の半分の幅 */
  hx: number;
  hz: number;
  r: { frontRight: number; frontLeft: number; backLeft: number; backRight: number };
}

export interface OutlinePoint {
  x: number;
  z: number;
  /** 外向きの法線 */
  nx: number;
  nz: number;
  /** 外周に沿った距離（手前右の角の始まりから） */
  s: number;
}

export function roundedRect(width: number, depth: number, r: RoundedRect['r']): RoundedRect {
  return { hx: width / 2, hz: depth / 2, r };
}

/** 外周を内側へ d だけ下げた角丸の長方形（角の半径も d だけ小さく） */
export function insetRect(rect: RoundedRect, d: number): RoundedRect {
  const s = (v: number) => Math.max(v - d, 0.001);
  return {
    hx: rect.hx - d,
    hz: rect.hz - d,
    r: { frontRight: s(rect.r.frontRight), frontLeft: s(rect.r.frontLeft), backLeft: s(rect.r.backLeft), backRight: s(rect.r.backRight) },
  };
}

/** 角の中心と、その角の弧の始まりの角度（度） */
export function cornerCenters(rect: RoundedRect) {
  const { hx, hz, r } = rect;
  return [
    { cx: hx - r.frontRight, cz: hz - r.frontRight, r: r.frontRight, start: 0 },
    { cx: -hx + r.frontLeft, cz: hz - r.frontLeft, r: r.frontLeft, start: 90 },
    { cx: -hx + r.backLeft, cz: -hz + r.backLeft, r: r.backLeft, start: 180 },
    { cx: hx - r.backRight, cz: -hz + r.backRight, r: r.backRight, start: 270 },
  ];
}

/**
 * 外周の点（角ごとに segments 分割。直線部は角の端どうしを結ぶ）。
 * 弧の長さに比例して分割数を増やす（大きな角ほど細かく）
 */
export function outlinePoints(rect: RoundedRect, segmentsPerUnit = 12, minSegments = 6): OutlinePoint[] {
  const pts: OutlinePoint[] = [];
  let s = 0;
  let prev: { x: number; z: number } | null = null;
  for (const k of cornerCenters(rect)) {
    const seg = Math.max(minSegments, Math.ceil(((Math.PI / 2) * k.r) * segmentsPerUnit));
    for (let i = 0; i <= seg; i++) {
      const a = THREE.MathUtils.degToRad(k.start + (90 * i) / seg);
      const nx = Math.cos(a);
      const nz = Math.sin(a);
      const x = k.cx + k.r * nx;
      const z = k.cz + k.r * nz;
      if (prev) s += Math.hypot(x - prev.x, z - prev.z);
      pts.push({ x, z, nx, nz, s });
      prev = { x, z };
    }
  }
  return pts;
}

/** 角丸の長方形までの符号付き距離（内側が負） */
export function sdRoundedRect(rect: RoundedRect, x: number, z: number): number {
  const r = x > 0 ? (z > 0 ? rect.r.frontRight : rect.r.backRight) : z > 0 ? rect.r.frontLeft : rect.r.backLeft;
  const qx = Math.abs(x) - rect.hx + r;
  const qz = Math.abs(z) - rect.hz + r;
  return Math.min(Math.max(qx, qz), 0) + Math.hypot(Math.max(qx, 0), Math.max(qz, 0)) - r;
}

/** 長方形の外周を、指定した高さごとに並べた点群（カメラの画角合わせ用） */
export function outlineAt(rect: RoundedRect, ys: number[], segmentsPerUnit = 3): THREE.Vector3[] {
  const out: THREE.Vector3[] = [];
  for (const q of outlinePoints(rect, segmentsPerUnit, 4)) for (const y of ys) out.push(new THREE.Vector3(q.x, y, q.z));
  return out;
}

/** 決まった乱数（シード付き） */
export function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
