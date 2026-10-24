import { captureFurniture } from '../../../shared/asset-capture';
import * as THREE from 'three';
import { V, type BuildContext } from './context';
import { wallGeometry } from './structure';
import type { FaceInfo } from '../meshBuilder';

/**
 * 家具と小物：長机と椅子と緑のランプ、机の上の本、地球儀、革の肘掛け椅子と小机のランプ、
 * アルコーブの机、回廊の机、窓の下の小机、梯子、鉢植え。
 * 位置は参考画像の点を床・回廊の床へ逆投影して決めた
 */

/** 水平な向き（angle：+z から +x へ、度）の前と右 */
function basis(angleDeg: number) {
  const a = THREE.MathUtils.degToRad(angleDeg);
  const f = V(Math.sin(a), 0, Math.cos(a));
  const r = V(Math.cos(a), 0, -Math.sin(a));
  return { f, r };
}

/** 中心 c（床の位置）から、前 f と右 r の向きの局所座標で点を作る */
function local(c: THREE.Vector3, b: { f: THREE.Vector3; r: THREE.Vector3 }) {
  return (x: number, y: number, z: number) => c.clone().addScaledVector(b.r, x).addScaledVector(b.f, z).add(V(0, y, 0));
}

/** 局所座標の箱（x：右、y：上、z：前の範囲） */
function lbox(ctx: BuildContext, P: (x: number, y: number, z: number) => THREE.Vector3, x: [number, number], y: [number, number], z: [number, number], f: FaceInfo, opts: { top?: FaceInfo; skip?: ('front' | 'right' | 'back' | 'left' | 'top' | 'bottom')[] } = {}) {
  const b = [P(x[0], y[0], z[1]), P(x[1], y[0], z[1]), P(x[1], y[0], z[0]), P(x[0], y[0], z[0])];
  const t = [P(x[0], y[1], z[1]), P(x[1], y[1], z[1]), P(x[1], y[1], z[0]), P(x[0], y[1], z[0])];
  ctx.mb.hexa(b, t, f, { cell: 0.2, ...opts });
}

/** 背もたれに細い棒の並ぶ木の椅子（座面の中心が c、座る人が向く向き angle） */
function original_chair(ctx: BuildContext, c: THREE.Vector3, angle: number) {
  const { st, cfg, mb } = ctx;
  const col = cfg.colors;
  const wood = st.face('wood', col.woodLight, 0.06, ctx.rand);
  const dark = st.face('wood', col.wood, 0.05, ctx.rand);
  const P = local(c, basis(angle));
  const seat = 0.46;
  const hw = 0.2;
  const hd = 0.19;
  lbox(ctx, P, [-hw, hw], [seat - 0.045, seat], [-hd, hd + 0.02], wood, { top: wood });
  // 脚（少し外へ開く）と貫
  for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]] as [number, number][]) {
    mb.beam(P(sx * (hw - 0.03), seat - 0.045, sz * (hd - 0.03)), P(sx * (hw + 0.0), 0, sz * (hd + 0.01)), 0.035, 0.035, dark, { cell: 1e3 });
  }
  mb.beam(P(-hw + 0.01, 0.16, 0), P(hw - 0.01, 0.16, 0), 0.022, 0.022, dark, { cell: 1e3 });
  // 背もたれ：後ろの 2 本の柱、上の笠木、細い棒
  const by = 0.97;
  for (const sx of [-1, 1]) mb.beam(P(sx * (hw - 0.025), seat - 0.04, -hd + 0.02), P(sx * (hw - 0.02), by, -hd - 0.05), 0.035, 0.035, dark, { cell: 1e3 });
  mb.beam(P(-hw + 0.005, by - 0.03, -hd - 0.05), P(hw - 0.005, by - 0.03, -hd - 0.05), 0.07, 0.04, wood, { cell: 1e3 });
  mb.beam(P(-hw + 0.02, seat + 0.24, -hd - 0.015), P(hw - 0.02, seat + 0.24, -hd - 0.015), 0.035, 0.025, dark, { cell: 1e3 });
  for (let i = 1; i <= 4; i++) {
    const x = -hw + 0.025 + (i * (2 * hw - 0.05)) / 5;
    mb.beam(P(x, seat, -hd + 0.01), P(x, by - 0.06, -hd - 0.048), 0.018, 0.018, wood, { cell: 1e3 });
  }
}

/** 緑のガラスの笠のバンカーズランプ（真鍮の台と柱、横長の半円筒の笠）。灯りも登録する */
function original_bankersLamp(ctx: BuildContext, c: THREE.Vector3, angle: number, scale = 1) {
  const { st, cfg, mb, lamps } = ctx;
  const col = cfg.colors;
  const brass = st.face('brass', col.brass);
  const s = scale;
  mb.lathe([c.x, c.z], [[0.0, c.y], [0.065 * s, c.y + 0.004], [0.07 * s, c.y + 0.018 * s], [0.045 * s, c.y + 0.032 * s], [0.014 * s, c.y + 0.045 * s], [0.011 * s, c.y + 0.27 * s], [0.016 * s, c.y + 0.285 * s]], brass, 12, { capBottom: false });
  // 笠：横向きの半円筒（前と後ろへ垂れる）
  const b = basis(angle);
  const cy = c.y + 0.3 * s;
  const L = 0.24 * s;
  const r = 0.075 * s;
  const green = st.face('shade', col.lampGreen);
  const inner = st.face('glow', '#fff4d6');
  const seg = 10;
  const ring = (t: number, rr: number) => {
    const a = Math.PI * (t / seg);
    return (x: number) => V(c.x, cy - r * 0.35 + rr * Math.sin(a), c.z).addScaledVector(b.r, x).addScaledVector(b.f, rr * Math.cos(a));
  };
  // 外側：なめらかな法線の曲面（つやのある色ガラスに、切れ目のない光の帯が映る）
  mb.group(() => {
    const nx = 4;
    const start = mb.vertexCount;
    for (let i = 0; i <= seg; i++) {
      const a = Math.PI * (i / seg);
      const nrm = b.f.clone().multiplyScalar(Math.cos(a)).add(V(0, Math.sin(a), 0)).normalize();
      for (let j = 0; j <= nx; j++) {
        const x = -L / 2 + (L * j) / nx;
        mb.addVertex(ring(i, r)(x), nrm, green, x + L / 2, (i / seg) * Math.PI * r, L, Math.PI * r);
      }
    }
    for (let i = 0; i < seg; i++) {
      for (let j = 0; j < nx; j++) {
        const k = start + i * (nx + 1) + j;
        mb.indices.push(k, k + 1, k + nx + 2, k, k + nx + 2, k + nx + 1);
      }
    }
  });
  // 内側（灯りに照らされた明るい面）
  for (let i = 0; i < seg; i++) {
    const i0 = ring(i, r * 0.93);
    const i1 = ring(i + 1, r * 0.93);
    const mid = Math.PI * ((i + 0.5) / seg);
    const out = b.f.clone().multiplyScalar(Math.cos(mid)).add(V(0, Math.sin(mid), 0));
    mb.quadAuto(i0(-L / 2), i0(L / 2), i1(L / 2), i1(-L / 2), out.clone().negate(), inner, { cell: 1e3 });
  }
  // 笠の両端（半円の板）
  for (const sx of [-1, 1]) {
    const cen = V(c.x, cy - r * 0.35, c.z).addScaledVector(b.r, (sx * L) / 2);
    for (let i = 0; i < seg; i++) {
      const p0 = ring(i, r)((sx * L) / 2);
      const p1 = ring(i + 1, r)((sx * L) / 2);
      const q0 = cen.clone().lerp(p0, 0.04);
      const q1 = cen.clone().lerp(p1, 0.04);
      mb.quadAuto(q0, q1, p1, p0, b.r.clone().multiplyScalar(sx), green, { cell: 1e3 });
    }
  }
  lamps.push({ position: V(c.x, cy - r * 0.6, c.z), color: new THREE.Color('#ffe2a8'), range: cfg.lamps.tableRange * s, intensity: cfg.lamps.tableIntensity });
}

