/**
 * 上から見た平面（x, z）の図形の計算：直線、折れ線、多角形、角丸正方形の外周。
 * 点は [x, z] の組で持つ
 */
export type P2 = [number, number];

export const deg = (d: number) => (d * Math.PI) / 180;

/** 点 p を通り、角度 dirDeg（+x から +z へ回る向き、度）へ伸びる直線 */
export interface Line2 {
  p: P2;
  /** 向き（単位ベクトル） */
  u: P2;
  /** 左の法線（u を -90° 回した向き。+x 向きの線なら -z、つまり奥） */
  n: P2;
}

export function line(p: P2, dirDeg: number): Line2 {
  const a = deg(dirDeg);
  const u: P2 = [Math.cos(a), Math.sin(a)];
  return { p, u, n: [u[1], -u[0]] };
}

/** 直線上の距離 s と、法線の向きへの距離 d で表した点 */
export function onLine(l: Line2, s: number, d = 0): P2 {
  return [l.p[0] + l.u[0] * s + l.n[0] * d, l.p[1] + l.u[1] * s + l.n[1] * d];
}

/** 点の、直線に沿った位置 s と法線の向きの距離 d（左の法線の向きが正） */
export function lineCoords(l: Line2, q: P2): [number, number] {
  const vx = q[0] - l.p[0];
  const vz = q[1] - l.p[1];
  return [vx * l.u[0] + vz * l.u[1], vx * l.n[0] + vz * l.n[1]];
}

export function intersectLines(a: Line2, b: Line2): P2 {
  // a.p + t a.u = b.p + s b.u
  const den = a.u[0] * b.u[1] - a.u[1] * b.u[0];
  const dx = b.p[0] - a.p[0];
  const dz = b.p[1] - a.p[1];
  const t = (dx * b.u[1] - dz * b.u[0]) / den;
  return [a.p[0] + a.u[0] * t, a.p[1] + a.u[1] * t];
}

/** 線分 ab と cd の交点（線分の範囲の外なら null）。ta は ab に沿った割合 */
export function segmentIntersection(a: P2, b: P2, c: P2, d: P2): { p: P2; ta: number; tc: number } | null {
  const rx = b[0] - a[0];
  const rz = b[1] - a[1];
  const sx = d[0] - c[0];
  const sz = d[1] - c[1];
  const den = rx * sz - rz * sx;
  if (Math.abs(den) < 1e-12) return null;
  const qx = c[0] - a[0];
  const qz = c[1] - a[1];
  const t = (qx * sz - qz * sx) / den;
  const u = (qx * rz - qz * rx) / den;
  if (t < 0 || t > 1 || u < 0 || u > 1) return null;
  return { p: [a[0] + rx * t, a[1] + rz * t], ta: t, tc: u };
}

/** 角丸正方形の外周（上から見て、+y から見下ろして反時計回り＝ x→z の向きで時計回り）。始まりは右の辺の手前の端 */
export function roundedSquare(half: number, radius: number, perCorner = 16): P2[] {
  const c = half - radius;
  const pts: P2[] = [];
  const corners: [number, number, number][] = [
    [c, c, 0],
    [-c, c, 90],
    [-c, -c, 180],
    [c, -c, 270],
  ];
  for (const [cx, cz, a0] of corners) {
    for (let i = 0; i <= perCorner; i++) {
      const a = deg(a0 + (90 * i) / perCorner);
      pts.push([cx + radius * Math.cos(a), cz + radius * Math.sin(a)]);
    }
  }
  return pts;
}

/** 角丸正方形の内側までの距離（内側が正） */
export function roundedSquareInside(x: number, z: number, half: number, radius: number): number {
  const qx = Math.abs(x) - (half - radius);
  const qz = Math.abs(z) - (half - radius);
  const outside = Math.hypot(Math.max(qx, 0), Math.max(qz, 0)) + Math.min(Math.max(qx, qz), 0) - radius;
  return -outside;
}

