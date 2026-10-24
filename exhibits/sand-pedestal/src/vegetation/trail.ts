import * as THREE from 'three';
import type { IslandMeshData } from '../island/buildGeometry';
import type { VegetationConfig } from './scatter';

/**
 * 尾根の小道：道筋をなめらかにつないだ細い帯を、島の上面に沿わせて置く（森の中に白っぽい線として見える）。
 * 帯の両端の高さはそれぞれ上面を探して決め、わずかに浮かせる。
 */
export function createTrail(island: IslandMeshData, cfg: VegetationConfig, size: number): THREE.Mesh | null {
  const pts = cfg.trail.path;
  if (pts.length < 2) return null;
  const W = size;
  const F = island.sampleField;
  const yTop0 = island.shape.yWater + 0.45 * W;
  /** (x, z) の真上から下へたどって、岩の上面の高さを求める */
  const surfaceY = (x: number, z: number) => {
    const step = 0.003 * W;
    let y = yTop0;
    for (let i = 0; i < 200; i++) {
      const y2 = y - step;
      if (F(x, y2, z) > 0) {
        let lo = y2;
        let hi = y;
        for (let k = 0; k < 8; k++) {
          const mid = (lo + hi) / 2;
          if (F(x, mid, z) > 0) lo = mid;
          else hi = mid;
        }
        return hi;
      }
      y = y2;
    }
    return null;
  };

  const curve = new THREE.CatmullRomCurve3(
    pts.map(([x, z]) => new THREE.Vector3(x * W, 0, z * W)),
    false,
    'centripetal',
  );
  const n = Math.max(8, Math.ceil(curve.getLength() / (0.0025 * W)));
  const samples = curve.getSpacedPoints(n);
  const half = (cfg.trail.width * W) / 2;
  const lift = 0.0012 * W;
  const positions: number[] = [];
  const index: number[] = [];
  let prevOk = false;
  for (let i = 0; i <= n; i++) {
    const p = samples[i];
    const a = samples[Math.max(0, i - 1)];
    const b = samples[Math.min(n, i + 1)];
    const tx = b.x - a.x;
    const tz = b.z - a.z;
    const tl = Math.hypot(tx, tz) || 1;
    // 進む向きに直交する向き（水平面内）。道の幅は少し揺らす
    const w = half * (0.8 + 0.4 * Math.abs(Math.sin(i * 0.37) * Math.cos(i * 0.11)));
    const ox = (-tz / tl) * w;
    const oz = (tx / tl) * w;
    const yl = surfaceY(p.x + ox, p.z + oz);
    const yr = surfaceY(p.x - ox, p.z - oz);
    const ok = yl !== null && yr !== null;
    const base = positions.length / 3;
    positions.push(p.x + ox, (yl ?? 0) + lift, p.z + oz, p.x - ox, (yr ?? 0) + lift, p.z - oz);
    if (ok && prevOk) index.push(base - 2, base - 1, base, base - 1, base + 1, base);
    prevOk = ok;
  }
  if (index.length === 0) return null;
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(index);
  geometry.computeVertexNormals();
  const material = new THREE.MeshStandardMaterial({
    color: cfg.trail.color,
    roughness: 1,
    metalness: 0,
    side: THREE.DoubleSide,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = 'vegetation-trail';
  return mesh;
}
