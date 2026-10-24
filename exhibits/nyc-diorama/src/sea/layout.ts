import * as THREE from 'three';
import type { SceneConfig } from '../config';
import type { Layout } from '../layout';
import { Noise } from '../noise';
import { sampleGrid } from './distance';

/**
 * 台座と水の高さ関係と、川底の形（シリーズの海と同じ仕組み。水面・側面・川底の描き方は sea/water.ts と sea/seabed.ts）。
 *  - yFloor：床（台座の底）
 *  - yBaseTop：土台の上面 ＝ 水の塊の底（yDeep）
 *  - ySeabed：平らな川底（土台の上の薄い砂の層の上面）
 *  - yWater：水面
 * 川底は島の護岸の足もとで浅く、離れるほど深くなる砂地。
 * 同じ形を、川底のメッシュ・影の焼き込み（高さのテクスチャ）・水の色（深い所らしさ）で共通に使う。
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
  /** 川底の高さ（ワールド座標） */
  seabedY: (x: number, z: number) => number;
  /** 深い所らしさ 0〜1（色と見通しだけを変える） */
  deepAt: (x: number, z: number) => number;
  /** 川底の高さを焼き込み用のテクスチャにする（中心 0、一辺 size の範囲。u: +x、v: -z） */
  heightTexture: (size: number, resolution: number) => THREE.DataTexture;
  /** 深い所らしさをテクスチャにする（同じ範囲） */
  deepTexture: (size: number, resolution: number) => THREE.DataTexture;
  /** 島の岸からの距離（水の側で正、島の中で負） */
  islandDistance: (x: number, z: number) => number;
}

const smoothstep = (a: number, b: number, v: number) => {
  const t = Math.min(1, Math.max(0, (v - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/** 閉じた多角形までの符号付き距離（内側が正） */
export function polygonInside(px: number, pz: number, pts: [number, number][]): number {
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

/** 台座と水の高さ（形を作る前に決まる値） */
export function seaLevels(config: SceneConfig) {
  const ped = config.pedestal;
  const W = ped.size;
  const yBaseTop = ped.thickness;
  const yWater = yBaseTop + config.sea.depth * W;
  const ySeabed = yBaseTop + config.sea.sandLayer * W;
  return { yFloor: 0, yBaseTop, yWater, ySeabed, yGround: yWater + config.island.groundHeight };
}

export function createRiverLayout(config: SceneConfig, layout: Layout): SeaLayout {
  const ped = config.pedestal;
  const W = ped.size;
  const rv = config.river;
  const { yFloor, yBaseTop, yWater, ySeabed } = seaLevels(config);
  const half = W / 2;
  const cornerRadius = ped.cornerRadius;
  // 土台は水の塊よりわずかに小さい（シリーズと同じ）
  const baseInset = 0.012 * W;
  const baseHalf = half - baseInset;
  const baseCornerRadius = Math.max(0.05, cornerRadius - baseInset);
  const maxDepth = yWater - ySeabed;
  const island = layout.island.outline as [number, number][];
  const noise = new Noise(rv.seed * 31 + 7);
  const minY = yBaseTop + 0.003 * W;

  const res = 320;
  const ext = half;
  const cell = (2 * ext) / (res - 1);
  const heights = new Float32Array(res * res);
  const deep = new Float32Array(res * res);
  const dist = new Float32Array(res * res);
  for (let j = 0; j < res; j++) {
    const z = -ext + j * cell;
    for (let i = 0; i < res; i++) {
      const x = -ext + i * cell;
      const k = i + j * res;
      const dw = -polygonInside(x, z, island);
      dist[k] = dw;
      // 護岸の足もとは浅く、離れるほど深い
      const t = Math.pow(smoothstep(0, rv.slopeLength, Math.max(dw, 0)), 0.85);
      let depth = rv.shoreDepth + (maxDepth - rv.shoreDepth) * t;
      // ゆるやかな起伏（深い所ほど）
      depth += rv.undulation * noise.fbm2(x / 0.8 - 5.1, z / 0.8 + 8.3, 3) * smoothstep(0.3, 0.8, t);
      heights[k] = Math.max(minY, Math.min(yWater - 0.002 * W, yWater - depth));
      const [f0, f1, fk] = rv.deepFront;
      deep[k] = smoothstep(rv.deepRange[0], rv.deepRange[1], dw) * (1 - fk * smoothstep(f0, f1, z));
    }
  }
  const read = (grid: Float32Array) => (x: number, z: number) => sampleGrid(grid, res, res, (x + ext) / cell, (z + ext) / cell);
  const seabedY = read(heights);
  const deepAt = read(deep);
  const islandDistance = read(dist);

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
    deepAt,
    islandDistance,
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
