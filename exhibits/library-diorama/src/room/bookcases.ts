import { captureFurniture } from '../../../shared/asset-capture';
import * as THREE from 'three';
import { V, type BuildContext } from './context';
import { archFrameFace, archBand, at, rectFace, wallFrame, type ArchHole, type Frame } from './arch';
import { wallGeometry } from './structure';
import { fbox } from './windows';

/**
 * 本棚：1 階の本棚の壁（奥と左の壁。下に戸棚、上に本の棚。区画の間に柱形と燭台。上は回廊の床の裏）、
 * 2 階の壁際の本棚（左の壁だけ。上にアーチの額縁）、棚の上の本。
 */

/** 棚に本を並べる。u0〜u1、棚板の上面の高さ y、上の空き clear、奥行きの範囲（背の位置 cFront、奥 cBack） */
export function fillShelf(
  ctx: BuildContext,
  fr: Frame,
  u0: number,
  u1: number,
  y: number,
  clear: number | ((u: number) => number),
  cFront: number,
  cBack: number,
  opts: { density?: number; tall?: number } = {},
) {
  const { cfg, rand } = ctx;
  const B = cfg.books;
  const palette = B.palette.map((c) => new THREE.Color(c));
  const depthAvail = cFront - cBack;
  const clearAt = typeof clear === 'number' ? () => clear : clear;
  let u = u0 + 0.004 + rand() * 0.02;
  // 同じ色の巻が続く「全集」：数冊ずつ同じ色と高さにする
  let setLeft = 0;
  let setColor = palette[0];
  let setH = 0.8;
  let setW = 0.04;
  let setPattern = 0;
  let leanNext = false;
  while (u < u1 - 0.025) {
    if (rand() < B.gapChance * (opts.density ?? 1)) {
      // 空き（その後の 1 冊は傾ける）
      u += 0.03 + rand() * 0.09;
      leanNext = rand() < 0.6;
      continue;
    }
    if (setLeft <= 0) {
      setLeft = rand() < 0.35 ? 2 + Math.floor(rand() * 5) : 1;
      setColor = palette[Math.floor(rand() * palette.length)].clone().multiplyScalar(0.82 + rand() * 0.36);
      setH = B.height[0] + rand() * (B.height[1] - B.height[0]);
      setW = B.thickness[0] + rand() * (B.thickness[1] - B.thickness[0]);
      // 全集は同じ装丁（背の模様）。革装と布装が多く、総箔押しは少し
      const r = rand();
      setPattern = r < 0.26 ? 0 : r < 0.5 ? 1 : r < 0.67 ? 2 : r < 0.84 ? 3 : r < 0.95 ? 4 : 5;
    }
    setLeft--;
    const cl = clearAt(u);
    if (cl < 0.08) {
      u += 0.03;
      continue;
    }
    const w = setW * (0.92 + rand() * 0.16);
    const h = Math.min(cl - 0.012, cl * setH * (opts.tall ?? 1) * (0.96 + rand() * 0.08));
    const d = depthAvail * (B.depth[0] + rand() * (B.depth[1] - B.depth[0]));
    if (u + w > u1 - 0.004) break;
    const lean = leanNext || rand() < B.leanChance * 0.3;
    leanNext = false;
    let up = fr.v.clone();
    let uc = u + w / 2;
    let yc = y + h / 2;
    if (lean && u + h * 0.35 < u1) {
      // 右へ傾けて前の本（または棚の端）に寄りかからせる
      const a = THREE.MathUtils.degToRad(10 + rand() * 14) * (rand() < 0.5 ? -1 : 1);
      up = fr.v.clone().multiplyScalar(Math.cos(a)).addScaledVector(fr.u, -Math.sin(a));
      const hh = Math.min(h, (cl - 0.015) / Math.cos(a) - w * Math.abs(Math.sin(a)));
      const sa = Math.abs(Math.sin(a));
      uc = u + (w * Math.cos(a) + hh * sa) / 2;
      yc = y + (hh * Math.cos(a) + w * sa) / 2;
      const cFront2 = cFront - 0.005 - rand() * 0.01;
      ctx.books.push({
        position: at(fr, uc, yc, cFront2 - d / 2),
        normal: fr.n.clone(),
        up,
        size: V(w, hh, d),
        color: setColor.clone(),
        pattern: setPattern,
        gap: Math.max(0.005, cl - (hh * Math.cos(a) + w * sa)),
      });
      u += w * Math.cos(a) + hh * sa + 0.004;
      continue;
    }
    const cf = cFront - 0.004 - rand() * 0.012;
    ctx.books.push({ position: at(fr, uc, yc, cf - d / 2), normal: fr.n.clone(), up, size: V(w, h, d), color: setColor.clone(), pattern: setPattern, gap: Math.max(0.005, cl - h) });
    u += w + (rand() < 0.15 ? 0.004 : 0.0008);
  }
}

