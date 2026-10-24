import * as THREE from 'three';
import type { SceneConfig } from '../config';
import type { TownEnv } from './env';
import type { LightSource } from './localLight';
import { L, R } from './plan';
import { createPropMaterial, PropBatch, ShapeBuilder, type ProbeSet } from './propKit';

/**
 * 車：左の通りを角へ向かう白いワゴン車と、右の通りを角へ向かう黄色いタクシー。
 * 車体は箱を重ねて作り、前の灯りと後ろの赤い灯りは光る（濡れた路面に映る）
 */
const GLASS = 0x10141a;
const TIRE = 0x161617;

function wheels(s: ShapeBuilder, xs: number[], halfW: number, r: number) {
  for (const x of xs) {
    for (const side of [-1, 1]) {
      const g = new THREE.CylinderGeometry(r, r, 0.05, 14);
      g.rotateX(Math.PI / 2);
      g.translate(x, r, side * halfW);
      s.add(g, TIRE);
      const hub = new THREE.CylinderGeometry(r * 0.55, r * 0.55, 0.052, 10);
      hub.rotateX(Math.PI / 2);
      hub.translate(x, r, side * (halfW + 0.002));
      s.add(hub, 0x9a9c9e);
    }
  }
}

/** 白いワゴン車（前が +x）。長さ 1.2、幅 0.44、高さ 0.5 */
function vanShape() {
  const s = new ShapeBuilder();
  const W = 0.44;
  const body = 0xe9e8e4;
  // 下の車体と、上の客室（窓の帯）
  s.box(0, 0.2, 0, 1.18, 0.24, W, body);
  s.box(-0.04, 0.4, 0, 1.06, 0.16, W - 0.02, body);
  s.box(-0.04, 0.485, 0, 1.0, 0.02, W - 0.06, 0xdedcd7);
  // 側の窓（暗いガラス）
  for (const side of [-1, 1]) {
    s.box(-0.08, 0.395, side * (W / 2 - 0.004), 0.8, 0.11, 0.006, GLASS);
    s.box(0.36, 0.395, side * (W / 2 - 0.004), 0.16, 0.11, 0.006, GLASS);
    // 窓の間の柱
    s.box(0.27, 0.395, side * (W / 2 - 0.002), 0.025, 0.12, 0.006, body);
    s.box(-0.18, 0.395, side * (W / 2 - 0.002), 0.02, 0.12, 0.006, body);
    // ドアの線と取っ手
    s.box(0.18, 0.22, side * (W / 2 + 0.001), 0.006, 0.2, 0.004, 0xb8b6b0);
    s.box(0.06, 0.28, side * (W / 2 + 0.002), 0.04, 0.01, 0.004, 0x666666);
    // 鏡
    s.box(0.5, 0.36, side * (W / 2 + 0.03), 0.02, 0.04, 0.03, 0x2a2a2c);
  }
  // 前：傾いた窓、グリル、灯り、バンパー
  const wind = new THREE.BoxGeometry(0.02, 0.15, W - 0.05);
  wind.rotateZ(0.42);
  wind.translate(0.54, 0.4, 0);
  s.add(wind, GLASS);
  s.box(0.585, 0.21, 0, 0.02, 0.07, 0.26, 0x2a2b2e);
  for (const side of [-1, 1]) s.box(0.588, 0.235, side * 0.165, 0.016, 0.045, 0.07, 0xfff4dc, 1);
  s.box(0.6, 0.11, 0, 0.04, 0.05, W + 0.01, 0x8a8b8d);
  // 後ろ：窓、赤い灯り、バンパー
  s.box(-0.585, 0.39, 0, 0.012, 0.11, W - 0.08, GLASS);
  for (const side of [-1, 1]) s.box(-0.592, 0.24, side * 0.19, 0.01, 0.09, 0.045, 0xff2a20, 1);
  s.box(-0.6, 0.11, 0, 0.04, 0.05, W + 0.01, 0x8a8b8d);
  s.box(0, 0.075, 0, 1.1, 0.03, W - 0.02, 0x2a2b2e);
  wheels(s, [0.38, -0.38], W / 2 - 0.01, 0.075);
  return s.build();
}

