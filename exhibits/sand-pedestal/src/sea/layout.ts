import * as THREE from 'three';
import type { SceneConfig } from '../config';
import { roundedSquareInside } from '../island/shape';
import { Noise } from '../noise';
import { sampleGrid } from './distance';

/**
 * 台座と海の高さ関係、砂浜と海底の形、深場の範囲。
 *  - yFloor：床（台座の底）
 *  - yBaseTop：土台の上面 ＝ 水の塊の底（yDeep）
 *  - ySeabed：平らな海底（土台の上の薄い砂の層の上面）
 *  - yWater：水面
 * 海底は平らな砂地で、入り江では砂浜から沖へなだらかに深くなる。浅い所（shoals）では少し浅い。
 * 同じ形を、海底のメッシュ・岩の接地・影の焼き込み（高さのテクスチャ）で共通に使う。
 */
export interface SeaLayout {
  enabled: boolean;
  yFloor: number;
  yBaseTop: number;
  /** 水の塊の底（＝土台の上面） */
  yDeep: number;
  ySeabed: number;
  yWater: number;
  /** 水の塊の外周（角丸正方形の半分の幅と角の半径） */
  half: number;
  cornerRadius: number;
  /** 土台（水の塊より少し内側） */
  baseHalf: number;
  baseCornerRadius: number;
  /** 海底（砂浜を含む）の高さ（ワールド座標） */
  seabedY: (x: number, z: number) => number;
  /** 砂浜の乾いた所か（水面より上の砂） */
  beachAt: (x: number, z: number) => number;
  /** 深場らしさ 0〜1（色と見通しだけを変える） */
  deepAt: (x: number, z: number) => number;
  /** 海底の高さを焼き込み用のテクスチャにする（中心 0、一辺 size の範囲。u: +x、v: -z） */
  heightTexture: (size: number, resolution: number) => THREE.DataTexture;
  /** 深場らしさをテクスチャにする（同じ範囲） */
  deepTexture: (size: number, resolution: number) => THREE.DataTexture;
}

