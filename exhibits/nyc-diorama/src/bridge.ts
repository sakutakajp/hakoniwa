import * as THREE from 'three';
import type { CityLevels, Layout } from './layout';
import type { SceneConfig } from './config';
import type { FaceInfo, MeshBuilder } from './meshBuilder';
import { mergeGeometries } from './ground';

/**
 * ブルックリン橋（島の地面を高さ 0 とした座標）。
 *  - 坂道：橋の通り（S2）の上を、石の擁壁で支えた盛り土で上がる
 *  - 海沿いの通り（FDR ドライブ）の上は、石の桁でまたぐ
 *  - 岸の石の橋台：主ケーブルを留める。路面は両側の高い石の壁のあいだを通る
 *  - 川の上：路面の下に格子のトラス、両側に手すり、中央に一段高い歩道。台座の縁で切れる
 *  - 石の主塔（尖頭アーチが 2 つ）は川底の基礎から立つ。路面に直交する向き
 *  - 主ケーブル・吊りケーブル・主塔から斜めに張るケーブル、主塔の上の星条旗
 * 路面は layout.bridge.path の点を通るなめらかな曲線。
 */
export function bridgeCurve(layout: Layout) {
  const pts = layout.bridge.path.map(([x, z, h]) => new THREE.Vector3(x, h, z));
  return new THREE.CatmullRomCurve3(pts, false, 'centripetal');
}

export interface DeckFrame {
  p: THREE.Vector3;
  tan: THREE.Vector3;
  /** 水平な進む向きと、それに対して右（上から見て時計回りに 90°） */
  flat: THREE.Vector3;
  right: THREE.Vector3;
}

/** 路面の上の位置：曲線の割合 t（0〜1、長さに比例） */
export function deckFrame(curve: THREE.CatmullRomCurve3, t: number): DeckFrame {
  const p = curve.getPointAt(t);
  const tan = curve.getTangentAt(t);
  const flat = new THREE.Vector3(tan.x, 0, tan.z).normalize();
  const right = new THREE.Vector3(-flat.z, 0, flat.x);
  return { p, tan, flat, right };
}

/** 曲線の上で、水平の位置 (x, z) に最も近い点の割合 t */
export function nearestT(curve: THREE.CatmullRomCurve3, x: number, z: number, steps = 600) {
  let best = 0;
  let bestD = Infinity;
  for (let i = 0; i <= steps; i++) {
    const p = curve.getPointAt(i / steps);
    const d = Math.hypot(p.x - x, p.z - z);
    if (d < bestD) {
      bestD = d;
      best = i / steps;
    }
  }
  return best;
}

export interface TowerFrame {
  along: THREE.Vector3;
  across: THREE.Vector3;
  at: [number, number];
  /** 笠石の下端の高さ、主塔の横幅の半分、路面の向きの厚みの半分 */
  top: number;
  half: number;
  depthHalf: number;
}

export interface BridgeInfo {
  curve: THREE.CatmullRomCurve3;
  tower: TowerFrame;
  towerT: number;
  /** 岸の橋台の前の面（ここから先が川の上の吊り橋） */
  anchorT: number;
  /** 坂道の盛り土の終わり */
  rampT: number;
  /** 橋台の上端の高さと、ケーブルを留める位置の横のずれ */
  anchorTop: number;
  width: number;
  /** 路面の上の点（t: 曲線の割合、n: 中心から右へのずれ）。車を置くのに使う */
  deckPoint: (t: number, n: number) => { p: THREE.Vector3; tan: THREE.Vector3 };
  /** 画角合わせ用の点（主塔の上端と、路面の切り口） */
  outline: THREE.Vector3[];
  /** 水面から出ている所（泡を立てる）：上から見た長方形の中心、向き、半分の大きさ [along, across] */
  footprints: { c: [number, number]; along: [number, number]; half: [number, number] }[];
}

