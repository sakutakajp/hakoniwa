import * as THREE from 'three';
import { mulberry32 } from '../noise';

/**
 * 木の葉：小さな葉を描いたテクスチャを貼った四角い板（葉の板）を、樹冠の形にたくさん重ねる。
 * 板の法線は樹冠の外向きにそろえて、全体が丸くふんわり明るくなるようにする
 */
let cached: THREE.CanvasTexture | null = null;

export function leafTexture(): THREE.CanvasTexture {
  if (cached) return cached;
  const N = 256;
  const canvas = document.createElement('canvas');
  canvas.width = N;
  canvas.height = N;
  const ctx = canvas.getContext('2d')!;
  // 透明な所の色も葉の色にしておく（縮小したときに縁が黒ずまないように）
  ctx.fillStyle = 'rgba(52, 74, 34, 0)';
  ctx.fillRect(0, 0, N, N);
  const rng = mulberry32(77);
  const leaves = 110;
  for (let i = 0; i < leaves; i++) {
    const a = rng() * Math.PI * 2;
    const r = Math.sqrt(rng()) * N * 0.4;
    const x = N / 2 + Math.cos(a) * r;
    const y = N / 2 + Math.sin(a) * r;
    const rot = rng() * Math.PI;
    const rx = 7 + rng() * 6;
    const ry = 3 + rng() * 2.5;
    const h = 80 + rng() * 30;
    const sat = 30 + rng() * 22;
    const lit = 12 + rng() * 18;
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(rot);
    const g = ctx.createLinearGradient(-rx, -ry, rx, ry);
    g.addColorStop(0, `hsl(${h}, ${sat}%, ${lit + 10}%)`);
    g.addColorStop(1, `hsl(${h}, ${sat}%, ${lit}%)`);
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.ellipse(0, 0, rx, ry, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = `hsla(${h}, ${sat}%, ${lit * 0.5}%, 0.6)`;
    ctx.lineWidth = 0.8;
    ctx.stroke();
    ctx.restore();
  }
  // 細い枝
  ctx.strokeStyle = 'rgba(60, 46, 32, 0.9)';
  ctx.lineWidth = 1.6;
  for (let i = 0; i < 4; i++) {
    ctx.beginPath();
    ctx.moveTo(N / 2, N / 2);
    const a = rng() * Math.PI * 2;
    ctx.lineTo(N / 2 + Math.cos(a) * N * 0.3, N / 2 + Math.sin(a) * N * 0.3);
    ctx.stroke();
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  tex.needsUpdate = true;
  cached = tex;
  return tex;
}

/** 樹冠の葉の板：中心、半径（楕円体）、枚数、板の大きさ */
export function foliageCards(center: THREE.Vector3, radii: THREE.Vector3, count: number, size: number, seed: number): THREE.BufferGeometry {
  const rng = mulberry32(seed);
  const pos: number[] = [];
  const nor: number[] = [];
  const uv: number[] = [];
  const col: number[] = [];
  const idx: number[] = [];
  const up = new THREE.Vector3(0, 1, 0);
  for (let i = 0; i < count; i++) {
    // 外側に寄せた楕円体の中の点
    let p: THREE.Vector3;
    for (;;) {
      p = new THREE.Vector3(rng() * 2 - 1, rng() * 2 - 1, rng() * 2 - 1);
      const l = p.length();
      if (l <= 1 && l > 0.25) break;
    }
    const l = p.length();
    p.multiplyScalar(Math.pow(l, 0.45) / l);
    const local = p.clone();
    const c = new THREE.Vector3(center.x + p.x * radii.x, center.y + p.y * radii.y, center.z + p.z * radii.z);
    // 板の向き：外向きに少し寄せた乱れた向き
    const out = local.clone().normalize();
    const n = out
      .clone()
      .multiplyScalar(0.6)
      .add(new THREE.Vector3(rng() - 0.5, rng() - 0.5, rng() - 0.5).multiplyScalar(1.6))
      .normalize();
    const t = new THREE.Vector3().crossVectors(n, Math.abs(n.y) > 0.9 ? new THREE.Vector3(1, 0, 0) : up).normalize();
    const b = new THREE.Vector3().crossVectors(n, t);
    const rot = rng() * Math.PI * 2;
    const tt = t.clone().multiplyScalar(Math.cos(rot)).addScaledVector(b, Math.sin(rot));
    const bb = new THREE.Vector3().crossVectors(n, tt);
    const s = size * (0.75 + rng() * 0.5);
    // 陰影の法線：樹冠の外向き（上へ少し）
    const shadeN = out.clone().multiplyScalar(0.8).addScaledVector(up, 0.35).normalize();
    // 中ほどは暗く
    const shade = 0.5 + 0.5 * Math.min(1, l);
    const base = pos.length / 3;
    const corners: [number, number][] = [
      [-1, -1],
      [1, -1],
      [1, 1],
      [-1, 1],
    ];
    for (const [cu, cv] of corners) {
      const v = c
        .clone()
        .addScaledVector(tt, (cu * s) / 2)
        .addScaledVector(bb, (cv * s) / 2);
      pos.push(v.x, v.y, v.z);
      nor.push(shadeN.x, shadeN.y, shadeN.z);
      uv.push((cu + 1) / 2, (cv + 1) / 2);
      col.push(shade, shade, shade);
    }
    idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx);
  g.computeBoundingSphere();
  return g;
}
