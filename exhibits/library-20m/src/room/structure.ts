import { V, type BuildContext } from './context';
import { outlinePoints } from './shape';
import { archFill, archReveal, at, rectFace, wallFrame, type ArchHole, type Frame } from './arch';
import { fbox, holeReveal, ionicCapital, slenderColumn, stripFace, windowJoinery, windowSurround } from './windows';
import { arcPath, extrudeProfile, joinPaths } from './molding';
import { sconce } from './bookcases';
import type { FaceInfo, MeshBuilder } from '../meshBuilder';

/**
 * 部屋の骨組み：大理石の台、奥と左の壁（同じ高さ）と笠石、奥の左の丸い角、壁の端の柱、
 * 奥の壁の上の窓（まん中のセルリアーナと両脇のアーチの窓）、窓の間の柱形、壁の上の軒の刳り形。
 * 座標は config.ts の説明のとおり（台座は一辺 10、床 y = 0）
 */

/** 大理石の台：外側の面（2 段の石積み）、上の縁の丸み、縁の上面、縁の内側（床との段差） */
export function buildSlab(ctx: BuildContext) {
  const { cfg, st, mb } = ctx;
  const c = cfg.colors;
  const y0 = cfg.pedestal.thickness;
  const yTop = cfg.room.slab.top;
  const rim = cfg.room.slab.rimWidth;
  const floorY = cfg.room.slab.floorY;
  const er = 0.035;
  const pts = outlinePoints(ctx.base, 10, 8);
  const n = pts.length;
  const total = pts[n - 1].s + Math.hypot(pts[0].x - pts[n - 1].x, pts[0].z - pts[n - 1].z);
  const marble = st.face('marble', c.marble);
  const rimTop = st.face('marbleTop', c.rim);
  const rimInner = st.face('marbleTop', c.marble);
  const m = 4;
  const off = (p: (typeof pts)[number], o: number, y: number) => V(p.x + p.nx * o, y, p.z + p.nz * o);
  for (let i = 0; i < n; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % n];
    if (Math.hypot(b.x - a.x, b.z - a.z) < 1e-6) continue;
    const sb = i + 1 === n ? total : b.s;
    const out = V(a.nx + b.nx, 0, a.nz + b.nz).normalize();
    // 外側の面：外から見て左が b、右が a（外周は上から見て時計回り）。模様の u は外から見て右へ増える
    mb.quadAuto(off(b, 0, y0), off(a, 0, y0), off(a, 0, yTop - er), off(b, 0, yTop - er), out, marble, { uOffset: total - sb, v0: 0 });
    // 上の縁の丸み
    for (let k = 0; k < m; k++) {
      const p0 = (k / m) * (Math.PI / 2);
      const p1 = ((k + 1) / m) * (Math.PI / 2);
      const o0 = er * (Math.cos(p0) - 1);
      const o1 = er * (Math.cos(p1) - 1);
      const yy0 = yTop - er + er * Math.sin(p0);
      const yy1 = yTop - er + er * Math.sin(p1);
      const pm = (p0 + p1) / 2;
      const nrm = out.clone().multiplyScalar(Math.cos(pm)).add(V(0, Math.sin(pm), 0));
      // 模様の v は目地（v = 0, 6, …）から離しておく（細い帯の面に目地の線が並ばないように）
      mb.quadAuto(off(b, o0, yy0), off(a, o0, yy0), off(a, o1, yy1), off(b, o1, yy1), nrm, rimTop, { uOffset: total - sb, cell: 1e3, v0: 1 + k * 0.02 });
    }
    // 縁の上面
    mb.quadAuto(off(b, -er, yTop), off(a, -er, yTop), off(a, -rim, yTop), off(b, -rim, yTop), V(0, 1, 0), rimTop, { uOffset: total - sb, v0: 1.1 });
    // 縁の内側の面（床から縁の上面まで）
    mb.quadAuto(off(a, -rim, floorY), off(b, -rim, floorY), off(b, -rim, yTop), off(a, -rim, yTop), out.clone().negate(), rimInner, { cell: 1e3, v0: 2 });
  }
  ctx.floorOutline = pts.map((p) => [p.x - p.nx * rim, p.z - p.nz * rim]);
}