/** 多角形の内側か（偶奇の規則） */
export function insidePolygon(x: number, z: number, pts: readonly P2[]): boolean {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, zi] = pts[i];
    const [xj, zj] = pts[j];
    if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}

/** 多角形の辺までの最短距離（符号なし） */
export function distanceToPolyline(x: number, z: number, pts: readonly P2[], closed = true): number {
  let best = Infinity;
  const n = pts.length;
  const m = closed ? n : n - 1;
  for (let i = 0; i < m; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % n];
    const ex = b[0] - a[0];
    const ez = b[1] - a[1];
    const l2 = ex * ex + ez * ez || 1e-12;
    const t = Math.min(1, Math.max(0, ((x - a[0]) * ex + (z - a[1]) * ez) / l2));
    best = Math.min(best, Math.hypot(x - a[0] - ex * t, z - a[1] - ez * t));
  }
  return best;
}

/** 多角形の符号付き面積（x→z の向きで反時計回りが正） */
export function signedArea(pts: readonly P2[]): number {
  let a = 0;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) a += pts[j][0] * pts[i][1] - pts[i][0] * pts[j][1];
  return a / 2;
}

/**
 * 閉じた外周 outline を、外周を横切る折れ線 cut で 2 つに分ける。
 * cut の最初と最後の交点で外周に入って出る。戻り値の a は cut の左側（cut の向きに対して左の法線の側）、b は右側
 */
export function splitPolygon(outline: readonly P2[], cut: readonly P2[]): { a: P2[]; b: P2[]; cutInside: P2[] } {
  // cut と外周の交点を、cut に沿った順に集める
  const hits: { p: P2; ci: number; ct: number; oi: number; ot: number }[] = [];
  for (let i = 0; i < cut.length - 1; i++) {
    for (let j = 0; j < outline.length; j++) {
      const r = segmentIntersection(cut[i], cut[i + 1], outline[j], outline[(j + 1) % outline.length]);
      if (r) hits.push({ p: r.p, ci: i, ct: r.ta, oi: j, ot: r.tc });
    }
  }
  hits.sort((h1, h2) => h1.ci + h1.ct - (h2.ci + h2.ct));
  if (hits.length < 2) throw new Error('splitPolygon: 折れ線が外周を横切っていません');
  const enter = hits[0];
  const exit = hits[hits.length - 1];
  // 外周の内側の折れ線
  const inner: P2[] = [enter.p];
  for (let i = enter.ci + 1; i <= exit.ci; i++) inner.push(cut[i]);
  inner.push(exit.p);
  // 外周を exit から enter までたどる 2 通り
  const n = outline.length;
  const walk = (dir: 1 | -1): P2[] => {
    const pts: P2[] = [];
    if (dir === 1) {
      let k = (exit.oi + 1) % n;
      for (let guard = 0; guard < n + 2; guard++) {
        pts.push(outline[k]);
        if (k === enter.oi) break;
        k = (k + 1) % n;
      }
    } else {
      let k = exit.oi;
      for (let guard = 0; guard < n + 2; guard++) {
        pts.push(outline[k]);
        if (k === (enter.oi + 1) % n) break;
        k = (k - 1 + n) % n;
      }
    }
    return pts;
  };
  const polyF = [...inner, ...walk(1)];
  const polyB = [...inner, ...walk(-1)];
  // どちらが cut の左側か：cut の中ほどの左の点がどちらの内側か
  const mi = Math.floor(inner.length / 2);
  const p0 = inner[Math.max(0, mi - 1)];
  const p1 = inner[Math.min(inner.length - 1, mi)];
  const ux = p1[0] - p0[0];
  const uz = p1[1] - p0[1];
  const ul = Math.hypot(ux, uz) || 1;
  const probe: P2 = [(p0[0] + p1[0]) / 2 + (uz / ul) * 0.05, (p0[1] + p1[1]) / 2 - (ux / ul) * 0.05];
  const leftIsF = insidePolygon(probe[0], probe[1], polyF);
  return { a: leftIsF ? polyF : polyB, b: leftIsF ? polyB : polyF, cutInside: inner };
}