/** 本を積む（寝かせた本の山）。c は山の底の中心 */
function original_bookStack(ctx: BuildContext, c: THREE.Vector3, angle: number, count: number) {
  const { cfg, rand, books } = ctx;
  const palette = cfg.books.palette;
  let y = c.y;
  for (let i = 0; i < count; i++) {
    const t = 0.03 + rand() * 0.025;
    const w = 0.15 + rand() * 0.07;
    const h = 0.21 + rand() * 0.07;
    const a = angle + (rand() - 0.5) * 24;
    const b = basis(a);
    // 寝かせた本：高さの向きが水平（右）、背は前を向く
    books.push({
      position: c.clone().add(V((rand() - 0.5) * 0.02, y + t / 2 - c.y, (rand() - 0.5) * 0.02)),
      normal: b.f.clone(),
      up: b.r.clone(),
      size: V(t, h, w),
      color: new THREE.Color(palette[Math.floor(rand() * palette.length)]).multiplyScalar(0.85 + rand() * 0.3),
      pattern: Math.floor(rand() * 6),
    });
    y += t;
  }
  return y;
}

/** 開いた本（表紙の板の上に、少し反った左右の頁） */
function original_openBook(ctx: BuildContext, c: THREE.Vector3, angle: number, size = 1) {
  const { st, cfg, mb, rand } = ctx;
  const b = basis(angle);
  const P = local(c, b);
  const w = 0.17 * size;
  const d = 0.23 * size;
  const cover = st.face('leather', cfg.books.palette[Math.floor(rand() * cfg.books.palette.length)]);
  const paper = st.face('paper', cfg.colors.paper);
  lbox(ctx, P, [-w - 0.01, w + 0.01], [0, 0.008], [-d / 2 - 0.008, d / 2 + 0.008], cover);
  for (const sx of [-1, 1]) {
    const x0 = sx * 0.004;
    const x1 = sx * w;
    const pb = [P(x0, 0.008, d / 2), P(x1, 0.008, d / 2), P(x1, 0.008, -d / 2), P(x0, 0.008, -d / 2)];
    const pt = [P(x0, 0.012, d / 2), P(x1, 0.026, d / 2), P(x1, 0.026, -d / 2), P(x0, 0.012, -d / 2)];
    mb.hexa(pb, pt, paper, { cell: 1e3 });
  }
}

/** 長机（天板・幕板・ろくろ挽きの脚・貫） */
function original_longTable(ctx: BuildContext, c: THREE.Vector3, len: number, wid: number, height: number) {
  const { st, cfg, mb } = ctx;
  const col = cfg.colors;
  const top = st.face('plank', col.wood);
  const edge = st.face('wood', col.woodDark);
  const y1 = c.y + height;
  mb.aabb([c.x - len / 2, c.x + len / 2], [y1 - 0.06, y1], [c.z - wid / 2, c.z + wid / 2], edge, { top });
  mb.aabb([c.x - len / 2 + 0.12, c.x + len / 2 - 0.12], [y1 - 0.2, y1 - 0.06], [c.z - wid / 2 + 0.12, c.z + wid / 2 - 0.12], st.face('panel', col.wood), { skip: ['top', 'bottom'] });
  const lx = len / 2 - 0.2;
  const lz = wid / 2 - 0.2;
  for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]] as [number, number][]) {
    const p: [number, number] = [c.x + sx * lx, c.z + sz * lz];
    const y0 = c.y;
    const h = height - 0.2;
    mb.lathe(p, [
      [0.055, y0],
      [0.055, y0 + 0.06],
      [0.04, y0 + 0.09],
      [0.07, y0 + h * 0.32],
      [0.075, y0 + h * 0.45],
      [0.045, y0 + h * 0.62],
      [0.06, y0 + h * 0.74],
      [0.04, y0 + h * 0.84],
      [0.05, y0 + h],
    ], st.face('wood', col.wood), 12);
  }
  // 両端の貫と、まん中の長い貫
  for (const sx of [-1, 1]) mb.beam(V(c.x + sx * lx, c.y + 0.16, c.z - lz), V(c.x + sx * lx, c.y + 0.16, c.z + lz), 0.06, 0.06, edge, { cell: 0.3 });
  mb.beam(V(c.x - lx, c.y + 0.16, c.z), V(c.x + lx, c.y + 0.16, c.z), 0.06, 0.06, edge, { cell: 0.3 });
  return y1;
}

/** 小さな机（4 本脚と天板、引き出しの前板） */
function original_smallDesk(ctx: BuildContext, c: THREE.Vector3, angle: number, w: number, d: number, h: number) {
  const { st, cfg, mb } = ctx;
  const col = cfg.colors;
  const P = local(c, basis(angle));
  lbox(ctx, P, [-w / 2, w / 2], [h - 0.04, h], [-d / 2, d / 2], st.face('wood', col.wood), { top: st.face('plank', col.wood) });
  lbox(ctx, P, [-w / 2 + 0.03, w / 2 - 0.03], [h - 0.15, h - 0.04], [-d / 2 + 0.03, d / 2 - 0.02], st.face('panel', col.woodPanel), { skip: ['top', 'bottom'] });
  for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]] as [number, number][]) {
    mb.beam(P(sx * (w / 2 - 0.035), h - 0.04, sz * (d / 2 - 0.035)), P(sx * (w / 2 - 0.035), 0, sz * (d / 2 - 0.035)), 0.04, 0.04, st.face('woodV', col.woodDark), { cell: 1e3 });
  }
  return c.y + h;
}