/** 壁の燭台（真鍮の腕と、白い光る火屋）。灯りとしても登録する */
function original_sconce(ctx: BuildContext, fr: Frame, u: number, y: number, c0: number) {
  const { cfg, st, mb, lamps } = ctx;
  const col = cfg.colors;
  const brass = st.face('brass', col.brass);
  // 壁の台座と腕
  fbox(mb, fr, [u - 0.03, u + 0.03], [y - 0.06, y + 0.04], [c0, c0 + 0.02], brass, { skip: ['back'] });
  const p0 = at(fr, u, y - 0.03, c0 + 0.015);
  const p1 = at(fr, u, y + 0.02, c0 + 0.1);
  mb.beam(p0, p1, 0.014, 0.014, brass, { cell: 1e3 });
  const base = at(fr, u, y + 0.02, c0 + 0.1);
  mb.lathe([base.x, base.z], [[0.0, base.y], [0.028, base.y + 0.01], [0.022, base.y + 0.025]], brass, 8, { capBottom: false });
  // 火屋（すりガラスの笠）
  const glow = st.face('glowSoft', '#ffd79c');
  mb.lathe([base.x, base.z], [[0.018, base.y + 0.025], [0.032, base.y + 0.06], [0.03, base.y + 0.1], [0.016, base.y + 0.115], [0.0, base.y + 0.118]], glow, 10, { capBottom: false });
  lamps.push({ position: V(base.x, base.y + 0.07, base.z).addScaledVector(fr.n, 0.05), color: new THREE.Color('#ffc47a'), range: cfg.lamps.sconceRange, intensity: cfg.lamps.sconceIntensity });
}

