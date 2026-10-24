import * as THREE from 'three';
import type { Layout } from './layout';
import { mergeGeometries } from './ground';

/**
 * 街灯：細い濃い緑の柱と、白い丸い灯。海沿いの遊歩道と、公園の小道に並べる（layout.lamps）。
 * 1 つの形を InstancedMesh で使い回し、影はインスタンスごとに焼き込む。groundAt は根元の高さ
 */
export function createLamps(layout: Layout, cfg: { pole: string; globe: string }, groundAt: (x: number, z: number) => number) {
  const spots: [number, number, number][] = layout.lamps.map(([x, z]) => [x, groundAt(x, z), z]);
  const count = spots.length;
  const build = (material: THREE.Material, slotUv: (i: number) => [number, number]) => {
    const pole = new THREE.CylinderGeometry(0.0065, 0.009, 0.17, 6);
    pole.translate(0, 0.085, 0);
    const arm = new THREE.CylinderGeometry(0.012, 0.006, 0.012, 8);
    arm.translate(0, 0.172, 0);
    const globe = new THREE.SphereGeometry(0.019, 10, 8);
    globe.translate(0, 0.192, 0);
    const parts: [THREE.BufferGeometry, THREE.Color][] = [
      [pole, new THREE.Color(cfg.pole)],
      [arm, new THREE.Color(cfg.pole)],
      [globe, new THREE.Color(cfg.globe)],
    ];
    const colored = parts.map(([g, c]) => {
      const n = g.attributes.position.count;
      const arr = new Float32Array(n * 3);
      for (let i = 0; i < n; i++) c.toArray(arr, i * 3);
      g.setAttribute('color', new THREE.BufferAttribute(arr, 3));
      return g;
    });
    const geo = mergeGeometries(colored);
    const colors: number[] = [];
    for (const g of colored) colors.push(...(g.attributes.color.array as Float32Array));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    const uv = new Float32Array(count * 2);
    for (let i = 0; i < count; i++) uv.set(slotUv(i), i * 2);
    geo.setAttribute('instanceBakeUv', new THREE.InstancedBufferAttribute(uv, 2));
    const mesh = new THREE.InstancedMesh(geo, material, count);
    mesh.name = 'lamps';
    const m = new THREE.Matrix4();
    spots.forEach(([x, y, z], i) => {
      m.makeTranslation(x, y, z);
      mesh.setMatrixAt(i, m);
    });
    mesh.instanceMatrix.needsUpdate = true;
    mesh.computeBoundingSphere();
    const probes = spots.map(([x, y, z]) => new THREE.Vector3(x, y + 0.24, z));
    return { mesh, probes };
  };
  return { count, build };
}
