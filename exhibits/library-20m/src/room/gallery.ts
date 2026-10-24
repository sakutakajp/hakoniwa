import * as THREE from 'three';
import { V, type BuildContext } from './context';
import { wallGeometry } from './structure';
import type { FaceInfo, MeshBuilder } from '../meshBuilder';
import type { InscriptionAtlas } from './inscription';
import { spiralGeometry } from './spiral';

/**
 * 回廊（左と奥の壁に沿う L 字）：床の形、床板の縁、金文字の帯の鼻隠し（区画ごとに学問の名）、鼻隠しの下の刳り形、
 * 1 階の本棚の上の天井（回廊の床の裏）、手すり（柱は本棚の柱形の位置。真鍮の手すり子）
 */

/** 回廊の床の形（上から見た多角形）。左の回廊、角、奥の回廊。奥の左の角は壁の内側の弧に沿う */
export function deckPolygon(ctx: BuildContext): [number, number][] {
  const g = wallGeometry(ctx);
  const e = g.edge;
  const ps = g.pierStart;
  const pts: [number, number][] = [
    [g.xi, ps],
    [e, ps],
    [e, e],
    [ps, e],
    [ps, g.zi],
    [g.blc.x, g.zi],
  ];
  for (let i = 1; i < 16; i++) {
    const t = Math.PI * 1.5 - (i / 16) * (Math.PI / 2);
    pts.push([g.blc.x + g.rBLi * Math.cos(t), g.blc.z + g.rBLi * Math.sin(t)]);
  }
  pts.push([g.xi, g.blc.z]);
  return pts;
}

/**
 * 回廊の縁の 1 辺：床板の縁（明るい木口）、鼻隠し（区画ごとに金文字の帯）、下の刳り形。
 * a → b は部屋から見て左から右、out は部屋の側の向き。marks は辺に沿った区画の並び（a からの距離の範囲と、字のセルの番号）
 */
function fasciaRun(
  ctx: BuildContext,
  a: [number, number],
  b: [number, number],
  out: THREE.Vector3,
  marks: { s0: number; s1: number; word?: number; rosette?: boolean }[],
  atlas: InscriptionAtlas,
) {
  const { cfg, st, mb } = ctx;
  const c = cfg.colors;
  const G = cfg.room.gallery;
  const g = wallGeometry(ctx);
  const gy = G.y;
  const yDeck = gy - G.deck;
  const yb = g.fasciaBottom;
  const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
  const dir = V((b[0] - a[0]) / len, 0, (b[1] - a[1]) / len);
  const P = (s: number, o: number, y: number) => V(a[0] + dir.x * s + out.x * o, y, a[1] + dir.z * s + out.z * o);
  const fo = -0.012;
  const wood = st.face('wood', c.woodDark);
  const edge = st.face('wood', c.woodLight);
  const ins = st.face('inscription', '#4a2f1e');
  // 床板の縁（少し出た明るい木口）と、その下の細い刳り形
  mb.group(() => {
    mb.quadAuto(P(0, 0.012, yDeck), P(len, 0.012, yDeck), P(len, 0.012, gy), P(0, 0.012, gy), out, edge, { cell: 0.25 });
    mb.quadAuto(P(0, fo, yDeck), P(len, fo, yDeck), P(len, 0.012, yDeck), P(0, 0.012, yDeck), V(0, -1, 0), edge, { cell: 1e3 });
  });
  // 鼻隠し：帯の上と下は木、帯は区画ごとに字（柱形の上は花の飾り）
  const band0 = yb + (yDeck - yb) * 0.33;
  const band1 = yb + (yDeck - yb) * 0.7;
  const face = (s0: number, s1: number, y0: number, y1: number, f: FaceInfo, uv?: [number, number, number, number]) => {
    if (s1 - s0 < 1e-4) return;
    mb.quadAuto(P(s0, fo, y0), P(s1, fo, y0), P(s1, fo, y1), P(s0, fo, y1), out, f, { uOffset: s0, v0: y0, cell: 0.3, uvRect: uv });
  };
  mb.group(() => {
    face(0, len, yb + 0.035, band0, wood);
    face(0, len, band1, yDeck, wood);
    let s = 0;
    for (const m of [...marks].sort((p, q) => p.s0 - q.s0)) {
      const s0 = Math.max(0, m.s0);
      const s1 = Math.min(len, m.s1);
      if (s1 <= s0) continue;
      face(s, s0, band0, band1, wood);
      if (m.word !== undefined) face(s0, s1, band0, band1, ins, atlas.word(m.word));
      else if (m.rosette) face(s0, s1, band0, band1, ins, atlas.rosette((s1 - s0) / (band1 - band0)));
      else face(s0, s1, band0, band1, wood);
      s = s1;
    }
    face(s, len, band0, band1, wood);
    // 帯の上下の細い縁（金の字の帯を額のように囲む）
    for (const y of [band0, band1]) {
      mb.quadAuto(P(0, fo + 0.008, y - 0.006), P(len, fo + 0.008, y - 0.006), P(len, fo + 0.008, y + 0.006), P(0, fo + 0.008, y + 0.006), out, edge, { cell: 1e3 });
      mb.quadAuto(P(0, fo, y + 0.006), P(len, fo, y + 0.006), P(len, fo + 0.008, y + 0.006), P(0, fo + 0.008, y + 0.006), V(0, 1, 0), edge, { cell: 1e3 });
      mb.quadAuto(P(0, fo, y - 0.006), P(len, fo, y - 0.006), P(len, fo + 0.008, y - 0.006), P(0, fo + 0.008, y - 0.006), V(0, -1, 0), edge, { cell: 1e3 });
    }
  });
  // 下の刳り形（少し出た縁と、その下の面）
  mb.group(() => {
    mb.quadAuto(P(0, fo + 0.016, yb), P(len, fo + 0.016, yb), P(len, fo + 0.016, yb + 0.035), P(0, fo + 0.016, yb + 0.035), out, edge, { cell: 0.25 });
    mb.quadAuto(P(0, fo, yb + 0.035), P(len, fo, yb + 0.035), P(len, fo + 0.016, yb + 0.035), P(0, fo + 0.016, yb + 0.035), V(0, 1, 0), edge, { cell: 1e3 });
    mb.quadAuto(P(0, -0.6, yb), P(len, -0.6, yb), P(len, fo + 0.016, yb), P(0, fo + 0.016, yb), V(0, -1, 0), edge, { cell: 0.3 });
  });
}