/** 2 階の壁際の本棚（側板・天板とコーニス・台輪・奥の板・仕切り・棚板・本） */
function original_wallCase(ctx: BuildContext, fr: Frame, u0: number, u1: number, y0: number, y1: number, depth: number, opts: { columns: number; shelfSpacing: number; sides?: [boolean, boolean]; arch?: boolean; cornice?: boolean }) {
  const { cfg, st, mb } = ctx;
  const c = cfg.colors;
  const sideF = st.face('woodV', c.wood);
  const darkF = st.face('woodV', c.woodDark);
  const shelfF = st.face('wood', c.wood);
  const edge = st.face('wood', c.woodLight);
  const t = 0.035;
  const plinth = 0.11;
  // 奥の板
  rectFace(mb, fr, u0, u1, y0, y1, darkF, 0.006);
  // 側板（外側の面も作る：端の棚の横が見える）
  const sides = opts.sides ?? [true, true];
  if (sides[0]) fbox(mb, fr, [u0, u0 + t], [y0, y1], [0.006, depth], sideF, { skip: ['back', 'bottom'] });
  if (sides[1]) fbox(mb, fr, [u1 - t, u1], [y0, y1], [0.006, depth], sideF, { skip: ['back', 'bottom'] });
  // 台輪と天板・コーニス
  fbox(mb, fr, [u0, u1], [y0, y0 + plinth], [0.006, depth - 0.015], st.face('wood', c.woodDark), { skip: ['back', 'bottom', 'left', 'right'] });
  if (opts.cornice !== false) {
    fbox(mb, fr, [u0 - 0.02, u1 + 0.02], [y1 - 0.04, y1], [0.006, depth + 0.02], st.face('wood', c.wood), { skip: ['back'] });
    fbox(mb, fr, [u0 - 0.035, u1 + 0.035], [y1, y1 + 0.07], [0.006, depth + 0.045], st.face('wood', c.woodLight), { skip: ['back'] });
  }
  // 仕切りと棚
  const inner0 = u0 + (sides[0] ? t : 0);
  const inner1 = u1 - (sides[1] ? t : 0);
  const cols = opts.columns;
  const cw = (inner1 - inner0 - (cols - 1) * t) / cols;
  for (let k = 1; k < cols; k++) {
    const a = inner0 + k * cw + (k - 1) * t;
    fbox(mb, fr, [a, a + t], [y0 + plinth, y1 - 0.04], [0.006, depth - 0.005], sideF, { skip: ['back', 'bottom', 'top'] });
  }
  const yb = y0 + plinth;
  const yt = y1 - 0.04;
  const n = Math.max(1, Math.round((yt - yb) / opts.shelfSpacing));
  const sp = (yt - yb) / n;
  for (let col = 0; col < cols; col++) {
    const a = inner0 + col * (cw + t);
    const b = a + cw;
    for (let k = 0; k < n; k++) {
      const y = yb + k * sp;
      if (k > 0) {
        fbox(mb, fr, [a, b], [y - 0.022, y], [0.006, depth - 0.012], shelfF, { skip: ['left', 'right', 'back', 'front'], cell: 0.3 });
        rectFace(mb, fr, a, b, y - 0.022, y, edge, depth - 0.012, 0.3);
      }
      fillShelf(ctx, fr, a, b, y, sp - 0.024, depth - 0.02, 0.02);
    }
    // 列の上のアーチの額縁（前の面に、アーチの形を抜いた板と細い縁取り）
    if (opts.arch !== false) {
      const h: ArchHole = { u0: a, u1: b, sill: yt - Math.min(0.42, cw * 0.62), spring: yt - Math.min(0.42, cw * 0.62), top: yt - 0.012 };
      archFrameFace(mb, fr, { u0: a, u1: b, v0: h.spring, v1: yt }, h, st.face('wood', c.wood), { c: depth - 0.004, segments: 12 });
      archBand(mb, fr, h, 0.022, 0.012, st.face('wood', c.woodLight), { c: depth - 0.004, segments: 12 });
    }
  }
}

/**
 * 1 階の本棚の壁（壁の面の座標 fr。u は壁に沿う向き、n は部屋の側）：台輪、下の戸棚（鏡板の戸と真鍮のつまみ）と天板の棚、
 * 本の棚（区画ごと）、区画の間の柱形（台と柱頭）、上の帯。柱形の 1 つおきに燭台
 */
