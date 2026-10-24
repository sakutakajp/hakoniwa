import * as THREE from 'three';
import type { Layout } from './layout';
import type { SceneConfig } from './config';
import type { FaceInfo, MeshBuilder } from './meshBuilder';

/**
 * フェリー：とがった船首と丸い船尾の船体（下から紺・青・赤い線・白）、白い甲板、
 * 窓の帯のある 2 階建ての客室、前の操舵室、後ろのマストと赤い灯。
 * 船の向きは layout.ferry.heading（度。0 で船首が +z）。
 */
export interface FerryInfo {
  /** 船の中心と、船首の向き（水平の単位ベクトル）、長さと幅 */
  center: [number, number];
  dir: [number, number];
  length: number;
  width: number;
  outline: THREE.Vector3[];
}

export function addFerry(mb: MeshBuilder, layout: Layout, cfg: SceneConfig, index: (name: string) => number, waterY: number): FerryInfo {
  const F = layout.ferry;
  const fc = cfg.ferry;
  const L = F.length;
  const B = F.width;
  const h = THREE.MathUtils.degToRad(F.heading);
  const dir = new THREE.Vector3(Math.sin(h), 0, Math.cos(h));
  const lat = new THREE.Vector3(Math.cos(h), 0, -Math.sin(h));
  const P = (s: number, w: number, y: number) =>
    new THREE.Vector3(F.c[0], y, F.c[1]).addScaledVector(dir, s).addScaledVector(lat, w);
  const col = (c: string) => new THREE.Color(c);
  const plain = index('roofbox');
  const face = (c: string, k = 1): FaceInfo => ({ style: plain, color: col(c).multiplyScalar(k) });
  const white = face(fc.white);
  const deck = face(fc.deck);
  const win: FaceInfo = { style: index('ferryWin'), color: col(fc.white) };
  const wheel: FaceInfo = { style: index('wheelhouse'), color: col(fc.white) };

  // 船体の幅の半分（船尾 -L/2 から船首 +L/2）。船首はとがり、船尾は角の丸い四角
  const bowLen = 0.5;
  const sternR = 0.1;
  const halfWidth = (s: number) => {
    const hw = B / 2;
    if (s > L / 2 - bowLen) {
      const t = (s - (L / 2 - bowLen)) / bowLen;
      return hw * Math.max(0, 1 - Math.pow(t, 1.9));
    }
    if (s < -L / 2 + sternR) {
      const t = (-L / 2 + sternR - s) / sternR;
      return hw * (0.72 + 0.28 * Math.sqrt(Math.max(0, 1 - t * t)));
    }
    return hw;
  };
  /** 外形（上から見て反時計回り）：右舷を船尾から船首へ、左舷を船首から船尾へ */
  const outlineAt = (y: number, inset = 0, s0 = -L / 2, s1 = L / 2, n = 28) => {
    const pts: THREE.Vector3[] = [];
    for (let i = 0; i <= n; i++) {
      const s = s0 + ((s1 - s0) * i) / n;
      pts.push(P(s, Math.max(0.002, halfWidth(s) - inset), y));
    }
    for (let i = n; i >= 0; i--) {
      const s = s0 + ((s1 - s0) * i) / n;
      pts.push(P(s, -Math.max(0.002, halfWidth(s) - inset), y));
    }
    // 上から見て反時計回りにそろえる（(x, -z) の面積が正）
    let area = 0;
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i];
      const b = pts[(i + 1) % pts.length];
      area += a.x * -b.z - b.x * -a.z;
    }
    if (area < 0) pts.reverse();
    return pts;
  };
  /** 外形に沿った外向きの壁（高さ y0〜y1） */
  const wall = (pts: THREE.Vector3[], y0: number, y1: number, f: FaceInfo) => {
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i];
      const b = pts[(i + 1) % pts.length];
      if (a.distanceTo(b) < 1e-5) continue;
      mb.quad(new THREE.Vector3(a.x, y0, a.z), new THREE.Vector3(b.x, y0, b.z), new THREE.Vector3(b.x, y1, b.z), new THREE.Vector3(a.x, y1, a.z), f, {
        v0: y0 - waterY,
      });
    }
  };
  const prevCell = mb.maxCell;
  mb.maxCell = 0.08;

  // --- 船体：水面の少し下から、紺 → 青 → 赤い線 → 白い舷墻
  // 水の中の部分（喫水）も作る：水の塊の側面や水面越しに、船底まで見える
  const hullBottom = waterY - 0.075;
  const yBlue = waterY + 0.13;
  const yRed = yBlue + 0.022;
  const yDeck = waterY + 0.17;
  const yBul = yDeck + 0.026;
  const hull = outlineAt(0);
  // 船底は少し絞る（下ほど細い）
  const keel = outlineAt(hullBottom, 0.05);
  mb.polygon(keel, face(fc.hullDark, 0.8), true);
  for (let i = 0; i < hull.length; i++) {
    const j = (i + 1) % hull.length;
    if (hull[i].distanceTo(hull[j]) < 1e-5) continue;
    const a0 = keel[i];
    const b0 = keel[j];
    const a1 = new THREE.Vector3(hull[i].x, waterY - 0.03, hull[i].z);
    const b1 = new THREE.Vector3(hull[j].x, waterY - 0.03, hull[j].z);
    mb.quad(a0, b0, b1, a1, face(fc.hullDark, 0.9));
  }
  wall(hull, waterY - 0.03, waterY + 0.012, face(fc.hullDark));
  wall(hull, waterY + 0.012, yBlue, face(fc.hull));
  wall(hull, yBlue, yRed, face(fc.stripe));
  wall(hull, yRed, yBul, white);
  // 舷墻の上の縁（外形と内側の外形のあいだ）と内側の壁、少し低い甲板
  const inner = outlineAt(0, 0.014);
  const at = (p: THREE.Vector3, y: number) => new THREE.Vector3(p.x, y, p.z);
  for (let i = 0; i < hull.length; i++) {
    const j = (i + 1) % hull.length;
    if (hull[i].distanceTo(hull[j]) < 1e-5) continue;
    mb.flat([at(hull[i], yBul), at(hull[j], yBul), at(inner[j], yBul), at(inner[i], yBul)], white);
    mb.quad(at(inner[j], yDeck), at(inner[i], yDeck), at(inner[i], yBul), at(inner[j], yBul), white);
  }
  mb.polygon(
    inner.map((p) => at(p, yDeck)),
    deck,
  );

  // --- 客室：まっすぐな側面に窓の帯、前は斜めに絞る。屋根は少し張り出す
  const cab = (s0: number, s1: number, nose: number, hw: number, y0: number, y1: number, side: FaceInfo, front: FaceInfo, roofF: FaceInfo, roofOv = 0.012) => {
    const sn = s1 + nose;
    const q = {
      bl: P(s0, -hw, y0),
      br: P(s0, hw, y0),
      fl: P(s1, -hw, y0),
      fr: P(s1, hw, y0),
      nl: P(sn, -hw * 0.45, y0),
      nr: P(sn, hw * 0.45, y0),
    };
    const up = (p: THREE.Vector3) => new THREE.Vector3(p.x, y1, p.z);
    const center = P((s0 + sn) / 2, 0, y0);
    /** 2 点の縦の面。外から見て左から右になるように、向きを確かめて並べる */
    const quadUp = (a: THREE.Vector3, b: THREE.Vector3, f: FaceInfo) => {
      const n = new THREE.Vector3().subVectors(b, a).cross(new THREE.Vector3(0, 1, 0));
      const out = a.clone().add(b).multiplyScalar(0.5).sub(center).setY(0);
      if (n.dot(out) < 0) [a, b] = [b, a];
      mb.quad(a, b, up(b), up(a), f);
    };
    quadUp(q.br, q.fr, side);
    quadUp(q.fl, q.bl, side);
    quadUp(q.bl, q.br, side);
    quadUp(q.fr, q.nr, front);
    quadUp(q.nl, q.fl, front);
    quadUp(q.nr, q.nl, front);
    const o = roofOv;
    const r = [P(s0 - o, -hw - o, y1), P(s0 - o, hw + o, y1), P(s1, hw + o, y1), P(sn + o, hw * 0.45 + o, y1), P(sn + o, -hw * 0.45 - o, y1), P(s1, -hw - o, y1)];
    let area = 0;
    for (let i = 0; i < r.length; i++) {
      const a = r[i];
      const b = r[(i + 1) % r.length];
      area += a.x * -b.z - b.x * -a.z;
    }
    if (area < 0) r.reverse();
    const th = 0.008;
    mb.polygon(
      r.map((p) => at(p, y1 + th)),
      roofF,
    );
    mb.polygon(
      r.map((p) => at(p, y1)),
      roofF,
      true,
    );
    wall(r, y1, y1 + th, roofF);
    return y1 + th;
  };
  // 1 階の客室（船首の近くまで。前の面は大きな窓）
  const y1 = cab(-L / 2 + 0.12, L / 2 - 0.45, 0.15, B / 2 - 0.03, yDeck, yDeck + 0.16, win, wheel, white);
  // 2 階の客室（前の面は操舵室の窓）
  const y2 = cab(-0.5, 0.15, 0.1, B / 2 - 0.08, y1, y1 + 0.115, win, wheel, white, 0.01);
  // 後ろの高い箱と、マストと赤い灯
  const y3 = cab(-0.45, -0.15, 0.02, B / 2 - 0.13, y2, y2 + 0.085, white, white, white, 0.008);
  const mast = P(-0.3, 0, 0);
  mb.cylinder([mast.x, mast.z], [y3, y3 + 0.16], 0.008, 0.006, white, 6);
  mb.box([mast.x, mast.z], [0.024, 0.024], [y3 + 0.16, y3 + 0.186], face(fc.light), face(fc.light));
  // 船首の小さな旗竿
  const bowPole = P(L / 2 - 0.1, 0, 0);
  mb.cylinder([bowPole.x, bowPole.z], [yBul, yBul + 0.07], 0.004, 0.003, white, 5);
  mb.maxCell = prevCell;

  const outline = [P(-0.3, 0, y3 + 0.19), P(-L / 2, B / 2, y1), P(-L / 2, -B / 2, y1), P(L / 2, 0, yBul)];
  return { center: F.c, dir: [dir.x, dir.z], length: L, width: B, outline };
}
