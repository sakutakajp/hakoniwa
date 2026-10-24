import * as THREE from 'three';
import { distanceTransform } from './distance';

export interface ShoreSource {
  /** 島の密度（岩の内側で正）。島がなければ null */
  sampleField: ((x: number, y: number, z: number) => number) | null;
  /** 地面（砂浜）が水面より上に出ているか */
  landAt?: (x: number, z: number) => boolean;
  /** 水面から顔を出しうる岩（位置・横幅の半分・底と上端の高さ） */
  rocks: { x: number; z: number; radius: number; bottom: number; top: number }[];
}

/**
 * 岸（水面の高さで陸になっている所：崖のふもと・砂浜・水面から出た岩）からの距離を、上から見たテクスチャにする。
 * 泡の帯の幅や、波打ち際の動きに使う。R = 距離 / maxDistance（0〜1）。u: +x、v: -z、中心 0、一辺 size。
 */
export function createShoreTexture(opts: {
  size: number;
  resolution: number;
  waterY: number;
  maxDistance: number;
  source: ShoreSource;
}): { texture: THREE.DataTexture; update: (source: ShoreSource) => void } {
  const res = opts.resolution;
  const cell = opts.size / res;
  const data = new Uint8Array(res * res * 4);
  const texture = new THREE.DataTexture(data, res, res, THREE.RGBAFormat);
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearFilter;

  const update = (source: ShoreSource) => {
    const mask = new Uint8Array(res * res);
    // 崖：水面のわずかに上で岩の内側になっている所。砂浜：地面が水面より上
    const F = source.sampleField;
    const land = source.landAt;
    if (F || land) {
      for (let j = 0; j < res; j++) {
        const z = (0.5 - (j + 0.5) / res) * opts.size;
        for (let i = 0; i < res; i++) {
          const x = ((i + 0.5) / res - 0.5) * opts.size;
          if ((F && F(x, opts.waterY + 0.01, z) > 0) || (land && land(x, z))) mask[i + j * res] = 1;
        }
      }
    }
    // 岩：水面の高さでの断面（底の近くはほぼ横幅いっぱい、上端に近いほど細い）
    for (const r of source.rocks) {
      if (r.top <= opts.waterY + 0.005) continue;
      const f = THREE.MathUtils.clamp((opts.waterY - r.bottom) / Math.max(r.top - r.bottom, 1e-4), 0, 1);
      const rr = r.radius * 0.92 * (f < 0.55 ? 1 : Math.sqrt(Math.max(0, 1 - ((f - 0.55) / 0.45) ** 2)));
      if (rr <= 0) continue;
      const ci = (r.x / opts.size + 0.5) * res - 0.5;
      const cj = (0.5 - r.z / opts.size) * res - 0.5;
      const span = Math.ceil(rr / cell) + 1;
      for (let dj = -span; dj <= span; dj++) {
        for (let di = -span; di <= span; di++) {
          const i = Math.round(ci) + di;
          const j = Math.round(cj) + dj;
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
  update(opts.source);
  return { texture, update };
}