function lowerWall(ctx: BuildContext, fr: Frame, span: [number, number], baysIn: [number, number][], pilasters: number[], pierEnd: 0 | 1) {
  const { cfg, st, mb } = ctx;
  const c = cfg.colors;
  const R = cfg.room;
  const L = R.lowerCases;
  const g = wallGeometry(ctx);
  const D = L.depth;
  const y0 = g.floorY;
  const yT = g.fasciaBottom;
  const plinth = 0.12;
  const yc = y0 + plinth + L.cupboard;
  const ledge = 0.04;
  const frieze = 0.1;
  const pw = L.pilaster;
  const endW = 0.05;
  // 壁の端の柱の側の区画は、端の側板の分だけ狭める
  const bays = baysIn.map(([a, b]): [number, number] => [pierEnd === 0 && Math.abs(a - span[0]) < 1e-3 ? a + endW : a, pierEnd === 1 && Math.abs(b - span[1]) < 1e-3 ? b - endW : b]);
  // 台輪と、戸棚の上の天板（少し前へ出た明るい木口）、上の帯
  fbox(mb, fr, span, [y0, y0 + plinth], [0, D + 0.02], st.face('wood', c.woodDark), { skip: ['back', 'bottom'] });
  fbox(mb, fr, span, [yc, yc + ledge], [0, D + 0.05], st.face('wood', c.woodLight), { skip: ['back'] });
  fbox(mb, fr, span, [yT - frieze, yT], [0.006, D + 0.012], st.face('wood', c.wood), { skip: ['back', 'top'] });
  for (const [b0, b1] of bays) {
    // 戸棚の戸（2 枚の鏡板）とつまみ
    rectFace(mb, fr, b0, b1, y0 + plinth, yc, st.face('door', c.woodPanel), D - 0.012);
    const cu = (b0 + b1) / 2;
    for (const du of [-0.05, 0.05]) mb.sphere(at(fr, cu + du, y0 + plinth + L.cupboard * 0.62, D - 0.005), 0.013, st.face('brass', c.brass), 8, 5);
    // 本の棚：奥の板、棚板（前の縁は明るい木口）、本
    const ys = yc + ledge;
    const ye = yT - frieze;
    rectFace(mb, fr, b0, b1, ys, ye, st.face('woodV', c.woodDark), 0.006);
    const n = L.shelves;
    const sp = (ye - ys) / n;
    for (let k = 0; k < n; k++) {
      const y = ys + k * sp;
      if (k > 0) {
        fbox(mb, fr, [b0, b1], [y - 0.024, y], [0.006, D - 0.012], st.face('wood', c.wood), { skip: ['left', 'right', 'back', 'front'], cell: 0.3 });
        rectFace(mb, fr, b0, b1, y - 0.024, y, st.face('wood', c.woodLight), D - 0.012, 0.3);
      }
      fillShelf(ctx, fr, b0, b1, y, sp - 0.026, D - 0.03, 0.02);
    }
  }
  // 柱形（台・鏡板の柱身・柱頭）。区画の側板を兼ねる
  const pil = (u0: number, u1: number, capitals = true) => {
    mb.group(() => {
      fbox(mb, fr, [u0, u1], [y0 + plinth, yT - frieze], [0, D + 0.035], st.face('panel', c.wood), { skip: ['back', 'bottom', 'top'] });
      if (!capitals) return;
      fbox(mb, fr, [u0 - 0.012, u1 + 0.012], [y0 + plinth, y0 + plinth + 0.1], [0, D + 0.05], st.face('wood', c.woodDark), { skip: ['back', 'bottom'] });
      fbox(mb, fr, [u0 - 0.018, u1 + 0.018], [yT - frieze - 0.075, yT - frieze], [0, D + 0.055], st.face('wood', c.woodLight), { skip: ['back'] });
    });
  };
  pilasters.forEach((p) => pil(p - pw / 2, p + pw / 2));
  // 両端：奥の角の柱と、壁の端の柱の脇の側板（開いた側から見える）
  const first = Math.min(bays[0][0], pilasters[0] - pw / 2);
  const last = Math.max(bays[bays.length - 1][1], pilasters[pilasters.length - 1] + pw / 2);
  if (first - span[0] > 1e-3) pil(span[0], first, pierEnd !== 0);
  if (span[1] - last > 1e-3) pil(last, span[1], pierEnd !== 1);
  pilasters.forEach((p, i) => {
    if (i % 2 === 1) sconce(ctx, fr, p, 2.42, D + 0.035);
  });
  // 梯子を掛ける真鍮の手すり（本棚の上の帯の下を通し、柱形ごとに小さな腕で支える）
  {
    const brass = st.face('brass', c.brass);
    const yr = yT - frieze - 0.13;
    const cr = D + 0.1;
    const a = at(fr, span[0] + 0.06, yr, cr);
    const b = at(fr, span[1] - 0.06, yr, cr);
    mb.beam(a, b, 0.022, 0.022, brass, { cell: 0.3 });
    for (const p of pilasters) mb.beam(at(fr, p, yr, D + 0.035), at(fr, p, yr, cr + 0.011), 0.014, 0.014, brass, { cell: 1e3 });
  }
}

