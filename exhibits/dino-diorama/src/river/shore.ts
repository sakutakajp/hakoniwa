import * as THREE from 'three';
import type { TerrainLayout } from '../terrain/layout';
import { distanceTransform } from './distance';

/** 水面から顔を出しうる岩（位置・横幅の半分・底と上端の高さ） */
export interface ShoreRock {
  x: number;
  z: number;
  radius: number;
  bottom: number;
  top: number;
}

/**
 * 岸（その場所の水面の高さで陸になっている所：岸の斜面・水面から出た岩）からの距離を、上から見たテクスチャにする。
 * 泡の帯の幅に使う。R = 距離 / maxDistance（0〜1）。u: +x、v: -z、中心 0、一辺 size。
 * 川は上流から 3 段の水面なので、陸かどうかは場所ごとの水面の高さで決める。
 */
export function createShoreTexture(opts: {
  size: number;
  resolution: number;
  maxDistance: number;
  layout: TerrainLayout;
  rocks: ShoreRock[];
}): { texture: THREE.DataTexture; update: (rocks: ShoreRock[]) => void } {
  const res = opts.resolution;
  const cell = opts.size / res;
  const data = new Uint8Array(res * res * 4);
  const texture = new THREE.DataTexture(data, res, res, THREE.RGBAFormat);
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearFilter;
  const L = opts.layout;
  const base = new Uint8Array(res * res);
  const levels = new Float32Array(res * res);
  for (let j = 0; j < res; j++) {
    const z = (0.5 - (j + 0.5) / res) * opts.size;
    for (let i = 0; i < res; i++) {
      const x = ((i + 0.5) / res - 0.5) * opts.size;
      const k = i + j * res;
      const w = L.waterAt(x, z);
      levels[k] = w;
      // 水面がない所、または地面が水面より上の所は陸
      if (w <= 0 || L.heightAt(x, z) > w - 0.002) base[k] = 1;
    }
  }
  const update = (rocks: ShoreRock[]) => {
    const mask = base.slice();
    for (const r of rocks) {
      const ci = (r.x / opts.size + 0.5) * res - 0.5;
      const cj = (0.5 - r.z / opts.size) * res - 0.5;
      const ii = Math.round(ci);
      const jj = Math.round(cj);
      if (ii < 0 || jj < 0 || ii >= res || jj >= res) continue;
      const level = levels[ii + jj * res];
      if (level <= 0 || r.top <= level + 0.005) continue;
      // 水面の高さでの断面（底の近くはほぼ横幅いっぱい、上端に近いほど細い）
      const f = THREE.MathUtils.clamp((level - r.bottom) / Math.max(r.top - r.bottom, 1e-4), 0, 1);
      const rr = r.radius * 0.92 * (f < 0.55 ? 1 : Math.sqrt(Math.max(0, 1 - ((f - 0.55) / 0.45) ** 2)));
      if (rr <= 0) continue;
      const span = Math.ceil(rr / cell) + 1;
      for (let dj = -span; dj <= span; dj++) {
        for (let di = -span; di <= span; di++) {
          const i = ii + di;
          const j = jj + dj;
          if (i < 0 || j < 0 || i >= res || j >= res) continue;
          if (Math.hypot((i - ci) * cell, (j - cj) * cell) <= rr) mask[i + j * res] = 1;
        }
      }
    }
    const dist = distanceTransform(mask, res, res);
    for (let k = 0; k < res * res; k++) {
      const d = Math.min(1, (dist[k] * cell) / opts.maxDistance);
      data[k * 4] = Math.round(d * 255);
      data[k * 4 + 3] = 255;
    }
    texture.needsUpdate = true;
  };
  update(opts.rocks);
  return { texture, update };
}

/**
 * 流れのテクスチャ（同じ範囲）：RG = 流れの向き（0.5 が 0）、B = 速さ（0〜1）。
 * 川の中心線の向きで、狭い所と滝の近くほど速い。水面のさざ波を流れに乗せて動かすのに使う
 */
export function createFlowTexture(layout: TerrainLayout, size: number, resolution: number): THREE.DataTexture {
  const res = resolution;
  const data = new Uint8Array(res * res * 4);
  for (let j = 0; j < res; j++) {
    const z = (0.5 - (j + 0.5) / res) * size;
    for (let i = 0; i < res; i++) {
      const x = ((i + 0.5) / res - 0.5) * size;
      const k = (i + j * res) * 4;
      const f = layout.riverFrame(x, z);
      let fx = 0;
      let fz = 0;
      let sp = 0;
      if (f && f.dist < f.w + 0.3) {
        fx = f.tx;
        fz = f.tz;
        // 幅が狭いほど速く、岸に近いほど遅い
        sp = THREE.MathUtils.clamp(0.55 / Math.max(f.w, 0.3), 0.15, 1) * (1 - THREE.MathUtils.smoothstep(f.dist / f.w, 0.6, 1.1) * 0.7);
        // 滝のすぐ下と上は速い
        for (const fall of layout.falls) {
          const d = Math.hypot(x - fall.x, z - fall.z);
          sp = Math.max(sp, 1 - THREE.MathUtils.smoothstep(d, 0.2, 0.8));
        }
      }
      data[k] = Math.round((0.5 + 0.5 * fx) * 255);
      data[k + 1] = Math.round((0.5 + 0.5 * fz) * 255);
      data[k + 2] = Math.round(THREE.MathUtils.clamp(sp, 0, 1) * 255);
      data[k + 3] = 255;
    }
  }
  const tex = new THREE.DataTexture(data, res, res, THREE.RGBAFormat);
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearFilter;
  tex.needsUpdate = true;
  return tex;
}
