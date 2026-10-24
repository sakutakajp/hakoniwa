import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import type { SceneConfig } from './config';
import { mergeGeometries } from './ground';
import type { BridgeInfo } from './bridge';
import type { Layout } from './layout';

/**
 * 黄色いタクシー：角の丸い車体、窓ガラスの客室（屋根は車体の色）、屋根の表示灯、4 つのタイヤ、前の白い灯と後ろの赤い灯。
 * 1 つの形を InstancedMesh で使い回す。置く場所は道路の車線の上と、橋の路面の上。
 */
export interface CarPose {
  position: THREE.Vector3;
  /** 前の向き（橋の上では坂に合わせて少し傾く） */
  forward: THREE.Vector3;
}

const CAR = { length: 0.36, width: 0.165, bodyH: 0.065, clearance: 0.022, scale: 1.3 };

function colorize(g: THREE.BufferGeometry, fn: (n: THREE.Vector3, p: THREE.Vector3) => THREE.Color) {
  const ng = g.index ? g.toNonIndexed() : g;
  const pos = ng.attributes.position;
  const nor = ng.attributes.normal;
  const colors = new Float32Array(pos.count * 3);
  const n = new THREE.Vector3();
  const p = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    n.fromBufferAttribute(nor, i);
    p.fromBufferAttribute(pos, i);
    const c = fn(n, p);
    colors[i * 3] = c.r;
    colors[i * 3 + 1] = c.g;
    colors[i * 3 + 2] = c.b;
  }
  ng.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  return ng;
}

/** 頂点色つきの形をまとめる（position, normal, color） */
function mergeColored(geos: THREE.BufferGeometry[]) {
  const merged = mergeGeometries(geos);
  const colors: number[] = [];
  for (const g of geos) {
    const c = g.attributes.color.array as ArrayLike<number>;
    for (let i = 0; i < c.length; i++) colors.push(c[i]);
  }
  merged.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  return merged;
}

export function createTaxiGeometry(cfg: SceneConfig['cars']) {
  const body = new THREE.Color(cfg.body);
  const glass = new THREE.Color(cfg.glass);
  const tire = new THREE.Color(cfg.tire);
  const sign = new THREE.Color(cfg.sign);
  const head = new THREE.Color(cfg.headlight);
  const tail = new THREE.Color(cfg.taillight);
  const { length: L, width: W, bodyH, clearance } = CAR;
  const parts: THREE.BufferGeometry[] = [];
  // 車体（下の方を少し暗く）
  const b = new RoundedBoxGeometry(L, bodyH, W, 2, 0.022);
  b.translate(0, clearance + bodyH / 2, 0);
  parts.push(colorize(b, (_n, p) => body.clone().multiplyScalar(p.y < clearance + 0.012 ? 0.82 : 1)));
  // 客室：側面は窓ガラス、屋根は車体の色
  const cabL = 0.19;
  const cabH = 0.052;
  const c = new RoundedBoxGeometry(cabL, cabH, W * 0.86, 2, 0.018);
  c.translate(-0.025, clearance + bodyH + cabH / 2 - 0.006, 0);
  parts.push(colorize(c, (n) => (n.y > 0.55 ? body : glass)));
  // 屋根の表示灯
  const s = new RoundedBoxGeometry(0.06, 0.022, 0.032, 1, 0.006);
  s.translate(-0.025, clearance + bodyH + cabH - 0.002, 0);
  parts.push(colorize(s, () => sign));
  // タイヤ
  for (const x of [-0.115, 0.115]) {
    for (const z of [-W / 2 + 0.01, W / 2 - 0.01]) {
      const t = new THREE.CylinderGeometry(0.03, 0.03, 0.03, 10);
      t.rotateX(Math.PI / 2);
      t.translate(x, 0.03, z);
      parts.push(colorize(t, () => tire));
    }
  }
  // 前の白い灯と、後ろの赤い灯
  for (const z of [-W / 2 + 0.03, W / 2 - 0.03]) {
    const h = new THREE.BoxGeometry(0.01, 0.016, 0.03);
    h.translate(L / 2 - 0.002, clearance + bodyH * 0.62, z);
    parts.push(colorize(h, () => head));
    const t = new THREE.BoxGeometry(0.01, 0.014, 0.028);
    t.translate(-L / 2 + 0.002, clearance + bodyH * 0.62, z);
    parts.push(colorize(t, () => tail));
  }
  const geo = mergeColored(parts);
  // 参考画像のタクシーは街並みに比べて大きめ（おもちゃのような大きさ）
  geo.scale(CAR.scale, CAR.scale, CAR.scale);
  geo.computeBoundingSphere();
  return geo;
}

/**
 * 車の位置：道路の上は layout.cars（右側通行の車線の上）。橋の上は、坂道・側径間・主径間に数台ずつ
 * （台座の外へ向かう車は進む向きの右の車線、島へ戻る車は反対の車線）
 */
export function carPoses(layout: Layout, bridge: BridgeInfo): CarPose[] {
  const poses: CarPose[] = layout.cars.map(([x, z, dx, dz]) => ({
    position: new THREE.Vector3(x, 0, z),
    forward: new THREE.Vector3(dx, 0, dz).normalize(),
  }));
  // 車線の中心：中央の歩道の端と縁石のあいだ
  const lane = (0.07 + (bridge.width / 2 - 0.022)) / 2;
  const onBridge = (t: number, outbound: boolean) => {
    const { p, tan } = bridge.deckPoint(t, outbound ? lane : -lane);
    poses.push({ position: p, forward: outbound ? tan : tan.clone().negate() });
  };
  const { rampT, anchorT, towerT } = bridge;
  onBridge(rampT * 0.55, false);
  onBridge(anchorT + (towerT - anchorT) * 0.3, true);
  onBridge(anchorT + (towerT - anchorT) * 0.72, false);
  onBridge(towerT + (1 - towerT) * 0.35, true);
  onBridge(towerT + (1 - towerT) * 0.78, false);
  return poses;
}

/**
 * タクシーを並べる。material は頂点色を使うインスタンス用の焼き込みマテリアル。
 * probes は焼き込みで光を調べる点（屋根の少し上）
 */
export function createCars(poses: CarPose[], geometry: THREE.BufferGeometry, material: THREE.Material) {
  const mesh = new THREE.InstancedMesh(geometry, material, poses.length);
  mesh.name = 'taxis';
  const m = new THREE.Matrix4();
  const up = new THREE.Vector3();
  const side = new THREE.Vector3();
  poses.forEach((pose, i) => {
    const f = pose.forward.clone().normalize();
    side.crossVectors(f, new THREE.Vector3(0, 1, 0)).normalize();
    up.crossVectors(side, f).normalize();
    m.makeBasis(f, up, side);
    m.setPosition(pose.position);
    mesh.setMatrixAt(i, m);
  });
  mesh.instanceMatrix.needsUpdate = true;
  mesh.computeBoundingSphere();
  const probes = poses.map((p) => p.position.clone().add(new THREE.Vector3(0, 0.2, 0)));
  const outline = poses.map((p) => p.position.clone().add(new THREE.Vector3(0, 0.19, 0)));
  return { mesh, probes, outline };
}
