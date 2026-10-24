import type { P2 } from './geometry2d';
import { config } from '../config';
import { A, ALLEY_HALF, L, R } from './plan';

/**
 * 通りの物の配置（参考画像の足もとの点を 3D に戻して、建物と縁石に合わせて直したもの）。
 * 位置は上から見た [x, z]。L(s, d)・R(s, d) は左右の通りに沿った座標（d は縁石から奥へ）
 */

/** 日よけ：建物の面に沿った範囲 u0〜u1、取り付ける高さ y（歩道から）、出幅、垂れ、前の垂れ幕の高さ、色 */
export interface AwningSpec {
  mass: string;
  face: number;
  u0: number;
  u1: number;
  y: number;
  depth: number;
  drop: number;
  valance: number;
  colors: string[];
  stripe?: number;
}

export const AWNINGS: AwningSpec[] = [
  // 1 階のお店の色にそろえる（ハコニワ電機・カナリア無線・ピクセル堂・ギガロボ・クジラ音響・つきみ堂・ロケット家電・デンキのモリ）
  { mass: 'LB1', face: 0, u0: 0.06, u1: 1.72, y: 0.64, depth: 0.4, drop: 0.14, valance: 0.07, colors: ['#2453a8', '#f2f0ea'], stripe: 0.062 },
  { mass: 'LB1b', face: 0, u0: 0.05, u1: 0.8, y: 0.62, depth: 0.32, drop: 0.11, valance: 0.06, colors: ['#2b5fb0'] },
  { mass: 'LB4', face: 3, u0: 0.2, u1: 0.9, y: 0.64, depth: 0.34, drop: 0.12, valance: 0.06, colors: ['#9a2f86'] },
  { mass: 'RB1', face: 3, u0: 0.12, u1: 1.52, y: 0.64, depth: 0.34, drop: 0.12, valance: 0.06, colors: ['#c22f3a'] },
  { mass: 'RB1', face: 0, u0: 0.32, u1: 1.3, y: 0.62, depth: 0.32, drop: 0.11, valance: 0.06, colors: ['#1f3c6e'] },
  { mass: 'RB2', face: 0, u0: 0.05, u1: 0.68, y: 0.62, depth: 0.3, drop: 0.1, valance: 0.06, colors: ['#1f2a5c', '#e8c25a'], stripe: 0.055 },
  { mass: 'RB3', face: 0, u0: 0.05, u1: 0.72, y: 0.62, depth: 0.3, drop: 0.11, valance: 0.06, colors: ['#e2701e'] },
  { mass: 'AE', face: 0, u0: 0.06, u1: 0.82, y: 0.56, depth: 0.26, drop: 0.09, valance: 0.05, colors: ['#2e8b57', '#f2f0ea'], stripe: 0.06 },
];

/** 店先の商品の棚：建物の面の店先の前に並べる（面ごとに範囲と数） */
export interface GoodsSpec {
  mass: string;
  face: number;
  u0: number;
  u1: number;
  /** 面からの離れ */
  off: number;
  count: number;
}

export const GOODS: GoodsSpec[] = [
  { mass: 'LB1', face: 0, u0: 0.1, u1: 1.65, off: 0.2, count: 8 },
  { mass: 'LB1b', face: 0, u0: 0.08, u1: 0.78, off: 0.18, count: 4 },
  { mass: 'LB2', face: 0, u0: 0.08, u1: 0.92, off: 0.2, count: 5 },
  { mass: 'LB4', face: 3, u0: 0.25, u1: 0.86, off: 0.18, count: 3 },
  { mass: 'RB1', face: 3, u0: 0.18, u1: 1.5, off: 0.2, count: 7 },
  { mass: 'RB1', face: 0, u0: 0.32, u1: 1.3, off: 0.18, count: 5 },
  { mass: 'RB2', face: 0, u0: 0.08, u1: 0.68, off: 0.17, count: 3 },
  { mass: 'RB3', face: 0, u0: 0.08, u1: 0.72, off: 0.17, count: 4 },
  { mass: 'RB1blue', face: 3, u0: 0.55, u1: 1.25, off: 0.16, count: 3 },
  { mass: 'AE', face: 0, u0: 0.1, u1: 0.78, off: 0.15, count: 3 },
  // 路地の店（らーめん屋は棚を置かず、明かりだけ）
  { mass: 'LB4', face: 0, u0: 0.15, u1: 0.85, off: 0.14, count: 3 },
  { mass: 'LB3', face: 0, u0: 0.15, u1: 1.05, off: 0.14, count: 4 },
  { mass: 'LBk3', face: 0, u0: 0.12, u1: 0.68, off: 0.14, count: 0 },
  { mass: 'RB1blue', face: 0, u0: 0.15, u1: 1.55, off: 0.14, count: 5 },
  { mass: 'RBk2', face: 0, u0: 0.12, u1: 0.95, off: 0.14, count: 3 },
];

