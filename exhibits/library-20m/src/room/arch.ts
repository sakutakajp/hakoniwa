import * as THREE from 'three';
import type { FaceInfo, MeshBuilder } from '../meshBuilder';

/**
 * 壁の面の上の座標（u：外から見て右向き、v：上向き、n：面の外向きの法線）。
 * u × v = n（右手系）。面の上の点は o + u·a + v·b + n·c
 */
export interface Frame {
  o: THREE.Vector3;
  u: THREE.Vector3;
  v: THREE.Vector3;
  n: THREE.Vector3;
}

/** 外向きの法線 n（水平）を持つ縦の面の座標。原点 o */
export function wallFrame(o: THREE.Vector3, n: THREE.Vector3): Frame {
  const v = new THREE.Vector3(0, 1, 0);
  const nn = n.clone().normalize();
  const u = new THREE.Vector3().crossVectors(v, nn).normalize();
  return { o: o.clone(), u, v, n: nn };
}

export function at(fr: Frame, a: number, b: number, c = 0): THREE.Vector3 {
  return fr.o.clone().addScaledVector(fr.u, a).addScaledVector(fr.v, b).addScaledVector(fr.n, c);
}

/** 面の上の長方形（奥行き c の面に、外向きに） */
export function rectFace(mb: MeshBuilder, fr: Frame, u0: number, u1: number, v0: number, v1: number, f: FaceInfo, c = 0, cell?: number) {
  if (u1 - u0 < 1e-5 || v1 - v0 < 1e-5) return;
  mb.quad(at(fr, u0, v0, c), at(fr, u1, v0, c), at(fr, u1, v1, c), at(fr, u0, v1, c), f, { uOffset: u0, v0, cell });
}

/** アーチの開口：u の範囲、下端（窓台）、アーチの始まり、頂。アーチは楕円の上半分（半径 = 幅の半分と、頂までの高さ） */
export interface ArchHole {
  u0: number;
  u1: number;
  sill: number;
  spring: number;
  top: number;
}

export function archPoint(h: ArchHole, theta: number): [number, number] {
  const cu = (h.u0 + h.u1) / 2;
  const rx = (h.u1 - h.u0) / 2;
  const ry = h.top - h.spring;
  return [cu + rx * Math.cos(theta), h.spring + ry * Math.sin(theta)];
}

/** アーチの角度の並び（左の始まり π から右の始まり 0 へ） */
export function archThetas(segments: number): number[] {
  return Array.from({ length: segments + 1 }, (_, i) => Math.PI * (1 - i / segments));
}

/** 開口の縁を下から一周する点（左の縦の辺 → アーチ → 右の縦の辺）。offset だけ外へ広げる */
export function holeOutline(h: ArchHole, segments: number, offset = 0): [number, number][] {
  const g: ArchHole = { u0: h.u0 - offset, u1: h.u1 + offset, sill: h.sill, spring: h.spring, top: h.top + offset };
  const pts: [number, number][] = [[g.u0, h.sill]];
  if (h.spring > h.sill + 1e-5) pts.push([g.u0, h.spring]);
  for (const th of archThetas(segments).slice(1, -1)) pts.push(archPoint(g, th));
  if (h.spring > h.sill + 1e-5) pts.push([g.u1, h.spring]);
  pts.push([g.u1, h.sill]);
  return pts;
}

/**
 * アーチの開口のまわりの面（長方形 rect からアーチの開口を抜いた形）。
 * 開口の左右・下・上の長方形と、アーチと角の間（三角の小壁）を、アーチの点と枠の点を結ぶ四角形の帯で作る
 */
