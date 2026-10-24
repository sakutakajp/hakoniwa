import * as THREE from 'three';
import type { FaceInfo, MeshBuilder } from '../meshBuilder';

/**
 * 刳り形（軒の刳り形・台輪・帯など）：断面を、上から見た道に沿って押し出す。
 * 道は [x, z] の点の並び。部屋の側（断面の d の正の向き）は、進む向きの左手（上から見て）＝ (−dz, dx)。
 * 断面は下から上への [d, y]（d は道からの出、y は高さ）。角では両側の辺の法線の平均の向きへ、出を保つように伸ばす（留め継ぎ）。
 * 道に沿った長さを模様の u にする（角の弧でも木目・石目が続く）
 */
export function extrudeProfile(
  mb: MeshBuilder,
  path: [number, number][],
  profile: [number, number][],
  f: FaceInfo,
  opts: { capStart?: boolean; capEnd?: boolean; cell?: number } = {},
) {
  const n = path.length;
  if (n < 2 || profile.length < 2) return;
  // 辺ごとの部屋の側の法線と、点ごとの留めの向き（長さは出を保つ倍率込み）
  const segN: THREE.Vector2[] = [];
  for (let i = 0; i < n - 1; i++) {
    const dx = path[i + 1][0] - path[i][0];
    const dz = path[i + 1][1] - path[i][1];
    const l = Math.hypot(dx, dz) || 1;
    segN.push(new THREE.Vector2(-dz / l, dx / l));
  }
  const miter: THREE.Vector2[] = path.map((_, i) => {
    const a = segN[Math.max(0, i - 1)];
    const b = segN[Math.min(n - 2, i)];
    const m = a.clone().add(b);
    if (m.lengthSq() < 1e-8) return b.clone();
    m.normalize();
    const k = 1 / Math.max(m.dot(b), 0.35);
    return m.multiplyScalar(k);
  });
  const dist: number[] = [0];
  for (let i = 1; i < n; i++) dist.push(dist[i - 1] + Math.hypot(path[i][0] - path[i - 1][0], path[i][1] - path[i - 1][1]));
  const P = (i: number, k: number) => {
    const [d, y] = profile[k];
    return new THREE.Vector3(path[i][0] + miter[i].x * d, y, path[i][1] + miter[i].y * d);
  };
  mb.group(() => {
    for (let k = 0; k < profile.length - 1; k++) {
      const [d0, y0] = profile[k];
      const [d1, y1] = profile[k + 1];
      if (Math.abs(d1 - d0) < 1e-6 && Math.abs(y1 - y0) < 1e-6) continue;
      // 断面の辺の外向き（断面を下から上へ進む向きの右手：縦の辺なら部屋の側、外へ出る段なら下向き）
      const ln = Math.hypot(d1 - d0, y1 - y0);
      const nd = (y1 - y0) / ln;
      const ny = -(d1 - d0) / ln;
      for (let i = 0; i < n - 1; i++) {
        const sn = segN[i];
        const out = new THREE.Vector3(sn.x * nd, ny, sn.y * nd);
        mb.quadAuto(P(i, k), P(i + 1, k), P(i + 1, k + 1), P(i, k + 1), out, f, { uOffset: dist[i], v0: y0, cell: opts.cell });
      }
    }
    // 端のふた（断面の形の板）
    const cap = (i: number, dir: number) => {
      const t = new THREE.Vector2(path[Math.min(i + 1, n - 1)][0] - path[Math.max(i - 1, 0)][0], path[Math.min(i + 1, n - 1)][1] - path[Math.max(i - 1, 0)][1]).normalize();
      const nrm = new THREE.Vector3(t.x * dir, 0, t.y * dir);
      const pts2 = [[0, profile[0][1]] as [number, number], ...profile, [0, profile[profile.length - 1][1]] as [number, number]];
      const contour = pts2.map(([d, y]) => new THREE.Vector2(d, y));
      if (THREE.ShapeUtils.isClockWise(contour)) contour.reverse();
      const tris = THREE.ShapeUtils.triangulateShape(contour, []);
      const base = mb.vertexCount;
      for (const c of contour) {
        const p = new THREE.Vector3(path[i][0] + miter[i].x * c.x, c.y, path[i][1] + miter[i].y * c.x);
        mb.addVertex(p, nrm, f, c.x, c.y, 1, 1);
      }
      // 断面の面（d, y）での反時計回りが、どちら向きの面になるか：d の向き × y の向き と、ふたの外向きを比べる
      const dAxis = new THREE.Vector3(miter[i].x, 0, miter[i].y).normalize();
      const facing = new THREE.Vector3().crossVectors(dAxis, new THREE.Vector3(0, 1, 0)).dot(nrm);
      for (const [a, b, c] of tris) {
        if (facing > 0) mb.indices.push(base + a, base + b, base + c);
        else mb.indices.push(base + a, base + c, base + b);
      }
    };
    if (opts.capStart) cap(0, -1);
    if (opts.capEnd) cap(n - 1, 1);
  });
}

/** 弧の点の並び（中心 c、半径 r、角度 t0 から t1 へ。角度は +x から +z へ） */
export function arcPath(c: [number, number], r: number, t0: number, t1: number, segments: number): [number, number][] {
  return Array.from({ length: segments + 1 }, (_, i) => {
    const t = t0 + ((t1 - t0) * i) / segments;
    return [c[0] + r * Math.cos(t), c[1] + r * Math.sin(t)] as [number, number];
  });
}

/** 点の並びをつなぐ（つなぎ目の同じ点は 1 つにする） */
export function joinPaths(...parts: [number, number][][]): [number, number][] {
  const out: [number, number][] = [];
  for (const p of parts) {
    for (const q of p) {
      const last = out[out.length - 1];
      if (last && Math.hypot(last[0] - q[0], last[1] - q[1]) < 1e-6) continue;
      out.push(q);
    }
  }
  return out;
}