/** 緑の革の袖付きの肘掛け椅子（丸みのある台・座のクッション・巻いた肘・高い背もたれと袖・短い木の脚） */
function original_armchair(ctx: BuildContext, c: THREE.Vector3, angle: number) {
  const { st, cfg, mb } = ctx;
  const col = cfg.colors;
  const b = basis(angle);
  const P = local(c, b);
  const axes: [THREE.Vector3, THREE.Vector3, THREE.Vector3] = [b.r, V(0, 1, 0), b.f];
  const lth = st.face('leather', col.leather);
  const dk = st.face('leather', col.leatherDark);
  const blob = (x: number, y: number, z: number, hx: number, hy: number, hz: number, f: FaceInfo, e = 0.35) => mb.blob(P(x, y, z), V(hx, hy, hz), f, { e, axes, segW: 18, segH: 10 });
  blob(0, 0.25, 0.0, 0.38, 0.15, 0.34, dk, 0.3);
  blob(0, 0.46, 0.05, 0.27, 0.075, 0.29, lth, 0.38);
  for (const sx of [-1, 1]) {
    blob(sx * 0.31, 0.5, 0.0, 0.085, 0.2, 0.33, lth, 0.35);
    blob(sx * 0.32, 0.67, 0.3, 0.1, 0.07, 0.06, lth, 0.6);
    blob(sx * 0.3, 0.9, -0.18, 0.075, 0.24, 0.13, lth, 0.4);
  }
  blob(0, 0.8, -0.27, 0.34, 0.37, 0.085, lth, 0.38);
  blob(0, 0.62, -0.19, 0.25, 0.14, 0.045, lth, 0.5);
  for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]] as [number, number][]) {
    mb.lathe([P(sx * 0.3, 0, sz * 0.27).x, P(sx * 0.3, 0, sz * 0.27).z], [[0.022, c.y], [0.03, c.y + 0.06], [0.026, c.y + 0.11]], st.face('wood', col.woodDark), 8);
  }
}

/** 丸い小机（天板・柱・3 本の脚）と黄色い笠のランプ */
function original_sideTableWithLamp(ctx: BuildContext, c: THREE.Vector3) {
  const { st, cfg, mb, lamps } = ctx;
  const col = cfg.colors;
  const wood = st.face('wood', col.wood);
  const h = 0.62;
  mb.lathe([c.x, c.z], [[0.0, c.y + h - 0.035], [0.26, c.y + h - 0.035], [0.265, c.y + h - 0.012], [0.25, c.y + h], [0.0, c.y + h]], st.face('plank', col.wood), 24);
  mb.lathe([c.x, c.z], [[0.035, c.y + 0.1], [0.05, c.y + 0.2], [0.03, c.y + 0.35], [0.045, c.y + 0.48], [0.03, c.y + h - 0.035]], wood, 10, { capBottom: false, capTop: false });
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2 + 0.4;
    mb.beam(V(c.x, c.y + 0.12, c.z), V(c.x + Math.cos(a) * 0.22, c.y + 0.01, c.z + Math.sin(a) * 0.22), 0.04, 0.035, st.face('wood', col.woodDark), { cell: 1e3 });
  }
  const y = c.y + h;
  const lc: [number, number] = [c.x - 0.06, c.z - 0.04];
  const brass = st.face('brass', col.brass);
  mb.lathe(lc, [[0, y], [0.07, y + 0.005], [0.06, y + 0.03], [0.02, y + 0.05], [0.014, y + 0.32]], brass, 12, { capBottom: false });
  mb.lathe(lc, [[0.07, y + 0.22], [0.13, y + 0.38], [0.0, y + 0.385]], st.face('glow', col.lampYellow), 16, { capBottom: false });
  mb.lathe(lc, [[0.13, y + 0.38], [0.07, y + 0.22]], st.face('glow', '#fff3d0'), 16, { capBottom: false, capTop: false });
  lamps.push({ position: V(lc[0], y + 0.28, lc[1]), color: new THREE.Color('#ffd28a'), range: 1.5, intensity: 1.1 });
  bookStack(ctx, V(c.x + 0.1, y, c.z + 0.08), 20, 3);
}

/** 地球儀・天球儀（3 本脚の木の台、真鍮の子午線の輪、傾けた球）。map で球の地図を選ぶ */
function original_globe(ctx: BuildContext, c: THREE.Vector3, map: 'globe' | 'celestial' = 'globe', spin = 0) {
  const { st, cfg, mb } = ctx;
  const col = cfg.colors;
  const wood = st.face('wood', col.wood);
  const brass = st.face('brass', col.brass);
  const r = 0.21;
  const cy = c.y + 0.82;
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2 + 0.3;
    const foot = V(c.x + Math.cos(a) * 0.3, c.y, c.z + Math.sin(a) * 0.3);
    const knee = V(c.x + Math.cos(a) * 0.2, c.y + 0.35, c.z + Math.sin(a) * 0.2);
    const top = V(c.x + Math.cos(a) * 0.2, cy - 0.17, c.z + Math.sin(a) * 0.2);
    mb.beam(foot, knee, 0.04, 0.04, wood, { cell: 1e3 });
    mb.beam(knee, top, 0.035, 0.035, wood, { cell: 1e3 });
  }
  // 脚をつなぐ輪（水平の輪）
  const ringY = cy - 0.06;
  for (let i = 0; i < 20; i++) {
    const a0 = (i / 20) * Math.PI * 2;
    const a1 = ((i + 1) / 20) * Math.PI * 2;
    mb.beam(V(c.x + Math.cos(a0) * (r + 0.05), ringY, c.z + Math.sin(a0) * (r + 0.05)), V(c.x + Math.cos(a1) * (r + 0.05), ringY, c.z + Math.sin(a1) * (r + 0.05)), 0.04, 0.012, wood, { cell: 1e3 });
  }
  mb.lathe([c.x, c.z], [[0.03, c.y + 0.3], [0.05, c.y + 0.4], [0.025, cy - 0.12]], wood, 10);
  // 子午線の輪（傾けた縦の輪）
  const tilt = THREE.MathUtils.degToRad(23);
  const ax = V(Math.sin(tilt), Math.cos(tilt), 0);
  const side = V(0, 0, 1);
  const rr = r + 0.025;
  for (let i = 0; i < 24; i++) {
    const a0 = (i / 24) * Math.PI * 2;
    const a1 = ((i + 1) / 24) * Math.PI * 2;
    const p = (a: number) => V(c.x, cy, c.z).addScaledVector(ax, Math.cos(a) * rr).add(V(Math.cos(tilt), -Math.sin(tilt), 0).multiplyScalar(Math.sin(a) * rr));
    mb.beam(p(a0), p(a1), 0.012, 0.02, brass, { cell: 1e3, up: side });
  }
  const geo = new THREE.SphereGeometry(r, 40, 24);
  geo.applyMatrix4(new THREE.Matrix4().makeRotationY(spin));
  geo.applyMatrix4(new THREE.Matrix4().makeRotationZ(-tilt));
  geo.translate(c.x, cy, c.z);
  ctx.textured.push({ name: map, geometry: geo, map, roughness: map === 'celestial' ? 0.38 : 0.45 });
}