/** 1 階と 2 階の本棚 */
export function buildBookcases(ctx: BuildContext) {
  const { cfg, st, mb } = ctx;
  const c = cfg.colors;
  const R = cfg.room;
  const g = wallGeometry(ctx);
  const ps = g.pierStart;
  const cf = g.caseFront;

  // --- 1 階：奥の壁（u = x、角は左の本棚の前の面まで）と、左の壁（u = −z。手前の柱から奥の角へ） ---
  const back = wallFrame(V(0, 0, g.zi), V(0, 0, 1));
  lowerWall(ctx, back, [cf, ps], g.bays, g.pilasters, 1);
  const left = wallFrame(V(g.xi, 0, 0), V(1, 0, 0));
  const flip = (r: [number, number]): [number, number] => [-r[1], -r[0]];
  lowerWall(
    ctx,
    left,
    [-ps, -cf],
    g.bays.map(flip).reverse(),
    g.pilasters.map((p) => -p).reverse(),
    0,
  );

  // --- 2 階：左の壁の本棚（2 階の本棚はここだけ。1 階の区画の真上に 1 列ずつ、上端はそろえる） ---
  {
    const U = R.upperCases;
    const gy = g.gy;
    const y1 = U.top;
    const pw = R.lowerCases.pilaster;
    const shelf = (y1 - 0.04 - (gy + 0.11)) / U.shelves;
    for (const [z0, z1] of g.bays) {
      wallCase(ctx, left, -z1, -z0, gy, y1, U.depth, { columns: 1, shelfSpacing: shelf, cornice: false });
    }
    // 本棚の間の柱形（軒の下まで）
    g.pilasters.forEach((z, i) => {
      fbox(mb, left, [-z - pw / 2, -z + pw / 2], [gy, y1 - 0.04], [0, U.depth + 0.025], st.face('panel', c.wood), { skip: ['back', 'bottom', 'top'] });
      if (i % 2 === 1) sconce(ctx, left, -z, y1 - 0.62, U.depth + 0.025);
    });
    // 上の軒：手前の端から奥の角まで、すべての本棚の上を 1 本で通す
    {
      const u0 = -ps;
      const u1 = Math.max(...g.pilasters.map((z) => -z)) + pw / 2;
      mb.group(() => {
        fbox(mb, left, [u0, u1], [y1 - 0.04, y1], [0.006, U.depth + 0.032], st.face('wood', c.wood), { skip: ['back'] });
        fbox(mb, left, [u0, u1 + 0.02], [y1, y1 + 0.045], [0.006, U.depth + 0.05], st.face('wood', c.woodLight), { skip: ['back'] });
        fbox(mb, left, [u0, u1 + 0.035], [y1 + 0.045, y1 + 0.085], [0.006, U.depth + 0.07], st.face('wood', c.wood), { skip: ['back'] });
      });
    }
  }
}

/** 額縁の絵（金の額と、テクスチャを貼った画面） */
export function picture(ctx: BuildContext, fr: Frame, u: number, v: number, w: number, h: number, c0: number, map: 'painting' | 'paintingSmall') {
  const { st, mb, cfg } = ctx;
  const gold = st.face('gold', cfg.colors.brass);
  const fw = Math.min(w, h) * 0.12;
  const d = 0.03;
  fbox(mb, fr, [u - w / 2 - fw, u + w / 2 + fw], [v + h / 2, v + h / 2 + fw], [c0, c0 + d], gold, { skip: ['back'] });
  fbox(mb, fr, [u - w / 2 - fw, u + w / 2 + fw], [v - h / 2 - fw, v - h / 2], [c0, c0 + d], gold, { skip: ['back'] });
  fbox(mb, fr, [u - w / 2 - fw, u - w / 2], [v - h / 2, v + h / 2], [c0, c0 + d], gold, { skip: ['back', 'top', 'bottom'] });
  fbox(mb, fr, [u + w / 2, u + w / 2 + fw], [v - h / 2, v + h / 2], [c0, c0 + d], gold, { skip: ['back', 'top', 'bottom'] });
  // 画面（テクスチャ）：面の座標の板
  const geo = new THREE.PlaneGeometry(w, h);
  const m = new THREE.Matrix4().makeBasis(fr.u, fr.v, fr.n).setPosition(at(fr, u, v, c0 + d * 0.4));
  geo.applyMatrix4(m);
  ctx.textured.push({ name: 'picture', geometry: geo, map, roughness: 0.6 });
}

export { fbox };

function wallCase(...args:Parameters<typeof original_wallCase>):ReturnType<typeof original_wallCase> { return captureFurniture("wallCase",args[0],()=>original_wallCase(...args)); }

export function sconce(...args:Parameters<typeof original_sconce>):ReturnType<typeof original_sconce> { return captureFurniture("sconce",args[0],()=>original_sconce(...args)); }
