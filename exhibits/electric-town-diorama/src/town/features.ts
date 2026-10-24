import type { FireEscapeSpec, WallUnitsSpec } from './facadeProps';
import type { BrandKey } from './brands';
import type { IconName } from './signArt';
import type { SignSpec } from './signs';

/**
 * 建物に付ける看板。どれも架空のお店（brands.ts）の名前とロゴで、どの建物のどの階に入っているかを決めて付ける。
 *  - 1 階のお店：店先の上の横長の看板（日よけがあればその上、なければ店先の上の帯に重ねる）
 *  - 上の階のお店：面から突き出す袖看板（店名と階）。路地では建物の角に、下の階から順に縦に並べる
 *  - 大きな縦長の看板：上にお店のロゴ、下に売り物の絵記号
 * 位置は建物の面に沿った長さ u（面の始点から。負なら終点から）と、歩道からの高さ y。
 * 面の向き：通りの建物は面 0 が通り、路地の建物は面 0 が路地、面 3 が広場の側の端（右の列は u が広場の側から始まる）
 *
 * 入居しているお店（階）
 *  LB1  ハコニワ電機 1F・ジャンク横丁 2F・ラジオのマルミ 3F
 *  LB1b カナリア無線 1F・カフェ ポラリス 3F
 *  LB2  ミツバチ電子 1F・ネジとチップ 2F・タコアシ電材 3F
 *  LB4  ピクセル堂 1F・トレカのコメット 2F・カセット堂 3F・カプセルのたまご屋 4F
 *  LB3  くまの模型店 1F・キツネ電子 2F・ヒカリ電球店 3F・メロディ楽器 4F
 *  LBk3 らーめん そらまめ 1F・フクロウ時計店 2F・カレーのゾウ屋 3F
 *  AE   デンキのモリ 1F・ワクセイ堂 2F
 *  RB1  ギガロボ 1F（角）・クジラ音響 1F（通り）・イナズマ電池 2F
 *  RB2  ゲームのつきみ堂 1F・ゲーセン ハイスコア 2F
 *  RB3  ロケット家電 1F・ネコノテ電気 2F
 *  RB1blue ネオンギア 1F・ドット電脳 2F・ツバメ無線 3F
 *  RBk2 アオゾラ書房 1F
 */

/** 店先の上の横長の看板。日よけがあるときは日よけの上（y 0.645〜）、ないときは店先の上の帯に重ねる（y 0.555〜） */
function fascia(mass: string, face: number, u: number, w: number, brand: BrandKey, opts: { y?: number; h?: number; glow?: number } = {}): SignSpec {
  return {
    mass,
    face,
    u,
    y: opts.y ?? 0.555,
    w,
    h: opts.h ?? 0.22,
    mount: 'flat',
    off: 0.012,
    depth: 0.035,
    art: { kind: 'fascia', brand },
    glow: opts.glow ?? 1.15,
  };
}

/** 面から直角に突き出す袖看板（上にロゴ、縦書きの店名、下に階） */
function blade(mass: string, face: number, u: number, y: number, h: number, brand: BrandKey, floor?: string, w = 0.2): SignSpec {
  return { mass, face, u, y, w, h, mount: 'blade', off: 0.035, art: { kind: 'blade', brand, floor }, glow: 1.2 };
}

/** 面に貼る縦長の看板（袖看板と同じ絵） */
function plate(mass: string, face: number, u: number, y: number, h: number, brand: BrandKey, floor?: string, w = 0.15): SignSpec {
  return { mass, face, u, y, w, h, mount: 'flat', off: 0.03, art: { kind: 'blade', brand, floor }, glow: 1.2 };
}

/** 縦長の大きな看板（上にお店のロゴ、下に絵記号） */
function billboard(
  mass: string,
  face: number,
  u: number,
  y: number,
  w: number,
  h: number,
  brand: BrandKey,
  frame: string,
  panels: { icon: IconName; bg: string; fg: string }[],
): SignSpec {
  return { mass, face, u, y, w, h, mount: 'flat', art: { kind: 'icons', frame, panels, brand }, glow: 0.95 };
}

