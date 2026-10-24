/**
 * 2次元の距離変換（Felzenszwalb & Huttenlocher のユークリッド距離変換）。
 * mask が 1 のセルまでの距離（セル単位）を、すべてのセルについて求める。
 */
export function distanceTransform(mask: Uint8Array, width: number, height: number): Float32Array {
  const INF = 1e20;
  const n = Math.max(width, height);
  const f = new Float64Array(n);
  const d = new Float64Array(n);
  const v = new Int32Array(n);
  const z = new Float64Array(n + 1);
  const grid = new Float64Array(width * height);
  for (let i = 0; i < width * height; i++) grid[i] = mask[i] ? 0 : INF;

  // 1次元の距離変換（下側包絡線）
  const edt1d = (len: number) => {
    let k = 0;
    v[0] = 0;
    z[0] = -INF;
    z[1] = INF;
    for (let q = 1; q < len; q++) {
      let s = (f[q] + q * q - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
      while (s <= z[k]) {
        k--;
        s = (f[q] + q * q - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
      }
      k++;
      v[k] = q;
      z[k] = s;
      z[k + 1] = INF;
    }
    k = 0;
    for (let q = 0; q < len; q++) {
      while (z[k + 1] < q) k++;
      const dq = q - v[k];
      d[q] = dq * dq + f[v[k]];
    }
  };

  // 列方向
  for (let x = 0; x < width; x++) {
    for (let y = 0; y < height; y++) f[y] = grid[x + y * width];
    edt1d(height);
    for (let y = 0; y < height; y++) grid[x + y * width] = d[y];
  }
  // 行方向
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) f[x] = grid[x + y * width];
    edt1d(width);
    for (let x = 0; x < width; x++) grid[x + y * width] = d[x];
  }
  const out = new Float32Array(width * height);
  for (let i = 0; i < out.length; i++) out[i] = Math.sqrt(grid[i]);
  return out;
}

/** 格子に置いた値を双線形補間で読む（範囲外は端の値） */
export function sampleGrid(grid: Float32Array, width: number, height: number, gx: number, gy: number): number {
  const x = Math.min(Math.max(gx, 0), width - 1.001);
  const y = Math.min(Math.max(gy, 0), height - 1.001);
  const ix = x | 0;
  const iy = y | 0;
  const tx = x - ix;
  const ty = y - iy;
  const k = ix + iy * width;
  return (grid[k] * (1 - tx) + grid[k + 1] * tx) * (1 - ty) + (grid[k + width] * (1 - tx) + grid[k + width + 1] * tx) * ty;
}
