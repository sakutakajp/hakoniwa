import * as THREE from 'three';
import type { CityLevels, Layout } from './layout';
import type { SceneConfig } from './config';
import type { FaceInfo, MeshBuilder } from './meshBuilder';
import { edgeNormal } from './ground';

/**
 * 桟橋（ピア 17）：岸から水の上に張り出した板張りの床と、川底まで届く杭、床の縁の手すり、
 * ガラス張りの上屋（低い寄棟の屋根の上に、明かり取りの切妻の屋根）。
 * 返す pilings は水面の泡を描く所（杭の中心と半径）。高さは島の地面が 0
 */
export function addPier(mb: MeshBuilder, layout: Layout, cfg: SceneConfig, index: (name: string) => number, levels: CityLevels) {
  const pc = cfg.pier;
  const col = (c: string) => new THREE.Color(c);
  const plain = index('roofbox');
  const plank: FaceInfo = { style: index('plank'), color: col(cfg.wallColors.plank) };
  const plankEdge: FaceInfo = { style: plain, color: col(cfg.wallColors.plank).multiplyScalar(0.82) };
  const piling: FaceInfo = { style: plain, color: col(pc.piling) };
  const pilingDark: FaceInfo = { style: plain, color: col(pc.pilingDark) };
  const rail: FaceInfo = { style: index('railing'), color: col(cfg.wallColors.railing) };
  const post: FaceInfo = { style: plain, color: col(cfg.wallColors.railing).multiplyScalar(0.9) };
  const glass: FaceInfo = { style: index('shed'), color: col(cfg.wallColors.shed) };
  const roof: FaceInfo = { style: plain, color: col(pc.roof) };
  const ridge: FaceInfo = { style: plain, color: col(pc.roofRidge) };
  const edge: FaceInfo = { style: plain, color: col(pc.roofEdge) };
  const P = layout.pier;
  const [dx0, dx1, dz0, dz1] = P.deck;
  // 床の上面は歩道（0.022）よりわずかに高い
  const top = P.deckY + 0.03;
  const slab = 0.03;
  const pilings: { x: number; z: number; r: number }[] = [];
  const v3 = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
  const shore = layout.island.front;

  // --- 床（板張り）と縁の厚み
  const prevCell = mb.maxCell;
  mb.maxCell = 0.1;
  mb.box([(dx0 + dx1) / 2, (dz0 + dz1) / 2], [dx1 - dx0, dz1 - dz0], [top - slab, top], plankEdge, plank, { bottom: plankEdge });
  // 杭：川底から床の下まで。縁に沿って一定の間隔で（陸の上は省く）
  const pile = (x: number, z: number, r: number, f: FaceInfo) => {
    if (z < shore + 0.04) return;
    const bed = levels.bedAt(x, z) - 0.03;
    mb.cylinder([x, z], [bed, top - slab], r, r * 0.92, f, 8, false);
    pilings.push({ x, z, r });
  };
  // 杭の間隔（水の塊の側面からも見えるので、混み合いすぎないように）
  const step = 0.3;
  for (let x = dx0 + 0.03; x <= dx1 - 0.02; x += step) pile(x, dz1 - 0.03, 0.022, piling);
  pile(dx1 - 0.03, dz1 - 0.03, 0.022, piling);
  for (let z = dz1 - 0.03 - step; z > shore; z -= step) {
    pile(dx0 + 0.03, z, 0.022, piling);
    pile(dx1 - 0.03, z, 0.022, piling);
  }
  // 床の下の中ほどの杭（奥に暗く見える）
  for (let x = dx0 + 0.27; x <= dx1 - 0.2; x += step * 2) for (let z = dz1 - 0.3; z > shore + 0.1; z -= step * 2) pile(x, z, 0.02, pilingDark);

  // --- 手すり（西・南・東の縁）と太い柱
  const railH = 0.065;
  /** a から b へ（外から見て左から右）の手すり。両面を描く */
  const railing = (a: THREE.Vector3, b: THREE.Vector3) => {
    const lift = (p: THREE.Vector3, dy: number) => p.clone().add(v3(0, dy, 0));
    mb.quad(a, b, lift(b, railH), lift(a, railH), rail);
    mb.quad(b, a, lift(a, railH), lift(b, railH), rail);
    const len = a.distanceTo(b);
    const n = Math.max(1, Math.round(len / 0.2));
    for (let i = 0; i <= n; i++) {
      const p = a.clone().lerp(b, i / n);
      mb.box([p.x, p.z], [0.016, 0.016], [p.y, p.y + railH + 0.008], post, post);
    }
  };
  const e = 0.012;
  railing(v3(dx0 + e, top, shore + 0.02), v3(dx0 + e, top, dz1 - e));
  railing(v3(dx0 + e, top, dz1 - e), v3(dx1 - e, top, dz1 - e));
  railing(v3(dx1 - e, top, dz1 - e), v3(dx1 - e, top, shore + 0.02));

  // --- 上屋：ガラスの壁、軒の帯、低い寄棟の屋根、明かり取りの切妻
  const [sx0, sx1, sz0, sz1] = P.shed;
  const wallTop = top + (P.shedY[1] - P.shedY[0]);
  mb.box([(sx0 + sx1) / 2, (sz0 + sz1) / 2], [sx1 - sx0, sz1 - sz0], [top, wallTop], glass, null);
  // 軒の帯（屋根の縁の白い板）
  const ov = 0.05;
  const ex0 = sx0 - ov;
  const ex1 = sx1 + ov;
  const ez0 = sz0 - ov;
  const ez1 = sz1 + ov;
  const eaveH = 0.03;
  mb.box([(ex0 + ex1) / 2, (ez0 + ez1) / 2], [ex1 - ex0, ez1 - ez0], [wallTop, wallTop + eaveH], edge, null, { bottom: edge });
  // 寄棟の屋根：四辺から中央の棟へゆるく上がる
  const y0 = wallTop + eaveH;
  const roofH = P.roofY - P.shedY[1];
  const rz = (ez1 - ez0) * 0.22;
  const rx0 = ex0 + (ez1 - ez0) / 2 - rz;
  const rx1 = ex1 - (ez1 - ez0) / 2 + rz;
  const zc = (ez0 + ez1) / 2;
  const yr = y0 + roofH;
  const c00 = v3(ex0, y0, ez1);
  const c10 = v3(ex1, y0, ez1);
  const c11 = v3(ex1, y0, ez0);
  const c01 = v3(ex0, y0, ez0);
  const r0f = v3(rx0, yr, zc + rz);
  const r1f = v3(rx1, yr, zc + rz);
  const r1b = v3(rx1, yr, zc - rz);
  const r0b = v3(rx0, yr, zc - rz);
  mb.quad(c00, c10, r1f, r0f, roof); // 南（手前）
  mb.quad(c11, c01, r0b, r1b, roof); // 北（奥）
  mb.quad(c10, c11, r1b, r1f, roof); // 東
  mb.quad(c01, c00, r0f, r0b, roof); // 西
  mb.flat([r0f, r1f, r1b, r0b], roof);
  // 明かり取り：棟の上に、ガラスの側面と切妻の屋根（東西の端はガラスの三角の面）
  const cw = rz * 0.95;
  const ch = 0.06;
  const cx0 = rx0 + 0.02;
  const cx1 = rx1 - 0.02;
  mb.box([(cx0 + cx1) / 2, zc], [cx1 - cx0, cw * 2], [yr, yr + ch], glass, null);
  const gy = yr + ch;
  const gh = 0.055;
  const gov = 0.02;
  const g00 = v3(cx0 - gov, gy, zc + cw + gov);
  const g10 = v3(cx1 + gov, gy, zc + cw + gov);
  const g11 = v3(cx1 + gov, gy, zc - cw - gov);
  const g01 = v3(cx0 - gov, gy, zc - cw - gov);
  const gt0 = v3(cx0 - gov, gy + gh, zc);
  const gt1 = v3(cx1 + gov, gy + gh, zc);
  mb.quad(g00, g10, gt1, gt0, ridge);
  mb.quad(g11, g01, gt0, gt1, ridge);
  // 切妻の三角（東と西）
  mb.triangle(v3(cx1, gy, zc + cw), v3(cx1, gy, zc - cw), v3(cx1, gy + gh * 0.9, zc), glass);
  mb.triangle(v3(cx0, gy, zc - cw), v3(cx0, gy, zc + cw), v3(cx0, gy + gh * 0.9, zc), glass);
  mb.maxCell = prevCell;

  const outline = [v3(ex0, gy + gh, ez0), v3(ex1, gy + gh, ez1), v3(dx1, top, dz1), v3(dx0, top, dz1)];
  return { pilings, outline, top };
}