/** 回廊：鼻隠し・天井・端の面・手すり */
export function buildGallery(ctx: BuildContext, atlas: InscriptionAtlas) {
  const { cfg, st, mb } = ctx;
  const c = cfg.colors;
  const R = cfg.room;
  const g = wallGeometry(ctx);
  ctx.deckOutline = deckPolygon(ctx);
  const e = g.edge;
  const ps = g.pierStart;
  const pw = R.lowerCases.pilaster;
  const nL = R.lowerCases.depth;
  // 区画の並び（壁に沿った座標）から、鼻隠しの帯の区画を作る。角の区画（鼻隠しの角の裏に隠れる）は字を入れない
  const marksFor = (coordToS: (x: number) => number, words: number[]) => {
    const marks: { s0: number; s1: number; word?: number; rosette?: boolean }[] = [];
    g.bays.forEach(([b0, b1], i) => {
      const s0 = coordToS(b0);
      const s1 = coordToS(b1);
      const lo = Math.min(s0, s1);
      const hi = Math.max(s0, s1);
      const wi = words[i - 1];
      if (i > 0 && wi !== undefined) marks.push({ s0: lo, s1: hi, word: wi });
    });
    g.pilasters.forEach((p) => {
      const s0 = coordToS(p - pw / 2);
      const s1 = coordToS(p + pw / 2);
      marks.push({ s0: Math.min(s0, s1), s1: Math.max(s0, s1), rosette: true });
    });
    return marks;
  };
  const nl = cfg.inscription.left.length;
  const leftWords = Array.from({ length: nl }, (_, i) => i);
  const backWords = Array.from({ length: cfg.inscription.back.length }, (_, i) => nl + i);
  // 左の回廊の縁：部屋から見て左（手前、z = ps）から右（奥の角）へ。区画の座標は z
  fasciaRun(ctx, [e, ps], [e, e], V(1, 0, 0), marksFor((z) => ps - z, [...leftWords].reverse()), atlas);
  // 奥の回廊の縁：左（角）から右（x = ps）へ
  fasciaRun(ctx, [e, e], [ps, e], V(0, 0, 1), marksFor((x) => x - e, backWords), atlas);
  // 両端の面（左の回廊の手前の端、奥の回廊の右の端）
  fasciaRun(ctx, [g.xi + R.pier.projection, ps], [e, ps], V(0, 0, 1), [], atlas);
  fasciaRun(ctx, [ps, e], [ps, g.zi + R.pier.projection], V(1, 0, 0), [], atlas);
  // 1 階の本棚の上の天井（回廊の床の裏。鏡板）
  {
    const f = st.face('panel', c.woodPanel);
    const y = g.fasciaBottom;
    const cf = g.xi + nL;
    mb.quadAuto(V(cf, y, ps), V(e, y, ps), V(e, y, cf), V(cf, y, cf), V(0, -1, 0), f, { cell: 0.3 });
    mb.quadAuto(V(cf, y, cf), V(e, y, cf), V(e, y, e), V(cf, y, e), V(0, -1, 0), f, { cell: 0.3 });
    mb.quadAuto(V(e, y, cf), V(ps, y, cf), V(ps, y, e), V(e, y, e), V(0, -1, 0), f, { cell: 0.3 });
  }
  buildRailings(ctx);
}