/**
 * 柱形の並び（奥の壁の x と左の壁の z に同じ並びを使う。部屋は奥の左の角を通る斜めの線について対称）：
 * 2 階の窓の間の柱形（セルリアーナとアーチの窓のまん中）の間を 3 つに分けた間隔で、1 階の本棚の区画を割る。
 * 最後の区画の先から壁の端までが、壁の端の柱
 */
function bayRhythm(ctx: BuildContext, caseFront: number) {
  const R = ctx.cfg.room;
  const W = R.windows;
  const S = W.serliana;
  const half = S.width / 2 + S.mullion + S.side;
  const aw = W.arched.width;
  const pL = (W.center - W.spacing + aw / 2 + (W.center - half)) / 2;
  const pR = (W.center + half + (W.center + W.spacing - aw / 2)) / 2;
  const step = (pR - pL) / 3;
  const pw = R.lowerCases.pilaster;
  const end = R.wall.backEnd;
  const pilasters: number[] = [];
  for (let k = -12; k <= 12; k++) {
    const p = pL + k * step;
    if (p - pw / 2 < caseFront + 0.1) continue;
    if (p + step - pw / 2 > end - 0.3) break;
    pilasters.push(p);
  }
  const last = pilasters[pilasters.length - 1];
  const pierStart = last + step - pw / 2;
  const bays: [number, number][] = pilasters.slice(0, -1).map((p, i) => [p + pw / 2, pilasters[i + 1] - pw / 2]);
  bays.push([last + pw / 2, pierStart]);
  return { pilasters, bays, pierStart, step, upper: [pL, pR] as [number, number] };
}

/** 壁の寸法（ほかの組み立てでも使う） */
export function wallGeometry(ctx: BuildContext) {
  const R = ctx.cfg.room;
  const W = R.wall;
  const hx = ctx.base.hx;
  const hz = ctx.base.hz;
  const xo = -hx + W.inset;
  const xi = xo + W.thickness;
  const zo = -hz + W.inset;
  const zi = zo + W.thickness;
  const rb = R.base.radius.backLeft;
  const blc = { x: -hx + rb, z: -hz + rb };
  const rBLo = rb - W.inset;
  const rBLi = rBLo - W.thickness;
  const caseFront = xi + R.lowerCases.depth;
  const rh = bayRhythm(ctx, caseFront);
  const gy = R.gallery.y;
  return {
    xo,
    xi,
    zo,
    zi,
    blc,
    rBLo,
    rBLi,
    top: W.top,
    yb: R.slab.top,
    floorY: R.slab.floorY,
    gy,
    /** 回廊の縁（左の回廊の x、奥の回廊の z） */
    edge: xi + R.gallery.depth,
    /** 回廊の鼻隠しの下端（1 階の本棚の上端） */
    fasciaBottom: gy - R.gallery.deck - R.gallery.fascia,
    /** 1 階の本棚の前の面（左の本棚の x、奥の本棚の z） */
    caseFront,
    /** 壁の端の柱の始まり（左の壁は z、奥の壁は x）と終わり */
    pierStart: rh.pierStart,
    leftEnd: W.leftEnd,
    backEnd: W.backEnd,
    pilasters: rh.pilasters,
    bays: rh.bays,
    step: rh.step,
    upperPilasters: rh.upper,
    entablature: R.entablature.bottom,
  };
}

/** 奥の上の窓の開口（部屋の側の面の座標 u = x）：アーチの窓 2 つと、セルリアーナ（両脇の四角い窓・中央のアーチの窓） */
export function windowHoles(ctx: BuildContext) {
  const W = ctx.cfg.room.windows;
  const S = W.serliana;
  const C = W.center;
  const arched = [C - W.spacing, C + W.spacing].map((cx): ArchHole => ({ u0: cx - W.arched.width / 2, u1: cx + W.arched.width / 2, sill: W.sill, spring: W.spring, top: W.arched.top }));
  const center: ArchHole = { u0: C - S.width / 2, u1: C + S.width / 2, sill: W.sill, spring: W.spring, top: S.top };
  const sideL: ArchHole = { u0: C - S.width / 2 - S.mullion - S.side, u1: C - S.width / 2 - S.mullion, sill: W.sill, spring: W.spring, top: W.spring };
  const sideR: ArchHole = { u0: C + S.width / 2 + S.mullion, u1: C + S.width / 2 + S.mullion + S.side, sill: W.sill, spring: W.spring, top: W.spring };
  return { arched, center, sideL, sideR, all: [arched[0], sideL, center, sideR, arched[1]] };
}

