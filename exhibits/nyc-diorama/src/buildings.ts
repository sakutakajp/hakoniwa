import * as THREE from 'three';
import type { Layout, Part } from './layout';
import type { SceneConfig } from './config';
import type { FaceInfo, MeshBuilder } from './meshBuilder';
import type { FacadeStyle } from './materials';

/** 外壁の様式の一覧（config.facades の順）と、名前から番号を引く関数 */
export function facadeStyles(cfg: SceneConfig) {
  const names = Object.keys(cfg.facades);
  const styles: FacadeStyle[] = names.map((k) => cfg.facades[k]);
  const index = (name: string) => {
    const i = names.indexOf(name);
    if (i < 0) throw new Error(`unknown facade style: ${name}`);
    return i;
  };
  return { styles, index };
}

/**
 * 建物（layout.json の buildings）を形に足す。
 * 外壁の模様は頂点の aFacade（面の上の位置）と aStyle（様式の番号）からシェーダーで描く（materials.ts）。
 * 平らな屋上には低い手すり壁（パラペット）を付け、屋上は明るい灰色にする。
 */
export function addBuildings(mb: MeshBuilder, layout: Layout, cfg: SceneConfig, index: (name: string) => number) {
  const color = (name: string) => new THREE.Color(cfg.wallColors[name] ?? '#ffffff');
  const face = (style: string, c?: THREE.Color): FaceInfo => ({ style: index(style), color: c ?? color(style) });
  const roof = face('roof');
  const prevCell = mb.maxCell;
  mb.maxCell = 0.09;

  const white = new THREE.Color('#ffffff');
  const addPart = (p: Part) => {
    switch (p.type) {
      case 'box': {
        const f = face(p.style);
        const plain = p.style === 'roofbox' || p.style === 'copper' || p.style === 'metal';
        const rot = THREE.MathUtils.degToRad(p.rot ?? 0);
        // 縦の角の面取り：外壁の色を少し明るくした細い面（光を受けて角に明るい線ができる）
        const bevel = Math.min(plain ? cfg.buildings.bevel * 0.6 : cfg.buildings.bevel, Math.min(p.size[0], p.size[1]) * 0.08);
        const edgeF: FaceInfo = { style: index('roofbox'), color: f.color.clone().lerp(white, cfg.buildings.bevelLighten) };
        const st = cfg.facades[p.style];
        const top = st?.roofColor ? { style: index('roofbox'), color: new THREE.Color(st.roofColor) } : roof;
        const outline = mb.bevelBox(p.c, p.size, p.y, bevel, f, edgeF, plain ? f : top, { rot });
        // 平らな屋上の低い手すり壁（外形に沿う。上面は明るく）
        if (!plain && p.parapet !== false && p.y[1] - p.y[0] > 0.25) {
          const wallF: FaceInfo = { style: index('roofbox'), color: f.color.clone().multiplyScalar(1.02) };
          const topF: FaceInfo = { style: index('roofbox'), color: f.color.clone().lerp(white, st?.parapet ?? cfg.buildings.parapetLighten) };
          mb.ringWall(outline, 0.016, 0.024, wallF, topF);
        }
        break;
      }
      case 'taper': {
        const f = face(p.style);
        mb.box(p.c, p.size, p.y, f, f, { topSize: p.top });
        break;
      }
      case 'antiprism': {
        const f = face(p.style);
        const [cx, cz] = p.c;
        const s = p.size / 2;
        const [y0, y1] = p.y;
        const B = [
          new THREE.Vector3(cx - s, y0, cz + s),
          new THREE.Vector3(cx + s, y0, cz + s),
          new THREE.Vector3(cx + s, y0, cz - s),
          new THREE.Vector3(cx - s, y0, cz - s),
        ];
        // 上端：45° 回した正方形（頂点が下端の辺の中点の真上）
        const st = s * (p.topScale ?? 1);
        const Tt = [
          new THREE.Vector3(cx, y1, cz + st),
          new THREE.Vector3(cx + st, y1, cz),
          new THREE.Vector3(cx, y1, cz - st),
          new THREE.Vector3(cx - st, y1, cz),
        ];
        for (let i = 0; i < 4; i++) {
          const j = (i + 1) % 4;
          // 下端の辺を底辺にした、上へすぼまる三角形
          mb.triangle(B[i], B[j], Tt[i], f);
          // 上端の辺を上辺にした、下へすぼまる三角形（頂点は下端の角）
          const apex = B[j];
          const l = apex.clone().lerp(Tt[i], 0.002);
          const r = apex.clone().lerp(Tt[j], 0.002);
          mb.quad(l, r, Tt[j], Tt[i], f);
        }
        // 上面
        mb.flat([Tt[0], Tt[1], Tt[2], Tt[3]], face('roofbox'));
        // 斜めの稜線の白い帯（ガラスの面の境目）
        const edgeF: FaceInfo = { style: index('metal'), color: new THREE.Color('#eef4fa') };
        const axis = new THREE.Vector3(cx, 0, cz);
        const strip = (P: THREE.Vector3, Q: THREE.Vector3, w: number) => {
          const mid = P.clone().add(Q).multiplyScalar(0.5);
          const n = mid.clone().sub(axis).setY(0).normalize();
          const dir = Q.clone().sub(P);
          // 稜線に直交する外向き（面のあいだの向き）
          n.addScaledVector(dir.clone().normalize(), -n.dot(dir.clone().normalize())).normalize();
          const side = dir.clone().cross(n).normalize().multiplyScalar(w / 2);
          const off = n.clone().multiplyScalar(0.004);
          mb.quad(P.clone().sub(side).add(off), P.clone().add(side).add(off), Q.clone().add(side).add(off), Q.clone().sub(side).add(off), edgeF);
        };
        for (let i = 0; i < 4; i++) {
          strip(B[i], Tt[i], 0.022);
          strip(B[(i + 1) % 4], Tt[i], 0.022);
        }
        break;
      }
      case 'pyramid': {
        const f = face(p.style);
        const [cx, cz] = p.c;
        const [sx, sz] = p.size;
        const [y0, y1] = p.y;
        const r = (p.ridge ?? 0) / 2;
        const b = [
          new THREE.Vector3(cx - sx / 2, y0, cz + sz / 2),
          new THREE.Vector3(cx + sx / 2, y0, cz + sz / 2),
          new THREE.Vector3(cx + sx / 2, y0, cz - sz / 2),
          new THREE.Vector3(cx - sx / 2, y0, cz - sz / 2),
        ];
        const ra = new THREE.Vector3(cx - r, y1, cz);
        const rb = new THREE.Vector3(cx + r, y1, cz);
        // 手前と奥：台形（棟があるとき）、左右：三角形
        if (r > 0) {
          mb.quad(b[0], b[1], rb, ra, f);
          mb.quad(b[2], b[3], ra, rb, f);
        } else {
          mb.triangle(b[0], b[1], ra, f);
          mb.triangle(b[2], b[3], ra, f);
        }
        mb.triangle(b[1], b[2], rb, f);
        mb.triangle(b[3], b[0], ra, f);
        // 軒の下の帯
        break;
      }
      case 'spire': {
        const f = face('metal');
        const [y0, y1] = p.y;
        const h = y1 - y0;
        // 根元の太い段と、上へ細くなる針（stripes があれば赤と白の帯のアンテナ）
        mb.cylinder(p.c, [y0, y0 + h * 0.18], p.r * 1.4, p.r, f, 10);
        if (p.stripes && p.stripes > 1) {
          const red: FaceInfo = { style: index('metal'), color: new THREE.Color('#d8443a') };
          const n = p.stripes;
          const ya = y0 + h * 0.18;
          for (let i = 0; i < n; i++) {
            const t0 = i / n;
            const t1 = (i + 1) / n;
            const r0 = p.r * (0.7 - 0.55 * t0);
            const r1 = p.r * (0.7 - 0.55 * t1);
            mb.cylinder(p.c, [ya + (y1 - ya) * t0, ya + (y1 - ya) * t1], r0, r1, i % 2 === 0 ? f : red, 8, i === n - 1);
          }
        } else {
          mb.cylinder(p.c, [y0 + h * 0.18, y1], p.r * 0.7, p.r * 0.15, f, 8);
        }
        break;
      }
      case 'ring': {
        const f = face('metal');
        mb.cylinder(p.c, p.y, p.r, p.r, f, 24);
        break;
      }
    }
  };
  for (const b of layout.buildings) for (const p of b.parts) addPart(p);

  // 屋上の木の給水タンク（NYC の 6 階建てより高い建物の屋上の名物）：鉄の脚と台、縦の板の樽、円すいの屋根
  const legF: FaceInfo = { style: index('roofbox'), color: new THREE.Color('#5c6068') };
  const roofF: FaceInfo = { style: index('roofbox'), color: new THREE.Color('#6e5547') };
  for (const t of layout.waterTanks ?? []) {
    const s = t.s ?? 1;
    const [cx, cz] = t.c;
    const r = 0.074 * s;
    const legH = 0.055 * s;
    const h = 0.125 * s;
    const coneH = 0.06 * s;
    const y0 = t.y + 0.024;
    for (const [dx, dz] of [
      [1, 1],
      [1, -1],
      [-1, 1],
      [-1, -1],
    ]) {
      mb.box([cx + dx * r * 0.62, cz + dz * r * 0.62], [0.012 * s, 0.012 * s], [t.y, y0 + legH], legF, legF);
    }
    mb.box([cx, cz], [r * 1.8, r * 1.8], [y0 + legH - 0.008 * s, y0 + legH], legF, legF, { bottom: legF });
    mb.cylinder([cx, cz], [y0 + legH, y0 + legH + h], r, r * 0.96, face('tank'), 14, false);
    mb.cylinder([cx, cz], [y0 + legH + h, y0 + legH + h + coneH], r * 1.05, 0.0001, roofF, 14, false);
  }
  mb.maxCell = prevCell;
}

/** 画角合わせ用：建物の上端の点（各部品の上面の四隅と尖塔の先） */
export function buildingOutlinePoints(layout: Layout): THREE.Vector3[] {
  const pts: THREE.Vector3[] = [];
  for (const b of layout.buildings) {
    for (const p of b.parts) {
      if (p.type === 'spire') {
        pts.push(new THREE.Vector3(p.c[0], p.y[1], p.c[1]));
      } else if ('size' in p) {
        const [sx, sz] = typeof p.size === 'number' ? [p.size, p.size] : p.size;
        for (const [dx, dz] of [
          [-1, -1],
          [1, -1],
          [1, 1],
          [-1, 1],
        ]) {
          pts.push(new THREE.Vector3(p.c[0] + (dx * sx) / 2, p.y[1], p.c[1] + (dz * sz) / 2));
        }
      }
    }
  }
  return pts;
}
