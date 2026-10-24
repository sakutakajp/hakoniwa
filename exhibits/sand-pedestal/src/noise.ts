/**
 * シードから決まる、再現性のある乱数とノイズ（CPU 用）。
 * 同じシードなら再読み込みしても同じ形になる。
 */

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const fade = (t: number) => t * t * t * (t * (t * 6 - 15) + 10);
const lerp = (t: number, a: number, b: number) => a + t * (b - a);

function grad3(h: number, x: number, y: number, z: number): number {
  const hh = h & 15;
  const u = hh < 8 ? x : y;
  const v = hh < 4 ? y : hh === 12 || hh === 14 ? x : z;
  return ((hh & 1) === 0 ? u : -u) + ((hh & 2) === 0 ? v : -v);
}

function grad2(h: number, x: number, y: number): number {
  switch (h & 7) {
    case 0:
      return x + y;
    case 1:
      return -x + y;
    case 2:
      return x - y;
    case 3:
      return -x - y;
    case 4:
      return x;
    case 5:
      return -x;
    case 6:
      return y;
    default:
      return -y;
  }
}

/** 勾配ノイズ（Perlin の改良版）。出力はおおよそ -1〜1 */
export class Noise {
  private readonly p: Uint8Array;

  constructor(seed: number) {
    const rnd = mulberry32(seed);
    const perm = new Uint8Array(256);
    for (let i = 0; i < 256; i++) perm[i] = i;
    for (let i = 255; i > 0; i--) {
      const j = Math.floor(rnd() * (i + 1));
      const t = perm[i];
      perm[i] = perm[j];
      perm[j] = t;
    }
    this.p = new Uint8Array(512);
    for (let i = 0; i < 512; i++) this.p[i] = perm[i & 255];
  }

  noise2(x: number, y: number): number {
    const p = this.p;
    let X = Math.floor(x);
    let Y = Math.floor(y);
    x -= X;
    y -= Y;
    X &= 255;
    Y &= 255;
    const u = fade(x);
    const v = fade(y);
    const a = p[X] + Y;
    const b = p[X + 1] + Y;
    return lerp(
      v,
      lerp(u, grad2(p[a], x, y), grad2(p[b], x - 1, y)),
      lerp(u, grad2(p[a + 1], x, y - 1), grad2(p[b + 1], x - 1, y - 1)),
    );
  }

  noise3(x: number, y: number, z: number): number {
    const p = this.p;
    let X = Math.floor(x);
    let Y = Math.floor(y);
    let Z = Math.floor(z);
    x -= X;
    y -= Y;
    z -= Z;
    X &= 255;
    Y &= 255;
    Z &= 255;
    const u = fade(x);
    const v = fade(y);
    const w = fade(z);
    const A = p[X] + Y;
    const AA = p[A] + Z;
    const AB = p[A + 1] + Z;
    const B = p[X + 1] + Y;
    const BA = p[B] + Z;
    const BB = p[B + 1] + Z;
    return lerp(
      w,
      lerp(
        v,
        lerp(u, grad3(p[AA], x, y, z), grad3(p[BA], x - 1, y, z)),
        lerp(u, grad3(p[AB], x, y - 1, z), grad3(p[BB], x - 1, y - 1, z)),
      ),
      lerp(
        v,
        lerp(u, grad3(p[AA + 1], x, y, z - 1), grad3(p[BA + 1], x - 1, y, z - 1)),
        lerp(u, grad3(p[AB + 1], x, y - 1, z - 1), grad3(p[BB + 1], x - 1, y - 1, z - 1)),
      ),
    );
  }

  fbm2(x: number, y: number, octaves: number): number {
    let sum = 0;
    let amp = 0.5;
    let norm = 0;
    for (let i = 0; i < octaves; i++) {
      sum += amp * this.noise2(x, y);
      norm += amp;
      x = x * 2.03 + 17.1;
      y = y * 2.03 - 9.7;
      amp *= 0.5;
    }
    return sum / norm;
  }

  fbm3(x: number, y: number, z: number, octaves: number): number {
    let sum = 0;
    let amp = 0.5;
    let norm = 0;
    for (let i = 0; i < octaves; i++) {
      sum += amp * this.noise3(x, y, z);
      norm += amp;
      x = x * 2.03 + 17.1;
      y = y * 2.03 - 9.7;
      z = z * 2.03 + 4.3;
      amp *= 0.5;
    }
    return sum / norm;
  }
}