/** 壁の上の軒の刳り形の断面（壁の面からの出 d、高さ y）：台輪・帯・繰形・軒 */
function entablatureProfile(y0: number, top: number): [number, number][] {
  const h = top - y0;
  const Y = (t: number) => y0 + h * t;
  // 台輪（下の帯）・帯（平らな面）・歯飾りの下地・軒の下端・軒・頂の繰形
  return [
    [0, Y(0)],
    [0.035, Y(0)],
    [0.035, Y(0.175)],
    [0.022, Y(0.2)],
    [0.022, Y(0.5)],
    [0.04, Y(0.5)],
    [0.04, Y(0.65)],
    [0.13, Y(0.65)],
    [0.13, Y(0.85)],
    [0.15, Y(0.88)],
    [0.15, Y(0.95)],
    [0.0, Y(1)],
  ];
}

/** 道に沿って一定の間隔で点を置く（点、進む向き、部屋の側の向き） */
function alongPath(path: [number, number][], step: number, fn: (p: [number, number], t: [number, number], n: [number, number]) => void, margin = 0) {
  const seg = path.slice(1).map((p, i) => Math.hypot(p[0] - path[i][0], p[1] - path[i][1]));
  const total = seg.reduce((s, v) => s + v, 0);
  const count = Math.floor((total - 2 * margin) / step);
  const start = (total - count * step) / 2;
  for (let k = 0; k <= count; k++) {
    let d = start + k * step;
    let i = 0;
    while (i < seg.length - 1 && d > seg[i]) d -= seg[i++];
    const a = path[i];
    const b = path[i + 1];
    const tt = Math.min(1, d / (seg[i] || 1));
    const t: [number, number] = [(b[0] - a[0]) / (seg[i] || 1), (b[1] - a[1]) / (seg[i] || 1)];
    fn([a[0] + (b[0] - a[0]) * tt, a[1] + (b[1] - a[1]) * tt], t, [-t[1], t[0]]);
  }
}

/** 水平な向き（t：進む向き、n：外向き）の小さな箱（歯飾りなど）。p は壁の面の点、d0〜d1 は面からの出 */
function orientedBox(mb: MeshBuilder, p: [number, number], t: [number, number], n: [number, number], w: number, d: [number, number], y: [number, number], f: FaceInfo) {
  const P = (s: number, dd: number, yy: number) => V(p[0] + t[0] * s + n[0] * dd, yy, p[1] + t[1] * s + n[1] * dd);
  const b = [P(-w / 2, d[1], y[0]), P(w / 2, d[1], y[0]), P(w / 2, d[0], y[0]), P(-w / 2, d[0], y[0])];
  const tp = [P(-w / 2, d[1], y[1]), P(w / 2, d[1], y[1]), P(w / 2, d[0], y[1]), P(-w / 2, d[0], y[1])];
  mb.hexa(b, tp, f, { skip: ['back', 'top'], cell: 1e3 });
}

/** 部屋の側の壁の面に沿う道（左の壁の手前の柱から、奥の左の丸い角を回って、奥の壁の右の柱まで） */
export function wallPath(ctx: BuildContext, offset = 0): [number, number][] {
  const g = wallGeometry(ctx);
  const r = g.rBLi - offset;
  return joinPaths(
    [
      [g.xi + offset, g.pierStart],
      [g.xi + offset, g.blc.z],
    ],
    arcPath([g.blc.x, g.blc.z], r, Math.PI, Math.PI * 1.5, 18),
    [
      [g.blc.x, g.zi + offset],
      [g.pierStart, g.zi + offset],
    ],
  );
}

