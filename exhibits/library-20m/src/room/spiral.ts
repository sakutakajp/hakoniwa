import { captureFurniture } from '../../../shared/asset-capture';
import * as THREE from 'three';
import { V, type BuildContext } from './context';
import { wallGeometry } from './structure';
import { baluster } from './gallery';

/**
 * 回廊へ上るらせん階段（アムステルダムのカイパース図書館やカオールの図書館の、隅のらせん階段に倣う）。
 * 中心の柱のまわりに、扇形の段板が柱から片持ちで出る（段ごとの筒が柱に重なって節のように見える）。
 * 段の外の端に真鍮の手すり子、その上にらせんの木の手すり。いちばん上の段は回廊の高さの踊り場で、回廊の床に続く。
 * 角度 φ は上から見て +z（手前）から +x（右）へ測る
 */
export function spiralGeometry(ctx: BuildContext) {
  const S = ctx.cfg.room.spiral;
  const g = wallGeometry(ctx);
  const [cx, cz] = S.center;
  const R = S.radius;
  const deg = THREE.MathUtils.degToRad;
  const rise = (g.gy - g.floorY) / S.risers;
  const nT = S.risers - 1;
  const step = deg(S.step);
  const end = deg(S.endAngle);
  const start = end - nT * step;
  const landingEnd = end + deg(S.landing);
  const rh = R - 0.05;
  const pt = (r: number, phi: number): [number, number] => [cx + r * Math.sin(phi), cz + r * Math.cos(phi)];
  return {
    cx,
    cz,
    R,
    rise,
    nT,
    step,
    start,
    end,
    landingEnd,
    rh,
    pt,
    /** 手すりのらせんの高さ（段の鼻を結ぶ線から 0.86 上） */
    railY: (phi: number) => g.floorY + rise * (1 + (phi - start) / step) + 0.5,
    /** 回廊の手すりが切れる所（踊り場の左の縁の外の端と、右の縁の外の端） */
    gapLeft: pt(rh, landingEnd),
    gapRight: pt(rh, end),
    landingInner: pt(0.14, landingEnd),
  };
}