/** 黄色いタクシー（前が +x）。長さ 1.1、幅 0.4、高さ 0.36（屋根の行灯まで） */
function taxiShape() {
  const s = new ShapeBuilder();
  const W = 0.4;
  const paint = 0xe6b02a;
  s.box(0, 0.13, 0, 1.08, 0.12, W, paint);
  // ボンネットとトランクの上面（少し低い）
  s.box(0.33, 0.2, 0, 0.4, 0.03, W - 0.01, paint);
  s.box(-0.36, 0.2, 0, 0.34, 0.03, W - 0.01, paint);
  // 客室：暗いガラスの窓と、黄色い柱と屋根
  s.box(-0.04, 0.255, 0, 0.5, 0.11, W - 0.04, GLASS);
  for (const x of [-0.27, -0.04, 0.19]) for (const side of [-1, 1]) s.box(x, 0.255, side * (W / 2 - 0.02), 0.025, 0.11, 0.006, paint);
  s.box(-0.04, 0.315, 0, 0.44, 0.02, W - 0.04, paint);
  const wind = new THREE.BoxGeometry(0.02, 0.12, W - 0.06);
  wind.rotateZ(0.75);
  wind.translate(0.24, 0.26, 0);
  s.add(wind, GLASS);
  const rear = new THREE.BoxGeometry(0.02, 0.11, W - 0.06);
  rear.rotateZ(-0.7);
  rear.translate(-0.31, 0.26, 0);
  s.add(rear, GLASS);
  // 屋根の行灯
  s.box(-0.04, 0.345, 0, 0.1, 0.04, 0.06, 0xfff6d8, 1);
  // 灯り・グリル・バンパー
  for (const side of [-1, 1]) s.box(0.543, 0.16, side * 0.14, 0.012, 0.035, 0.07, 0xfff4dc, 1);
  s.box(0.545, 0.15, 0, 0.01, 0.04, 0.14, 0x2a2b2e);
  s.box(0.56, 0.09, 0, 0.03, 0.04, W + 0.01, 0x9a9b9d);
  for (const side of [-1, 1]) s.box(-0.545, 0.17, side * 0.15, 0.012, 0.04, 0.06, 0xff2a20, 1);
  s.box(-0.56, 0.09, 0, 0.03, 0.04, W + 0.01, 0x9a9b9d);
  // 側の線と鏡
  for (const side of [-1, 1]) {
    s.box(0.0, 0.15, side * (W / 2 + 0.001), 1.0, 0.012, 0.004, 0x9a7a1a);
    s.box(0.2, 0.25, side * (W / 2 + 0.025), 0.02, 0.03, 0.025, paint);
  }
  wheels(s, [0.33, -0.33], W / 2 - 0.01, 0.068);
  return s.build();
}

export function createVehicles(config: SceneConfig, env: TownEnv, probes: ProbeSet) {
  const road = config.town.ground;
  const material = createPropMaterial(env, probes, { roughness: 0.3, metalness: 0.25, glow: 4.5, key: 'car', local: 0.8 });
  const group = new THREE.Group();
  group.name = 'vehicles';
  const lights: LightSource[] = [];
  const meshes: THREE.Mesh[] = [];
  const place = (shape: THREE.BufferGeometry, name: string, x: number, z: number, headingDeg: number) => {
    const b = new PropBatch(name, shape, material, probes);
    const a = (headingDeg * Math.PI) / 180;
    // 前（+x）を向き headingDeg（上から見た角度）へ
    const m = new THREE.Matrix4().compose(
      new THREE.Vector3(x, road, z),
      new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), -a),
      new THREE.Vector3(1, 1, 1),
    );
    b.add(m, 0xffffff, new THREE.Vector3(x, road + 0.58, z));
    const mesh = b.build()!;
    group.add(mesh);
    meshes.push(mesh);
    // 前の灯りが路面を照らす
    const fx = Math.cos(a);
    const fz = Math.sin(a);
    lights.push({ x: x + fx * 0.85, z: z + fz * 0.85, radius: 0.75, color: new THREE.Color('#fff0d2'), intensity: 1.1, facing: [fx, fz], back: 0.2 });
    lights.push({ x: x - fx * 0.62, z: z - fz * 0.62, radius: 0.35, color: new THREE.Color('#ff3a2a'), intensity: 0.5 });
  };
  // 左側通行：左の通りは縁石の側の車線を角へ、右の通りは手前の車線を角へ
  const van = L(-2.28, -0.72);
  const taxi = R(3.4, -1.66);
  place(vanShape(), 'van', van[0], van[1], 33);
  place(taxiShape(), 'taxi', taxi[0], taxi[1], 157);
  return { group, casters: meshes, lights };
}
