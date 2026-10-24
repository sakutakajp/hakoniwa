import { homeCamera, homeFraming } from '../../shared/home-camera';
/**
 * シーンの調整パラメータ一式。
 * 前半（pedestal 〜 renderer）は箱庭シリーズの共通仕様（砂の台座・ニューヨーク・図書館・ジュラ紀の川辺と同じ値）。
 * 後半（town 以降）がこの作品の中身で、位置と長さはワールド座標（台座の一辺が 10）で書いています
 * （中心が 0。x は画面の右、z は画面の手前が正。y は床が 0、土台の上面が 0.255）。
 * 色は sRGB の16進数で指定します（three.js 側でリニアに変換されます）。
 */
export const config = {
  // ===================== シリーズの共通仕様 =====================
  /**
   * 台座。角丸の正方形の路面の塊（アスファルトとコンクリートの塊）と、その下の薄い土台からなる。
   * thickness・色は土台のもの。外形（一辺と角丸）はシリーズの水の塊と同じ
   */
  pedestal: {
    /** 台座の一辺の長さ */
    size: 10,
    /** 土台の厚み（size=10 なら 0.255 で 2.6%） */
    thickness: 0.255,
    /** 平面形状の角丸半径（size=10 なら 1.2 で 12%） */
    cornerRadius: 1.2,
    /** 土台の上縁の丸み */
    topEdgeRadius: 0.07,
    /** 土台の下縁の丸み（接地部にわずかな影の溝ができる） */
    bottomEdgeRadius: 0.03,
    /** 角丸1か所あたりの分割数 */
    cornerSegments: 40,
    /** 縁の丸み1か所あたりの分割数 */
    edgeSegments: 8,
    /** 土台の色（明るい木地のようなゴールドベージュ） */
    sideColor: '#a58c6a',
    /** 土台の粗さ（1に近いほどマット） */
    sideRoughness: 0.42,
    /** 土台の側面の下端で環境光が遮られる割合 */
    sideBottomOcclusion: 0.22,
  },

  /**
   * カメラ（遠近のある固定の視点）。仰角・距離・注視点・画角はシリーズ共通。
   * 方位角は上から見た角度（度）で、0 は台座の手前の辺の正面、90 は右の辺の正面。
   * 通常表示はニューヨークと同じ正面。?refcam=1 の参考画像用カメラは main.ts に保持する
   */
  camera: { ...homeCamera },

  /** 画面内の配置（画面サイズに対する比率）。台座の外形を基準に合わせ、木は上の余白に入る */
  framing: { ...homeFraming },
  /** 元の向きから回したときの余白（どの方位に回しても台座全体が収まる構図） */
  framingOther: {
    paddingX: 0.05,
    paddingXNarrow: 0.06,
    paddingTop: 0.1,
    paddingBottom: 0.08,
    minTop: 0.04,
  },

  /** 見る向きの操作 */
  controls: {
    enabled: true,
    rotateSpeed: 220,
    elevationRange: [8, 88] as [number, number],
    zoomRange: [0.6, 3.5] as [number, number],
    damping: 14,
    inertia: 5,
    blendRange: [35, 18] as [number, number],
    hint: true,
  },

  /**
   * 照明。方位は上から見た角度（度、カメラと同じ基準）：0 = 手前、90 = 右、180 = 奥、-90 = 左。
   * 影はすべて実際の形状から焼き込む。
   */
  lights: {
    /** 主光：右手前の高い所から差す柔らかい日差し */
    key: { color: '#fff5e4', intensity: 3.9, azimuth: 35, elevation: 40, softness: 18 },
    /** 補助光：右奥の高い所からの柔らかい光 */
    fill: { color: '#fff1df', intensity: 1.4, azimuth: 150, elevation: 48, softness: 25 },
    /** 環境光（空側・床側の色で暗部を穏やかに補う） */
    ambient: { skyColor: '#fdf0e2', groundColor: '#f3d6b5', intensity: 0.8, groundBoost: 2.2 },
  },

  shadow: {
    lightSamples: 64,
    aoSamples: 96,
    aoMinElevation: 7,
    strength: 1,
    aoStrength: 1,
    /** 地面の AO の濃さ */
    groundAoStrength: 0.8,
    mapSize: 2048,
    bakeResolution: 1024,
    /** 地面（上面）に焼き込む影テクスチャの解像度 */
    groundBakeResolution: 1024,
    bakeRegion: 3,
  },

  floor: {
    color: '#e2d6cf',
    size: 600,
    gradient: 0.18,
    gradientAzimuth: 45,
    gradientDistance: 14,
    dropShadow: { strength: 0.38, offset: [-0.12, 0.13] as [number, number], blur: 0.075, spread: 0 },
  },

  /** GPU を使えない環境（ソフトウェア描画）向けの軽量設定（形と配置は同じ） */
  lowPower: {
    lightSamples: 28,
    aoSamples: 36,
    bakeResolution: 512,
    groundBakeResolution: 512,
    mapSize: 1024,
    maxPixelRatio: 1,
  },

  renderer: {
    background: '#fae8d4',
    maxPixelRatio: 2,
    exposure: 1,
    highlightKnee: 0.9,
  },

  // ===================== この作品の中身 =====================
/**
   * 路面の塊と通り。地面（車道の路面）の高さ ground、歩道の高さは ground + curb。
   * 通りは参考画像から読み取った 2 本の縁石の線（左の通りと右の通り。手前で角を作る）で分ける。
   * 線は「点 point を通り、向き dir（上から見た角度、度。+x から +z へ）へ伸びる直線」で書き、
   * 縁石の線より奥が歩道（建物の街区）、手前が車道
   */
  town: {
    /** 車道の路面の高さ（床から）。土台の上面 0.255 から上が路面の塊 */
    ground: 1.3,
    /** 歩道の段差（縁石の高さ） */
    curb: 0.05,
    /** 縁石の上の縁の丸み・縁石の幅（白っぽい石の帯） */
    curbStone: { radius: 0.012, width: 0.05, color: '#b9b2aa' },
    /** 路面の塊の側面（灰色のアスファルトとコンクリートの塊）の色と、上の縁の丸み */
    slab: { color: '#504a4f', light: '#6c666b', dark: '#363236', edgeRadius: 0.03 },
    /** 左の通りの縁石（左の街区の前）と、右の通りの縁石（右の街区の前）。角の丸みの半径 */
    curbLeft: { point: [0, 2.89] as [number, number], dir: 31.46 },
    curbRight: { point: [0, 3.8] as [number, number], dir: -25.64 },
    cornerRadius: 0.3,
    /**
     * 車道の白線（両方の通りで同じ）：中央の破線（車道の幅のちょうど真ん中）、両側の外側線（縁石から edge）、
     * 交差点の手前の停止線。破線の長さと間隔、線の幅
     */
    lanes: {
      dash: [0.36, 0.3] as [number, number],
      width: 0.045,
      edge: 0.25,
      stop: 0.07,
      color: '#e9e6dc',
    },
    /** 横断歩道：右の通りを角の近くで渡る。右の縁石に沿った中心の位置 s、渡る幅、縞の幅 */
    crosswalk: { s: 1.9, width: 0.8, stripe: 0.09 },
    /** 路面：アスファルトの色、濡れた所（水たまり）の量と大きさ、映り込みの強さ、雨の波紋 */
    road: {
      /** 車道の幅（左右の通りとも、縁石から向かいの縁石まで一定。2 車線と路側帯） */
      width: 2.3,
      color: '#2a2e38',
      light: '#444a58',
      puddles: { amount: 0.8, size: 0.9 },
      reflection: { strength: 1.0, wetRoughness: 0.12, dryRoughness: 0.32, streak: 0.06 },
      ripple: { strength: 0.5, size: 0.16 },
    },
    /** 歩道の石畳：色、目地、敷石の大きさ、濡れ方 */
    paving: { color: '#b9a690', light: '#c8b59e', dark: '#a4917c', joint: '#857262', size: [0.1, 0.1] as [number, number], wet: 0.4 },
    /** 台座の上面の縁の、明るい石の縁取り（幅と色） */
    rim: { width: 0.045, color: '#a9a49d' },
    /** 歩道の幅（左の通り・右の通り。建物の前面はこの線にそろえる） */
    sidewalk: { left: 0.95, right: 0.7 },
    /**
     * 路地（交差点の広場から奥へまっすぐ延びる歩行者の通り）：始まりの点、向き（度）、幅、突き当たりまでの長さ。
     * 突き当たりの建物は路地に面する
     */
    alley: { origin: [0.22, 1.3] as [number, number], dir: -88.28, width: 0.9, length: 5.2 },
    /**
     * 裏路地（街区の奥の建物の入口へ通じる細い道）：通り（L・R）に沿った枠での位置。
     * d は縁石からの奥行き、s は通りに沿った範囲、width は幅
     */
    backLanes: [
      { frame: 'L' as const, d: 2.66, s: [-9, -5.25] as [number, number], width: 0.55 },
      { frame: 'R' as const, d: 4.97, s: [2.4, 9] as [number, number], width: 0.55 },
    ],
    /**
     * 夕方の色調（街の物だけ）：日差しに掛ける色と、空からの光に掛ける色（リニアの倍率）。
     * 参考画像の「日の当たる面は橙、日陰の面は青みの灰色」を、シリーズの光の向きと強さのまま出す
     */
    tint: { sun: [1.5, 0.9, 0.52], shade: [0.95, 1.08, 2.45] },
    /** 建物の階の高さ（1 階・上の階）、窓の並びの間隔、窓の明かりがついている割合 */
    buildings: { ground: 0.66, floor: 0.6, bay: 0.5, lit: 0.92 },
    /**
     * 外壁の仕上げの色（タイル・ガラス・金属パネル・コンクリート・屋上）と、窓と店先の明かり。
     * 窓の奥の部屋と店の売り場は、明かりの色 × 強さで光る（光のにじみの元になる）
     */
    facade: {
      colors: {
        tileBeige: '#8f8173',
        tileGray: '#787673',
        tileWarm: '#978370',
        tileDark: '#5f5c5e',
        glass: '#4a4c54',
        blue: '#6c789c',
        concrete: '#8a8682',
        maroon: '#6a2430',
        red: '#a02a36',
        roof: '#545052',
        cap: '#8f8a86',
        tileWhite: '#b3aea8',
      },
      /** 壁の AO の濃さ */
      aoStrength: 0.85,
      /** 窓の部屋と店先の明るさ（リニア） */
      windowGlow: 1.8,
      shopGlow: 1.45,
      interiorWarm: '#ffad5c',
      interiorCool: '#f4ead8',
      /** 窓ガラスに映る空の色 */
      glassSky: '#d9c7b6',
      /** 街の明かりが壁を照らす強さ */
      localLightOnWalls: 1.6,
    },
    /** 街の明かりの地図（上から見た範囲の一辺） */
    localLight: { size: 10.4 },
    /** 濡れた路面の映り込みを描く解像度（画面に対する倍率） */
    reflection: { scale: 0.5, lowPowerScale: 0.35, sky: [0.035, 0.042, 0.068] as [number, number, number] },
    /** 光のにじみ：強さ、にじみ始める明るさ（リニア）となめらかさ、広がり、縮小の段数 */
    bloom: { strength: 0.28, threshold: 1.3, knee: 0.5, radius: 0.85, levels: 5 },
  },
};

export type SceneConfig = typeof config;
