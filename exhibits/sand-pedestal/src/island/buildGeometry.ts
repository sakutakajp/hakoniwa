import type { IslandShape } from './shape';
import { surfaceNets } from './surfaceNets';

export interface IslandMeshData {
  positions: Float32Array;
  normals: Float32Array;
  indices: Uint32Array;
  /** 頂点ごとのくぼみの陰影（1 = 開けている、0 = 囲まれている） */
  ao: Float32Array;
  /** 焼き込み用テクスチャ上の各頂点の位置 */
  bakeUv: Float32Array;
  bakeWidth: number;
  bakeHeight: number;
  /** 形の定義（足もとの形・割れ目・洞窟の位置などを植生や岩の配置に使う） */
  shape: IslandShape;
  /** 格子に評価した密度（岩の内側で正、外側で負。値はおおよそ距離）を三線形補間で読む */
  sampleField: (x: number, y: number, z: number) => number;
  timings: Record<string, number>;
}

/**
 * 島の距離場を格子に評価し、Surface Nets で閉じたメッシュにする。
 * 格子のいちばん外側は必ず「外」として扱うので、底も含めて閉じた形になる。
 */
export function buildIslandMesh(
  shape: IslandShape,
  opts: {
    /** 格子の間隔（ワールド単位） */
    step: number;
    /** くぼみの陰影を調べる距離と強さ */
    aoDistance: number;
    aoStrength: number;
    /** まわりの地面（砂浜・海底）の高さ。くぼみの陰影で崖のふもとを暗くするのに使う */
    groundY: (x: number, z: number) => number;
  },
): IslandMeshData {
  const timings: Record<string, number> = {};
  let t0 = performance.now();
  const step = opts.step;
  const b = shape.bounds;
  const origin: [number, number, number] = [b.minX - step, b.minY, b.minZ - step];
  const nx = Math.ceil((b.maxX - origin[0]) / step) + 2;
  const ny = Math.ceil((b.maxY - origin[1]) / step) + 2;
  const nz = Math.ceil((b.maxZ - origin[2]) / step) + 2;
  const field = new Float32Array(nx * ny * nz);
  for (let k = 0; k < nz; k++) {
    const z = origin[2] + k * step;
    for (let i = 0; i < nx; i++) {
      shape.evalColumn(origin[0] + i * step, z, origin[1], step, ny, field, i + nx * ny * k, nx);
    }
  }
  // いちばん外側の格子は必ず「外」にして、閉じたメッシュにする
  for (let k = 0; k < nz; k++) {
    for (let j = 0; j < ny; j++) {
      const row = (j + k * ny) * nx;
      if (k === 0 || k === nz - 1 || j === 0 || j === ny - 1) {
        field.fill(-1, row, row + nx);
      } else {
        field[row] = -1;
        field[row + nx - 1] = -1;
      }
    }
  }
  timings.field = performance.now() - t0;

  t0 = performance.now();
  const mesh = surfaceNets(field, nx, ny, nz, origin, step);
  timings.mesh = performance.now() - t0;

  // --- くぼみの陰影（AO）：法線とその周りの方向へ距離場をたどり、近くにある岩や砂地の分だけ暗くする
  t0 = performance.now();
  const sample = (x: number, y: number, z: number) => {
    const fx = (x - origin[0]) / step;
    const fy = (y - origin[1]) / step;
    const fz = (z - origin[2]) / step;
    if (fx < 0 || fy < 0 || fz < 0 || fx >= nx - 1 || fy >= ny - 1 || fz >= nz - 1) return -1;
    const i = fx | 0;
    const j = fy | 0;
    const k = fz | 0;
    const tx = fx - i;
    const ty = fy - j;
    const tz = fz - k;
    const o = i + nx * (j + ny * k);
    const sy = nx;
    const sz = nx * ny;
    const c00 = field[o] * (1 - tx) + field[o + 1] * tx;
    const c10 = field[o + sy] * (1 - tx) + field[o + sy + 1] * tx;
    const c01 = field[o + sz] * (1 - tx) + field[o + sz + 1] * tx;
    const c11 = field[o + sy + sz] * (1 - tx) + field[o + sy + sz + 1] * tx;
    return (c00 * (1 - ty) + c10 * ty) * (1 - tz) + (c01 * (1 - ty) + c11 * ty) * tz;
  };
  const sceneDistance = (x: number, y: number, z: number) => Math.min(-sample(x, y, z), y - opts.groundY(x, z));
  const vCount = mesh.positions.length / 3;
  const ao = new Float32Array(vCount);
  const aoDist = opts.aoDistance;
  const steps = 3;
  const dirs: number[][] = [];
  const P = mesh.positions;
  const N = mesh.normals;
  for (let v = 0; v < vCount; v++) {
    const px = P[v * 3];
    const py = P[v * 3 + 1];
    const pz = P[v * 3 + 2];
    const nxv = N[v * 3];
    const nyv = N[v * 3 + 1];
    const nzv = N[v * 3 + 2];
    // 法線に直交する2方向
    const ax = Math.abs(nyv) < 0.9 ? 0 : 1;
    const ay = Math.abs(nyv) < 0.9 ? 1 : 0;
    let t1x = ay * nzv;
    let t1y = -ax * nzv;
    let t1z = ax * nyv - ay * nxv;
    const l1 = Math.hypot(t1x, t1y, t1z) || 1;
    t1x /= l1;
    t1y /= l1;
    t1z /= l1;
    const t2x = nyv * t1z - nzv * t1y;
    const t2y = nzv * t1x - nxv * t1z;
    const t2z = nxv * t1y - nyv * t1x;
    dirs.length = 0;
    dirs.push([nxv, nyv, nzv, 0.4]);
    for (const [a, c] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ]) {
      let dx = nxv + 0.85 * (a * t1x + c * t2x);
      let dy = nyv + 0.85 * (a * t1y + c * t2y);
      let dz = nzv + 0.85 * (a * t1z + c * t2z);
      const l = Math.hypot(dx, dy, dz);
      dx /= l;
      dy /= l;
      dz /= l;
      dirs.push([dx, dy, dz, 0.15]);
    }
    let occ = 0;
    for (const [dx, dy, dz, w] of dirs) {
      let o = 0;
      let ws = 0;
      for (let s = 1; s <= steps; s++) {
        const h = (aoDist * s) / steps;
        const dist = sceneDistance(px + dx * h, py + dy * h, pz + dz * h);
        const sw = 1 / s;
        o += sw * Math.min(1, Math.max(0, (h - dist) / h));
        ws += sw;
      }
      occ += w * (o / ws);
    }
    ao[v] = Math.min(1, Math.max(0, 1 - opts.aoStrength * occ * 1.25));
  }
  timings.ao = performance.now() - t0;

  // --- 焼き込み用：各頂点に1テクセルずつ割り当てる
  const bakeWidth = 1024;
  const bakeHeight = Math.max(1, Math.ceil(vCount / bakeWidth));
  const bakeUv = new Float32Array(vCount * 2);
  for (let v = 0; v < vCount; v++) {
    bakeUv[v * 2] = ((v % bakeWidth) + 0.5) / bakeWidth;
    bakeUv[v * 2 + 1] = (Math.floor(v / bakeWidth) + 0.5) / bakeHeight;
  }

  return { ...mesh, ao, bakeUv, bakeWidth, bakeHeight, shape, sampleField: sample, timings };
}