/**
 * 遊歩道の水ぎわの手すり：島の護岸に沿って、少し内側に。桟橋・橋台の付け根、砂浜の前、台座の縁の近くは空ける
 */
export function addPromenadeRailing(
  mb: MeshBuilder,
  cfg: SceneConfig,
  index: (name: string) => number,
  runs: [number, number][][],
  /** ccw：島の外形の向き（signedArea > 0） */
  opts: { y: number; ccw: boolean; skip: (x: number, z: number) => boolean },
) {
  const rail: FaceInfo = { style: index('railing'), color: new THREE.Color(cfg.wallColors.railing) };
  const post: FaceInfo = { style: index('roofbox'), color: new THREE.Color(cfg.wallColors.railing).multiplyScalar(0.9) };
  const railH = 0.05;
  const inset = 0.022;
  const prevCell = mb.maxCell;
  mb.maxCell = 0.12;
  let posts = 0;
  for (const run of runs) {
    // 岸の線を内側へずらした点（外向きの法線の逆へ）
    const pts: THREE.Vector3[] = [];
    for (let i = 0; i < run.length; i++) {
      const a = run[Math.max(0, i - 1)];
      const b = run[Math.min(run.length - 1, i + 1)];
      const [nx, nz] = edgeNormal(a, b, opts.ccw);
      pts.push(new THREE.Vector3(run[i][0] - nx * inset, opts.y, run[i][1] - nz * inset));
    }
    // 細かく分けて、空ける所を除いた区間ごとに手すりを作る
    const fine: THREE.Vector3[] = [];
    for (let i = 0; i + 1 < pts.length; i++) {
      const n = Math.max(1, Math.ceil(pts[i].distanceTo(pts[i + 1]) / 0.05));
      for (let k = 0; k < n; k++) fine.push(pts[i].clone().lerp(pts[i + 1], k / n));
    }
    if (pts.length) fine.push(pts[pts.length - 1]);
    let seg: THREE.Vector3[] = [];
    const flush = () => {
      if (seg.length >= 2) {
        for (let i = 0; i + 1 < seg.length; i++) {
          const a = seg[i];
          const b = seg[i + 1];
          const up = (p: THREE.Vector3) => p.clone().add(new THREE.Vector3(0, railH, 0));
          mb.quad(a, b, up(b), up(a), rail, { uOffset: i * 0.05 });
          mb.quad(b, a, up(a), up(b), rail, { uOffset: i * 0.05 });
        }
        for (let i = 0; i < seg.length; i += 4) {
          const p = seg[i];
          mb.box([p.x, p.z], [0.014, 0.014], [p.y, p.y + railH + 0.008], post, post);
          posts++;
        }
      }
      seg = [];
    };
    for (const p of fine) {
      if (opts.skip(p.x, p.z)) flush();
      else seg.push(p);
    }
    flush();
  }
  mb.maxCell = prevCell;
  return posts;
}