/** 街灯（柱の足もと） */
export const LAMPS: P2[] = [
  L(-4.75, 0.25),
  L(-3.59, 0.24),
  [-1.62, 1.25],
  [-0.2, 2.52],
  [3.34, 1.95],
  [4.74, 1.27],
  // 路地と右の裏路地の角
  [0.93, -2.23],
];

/** 街路樹（幹の足もと、高さ） */
export const TREES: [number, number, number][] = [
  [...L(-5.55, 0.3), 2.05],
  [...L(-4.05, 0.26), 2.2],
  [-1.3, 1.05, 2.0],
  [1.07, 1.2, 2.15],
  [0.02, 2.62, 1.6],
  [3.62, 1.84, 2.1],
  [4.86, 1.18, 2.05],
];

/** 電柱（足もと、高さ） */
export const POLES: [number, number, number][] = [
  [0.72, 0.3, 3.5],
  [0.62, -2.55, 3.3],
  [4.15, 1.62, 3.6],
];

/** 電線（電柱 i の腕の高さから、点 [x, y, z] へ。または電柱どうし） */
export const WIRES: { from: number; to: number | [number, number, number]; sag: number }[] = [
  { from: 0, to: 1, sag: 0.18 },
  { from: 0, to: 2, sag: 0.3 },
  { from: 2, to: [4.9, 3.6, 0.85], sag: 0.1 },
  { from: 0, to: [-0.75, 3.9, -0.95], sag: 0.16 },
  { from: 1, to: [-0.4, 3.6, -3.4], sag: 0.14 },
  { from: 1, to: [1.5, 4.0, -2.0], sag: 0.12 },
  { from: 0, to: [1.6, 4.4, 0.2], sag: 0.1 },
];

/** 車止め（右の通りの縁石、左の通りの交差点の近く、向かいの歩道の縁石。柵・街灯・木と重ならない所） */
export function bollardPoints(): P2[] {
  const pts: P2[] = [];
  for (const s of [2.35, 2.75, 3.15, 3.55, 5.0]) pts.push(R(s, 0.12));
  for (let s = -0.55; s <= 0.7; s += 0.42) pts.push(L(s, 0.12));
  // 左手前の向かいの歩道（車道の幅の先）
  const far = -config.town.road.width - 0.12;
  for (let s = -3.2; s <= -0.85; s += 0.47) pts.push(L(s, far));
  return pts;
}

/** 低い柵（左の通りの縁石に沿って）：始点・終点の組 */
export const FENCES: [P2, P2][] = [
  [L(-5.7, 0.1), L(-4.3, 0.1)],
  [L(-4.05, 0.1), L(-2.7, 0.1)],
  [L(-2.35, 0.1), L(-1.15, 0.1)],
  [R(1.25, 0.1), R(2.05, 0.1)],
  [R(3.85, 0.1), R(4.55, 0.1)],
];

/** 自転車（位置と向き） */
export const BIKES: [number, number, number][] = [
  [...L(-1.5, 0.32), 0.55],
  [0.42, 3.0, -0.4],
];

/** 緑の配電箱 */
export const UTILITY_BOXES: [number, number, number][] = [[-0.72, 2.28, 0.55]];

/** 自動販売機（位置、向き、色）：路地の右の青いビルの、広場の側の端の前 */
export const VENDING: [number, number, number, string][] = [
  [1.883, 0.209, -0.035, '#f4f2ee'],
  [1.653, 0.203, -0.035, '#c82c36'],
];

/** 小さな売店（位置、向き） */
export const KIOSK: [number, number, number] = [-0.82, 0.72, 0.42];

/** 左手前の植え込み（向かいの歩道の上） */
export const PLANTERS: [number, number, number][] = [[-4.52, 3.18, 1.2]];

/** 左手前の角の小さな足もとの灯り */
export const SMALL_LIGHTS: [number, number][] = [[-4.18, 3.72]];

/**
 * 広場（交差点の角から、路地の入口までの開けた所）。人を置ける所の判定に使う。
 * 角の建物の角（左手前の右のビル・中央左の高いビル・路地の両側・右の角のビル）を結んだ多角形
 */
export const PLAZA: P2[] = [
  L(-3.6, 0),
  L(-3.6, 0.95),
  L(-3.6, 1.95),
  R(0.04, 5.15),
  R(1.02, 5.15),
  A(2.2, ALLEY_HALF + 0.95),
  A(2.2, ALLEY_HALF),
  A(1.25, -ALLEY_HALF),
  A(1.25, -ALLEY_HALF - 1.35),
  R(2.74, 2.27),
  R(2.74, 0.7),
  R(2.74, 0),
  R(0.6, 0),
  L(0.6, 0),
];
