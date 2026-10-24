import * as THREE from 'three';
import type { TerrainLayout, TerrainSample } from './layout';

/**
 * 正方形の格子（-1〜1）を、角丸の正方形に写す。角の部分は 1/4 円に収め、外周の点は必ず外形の上に来る
 * （シリーズの海底と同じ写し方）。
 */
export function mapToRoundedSquare(u: number, v: number, half: number, radius: number): [number, number] {
  let x = u * half;
  let z = v * half;
  const c = half - radius;
  const ax = Math.abs(x);
  const az = Math.abs(z);
  if (ax > c && az > c) {
    const dx = ax - c;
    const dz = az - c;
    const l = Math.hypot(dx, dz);
    const s = l > 0 ? Math.max(dx, dz) / l : 0;
    x = Math.sign(x) * (c + dx * s);
    z = Math.sign(z) * (c + dz * s);
  }
  return [x, z];
}

/** 格子の外周を一周する頂点の番号（(n+1)×(n+1) の格子。-z の辺 → +x の辺 → +z の辺 → -x の辺） */
export function gridBoundary(n: number): number[] {
  const id = (i: number, j: number) => i + j * (n + 1);
  const ring: number[] = [];
  for (let i = 0; i < n; i++) ring.push(id(i, 0));
  for (let j = 0; j < n; j++) ring.push(id(n, j));
  for (let i = n; i > 0; i--) ring.push(id(i, n));
  for (let j = n; j > 0; j--) ring.push(id(0, j));
  return ring;
}

/** 角丸正方形の外周の点の、外向きの水平な法線 */
export function outlineNormal(x: number, z: number, half: number, radius: number): [number, number] {
  const c = half - radius;
  const ax = Math.abs(x);
  const az = Math.abs(z);
  if (ax > c - 1e-6 && az > c - 1e-6) {
    const dx = ax - c;
    const dz = az - c;
    const l = Math.hypot(dx, dz) || 1;
    return [(Math.sign(x) * dx) / l, (Math.sign(z) * dz) / l];
  }
  return ax - c > az - c ? [Math.sign(x), 0] : [0, Math.sign(z)];
}

/** 外周の一点（断面の上端）：位置・外向きの法線・上面の高さ・削る前の地面の高さ・水面 */
export interface RimPoint {
  x: number;
  z: number;
  nx: number;
  nz: number;
  /** 上面の高さ（川の所は川底） */
  top: number;
  /** 川で削る前の地面の高さ */
  ground: number;
  /** 水面の高さ（川の外は -Infinity） */
  water: number;
}

export interface TerrainMeshes {
  /** 上面（森の地面・砂浜・川底） */
  top: THREE.BufferGeometry;
  /** 外周の切り口（表土と石灰岩の層）。aGround 属性 = 削る前の地面の高さ */
  skirt: THREE.BufferGeometry;
  /** 外周の点（断面の上端。水の断面を作るのに使う） */
  rim: RimPoint[];
  /** 上面の格子の分割数と、頂点ごとの水面の高さ（川の外は -Infinity）。水面のメッシュを作るのに使う */
  n: number;
  water: Float32Array;
  /** 上面の縁から外周までの丸みの幅 */
  bevel: number;
}

/**
 * 地面の塊のメッシュ：上面は角丸正方形に写した格子を高さに合わせて起伏させ、外周に土台の上面までの切り口を付ける。
 * 上面と切り口の境は、わずかな丸み（bevel）でつなぐ（縁が光を受けて、切り口の角が立ちすぎないように）。
 */