export function archFrameFace(
  mb: MeshBuilder,
  fr: Frame,
  rect: { u0: number; u1: number; v0: number; v1: number },
  h: ArchHole,
  f: FaceInfo,
  opts: { c?: number; segments?: number; cell?: number } = {},
) {
  const c = opts.c ?? 0;
  const seg = opts.segments ?? 14;
  rectFace(mb, fr, rect.u0, h.u0, rect.v0, rect.v1, f, c, opts.cell);
  rectFace(mb, fr, h.u1, rect.u1, rect.v0, rect.v1, f, c, opts.cell);
  rectFace(mb, fr, h.u0, h.u1, rect.v0, h.sill, f, c, opts.cell);
  rectFace(mb, fr, h.u0, h.u1, h.top, rect.v1, f, c, opts.cell);
  // アーチと、アーチを囲む箱 [u0, u1] × [spring, top] の間
  const cu = (h.u0 + h.u1) / 2;
  const rx = (h.u1 - h.u0) / 2;
  const ry = h.top - h.spring;
  // 箱の上の角に当たる角度。光線の向きは楕円の媒介変数（rx·cosθ, ry·sinθ）なので、角は θ = 3π/4 と π/4
  //（幾何の角度 atan2(ry, ∓rx) を使うと角が頂点にならず、角の小さな三角形にすき間ができる）
  const tl = (Math.PI * 3) / 4;
  const tr = Math.PI / 4;
  const thetas = [...archThetas(seg), tl, tr, Math.PI / 2].sort((a, b) => b - a).filter((t, i, arr) => i === 0 || Math.abs(t - arr[i - 1]) > 1e-6);
  const boxPoint = (th: number): [number, number] => {
    const dx = rx * Math.cos(th);
    const dy = ry * Math.sin(th);
    // 中心からの光線が箱の縁に当たる所
    const ts: number[] = [];
    if (dx < -1e-9) ts.push(-rx / dx);
    if (dx > 1e-9) ts.push(rx / dx);
    if (dy > 1e-9) ts.push(ry / dy);
    const t = Math.min(...ts);
    return [cu + dx * t, h.spring + dy * t];
  };
  for (let i = 0; i < thetas.length - 1; i++) {
    const [pa, pb] = [archPoint(h, thetas[i]), archPoint(h, thetas[i + 1])];
    const [qa, qb] = [boxPoint(thetas[i]), boxPoint(thetas[i + 1])];
    const area = Math.abs((pb[0] - pa[0]) * (qa[1] - pa[1]) - (qa[0] - pa[0]) * (pb[1] - pa[1])) + Math.abs((qb[0] - pb[0]) * (qa[1] - pb[1]) - (qa[0] - pb[0]) * (qb[1] - pb[1]));
    if (area < 1e-7) continue;
    mb.quadAuto(at(fr, pa[0], pa[1], c), at(fr, pb[0], pb[1], c), at(fr, qb[0], qb[1], c), at(fr, qa[0], qa[1], c), fr.n, f, { cell: opts.cell });
  }
}

/** 開口の内側の面（窓台・左右の脇・アーチの裏）を、奥行き c0 から c1 まで（c1 < c0 で奥へ）。sides: false で左右の脇を作らない */
export function archReveal(mb: MeshBuilder, fr: Frame, h: ArchHole, c0: number, c1: number, f: FaceInfo, opts: { segments?: number; sill?: FaceInfo; skipSill?: boolean; sides?: boolean } = {}) {
  const seg = opts.segments ?? 14;
  const up = fr.v.clone();
  if (!opts.skipSill) mb.quadAuto(at(fr, h.u0, h.sill, c0), at(fr, h.u1, h.sill, c0), at(fr, h.u1, h.sill, c1), at(fr, h.u0, h.sill, c1), up, opts.sill ?? f);
  if (h.spring > h.sill + 1e-5 && opts.sides !== false) {
    mb.quadAuto(at(fr, h.u0, h.sill, c0), at(fr, h.u0, h.spring, c0), at(fr, h.u0, h.spring, c1), at(fr, h.u0, h.sill, c1), fr.u, f);
    mb.quadAuto(at(fr, h.u1, h.sill, c0), at(fr, h.u1, h.spring, c0), at(fr, h.u1, h.spring, c1), at(fr, h.u1, h.sill, c1), fr.u.clone().negate(), f);
  }
  const ths = archThetas(seg);
  const cu = (h.u0 + h.u1) / 2;
  for (let i = 0; i < ths.length - 1; i++) {
    const a = archPoint(h, ths[i]);
    const b = archPoint(h, ths[i + 1]);
    const mid = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
    const inward = fr.u.clone().multiplyScalar(cu - mid[0]).addScaledVector(fr.v, h.spring - mid[1]);
    mb.quadAuto(at(fr, a[0], a[1], c0), at(fr, b[0], b[1], c0), at(fr, b[0], b[1], c1), at(fr, a[0], a[1], c1), inward, f);
  }
}