/** 縦長の帯の看板（店名を縦に大きく） */
function strip(mass: string, face: number, u: number, y: number, w: number, h: number, brand: BrandKey, color: string, light: string, glow: number): SignSpec {
  return { mass, face, u, y, w, h, mount: 'flat', art: { kind: 'strip', brand, color, light }, glow };
}

const BLUE = '#2f6fd8';
const YELLOW = '#f5bf38';

export const SIGNS: SignSpec[] = [
  // ===== 左手前の角のビル（LB1）：1 階はハコニワ電機 =====
  fascia('LB1', 0, 0.89, 1.62, 'hakoniwa', { y: 0.655, h: 0.14 }),
  billboard('LB1', 0, 0.79, 1.0, 0.5, 2.05, 'hakoniwa', '#f1b92c', [
    { icon: 'camera', bg: '#f7cd4a', fg: BLUE },
    { icon: 'controller', bg: BLUE, fg: '#ffffff' },
    { icon: 'laptop', bg: '#f7cd4a', fg: BLUE },
    { icon: 'headphones', bg: '#ffffff', fg: BLUE },
  ]),
  strip('LB1', 0, 1.2, 0.95, 0.27, 2.25, 'radio', '#a81f2b', '#cf3743', 0.6),
  plate('LB1', 0, 0.12, 1.0, 1.3, 'junk', '2F', 0.16),

  // ===== その右（LB1b）：カナリア無線、3 階にカフェ =====
  fascia('LB1b', 0, 0.425, 0.77, 'canaria', { y: 0.645, h: 0.14 }),
  blade('LB1b', 0, 0.78, 1.3, 0.78, 'polaris', '3F', 0.18),

  // ===== 中央左の高いビル（LB2）：広場に面してミツバチ電子 =====
  fascia('LB2', 0, 0.49, 0.9, 'mitsubachi'),
  billboard('LB2', 0, 0.57, 0.9, 0.52, 1.95, 'neji', '#efebe3', [
    { icon: 'chip', bg: '#ffffff', fg: '#2a4fd8' },
    { icon: 'pin', bg: '#ffffff', fg: '#e23b3b' },
    { icon: 'headphones', bg: '#ffffff', fg: '#2a4fd8' },
  ]),
  // 左の面の赤い帯
  strip('LB2', 3, 1.16, 1.5, 0.32, 2.5, 'tako', '#c0242d', '#e2444d', 0.55),

  // ===== 広場と路地の角（LB4）：広場の側にピクセル堂、左の端に上の階のお店 =====
  fascia('LB4', 3, 0.555, 0.68, 'pixel', { y: 0.665, h: 0.14 }),
  plate('LB4', 3, 0.1, 0.72, 0.62, 'comet', '2F'),
  plate('LB4', 3, 0.1, 1.4, 0.62, 'cassette', '3F'),
  plate('LB4', 3, 0.1, 2.08, 0.62, 'tamago', '4F'),
  // 路地の側
  fascia('LB4', 0, 0.55, 0.62, 'pixel'),
  blade('LB4', 0, 0.1, 0.82, 0.8, 'pixel', '1F', 0.22),
  blade('LB4', 0, 0.1, 1.7, 0.6, 'comet', '2F'),
  blade('LB4', 0, 0.1, 2.38, 0.6, 'cassette', '3F'),
  blade('LB4', 0, 0.5, 0.85, 0.62, 'tamago', '4F'),
  blade('LB4', 0, 0.5, 1.55, 0.62, 'cassette', '3F'),
  blade('LB4', 0, 0.88, 1.0, 0.56, 'comet', '2F', 0.18),
  blade('LB4', 0, 0.88, 1.64, 0.72, 'pixel', '1F', 0.18),

  // ===== その奥の高いビル（LB3）：くまの模型店。広場から見える上の壁に大きな看板 =====
  fascia('LB3', 3, 0.66, 1.1, 'kuma', { y: 3.62, h: 0.3, glow: 0.95 }),
  fascia('LB3', 0, 0.62, 0.9, 'kuma'),
  blade('LB3', 0, 0.1, 0.82, 0.85, 'kuma', '1F', 0.22),
  blade('LB3', 0, 0.1, 1.75, 0.62, 'kitsune', '2F'),
  blade('LB3', 0, 0.1, 2.45, 0.62, 'hikari', '3F'),
  blade('LB3', 0, 0.1, 3.15, 0.62, 'melody', '4F'),
  blade('LB3', 0, 0.55, 0.9, 0.7, 'melody', '4F'),
  blade('LB3', 0, 0.55, 1.68, 0.6, 'kitsune', '2F'),
  blade('LB3', 0, 0.98, 0.85, 0.6, 'hikari', '3F', 0.18),
  blade('LB3', 0, 0.98, 1.53, 0.7, 'kuma', '1F', 0.18),

  // ===== 路地の左の奥（LBk3）：らーめん屋 =====
  fascia('LBk3', 0, 0.4, 0.62, 'ramen'),
  blade('LBk3', 0, 0.1, 0.82, 0.75, 'ramen', undefined, 0.22),
  blade('LBk3', 0, 0.1, 1.65, 0.6, 'fukurou', '2F'),
  blade('LBk3', 0, 0.1, 2.33, 0.6, 'zou', '3F'),
  blade('LBk3', 0, 0.55, 0.9, 0.6, 'zou', '3F', 0.18),
  blade('LBk3', 0, 0.55, 1.58, 0.6, 'fukurou', '2F', 0.18),

  // ===== 路地の突き当たり（AE）：デンキのモリ =====
  fascia('AE', 0, 0.44, 0.78, 'mori', { y: 0.575, h: 0.19 }),
  plate('AE', 0, 0.1, 0.84, 0.62, 'planet', '2F', 0.14),
  plate('AE', 0, -0.1, 0.84, 0.74, 'mori', undefined, 0.14),

  // ===== 右の角の大きなビル（RB1）：角のガラスの売り場はギガロボ、通りの側はクジラ音響 =====
  fascia('RB1', 3, 0.82, 1.36, 'gigarobo', { y: 0.665, h: 0.15 }),
  fascia('RB1', 0, 0.81, 0.96, 'kujira', { y: 0.645, h: 0.14 }),
  billboard('RB1', 0, 0.62, 1.1, 0.68, 3.95, 'gigarobo', '#efede8', [
    { icon: 'controller', bg: '#ffffff', fg: '#e8483f' },
    { icon: 'train', bg: '#ffffff', fg: '#2f69d6' },
    { icon: 'car', bg: '#2f74d8', fg: '#ffffff' },
    { icon: 'plane', bg: YELLOW, fg: '#ffffff' },
    { icon: 'robot', bg: '#ffffff', fg: '#3a5fe0' },
    { icon: 'box', bg: '#b9b7c9', fg: '#ffffff' },
  ]),
  // その左の赤いネオンの帯（2 階のイナズマ電池）
  strip('RB1', 0, 0.13, 1.1, 0.19, 3.9, 'inazuma', '#d81d2c', '#ff5866', 1.3),
  { mass: 'RB1', face: 0, u: 0.15, y: 0.6, w: 0.24, h: 0.12, mount: 'flat', off: 0.02, art: { kind: 'text', text: '免税', bg: '#ff4f9e', fg: '#ffffff', vertical: false }, glow: 1.6 },

  // ===== 右のビル（RB2）：ゲームのつきみ堂、2 階はゲームセンター =====
  fascia('RB2', 0, 0.365, 0.64, 'tsukimi', { y: 0.645, h: 0.14 }),
  blade('RB2', 0, 0.66, 0.85, 1.1, 'hiscore', '2F', 0.2),

  // ===== 右端の低いビル（RB3）：ロケット家電 =====
  fascia('RB3', 0, 0.395, 0.66, 'rocket', { y: 0.645, h: 0.14 }),
  blade('RB3', 0, 0.07, 0.85, 0.65, 'neko', '2F'),
  blade('RB3', 0, 0.07, 1.6, 0.9, 'rocket', undefined),

  // ===== 路地の右の青いビル（RB1blue）：ネオンギア =====
  // 広場の側の端（u は右の端から路地の角へ）
  fascia('RB1blue', 3, 0.62, 1.15, 'neongear'),
  plate('RB1blue', 3, -0.1, 0.85, 0.62, 'dot', '2F'),
  plate('RB1blue', 3, -0.1, 1.53, 0.62, 'tsubame', '3F'),
  {
    mass: 'RB1blue',
    face: 3,
    u: 0.6,
    y: 2.66,
    w: 0.56,
    h: 0.13,
    mount: 'flat',
    off: 0.012,
    art: { kind: 'text', text: 'テナント募集', bg: '#ffffff', fg: '#1d4fb8', border: '#1d4fb8', vertical: false },
    glow: 0.45,
  },
  // 路地の側（u は広場の側から奥へ）
  fascia('RB1blue', 0, 0.83, 1.45, 'neongear'),
  blade('RB1blue', 0, 0.12, 0.82, 1.0, 'neongear', '1F', 0.24),
  blade('RB1blue', 0, 0.12, 1.92, 0.62, 'dot', '2F'),
  blade('RB1blue', 0, 0.12, 2.62, 0.62, 'tsubame', '3F'),
  blade('RB1blue', 0, 0.6, 0.88, 0.7, 'dot', '2F'),
  blade('RB1blue', 0, 0.6, 1.7, 0.7, 'tsubame', '3F'),
  blade('RB1blue', 0, 1.08, 0.85, 0.8, 'neongear', '1F'),
  blade('RB1blue', 0, 1.08, 1.75, 0.6, 'dot', '2F'),
  blade('RB1blue', 0, 1.52, 0.95, 0.7, 'tsubame', '3F', 0.18),

  // ===== 路地の右の奥（RBk2）：アオゾラ書房 =====
  fascia('RBk2', 0, 0.5, 0.86, 'aozora'),
  blade('RBk2', 0, 0.12, 0.82, 0.9, 'aozora', '1F', 0.22),
  blade('RBk2', 0, 0.62, 1.05, 0.75, 'aozora', '1F'),
];