const SLAB = 0.035;
const TRUSS_H = 0.1;
const WALK_W = 0.07;
const WALK_H = 0.03;
const CURB_W = 0.022;
const CURB_H = 0.012;
const RAIL_H = 0.06;
/** 石の手すり壁（坂道と、海沿いの通りの上）の高さ */
const PARAPET_H = 0.05;
/** 路面のわずかな持ち上げ（坂道の始まりで、道路の面と重ならないように） */
const LIFT = 0.002;

export function addBridge(
  mb: MeshBuilder,
  layout: Layout,
  cfg: SceneConfig,
  styleIndex: (name: string) => number,
  levels: CityLevels,
): BridgeInfo {
  const br = layout.bridge;
  const curve = bridgeCurve(layout);
  const W = br.width;
  const col = (c: string) => new THREE.Color(c);
  const plain = styleIndex('roofbox');
  const asphalt: FaceInfo = { style: plain, color: col(cfg.bridge.deck) };
  const walk: FaceInfo = { style: plain, color: col(cfg.bridge.walk) };
  const girder: FaceInfo = { style: plain, color: col(cfg.bridge.girder) };
  const truss: FaceInfo = { style: styleIndex('truss'), color: col(cfg.wallColors.truss) };
  const rail: FaceInfo = { style: styleIndex('railing'), color: col(cfg.wallColors.railing) };
  const stone: FaceInfo = { style: styleIndex('stone'), color: col(cfg.wallColors.stone) };
  const stoneDark: FaceInfo = { style: styleIndex('stone'), color: col(cfg.wallColors.stone).multiplyScalar(0.9) };
  // 水の中の石（濡れて少し暗い。水越しに見るので暗くしすぎない）
  const stoneWet: FaceInfo = { style: styleIndex('stone'), color: col(cfg.wallColors.stone).multiplyScalar(0.86) };
  const plainStone: FaceInfo = { style: plain, color: col(cfg.wallColors.stone).multiplyScalar(0.97) };

  // --- 区間の境目（曲線の割合）
  const X = br.anchorage.c[0];
  const anchorFrontZ = br.anchorage.c[1] + br.anchorage.size[1] / 2;
  const rampT = nearestT(curve, X, br.ramp.z[1]);
  const archT = nearestT(curve, X, br.arch.z[1]);
  const anchorT = nearestT(curve, X, anchorFrontZ);

  // --- 路面：曲線に沿って短い区間ごとに組み立てる
  const N = 160;
  const frames = Array.from({ length: N + 1 }, (_, i) => deckFrame(curve, i / N));
  const dist: number[] = [0];
  for (let i = 1; i <= N; i++) dist.push(dist[i - 1] + frames[i].p.distanceTo(frames[i - 1].p));
  const L = dist[N];
  const at = (f: DeckFrame, n: number, dy: number) => f.p.clone().addScaledVector(f.right, n).add(new THREE.Vector3(0, dy + LIFT, 0));
  /** 路面の向きに沿った縦の面（outward = 1 で右向き、-1 で左向き）。u は路面に沿った距離。worldV で v を高さそのものにする（石積みの目地をそろえる） */
  const side = (i: number, n: number, y0: number, y1: number, outward: 1 | -1, f: FaceInfo, opts: { absolute?: boolean; worldV?: boolean } = {}) => {
    const a = frames[i];
    const b = frames[i + 1];
    // absolute：y0 / y1 を路面からではなく、地面からの高さとして使う
    const pa0 = opts.absolute ? at(a, n, 0).setY(y0) : at(a, n, y0);
    const pb0 = opts.absolute ? at(b, n, 0).setY(y0) : at(b, n, y0);
    const pa1 = at(a, n, y1);
    const pb1 = at(b, n, y1);
    const v0 = opts.worldV ? Math.min(pa0.y, pb0.y) : 0;
    if (outward > 0) mb.quad(pa0, pb0, pb1, pa1, f, { uOffset: dist[i], v0 });
    else mb.quad(pb0, pa0, pa1, pb1, f, { uOffset: L - dist[i + 1], v0 });
  };
  /** 路面の向きに沿った水平な面（n0 < n1。down で下向き） */
  const strip = (i: number, n0: number, n1: number, y: number, f: FaceInfo, down = false) => {
    const a = frames[i];
    const b = frames[i + 1];
    // 上から見て反時計回り：a の左 → a の右 → b の右 → b の左（右が +n）
    const c = [at(a, n0, y), at(a, n1, y), at(b, n1, y), at(b, n0, y)];
    if (down) mb.quad(c[1], c[0], c[3], c[2], f);
    else mb.quad(c[0], c[1], c[2], c[3], f);
  };
  const prevCell = mb.maxCell;
  mb.maxCell = 0.07;
  const h2 = W / 2;
  for (let i = 0; i < N; i++) {
    const tm = (i + 0.5) / N;
    const kind = tm < rampT ? 'ramp' : tm < archT ? 'arch' : tm < anchorT ? 'anchor' : 'span';
    // 中央の歩道は、坂道の始まりでは道路と同じ高さから少しずつ上げる
    const hDeck = Math.min(frames[i].p.y, frames[i + 1].p.y);
    const wh = WALK_H * THREE.MathUtils.smoothstep(hDeck, 0.0, 0.08);
    // 車道と、中央の一段高い歩道、端の縁石
    strip(i, -h2 + CURB_W, -WALK_W, 0, asphalt);
    strip(i, WALK_W, h2 - CURB_W, 0, asphalt);
    if (wh > 0.002) {
      strip(i, -WALK_W, WALK_W, wh, walk);
      side(i, WALK_W, 0, wh, 1, walk);
      side(i, -WALK_W, 0, wh, -1, walk);
    } else {
      strip(i, -WALK_W, WALK_W, 0, walk);
    }
    if (kind === 'span') {
      strip(i, -h2, -h2 + CURB_W, CURB_H, girder);
      strip(i, h2 - CURB_W, h2, CURB_H, girder);
      side(i, h2 - CURB_W, 0, CURB_H, -1, girder);
      side(i, -h2 + CURB_W, 0, CURB_H, 1, girder);
      // 路面の裏と、端の厚み
      strip(i, -h2, h2, -SLAB, girder, true);
      side(i, h2, -SLAB, CURB_H, 1, girder);
      side(i, -h2, -SLAB, CURB_H, -1, girder);
      // 下の格子（外と内の両面）
      const e = h2 - 0.012;
      side(i, e, -SLAB - TRUSS_H, -SLAB, 1, truss);
      side(i, e - 0.004, -SLAB - TRUSS_H, -SLAB, -1, truss);
      side(i, -e, -SLAB - TRUSS_H, -SLAB, -1, truss);
      side(i, -e + 0.004, -SLAB - TRUSS_H, -SLAB, 1, truss);
      // 格子の下の弦材の下面
      strip(i, e - 0.004, e, -SLAB - TRUSS_H, girder, true);
      strip(i, -e, -e + 0.004, -SLAB - TRUSS_H, girder, true);
      // 手すり（外と内の両面）
      const r = h2 - 0.006;
      side(i, r, CURB_H, CURB_H + RAIL_H, 1, rail);
      side(i, r - 0.003, CURB_H, CURB_H + RAIL_H, -1, rail);
      side(i, -r, CURB_H, CURB_H + RAIL_H, -1, rail);
      side(i, -r + 0.003, CURB_H, CURB_H + RAIL_H, 1, rail);
    } else {
      // 石の手すり壁（内側の面と上面）。橋台の区間は両側の高い壁があるので作らない
      const pw = 0.03;
      if (kind !== 'anchor') {
        strip(i, -h2, -h2 + pw, PARAPET_H, plainStone);
        strip(i, h2 - pw, h2, PARAPET_H, plainStone);
        side(i, h2 - pw, 0, PARAPET_H, -1, stone, { worldV: true });
        side(i, -h2 + pw, 0, PARAPET_H, 1, stone, { worldV: true });
      } else {
        strip(i, -h2, -h2 + CURB_W, CURB_H, plainStone);
        strip(i, h2 - CURB_W, h2, CURB_H, plainStone);
        side(i, h2 - CURB_W, 0, CURB_H, -1, plainStone);
        side(i, -h2 + CURB_W, 0, CURB_H, 1, plainStone);
      }
      if (kind === 'ramp') {
        // 坂道の擁壁：地面から手すり壁の上まで（外側の面）
        side(i, h2, 0, PARAPET_H, 1, stone, { absolute: true, worldV: true });
        side(i, -h2, 0, PARAPET_H, -1, stone, { absolute: true, worldV: true });
      } else if (kind === 'arch') {
        // 海沿いの通りの上の石の桁：外側の面と下面
        side(i, h2, -0.03, PARAPET_H, 1, stone, { worldV: true });
        side(i, -h2, -0.03, PARAPET_H, -1, stone, { worldV: true });
        strip(i, -h2, h2, -0.03, stoneDark, true);
      } else {
        side(i, h2, -SLAB, CURB_H, 1, girder);
        side(i, -h2, -SLAB, CURB_H, -1, girder);
      }
    }
  }
  // 坂道の盛り土の終わり（海沿いの通りに面した石の面）
  {
    const i = Math.round(rampT * N);
    const f = frames[i];
    const q = [at(f, -h2, 0).setY(0), at(f, h2, 0).setY(0), at(f, h2, -0.03), at(f, -h2, -0.03)];
    // +along（通りの側）を向く：外から見て左が +n
    mb.quad(q[1], q[0], q[3], q[2], stone, { v0: 0 });
  }
  // 切り口（路面の終わり。格子の下まで）
  {
    const f = frames[N];
    const q = [at(f, -h2, -SLAB - TRUSS_H), at(f, h2, -SLAB - TRUSS_H), at(f, h2, WALK_H), at(f, -h2, WALK_H)];
    mb.quad(q[1], q[0], q[3], q[2], girder);
  }

  // --- 岸の橋台：川底から路面の下までの石の塊と、路面の両側の高い壁（上に笠石）
  const an = br.anchorage;
  const [acx, acz] = an.c;
  const [asx, asz] = an.size;
  const ax0 = acx - asx / 2;
  const ax1 = acx + asx / 2;
  const az0 = acz - asz / 2;
  const az1 = acz + asz / 2;
  let anchorBed = 0;
  for (const [x, z] of [
    [ax0, az1],
    [ax1, az1],
    [acx, az1],
    [ax0, (az0 + az1) / 2],
    [ax1, (az0 + az1) / 2],
  ]) {
    anchorBed = Math.min(anchorBed, levels.bedAt(x, z));
  }
  const yAnchorBot = anchorBed - 0.05;
  let deckMax = -Infinity;
  for (let i = Math.floor(archT * N); i <= Math.ceil(anchorT * N); i++) deckMax = Math.max(deckMax, frames[i].p.y);
  const blockTop = deckMax - SLAB + LIFT;
  mb.box([acx, acz], [asx, asz], [yAnchorBot, blockTop], stone, plainStone, { vBase: yAnchorBot });
  // 水の中の部分は暗く（濡れた石）。水面のすぐ上までの帯
  mb.box([acx, (Math.max(az0, layout.island.front) + az1) / 2], [asx + 0.012, az1 - Math.max(az0, layout.island.front) + 0.012], [yAnchorBot, levels.water + 0.03], stoneWet, null, { vBase: yAnchorBot });
  const inner = h2 + 0.005;
  const wallW = asx / 2 - inner;
  for (const s of [-1, 1]) {
    const cx = acx + s * (inner + wallW / 2);
    mb.box([cx, acz], [wallW, asz], [blockTop, an.top], stone, plainStone, { vBase: blockTop });
    // 笠石（少し張り出す）
    mb.box([cx + s * 0.01, acz], [wallW + 0.04, asz + 0.04], [an.top, an.top + 0.03], plainStone, plainStone, { bottom: stoneDark });
    // 正面の付け柱（縦の帯）
    mb.box([cx, az1 + 0.006], [wallW * 0.55, 0.012], [levels.water + 0.03, an.top], stone, stone, { vBase: levels.water + 0.03 });
  }

  // --- 主塔（路面に直交する面に 2 つの尖頭アーチ）。川底の基礎から立つ
  const tw = br.tower;
  const towerT = nearestT(curve, tw.at[0], tw.at[1]);
  const tf = deckFrame(curve, towerT);
  const along = tf.flat.clone();
  const across = tf.right.clone();
  const deckAtTower = tf.p.y;
  const local = (a: number, n: number, y: number) =>
    new THREE.Vector3(tw.at[0], y, tw.at[1]).addScaledVector(along, a).addScaledVector(across, n);
  /** 主塔の座標（a: 路面の向き、n: 横）の箱。外から見て反時計回りの 4 つの側面と上面 */
  const tbox = (a0: number, a1: number, n0: number, n1: number, y0: number, y1: number, f: FaceInfo, top = true) => {
    const b = [local(a1, n0, y0), local(a1, n1, y0), local(a0, n1, y0), local(a0, n0, y0)];
    const t = [local(a1, n0, y1), local(a1, n1, y1), local(a0, n1, y1), local(a0, n0, y1)];
    for (let i = 0; i < 4; i++) {
      const j = (i + 1) % 4;
      mb.quad(b[j], b[i], t[i], t[j], f, { v0: y0 });
    }
    if (top) mb.flat([t[3], t[2], t[1], t[0]], f);
  };
  const A = tw.along / 2;
  const half = tw.across / 2;
  const legW = 0.19;
  const midW = 0.14;
  const yOpen = deckAtTower - SLAB - TRUSS_H - 0.04;
  const archBase = deckAtTower + 0.72;
  const archPeak = deckAtTower + 1.14;
  const archTop = archPeak + 0.06;
  const capY = tw.top;
  // 基礎：川底から水面の少し上まで（ひとまわり大きい）。水の中は濡れた暗い石
  let towerBed = 0;
  for (const sa of [-1, 1]) for (const sn of [-1, 0, 1]) {
    const p = local(sa * (A + 0.07), sn * (half + 0.08), 0);
    towerBed = Math.min(towerBed, levels.bedAt(p.x, p.z));
  }
  const yBot = towerBed - 0.05;
  const yBase = levels.water + 0.1;
  // 川底の上の広い基礎（ケーソン）と、その上の水の中の石積み
  tbox(-A - 0.13, A + 0.13, -half - 0.14, half + 0.14, yBot, yBot + 0.3, stoneWet);
  tbox(-A - 0.1, A + 0.1, -half - 0.11, half + 0.11, yBot + 0.3, yBot + 0.38, stoneWet);
  tbox(-A - 0.07, A + 0.07, -half - 0.08, half + 0.08, yBot + 0.38, yBase, stoneWet);
  tbox(-A - 0.035, A + 0.035, -half - 0.04, half + 0.04, yBase, yBase + 0.08, stone);
  // 路面より下の本体（上面は開口の床になる）
  tbox(-A, A, -half, half, yBase + 0.08, yOpen, stone);
  // 3 本の脚
  const n0L = -half + legW;
  const n1L = -midW / 2;
  const n0R = midW / 2;
  const n1R = half - legW;
  tbox(-A, A, -half, n0L, yOpen, archTop, stone, false);
  tbox(-A, A, n1R, half, yOpen, archTop, stone, false);
  tbox(-A, A, n1L, n0R, yOpen, archTop, stone, false);
  // 開口の上の尖頭アーチ（前後の面と、アーチの下面）
  for (const [n0, n1] of [
    [n0L, n1L],
    [n0R, n1R],
  ]) {
    const nc = (n0 + n1) / 2;
    for (const a of [-A, A]) {
      const p0 = local(a, n0, archBase);
      const p1 = local(a, n1, archBase);
      const pc = local(a, nc, archPeak);
      const t0 = local(a, n0, archTop);
      const t1 = local(a, n1, archTop);
      const tc = local(a, nc, archTop);
      if (a > 0) {
        // 前の面（+along を向く）：外から見ると右が -n
        mb.quad(p1, pc, tc, t1, stone, { v0: archBase });
        mb.quad(pc, p0, t0, tc, stone, { v0: archBase });
      } else {
        mb.quad(p0, pc, tc, t0, stone, { v0: archBase });
        mb.quad(pc, p1, t1, tc, stone, { v0: archBase });
      }
    }
    // アーチの下面（2 枚の斜めの面、開口の内側を向く）
    mb.quad(local(-A, n0, archBase), local(A, n0, archBase), local(A, nc, archPeak), local(-A, nc, archPeak), stoneDark);
    mb.quad(local(-A, nc, archPeak), local(A, nc, archPeak), local(A, n1, archBase), local(-A, n1, archBase), stoneDark);
  }
  // アーチより上の壁と、上端の笠石（張り出す）、塔頂の低い壁
  tbox(-A, A, -half, half, archTop, capY, stone);
  tbox(-A - 0.03, A + 0.03, -half - 0.03, half + 0.03, capY, capY + 0.055, stone);
  tbox(-A * 0.75, A * 0.75, -half * 0.86, half * 0.86, capY + 0.055, capY + 0.1, stoneDark);
  // 正面と背面の付け柱（外側の角の縦の帯）と、アーチの起点の高さの横の帯（脚の上だけ）
  const pil = 0.018;
  for (const sgn of [-1, 1]) {
    const a0 = sgn > 0 ? A : -A - pil;
    const a1 = sgn > 0 ? A + pil : -A;
    tbox(a0, a1, -half, -half + 0.075, yBase + 0.08, capY, stone);
    tbox(a0, a1, half - 0.075, half, yBase + 0.08, capY, stone);
    tbox(a0, a1, -half, n0L, archBase - 0.05, archBase, stone);
    tbox(a0, a1, n1R, half, archBase - 0.05, archBase, stone);
    tbox(a0, a1, n1L, n0R, archBase - 0.05, archBase, stone);
    // 路面の高さの下の横の帯
    tbox(a0, a1, -half, half, yOpen - 0.05, yOpen, stone);
  }
  mb.maxCell = prevCell;

  const tower: TowerFrame = { along, across, at: tw.at, top: capY, half, depthHalf: A };
  const end = frames[N];
  const outline = [
    local(-A, -half, capY + 0.1),
    local(A, -half, capY + 0.1),
    local(A, half, capY + 0.1),
    local(-A, half, capY + 0.1),
    at(end, -h2, WALK_H),
    at(end, h2, WALK_H),
  ];
  // 泡を立てる所：主塔の基礎と、橋台の水の中の部分
  const wetZ0 = Math.max(az0, layout.island.front);
  return {
    curve,
    tower,
    towerT,
    anchorT,
    rampT,
    anchorTop: an.top,
    width: W,
    deckPoint: (t: number, n: number) => {
      const f = deckFrame(curve, t);
      return { p: f.p.clone().addScaledVector(f.right, n).add(new THREE.Vector3(0, LIFT, 0)), tan: f.tan.clone() };
    },
    outline,
    footprints: [
      { c: tw.at, along: [along.x, along.z], half: [A + 0.07, half + 0.08] },
      { c: [acx, (wetZ0 + az1) / 2], along: [0, 1], half: [(az1 - wetZ0) / 2 + 0.006, asx / 2 + 0.006] },
    ],
  };
}