/**
 * 開口のまわりの縁取り（石のアーチの枠・本棚のアーチの額縁）。開口の縁から width だけ外へ、depth だけ手前へ出る帯。
 * keystone で頂に要石を付ける
 */
export function archBand(
  mb: MeshBuilder,
  fr: Frame,
  h: ArchHole,
  width: number,
  depth: number,
  f: FaceInfo,
  opts: { segments?: number; keystone?: { width: number; height: number; depth: number; face?: FaceInfo }; c?: number; down?: boolean } = {},
) {
  const seg = opts.segments ?? 14;
  const c = opts.c ?? 0;
  const inner = holeOutline(h, seg, 0);
  const outer = holeOutline(h, seg, width);
  // 下の端（窓台の高さ）では帯を閉じない（窓台・床に続く）
  for (let i = 0; i < inner.length - 1; i++) {
    const a = inner[i];
    const b = inner[i + 1];
    const A = outer[i];
    const B = outer[i + 1];
    mb.quadAuto(at(fr, a[0], a[1], c + depth), at(fr, b[0], b[1], c + depth), at(fr, B[0], B[1], c + depth), at(fr, A[0], A[1], c + depth), fr.n, f);
    // 外側の縁
    const om = [(A[0] + B[0]) / 2, (A[1] + B[1]) / 2];
    const im = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
    const outDir = fr.u.clone().multiplyScalar(om[0] - im[0]).addScaledVector(fr.v, om[1] - im[1]);
    mb.quadAuto(at(fr, A[0], A[1], c), at(fr, B[0], B[1], c), at(fr, B[0], B[1], c + depth), at(fr, A[0], A[1], c + depth), outDir, f);
    mb.quadAuto(at(fr, a[0], a[1], c), at(fr, b[0], b[1], c), at(fr, b[0], b[1], c + depth), at(fr, a[0], a[1], c + depth), outDir.clone().negate(), f);
  }
  if (opts.keystone) {
    const k = opts.keystone;
    const cu = (h.u0 + h.u1) / 2;
    const y0 = h.top - k.height * 0.35;
    const p = (a: number, b: number, cc: number) => at(fr, a, b, c + cc);
    const b = [p(cu - k.width * 0.4, y0, k.depth), p(cu + k.width * 0.4, y0, k.depth), p(cu + k.width * 0.4, y0, 0), p(cu - k.width * 0.4, y0, 0)];
    const t = [p(cu - k.width / 2, y0 + k.height, k.depth), p(cu + k.width / 2, y0 + k.height, k.depth), p(cu + k.width / 2, y0 + k.height, 0), p(cu - k.width / 2, y0 + k.height, 0)];
    mb.hexa(b, t, k.face ?? f, { skip: ['back'] });
  }
}

/** 開口を埋める面（アーチの形の 1 枚。ガラスや本棚の奥の板）。奥行き c、向き n */
export function archFill(mb: MeshBuilder, fr: Frame, h: ArchHole, f: FaceInfo, c = 0, segments = 14, flip = false) {
  const normal = flip ? fr.n.clone().negate() : fr.n;
  if (h.spring > h.sill + 1e-5) {
    mb.quadAuto(at(fr, h.u0, h.sill, c), at(fr, h.u1, h.sill, c), at(fr, h.u1, h.spring, c), at(fr, h.u0, h.spring, c), normal, f, { v0: 0 });
  }
  // アーチの部分：中心から扇形に（細い三角形を台形で）
  const cu = (h.u0 + h.u1) / 2;
  const ths = archThetas(segments);
  for (let i = 0; i < ths.length - 1; i++) {
    const a = archPoint(h, ths[i]);
    const b = archPoint(h, ths[i + 1]);
    const ca = [cu + (a[0] - cu) * 0.02, h.spring + (a[1] - h.spring) * 0.02];
    const cb = [cu + (b[0] - cu) * 0.02, h.spring + (b[1] - h.spring) * 0.02];
    mb.quadAuto(at(fr, ca[0], ca[1], c), at(fr, cb[0], cb[1], c), at(fr, b[0], b[1], c), at(fr, a[0], a[1], c), normal, f, { v0: h.spring - h.sill, cell: 1e3 });
  }
}
