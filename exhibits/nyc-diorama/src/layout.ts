import data from './layout.json';

/**
 * 街の配置（layout.json）の型。長さはすべてワールド単位（台座の一辺 10）。
 * x は右、z は手前（カメラの側）が正。高さ y は島の地面（道路の面）を 0 とする。
 * layout.json は tools/design_layout.py で作る（道路の網・区画・建物・橋・小物の位置と、走行テスト）。
 */
export type Vec2 = [number, number];

export interface BoxPart {
  type: 'box';
  /** 平面の中心 [x, z] */
  c: Vec2;
  /** 平面の大きさ [x 方向, z 方向] */
  size: Vec2;
  /** 下端と上端の高さ */
  y: Vec2;
  /** 外壁の様式（config.facades のキー） */
  style: string;
  /** 平面の回転（度） */
  rot?: number;
  /** 屋上の手すり壁を付けない（外壁から張り出した部分など。既定は付ける） */
  parapet?: boolean;
}

export interface TaperPart {
  type: 'taper';
  c: Vec2;
  size: Vec2;
  /** 上端の大きさ（下端から直線で細くなる） */
  top: Vec2;
  y: Vec2;
  style: string;
}

export interface AntiprismPart {
  type: 'antiprism';
  c: Vec2;
  /** 下端の正方形の一辺。上端は 45° 回した正方形（頂点が下端の辺の中点の真上） */
  size: number;
  /** 上端の正方形の大きさの倍率（1 で、頂点が下端の辺の中点の真上） */
  topScale?: number;
  y: Vec2;
  style: string;
}

export interface PyramidPart {
  type: 'pyramid';
  c: Vec2;
  size: Vec2;
  y: Vec2;
  /** 頂部の棟の長さ（0 で四角錐） */
  ridge?: number;
  style: string;
}

export interface SpirePart {
  type: 'spire';
  c: Vec2;
  y: Vec2;
  /** 根元の半径 */
  r: number;
  /** 上の針を赤と白の帯に分ける数（アンテナ） */
  stripes?: number;
}

export interface RingPart {
  type: 'ring';
  c: Vec2;
  r: number;
  y: Vec2;
}

export type Part = BoxPart | TaperPart | AntiprismPart | PyramidPart | SpirePart | RingPart;

export interface Building {
  name: string;
  parts: Part[];
}

export interface Layout {
  /** シリーズ共通の台座（角丸の正方形）：一辺と角の半径 */
  base: { size: number; cornerRadius: number };
  /**
   * 島（ロウアー・マンハッタン）：岸の外形（上から見た多角形 [x, z]）。まわりはすべて水（シリーズの島と同じく台座の縁に触れない）。
   * front / back は手前と奥の岸の z
   */
  island: { outline: Vec2[]; front: number; back: number };
  /** 道路：中心線の折れ線と幅。kind は種類、center は中央線（double = 黄色の二重線、dashed = 破線） */
  roads: { name: string; kind: 'drive' | 'avenue' | 'street'; width: number; center: 'double' | 'dashed' | 'none'; path: Vec2[] }[];
  /** 道路の面（アスファルト）の多角形。橋へ上がる坂道の下も含む */
  roadPolys: Vec2[][];
  /** 交差点（道路どうしが重なる所。中央線と白線を描かない） */
  junctions: Vec2[][];
  /** 歩道の高さの区画（島から道路を除いた所。角を丸めた多角形） */
  blocks: Vec2[][];
  /** 公園（区画の上の芝生）。pond は池（中心と半径）、fort は円い砦（バッテリー・パークのクリントン砦） */
  parks: { name: string; polys: Vec2[][]; pond?: { c: Vec2; r: Vec2 }; fort?: { c: Vec2; r: number } }[];
  /** 横断歩道：中心、渡る道の向き（x / z。縞はその向きに長い）、道の幅、横断歩道の奥行き */
  crosswalks: { c: Vec2; dir: 'x' | 'z'; length: number; depth: number }[];
  buildings: Building[];
  /** 屋上の木の給水タンク：平面の位置、屋上の高さ、大きさの倍率 */
  waterTanks?: { c: Vec2; y: number; s?: number }[];
  /**
   * 橋：路面の中心線 [x, z, 路面の高さ]（坂道の始まり → 海沿いの通りの上 → 岸の橋台 → 主塔 → 台座の縁の切り口）、幅、主塔、
   * 坂道（擁壁で支える区間の z の範囲）、海沿いの通りをまたぐアーチ（z の範囲）、岸の橋台（中心・大きさ・上端の高さ）、川を渡る向き
   */
  bridge: {
    path: [number, number, number][];
    width: number;
    tower: { at: Vec2; top: number; along: number; across: number };
    ramp: { z: Vec2 };
    arch: { z: Vec2 };
    anchorage: { c: Vec2; size: Vec2; top: number };
    spanDir: Vec2;
  };
  /** 桟橋：床 [x0, x1, z0, z1] と高さ、上屋 [x0, x1, z0, z1]、壁の高さと屋根の頂 */
  pier: { deck: [number, number, number, number]; deckY: number; shed: [number, number, number, number]; shedY: Vec2; roofY: number };
  /** フェリー：中心 [x, z]、長さ、幅、向き（度。0 で船首が +z） */
  ferry: { c: Vec2; length: number; width: number; heading: number };
  /** 木 [x, z, 大きさ]（歩道の並木と公園の木。建物や道路に近い物は置くときに除く） */
  trees: [number, number, number][];
  /** 街灯 [x, z] */
  lamps: Vec2[];
  /** 消火栓 [x, z, 放水口の向き（度）] */
  hydrants: [number, number, number][];
  /** ベンチ [x, z, 正面の向き（度。0 で +z）] */
  benches: [number, number, number][];
  /** タクシー [x, z, 進む向きの x, z]（車線の上。右側通行） */
  cars: [number, number, number, number][];
}

/** 島の地面（道路の面）を 0 とした高さ：水面と、川底（x, z はワールド） */
export interface CityLevels {
  water: number;
  bedAt: (x: number, z: number) => number;
}

/** 点が多角形の内側か（偶奇の規則） */
export function insidePolygon(x: number, z: number, pts: Vec2[]): boolean {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, zi] = pts[i];
    const [xj, zj] = pts[j];
    if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}

/** 地面の高さ（道路 0、歩道の区画 curb、公園の芝生 curb + 0.012） */
export function groundHeightAt(layout: Layout, x: number, z: number, curb: number): number {
  for (const p of layout.parks) for (const poly of p.polys) if (insidePolygon(x, z, poly)) return curb + 0.012;
  for (const b of layout.blocks) if (insidePolygon(x, z, b)) return curb;
  return 0;
}

export const layout = data as unknown as Layout;
