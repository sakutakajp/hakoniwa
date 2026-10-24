import { homeCamera, homeFraming } from '../../shared/home-camera';
import type { FacadeStyle } from './materials';

/**
 * ニューヨークの箱庭の調整用パラメータ。長さはワールド単位（台座の一辺 10）。
 * 台座・砂・水・床・光・カメラ・仕上げは、シリーズ（淡い砂の角丸ミニチュア台座）と同じ値。
 * 建物・道路・橋などの位置と大きさは layout.json（tools/design_layout.py で作る）。
 */
export const config = {
  // ================= シリーズ共通（淡い砂の角丸ミニチュア台座と同じ） =================
  /**
   * 台座。透明な水の塊（厚みは sea.depth）と、その下の薄い土台からなる。
   * thickness・色は土台のもの。外形（一辺と角丸）は水の塊と土台で共通
   */
  pedestal: {
    size: 10,
    thickness: 0.255,
    cornerRadius: 1.2,
    topEdgeRadius: 0.07,
    bottomEdgeRadius: 0.03,
    cornerSegments: 40,
    edgeSegments: 8,
    /** 土台の色（明るい木地のようなゴールドベージュ） */
    sideColor: '#a58c6a',
    sideRoughness: 0.42,
    sideBottomOcclusion: 0.22,
  },

  /** 砂（川底）の模様 */
  sand: {
    color: '#f6e6c6',
    shadeColor: '#dcc29a',
    highlightColor: '#fff8ea',
    textureSize: 2048,
    seed: 11,
    roughness: 1,
    normalStrength: 0.8,
    ripple: { wavelength: 0.42, amplitude: 0.012, angle: 20, warp: 1.1, warpScale: 0.18, bend: 1.6, crestSharpness: 0.45, forkiness: 0.8 },
    grain: { cellSize: 0.08, cellStretch: 1.6, ridgeWidth: 0.34, ridgeHeight: 0.003, pitDensity: 0.1, pitDepth: 0.006, microHeight: 0.001 },
  },

  /** 水の塊（川と湾）。描き方・色・透明度はシリーズと同じ（違うのは、岸の泡を砂浜より控えめにすることと、フェリーの航跡） */
  sea: {
    enabled: true,
    /** 水の塊の厚み（土台の上面から水面まで。台座の一辺に対する比率） */
    depth: 0.218,
    /** 川底の砂の層の厚み（側面の下に見える砂の帯） */
    sandLayer: 0.012,
    /** 深い所（川の中ほど）で見かけの水深を足す量（比率） */
    deep: { extraDepth: 0.45 },
    colors: { shallow: '#a9eee6', mid: '#03aeb2', deep: '#06507f' },
    colorDepths: [0.06, 0.45] as [number, number],
    clarity: 0.25,
    absorption: [9, 0.66, 0.52] as [number, number, number],
    wallClarity: 0.23,
    wallClear: 0.1,
    wallHaze: 0.06,
    wallTint: '#e9ecd9',
    seabedShadow: 0.5,
    waves: {
      height: 0.0012,
      length: 0.12,
      speed: 1,
      ripple: 0.45,
      rippleSize: 0.012,
      sheen: 3,
      wavelets: { strength: 0.55, tile: 0.22, wavelength: [0.007, 0.03] as [number, number], angle: 8, spread: 28, count: 140, speed: 1 },
    },
    /** 白い泡：岸（護岸・砂浜・杭）からの幅、量、速さ、網目の大きさ。護岸の泡は砂浜より控えめ */
    foam: { width: 0.028, amount: 0.75, speed: 1, cell: 0.011 },
    caustics: { strength: 1.7, size: 0.045, speed: 1, fadeDepth: 0.3 },
    reflection: { strength: 1.25, horizon: '#8cc4dc', zenith: '#6aaed0', glint: 1 },
    wallReflection: 0.25,
    refraction: 0.6,
    wallGradient: {
      topColor: '#06a6c0',
      topColorDeep: '#052451',
      path: [0.25, 0.42] as [number, number],
      range: [0.12, 0.85] as [number, number],
      rangeDeep: [0.3, 1.05] as [number, number],
      unevenness: 0.3,
      noiseSize: 0.06,
      strength: 1,
      near: [0, 0.3] as [number, number],
      base: 0.08,
      deepFloor: 0.02,
    },
    rim: { width: 0.006, strength: 0.55 },
    floorShadow: 0.3,
    skirt: { sand: '#efe0bf' },
    /** フェリーの航跡と船首の白波（強さ、航跡の長さ、広がり） */
    wake: { strength: 1, length: 2.6, spread: 0.36 },
    fps: 30,
    lowPowerFps: 2,
    msaa: 4,
  },

  /**
   * 川底の形（ワールド単位）：護岸の足もとの水深、そこから深い所までの距離、深い所とみなし始める距離・終わる距離、
   * ゆるやかな起伏、乱数シード。
   * deepFront：手前の縁（カメラの側）に近い所は、深い所らしさ（色と見通しだけの見かけの水深）を弱める（z の範囲と弱める割合）。
   * 手前のガラス越しの水が濃紺になりすぎず、シリーズの海のように青緑から濃い青へ移る
   */
  river: {
    shoreDepth: 1.15,
    slopeLength: 1.1,
    deepRange: [0.5, 2.6] as [number, number],
    deepFront: [3.2, 5.0, 0.55] as [number, number, number],
    undulation: 0.05,
    seed: 5,
  },

  // ================= ニューヨークの島 =================
  /**
   * 島：地面（道路の面）の水面からの高さ、護岸の石（水の上・水の中・藻）。
   * section は島が台座の縁に届く配置のときの切り口の地層（いまの配置は島のまわりがすべて水なので使わない）
   */
  island: {
    groundHeight: 0.12,
    seawall: '#d3c4ae',
    seawallTop: '#e8dccb',
    underwater: '#a39a86',
    algae: '#7f9460',
    section: { asphalt: '#5d5f72', soil: '#7b5b42', fill: '#a5876a', rock: '#8d8f95', rockDark: '#6f7279' },
  },

  /** 地面（道路・歩道・公園）の色と、区画の歩道の高さ */
  ground: {
    asphalt: '#5d5f72',
    asphaltWarm: '#6a6672',
    sidewalk: '#efe0d3',
    curb: '#dccbbd',
    crosswalk: '#f4f2ee',
    lineYellow: '#f2c230',
    lineWhite: '#eeeeea',
    grass: '#7fbf2a',
    grassLight: '#a7d13a',
    path: '#efcfc1',
    pond: '#5fb4ea',
    pondEdge: '#ecdcd0',
    plaza: '#ece6e0',
    /** 岸の縁の笠石（遊歩道の水際の明るい石の帯） */
    coping: '#f3ece2',
    /** 区画（歩道）の高さ */
    curbHeight: 0.022,
    /** 地面のテクスチャの細かさ（1 単位あたりの画素） */
    texelsPerUnit: 160,
  },

  /** 建物の形の細部 */
  buildings: {
    /** 縦の角の面取りの幅（光を受けて角に明るい線ができる。画面で 1〜2 画素になる幅） */
    bevel: 0.022,
    /** 面取りの面を外壁の色からどれだけ白に寄せるか（0〜1） */
    bevelLighten: 0.14,
    /** 外壁の高さのグラデーション：地面の近くの明るさの倍率と、そこから明るさが戻る高さ */
    groundShade: 0.84,
    groundShadeHeight: 1.3,
    /** 高い所ほどわずかに明るく（空に近い所） */
    topLift: 0.06,
    /** 焼き込んだ空の遮蔽（AO）を、日の当たる面の明るさにもどれだけ掛けるか（すき間を暗く） */
    aoOnDirect: 0.35,
    /** ガラスの映り込みの強め方（1 + glassBoost 倍。日なた側の明るい床と、影の側の濃い空色の床が映る） */
    glassBoost: 2.4,
    /** 屋上の手すり壁の上面を白に寄せる割合（様式ごとに parapet で変えられる） */
    parapetLighten: 0.35,
  },

  /** 外壁の様式（buildings の style で指定） */
  facades: {
    // エンパイア・ステート・ビル：明るいベージュの石と、縦に並ぶ細い窓の帯
    deco: { kind: 2, bay: 0.095, floor: 0.075, winW: 0.34, winH: 0.74, window: '#8d6a5c', frame: '#fde9d2', ground: 0, glass: 0.25, variation: 0.14, margin: 0.035, cornice: 0.018, grade: 1, parapet: 0.08, roofColor: '#efd2b4' },
    decoBase: { kind: 2, bay: 0.1, floor: 0.085, winW: 0.34, winH: 0.7, window: '#8d6a5c', frame: '#fde9d2', ground: 0.16, glass: 0.25, variation: 0.14, margin: 0.04, cornice: 0.022, grade: 1, parapet: 0.08, roofColor: '#efd2b4' },
    decoCrown: { kind: 2, bay: 0.045, floor: 0.12, winW: 0.45, winH: 0.8, window: '#6f7b8a', frame: '#f2f0ee', ground: 0, glass: 0.35, variation: 0.1, margin: 0.008, cornice: 0.0, grade: 1 },
    // ワン・ワールド・トレード・センター：空を映す青いガラス
    glass: { kind: 3, bay: 0.06, floor: 0.11, winW: 1, winH: 1, window: '#9ccbfb', frame: '#e8f2fb', ground: 0, glass: 1, variation: 0.08, margin: 0, cornice: 0, grade: 1 },
    podium: { kind: 5, bay: 0.12, floor: 0.32, winW: 0.08, winH: 0.75, window: '#bcd3e6', frame: '#f4f1ec', ground: 0, glass: 0.5, variation: 0.05, margin: 0.03, cornice: 0.03, grade: 1 },
    // ボザール様式の塔（明るい石、上は銅の緑の屋根）
    beaux: { kind: 1, bay: 0.08, floor: 0.105, winW: 0.52, winH: 0.58, window: '#5f6f8c', frame: '#fbf3ea', ground: 0.16, glass: 0.4, variation: 0.2, margin: 0.04, cornice: 0.025, grade: 1 },
    // 赤れんが（白い窓枠）
    brick: { kind: 1, bay: 0.12, floor: 0.135, winW: 0.55, winH: 0.6, window: '#7fb3dc', frame: '#f7f1e8', ground: 0.17, glass: 0.45, variation: 0.15, margin: 0.035, cornice: 0.03, grade: 1 },
    // ベージュの塔（細かい窓）
    tan: { kind: 1, bay: 0.07, floor: 0.09, winW: 0.52, winH: 0.56, window: '#5f6c84', frame: '#f6ead8', ground: 0.12, glass: 0.35, variation: 0.2, margin: 0.035, cornice: 0.02, grade: 1 },
    tanbrick: { kind: 1, bay: 0.085, floor: 0.105, winW: 0.52, winH: 0.56, window: '#62738f', frame: '#f4e8da', ground: 0.12, glass: 0.35, variation: 0.2, margin: 0.035, cornice: 0.02, grade: 1 },
    // 明るい灰色の塔
    gray: { kind: 1, bay: 0.072, floor: 0.092, winW: 0.56, winH: 0.56, window: '#54688a', frame: '#f6f6f6', ground: 0.12, glass: 0.4, variation: 0.18, margin: 0.035, cornice: 0.02, grade: 1 },
    // 青いガラスと白い帯の箱形の塔
    blueglass: { kind: 4, bay: 0.085, floor: 0.105, winW: 0.1, winH: 0.24, window: '#35598d', frame: '#eef1f5', ground: 0.14, glass: 0.9, variation: 0.12, margin: 0, cornice: 0.03, grade: 1 },
    // 屋上の小屋（塔屋）・設備
    roofbox: { kind: 0, bay: 1, floor: 1, winW: 0, winH: 0, window: '#888888', frame: '#e8e8e8', ground: 0, glass: 0, variation: 0, margin: 0, cornice: 0 },
    roof: { kind: 0, bay: 1, floor: 1, winW: 0, winH: 0, window: '#888888', frame: '#dddddd', ground: 0, glass: 0, variation: 0, margin: 0, cornice: 0 },
    copper: { kind: 0, bay: 1, floor: 1, winW: 0, winH: 0, window: '#888888', frame: '#dddddd', ground: 0, glass: 0, variation: 0, margin: 0, cornice: 0, grade: 1 },
    metal: { kind: 0, bay: 1, floor: 1, winW: 0, winH: 0, window: '#888888', frame: '#dddddd', ground: 0, glass: 0.3, variation: 0, margin: 0, cornice: 0 },
    // 橋の石の塔
    stone: { kind: 6, bay: 0.14, floor: 0.07, winW: 0, winH: 0, window: '#888888', frame: '#d6b08a', ground: 0, glass: 0, variation: 0.05, margin: 0, cornice: 0, grade: 1 },
    // 桟橋の上屋（淡い青のガラスと紺の枠）
    shed: { kind: 5, bay: 0.15, floor: 0.3, winW: 0.07, winH: 0.8, window: '#8fb9dc', frame: '#3d5c7c', ground: 0, glass: 0.7, variation: 0.08, margin: 0, cornice: 0 },
    // 橋の路面の下の格子（トラス）と手すり（部材のない所は抜く）
    truss: { kind: 7, bay: 0.13, floor: 1, winW: 0.075, winH: 0, window: '#888888', frame: '#888888', ground: 0, glass: 0, variation: 0, margin: 0, cornice: 0 },
    railing: { kind: 8, bay: 0.045, floor: 1, winW: 0.22, winH: 0, window: '#888888', frame: '#888888', ground: 0.006, glass: 0, variation: 0, margin: 0, cornice: 0.01 },
    // 桟橋と遊歩道の板張り（石積みの模様を細長くしたもの）
    plank: { kind: 6, bay: 0.42, floor: 0.034, winW: 0, winH: 0, window: '#888888', frame: '#7d6e66', ground: 0, glass: 0, variation: 0.07, margin: 0, cornice: 0 },
    // 屋上の木の給水タンク（縦の板と鉄の輪）
    tank: { kind: 9, bay: 0.024, floor: 0.04, winW: 0, winH: 0, window: '#888888', frame: '#4a3328', ground: 0, glass: 0, variation: 0.1, margin: 0, cornice: 0 },
    // フェリーの客室の窓と操舵室
    ferryWin: { kind: 1, bay: 0.075, floor: 0.16, winW: 0.8, winH: 0.5, window: '#1b2640', frame: '#f7f8fa', ground: 0, glass: 0.75, variation: 0.06, margin: 0.05, cornice: 0 },
    wheelhouse: { kind: 1, bay: 0.09, floor: 0.09, winW: 0.84, winH: 0.6, window: '#18223a', frame: '#f7f8fa', ground: 0, glass: 0.8, variation: 0.05, margin: 0.02, cornice: 0 },
  } as Record<string, FacadeStyle>,

  /** 外壁の色（建物ごと。layout の style の名前で決まる地の色） */
  wallColors: {
    deco: '#ffdcb8',
    decoBase: '#ffdcb8',
    decoCrown: '#dfe3e8',
    glass: '#9cc4ee',
    podium: '#f5f1ea',
    beaux: '#efe2d6',
    brick: '#cf6a43',
    tan: '#efd6b5',
    tanbrick: '#d99a74',
    gray: '#e3e3e6',
    blueglass: '#3f6c9e',
    roofbox: '#ecebe9',
    roof: '#ddd5ce',
    copper: '#62c2b2',
    metal: '#d9dde2',
    stone: '#fde7ca',
    shed: '#9cc7e8',
    truss: '#d59d70',
    railing: '#e6b98f',
    plank: '#a8968a',
    ferryWin: '#f7f8fa',
    wheelhouse: '#f7f8fa',
    tank: '#b07a52',
  } as Record<string, string>,

  /** 橋（石の主塔の色は wallColors.stone、トラスと手すりは wallColors.truss / railing） */
  bridge: {
    deck: '#7c7882',
    walk: '#dcc2a2',
    girder: '#c99f7b',
    cable: '#d7a174',
    /** 主塔の上の旗竿 */
    pole: '#eeeeee',
  },

  /** 桟橋：床の板（wallColors.plank）、杭、上屋の屋根 */
  pier: {
    piling: '#a87866',
    pilingDark: '#6f4f45',
    roof: '#a9c8e6',
    roofRidge: '#dbe8f5',
    roofEdge: '#eef4fa',
    /** 遊歩道の下の護岸（紺色の板） */
    seawall: '#22406f',
  },

  /** フェリー */
  ferry: {
    hull: '#2d62d4',
    hullDark: '#1d3f86',
    stripe: '#e34a30',
    white: '#f7f8fa',
    deck: '#e6e9ee',
    light: '#ff5a3c',
  },

  /** タクシー */
  cars: {
    body: '#f7b917',
    glass: '#263248',
    tire: '#2b2a30',
    sign: '#fff6d8',
    headlight: '#fffbe8',
    taillight: '#d8342a',
  },

  /** 公園の街灯と、ベンチ・消火栓 */
  lamps: { pole: '#3d4f46', globe: '#fffaf0' },
  props: { bench: '#6b4f3c', benchLeg: '#3d4148', hydrant: '#d8392b', hydrantCap: '#f1c232' },

  /**
   * 木：縁の明るさ（ふんわりした輪郭）、日差しの反対側に透ける光の強さ、
   * 葉の房の大きさ（ワールド座標）・ふくらみの強さ・房の境目の暗さ、樹冠の下側で空の光を減らす割合
   */
  trees: { rim: 0.3, translucency: 0.15, clumpSize: 0.085, clumpBump: 0.9, clumpCavity: 0.36, underShade: 0.5 },

  /**
   * 光（シリーズと同じ）。方位は上から見た角度（度）：0 = 手前、90 = 右、180 = 奥、-90 = 左。
   * 主光：右手前の高い所から差す柔らかい日差し。補助光：右奥の高い所からの柔らかい光。環境光は空側・床側の色で暗部を補う
   */
  lights: {
    key: { color: '#fff5e4', intensity: 3.9, azimuth: 35, elevation: 40, softness: 18 },
    fill: { color: '#fff1df', intensity: 1.4, azimuth: 150, elevation: 48, softness: 25 },
    ambient: { skyColor: '#fdf0e2', groundColor: '#f3d6b5', intensity: 0.8, groundBoost: 2.2 },
    /** ガラスや車の映り込みに使う空（水面の映り込みと同じ青い空と、暖かい床）。拡散光には使わない */
    reflection: { zenith: '#6aaed0', horizon: '#cfe5ee', ground: '#e8d4b8', intensity: 0.8 },
  },

  /** 影と空からの遮蔽の焼き込み */
  shadow: {
    lightSamples: 40,
    aoSamples: 64,
    aoMinElevation: 7,
    strength: 1,
    aoStrength: 1,
    /** 街の地面の AO の濃さ */
    groundAoStrength: 0.75,
    /** 川底の AO の濃さ */
    sandAoStrength: 0.75,
    mapSize: 2048,
    bakeResolution: 1024,
    groundBakeResolution: 1024,
    sandBakeResolution: 1024,
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
    textureSize: 1024,
    lightSamples: 16,
    aoSamples: 24,
    mapSize: 1024,
    bakeResolution: 512,
    groundBakeResolution: 512,
    sandBakeResolution: 512,
    maxPixelRatio: 1,
    textureScale: 0.6,
  },

  renderer: {
    /** 背景色（床が画面を覆うので通常は見えない） */
    background: '#fae8d4',
    maxPixelRatio: 2,
    exposure: 1,
    highlightKnee: 0.9,
    /** 仕上げの彩度（シリーズでは使わない） */
    grade: { saturation: 1, darkSaturation: 0 },
  },

  /** カメラ（シリーズと同じ：手前の辺の正面から見下ろす） */
  camera: { ...homeCamera },
  framing: { ...homeFraming },
  framingOther: {
    paddingX: 0.05,
    paddingXNarrow: 0.06,
    paddingTop: 0.1,
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
};

export type SceneConfig = typeof config;
