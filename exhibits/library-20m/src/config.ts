/**
 * 図書館の箱庭の調整用パラメータ。長さはワールド単位（台座の幅 10）。
 * 前半はシリーズ（淡い砂の角丸ミニチュア台座・ニューヨークの箱庭）と同じ値：台座の土台・床・光・影・仕上げ・画面。
 * 後半は図書館の中身：大理石の台・壁・回廊・階段・本棚・家具・窓の日差し・灯り。
 *
 * 座標：x は右、z は手前（カメラの側）が正、y は上。床（台座を置く面）が y = 0。
 * 参考画像のカメラ（方位 22°・仰角 22.8°）に合わせた位置は、画像の点を床・回廊の床・壁の面へ逆投影して決めた
 * （台座を一辺 10 の正方形にしたので、奥行きの位置は参考画像の奥行き 8.4 から 10 へ広げてある）。
 */
export const config = {
  // ================= シリーズ共通 =================
  /** 台座の土台（明るい木地の薄い板）。外形は room.base（角丸の長方形）と同じ */
  pedestal: {
    thickness: 0.255,
    topEdgeRadius: 0.05,
    bottomEdgeRadius: 0.03,
    cornerSegments: 40,
    edgeSegments: 8,
    sideColor: '#a58c6a',
    sideRoughness: 0.42,
    sideBottomOcclusion: 0.22,
  },

  /**
   * 光（シリーズと同じ）。方位は上から見た角度（度）：0 = 手前、90 = 右、180 = 奥、-90 = 左。
   * 主光：右手前の高い所から差す柔らかい日差し。補助光：右奥の高い所からの柔らかい光。環境光は空側・床側の色で暗部を補う。
   * 窓の日差し（sun）は図書館だけの追加：奥の少し右からの日が奥の窓から手前へ差し込み、長机と椅子・敷物・肘掛け椅子に窓の形の光を落とす
   * （部屋の上と開いた右に見えない覆いを置いて焼き込むので、窓を通った光だけが部屋に入る）
   */
  lights: {
    key: { color: '#fff5e4', intensity: 3.9, azimuth: 35, elevation: 40, softness: 18 },
    fill: { color: '#fff1df', intensity: 1.4, azimuth: 150, elevation: 48, softness: 25 },
    ambient: { skyColor: '#fdf0e2', groundColor: '#f3d6b5', intensity: 0.8, groundBoost: 2.2 },
    sun: { color: '#ffb466', intensity: 22, azimuth: 172, elevation: 33, softness: 0.35 },
    /**
     * 部屋の中の光の効き（主光・補助光・空の光の倍率）。開いた手前と右から入る主光を部屋の中だけ弱め、
     * 窓の日差しとランプの灯りが際立つようにする（参考画像の部屋の中の落ち着いた明るさ）。壁の外・台・床はシリーズのまま
     */
    interior: { key: 0.92, fill: 0.95, ambient: 1.1, tint: [1.06, 0.99, 0.88] as [number, number, number] },
    /**
     * 真鍮・金箔・ニス・磨いた石の映り込みに使う部屋の環境（拡散光には使わない）：開いた手前と右・上は明るい外、
     * 奥と左は暗い木の本棚、奥の高い所に明るい窓、下は寄木の床
     */
    reflection: { open: '#fbecd6', wood: '#2c180c', floor: '#7a4c26', window: '#fff2d8', top: '#f3dfc2', intensity: 0.95 },
  },

  /** 影と空からの遮蔽の焼き込み */
  shadow: {
    lightSamples: 40,
    sunSamples: 24,
    aoSamples: 64,
    aoMinElevation: 7,
    strength: 1,
    aoStrength: 1,
    mapSize: 2048,
    bakeResolution: 1024,
    roomBakeResolution: 1024,
    bakeRegion: 3,
  },

  /** 床（シリーズと同じ暖かい淡いベージュ） */
  floor: {
    color: '#e2d6cf',
    size: 600,
    gradient: 0.18,
    gradientAzimuth: 45,
    gradientDistance: 14,
    dropShadow: { strength: 0.38, offset: [-0.12, 0.13] as [number, number], blur: 0.075, spread: 0 },
  },

  /** GPU を使えない環境（ソフトウェア描画）での軽い設定 */
  lowPower: {
    lightSamples: 14,
    sunSamples: 10,
    aoSamples: 22,
    mapSize: 1024,
    bakeResolution: 512,
    roomBakeResolution: 512,
    maxPixelRatio: 1,
  },

  renderer: {
    background: '#fae8d4',
    maxPixelRatio: 2,
    exposure: 1,
    highlightKnee: 0.9,
    grade: { saturation: 1, darkSaturation: 0 },
  },

  /**
   * カメラ：仰角・画角・距離はシリーズと同じ。方位は参考画像に合わせて右手前から（22°）。
   * targetHeight は注視点の高さ（台の上面からの高さ、台座の幅に対する比率）
   */
  camera: {
    azimuth: 22,
    elevation: 22.8,
    distance: 4.86,
    targetHeight: 0.22,
    fov: 13.44,
  },
  /** 元の向きの構図（参考画像の余白：左右 5%、上 8%、下 12%） */
  framing: {
    paddingX: 0.047,
    paddingXNarrow: 0.05,
    paddingTop: 0.08,
    paddingBottom: 0.12,
    minTop: 0.04,
  },
  framingOther: {
    paddingX: 0.05,
    paddingXNarrow: 0.06,
    paddingTop: 0.07,
    paddingBottom: 0.08,
    minTop: 0.04,
  },
  controls: {
    enabled: true,
    rotateSpeed: 220,
    elevationRange: [8, 88] as [number, number],
    zoomRange: [0.6, 4] as [number, number],
    damping: 14,
    inertia: 5,
    blendRange: [35, 18] as [number, number],
    hint: true,
  },

  // ================= 図書館 =================
  /**
   * 手本にした歴史ある図書館：オックスフォードのコドリントン図書館（奥の壁の大きなセルリアーナの窓・2 段の本棚と回廊・
   * 斜めに張った 2 色の石の床と黒い縁）、ケンブリッジのレン図書館（本棚の上の高いアーチの窓・明るい石の壁・白黒の大理石の床）、
   * ダブリンのロング・ルーム（回廊の下の金文字の帯）、アムステルダムのカイパース図書館やカオールの図書館（回廊へ上るらせん階段）。
   * 壁は奥と左だけ（手前と右は開いた切り取り）。1 階は両方の壁に本棚、2 階は左の壁に本棚、奥の壁に窓
   */
  room: {
    /** 台座の外形：シリーズ（砂の台座）と同じ一辺 10 の正方形、四隅とも半径 1.2 */
    base: { width: 10, depth: 10, radius: { frontRight: 1.2, frontLeft: 1.2, backLeft: 1.2, backRight: 1.2 } },
    /** 大理石の台：上の縁の高さ、縁の幅、床（大理石の敷石）の高さ */
    slab: { top: 1.04, rimWidth: 0.2, floorY: 0.98 },
    /** 壁：台の縁からの下げ幅と厚み、上端の高さ（左と奥の壁は同じ高さ）。左の壁は手前の角の丸みの始まり、奥の壁は右の角の丸みの始まりで終わる */
    wall: { inset: 0.04, thickness: 0.3, top: 6.4, leftEnd: 3.8, backEnd: 3.8 },
    /** 笠石（壁の上の明るい石）：張り出し、厚み、継ぎ目の間隔 */
    coping: { overhang: 0.045, height: 0.14, joint: 0.95 },
    /** 壁の端の柱（左の壁の手前の端と、奥の壁の右の端）：部屋の側への出、外側への出 */
    pier: { projection: 0.15, outer: 0.02 },
    /** 回廊：床の上面の高さ、床板の厚み、壁からの奥行き、鼻隠し（金文字の帯）の高さ、手すりの高さ（床から） */
    gallery: { y: 3.48, deck: 0.1, depth: 1.0, fascia: 0.34, railHeight: 0.55, postSpacing: 1.06, balusterSpacing: 0.0625 },
    /**
     * 奥の上の窓：まん中のセルリアーナ（中央のアーチの窓と両脇の四角い窓、間に細い柱）と、その両脇のアーチの窓。
     * center は窓の並びの中心の x、spacing は中心からアーチの窓までの距離。高さは窓台・アーチの始まり（セルリアーナの横木）
     */
    windows: {
      center: -0.25,
      spacing: 2.45,
      sill: 4.05,
      spring: 5.3,
      arched: { width: 0.86, top: 5.74 },
      serliana: { width: 1.1, top: 5.86, side: 0.44, mullion: 0.16 },
    },
    /** 1 階の本棚（両方の壁）：奥行き、柱形の幅、下の戸棚の高さ、棚の段の数 */
    lowerCases: { depth: 0.225, pilaster: 0.16, cupboard: 0.2, shelves: 11 },
    /** 2 階の本棚（左の壁）：奥行き、上端の高さ、棚の段の数 */
    upperCases: { depth: 0.16, top: 5.8, shelves: 14 },
    /** 壁の上の軒の刳り形（部屋の側）：下端の高さ */
    entablature: { bottom: 6.0 },
    /**
     * らせん階段（奥の右。回廊へ上る）：中心（上から見た x, z）、外の半径、蹴上げの数、
     * いちばん上の段の終わりの向き（度。+z から +x へ）と、回廊の高さの踊り場の段の角度
     */
    spiral: { center: [2.75, -2.86] as [number, number], radius: 0.8, risers: 32, step: 240 / 31, endAngle: 160, landing: 44 },
  },

  /** 色（参考画像を測った色を、シリーズの光で近くなるように調整した地の色） */
  colors: {
    marble: '#e4d1b7',
    marbleJoint: '#cdb69c',
    rim: '#fcf3e3',
    stone: '#f1dcb8',
    /** 壁の外側と柱の石（大理石に近い明るいクリーム） */
    ashlar: '#efe3d1',
    ashlarJoint: '#cbb59a',
    stoneJoint: '#cdae88',
    coping: '#f5e6d0',
    /** 木：明るく色の抜けた古材（使い込んで色あせたオーク・胡桃の色）。角のすれ・つやの鈍さはシェーダーで */
    wood: '#b8875a',
    woodDark: '#8a6440',
    woodLight: '#cfa477',
    woodPanel: '#b0805a',
    stairWood: '#c3955f',
    deck: '#bf9061',
    parquet: '#ddb47c',
    parquetDark: '#c79c66',
    /** 真鍮（金属の映り込みの色。物理ベースの真鍮 F0 ≈ 線形 (0.91, 0.78, 0.42) より少し濃い金色） */
    brass: '#e3ad55',
    lampGreen: '#1d6a3f',
    lampYellow: '#ffd27a',
    leather: '#545428',
    leatherDark: '#383918',
    paper: '#f4ead2',
    bust: '#f2ece2',
    pot: '#9a5a38',
    leaf: '#46703a',
    leafLight: '#6f9548',
    glassTop: '#eaeeec',
    glassBottom: '#f5e5c8',
    windowFrame: '#f1e2c8',
    rugField: '#a6452c',
    rugBorder: '#222d52',
    rugAccent: '#c99a52',
  },

  /**
   * 本の背の色（参考画像の棚：濃い赤・緑・紺・茶・黄土・えんじ・オリーブに、青緑・灰青・生成り・黄褐色の明るい本が混じる）と、
   * 箔押しの金色（金箔の F0 ≈ 線形 (1.0, 0.77, 0.34) に近い色）
   */
  books: {
    palette: [
      '#6e1c1a', '#2e4426', '#263457', '#5a3014', '#8a5a22', '#5a1824', '#4c5022', '#7e3416', '#2a3c48', '#664a2e', '#7a2a1c', '#94401e', '#3e2a1c', '#a0703a',
      '#35605a', '#4d5f74', '#c2ad86', '#9c7a4c', '#2f4f3a', '#8c2f2a',
    ],
    gold: '#f2cf7f',
    /** 棚の奥行きに対する本の奥行き、高さの範囲（棚の内寸に対する割合）、厚みの範囲 */
    depth: [0.62, 0.86] as [number, number],
    height: [0.7, 0.93] as [number, number],
    thickness: [0.014, 0.03] as [number, number],
    /** 傾いた本の割合と、棚の途中の空きの割合（空きの次の本は傾ける） */
    leanChance: 0.04,
    gapChance: 0.06,
    seed: 7,
  },

  /**
   * 部屋の床：斜めに張った 2 色の大理石（クリームのボッティチーノと灰色のバルディリオ）と、開いた縁に沿う濃い石の帯（コドリントン図書館の床）。
   * tile は敷石の一辺、border は縁からの [淡い石の余白, 濃い帯, 淡い細線, 濃い細線] の幅
   */
  marbleFloor: {
    tile: 0.3,
    light: '#ebe1d1',
    dark: '#bfb2a1',
    band: '#806d5d',
    border: [0.06, 0.17, 0.035, 0.022] as [number, number, number, number],
    joint: 0.0011,
    roughness: 0.26,
    /** 床の手前のまん中の象嵌の星（方位の星）：中心（x, z）、半径、色（長い光の陰の半分と中心・斜めの光・小さな光） */
    rose: { center: [-0.25, 3.42] as [number, number], radius: 0.7, colors: ['#5f5047', '#c49a5a', '#b5aa9d'] as [string, string, string] },
  },

  /** 箱（棚板・框・柱形・手すり・石の角など）の辺の丸みの幅。辺が光を受けて細い明るい線になる */
  bevel: 0.012,

  /** 窓から差し込む日差しの筋（光の柱の見せかけ）：色、1 枚の板の濃さ、窓からの長さ */
  sunbeams: { color: '#ffd9a8', opacity: 0.2, length: 9 },

  /** 回廊の鼻隠しの金文字（区画ごとの学問の名。ロング・ルームの回廊の下の金文字の帯のように） */
  inscription: {
    left: ['THEOLOGIA', 'PHILOSOPHIA', 'HISTORIA', 'IVRA', 'MEDICINA', 'POESIS'],
    back: ['GRAMMATICA', 'MATHEMATICA', 'ASTRONOMIA', 'GEOGRAPHIA', 'MVSICA'],
    gold: '#e9c06a',
  },

  /** 灯り（机のランプ・壁の燭台）：光の届く距離と強さ（影は付けず、狭いすき間ほど弱める） */
  lamps: { tableRange: 1.6, tableIntensity: 1.25, sconceRange: 1.2, sconceIntensity: 0.9 },
};

export type SceneConfig = typeof config;
