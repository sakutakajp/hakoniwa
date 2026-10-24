import * as THREE from 'three';
import type { SceneConfig } from '../config';

/**
 * 街の明かりの光源（上から見た地図に描く）。
 * 店先・街灯・看板が、まわりの地面と壁の低い所を照らす
 */
export interface LightSource {
  x: number;
  z: number;
  /** 地面に届く光の半径 */
  radius: number;
  /** リニアな RGB（0〜1）と強さ */
  color: THREE.Color;
  intensity: number;
  /** 店先のように前だけを照らす光：前の向き（上から見た単位ベクトル）。省略すると全方向 */
  facing?: [number, number];
  /** 線の光（店先の間口に沿った明かり）：(x, z) から (x2, z2) までの線分からの距離で弱める */
  x2?: number;
  z2?: number;
  /** 後ろへ回り込む割合（facing があるとき。0 で前だけ） */
  back?: number;
}

/**
 * 光源を上から見た HDR の地図（半精度の RGBA テクスチャ）に足し合わせる。
 * 範囲は中心 0、一辺 config.town.localLight.size。u = x、v = z（上下を反転しない）
 */
export function createLocalLightMap(config: SceneConfig, sources: readonly LightSource[], resolution: number): THREE.DataTexture {
  const size = config.town.localLight.size;
  const n = resolution;
  const acc = new Float32Array(n * n * 3);
  const k = n / size;
  for (const s of sources) {
    const cx = (s.x + size / 2) * k - 0.5;
    const cz = (s.z + size / 2) * k - 0.5;
    const rr = s.radius * k;
    if (s.x2 !== undefined && s.z2 !== undefined) {
      addSegment(acc, n, k, size, s);
      continue;
    }
    const i0 = Math.max(0, Math.floor(cx - rr));
    const i1 = Math.min(n - 1, Math.ceil(cx + rr));
    const j0 = Math.max(0, Math.floor(cz - rr));
    const j1 = Math.min(n - 1, Math.ceil(cz + rr));
    const r = s.color.r * s.intensity;
    const g = s.color.g * s.intensity;
    const b = s.color.b * s.intensity;
    const back = s.back ?? 0.15;
    for (let j = j0; j <= j1; j++) {
      const dz = (j - cz) / rr;
      for (let i = i0; i <= i1; i++) {
        const dx = (i - cx) / rr;
        const d2 = dx * dx + dz * dz;
        if (d2 >= 1) continue;
        // 中心ほど強く、縁でなめらかに 0 になる（距離の 2 乗に反比例する感じに近い形）
        const f = 1 - d2;
        let w = (f * f * f) / (1 + 6 * d2);
        if (s.facing) {
          const d = Math.sqrt(d2) + 1e-6;
          const c = (dx * s.facing[0] + dz * s.facing[1]) / d;
          // 前は強く、横は半分、後ろは back
          const t = Math.min(1, Math.max(0, (c + 0.35) / 0.7));
          w *= back + (1 - back) * t * t * (3 - 2 * t);
        }
        const o = (i + j * n) * 3;
        acc[o] += r * w;
        acc[o + 1] += g * w;
        acc[o + 2] += b * w;
      }
    }
  }
  const data = new Uint16Array(n * n * 4);
  const one = THREE.DataUtils.toHalfFloat(1);
  for (let p = 0; p < n * n; p++) {
    data[p * 4] = THREE.DataUtils.toHalfFloat(acc[p * 3]);
    data[p * 4 + 1] = THREE.DataUtils.toHalfFloat(acc[p * 3 + 1]);
    data[p * 4 + 2] = THREE.DataUtils.toHalfFloat(acc[p * 3 + 2]);
    data[p * 4 + 3] = one;
  }
  const tex = new THREE.DataTexture(data, n, n, THREE.RGBAFormat, THREE.HalfFloatType);
  tex.colorSpace = THREE.NoColorSpace;
  tex.minFilter = THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.wrapS = THREE.ClampToEdgeWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.generateMipmaps = false;
  tex.flipY = false;
  tex.needsUpdate = true;
  return tex;
}

/** 線の光を足す：線分からの距離で弱め、前（facing の向き）だけを照らす */
function addSegment(acc: Float32Array, n: number, k: number, size: number, s: LightSource) {
  const ax = (s.x + size / 2) * k - 0.5;
  const az = (s.z + size / 2) * k - 0.5;
  const bx = (s.x2! + size / 2) * k - 0.5;
  const bz = (s.z2! + size / 2) * k - 0.5;
  const rr = s.radius * k;
  const i0 = Math.max(0, Math.floor(Math.min(ax, bx) - rr));
  const i1 = Math.min(n - 1, Math.ceil(Math.max(ax, bx) + rr));
  const j0 = Math.max(0, Math.floor(Math.min(az, bz) - rr));
  const j1 = Math.min(n - 1, Math.ceil(Math.max(az, bz) + rr));
  const ex = bx - ax;
  const ez = bz - az;
  const el2 = Math.max(ex * ex + ez * ez, 1e-6);
  const r = s.color.r * s.intensity;
  const g = s.color.g * s.intensity;
  const b = s.color.b * s.intensity;
  const back = s.back ?? 0.1;
  for (let j = j0; j <= j1; j++) {
    for (let i = i0; i <= i1; i++) {
      const px = i - ax;
      const pz = j - az;
      const t = Math.min(1, Math.max(0, (px * ex + pz * ez) / el2));
      const dx = (px - ex * t) / rr;
      const dz = (pz - ez * t) / rr;
      const d2 = dx * dx + dz * dz;
      if (d2 >= 1) continue;
      const f = 1 - d2;
      let w = (f * f * f) / (1 + 5 * d2);
      if (s.facing) {
        const side = px * s.facing[0] + pz * s.facing[1];
        if (side < 0) w *= back;
      }
      const o = (i + j * n) * 3;
      acc[o] += r * w;
      acc[o + 1] += g * w;
      acc[o + 2] += b * w;
    }
  }
}