/** 図書館の梯子（2 本の側木と横木。上は棚の上の手すりに掛ける） */
function original_ladder(ctx: BuildContext, foot: THREE.Vector3, topP: THREE.Vector3) {
  const { st, cfg, mb } = ctx;
  const col = cfg.colors;
  const wood = st.face('wood', col.woodLight);
  // 梯子の幅の向き：立てかける向き（足から頭への水平の向き）に直交する水平の向き
  const h = V(topP.x - foot.x, 0, topP.z - foot.z).normalize();
  const across = V(-h.z, 0, h.x);
  const w = 0.17;
  for (const s of [-1, 1]) mb.beam(foot.clone().addScaledVector(across, s * w), topP.clone().addScaledVector(across, s * w), 0.035, 0.05, wood, { cell: 0.3 });
  const n = Math.floor(foot.distanceTo(topP) / 0.26);
  for (let i = 1; i <= n; i++) {
    const p = foot.clone().lerp(topP, i / (n + 0.6));
    mb.beam(p.clone().addScaledVector(across, -w), p.clone().addScaledVector(across, w), 0.025, 0.025, wood, { cell: 1e3 });
  }
  // 頭の鉤（棚の上の真鍮の手すりに掛ける）
  for (const sgn of [-1, 1]) mb.sphere(topP.clone().addScaledVector(across, sgn * w).addScaledVector(h, 0.03).add(V(0, 0.03, 0)), 0.022, st.face('brass', col.brass), 8, 5);
}

/**
 * 鉢植え（植木鉢・土・細長い葉。葉は両面の形として foliage に）。
 * upright（0〜1）で葉を立てて垂れを減らし、stand（高さ）で木の花台に載せる（回廊の手すりの上に葉が出るように）
 */
function original_plant(ctx: BuildContext, c0: THREE.Vector3, size: number, leaves = 18, opts: { upright?: number; stand?: number } = {}) {
  const { st, cfg, mb, foliage, rand } = ctx;
  const col = cfg.colors;
  const up = opts.upright ?? 0;
  let c = c0;
  if (opts.stand) {
    const h = opts.stand;
    const y0 = c0.y;
    const r = 0.11 * size * 1.2;
    mb.lathe([c0.x, c0.z], [[r * 1.05, y0], [r * 1.05, y0 + 0.035], [r * 0.4, y0 + 0.06], [r * 0.3, y0 + h * 0.5], [r * 0.4, y0 + h - 0.05], [r, y0 + h - 0.03], [r, y0 + h]], st.face('wood', col.woodDark), 16, { capBottom: false });
    c = V(c0.x, y0 + h, c0.z);
  }
  const droop = 0.55 * (1 - 0.45 * up);
  const pr = 0.11 * size;
  const ph = 0.2 * size;
  mb.lathe([c.x, c.z], [[pr * 0.7, c.y], [pr * 0.78, c.y + 0.02 * size], [pr, c.y + ph * 0.86], [pr * 1.08, c.y + ph * 0.88], [pr * 1.08, c.y + ph], [pr * 0.96, c.y + ph]], st.face('pot', col.pot), 16, { capTop: false });
  mb.lathe([c.x, c.z], [[pr * 0.96, c.y + ph * 0.93], [0.0, c.y + ph * 0.95]], st.face('plain', '#4a3424'), 16, { capBottom: false });
  const leafF = (k: number) => st.face('leaf', k < 0.5 ? col.leaf : col.leafLight, 0.12, rand);
  for (let i = 0; i < leaves; i++) {
    const az = (i / leaves) * Math.PI * 2 * 2.618 + rand() * 0.5;
    const el = THREE.MathUtils.degToRad(35 + up * 22 + rand() * (45 - up * 12));
    const len = size * (0.32 + rand() * 0.26);
    const wid = size * (0.045 + rand() * 0.03);
    const dir = V(Math.cos(az) * Math.cos(el), Math.sin(el), Math.sin(az) * Math.cos(el));
    const side = V(-Math.sin(az), 0, Math.cos(az));
    const base = V(c.x, c.y + ph * 0.95, c.z).addScaledVector(dir, 0.01);
    const f = leafF(rand());
    // 葉：3 つの区間で先へ行くほど下へ垂れ、中ほどが広い。中筋で少し折る
    const pts: THREE.Vector3[] = [];
    for (let k = 0; k <= 3; k++) {
      const t = k / 3;
      const p = base.clone().addScaledVector(dir, len * t).add(V(0, -len * droop * t * t, 0));
      pts.push(p);
    }
    const widths = [0.15, 1, 0.8, 0.05];
    for (let k = 0; k < 3; k++) {
      const a = pts[k];
      const b = pts[k + 1];
      const wa = wid * widths[k];
      const wb = wid * widths[k + 1];
      const fold = V(0, wid * 0.25, 0);
      const al = a.clone().addScaledVector(side, -wa).sub(fold);
      const ar = a.clone().addScaledVector(side, wa).sub(fold);
      const bl = b.clone().addScaledVector(side, -wb).sub(fold);
      const br = b.clone().addScaledVector(side, wb).sub(fold);
      foliage.quad(al, a, b, bl, f, { cell: 1e3, v0: k / 3, uOffset: 0 });
      foliage.quad(a, ar, br, b, f, { cell: 1e3, v0: k / 3, uOffset: 0 });
    }
  }
}