const smoothstep = (a: number, b: number, v: number) => {
  const t = Math.min(1, Math.max(0, (v - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/** 閉じた多角形までの符号付き距離（内側が正） */
function polygonInside(px: number, pz: number, pts: [number, number][]): number {
  const n = pts.length;
  let best = Infinity;
  let s = 1;
  for (let i = 0, j = n - 1; i < n; j = i, i++) {
    const [xi, zi] = pts[i];
    const [xj, zj] = pts[j];
    const ex = xj - xi;
    const ez = zj - zi;
    const wx = px - xi;
    const wz = pz - zi;
    const t = Math.min(1, Math.max(0, (wx * ex + wz * ez) / (ex * ex + ez * ez)));
    const bx = wx - ex * t;
    const bz = wz - ez * t;
    best = Math.min(best, bx * bx + bz * bz);
    const c1 = pz >= zi;
    const c2 = pz < zj;
    const c3 = ex * wz > ez * wx;
    if ((c1 && c2 && c3) || (!c1 && !c2 && !c3)) s = -s;
  }
  return -s * Math.sqrt(best);
}

/** 最小ヒープ（キーの小さい順に取り出す。ダイクストラ法の距離の計算に使う） */
class MinHeap {
  private keys: Float64Array;
  private vals: Int32Array;
  size = 0;
  constructor(capacity: number) {
    this.keys = new Float64Array(Math.max(16, capacity));
    this.vals = new Int32Array(Math.max(16, capacity));
  }
  push(v: number, key: number) {
    if (this.size === this.keys.length) {
      const k2 = new Float64Array(this.size * 2);
      k2.set(this.keys);
      const v2 = new Int32Array(this.size * 2);
      v2.set(this.vals);
      this.keys = k2;
      this.vals = v2;
    }
    let i = this.size++;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (this.keys[p] <= key) break;
      this.keys[i] = this.keys[p];
      this.vals[i] = this.vals[p];
      i = p;
    }
    this.keys[i] = key;
    this.vals[i] = v;
  }
  topKey() {
    return this.keys[0];
  }
  pop() {
    const top = this.vals[0];
    const n = --this.size;
    if (n > 0) {
      const key = this.keys[n];
      const v = this.vals[n];
      let i = 0;
      for (;;) {
        let c = 2 * i + 1;
        if (c >= n) break;
        if (c + 1 < n && this.keys[c + 1] < this.keys[c]) c++;
        if (this.keys[c] >= key) break;
        this.keys[i] = this.keys[c];
        this.vals[i] = this.vals[c];
        i = c;
      }
      this.keys[i] = key;
      this.vals[i] = v;
    }
    return top;
  }
}

/** 2D の格子をガウスぼかしする（縦横に分けて、標準偏差 sigma 画素。端は端の値を伸ばす） */
function gaussianBlur(field: Float32Array, nx: number, nz: number, sigma: number) {
  if (sigma < 0.5) return;
  const r = Math.ceil(sigma * 2.5);
  const w = new Float32Array(2 * r + 1);
  let sum = 0;
  for (let i = -r; i <= r; i++) {
    w[i + r] = Math.exp(-(i * i) / (2 * sigma * sigma));
    sum += w[i + r];
  }
  for (let i = 0; i < w.length; i++) w[i] /= sum;
  const tmp = new Float32Array(field.length);
  for (let z = 0; z < nz; z++) {
    const row = z * nx;
    for (let x = 0; x < nx; x++) {
      let s = 0;
      for (let i = -r; i <= r; i++) {
        const xx = x + i < 0 ? 0 : x + i >= nx ? nx - 1 : x + i;
        s += field[row + xx] * w[i + r];
      }
      tmp[row + x] = s;
    }
  }
  for (let z = 0; z < nz; z++) {
    for (let x = 0; x < nx; x++) {
      let s = 0;
      for (let i = -r; i <= r; i++) {
        const zz = z + i < 0 ? 0 : z + i >= nz ? nz - 1 : z + i;
        s += tmp[zz * nx + x] * w[i + r];
      }
      field[z * nx + x] = s;
    }
  }
}

/** 台座と水の高さ（形を作る前に決まる値） */
export function seaLevels(config: SceneConfig) {
  const ped = config.pedestal;
  const W = ped.size;
  const yBaseTop = ped.thickness;
  const yWater = config.sea.enabled ? yBaseTop + config.sea.depth * W : yBaseTop + config.sea.sandLayer * W;
  const ySeabed = yBaseTop + config.sea.sandLayer * W;
  return { yFloor: 0, yBaseTop, yWater, ySeabed };
}

/**
 * islandDistance：島の足もと（水面の高さ）からの距離（海の側で正）。島のまわりは浅い砂の裾にする
 */
export function createSeaLayout(config: SceneConfig, islandDistance?: (x: number, z: number) => number): SeaLayout {
  const ped = config.pedestal;
  const W = ped.size;
  const sea = config.sea;
  const yFloor = 0;
  const yBaseTop = ped.thickness;
  const half = W / 2;
  const cornerRadius = ped.cornerRadius;
  // 土台は水の塊よりわずかに小さい（参考画像では水の塊の下に少し引っ込んで見える）
  const baseInset = 0.012 * W;
  const baseHalf = half - baseInset;
  const baseCornerRadius = Math.max(0.05, cornerRadius - baseInset);

  if (!sea.enabled) {
    const y = yBaseTop + sea.sandLayer * W;
    const flat = (resolution: number, v: number) => {
      const tex = new THREE.DataTexture(new Float32Array(resolution * resolution).fill(v), resolution, resolution, THREE.RedFormat, THREE.FloatType);
      tex.minFilter = THREE.NearestFilter;
      tex.magFilter = THREE.NearestFilter;
      tex.needsUpdate = true;
      return tex;
    };
    return {
      enabled: false,
      yFloor,
      yBaseTop,
      yDeep: yBaseTop,
      ySeabed: y,
      yWater: y,
      half,
      cornerRadius,
      baseHalf,
      baseCornerRadius,
      seabedY: () => y,
      beachAt: () => 0,
      deepAt: () => 0,
      heightTexture: (_size, resolution) => flat(resolution, y),
      deepTexture: (_size, resolution) => flat(resolution, 0),
    };
  }

  const yWater = yBaseTop + sea.depth * W;
  const ySeabed = yBaseTop + sea.sandLayer * W;
  const maxDepth = yWater - ySeabed;
  const sb = sea.seabed;
  const noise = new Noise(sb.seed * 31 + 7);
  const beach = sb.beach.map(([x, z]) => [x * W, z * W] as [number, number]);
  const dryH = sb.dryHeight * W;
  const slopeL = sb.slopeLength * W;
  const shoals = sb.shoals.map(([x, z, r, f]) => ({ x: x * W, z: z * W, r: r * W, f }));
  const apronDepth = sb.apron.depth * W;
  const apronWidth = sb.apron.width * W;
  const apronFlat = sb.apron.flat * W;
  const [afx, afz] = sb.apron.facing;
  const afl = Math.hypot(afx, afz) || 1;
  const [apC0, apC1] = sb.apron.cosRange;
  const minY = yBaseTop + 0.003 * W;

  /** 海底の高さ（式で直接求める）。格子に前もって評価しておき、以降は補間で読む */
  const evalSeabed = (x: number, z: number) => {
    const d = polygonInside(x, z, beach);
    if (d >= 0) {
      // 乾いた砂浜：水際から崖のふもとへ向かってわずかに高くなる（ここだけは高さを返す）
      return yWater + dryH * smoothstep(0, 0.045 * W, d) + 0.0015 * W * noise.fbm2(x / (0.04 * W), z / (0.04 * W), 2);
    }
    // 水の中：砂浜から沖へなだらかに深くなる
    const t = smoothstep(0, slopeL, -d);
    let depth = maxDepth * Math.pow(t, 0.85);
    // 浅い所
    let f = 1;
    for (const s of shoals) {
      const k = 1 - smoothstep(0.35 * s.r, s.r, Math.hypot(x - s.x, z - s.z));
      f = Math.min(f, 1 - (1 - s.f) * k);
    }
    depth *= f;
    // 島のまわりの浅い砂の裾（崖のふもとの岩棚から、なだらかに深くなる）
    if (islandDistance) {
      const di = islandDistance(x, z);
      if (di < apronWidth * 1.2) {
        // 島から外へ向かう向き（距離の勾配）が指定の向きに近いほど裾を付ける
        const e = 0.004 * W;
        const gx = islandDistance(x + e, z) - islandDistance(x - e, z);
        const gz = islandDistance(x, z + e) - islandDistance(x, z - e);
        const gl = Math.hypot(gx, gz) || 1;
        const mask = smoothstep(apC0, apC1, (gx * afx + gz * afz) / (gl * afl));
        // 右の岬の前（深場）では、裾を崖のすぐ前だけの狭いものにする（深場の中に浅い砂の張り出しを作らない）
        const ws = 1 - (1 - sb.apron.rightScale) * smoothstep(0.05 * W, 0.2 * W, x);
        const apron = apronDepth + (maxDepth - apronDepth) * smoothstep(apronFlat * ws, apronWidth * ws, di);
        depth = depth + (Math.min(depth, apron) - depth) * mask;
      }
    }
    // 水深を返す（高さではなく）。沖の起伏は、ならしたあとに足す
    return -depth;
  };
  const hRes = 384;
  const hExt = W / 2;
  const hCell = (2 * hExt) / (hRes - 1);
  const heights = new Float32Array(hRes * hRes);
  const beachMask = new Float32Array(hRes * hRes);
  const beachDist = new Float32Array(hRes * hRes);
  // 1. evalSeabed の値（砂浜は高さ、水の中は水深に負の符号を付けた値）
  const raw = new Float32Array(hRes * hRes);
  for (let j = 0; j < hRes; j++) {
    for (let i = 0; i < hRes; i++) {
      const x = -hExt + i * hCell;
      const z = -hExt + j * hCell;
      const k = i + j * hRes;
      const d = polygonInside(x, z, beach);
      beachDist[k] = d;
      raw[k] = evalSeabed(x, z);
      beachMask[k] = smoothstep(-0.004 * W, 0.004 * W, d);
    }
  }
  // 2. 水深をぼかして、浅い所（砂浜の沖・南の崖の前・浅瀬）から深い所へ前後左右になだらかにつなぐ。
  //    砂浜の中は水深 0 として扱う。水際のすぐ外は、砂浜からの斜面より深くならないようにして段差を作らない
  const depthField = new Float32Array(hRes * hRes);
  for (let k = 0; k < raw.length; k++) depthField[k] = beachDist[k] >= 0 ? 0 : Math.max(0, -raw[k]);
  // 2'. 陸から沖へ、扇のようになだらかに下がる砂の斜面。島は左から奥を回って右の岬へ扇形に入り江を囲むので、
  //     浅い所（砂浜・崖のふもとの浅い棚）から沖へ測った距離（島の中は通らずに回り込む）で、水深を
  //     「はじめはやや急で、沖へ行くほどゆるやかに海底へなじむ」曲線までに抑える。手前・右手前・右へ同じように広がる。
  //     斜面の長さは場所ごとに少し変えて、等深線をきれいな円弧やまっすぐな線にしない
  const fan = sb.fan;
  if (fan.length > 0) {
    const src = fan.sourceDepth * W;
    const nSize = fan.noiseSize * W;
    const fdl = Math.hypot(fan.direction[0], fan.direction[1]) || 1;
    const fanDir = [fan.direction[0] / fdl, fan.direction[1] / fdl];
    const fanNear0 = 0.08 * W;
    const fanNear1 = 0.16 * W;
    const n = hRes * hRes;
    // 距離はヒープのキーと同じ精度で持つ（単精度だと丸めでキーより小さくなり、取り出した点を飛ばしてしまう）
    const dist = new Float64Array(n).fill(Infinity);
    const blocked = new Uint8Array(n);
    const heap = new MinHeap(n);
    for (let j = 0; j < hRes; j++) {
      const z = -hExt + j * hCell;
      for (let i = 0; i < hRes; i++) {
        const x = -hExt + i * hCell;
        const k = i + j * hRes;
        // 島の中は通れない（砂浜は島の外）
        if (islandDistance && beachDist[k] < 0 && islandDistance(x, z) < 0) {
          blocked[k] = 1;
          continue;
        }
        if (depthField[k] <= src) {
          dist[k] = 0;
          heap.push(k, 0);
        }
      }
    }
    // 浅い所からの距離（8 方向に進むダイクストラ法）
    const diag = Math.SQRT2 * hCell;
    while (heap.size > 0) {
      const d = heap.topKey();
      const k = heap.pop();
      if (d > dist[k]) continue;
      const i = k % hRes;
      const j = (k - i) / hRes;
      for (let dj = -1; dj <= 1; dj++) {
        const jj = j + dj;
        if (jj < 0 || jj >= hRes) continue;
        for (let di = -1; di <= 1; di++) {
          if (di === 0 && dj === 0) continue;
          const ii = i + di;
          if (ii < 0 || ii >= hRes) continue;
          const kk = ii + jj * hRes;
          if (blocked[kk]) continue;
          const nd = d + (di !== 0 && dj !== 0 ? diag : hCell);
          if (nd < dist[kk]) {
            dist[kk] = nd;
            heap.push(kk, nd);
          }
        }
      }
    }
    for (let j = 0; j < hRes; j++) {
      const z = -hExt + j * hCell;
      for (let i = 0; i < hRes; i++) {
        const k = i + j * hRes;
        if (blocked[k] || !(dist[k] > 0) || !Number.isFinite(dist[k])) continue;
        const x = -hExt + i * hCell;
        // 島の外側（西と北の海岸の沖）へ回り込んだ所には広げない：島から外へ向かう向きが扇の開く向きと逆なら弱める
        let m = 1;
        if (islandDistance) {
          const di = islandDistance(x, z);
          if (di < fanNear1) {
            const e = 0.004 * W;
            const gx = islandDistance(x + e, z) - islandDistance(x - e, z);
            const gz = islandDistance(x, z + e) - islandDistance(x, z - e);
            const gl = Math.hypot(gx, gz);
            if (gl > 1e-6) {
              const c = (gx * fanDir[0] + gz * fanDir[1]) / gl;
              m = smoothstep(fan.facingRange[0], fan.facingRange[1], c);
              m += (1 - m) * smoothstep(fanNear0, fanNear1, di);
            }
          }
        }
        if (m <= 0) continue;
        const len = fan.length * W * (1 + fan.noise * noise.fbm2(x / nSize + 13.7, z / nSize - 4.2, 2));
        const t = Math.min(1, dist[k] / len);
        const cap = src + (maxDepth - src) * (1 - Math.pow(1 - t, fan.power));
        if (cap < depthField[k]) depthField[k] += (cap - depthField[k]) * m;
      }
    }
  }
  // ぼかす。ただし浅い棚（崖のふもとの岩が並ぶ所など）は、ぼかしで深くしない
  const sharp = depthField.slice();
  gaussianBlur(depthField, hRes, hRes, (sb.smoothing * W) / hCell);
  const keep = 0.004 * W;
  for (let k = 0; k < depthField.length; k++) depthField[k] = Math.min(depthField[k], sharp[k] + keep);
  for (let j = 0; j < hRes; j++) {
    for (let i = 0; i < hRes; i++) {
      const x = -hExt + i * hCell;
      const z = -hExt + j * hCell;
      const k = i + j * hRes;
      const d = beachDist[k];
      if (d >= 0) {
        heights[k] = raw[k];
        continue;
      }
      const slopeDepth = maxDepth * Math.pow(smoothstep(0, slopeL, -d), 0.85);
      let depth = Math.min(depthField[k], slopeDepth);
      // 沖のゆるやかな起伏
      depth += sb.undulation * W * noise.fbm2(x / (0.08 * W) - 5.1, z / (0.08 * W) + 8.3, 3) * smoothstep(0.3, 0.8, depth / maxDepth);
      heights[k] = Math.max(minY, Math.min(yWater - 0.002 * W, yWater - depth));
    }
  }
  const seabedY = (x: number, z: number) => sampleGrid(heights, hRes, hRes, (x + hExt) / hCell, (z + hExt) / hCell);
  const beachAt = (x: number, z: number) => sampleGrid(beachMask, hRes, hRes, (x + hExt) / hCell, (z + hExt) / hCell);

  // --- 深場らしさ：範囲の多角形の内側までの距離をぼかしたもの
  const deepPoly = sea.deep.region.map(([x, z]) => [x * W, z * W] as [number, number]);
  const blurW = Math.max(1e-3, sea.deep.blur * W);
  const dRes = 192;
  const dCell = (2 * hExt) / (dRes - 1);
  const deep = new Float32Array(dRes * dRes);
  for (let j = 0; j < dRes; j++) {
    for (let i = 0; i < dRes; i++) {
      const x = -hExt + i * dCell;
      const z = -hExt + j * dCell;
      const d = polygonInside(x, z, deepPoly);
      // 境目を不規則にする
      const warp = sea.deep.warp * blurW * noise.fbm2(x / (0.16 * W) + 2.2, z / (0.16 * W) - 6.4, 3);
      deep[i + j * dRes] = smoothstep(-blurW, blurW, d + warp);
    }
  }
  // さらにぼかして、境目のゆらぎで部分的に急になった所もなだらかにする
  gaussianBlur(deep, dRes, dRes, (sea.deep.soften * W) / dCell);
  const deepAt = (x: number, z: number) => sampleGrid(deep, dRes, dRes, (x + hExt) / dCell, (z + hExt) / dCell);

  const makeTexture = (size: number, resolution: number, fn: (x: number, z: number) => number) => {
    const data = new Float32Array(resolution * resolution);
    for (let j = 0; j < resolution; j++) {
      // v は -z 方向（v = 0.5 - z / size）
      const z = (0.5 - (j + 0.5) / resolution) * size;
      for (let i = 0; i < resolution; i++) {
        const x = ((i + 0.5) / resolution - 0.5) * size;
        data[i + j * resolution] = fn(x, z);
      }
    }
    const tex = new THREE.DataTexture(data, resolution, resolution, THREE.RedFormat, THREE.FloatType);
    tex.minFilter = THREE.NearestFilter;
    tex.magFilter = THREE.NearestFilter;
    tex.needsUpdate = true;
    return tex;
  };

  return {
    enabled: true,
    yFloor,
    yBaseTop,
    yDeep: yBaseTop,
    ySeabed,
    yWater,
    half,
    cornerRadius,
    baseHalf,
    baseCornerRadius,
    seabedY,
    beachAt,
    deepAt,
    heightTexture: (size, resolution) => makeTexture(size, resolution, seabedY),
    deepTexture: (size, resolution) => {
      // 8 ビットで十分（浮動小数のテクスチャは線形補間できない環境がある）
      const data = new Uint8Array(resolution * resolution * 4);
      for (let j = 0; j < resolution; j++) {
        const z = (0.5 - (j + 0.5) / resolution) * size;
        for (let i = 0; i < resolution; i++) {
          const x = ((i + 0.5) / resolution - 0.5) * size;
          const k = (i + j * resolution) * 4;
          data[k] = Math.round(Math.min(1, Math.max(0, deepAt(x, z))) * 255);
          data[k + 3] = 255;
        }
      }
      const tex = new THREE.DataTexture(data, resolution, resolution, THREE.RGBAFormat);
      tex.minFilter = THREE.LinearFilter;
      tex.magFilter = THREE.LinearFilter;
      tex.needsUpdate = true;
      return tex;
    },
  };
}

/** 角丸正方形の内側か（端からの距離）。ほかのモジュールから使う */
export { roundedSquareInside };