function original_buildSpiralStair(ctx: BuildContext) {
  const { cfg, st, mb } = ctx;
  const c = cfg.colors;
  const g = wallGeometry(ctx);
  const sp = spiralGeometry(ctx);
  const { cx, cz, R, rise, nT, step, start, end, landingEnd, rh, pt } = sp;
  const tread = st.face('wood', c.stairWood);
  const treadEdge = st.face('wood', c.woodLight);
  const hubF = st.face('wood', c.wood);
  const landingEdge = st.face('wood', c.woodDark);
  const dark = st.face('wood', c.woodDark);
  const brass = st.face('brass', c.brass);
  const rc = 0.075;
  const th = 0.0225;
  const nose = THREE.MathUtils.degToRad(3);
  const P = (r: number, phi: number, y: number) => {
    const [x, z] = pt(r, phi);
    return V(x, y, z);
  };
  const radial = (phi: number) => V(Math.sin(phi), 0, Math.cos(phi));
  const tangent = (phi: number) => V(Math.cos(phi), 0, -Math.sin(phi));

  /** 扇形の段板（φ0〜φ1、上面の高さ y）。木目は柱から外へ */
  const wedge = (phi0: number, phi1: number, y: number, r0: number, r1: number, thick: number) => {
    mb.group(() => {
      const n = Math.max(2, Math.ceil((phi1 - phi0) / THREE.MathUtils.degToRad(11)));
      for (let i = 0; i < n; i++) {
        const a = phi0 + ((phi1 - phi0) * i) / n;
        const b = phi0 + ((phi1 - phi0) * (i + 1)) / n;
        mb.quadAuto(P(r0, a, y), P(r1, a, y), P(r1, b, y), P(r0, b, y), V(0, 1, 0), tread, { cell: 0.2 });
        mb.quadAuto(P(r0, a, y - thick), P(r1, a, y - thick), P(r1, b, y - thick), P(r0, b, y - thick), V(0, -1, 0), tread, { cell: 0.2 });
        const m = (a + b) / 2;
        mb.quadAuto(P(r1, a, y - thick), P(r1, b, y - thick), P(r1, b, y), P(r1, a, y), radial(m), treadEdge, { cell: 1e3 });
      }
      // 段の鼻（前の縁）と後ろの縁
      mb.quadAuto(P(r0, phi0, y - thick), P(r1, phi0, y - thick), P(r1, phi0, y), P(r0, phi0, y), tangent(phi0).negate(), treadEdge, { cell: 0.2 });
      mb.quadAuto(P(r0, phi1, y - thick), P(r1, phi1, y - thick), P(r1, phi1, y), P(r0, phi1, y), tangent(phi1), treadEdge, { cell: 0.2 });
    });
  };

  // 段板と、柱に重なる筒（節）
  for (let k = 1; k <= nT; k++) {
    const a = start + (k - 1) * step;
    const b = a + step;
    const y = g.floorY + k * rise;
    wedge(a - nose, b, y, rc * 0.9, R, th);
    mb.lathe([cx, cz], [
      [0.105, y - rise + 0.004],
      [0.112, y - rise + 0.02],
      [0.1, y - rise + 0.04],
      [0.1, y - 0.03],
      [0.115, y - 0.012],
      [0.115, y],
    ], hubF, 14, { capBottom: false, capTop: true });
  }

  // 踊り場（回廊の高さ）：右の縁は最後の段に続き、奥は回廊の床の縁まで（扇形と回廊の縁のすき間を埋める）
  {
    const y = g.gy;
    const e = g.edge;
    const a = end - nose;
    const b = landingEnd;
    const pts: THREE.Vector3[] = [];
    const arcN = 10;
    for (let i = 0; i <= arcN; i++) pts.push(P(rc * 0.9, b - ((b - a) * i) / arcN, y));
    const pa = P(R, a, y);
    const pb = P(R, b, y);
    pts.push(pa, V(pa.x, y, e), V(pb.x, y, e), pb);
    // 上から見て反時計回りにそろえる
    const area = pts.reduce((s, p, i) => {
      const q = pts[(i + 1) % pts.length];
      return s + (p.x * -q.z - q.x * -p.z);
    }, 0);
    const poly = area > 0 ? pts : [...pts].reverse();
    const thick = cfg.room.gallery.deck;
    mb.group(() => {
      mb.polygon(poly, tread);
      mb.polygon(poly.map((p) => V(p.x, y - thick, p.z)), tread, true);
      // 縁の面（回廊の床に接する奥の辺と、柱のまわりは省く）。上から見て反時計回りの多角形の辺 p→q の外向きは (−dz, dx)
      for (let i = 0; i < poly.length; i++) {
        const p = poly[i];
        const q = poly[(i + 1) % poly.length];
        if (Math.abs(p.z - e) < 1e-4 && Math.abs(q.z - e) < 1e-4) continue;
        if (Math.hypot(p.x - cx, p.z - cz) < rc + 0.01 && Math.hypot(q.x - cx, q.z - cz) < rc + 0.01) continue;
        const out = V(-(q.z - p.z), 0, q.x - p.x).normalize();
        mb.quadAuto(V(p.x, y - thick, p.z), V(q.x, y - thick, q.z), V(q.x, y, q.z), V(p.x, y, p.z), out, landingEdge, { cell: 0.2 });
      }
    });
    mb.lathe([cx, cz], [
      [0.105, y - rise + 0.004],
      [0.112, y - rise + 0.02],
      [0.1, y - rise + 0.04],
      [0.1, y - 0.03],
      [0.115, y - 0.012],
      [0.115, y],
    ], hubF, 14, { capBottom: false, capTop: false });
  }

  // 中心の柱：台座と、踊り場の上へ伸びる柱身、頭の真鍮の玉
  {
    const y0 = g.floorY;
    const yTop = g.gy + 0.98;
    mb.lathe([cx, cz], [
      [0.15, y0],
      [0.15, y0 + 0.05],
      [0.125, y0 + 0.07],
      [0.125, y0 + 0.1],
      [0.095, y0 + 0.13],
      [0.075, y0 + 0.16],
      [0.075, yTop - 0.12],
      [0.095, yTop - 0.09],
      [0.085, yTop - 0.06],
      [0.1, yTop - 0.03],
      [0.1, yTop],
    ], hubF, 14, { capBottom: false });
    mb.lathe([cx, cz], [[0.0, yTop], [0.045, yTop + 0.01], [0.03, yTop + 0.04]], brass, 12, { capBottom: false });
    mb.sphere(V(cx, yTop + 0.1, cz), 0.065, brass, 14, 10);
  }

  // 手すり子（段ごとに 2 本、段の外の端）
  for (let k = 1; k <= nT; k++) {
    const a = start + (k - 1) * step;
    const y = g.floorY + k * rise;
    for (const f of [0.28, 0.78]) {
      const phi = a + step * f;
      baluster(mb, brass, pt(rh, phi), y, sp.railY(phi) - 0.02, 0.475);
    }
  }
  // らせんの手すり（下の親柱から上の親柱まで、5° ごとの短い角材をつなぐ）
  {
    const a0 = start - THREE.MathUtils.degToRad(4);
    const a1 = end;
    const n = Math.ceil((a1 - a0) / THREE.MathUtils.degToRad(5));
    for (let i = 0; i < n; i++) {
      const p0 = a0 + ((a1 - a0) * i) / n;
      const p1 = a0 + ((a1 - a0) * (i + 1)) / n;
      const q0 = P(rh, p0, sp.railY(p0));
      const q1 = P(rh, p1, sp.railY(p1));
      // つなぎ目のすき間を隠すため、少しだけ長くする
      const d = q1.clone().sub(q0).multiplyScalar(0.04);
      mb.beam(q0.clone().sub(d), q1.clone().add(d), 0.034, 0.025, dark, { cell: 1e3 });
    }
  }
  // 親柱：下（床の上、最初の段の手前）と上（踊り場の右の縁の外の端）
  {
    const turned = (p: [number, number], y0: number, y1: number) => {
      mb.lathe(p, [
        [0.06, y0],
        [0.06, y0 + 0.07],
        [0.045, y0 + 0.1],
        [0.038, y0 + 0.16],
        [0.05, y0 + (y1 - y0) * 0.35],
        [0.034, y0 + (y1 - y0) * 0.55],
        [0.034, y1 - 0.12],
        [0.05, y1 - 0.08],
        [0.05, y1],
      ], st.face('wood', c.wood), 12, { capBottom: false });
      mb.sphere(V(p[0], y1 + 0.05, p[1]), 0.05, brass, 12, 8);
    };
    const pb = start - THREE.MathUtils.degToRad(4);
    turned(pt(rh, pb), g.floorY, sp.railY(pb) + 0.03);
    turned(pt(rh, end), g.gy, sp.railY(end) + 0.03);
  }
}

export function buildSpiralStair(...args:Parameters<typeof original_buildSpiralStair>):ReturnType<typeof original_buildSpiralStair> { return captureFurniture("buildSpiralStair",args[0],()=>original_buildSpiralStair(...args)); }