/** 書見台（ろくろ挽きの柱と 3 本の脚、斜めの台に開いた大きな本）。c は床の位置、angle は読む人が向く向き */
function original_lectern(ctx: BuildContext, c: THREE.Vector3, angle: number) {
  const { st, cfg, mb } = ctx;
  const col = cfg.colors;
  const wood = st.face('wood', col.wood);
  const dark = st.face('wood', col.woodDark);
  const b = basis(angle);
  const P = local(c, b);
  // 3 本の脚と柱
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2 + Math.PI / 2;
    const foot = c.clone().add(V(Math.cos(a) * 0.26, 0.0, Math.sin(a) * 0.26));
    const knee = c.clone().add(V(Math.cos(a) * 0.06, 0.16, Math.sin(a) * 0.06));
    mb.beam(foot.clone().add(V(0, 0.025, 0)), knee, 0.045, 0.05, dark, { cell: 1e3 });
    mb.sphere(foot.clone().add(V(0, 0.02, 0)), 0.026, dark, 8, 5);
  }
  mb.lathe([c.x, c.z], [
    [0.07, c.y + 0.12],
    [0.07, c.y + 0.17],
    [0.045, c.y + 0.22],
    [0.06, c.y + 0.42],
    [0.035, c.y + 0.62],
    [0.05, c.y + 0.78],
    [0.04, c.y + 0.86],
    [0.06, c.y + 0.9],
  ], wood, 12);
  // 斜めの台（手前が低い。向き angle の側が手前）と、本を止める縁
  const tilt = THREE.MathUtils.degToRad(24);
  const y0 = 0.98;
  const hw = 0.26;
  const hd = 0.2;
  const Q = (x: number, z: number, dy = 0) => P(x, y0 + dy - Math.sin(tilt) * z, z * Math.cos(tilt));
  const top = [Q(-hw, hd), Q(hw, hd), Q(hw, -hd), Q(-hw, -hd)];
  const bot = top.map((p) => p.clone().add(V(0, -0.03, 0)));
  mb.hexa(bot, top, wood, { top: st.face('plank', col.wood) });
  mb.beam(Q(-hw, hd + 0.01, 0.0), Q(hw, hd + 0.01, 0.0), 0.022, 0.05, dark, { cell: 1e3 });
  // 開いた大きな本（台の傾きに合わせた左右の頁）
  const paper = st.face('paper', col.paper);
  const cover = st.face('leather', '#5a1e16');
  const bw = 0.2;
  const bd = 0.27;
  const R = (x: number, z: number, dy: number) => Q(x, z * 0.92 - 0.015, dy);
  mb.hexa([R(-bw - 0.012, bd / 2, 0.0), R(bw + 0.012, bd / 2, 0.0), R(bw + 0.012, -bd / 2, 0.0), R(-bw - 0.012, -bd / 2, 0.0)], [R(-bw - 0.012, bd / 2, 0.01), R(bw + 0.012, bd / 2, 0.01), R(bw + 0.012, -bd / 2, 0.01), R(-bw - 0.012, -bd / 2, 0.01)], cover, { cell: 1e3 });
  for (const sx of [-1, 1]) {
    const x0 = sx * 0.004;
    const x1 = sx * bw;
    mb.hexa([R(x0, bd / 2 - 0.01, 0.01), R(x1, bd / 2 - 0.01, 0.01), R(x1, -bd / 2 + 0.01, 0.01), R(x0, -bd / 2 + 0.01, 0.01)], [R(x0, bd / 2 - 0.01, 0.016), R(x1, bd / 2 - 0.01, 0.036), R(x1, -bd / 2 + 0.01, 0.036), R(x0, -bd / 2 + 0.01, 0.016)], paper, { cell: 1e3 });
  }
  // しおりの紐（赤）
  mb.beam(R(0.02, -bd / 2 + 0.02, 0.02), R(0.05, bd / 2 + 0.05, -0.02), 0.008, 0.002, st.face('fabric', '#8c1c18'), { cell: 1e3 });
}

/** 本の手押し車（2 段の棚と側板、4 つの小さな車輪、押し手）。棚の本は両側に背を向ける */
function original_bookTrolley(ctx: BuildContext, c: THREE.Vector3, angle: number) {
  const { st, cfg, mb, rand, books } = ctx;
  const col = cfg.colors;
  const wood = st.face('wood', col.wood);
  const dark = st.face('wood', col.woodDark);
  const b = basis(angle);
  const P = local(c, b);
  const L = 0.42;
  const W = 0.2;
  for (const y of [0.16, 0.5]) lbox(ctx, P, [-L, L], [y - 0.025, y], [-W, W], wood, { top: st.face('plank', col.wood) });
  for (const sx of [-1, 1]) lbox(ctx, P, [sx * L - 0.02, sx * L + 0.02], [0.08, 0.72], [-W, W], st.face('panel', col.wood));
  // 押し手
  mb.beam(P(L + 0.02, 0.72, -W + 0.03), P(L + 0.02, 0.72, W - 0.03), 0.035, 0.035, dark, { cell: 1e3 });
  // 車輪
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) mb.sphere(P(sx * (L - 0.04), 0.045, sz * (W - 0.04)), 0.045, st.face('brass', col.brass), 10, 6);
  // 本：棚ごとに 2 列（背を左右の外へ）
  const palette = cfg.books.palette;
  for (const y of [0.16, 0.5]) {
    for (const side of [-1, 1]) {
      let x = -L + 0.03;
      while (x < L - 0.06) {
        const t = 0.028 + rand() * 0.03;
        const h = 0.2 + rand() * 0.08;
        const d = 0.15 + rand() * 0.03;
        if (x + t > L - 0.03) break;
        const nrm = b.f.clone().multiplyScalar(side);
        books.push({
          position: P(x + t / 2, y + h / 2, side * (W - 0.01 - d / 2)),
          normal: nrm,
          up: V(0, 1, 0),
          size: V(t, h, d),
          color: new THREE.Color(palette[Math.floor(rand() * palette.length)]).multiplyScalar(0.85 + rand() * 0.3),
          pattern: Math.floor(rand() * 6),
          gap: 0.3,
        });
        x += t + 0.002;
      }
    }
  }
}

/**
 * 彩色写本（大きな開いた本の左右の頁に、金箔の大きな頭文字・朱と藍の挿絵の枠・金の縁取り・字の行）。陳列台の中に置く
 */