/**
 * 主ケーブル・吊りケーブル・斜めのケーブル（細い管）。
 * 側径間：主塔の上から岸の橋台の壁の上へ、ゆるくたるむ。
 * 主径間：主塔の上から、台座の外にある川の中ほど（見えない）へ放物線で下がり、路面の切り口の位置で切る
 */
export function createCablesGeometry(info: BridgeInfo) {
  const { curve, tower, towerT, anchorT, width } = info;
  const geos: THREE.BufferGeometry[] = [];
  const sideN = width / 2 - 0.006;
  const topY = tower.top + 0.11;
  const railTop = CURB_H + RAIL_H + LIFT;
  const deckAt = (t: number, s: number) => {
    const f = deckFrame(curve, t);
    return f.p.clone().addScaledVector(f.right, s);
  };
  const tube = (pts: THREE.Vector3[], r: number) => {
    const c = new THREE.CatmullRomCurve3(pts);
    geos.push(new THREE.TubeGeometry(c, Math.max(8, pts.length * 2), r, 5, false));
  };
  const segment = (a: THREE.Vector3, b: THREE.Vector3, r: number) => {
    const len = a.distanceTo(b);
    const g = new THREE.CylinderGeometry(r, r, len, 4, 1, true);
    const dir = b.clone().sub(a).normalize();
    g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir));
    const mid = a.clone().add(b).multiplyScalar(0.5);
    g.translate(mid.x, mid.y, mid.z);
    geos.push(g);
  };
  const L = curve.getLength();
  // 主径間の見えない中ほど：主塔から路面に沿ってこの長さの所で、ケーブルが最も低くなる（路面の少し上）
  const halfSpan = 4.0;
  const towerTop = (s: number) => deckAt(towerT, s).setY(topY);
  for (const s of [-sideN, sideN]) {
    const top = towerTop(s);
    // --- 側径間：橋台の壁の上（正面の少し奥）から主塔の上へ
    const anchorEnd = deckAt(anchorT, s);
    anchorEnd.addScaledVector(deckFrame(curve, anchorT).flat, -0.06);
    anchorEnd.y = info.anchorTop - 0.015;
    const backSag = 0.16;
    const back = (u: number) => {
      const p = anchorEnd.clone().lerp(top, u);
      p.y = anchorEnd.y + (top.y - anchorEnd.y) * u - backSag * 4 * u * (1 - u);
      return p;
    };
    const M = 48;
    const backPts = Array.from({ length: M + 1 }, (_, i) => back(i / M));
    // --- 主径間：主塔から切り口まで
    const yMid = deckAt(Math.min(1, towerT + halfSpan / L), 0).y + 0.08;
    const mainAt = (t: number) => {
      const d = (t - towerT) * L;
      const u = Math.min(d / halfSpan, 1);
      const p = deckAt(t, s);
      p.y = yMid + (topY - yMid) * (1 - u) * (1 - u);
      return p;
    };
    const mainPts = Array.from({ length: M + 1 }, (_, i) => mainAt(towerT + ((1 - towerT) * i) / M));
    // 路面の手すりより下がらないように
    for (const p of [...backPts, ...mainPts]) {
      const tt = nearestT(curve, p.x, p.z, 200);
      p.y = Math.max(p.y, curve.getPointAt(tt).y + railTop + 0.02);
    }
    tube(backPts, 0.016);
    tube(mainPts, 0.016);
    // --- 吊りケーブル：路面の手すりの上から主ケーブルへ垂直に
    const hangers = (t0: number, t1: number, cableY: (t: number) => number) => {
      const count = Math.floor((Math.abs(t1 - t0) * L) / 0.036);
      for (let i = 1; i < count; i++) {
        const t = t0 + ((t1 - t0) * i) / count;
        const d = deckAt(t, s);
        d.y += railTop;
        const cy = cableY(t);
        if (cy - d.y > 0.03) segment(d, new THREE.Vector3(d.x, cy, d.z), 0.0042);
      }
    };
    // 側径間のケーブルの高さ：路面の位置を、橋台の端と主塔を結ぶ線に投げて読む
    const chord = top.clone().sub(anchorEnd).setY(0);
    const chordLen2 = chord.lengthSq();
    hangers(anchorT + 0.25 / L, towerT, (t) => {
      const d = deckAt(t, s);
      const u = THREE.MathUtils.clamp(d.clone().sub(anchorEnd).setY(0).dot(chord) / chordLen2, 0, 1);
      return back(u).y;
    });
    hangers(towerT, 1, (t) => mainAt(t).y);
    // --- 斜めのケーブル：主塔の上の方から路面へ放射状に（両側へ）
    for (const dir of [-1, 1]) {
      for (let i = 1; i <= 6; i++) {
        const t = towerT + (dir * i * 0.2) / L;
        if (t <= anchorT + 0.15 / L || t >= 0.995) continue;
        const d = deckAt(t, s);
        d.y += railTop;
        const from = top.clone();
        from.y -= 0.12 + i * 0.015;
        segment(from, d, 0.0038);
      }
    }
  }
  return mergeGeometries(geos);
}

