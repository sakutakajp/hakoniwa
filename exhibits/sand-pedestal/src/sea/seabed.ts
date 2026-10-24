import * as THREE from 'three';
import type { SeaLayout } from './layout';

/**
 * 正方形の格子（-1〜1）を、角丸の正方形に写す。角の部分は 1/4 円に収め、外周の点は必ず外形の上に来る。
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

/** 角丸正方形の格子の、外周の点の外向きの水平な法線 */
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

export interface Seabed {
  /** 海底と砂浜の砂 */
  surface: THREE.Mesh;
  /** 外周の断面（土台の上の砂の層。側面の水越しに見える砂の帯） */
  skirt: THREE.Mesh;
}

/**
 * 海底のメッシュ：角丸正方形に写した格子を海底（砂浜を含む）の高さに合わせて起伏させる。
 * 外周には、土台の上面から海底までの断面（砂の層）を付ける。
 * 断面は水の側面よりわずかに内側に置き、水の面と重ならないようにする。
 * 島が台座の端まで届く所では、島の岩（島のメッシュ）が砂の層の手前に出る。
 */
export function createSeabed(
  layout: SeaLayout,
  sandMaterial: THREE.Material,
  opts: {
    size: number;
    segments: number;
    sandColor: string;
  },
): Seabed {
  const inset = 0.004 * (opts.size / 10);
  const half = layout.half - inset;
  const radius = layout.cornerRadius - inset;
  const n = opts.segments;
  const count = (n + 1) * (n + 1);
  const pos = new Float32Array(count * 3);
  const nor = new Float32Array(count * 3);
  const uv = new Float32Array(count * 2);
  const e = 0.02 * (opts.size / 10);
  for (let j = 0; j <= n; j++) {
    for (let i = 0; i <= n; i++) {
      const k = i + j * (n + 1);
      const [x, z] = mapToRoundedSquare((i / n) * 2 - 1, (j / n) * 2 - 1, half, radius);
      const y = layout.seabedY(x, z);
      pos[k * 3] = x;
      pos[k * 3 + 1] = y;
      pos[k * 3 + 2] = z;
      // 法線：高さの差分から
      const gx = (layout.seabedY(x + e, z) - layout.seabedY(x - e, z)) / (2 * e);
      const gz = (layout.seabedY(x, z + e) - layout.seabedY(x, z - e)) / (2 * e);
      const l = Math.hypot(gx, 1, gz);
      nor[k * 3] = -gx / l;
      nor[k * 3 + 1] = 1 / l;
      nor[k * 3 + 2] = -gz / l;
      uv[k * 2] = x / opts.size + 0.5;
      uv[k * 2 + 1] = 0.5 - z / opts.size;
    }
  }
  const index: number[] = [];
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const a = i + j * (n + 1);
      const b = a + 1;
      const c = a + (n + 1);
      const d = c + 1;
      // 上から見て反時計回り（上向きの面）
      index.push(a, c, b, b, c, d);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geometry.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  geometry.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  geometry.setIndex(index);
  geometry.computeBoundingSphere();
  const surface = new THREE.Mesh(geometry, sandMaterial);
  surface.name = 'seabed';

  // --- 外周の断面（砂の層）
  const ring = gridBoundary(n);
  const m = ring.length;
  const sp = new Float32Array(m * 2 * 3);
  const sn = new Float32Array(m * 2 * 3);
  for (let r = 0; r < m; r++) {
    const k = ring[r];
    const x = pos[k * 3];
    const y = pos[k * 3 + 1];
    const z = pos[k * 3 + 2];
    const [ox, oz] = outlineNormal(x, z, half, radius);
    // 下（土台の上面）と上（海底の縁）
    sp.set([x, layout.yDeep, z, x, y, z], r * 6);
    sn.set([ox, 0, oz, ox, 0, oz], r * 6);
  }
  const idx: number[] = [];
  for (let r = 0; r < m; r++) {
    const a = r * 2;
    const b = ((r + 1) % m) * 2;
    // 外向きの面になる順（外周は -z の辺から +x の辺へ回る）
    idx.push(a, a + 1, b, a + 1, b + 1, b);
  }
  const skirtGeometry = new THREE.BufferGeometry();
  skirtGeometry.setAttribute('position', new THREE.BufferAttribute(sp, 3));
  skirtGeometry.setAttribute('normal', new THREE.BufferAttribute(sn, 3));
  skirtGeometry.setIndex(idx);
  skirtGeometry.computeBoundingSphere();
  const skirt = new THREE.Mesh(skirtGeometry, createSkirtMaterial(opts.sandColor, layout.yDeep));
  skirt.name = 'seabed-section';
  return { surface, skirt };
}

/** 断面の砂の層のマテリアル（細かな縞とざらつき。下ほどわずかに暗い） */
function createSkirtMaterial(sandColor: string, yBase: number): THREE.MeshStandardMaterial {
  const material = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1, metalness: 0 });
  const uniforms = {
    uSkSand: { value: new THREE.Color(sandColor) },
    uSkBase: { value: yBase },
  };
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vSkPos;')
      .replace(
        '#include <project_vertex>',
        '#include <project_vertex>\nvSkPos = ( modelMatrix * vec4( transformed, 1.0 ) ).xyz;',
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
uniform vec3 uSkSand;
uniform float uSkBase;
varying vec3 vSkPos;
float skHash( vec2 p ) {
  return fract( sin( dot( p, vec2( 127.1, 311.7 ) ) ) * 43758.5453 );
}
float skNoise( vec2 p ) {
  vec2 i = floor( p );
  vec2 f = fract( p );
  vec2 u = f * f * ( 3.0 - 2.0 * f );
  return mix( mix( skHash( i ), skHash( i + vec2( 1.0, 0.0 ) ), u.x ), mix( skHash( i + vec2( 0.0, 1.0 ) ), skHash( i + vec2( 1.0, 1.0 ) ), u.x ), u.y );
}`,
      )
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
{
  // 外周に沿った座標（どの辺でも同じ模様になるよう x と z を足す）と高さ
  vec2 q = vec2( vSkPos.x + vSkPos.z, vSkPos.y );
  float h = vSkPos.y - uSkBase;
  float bands = 0.94 + 0.06 * sin( h * 38.0 + 3.0 * skNoise( q * vec2( 1.5, 4.0 ) ) );
  float grain = 0.93 + 0.12 * skNoise( q * 60.0 );
  diffuseColor.rgb *= uSkSand * bands * grain * ( 0.86 + 0.14 * smoothstep( 0.0, 0.6, h ) );
}`,
      );
  };
  material.customProgramCacheKey = () => 'seabed-section';
  return material;
}