function original_illuminatedBook(ctx: BuildContext, c: THREE.Vector3, angle: number, size = 1) {
  const { st, cfg, mb } = ctx;
  const b = basis(angle);
  const P = local(c, b);
  const w = 0.17 * size;
  const d = 0.23 * size;
  openBook(ctx, c, angle, size);
  // 頁の上面の高さ（背の近くが低く、外の縁が高い：openBook の頁の形と同じ）
  const yAt = (x: number) => 0.012 + (0.026 - 0.012) * Math.min(1, Math.max(0, (Math.abs(x) - 0.004) / (w - 0.004))) + 0.0012;
  const deco = (x0: number, x1: number, z0: number, z1: number, f: ReturnType<typeof st.face>) => {
    const pa = P(x0, yAt(x0), z0);
    const pb = P(x1, yAt(x1), z0);
    const pc = P(x1, yAt(x1), z1);
    const pd = P(x0, yAt(x0), z1);
    mb.quadAuto(pa, pb, pc, pd, V(0, 1, 0), f, { cell: 1e3 });
  };
  const gold = st.face('gold', cfg.colors.brass);
  const red = st.face('paint', '#a3261c');
  const blue = st.face('paint', '#24418a');
  const ink = st.face('paint', '#3a2a20');
  for (const sx of [-1, 1]) {
    const xa = sx > 0 ? 0.02 * size : -w + 0.02 * size;
    const xb = sx > 0 ? w - 0.02 * size : -0.02 * size;
    const lo = Math.min(xa, xb);
    const hi = Math.max(xa, xb);
    const zt = -d / 2 + 0.02 * size;
    const zb = d / 2 - 0.02 * size;
    // 金の縁取り（上下左右の細い帯）
    deco(lo, hi, zt, zt + 0.004 * size, gold);
    deco(lo, hi, zb - 0.004 * size, zb, gold);
    deco(lo, lo + 0.004 * size, zt, zb, gold);
    deco(hi - 0.004 * size, hi, zt, zb, gold);
    // 字の行
    for (let k = 0; k < 9; k++) {
      const z = zt + 0.016 * size + k * 0.019 * size;
      const xs = sx < 0 ? lo + 0.012 * size : lo + (k < 4 ? 0.06 : 0.012) * size;
      deco(xs, hi - 0.012 * size, z, z + 0.004 * size, ink);
    }
    if (sx < 0) {
      // 左の頁：朱と藍の挿絵の枠と、中の金の地
      deco(lo + 0.014 * size, hi - 0.014 * size, zb - 0.09 * size, zb - 0.014 * size, blue);
      deco(lo + 0.022 * size, hi - 0.022 * size, zb - 0.082 * size, zb - 0.022 * size, red);
      deco(lo + 0.03 * size, hi - 0.03 * size, zb - 0.074 * size, zb - 0.03 * size, gold);
    } else {
      // 右の頁：金箔の大きな頭文字と、朱の枠
      deco(lo + 0.008 * size, lo + 0.05 * size, zt + 0.01 * size, zt + 0.07 * size, red);
      deco(lo + 0.014 * size, lo + 0.044 * size, zt + 0.016 * size, zt + 0.064 * size, gold);
    }
  }
}

/**
 * 陳列台（ガラスの蓋の付いた展示台。ロング・ルームの写本の陳列台のように）：ろくろ挽きの 4 本の脚と貫、幕板、浅い箱と緑のフェルトの底、
 * 中に彩色写本。蓋は手前へ下がる斜めのガラス（透明な形として別に作る）
 */
function original_displayCase(ctx: BuildContext, c: THREE.Vector3, angle: number) {
  const { st, cfg, mb, clearGlass } = ctx;
  const col = cfg.colors;
  const b = basis(angle);
  const P = local(c, b);
  const L = 1.24;
  const D = 0.6;
  const H = 0.82;
  const wood = st.face('wood', col.wood);
  const dark = st.face('wood', col.woodDark);
  // 脚と貫
  for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]] as [number, number][]) {
    const p = P(sx * (L / 2 - 0.07), 0, sz * (D / 2 - 0.07));
    mb.lathe([p.x, p.z], [
      [0.04, c.y],
      [0.04, c.y + 0.05],
      [0.028, c.y + 0.08],
      [0.045, c.y + 0.3],
      [0.03, c.y + 0.5],
      [0.04, c.y + 0.6],
      [0.035, c.y + H - 0.12],
    ], wood, 10);
  }
  for (const sz of [-1, 1]) mb.beam(P(-L / 2 + 0.07, 0.14, sz * (D / 2 - 0.07)), P(L / 2 - 0.07, 0.14, sz * (D / 2 - 0.07)), 0.035, 0.035, dark, { cell: 1e3 });
  // 幕板と浅い箱（底は緑のフェルト）
  lbox(ctx, P, [-L / 2, L / 2], [H - 0.12, H - 0.04], [-D / 2, D / 2], st.face('panel', col.wood));
  lbox(ctx, P, [-L / 2 + 0.05, L / 2 - 0.05], [H - 0.04, H - 0.035], [-D / 2 + 0.05, D / 2 - 0.05], st.face('fabric', '#2f4a36'));
  const rim = 0.045;
  const yT = H + 0.06;
  lbox(ctx, P, [-L / 2, L / 2], [H - 0.04, yT], [D / 2 - rim, D / 2], wood, { top: dark });
  lbox(ctx, P, [-L / 2, L / 2], [H - 0.04, yT + 0.08], [-D / 2, -D / 2 + rim], wood, { top: dark });
  for (const sx of [-1, 1]) {
    const x0 = sx < 0 ? -L / 2 : L / 2 - rim;
    const x1 = sx < 0 ? -L / 2 + rim : L / 2;
    const bb = [P(x0, H - 0.04, D / 2 - rim), P(x1, H - 0.04, D / 2 - rim), P(x1, H - 0.04, -D / 2 + rim), P(x0, H - 0.04, -D / 2 + rim)];
    const tt = [P(x0, yT, D / 2 - rim), P(x1, yT, D / 2 - rim), P(x1, yT + 0.08, -D / 2 + rim), P(x0, yT + 0.08, -D / 2 + rim)];
    mb.hexa(bb, tt, wood, { top: dark, skip: ['bottom'] });
  }
  // 中の彩色写本
  illuminatedBook(ctx, P(0.0, H - 0.035, 0.02), angle + 180, 1.35);
  // ガラスの蓋（手前へ下がる斜めの 1 枚と、両脇の三角の 2 枚）
  const g0 = P(-L / 2 + rim, yT, D / 2 - rim);
  const g1 = P(L / 2 - rim, yT, D / 2 - rim);
  const g2 = P(L / 2 - rim, yT + 0.08, -D / 2 + rim);
  const g3 = P(-L / 2 + rim, yT + 0.08, -D / 2 + rim);
  const gf = st.face('plain', '#ffffff');
  clearGlass.quadAuto(g0, g1, g2, g3, V(0, 1, 0), gf);
  // 蓋の枠（細い真鍮の縁。ガラスの面がどこにあるか分かるように）
  const brass = st.face('brass', col.brass);
  const lift = V(0, 0.006, 0);
  const pts = [g0, g1, g2, g3].map((p) => p.clone().add(lift));
  for (let i = 0; i < 4; i++) mb.beam(pts[i], pts[(i + 1) % 4], 0.016, 0.01, brass, { cell: 1e3, up: V(0, 1, 0) });
  // 手前の縁の小さな真鍮の錠
  mb.aabb([P(0, 0, 0).x - 0.03, P(0, 0, 0).x + 0.03], [yT - 0.05, yT - 0.005], [P(0, 0, D / 2).z - 0.004, P(0, 0, D / 2).z + 0.008], brass, { skip: ['back'] });
}

