import type { MassSpec } from './buildings';
import { ALLEY_HALF, boxA, boxAEnd, boxL, boxR } from './plan';

/**
 * 建物の塊の一覧（参考画像から読み取った配置を、街として成り立つように整えたもの）。
 *  - 建物はすべて長方形。向きは面している道にそろえる（左の通り L・右の通り R・路地 A）
 *  - どの建物も、通り・広場・路地・裏路地のどれかに面していて、入口がある（面 0 が基本の正面）
 *  - 通りに面する建物の正面は、歩道の幅（config.town.sidewalk）の線にそろえる
 * 高さは歩道からの壁の高さ。1 階は店先、上の階に窓
 */
const shopFront = { windows: 'punched' as const, shop: true };

export const MASSES: MassSpec[] = [
  // ===== 左の通りに面する（面 0 が通り） =====
  // 左手前の角のビル（青と白のしまの日よけの店、黄色い縦長の看板）
  {
    id: 'LB1',
    corners: boxL(-6.3, -4.45, 0.95, 2.35),
    height: 3.3,
    style: 'tileWarm',
    faces: { 0: shopFront, 3: { windows: 'punched', bay: 0.3 }, 2: { windows: 'small' } },
  },
  // その右（青い日よけの店）
  {
    id: 'LB1b',
    corners: boxL(-4.45, -3.6, 0.95, 1.95),
    height: 3.15,
    style: 'tileBeige',
    faces: { 0: shopFront, 1: { windows: 'small' }, 2: { windows: 'small' } },
  },
  // ===== 広場に面する（面 0 が広場） =====
  // 中央左の高いタイルのビル（左の面に赤いパネルと非常階段）
  {
    id: 'LB2',
    corners: boxR(0.04, 1.02, 5.15, 6.8),
    height: 4.62,
    style: 'tileBeige',
    faces: { 0: shopFront, 3: { windows: 'small', bay: 0.5 } },
  },
  // ===== 路地の左（面 0 が路地、面 3 が広場の側の端） =====
  // 広場と路地の角のビル（広場の側に赤い日よけの店）
  {
    id: 'LB4',
    corners: boxA(2.2, 3.2, ALLEY_HALF, ALLEY_HALF + 0.95),
    height: 3.45,
    style: 'tileWarm',
    faces: { 0: { windows: 'punched', shop: true }, 3: shopFront, 2: { windows: 'small' } },
  },
  // その奥の、左の街区でいちばん高いビル
  {
    id: 'LB3',
    corners: boxA(3.25, 4.4, ALLEY_HALF, ALLEY_HALF + 1.3),
    height: 4.35,
    style: 'tileGray',
    faces: { 0: { windows: 'punched', shop: true }, 3: { windows: 'wide' } },
  },
  {
    id: 'LBk3',
    corners: boxA(4.45, 6.1, ALLEY_HALF + 0.01, ALLEY_HALF + 1.45),
    height: 3.4,
    style: 'tileWarm',
    faces: { 0: { windows: 'punched', shop: true } },
  },
  // 路地の突き当たり（路地に面する）
  {
    id: 'AE',
    corners: boxAEnd(5.2, 6.12, 0.44),
    height: 3.4,
    style: 'tileWhite',
    faces: { 0: shopFront },
  },
  // ===== 左の裏路地に面する（面 0 が裏路地） =====
  {
    id: 'LB1u',
    corners: boxL(-7.25, -6.05, 2.94, 4.6),
    height: 3.6,
    style: 'tileGray',
    faces: { 0: { windows: 'punched' }, 1: { windows: 'punched' }, 3: { windows: 'small' } },
  },
  {
    id: 'LBk1',
    corners: boxL(-6.0, -5.3, 2.94, 4.5),
    height: 3.2,
    style: 'tileDark',
    faces: { 0: { windows: 'punched' } },
  },
  // ===== 右の通りに面する（面 0 が通り） =====
  // 角の大きなビル（左の面はガラスの売り場、前の面に大きな縦長の看板）
  {
    id: 'RB1',
    corners: boxR(2.74, 4.13, 0.7, 2.27),
    height: 4.85,
    style: 'tileGray',
    faces: {
      0: shopFront,
      3: { windows: 'curtain', shop: true, style: 'glass', bay: 0.72, lit: 1 },
    },
  },
  // 右のビル（非常階段、屋上の木）
  {
    id: 'RB2',
    corners: boxR(4.13, 4.85, 0.7, 2.27),
    height: 4.6,
    style: 'tileWarm',
    faces: { 0: shopFront },
  },
  // 右端の低いビル（赤い日よけの店）
  {
    id: 'RB3',
    corners: boxR(4.85, 5.6, 0.7, 2.27),
    height: 3.9,
    style: 'tileGray',
    faces: { 0: shopFront },
  },
  // ===== 路地の右（面 0 が路地） =====
  // 路地に面した青いパネルのビル（広場の側の端も店先）
  {
    id: 'RB1blue',
    corners: boxA(1.25, 2.9, -ALLEY_HALF, -ALLEY_HALF - 1.35),
    height: 5.3,
    style: 'blue',
    faces: { 0: { windows: 'wide', bay: 0.6, lit: 0.95, shop: true }, 3: { windows: 'wide', bay: 0.6, shop: true } },
  },
  {
    id: 'RBk2',
    corners: boxA(4.2, 6.1, -ALLEY_HALF - 0.01, -ALLEY_HALF - 0.95),
    height: 4.6,
    style: 'tileWarm',
    faces: { 0: { windows: 'punched', shop: true } },
  },
  // ===== 右の裏路地に面する =====
  // 右の通りのビルの裏（面 2 が裏路地）
  {
    id: 'RBk1',
    corners: boxR(4.35, 5.6, 2.3, 4.67),
    height: 4.2,
    style: 'tileBeige',
    faces: { 2: { windows: 'punched', shop: true } },
  },
  // 裏路地の奥の側（面 0 が裏路地）
  {
    id: 'RBk4',
    corners: boxR(5.12, 6.05, 5.27, 6.5),
    height: 3.7,
    style: 'tileDark',
    faces: { 0: { windows: 'punched' } },
  },
  {
    id: 'RBk5',
    corners: boxR(6.1, 6.95, 5.27, 6.2),
    height: 3.3,
    style: 'tileBeige',
    faces: { 0: { windows: 'punched' } },
  },
  {
    id: 'RBk7',
    corners: boxR(7.0, 7.5, 5.27, 5.85),
    height: 3.5,
    style: 'tileGray',
    faces: { 0: { windows: 'punched' } },
  },
];