/** 非常階段（中央左の高いビルの左の面、右のビルの前の面の左、左手前の右のビルの右の端） */
export const FIRE_ESCAPES: FireEscapeSpec[] = [
  { mass: 'LB2', face: 3, u: 0.12, w: 0.62, y0: 0.66, y1: 3.66, step: 0.6, depth: 0.28 },
  { mass: 'RB2', face: 0, u: 0.02, w: 0.36, y0: 1.26, y1: 4.0, step: 0.6, depth: 0.22 },
  { mass: 'LB1b', face: 1, u: 0.25, w: 0.5, y0: 1.26, y1: 2.46, step: 0.6, depth: 0.22 },
];

/** 壁の室外機（面ごとの数と範囲。袖看板の列を避ける） */
export const WALL_UNITS: WallUnitsSpec[] = [
  { mass: 'RB2', face: 0, count: 4, from: 0.6, to: 0.8 },
  { mass: 'RB3', face: 0, count: 3, from: 0.3, to: 0.85 },
  { mass: 'LB2', face: 0, count: 3, from: 0.06, to: 0.22 },
  { mass: 'LB4', face: 0, count: 2, from: 0.24, to: 0.36 },
  { mass: 'LB3', face: 0, count: 3, from: 0.24, to: 0.4 },
  { mass: 'LB1u', face: 0, count: 3 },
  { mass: 'RB1blue', face: 0, count: 2, from: 0.16, to: 0.28 },
  { mass: 'RBk2', face: 0, count: 2, from: 0.14, to: 0.26 },
  { mass: 'LB3', face: 3, count: 2, from: 0.04, to: 0.2 },
  { mass: 'RBk1', face: 0, count: 3, from: 0.2, to: 0.8 },
];