/** 家具と小物をすべて置く */
export function buildFurnitureOriginalLayout(ctx: BuildContext) {
  const { cfg } = ctx;
  const R = cfg.room;
  const floorY = R.slab.floorY;
  const gy = R.gallery.y;
  const g = wallGeometry(ctx);
  const C = R.windows.center;

  // --- 長机と 6 脚の椅子、3 つの緑のランプ、本（セルリアーナの窓の軸の上、床のまん中より少し手前） ---
  const tc = V(C, floorY, 0.5);
  const tableTop = longTable(ctx, tc, 3.7, 1.28, 0.8);
  for (const x of [-1.22, 0, 1.22]) {
    chair(ctx, V(tc.x + x + (ctx.rand() - 0.5) * 0.08, floorY, tc.z + 0.92), 180 + (ctx.rand() - 0.5) * 10);
    chair(ctx, V(tc.x + x + (ctx.rand() - 0.5) * 0.08, floorY, tc.z - 0.9), (ctx.rand() - 0.5) * 10);
  }
  for (const x of [-1.2, 0.02, 1.22]) bankersLamp(ctx, V(tc.x + x, tableTop, tc.z + 0.02), 0, 1.3);
  const T = (x: number, z: number) => V(tc.x + x, tableTop, tc.z + z);
  openBook(ctx, T(-0.72, 0.32), 8);
  openBook(ctx, T(-0.1, -0.3), 172);
  openBook(ctx, T(0.62, 0.3), -12);
  openBook(ctx, T(1.5, -0.28), 186);
  bookStack(ctx, T(-1.55, 0.26), 10, 3);
  bookStack(ctx, T(-0.55, -0.32), -14, 2);
  bookStack(ctx, T(0.4, 0.05), 30, 2);
  bookStack(ctx, T(1.58, 0.3), -8, 4);
  bookStack(ctx, T(-1.62, -0.3), 5, 1);
  bookStack(ctx, T(-0.95, -0.05), 75, 2);
  bookStack(ctx, T(0.95, -0.34), -20, 3);
  openBook(ctx, T(-1.35, -0.36), 176, 0.85);
  openBook(ctx, T(0.15, 0.42), 4, 0.9);
  for (const [x, z, a] of [[-0.35, 0.18, 15], [1.0, -0.05, -25], [-1.05, 0.3, 40]] as [number, number, number][]) {
    const P = local(T(x, z), basis(a));
    lbox(ctx, P, [-0.08, 0.08], [0, 0.003], [-0.105, 0.105], ctx.st.face('paper', '#f6efdf'));
  }

  // --- 地球儀と天球儀の一対（机の右に横に並べる。古い図書館の定番の飾り）と、右の手前の陳列台（彩色写本） ---
  globe(ctx, V(2.72, floorY, 1.5), 'globe', -1.44);
  globe(ctx, V(3.92, floorY, 1.28), 'celestial', 2.2);
  displayCase(ctx, V(3.05, floorY, 3.12), -12);

  // --- 左の手前：革の肘掛け椅子と、丸い小机とランプ ---
  armchair(ctx, V(-3.15, floorY, 2.45), 62);
  sideTableWithLamp(ctx, V(-3.86, floorY, 3.06));

  // --- 書見台（左の本棚の前）と、本の手押し車（机の奥） ---
  lectern(ctx, V(-3.3, floorY, -1.35), 90 + 25);
  bookTrolley(ctx, V(1.75, floorY, -1.75), 8);

  // --- 梯子（左の 1 階の本棚に掛ける） ---
  ladder(ctx, V(-3.55, floorY, -0.25), V(-4.07, 2.78, -0.25));

  // --- 鉢植え：左の手前の柱の脇、らせん階段の右、2 階の窓の脇と左の回廊の奥の角 ---
  plant(ctx, V(-4.16, floorY, 3.86), 1.7, 26, { upright: 0.5 });
  plant(ctx, V(3.95, floorY, -1.55), 1.8, 28, { upright: 0.7, stand: 0.36 });
  plant(ctx, V(C + R.windows.spacing + 0.78, gy, g.zi + 0.34), 1.45, 24, { upright: 0.8, stand: 0.3 });

  // --- 2 階：奥の回廊の窓の下の机と椅子 ---
  {
    const cx = C - R.windows.spacing;
    const dc = V(cx, gy, g.zi + 0.24);
    const top = smallDesk(ctx, dc, 0, 0.74, 0.36, 0.56);
    bookStack(ctx, V(cx - 0.2, top, dc.z), (ctx.rand() - 0.5) * 30, 3);
    openBook(ctx, V(cx + 0.12, top, dc.z + 0.02), 0, 0.7);
    chair(ctx, V(cx + 0.02, gy, dc.z + 0.5), 180 + 8);
  }
}


/** 1 world unit = 2m。家具の原型はメートル寸法のまま作り、部品単位で0.5倍して配置する。
 * 建物・台座は縮小しない。影焼き込み前に全属性と小物・灯りを一緒に移す。
 */
function placeAsset(ctx: BuildContext, anchor: THREE.Vector3, build: () => void) {
  const builders = [ctx.mb, ctx.glass, ctx.foliage, ctx.clearGlass];
  const starts = builders.map(b => b.vertexCount);
  const bookStart = ctx.books.length, lampStart = ctx.lamps.length, textureStart = ctx.textured.length;
  build();
  builders.forEach((b, j) => {
    for (let i = starts[j]; i < b.vertexCount; i++) {
      b.positions[i * 3] = b.positions[i * 3] * 0.5 + anchor.x;
      b.positions[i * 3 + 1] = b.positions[i * 3 + 1] * 0.5 + anchor.y;
      b.positions[i * 3 + 2] = b.positions[i * 3 + 2] * 0.5 + anchor.z;
      for (let k = 0; k < 4; k++) { b.edges[i * 4 + k] *= 0.5; }
    }
  });
  for (const b of ctx.books.slice(bookStart)) { b.position.multiplyScalar(0.5).add(anchor); b.size.multiplyScalar(0.5); if (b.gap !== undefined) b.gap *= 0.5; }
  for (const l of ctx.lamps.slice(lampStart)) { l.position.multiplyScalar(0.5).add(anchor); l.range *= 0.5; }
  for (const t of ctx.textured.slice(textureStart)) t.geometry.scale(0.5, 0.5, 0.5).translate(anchor.x, anchor.y, anchor.z);
}

