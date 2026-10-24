import { config } from '../config';
import type { P2 } from './geometry2d';

/**
 * 街区の座標の道具：左の通り（L）と右の通り（R）に沿った座標 (s, d) → 上から見た [x, z]。
 * s は通りに沿った位置（縁石の線の基準点から）、d は縁石から奥への距離。
 * 街区の多くの建物は右の通りの向き（R）にそろい、左の通りの手前の列だけが左の通りの向き（L）にそろう
 */
const t = config.town;

function frame(point: readonly [number, number], deg: number) {
  const a = (deg * Math.PI) / 180;
  const u: P2 = [Math.cos(a), Math.sin(a)];
  // 縁石から奥（左の法線）
  const n: P2 = [u[1], -u[0]];
  return { p: point, u, n };
}

const FL = frame(t.curbLeft.point, t.curbLeft.dir);
const FR = frame(t.curbRight.point, t.curbRight.dir);
/** 路地の枠：s は広場から奥へ、d は左（-x の側）が正 */
const FA = frame(t.alley.origin, t.alley.dir);
/** 路地の幅の半分 */
export const ALLEY_HALF = t.alley.width / 2;

export const uL = FL.u;
export const nL = FL.n;
export const uR = FR.u;
export const nR = FR.n;

export function L(s: number, d: number): P2 {
  return [FL.p[0] + FL.u[0] * s + FL.n[0] * d, FL.p[1] + FL.u[1] * s + FL.n[1] * d];
}

export function R(s: number, d: number): P2 {
  return [FR.p[0] + FR.u[0] * s + FR.n[0] * d, FR.p[1] + FR.u[1] * s + FR.n[1] * d];
}

export function A(s: number, d: number): P2 {
  return [FA.p[0] + FA.u[0] * s + FA.n[0] * d, FA.p[1] + FA.u[1] * s + FA.n[1] * d];
}

/** 上から見た点 → 枠の座標 (s, d) */
function inverse(F: { p: readonly [number, number]; u: P2; n: P2 }, p: P2): P2 {
  const dx = p[0] - F.p[0];
  const dz = p[1] - F.p[1];
  return [dx * F.u[0] + dz * F.u[1], dx * F.n[0] + dz * F.n[1]];
}
export const fromL = (p: P2) => inverse(FL, p);
export const fromR = (p: P2) => inverse(FR, p);
export const fromA = (p: P2) => inverse(FA, p);

/** 枠の名前から点を求める */
export function inFrame(frameName: 'L' | 'R' | 'A', s: number, d: number): P2 {
  return frameName === 'L' ? L(s, d) : frameName === 'R' ? R(s, d) : A(s, d);
}

/**
 * 路地に面する箱：路地に沿った s1〜s2、路地の中心からの距離 dFront（路地に面する面）〜 dBack。
 * 左の側は d が正、右の側は負。面 0 が路地に面する
 */
export function boxA(s1: number, s2: number, dFront: number, dBack: number): P2[] {
  return [A(s1, dFront), A(s2, dFront), A(s2, dBack), A(s1, dBack)];
}

/** 路地の突き当たりの箱：路地をふさぐ向き。面 0 が路地に面する（広場の側） */
export function boxAEnd(s1: number, s2: number, halfWidth: number): P2[] {
  return [A(s1, halfWidth), A(s1, -halfWidth), A(s2, -halfWidth), A(s2, halfWidth)];
}

/** 通りに沿った箱の外形：0 = 前（s1 → s2）、1 = 右、2 = 奥、3 = 左 */
export function boxL(s1: number, s2: number, d1: number, d2: number): P2[] {
  return [L(s1, d1), L(s2, d1), L(s2, d2), L(s1, d2)];
}

export function boxR(s1: number, s2: number, d1: number, d2: number): P2[] {
  return [R(s1, d1), R(s2, d1), R(s2, d2), R(s1, d2)];
}

/** 点 p を基準に、向き deg の箱（前の辺の左端が p、幅 w、奥行き depth）。0 = 前、1 = 右、2 = 奥、3 = 左 */
export function boxAt(p: P2, deg: number, w: number, depth: number): P2[] {
  const a = (deg * Math.PI) / 180;
  const u: P2 = [Math.cos(a), Math.sin(a)];
  const n: P2 = [u[1], -u[0]];
  const q = (s: number, d: number): P2 => [p[0] + u[0] * s + n[0] * d, p[1] + u[1] * s + n[1] * d];
  return [q(0, 0), q(w, 0), q(w, depth), q(0, depth)];
}

/** 上から見た点 a → b の向き（度） */
export function heading(a: P2, b: P2) {
  return (Math.atan2(b[1] - a[1], b[0] - a[0]) * 180) / Math.PI;
}

/** 2 点の間を t で分けた点 */
export function lerp2(a: P2, b: P2, k: number): P2 {
  return [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k];
}