/** 2 本の直線のあいだを、半径 r の円弧でなめらかにつなぐ（a の上を進んで角を曲がり、b の上へ）。円弧の点の列 */
export function filletArc(a: Line2, b: Line2, r: number, steps = 10): P2[] {
  const x = intersectLines(a, b);
  // a の向き u1 と b の向き u2 のあいだの角
  const dot = a.u[0] * b.u[0] + a.u[1] * b.u[1];
  const theta = Math.acos(Math.max(-1, Math.min(1, dot)));
  const t = r * Math.tan(theta / 2);
  const pA: P2 = [x[0] - a.u[0] * t, x[1] - a.u[1] * t];
  const pB: P2 = [x[0] + b.u[0] * t, x[1] + b.u[1] * t];
  // 円の中心：曲がる向きの側
  const cross = a.u[0] * b.u[1] - a.u[1] * b.u[0];
  const side = cross > 0 ? 1 : -1;
  // a の右の法線（-n）か左の法線（n）か
  const nx = side > 0 ? -a.n[0] : a.n[0];
  const nz = side > 0 ? -a.n[1] : a.n[1];
  const c: P2 = [pA[0] + nx * r, pA[1] + nz * r];
  const a0 = Math.atan2(pA[1] - c[1], pA[0] - c[0]);
  let a1 = Math.atan2(pB[1] - c[1], pB[0] - c[0]);
  let da = a1 - a0;
  while (da > Math.PI) da -= 2 * Math.PI;
  while (da < -Math.PI) da += 2 * Math.PI;
  a1 = a0 + da;
  const pts: P2[] = [];
  for (let i = 0; i <= steps; i++) {
    const ang = a0 + (da * i) / steps;
    pts.push([c[0] + r * Math.cos(ang), c[1] + r * Math.sin(ang)]);
  }
  return pts;
}

/** 折れ線を、ほぼ等しい間隔の点に細かく分ける */
export function resample(pts: readonly P2[], step: number, closed = false): P2[] {
  const out: P2[] = [];
  const n = pts.length;
  const m = closed ? n : n - 1;
  for (let i = 0; i < m; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % n];
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const k = Math.max(1, Math.ceil(len / step));
    for (let j = 0; j < k; j++) out.push([a[0] + ((b[0] - a[0]) * j) / k, a[1] + ((b[1] - a[1]) * j) / k]);
  }
  if (!closed) out.push(pts[n - 1]);
  return out;
}

/**
 * 多角形を半平面で切り取る（Sutherland–Hodgman）。keep(p) が 0 以下の側を残す。keep は直線の式（一次関数）
 */
export function clipHalfPlane(poly: readonly P2[], keep: (p: P2) => number): P2[] {
  const out: P2[] = [];
  const n = poly.length;
  for (let i = 0; i < n; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % n];
    const fa = keep(a);
    const fb = keep(b);
    if (fa <= 0) out.push(a);
    if ((fa <= 0) !== (fb <= 0)) {
      const t = fa / (fa - fb);
      out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
    }
  }
  return out;
}

/** 直線 l の上の、多角形の内側にある区間（直線に沿った位置 s の範囲） */
export function lineInside(l: Line2, poly: readonly P2[], d = 0): [number, number] | null {
  const a = onLine(l, -40, d);
  const b = onLine(l, 40, d);
  const ts: number[] = [];
  for (let j = 0; j < poly.length; j++) {
    const r = segmentIntersection(a, b, poly[j], poly[(j + 1) % poly.length]);
    if (r) ts.push(-40 + 80 * r.ta);
  }
  if (ts.length < 2) return null;
  return [Math.min(...ts), Math.max(...ts)];
}
