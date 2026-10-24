/**
 * Surface Nets による等値面のメッシュ化。
 * 格子の各セルに頂点を1つ置き、符号が変わる辺ごとに四角形を張る。
 * 高さだけの地形と違い、垂直な崖・張り出し・えぐれも閉じたメッシュとして作れる。
 *
 * field は「内側で正」の値。添字は i + nx * (j + ny * k)（x が最も速く変わる）。
 */
export interface SurfaceNetsResult {
  positions: Float32Array;
  normals: Float32Array;
  indices: Uint32Array;
}

const CORNERS: [number, number, number][] = [];
for (let c = 0; c < 8; c++) CORNERS.push([c & 1, (c >> 1) & 1, (c >> 2) & 1]);
const EDGES: [number, number][] = [];
for (let c = 0; c < 8; c++) {
  for (const bit of [1, 2, 4]) {
    if (!(c & bit)) EDGES.push([c, c | bit]);
  }
}

export function surfaceNets(
  field: Float32Array,
  nx: number,
  ny: number,
  nz: number,
  origin: [number, number, number],
  step: number,
): SurfaceNetsResult {
  const sy = nx;
  const sz = nx * ny;
  const total = nx * ny * nz;
  const inside = new Uint8Array(total);
  for (let n = 0; n < total; n++) inside[n] = field[n] > 0 ? 1 : 0;

  const cellVertex = new Int32Array(total).fill(-1);
  let pos = new Float32Array(1 << 16);
  let vCount = 0;
  let idx = new Uint32Array(1 << 17);
  let iCount = 0;
  const cornerOffset = CORNERS.map(([a, b, c]) => a + b * sy + c * sz);
  const v = new Float32Array(8);

  const pushIndex = (a: number, b: number, c: number) => {
    if (iCount + 3 > idx.length) {
      const next = new Uint32Array(idx.length * 2);
      next.set(idx);
      idx = next;
    }
    idx[iCount++] = a;
    idx[iCount++] = b;
    idx[iCount++] = c;
  };
  // 外向きの巻き順で四角形を張る（短い方の対角線で2つの三角形に分ける）
  const quad = (a: number, b: number, c: number, d: number, flip: boolean) => {
    if (a < 0 || b < 0 || c < 0 || d < 0) return;
    if (flip) {
      const t = b;
      b = d;
      d = t;
    }
    const dac = (pos[a * 3] - pos[c * 3]) ** 2 + (pos[a * 3 + 1] - pos[c * 3 + 1]) ** 2 + (pos[a * 3 + 2] - pos[c * 3 + 2]) ** 2;
    const dbd = (pos[b * 3] - pos[d * 3]) ** 2 + (pos[b * 3 + 1] - pos[d * 3 + 1]) ** 2 + (pos[b * 3 + 2] - pos[d * 3 + 2]) ** 2;
    if (dac <= dbd) {
      pushIndex(a, b, c);
      pushIndex(a, c, d);
    } else {
      pushIndex(b, c, d);
      pushIndex(b, d, a);
    }
  };

  for (let k = 0; k < nz - 1; k++) {
    for (let j = 0; j < ny - 1; j++) {
      let base = j * sy + k * sz;
      for (let i = 0; i < nx - 1; i++, base++) {
        let mask = 0;
        for (let c = 0; c < 8; c++) mask |= inside[base + cornerOffset[c]] << c;
        if (mask === 0 || mask === 255) continue;

        // 頂点：辺との交点の平均位置
        for (let c = 0; c < 8; c++) v[c] = field[base + cornerOffset[c]];
        let px = 0;
        let py = 0;
        let pz = 0;
        let n = 0;
        for (const [a, b] of EDGES) {
          if (((mask >> a) & 1) === ((mask >> b) & 1)) continue;
          const t = v[a] / (v[a] - v[b]);
          const ca = CORNERS[a];
          const cb = CORNERS[b];
          px += ca[0] + (cb[0] - ca[0]) * t;
          py += ca[1] + (cb[1] - ca[1]) * t;
          pz += ca[2] + (cb[2] - ca[2]) * t;
          n++;
        }
        if (vCount * 3 + 3 > pos.length) {
          const next = new Float32Array(pos.length * 2);
          next.set(pos);
          pos = next;
        }
        cellVertex[base] = vCount;
        pos[vCount * 3] = origin[0] + (i + px / n) * step;
        pos[vCount * 3 + 1] = origin[1] + (j + py / n) * step;
        pos[vCount * 3 + 2] = origin[2] + (k + pz / n) * step;
        vCount++;

        // 面：このセルの最小の角から出る3本の辺のうち、符号が変わるものに四角形を張る。
        // 周りの4セルは、このセルより先に処理済み。
        const in0 = mask & 1;
        if (j > 0 && k > 0 && in0 !== ((mask >> 1) & 1)) {
          quad(cellVertex[base - sy - sz], cellVertex[base - sz], cellVertex[base], cellVertex[base - sy], !in0);
        }
        if (i > 0 && k > 0 && in0 !== ((mask >> 2) & 1)) {
          quad(cellVertex[base - sz - 1], cellVertex[base - 1], cellVertex[base], cellVertex[base - sz], !in0);
        }
        if (i > 0 && j > 0 && in0 !== ((mask >> 4) & 1)) {
          quad(cellVertex[base - 1 - sy], cellVertex[base - sy], cellVertex[base], cellVertex[base - 1], !in0);
        }
      }
    }
  }

  // 法線：格子の勾配を三線形補間（内側が正なので、勾配の逆向きが外向き）
  const positions = pos.slice(0, vCount * 3);
  const normals = new Float32Array(vCount * 3);
  const at = (i: number, j: number, k: number) => {
    i = i < 0 ? 0 : i >= nx ? nx - 1 : i;
    j = j < 0 ? 0 : j >= ny ? ny - 1 : j;
    k = k < 0 ? 0 : k >= nz ? nz - 1 : k;
    return field[i + j * sy + k * sz];
  };
  for (let vi = 0; vi < vCount; vi++) {
    const fx = (positions[vi * 3] - origin[0]) / step;
    const fy = (positions[vi * 3 + 1] - origin[1]) / step;
    const fz = (positions[vi * 3 + 2] - origin[2]) / step;
    const i0 = Math.floor(fx);
    const j0 = Math.floor(fy);
    const k0 = Math.floor(fz);
    const tx = fx - i0;
    const ty = fy - j0;
    const tz = fz - k0;
    let gx = 0;
    let gy = 0;
    let gz = 0;
    for (let c = 0; c < 8; c++) {
      const a = c & 1;
      const b = (c >> 1) & 1;
      const d = (c >> 2) & 1;
      const w = (a ? tx : 1 - tx) * (b ? ty : 1 - ty) * (d ? tz : 1 - tz);
      const i = i0 + a;
      const j = j0 + b;
      const k = k0 + d;
      gx += (at(i + 1, j, k) - at(i - 1, j, k)) * w;
      gy += (at(i, j + 1, k) - at(i, j - 1, k)) * w;
      gz += (at(i, j, k + 1) - at(i, j, k - 1)) * w;
    }
    const len = Math.hypot(gx, gy, gz) || 1;
    normals[vi * 3] = -gx / len;
    normals[vi * 3 + 1] = -gy / len;
    normals[vi * 3 + 2] = -gz / len;
  }

  return { positions, normals, indices: idx.slice(0, iCount) };
}