/** 壁・笠石・柱・窓 */
export function buildWalls(ctx: BuildContext) {
  const { cfg, st, mb } = ctx;
  const c = cfg.colors;
  const R = cfg.room;
  const g = wallGeometry(ctx);
  const { xo, xi, zo, zi, blc, rBLo, rBLi, top, yb, gy } = g;
  const stone = st.face('stone', c.stone);
  const ext = st.face('ashlar', c.ashlar);
  const trim = st.face('trim', c.coping);
  const cop = st.face('coping', c.coping);
  const ov = R.coping.overhang;
  const ch = R.coping.height;
  const ps = g.pierStart;
  const E = g.entablature;

  // --- 左の壁（奥の角から手前の柱まで。部屋の側は回廊の床から上：下は 1 階の本棚、上は 2 階の本棚の裏）。
  //     外側は 2 階の高さに、本棚の区画ごとの浅いアーチの窪み（めくらアーチ。奥の壁の窓と同じ高さ） ---
  {
    const outerLeft = wallFrame(V(xo, 0, 0), V(-1, 0, 0));
    const Wn = R.windows;
    const blind: ArchHole[] = g.bays
      .filter(([a]) => a > blc.z + 0.05)
      .map(([a, b]) => {
        const cu = (a + b) / 2;
        const hw = 0.29;
        return { u0: cu - hw, u1: cu + hw, sill: Wn.sill, spring: Wn.spring, top: Wn.spring + hw };
      });
    stripFace(mb, outerLeft, blc.z, ps, yb, top, blind, ext);
    for (const h of blind) {
      archReveal(mb, outerLeft, h, 0, -0.07, ext, { sill: cop });
      archFill(mb, outerLeft, h, ext, -0.07);
      windowSurround(ctx, outerLeft, h, { width: 0.06, depth: 0.02, keystone: false, face: cop });
    }
  }
  rectFace(mb, wallFrame(V(xi, 0, 0), V(1, 0, 0)), -ps, -blc.z, gy, top, stone);
  mb.aabb([xo - ov, xi + ov], [top, top + ch], [blc.z, ps], cop, { skip: ['bottom', 'back', 'front'] });

  // --- 奥の左の角：外側も内側も同じ中心の丸み ---
  {
    const seg = 24;
    const p = (t: number, r: number, y: number) => V(blc.x + r * Math.cos(t), y, blc.z + r * Math.sin(t));
    const arcO = (rBLo * Math.PI) / 2 / seg;
    const arcI = (rBLi * Math.PI) / 2 / seg;
    const y1 = top + ch;
    for (let i = 0; i < seg; i++) {
      const t0 = Math.PI + (i / seg) * (Math.PI / 2);
      const t1 = Math.PI + ((i + 1) / seg) * (Math.PI / 2);
      const out = V(Math.cos((t0 + t1) / 2), 0, Math.sin((t0 + t1) / 2));
      mb.quadAuto(p(t0, rBLo, yb), p(t1, rBLo, yb), p(t1, rBLo, top), p(t0, rBLo, top), out, ext, { uOffset: i * arcO });
      mb.quadAuto(p(t1, rBLi, gy), p(t0, rBLi, gy), p(t0, rBLi, top), p(t1, rBLi, top), out.clone().negate(), stone, { uOffset: (seg - 1 - i) * arcI });
      mb.quadAuto(p(t0, rBLo + ov, y1), p(t1, rBLo + ov, y1), p(t1, rBLi - ov, y1), p(t0, rBLi - ov, y1), V(0, 1, 0), cop, { uOffset: i * arcO });
      mb.quadAuto(p(t0, rBLo + ov, top), p(t1, rBLo + ov, top), p(t1, rBLo + ov, y1), p(t0, rBLo + ov, y1), out, cop, { uOffset: i * arcO });
      mb.quadAuto(p(t0, rBLi - ov, top), p(t1, rBLi - ov, top), p(t1, rBLi - ov, y1), p(t0, rBLi - ov, y1), out.clone().negate(), cop, { uOffset: i * arcI });
    }
  }

  // --- 奥の壁（上の窓の開口つき）と笠石 ---
  const holes = windowHoles(ctx);
  const outerBack = wallFrame(V(0, 0, zo), V(0, 0, -1));
  const innerBack = wallFrame(V(0, 0, zi), V(0, 0, 1));
  const outerHoles = holes.all.map((h) => ({ ...h, u0: -h.u1, u1: -h.u0 }));
  stripFace(mb, outerBack, -ps, -blc.x, yb, top, outerHoles, ext);
  stripFace(mb, innerBack, blc.x, ps, gy, top, holes.all, stone);
  mb.aabb([blc.x, ps], [top, top + ch], [zo - ov, zi + ov], cop, { skip: ['bottom', 'left', 'right'] });
  const sillF = st.face('trim', c.coping);
  for (const h of holes.all) {
    holeReveal(mb, innerBack, h, 0, -R.wall.thickness, stone, { sill: sillF });
    const w = h.u1 - h.u0;
    windowJoinery(ctx, innerBack, h, -R.wall.thickness / 2, { cols: w > 1 ? 4 : w > 0.6 ? 3 : 2, rows: 4 });
  }
  // 外側の窓の枠（細いアーチの帯と窓台）
  for (const h of outerHoles) windowSurround(ctx, outerBack, h, { width: 0.06, depth: 0.02, keystone: false, face: cop });
  // 部屋の側：アーチの窓の石の枠と要石・窓台
  for (const h of holes.arched) windowSurround(ctx, innerBack, h, { width: 0.08, depth: 0.03 });
  serliana(ctx, innerBack, holes);

  // 窓の間の柱形（イオニア式の柱頭）と、壁の両端の柱形。窓の間の柱形には燭台
  {
    const W = R.windows;
    const [pL, pR] = g.upperPilasters;
    const outerOff = W.spacing + W.arched.width / 2 + 0.42;
    const list = [W.center - outerOff, pL, pR, W.center + outerOff];
    for (const px of list) {
      const pw = 0.24;
      mb.group(() => {
        fbox(mb, innerBack, [px - pw / 2 - 0.035, px + pw / 2 + 0.035], [gy, gy + 0.16], [0, 0.095], trim, { skip: ['back', 'bottom'] });
        fbox(mb, innerBack, [px - pw / 2, px + pw / 2], [gy + 0.16, E - 0.1], [0, 0.065], stone, { skip: ['back', 'bottom', 'top'] });
      });
      ionicCapital(ctx, innerBack, px, E - 0.1, pw, 0.065, trim);
    }
    for (const px of [pL, pR]) sconce(ctx, innerBack, px, 4.78, 0.065);
  }

  // 回廊の高さの幅木（奥の壁と丸い角。左の壁は 2 階の本棚の台輪）
  {
    const path = wallPath(ctx).filter((p) => p[0] >= g.xi - 1e-6 && (p[1] <= blc.z + 1e-6));
    extrudeProfile(mb, path, [
      [0, gy],
      [0.028, gy],
      [0.028, gy + 0.11],
      [0.014, gy + 0.125],
      [0.0, gy + 0.13],
    ], st.face('wood', c.woodDark));
  }

  // 壁の上の軒の刳り形（左の壁から丸い角を回って奥の壁へ）と、その下の歯飾り
  {
    const path = wallPath(ctx);
    const prof = entablatureProfile(E, top);
    extrudeProfile(mb, path, prof, trim);
    const h = top - E;
    alongPath(path, 0.055, (p, t, n) => orientedBox(mb, p, t, n, 0.026, [0.03, 0.085], [E + h * 0.535, E + h * 0.65], trim), 0.08);
  }

  // --- 壁の外側：回廊の床の高さの帯石と、下の台石（奥の壁の右の端から、丸い角を回って左の壁の手前の端まで） ---
  {
    const outerPath = joinPaths(
      [
        [ps, zo],
        [blc.x, zo],
      ],
      arcPath([blc.x, blc.z], rBLo, Math.PI * 1.5, Math.PI, 18),
      [
        [xo, blc.z],
        [xo, ps],
      ],
    );
    extrudeProfile(mb, outerPath, [
      [0, gy - 0.02],
      [0.035, gy - 0.005],
      [0.035, gy + 0.075],
      [0.02, gy + 0.095],
      [0, gy + 0.1],
    ], cop, { capStart: true, capEnd: true });
    extrudeProfile(mb, outerPath, [
      [0, yb],
      [0.028, yb],
      [0.028, yb + 0.26],
      [0.012, yb + 0.3],
      [0, yb + 0.31],
    ], cop, { capStart: true, capEnd: true });
  }

  // --- 壁の端の柱：左の壁の手前の端と、奥の壁の右の端（台座・柱身の切石・軒の高さの帯・頭の石） ---
  pier(ctx, [xo - R.pier.outer, xi + R.pier.projection], [ps, g.leftEnd], 'x');
  pier(ctx, [ps, g.backEnd], [zo - R.pier.outer, zi + R.pier.projection], 'z');
}

