import * as THREE from 'three';
import type { SceneConfig } from '../config';
import { onLine, type P2 } from './geometry2d';
import type { Streets } from './streets';

/**
 * 路面の模様の地図（上から見たテクスチャ。台座より少し広い正方形 size をワールドの x, z に重ねる）：
 *  R = 白線（車道の線・横断歩道）
 *  G = 縁石の石の帯、マンホールのふた（0.5）
 *  B = 石畳の目地の向き（0〜1 が 0°〜180°）
 *  A = 1
 * テクスチャの u = (x + size/2) / size、v = (z + size/2) / size（上下を反転しない）
 */
export interface SurfaceMap {
  texture: THREE.Texture;
  size: number;
}

export function createSurfaceMap(config: SceneConfig, streets: Streets, resolution = 2048): SurfaceMap {
  const t = config.town;
  const size = config.pedestal.size + 0.4;
  const canvas = document.createElement('canvas');
  canvas.width = resolution;
  canvas.height = resolution;
  const ctx = canvas.getContext('2d', { willReadFrequently: false })!;
  const k = resolution / size;
  const X = (x: number) => (x + size / 2) * k;
  const Z = (z: number) => (z + size / 2) * k;
  const angleByte = (degV: number) => {
    let a = degV % 180;
    if (a < 0) a += 180;
    return Math.round((a / 180) * 255);
  };

  // --- B：石畳の向き。いちばん近い道の向きにそろえる（左の通り・右の通り・路地・裏路地）
  {
    const dirs: { deg: number; dist: (x: number, z: number) => number }[] = [];
    const lineDist = (p: readonly [number, number], deg: number) => {
      const a = (deg * Math.PI) / 180;
      const ux = Math.cos(a);
      const uz = Math.sin(a);
      return (x: number, z: number) => Math.abs((x - p[0]) * uz - (z - p[1]) * ux);
    };
    dirs.push({ deg: t.curbLeft.dir, dist: lineDist(t.curbLeft.point, t.curbLeft.dir) });
    dirs.push({ deg: t.curbRight.dir, dist: lineDist(t.curbRight.point, t.curbRight.dir) });
    // 路地は始まりから突き当たりまで（その先は遠いとみなす）
    {
      const a = (t.alley.dir * Math.PI) / 180;
      const ux = Math.cos(a);
      const uz = Math.sin(a);
      const o = t.alley.origin;
      dirs.push({
        deg: t.alley.dir,
        dist: (x, z) => {
          const s = (x - o[0]) * ux + (z - o[1]) * uz;
          if (s < -0.2 || s > t.alley.length + 0.2) return 99;
          return Math.abs((x - o[0]) * uz - (z - o[1]) * ux) * 0.8;
        },
      });
    }
    for (const lane of t.backLanes) {
      const base = lane.frame === 'L' ? t.curbLeft : t.curbRight;
      const a = (base.dir * Math.PI) / 180;
      const u: [number, number] = [Math.cos(a), Math.sin(a)];
      const n: [number, number] = [u[1], -u[0]];
      const p0: [number, number] = [base.point[0] + n[0] * lane.d, base.point[1] + n[1] * lane.d];
      dirs.push({
        deg: base.dir,
        dist: (x, z) => {
          const s = (x - p0[0]) * u[0] + (z - p0[1]) * u[1];
          if (s < lane.s[0] - 0.2 || s > lane.s[1] + 0.2) return 99;
          return Math.abs((x - p0[0]) * u[1] - (z - p0[1]) * u[0]) * 0.7;
        },
      });
    }
    const img = ctx.createImageData(resolution, resolution);
    const step = 4;
    for (let j = 0; j < resolution; j += step) {
      const z = (j + step / 2) / k - size / 2;
      for (let i = 0; i < resolution; i += step) {
        const x = (i + step / 2) / k - size / 2;
        let best = 0;
        let bd = Infinity;
        for (let q = 0; q < dirs.length; q++) {
          const dd = dirs[q].dist(x, z);
          if (dd < bd) {
            bd = dd;
            best = q;
          }
        }
        const v = angleByte(dirs[best].deg);
        for (let jj = j; jj < Math.min(resolution, j + step); jj++) {
          for (let ii = i; ii < Math.min(resolution, i + step); ii++) {
            const o = (ii + jj * resolution) * 4;
            img.data[o + 2] = v;
            img.data[o + 3] = 255;
          }
        }
      }
    }
    ctx.putImageData(img, 0, 0);
  }

  // --- R・G は別のキャンバスに描いて合成する（B を消さないように）
  const paint = document.createElement('canvas');
  paint.width = resolution;
  paint.height = resolution;
  const pc = paint.getContext('2d')!;
  pc.fillStyle = '#000';
  pc.fillRect(0, 0, resolution, resolution);
  pc.strokeStyle = '#fff';
  pc.fillStyle = '#fff';
  const lanes = t.lanes;
  const W = streets.width;
  const strokeLine = (a: P2, b: P2, width: number, dash: [number, number] | null) => {
    pc.lineWidth = width * k;
    pc.lineCap = 'butt';
    pc.setLineDash(dash ? [dash[0] * k, dash[1] * k] : []);
    pc.beginPath();
    pc.moveTo(X(a[0]), Z(a[1]));
    pc.lineTo(X(b[0]), Z(b[1]));
    pc.stroke();
    pc.setLineDash([]);
  };
  // 通りに沿った線：d は縁石から車道の側への距離（Line2 の n は奥向きなので -d）
  const Lc = streets.left;
  const Rc = streets.right;
  const onL = (s: number, d: number) => onLine(Lc, s, -d);
  const onR = (s: number, d: number) => onLine(Rc, s, -d);
  // 交差点：左の通りの線は、右の通りの車道に入る手前（dRight が -0.35 になる所）で止める。右の通りは横断歩道の手前で止める
  const endOnL = (d: number) => {
    // s を増やしながら、右の通りの車道に近づく所を探す
    let s = -12;
    while (s < 12 && streets.dRight(onL(s, d)) < -0.35) s += 0.01;
    return s;
  };
  const cw = t.crosswalk;
  const startOnR = cw.s + cw.width / 2 + 0.25;
  // 中央の破線（車道の幅のちょうど真ん中）
  strokeLine(onL(-12, W / 2), onL(endOnL(W / 2), W / 2), lanes.width, lanes.dash);
  strokeLine(onR(startOnR, W / 2), onR(14, W / 2), lanes.width, lanes.dash);
  // 外側線（両側とも縁石から edge）
  strokeLine(onL(-12, lanes.edge), onL(endOnL(lanes.edge), lanes.edge), lanes.width * 0.9, null);
  strokeLine(onL(-12, W - lanes.edge), onL(12, W - lanes.edge), lanes.width * 0.9, null);
  strokeLine(onR(startOnR - 0.1, lanes.edge), onR(14, lanes.edge), lanes.width * 0.9, null);
  strokeLine(onR(-12, W - lanes.edge), onR(14, W - lanes.edge), lanes.width * 0.9, null);
  // 停止線：左の通りは交差点へ向かう車線（縁石の側）、右の通りは横断歩道の手前の、交差点へ向かう車線（向かいの側）
  {
    const sL = endOnL(W / 2) - 0.12;
    strokeLine(onL(sL, lanes.edge), onL(sL, W / 2), lanes.stop, null);
    const sR = startOnR - 0.05;
    strokeLine(onR(sR, W / 2), onR(sR, W - lanes.edge), lanes.stop, null);
  }
  // 横断歩道：右の通りを渡る。縞は通りの向きに長い
  {
    const n = Math.floor((W - 0.1) / (cw.stripe * 2));
    const pad = (W - n * cw.stripe * 2) / 2;
    for (let i = 0; i < n; i++) {
      const d0 = pad + i * cw.stripe * 2 + cw.stripe / 2;
      const pts: P2[] = [onR(cw.s - cw.width / 2, d0), onR(cw.s + cw.width / 2, d0), onR(cw.s + cw.width / 2, d0 + cw.stripe), onR(cw.s - cw.width / 2, d0 + cw.stripe)];
      pc.beginPath();
      pts.forEach(([x, z], j) => (j ? pc.lineTo(X(x), Z(z)) : pc.moveTo(X(x), Z(z))));
      pc.closePath();
      pc.fill();
    }
  }
  // 白線は車道の上だけ
  pc.globalCompositeOperation = 'destination-in';
  pc.beginPath();
  streets.road.forEach(([x, z], i) => (i ? pc.lineTo(X(x), Z(z)) : pc.moveTo(X(x), Z(z))));
  pc.closePath();
  pc.fill();
  pc.globalCompositeOperation = 'source-over';

  // G：縁石の石の帯（街区と細い歩道の縁石の線に沿って、歩道の側）
  const stone = document.createElement('canvas');
  stone.width = resolution;
  stone.height = resolution;
  const sc = stone.getContext('2d')!;
  sc.fillStyle = '#000';
  sc.fillRect(0, 0, resolution, resolution);
  sc.strokeStyle = '#fff';
  sc.lineJoin = 'round';
  sc.lineWidth = t.curbStone.width * 2 * k;
  for (const pts of [streets.curbInside, streets.nearLeft, streets.nearRight]) {
    if (pts.length < 2) continue;
    sc.beginPath();
    pts.forEach(([x, z], i) => (i ? sc.lineTo(X(x), Z(z)) : sc.moveTo(X(x), Z(z))));
    sc.stroke();
  }
  // マンホールのふた（右の通り）
  sc.fillStyle = 'rgb(128,128,128)';
  for (const [mx, mz, mr] of [[4.78, 3.62, 0.13], [-3.3, 1.55, 0.12]] as [number, number, number][]) {
    sc.beginPath();
    sc.arc(X(mx), Z(mz), mr * k, 0, Math.PI * 2);
    sc.fill();
  }

  // 合成：R = paint、G = stone、B = 向き
  const out = ctx.getImageData(0, 0, resolution, resolution);
  const pr = pc.getImageData(0, 0, resolution, resolution).data;
  const sr = sc.getImageData(0, 0, resolution, resolution).data;
  const d = out.data;
  for (let i = 0; i < d.length; i += 4) {
    d[i] = pr[i];
    d[i + 1] = sr[i];
    d[i + 3] = 255;
  }
  ctx.putImageData(out, 0, 0);
  const texture = new THREE.CanvasTexture(canvas);
  texture.flipY = false;
  texture.colorSpace = THREE.NoColorSpace;
  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.anisotropy = 4;
  texture.needsUpdate = true;
  return { texture, size };
}
