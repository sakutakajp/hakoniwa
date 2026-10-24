import * as THREE from 'three';
import { mulberry32 } from '../noise';

export interface WaveTextureOptions {
  /** テクスチャの一辺の画素数（2 のべき乗） */
  resolution: number;
  /** 模様の繰り返しの大きさ（ワールド） */
  tile: number;
  /** 波長の範囲（ワールド） */
  wavelength: [number, number];
  /** 波の進む向き（ラジアン、+z から +x へ）と、向きの散らばり（標準偏差、ラジアン） */
  angle: number;
  spread: number;
  /** 重ねる波の数 */
  count: number;
  seed: number;
}

/**
 * 水面の細かな風浪の傾きのテクスチャ（繰り返し模様）。R / G に x / z 方向の傾き（0.5 が平ら）を入れる。
 * 向きのそろった多数の波（波長と向きは乱数）を重ねるので、波の頂は横に長く、ところどころで途切れる。
 * 繰り返しの大きさの整数分の 1 の波だけを使い、端でつながる。ミップマップ付き（遠くの細かな波は平らになる）。
 */
export function createWaveTexture(opts: WaveTextureOptions): THREE.DataTexture {
  const n = opts.resolution;
  const T = opts.tile;
  const rnd = mulberry32(opts.seed);
  const gauss = () => {
    const u = Math.max(rnd(), 1e-9);
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rnd());
  };
  // 波：繰り返しの中の波の数（整数）で向きと波長を決める
  const waves: { kx: number; kz: number; a: number; ph: number }[] = [];
  const [lMin, lMax] = opts.wavelength;
  const seen = new Set<string>();
  for (let i = 0; waves.length < opts.count && i < opts.count * 20; i++) {
    // 波長は対数で一様に選ぶ
    const lambda = lMin * Math.pow(lMax / lMin, rnd());
    const k = T / lambda;
    const a = opts.angle + gauss() * opts.spread;
    const kx = Math.round(k * Math.sin(a));
    const kz = Math.round(k * Math.cos(a));
    if (kx === 0 && kz === 0) continue;
    const key = `${kx},${kz}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const kl = Math.hypot(kx, kz);
    // 傾きの大きさが波長によらずそろうように（高さは波長に比例）。ばらつきを付ける
    const amp = (T / kl) * (0.4 + 0.6 * Math.sqrt(-2 * Math.log(Math.max(rnd(), 1e-9))) * 0.7);
    waves.push({ kx, kz, a: amp, ph: rnd() * Math.PI * 2 });
  }
  // 高さ：sin(Au + Bv + φ) = sin(Au)cos(Bv + φ) + cos(Au)sin(Bv + φ) で、行と列の表から組み立てる
  const h = new Float32Array(n * n);
  const su = new Float32Array(n);
  const cu = new Float32Array(n);
  const sv = new Float32Array(n);
  const cv = new Float32Array(n);
  for (const w of waves) {
    for (let i = 0; i < n; i++) {
      const A = (2 * Math.PI * w.kx * i) / n;
      su[i] = Math.sin(A);
      cu[i] = Math.cos(A);
      const B = (2 * Math.PI * w.kz * i) / n + w.ph;
      sv[i] = Math.sin(B);
      cv[i] = Math.cos(B);
    }
    for (let j = 0; j < n; j++) {
      const svj = sv[j] * w.a;
      const cvj = cv[j] * w.a;
      const row = j * n;
      for (let i = 0; i < n; i++) h[row + i] += su[i] * cvj + cu[i] * svj;
    }
  }
  // 傾き（端はつながる）。標準偏差が 0.3 になるようにそろえる
  const dx = T / n;
  const gx = new Float32Array(n * n);
  const gz = new Float32Array(n * n);
  let sum2 = 0;
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const k = i + j * n;
      gx[k] = (h[((i + 1) % n) + j * n] - h[((i - 1 + n) % n) + j * n]) / (2 * dx);
      gz[k] = (h[i + ((j + 1) % n) * n] - h[i + ((j - 1 + n) % n) * n]) / (2 * dx);
      sum2 += gx[k] * gx[k] + gz[k] * gz[k];
    }
  }
  const scale = 0.3 / Math.sqrt(sum2 / (2 * n * n) + 1e-12);
  const data = new Uint8Array(n * n * 4);
  for (let k = 0; k < n * n; k++) {
    data[k * 4] = Math.round(THREE.MathUtils.clamp(0.5 + 0.5 * gx[k] * scale, 0, 1) * 255);
    data[k * 4 + 1] = Math.round(THREE.MathUtils.clamp(0.5 + 0.5 * gz[k] * scale, 0, 1) * 255);
    data[k * 4 + 2] = 128;
    data[k * 4 + 3] = 255;
  }
  const tex = new THREE.DataTexture(data, n, n, THREE.RGBAFormat);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.generateMipmaps = true;
  tex.anisotropy = 4;
  tex.needsUpdate = true;
  return tex;
}