/** 壁の端の柱（x と z の範囲）。outerAxis は壁の外の面の向き（'x' なら −x の面が外） */
function pier(ctx: BuildContext, x: [number, number], z: [number, number], outerAxis: 'x' | 'z') {
  const { cfg, st, mb } = ctx;
  const c = cfg.colors;
  const R = cfg.room;
  const g = wallGeometry(ctx);
  const cop = st.face('coping', c.coping);
  const trim = st.face('trim', c.coping);
  const ext = st.face('ashlar', c.ashlar);
  const E = g.entablature;
  const top = g.top;
  const ov = R.coping.overhang;
  // 外の面の側は台座の縁より外へ出さない
  const grow = (r: [number, number], e: number, axis: 'x' | 'z'): [number, number] => (axis === outerAxis ? [r[0] - Math.min(e, 0.0), r[1] + e] : [r[0] - e, r[1] + e]);
  mb.aabb(grow(x, 0.035, 'x'), [g.floorY, g.yb + 0.34], grow(z, 0.035, 'z'), cop, { skip: ['bottom'] });
  mb.aabb(grow(x, 0.05, 'x'), [g.yb + 0.34, g.yb + 0.4], grow(z, 0.05, 'z'), trim, {});
  mb.aabb(x, [g.yb + 0.4, E], z, ext, { skip: ['bottom', 'top'] });
  mb.aabb(grow(x, 0.04, 'x'), [E, E + 0.08], grow(z, 0.04, 'z'), trim, {});
  mb.aabb(grow(x, 0.02, 'x'), [E + 0.08, top - 0.1], grow(z, 0.02, 'z'), trim, { skip: ['bottom'] });
  mb.aabb(grow(x, 0.07, 'x'), [top - 0.1, top], grow(z, 0.07, 'z'), trim, {});
  const capX: [number, number] = outerAxis === 'x' ? [x[0] - 0.0, x[1] + ov] : [x[0] - ov, x[1] + ov];
  const capZ: [number, number] = outerAxis === 'z' ? [z[0] - 0.0, z[1] + ov] : [z[0] - ov, z[1] + ov];
  mb.aabb(capX, [top, top + R.coping.height + 0.03], capZ, cop, {});
}