/** 星条旗（キャンバスに描く）と旗竿。主塔の上の角に立て、路面の向きへなびかせる */
export function createFlag(tower: TowerFrame, poleColor: string) {
  const canvas = document.createElement('canvas');
  canvas.width = 190;
  canvas.height = 100;
  const ctx = canvas.getContext('2d')!;
  for (let i = 0; i < 13; i++) {
    ctx.fillStyle = i % 2 === 0 ? '#c8202f' : '#ffffff';
    ctx.fillRect(0, (i * 100) / 13, 190, 100 / 13 + 0.5);
  }
  ctx.fillStyle = '#23407e';
  ctx.fillRect(0, 0, 76, 54);
  ctx.fillStyle = '#ffffff';
  for (let r = 0; r < 5; r++) for (let c = 0; c < 6; c++) ctx.fillRect(6 + c * 12 + (r % 2) * 5, 5 + r * 10, 3, 3);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  const group = new THREE.Group();
  group.name = 'flag';
  const base = new THREE.Vector3(tower.at[0], tower.top + 0.1, tower.at[1])
    .addScaledVector(tower.across, tower.half * 0.7)
    .addScaledVector(tower.along, tower.depthHalf * 0.3);
  const poleH = 0.42;
  const pole = new THREE.Mesh(
    new THREE.CylinderGeometry(0.006, 0.007, poleH, 6),
    new THREE.MeshStandardMaterial({ color: poleColor, roughness: 0.4, metalness: 0.3 }),
  );
  pole.position.copy(base).add(new THREE.Vector3(0, poleH / 2, 0));
  group.add(pole);
  // 旗：横に少しなびかせる
  const fw = 0.27;
  const fh = 0.15;
  const geo = new THREE.PlaneGeometry(fw, fh, 14, 1);
  geo.translate(fw / 2, 0, 0);
  const p = geo.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i);
    p.setZ(i, Math.sin((x / fw) * Math.PI * 1.6) * 0.012 * (x / fw));
    p.setY(i, p.getY(i) - 0.012 * (x / fw) * (x / fw));
  }
  geo.computeVertexNormals();
  const flag = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ map: tex, side: THREE.DoubleSide, roughness: 0.85 }));
  flag.position.copy(base).add(new THREE.Vector3(0, poleH - fh / 2 - 0.005, 0));
  flag.rotation.y = Math.atan2(-tower.along.z, tower.along.x);
  group.add(flag);
  return group;
}
