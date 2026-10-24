import * as THREE from 'three';
import type { Layout } from './layout';
import { mergeGeometries } from './ground';

/**
 * 街の小物：公園のベンチと、歩道の消火栓。小さな物が点々とあると、縮尺と暮らしの様子が伝わる。
 * 種類ごとに 1 つの形を InstancedMesh で使い回し、影はインスタンスごとに焼き込む。
 */
type Spot = { x: number; z: number; rot: number };
type PropColors = { bench: string; benchLeg: string; hydrant: string; hydrantCap: string };

/** 部品ごとに色を付けて 1 つの形にまとめる */
function colored(parts: [THREE.BufferGeometry, THREE.Color][]) {
  const geos = parts.map(([g, c]) => {
    const n = g.attributes.position.count;
    const arr = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) c.toArray(arr, i * 3);
    g.setAttribute('color', new THREE.BufferAttribute(arr, 3));
    return g;
  });
  const geo = mergeGeometries(geos);
  const colors: number[] = [];
  for (const g of geos) colors.push(...(g.attributes.color.array as Float32Array));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  return geo;
}

/** ベンチ：板の座面と背もたれ、濃い灰色の脚。正面は +z（背もたれは -z 側） */
function benchGeometry(cfg: PropColors) {
  const wood = new THREE.Color(cfg.bench);
  const leg = new THREE.Color(cfg.benchLeg);
  const seat = new THREE.BoxGeometry(0.13, 0.012, 0.042);
  seat.translate(0, 0.034, 0);
  const back = new THREE.BoxGeometry(0.13, 0.03, 0.009);
  back.translate(0, 0.06, -0.019);
  const parts: [THREE.BufferGeometry, THREE.Color][] = [
    [seat, wood],
    [back, wood],
  ];
  for (const x of [-0.055, 0.055]) {
    const l = new THREE.BoxGeometry(0.01, 0.034, 0.04);
    l.translate(x, 0.017, 0);
    parts.push([l, leg]);
  }
  return colored(parts);
}

/** 消火栓：赤い胴と黄色い頭、横に出た放水口（放水口は x の向き） */
function hydrantGeometry(cfg: PropColors) {
  const red = new THREE.Color(cfg.hydrant);
  const cap = new THREE.Color(cfg.hydrantCap);
  const body = new THREE.CylinderGeometry(0.011, 0.013, 0.04, 8);
  body.translate(0, 0.02, 0);
  const top = new THREE.SphereGeometry(0.012, 8, 4, 0, Math.PI * 2, 0, Math.PI / 2);
  top.translate(0, 0.04, 0);
  const nozzle = new THREE.CylinderGeometry(0.005, 0.005, 0.034, 6);
  nozzle.rotateZ(Math.PI / 2);
  nozzle.translate(0, 0.026, 0);
  return colored([
    [body, red],
    [top, cap],
    [nozzle, red],
  ]);
}

export function createProps(layout: Layout, cfg: PropColors, groundAt: (x: number, z: number) => number) {
  const deg = THREE.MathUtils.degToRad;
  // ベンチ：正面（+z）を向ける向き（度）。消火栓：放水口の向き（度）。どちらも layout の位置
  const benches: Spot[] = layout.benches.map(([x, z, r]) => ({ x, z, rot: deg(r) }));
  const hydrants: Spot[] = layout.hydrants.map(([x, z, r]) => ({ x, z, rot: deg(r) }));
  const count = benches.length + hydrants.length;
  const build = (material: THREE.Material, slotUv: (i: number) => [number, number]) => {
    const kinds: { geo: THREE.BufferGeometry; spots: Spot[]; slot0: number; name: string }[] = [
      { geo: benchGeometry(cfg), spots: benches, slot0: 0, name: 'benches' },
      { geo: hydrantGeometry(cfg), spots: hydrants, slot0: benches.length, name: 'hydrants' },
    ];
    const meshes: THREE.InstancedMesh[] = [];
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const up = new THREE.Vector3(0, 1, 0);
    const one = new THREE.Vector3(1, 1, 1);
    for (const k of kinds) {
      const uv = new Float32Array(k.spots.length * 2);
      k.spots.forEach((_, i) => uv.set(slotUv(k.slot0 + i), i * 2));
      k.geo.setAttribute('instanceBakeUv', new THREE.InstancedBufferAttribute(uv, 2));
      const mesh = new THREE.InstancedMesh(k.geo, material, k.spots.length);
      mesh.name = k.name;
      k.spots.forEach((s, i) => {
        q.setFromAxisAngle(up, s.rot);
        m.compose(new THREE.Vector3(s.x, groundAt(s.x, s.z), s.z), q, one);
        mesh.setMatrixAt(i, m);
      });
      mesh.instanceMatrix.needsUpdate = true;
      mesh.computeBoundingSphere();
      meshes.push(mesh);
    }
    // 光を調べる点：それぞれの少し上
    const probes = [
      ...benches.map((s) => new THREE.Vector3(s.x, groundAt(s.x, s.z) + 0.09, s.z)),
      ...hydrants.map((s) => new THREE.Vector3(s.x, groundAt(s.x, s.z) + 0.06, s.z)),
    ];
    return { meshes, probes };
  };
  return { count, build };
}