/**
 * セルリアーナ（ヴェネツィア窓）の部屋の側：両脇の四角い窓の石の枠と、その上の水平の梁（中央のアーチの始まりの高さ）、
 * 窓の間の細いイオニア式の柱、中央のアーチの枠と要石、全体の下の長い窓台
 */
function serliana(ctx: BuildContext, fr: Frame, holes: ReturnType<typeof windowHoles>) {
  const { cfg, st, mb } = ctx;
  const trim = st.face('trim', cfg.colors.coping);
  const { sideL, sideR, center } = holes;
  const bw = 0.08;
  const spring = center.spring;
  // 長い窓台
  fbox(mb, fr, [sideL.u0 - bw - 0.08, sideR.u1 + bw + 0.08], [center.sill - 0.07, center.sill], [0, 0.11], trim, { skip: ['back'] });
  // 両脇の窓の外側の枠
  fbox(mb, fr, [sideL.u0 - bw, sideL.u0], [center.sill, spring], [0, 0.035], trim, { skip: ['back', 'bottom', 'top'] });
  fbox(mb, fr, [sideR.u1, sideR.u1 + bw], [center.sill, spring], [0, 0.035], trim, { skip: ['back', 'bottom', 'top'] });
  // 両脇の窓の上の梁（柱の頭からアーチの始まりまで）
  for (const [a, b] of [
    [sideL.u0 - bw - 0.03, center.u0 + 0.015],
    [center.u1 - 0.015, sideR.u1 + bw + 0.03],
  ] as [number, number][]) {
    mb.group(() => {
      fbox(mb, fr, [a, b], [spring, spring + 0.07], [0, 0.06], trim, { skip: ['back'] });
      fbox(mb, fr, [a - 0.02, b + 0.02], [spring + 0.07, spring + 0.11], [0, 0.085], trim, { skip: ['back'] });
    });
  }
  // 窓の間の細い柱（窓台から梁まで）
  for (const u of [(sideL.u1 + center.u0) / 2, (center.u1 + sideR.u0) / 2]) slenderColumn(ctx, fr, u, 0.06, center.sill, spring, 0.042, trim);
  // 中央のアーチの枠（梁の上から）と要石
  const arch: ArchHole = { u0: center.u0, u1: center.u1, sill: spring + 0.11, spring, top: center.top };
  windowSurroundArchOnly(ctx, fr, arch, trim);
}