/**
 * 手すり：柱（上に真鍮の玉）、上と下の横木、真鍮の手すり子。posts は柱を立てる所（道に沿った距離）。
 * 手すり子は柱の間に等間隔に並べる
 */
export function balustrade(ctx: BuildContext, path: [number, number][], y: number, opts: { height: number; posts: number[]; balusterSpacing: number; postSize?: number }) {
  const { cfg, st, mb } = ctx;
  const c = cfg.colors;
  const wood = st.face('wood', c.woodDark);
  const brass = st.face('brass', c.brass);
  const H = opts.height;
  const ps = opts.postSize ?? 0.05;
  const segLen = path.slice(1).map((p, i) => Math.hypot(p[0] - path[i][0], p[1] - path[i][1]));
  const total = segLen.reduce((s, v) => s + v, 0);
  const pointAt = (d: number): [number, number] => {
    let acc = 0;
    for (let i = 0; i < segLen.length; i++) {
      if (d <= acc + segLen[i] || i === segLen.length - 1) {
        const t = segLen[i] > 0 ? Math.min(1, Math.max(0, (d - acc) / segLen[i])) : 0;
        return [path[i][0] + (path[i + 1][0] - path[i][0]) * t, path[i][1] + (path[i + 1][1] - path[i][1]) * t];
      }
      acc += segLen[i];
    }
    return path[path.length - 1];
  };
  // 横木（笠木は少し太く、上面に丸み）
  for (let i = 0; i < path.length - 1; i++) {
    const a = path[i];
    const b = path[i + 1];
    mb.beam(V(a[0], y + H - 0.032, a[1]), V(b[0], y + H - 0.032, b[1]), 0.04, 0.03, wood, { cell: 0.25 });
    mb.beam(V(a[0], y + H - 0.072, a[1]), V(b[0], y + H - 0.072, b[1]), 0.0275, 0.0125, st.face('wood', c.wood), { cell: 0.25 });
    mb.beam(V(a[0], y + 0.05, a[1]), V(b[0], y + 0.05, b[1]), 0.0325, 0.0225, wood, { cell: 0.25 });
  }
  const posts = [...opts.posts].sort((p, q) => p - q);
  const post = (p: [number, number]) => {
    mb.group(() => {
      mb.aabb([p[0] - ps / 2, p[0] + ps / 2], [y, y + H + 0.04], [p[1] - ps / 2, p[1] + ps / 2], st.face('panel', c.wood), { skip: ['bottom'], top: wood });
      mb.aabb([p[0] - ps / 2 - 0.012, p[0] + ps / 2 + 0.012], [y, y + 0.09], [p[1] - ps / 2 - 0.012, p[1] + ps / 2 + 0.012], wood, { skip: ['bottom'] });
      mb.aabb([p[0] - ps / 2 - 0.014, p[0] + ps / 2 + 0.014], [y + H + 0.04, y + H + 0.075], [p[1] - ps / 2 - 0.014, p[1] + ps / 2 + 0.014], wood, {});
    });
    mb.lathe(p, [[0.0, y + H + 0.075], [0.026, y + H + 0.08], [0.017, y + H + 0.1]], brass, 10, { capBottom: false });
    mb.sphere(V(p[0], y + H + 0.135, p[1]), 0.042, brass, 12, 8);
  };
  for (const d of posts) post(pointAt(d));
  // 手すり子：柱と柱の間に等間隔
  const bounds = [0, ...posts, total].filter((v, i, arr) => i === 0 || v - arr[i - 1] > 1e-4);
  for (let k = 0; k < bounds.length - 1; k++) {
    const d0 = bounds[k] + (posts.includes(bounds[k]) ? ps / 2 + 0.02 : 0.02);
    const d1 = bounds[k + 1] - (posts.includes(bounds[k + 1]) ? ps / 2 + 0.02 : 0.02);
    const span = d1 - d0;
    if (span < 0.05) continue;
    const nb = Math.max(1, Math.round(span / opts.balusterSpacing));
    for (let i = 0; i < nb; i++) {
      const d = d0 + (span * (i + 0.5)) / nb;
      baluster(mb, brass, pointAt(d), y + 0.072, y + H - 0.0425, 0.5);
    }
  }
  return { total, pointAt };
}