export function buildFurniture(ctx: BuildContext) {
  const floor = ctx.cfg.room.slab.floorY, gy = ctx.cfg.room.gallery.y;
  const g = wallGeometry(ctx), origin = V(0, 0, 0);
  // 24席。1卓3.7×1.28m、高さ0.8m、椅子座面0.46m。卓の中心間5.4m。
  for (const x of [-1.45, 1.25]) for (const z of [-1.2, 1.5]) {
    placeAsset(ctx, V(x, floor, z), () => {
      const top = longTable(ctx, origin, 3.7, 1.28, 0.8);
      for (const dx of [-1.22, 0, 1.22]) {
        chair(ctx, V(dx, 0, 0.92), 180); chair(ctx, V(dx, 0, -0.92), 0);
        bankersLamp(ctx, V(dx, top, 0), 0, 1.3);
        openBook(ctx, V(dx, top, 0.32), 8);
        openBook(ctx, V(dx, top, -0.32), 172);
      }
      bookStack(ctx, V(0.5, top, 0), 10, 3);
    });
  }
  // 原型の実寸を保つ展示品と休憩席。主動線と階段の手前を空ける。
  placeAsset(ctx, V(3.45, floor, 2.7), () => globe(ctx, origin, 'globe', -1.44));
  placeAsset(ctx, V(3.45, floor, 1.6), () => globe(ctx, origin, 'celestial', 2.2));
  placeAsset(ctx, V(0, floor, 3.5), () => displayCase(ctx, origin, 0));
  for (const z of [1.8, 3]) placeAsset(ctx, V(-3.2, floor, z), () => armchair(ctx, origin, 90));
  placeAsset(ctx, V(-3.2, floor, 2.4), () => sideTableWithLamp(ctx, origin));
  placeAsset(ctx, V(-2.5, floor, -3.3), () => lectern(ctx, origin, 20));
  placeAsset(ctx, V(0.5, floor, -3.35), () => bookTrolley(ctx, origin, 0));
  for (const [x,z] of [[-4,3.8],[4,-1.2],[3.9,3.7]]) placeAsset(ctx, V(x,floor,z), () => plant(ctx, origin, 1.8, 24));
  // 回廊は幅2m。机は高さ0.75mへ見直し、座面0.46mとの高低差を確保。
  for (const x of [-2.7,-1.3,0.1,1.5]) placeAsset(ctx,V(x,gy,g.zi+.26),()=>{
    const top=smallDesk(ctx,origin,0,1.1,0.55,0.75);
    chair(ctx,V(0,0,.65),180);bookStack(ctx,V(-.3,top,0),0,2);openBook(ctx,V(.15,top,0),0,.7);
  });
  // 上下の高い棚へ届く梯子。幅0.34mと横木間隔約0.26mを維持、長さだけ棚に合わせる。
  const lowerTop=g.fasciaBottom-.23;
  for (const z of [-1.5,1.5]) placeAsset(ctx,V(-3.7,floor,z),()=>ladder(ctx,origin,V((g.caseFront+.1+3.7)*2,(lowerTop-floor)*2,0)));
  placeAsset(ctx,V(-4.05,gy,0.5),()=>ladder(ctx,origin,V((g.xi+ctx.cfg.room.upperCases.depth+.08+4.05)*2,(ctx.cfg.room.upperCases.top-.15-gy)*2,0)));
}

export function chair(...args:Parameters<typeof original_chair>):ReturnType<typeof original_chair> { return captureFurniture("chair",args[0],()=>original_chair(...args)); }

export function bankersLamp(...args:Parameters<typeof original_bankersLamp>):ReturnType<typeof original_bankersLamp> { return captureFurniture("bankersLamp",args[0],()=>original_bankersLamp(...args)); }

export function bookStack(...args:Parameters<typeof original_bookStack>):ReturnType<typeof original_bookStack> { return captureFurniture("bookStack",args[0],()=>original_bookStack(...args)); }

export function openBook(...args:Parameters<typeof original_openBook>):ReturnType<typeof original_openBook> { return captureFurniture("openBook",args[0],()=>original_openBook(...args)); }

function longTable(...args:Parameters<typeof original_longTable>):ReturnType<typeof original_longTable> { return captureFurniture("longTable",args[0],()=>original_longTable(...args)); }

function smallDesk(...args:Parameters<typeof original_smallDesk>):ReturnType<typeof original_smallDesk> { return captureFurniture("smallDesk",args[0],()=>original_smallDesk(...args)); }

function armchair(...args:Parameters<typeof original_armchair>):ReturnType<typeof original_armchair> { return captureFurniture("armchair",args[0],()=>original_armchair(...args)); }

function sideTableWithLamp(...args:Parameters<typeof original_sideTableWithLamp>):ReturnType<typeof original_sideTableWithLamp> { return captureFurniture("sideTableWithLamp",args[0],()=>original_sideTableWithLamp(...args)); }

function globe(...args:Parameters<typeof original_globe>):ReturnType<typeof original_globe> { return captureFurniture("globe",args[0],()=>original_globe(...args)); }

function ladder(...args:Parameters<typeof original_ladder>):ReturnType<typeof original_ladder> { return captureFurniture("ladder",args[0],()=>original_ladder(...args)); }

export function plant(...args:Parameters<typeof original_plant>):ReturnType<typeof original_plant> { return captureFurniture("plant",args[0],()=>original_plant(...args)); }

function lectern(...args:Parameters<typeof original_lectern>):ReturnType<typeof original_lectern> { return captureFurniture("lectern",args[0],()=>original_lectern(...args)); }

function bookTrolley(...args:Parameters<typeof original_bookTrolley>):ReturnType<typeof original_bookTrolley> { return captureFurniture("bookTrolley",args[0],()=>original_bookTrolley(...args)); }

function illuminatedBook(...args:Parameters<typeof original_illuminatedBook>):ReturnType<typeof original_illuminatedBook> { return captureFurniture("illuminatedBook",args[0],()=>original_illuminatedBook(...args)); }

function displayCase(...args:Parameters<typeof original_displayCase>):ReturnType<typeof original_displayCase> { return captureFurniture("displayCase",args[0],()=>original_displayCase(...args)); }