export function buildTerrainMeshes(layout: TerrainLayout, segments: number, bevel = 0.025): TerrainMeshes {
  const n = segments;
  const half = layout.half;
  const radius = layout.cornerRadius;
  const inHalf = half - bevel;
  const inRadius = radius - bevel;
  const count = (n + 1) * (n + 1);
  const pos = new Float32Array(count * 3);
  const s: TerrainSample = { height: 0, ground: 0, water: -Infinity, wet: 0, sand: 0 };
  const ground = new Float32Array(count);
  const water = new Float32Array(count);
  for (let j = 0; j <= n; j++) {
    for (let i = 0; i <= n; i++) {
      const k = i + j * (n + 1);
      const [x, z] = mapToRoundedSquare((i / n) * 2 - 1, (j / n) * 2 - 1, inHalf, inRadius);
      layout.sample(x, z, s);
      pos[k * 3] = x;
      pos[k * 3 + 1] = s.height;
      pos[k * 3 + 2] = z;
      ground[k] = s.ground;
      water[k] = s.water;
    }
  }
  const index = new Uint32Array(n * n * 6);
  let o = 0;
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const a = i + j * (n + 1);
      const b = a + 1;
      const c = a + (n + 1);
      const d = c + 1;
      // 短い方の対角線で分ける（川の切り立った壁で、細長い三角形が段にならないように）
      const ya = pos[a * 3 + 1];
      const yb = pos[b * 3 + 1];
      const yc = pos[c * 3 + 1];
      const yd = pos[d * 3 + 1];
      if (Math.abs(ya - yd) <= Math.abs(yb - yc)) {
        index[o++] = a;
        index[o++] = c;
        index[o++] = d;
        index[o++] = a;
        index[o++] = d;
        index[o++] = b;
      } else {
        index[o++] = a;
        index[o++] = c;
        index[o++] = b;
        index[o++] = b;
        index[o++] = c;
        index[o++] = d;
      }
    }
  }
  const top = new THREE.BufferGeometry();
  top.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  top.setIndex(new THREE.BufferAttribute(index, 1));
  top.computeVertexNormals();
  top.computeBoundingBox();
  top.computeBoundingSphere();

  // --- 外周：上面の縁（内側の輪）→ 丸み → 切り口の上端（外形の上）→ 土台の上面
  const ring = gridBoundary(n);
  const m = ring.length;
  const rim: RimPoint[] = [];
  const rows = 4; // 丸みの分割
  const sp = new Float32Array(m * (rows + 2) * 3);
  const sn = new Float32Array(m * (rows + 2) * 3);
  const sg = new Float32Array(m * (rows + 2));
  for (let r = 0; r < m; r++) {
    const k = ring[r];
    const xi = pos[k * 3];
    const zi = pos[k * 3 + 2];
    const h = pos[k * 3 + 1];
    const [ox, oz] = outlineNormal(xi, zi, inHalf, inRadius);
    const x = xi + ox * bevel;
    const z = zi + oz * bevel;
    rim.push({ x, z, nx: ox, nz: oz, top: h - bevel, ground: ground[k], water: water[k] });
    // 丸み：内側の輪（上面の縁、高さ h）から外へ、断面の上端（高さ h - bevel）まで 1/4 円
    for (let q = 0; q <= rows; q++) {
      const a = (q / rows) * (Math.PI / 2);
      const off = Math.sin(a) * bevel;
      const y = h - bevel + Math.cos(a) * bevel;
      const v = (r * (rows + 2) + q) * 3;
      sp[v] = xi + ox * off;
      sp[v + 1] = y;
      sp[v + 2] = zi + oz * off;
      sn[v] = ox * Math.sin(a);
      sn[v + 1] = Math.cos(a);
      sn[v + 2] = oz * Math.sin(a);
      sg[r * (rows + 2) + q] = ground[k];
    }
    const v = (r * (rows + 2) + rows + 1) * 3;
    sp[v] = x;
    sp[v + 1] = layout.yBase;
    sp[v + 2] = z;
    sn[v] = ox;
    sn[v + 1] = 0;
    sn[v + 2] = oz;
    sg[r * (rows + 2) + rows + 1] = ground[k];
  }
  const si: number[] = [];
  const cols = rows + 2;
  for (let r = 0; r < m; r++) {
    const a = r * cols;
    const b = ((r + 1) % m) * cols;
    for (let q = 0; q < cols - 1; q++) {
      // 外向きの面（外周は -z の辺から +x の辺へ、上から見て反時計回りに回る）
      si.push(a + q, b + q, a + q + 1, a + q + 1, b + q, b + q + 1);
    }
  }
  const skirt = new THREE.BufferGeometry();
  skirt.setAttribute('position', new THREE.BufferAttribute(sp, 3));
  skirt.setAttribute('normal', new THREE.BufferAttribute(sn, 3));
  skirt.setAttribute('aGround', new THREE.BufferAttribute(sg, 1));
  skirt.setIndex(si);
  skirt.computeBoundingBox();
  skirt.computeBoundingSphere();
  return { top, skirt, rim, n, water, bevel };
}