/** 真鍮の手すり子（ろくろ挽きの壺の形。ふくらみと細いくびれで、丸い面ごとに光の点ができる） */
export function baluster(mb: MeshBuilder, f: FaceInfo, p: [number, number], y0: number, y1: number, scale = 1) {
  const h = y1 - y0;
  const s = scale;
  const prof: [number, number][] = [
    [0.028 * s, y0],
    [0.028 * s, y0 + h * 0.06],
    [0.015 * s, y0 + h * 0.1],
    [0.023 * s, y0 + h * 0.16],
    [0.036 * s, y0 + h * 0.3],
    [0.025 * s, y0 + h * 0.46],
    [0.013 * s, y0 + h * 0.62],
    [0.013 * s, y0 + h * 0.74],
    [0.025 * s, y0 + h * 0.82],
    [0.013 * s, y0 + h * 0.9],
    [0.025 * s, y1],
  ];
  mb.lathe(p, prof, f, 10, { capBottom: false, capTop: false });
}

/** 回廊の手すり：左の回廊の手前の端 → 左の縁 → 角 → 奥の縁（らせん階段の上で切れる）→ 右の端 */
function buildRailings(ctx: BuildContext) {
  const R = ctx.cfg.room;
  const G = R.gallery;
  const g = wallGeometry(ctx);
  const r = g.edge - 0.05;
  const ps = g.pierStart;
  const sp = spiralGeometry(ctx);
  const pp = R.pier.projection;
  // 1 本目：左の回廊の手前の端（柱の脇）→ 左の縁 → 角 → 奥の縁の階段の手前 → 階段の踊り場の左の縁
  const zEnd = ps - 0.05;
  const xGapL = sp.gapLeft[0];
  const pathA: [number, number][] = [
    [g.xi + pp + 0.02, zEnd],
    [r, zEnd],
    [r, r],
    [xGapL, r],
    sp.gapLeft,
    sp.landingInner,
  ];
  // 柱の位置：手前の端、手前の角、本棚の柱形の位置（左の縁は z、奥の縁は x）、奥の角、階段の手前
  const segA = pathA.slice(1).map((p, i) => Math.hypot(p[0] - pathA[i][0], p[1] - pathA[i][1]));
  const cum = (k: number) => segA.slice(0, k).reduce((s, v) => s + v, 0);
  const postsA: number[] = [0, cum(1), cum(2), cum(3), cum(4)];
  for (const p of g.pilasters) {
    if (p < zEnd - 0.2 && p > r + 0.2) postsA.push(cum(1) + (zEnd - p));
    if (p > r + 0.2 && p < xGapL - 0.2) postsA.push(cum(2) + (p - r));
  }
  balustrade(ctx, pathA, G.y, { height: G.railHeight, posts: postsA, balusterSpacing: G.balusterSpacing });
  // 2 本目：階段の踊り場の右から、奥の縁の右の端 → 右の端の柱の脇
  const pathB: [number, number][] = [sp.gapRight, [sp.gapRight[0], r], [ps - 0.05, r], [ps - 0.05, g.zi + pp + 0.02]];
  const segB = pathB.slice(1).map((p, i) => Math.hypot(p[0] - pathB[i][0], p[1] - pathB[i][1]));
  const postsB = [segB[0] + segB[1], segB[0] + segB[1] + segB[2]];
  balustrade(ctx, pathB, G.y, { height: G.railHeight, posts: postsB, balusterSpacing: G.balusterSpacing });
}

/** 親柱：四角い柱（鏡板）、笠、真鍮の玉 */
export function newel(ctx: BuildContext, p: [number, number], y0: number, y1: number, w: number) {
  const { cfg, st, mb } = ctx;
  const c = cfg.colors;
  mb.group(() => {
    mb.aabb([p[0] - w / 2, p[0] + w / 2], [y0, y1], [p[1] - w / 2, p[1] + w / 2], st.face('panel', c.wood), { skip: ['bottom', 'top'] });
    mb.aabb([p[0] - w / 2 - 0.02, p[0] + w / 2 + 0.02], [y0, y0 + 0.08], [p[1] - w / 2 - 0.02, p[1] + w / 2 + 0.02], st.face('wood', c.woodDark), { skip: ['bottom'] });
    mb.aabb([p[0] - w / 2 - 0.025, p[0] + w / 2 + 0.025], [y1, y1 + 0.05], [p[1] - w / 2 - 0.025, p[1] + w / 2 + 0.025], st.face('wood', c.woodDark), {});
  });
  mb.lathe(p, [[0.0, y1 + 0.05], [0.03, y1 + 0.055], [0.02, y1 + 0.075]], st.face('brass', c.brass), 10, { capBottom: false });
  mb.sphere(V(p[0], y1 + 0.13, p[1]), 0.058, st.face('brass', c.brass), 12, 8);
}