/** アーチの部分だけの枠（始まりから上）と要石 */
function windowSurroundArchOnly(ctx: BuildContext, fr: Frame, h: ArchHole, f: FaceInfo) {
  const { mb } = ctx;
  // holeOutline は窓台から始まるので、始まりの高さを窓台にした開口にして、アーチだけの帯にする
  const a: ArchHole = { ...h, sill: h.spring };
  // 帯
  const seg = 16;
  const cu = (a.u0 + a.u1) / 2;
  const rx = (a.u1 - a.u0) / 2;
  const ry = a.top - a.spring;
  const width = 0.085;
  const depth = 0.035;
  const pt = (t: number, o: number): [number, number] => [cu + (rx + o) * Math.cos(t), a.spring + (ry + o) * Math.sin(t)];
  mb.group(() => {
    for (let i = 0; i < seg; i++) {
      const t0 = Math.PI * (1 - i / seg);
      const t1 = Math.PI * (1 - (i + 1) / seg);
      const [i0, i1, o0, o1] = [pt(t0, 0), pt(t1, 0), pt(t0, width), pt(t1, width)];
      mb.quadAuto(at(fr, i0[0], i0[1], depth), at(fr, i1[0], i1[1], depth), at(fr, o1[0], o1[1], depth), at(fr, o0[0], o0[1], depth), fr.n, f);
      const mid = (t0 + t1) / 2;
      const out = fr.u.clone().multiplyScalar(Math.cos(mid)).addScaledVector(fr.v, Math.sin(mid));
      mb.quadAuto(at(fr, o0[0], o0[1], 0), at(fr, o1[0], o1[1], 0), at(fr, o1[0], o1[1], depth), at(fr, o0[0], o0[1], depth), out, f);
      mb.quadAuto(at(fr, i0[0], i0[1], 0), at(fr, i1[0], i1[1], 0), at(fr, i1[0], i1[1], depth), at(fr, i0[0], i0[1], depth), out.clone().negate(), f);
    }
  });
  // 要石
  const k = { width: 0.15, height: 0.22, depth: depth + 0.03 };
  const y0 = a.top - k.height * 0.3;
  const p = (u: number, v: number, cc: number) => at(fr, u, v, cc);
  const b = [p(cu - k.width * 0.38, y0, k.depth), p(cu + k.width * 0.38, y0, k.depth), p(cu + k.width * 0.38, y0, 0), p(cu - k.width * 0.38, y0, 0)];
  const t = [p(cu - k.width / 2, y0 + k.height, k.depth), p(cu + k.width / 2, y0 + k.height, k.depth), p(cu + k.width / 2, y0 + k.height, 0), p(cu - k.width / 2, y0 + k.height, 0)];
  mb.hexa(b, t, f, { skip: ['back'] });
}

export { at };
