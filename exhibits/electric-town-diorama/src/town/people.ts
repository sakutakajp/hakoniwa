import * as THREE from 'three';
import type { SceneConfig } from '../config';
import { mulberry32 } from '../noise';
import { faceFrame, type MassSpec } from './buildings';
import type { TownEnv } from './env';
import { distanceToPolyline, insidePolygon, type P2 } from './geometry2d';
import { createPropMaterial, PropBatch, ShapeBuilder, type ProbeSet } from './propKit';
import type { Streets } from './streets';
import { BIKES, bollardPoints, GOODS, KIOSK, LAMPS, PLAZA, POLES, TREES, UTILITY_BOXES, VENDING } from './streetData';
import { fromA, fromL, fromR } from './plan';

/**
 * 歩く人々。人の形は数種類（立つ・歩く・袋を持つ）を、服とズボンの色を変えて置く。
 * 頂点の色の赤の成分で部位を見分ける（0.1 = 上着、0.3 = ズボン、0.5 = 肌、0.7 = 髪、0.9 = 靴・かばん）
 */
const SLOT = { shirt: 0.1, pants: 0.3, skin: 0.5, hair: 0.7, dark: 0.9 };

function slotColor(v: number) {
  return new THREE.Color(v, 0, 0);
}

/** 人の形（高さ約 0.4）。stride：足の開き（-1〜1）、arm：腕の振り、bag：手さげ袋 */
function personShape(stride: number, arm: number, bag: boolean, coat: boolean) {
  const s = new ShapeBuilder();
  const H = 0.4;
  const hip = H * 0.47;
  // 足（少し前後に開く）
  for (const side of [-1, 1]) {
    const g = new THREE.CylinderGeometry(0.019, 0.015, hip, 6);
    g.translate(0, -hip / 2, 0);
    g.rotateX(side * stride * 0.32);
    g.translate(side * 0.026, hip, 0);
    s.add(g, slotColor(SLOT.pants));
    const shoe = new THREE.BoxGeometry(0.03, 0.018, 0.05);
    const zOff = Math.sin(side * stride * 0.32) * hip;
    shoe.translate(side * 0.026, 0.009, zOff + 0.008);
    s.add(shoe, slotColor(SLOT.dark));
  }
  // 胴（上着）と肩
  const torsoH = H * 0.3;
  const torso = new THREE.CylinderGeometry(0.052, coat ? 0.06 : 0.045, torsoH + (coat ? 0.06 : 0), 8);
  torso.scale(1, 1, 0.68);
  torso.translate(0, hip + torsoH / 2 - (coat ? 0.03 : 0), 0);
  s.add(torso, slotColor(SLOT.shirt));
  const shoulders = new THREE.SphereGeometry(0.052, 8, 4, 0, Math.PI * 2, 0, Math.PI / 2);
  shoulders.scale(1.05, 0.45, 0.7);
  shoulders.translate(0, hip + torsoH, 0);
  s.add(shoulders, slotColor(SLOT.shirt));
  // 腕
  for (const side of [-1, 1]) {
    const g = new THREE.CylinderGeometry(0.013, 0.011, torsoH * 1.05, 5);
    g.translate(0, -torsoH * 0.52, 0);
    g.rotateX(-side * arm * 0.4);
    g.rotateZ(side * 0.1);
    g.translate(side * 0.06, hip + torsoH - 0.005, 0);
    s.add(g, slotColor(SLOT.shirt));
    const hand = new THREE.SphereGeometry(0.012, 6, 4);
    const ang = -side * arm * 0.4;
    hand.translate(side * (0.06 + 0.01), hip + torsoH - torsoH * 1.02 * Math.cos(ang), torsoH * 1.02 * Math.sin(ang) * -1);
    s.add(hand, slotColor(SLOT.skin));
  }
  // 首と頭と髪
  s.cylinder(0, hip + torsoH + 0.012, 0, 0.014, 0.025, slotColor(SLOT.skin), 6);
  s.sphere(0, hip + torsoH + 0.05, 0, 0.034, slotColor(SLOT.skin), 0, 0.9, 1.05, 0.95, 1);
  const hair = new THREE.SphereGeometry(0.037, 10, 6, 0, Math.PI * 2, 0, Math.PI * 0.55);
  hair.scale(0.92, 1.0, 1.0);
  hair.rotateX(-0.3);
  hair.translate(0, hip + torsoH + 0.055, -0.004);
  s.add(hair, slotColor(SLOT.hair));
  if (bag) {
    s.box(0.075, hip - 0.02, 0.0, 0.025, 0.07, 0.06, slotColor(SLOT.dark));
  }
  return s.build();
}

const SHIRTS = ['#1c1f26', '#252a33', '#2e3440', '#1a1c21', '#3a3f4a', '#232a3a', '#2a2e36', '#e6e2da', '#454a54', '#30384a', '#5a5048', '#1e2430', '#6a6e78', '#d8d2c6', '#3a2e2a', '#8a3a36'];
const PANTS = ['#1a1c20', '#22252b', '#2a2e36', '#30333a', '#3a3a3e', '#1e2636', '#4a4640', '#26272c'];

export function createPeople(
  config: SceneConfig,
  env: TownEnv,
  probes: ProbeSet,
  streets: Streets,
  masses: readonly MassSpec[],
  opts: { count: number },
) {
  const walk = config.town.ground + config.town.curb;
  const material = createPropMaterial(env, probes, {
    roughness: 0.75,
    key: 'people',
    local: 1.6,
    vertexDeclarations: `
attribute vec3 aShirt;
attribute vec3 aPants;
attribute vec3 aHair;
varying vec3 vShirt;
varying vec3 vPants;
varying vec3 vHairC;
varying float vSlot;`,
    vertexChunk: `
vShirt = aShirt;
vPants = aPants;
vHairC = aHair;
vSlot = color.r;`,
    declarations: `
varying vec3 vShirt;
varying vec3 vPants;
varying vec3 vHairC;
varying float vSlot;`,
    colorChunk: `
{
  vec3 skin = vec3( 0.62, 0.42, 0.3 );
  vec3 c = vSlot < 0.2 ? vShirt : ( vSlot < 0.4 ? vPants : ( vSlot < 0.6 ? skin : ( vSlot < 0.8 ? vHairC : vec3( 0.03 ) ) ) );
  diffuseColor.rgb = c;
}`,
  });
  const variants = [
    personShape(0, 0, false, false),
    personShape(0.8, 0.8, false, false),
    personShape(-0.7, -0.7, true, false),
    personShape(0.5, 0.4, false, true),
    personShape(0, 0.1, true, true),
    personShape(-0.9, -0.8, false, true),
  ];
  const batches = variants.map((g, i) => new PropBatch(`people-${i}`, g, material, probes));
  const extra: { shirt: number[]; pants: number[]; hair: number[] }[] = batches.map(() => ({ shirt: [], pants: [], hair: [] }));

  // 置けない所：建物、街灯・木・電柱・車止めなど、店先の棚
  const obstacles: { x: number; z: number; r: number }[] = [];
  for (const [x, z] of LAMPS) obstacles.push({ x, z, r: 0.08 });
  for (const [x, z] of TREES) obstacles.push({ x, z, r: 0.1 });
  for (const [x, z] of POLES) obstacles.push({ x, z, r: 0.09 });
  for (const [x, z] of bollardPoints()) obstacles.push({ x, z, r: 0.06 });
  for (const [x, z] of BIKES) obstacles.push({ x, z, r: 0.17 });
  for (const [x, z] of UTILITY_BOXES) obstacles.push({ x, z, r: 0.25 });
  for (const [x, z] of VENDING) obstacles.push({ x, z, r: 0.16 });
  obstacles.push({ x: KIOSK[0], z: KIOSK[1], r: 0.42 });
  const byId = new Map(masses.map((m) => [m.id, m]));
  const shopFaces = GOODS.map((g) => {
    const m = byId.get(g.mass)!;
    return { f: faceFrame(m, g.face, walk), g };
  });
  for (const { f, g } of shopFaces) {
    const n = Math.max(1, g.count);
    for (let i = 0; i < n; i++) {
      const u = g.u0 + ((i + 0.5) / n) * (g.u1 - g.u0);
      obstacles.push({ x: f.a[0] + f.t[0] * u + f.n[0] * g.off, z: f.a[1] + f.t[1] * u + f.n[1] * g.off, r: 0.17 });
    }
  }
  const inBuilding = (x: number, z: number) =>
    masses.some((m) => {
      if (insidePolygon(x, z, m.corners)) return true;
      // 壁から 0.07 以内も避ける
      return distanceToPolyline(x, z, m.corners) < 0.07;
    });
  const al = config.town.alley;
  const aa = (al.dir * Math.PI) / 180;
  const alley: P2[] = [al.origin, [al.origin[0] + Math.cos(aa) * al.length, al.origin[1] + Math.sin(aa) * al.length]];
  // 路地の中か（始まりより奥で、中心の線から 0.42 以内）
  const inAlley = (x: number, z: number) => {
    const s = (x - al.origin[0]) * Math.cos(aa) + (z - al.origin[1]) * Math.sin(aa);
    return s > 1.6 && s < al.length && distanceToPolyline(x, z, alley, false) < 0.42;
  };
  const near = (x: number, z: number, r: number) => obstacles.some((o) => Math.hypot(o.x - x, o.z - z) < o.r + r);
  // 人が歩ける所：歩道・向かいの歩道・広場・路地・裏路地（建物に囲まれた中庭には置かない）
  const sw = config.town.sidewalk;
  const isPublic = (x: number, z: number) => {
    const p: P2 = [x, z];
    if (insidePolygon(x, z, streets.farLeft) || insidePolygon(x, z, streets.farRight)) return true;
    const dl = fromL(p)[1];
    if (dl >= 0 && dl <= sw.left) return true;
    const dr = fromR(p)[1];
    if (dr >= 0 && dr <= sw.right) return true;
    if (insidePolygon(x, z, PLAZA)) return true;
    const [sa, da] = fromA(p);
    if (sa >= 0 && sa <= al.length && Math.abs(da) <= al.width / 2) return true;
    return config.town.backLanes.some((b) => {
      const [s, d] = b.frame === 'L' ? fromL(p) : fromR(p);
      return s >= b.s[0] && s <= b.s[1] && Math.abs(d - b.d) <= b.width / 2;
    });
  };

  const rng = mulberry32(1234);
  const placed: { x: number; z: number }[] = [];
  const outline = streets.outline;
  const half = config.pedestal.size / 2;
  let tries = 0;
  while (placed.length < opts.count && tries < opts.count * 400) {
    tries++;
    const x = (rng() * 2 - 1) * (half - 0.15);
    const z = (rng() * 2 - 1) * (half - 0.15);
    if (!insidePolygon(x, z, outline)) continue;
    if (!streets.raised(x, z)) continue;
    if (!isPublic(x, z)) continue;
    // 台座の縁から離す
    if (distanceToPolyline(x, z, outline) < 0.12) continue;
    if (inBuilding(x, z)) continue;
    if (near(x, z, 0.05)) continue;
    if (placed.some((p) => Math.hypot(p.x - x, p.z - z) < 0.13)) continue;
    // 人の多い所：路地、店先の前、広場
    const alleyHere = inAlley(x, z);
    let density = 0.18;
    if (alleyHere) density = 1.0;
    else if (shopFaces.some(({ f }) => {
      const rx = x - f.a[0];
      const rz = z - f.a[1];
      const u = rx * f.t[0] + rz * f.t[1];
      const d = rx * f.n[0] + rz * f.n[1];
      return u > 0 && u < f.len && d > 0.25 && d < 0.85;
    }))
      density = 0.75;
    else if (z > -1.2 && x > -2.6 && x < 1.6) density = 0.45;
    if (rng() > density) continue;
    placed.push({ x, z });
    // 向き：路地では路地に沿って、ほかは気ままに
    let yaw = rng() * Math.PI * 2;
    if (alleyHere) yaw = (rng() < 0.5 ? 0 : Math.PI) + (rng() - 0.5) * 0.5 + Math.PI * 0.03;
    const k = Math.floor(rng() * batches.length);
    const sc = (0.92 + rng() * 0.16) * 1.1;
    const m = new THREE.Matrix4().compose(
      new THREE.Vector3(x, walk, z),
      new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw),
      new THREE.Vector3(sc, sc, sc),
    );
    batches[k].add(m, 0xffffff, new THREE.Vector3(x, walk + 0.5 * sc, z));
    const shirt = new THREE.Color(SHIRTS[Math.floor(rng() * SHIRTS.length)]);
    const pants = new THREE.Color(PANTS[Math.floor(rng() * PANTS.length)]);
    const hair = new THREE.Color().setHSL(0.07, 0.3, 0.05 + rng() * 0.08 + (rng() < 0.1 ? 0.25 : 0));
    extra[k].shirt.push(shirt.r, shirt.g, shirt.b);
    extra[k].pants.push(pants.r, pants.g, pants.b);
    extra[k].hair.push(hair.r, hair.g, hair.b);
  }
  const group = new THREE.Group();
  group.name = 'people';
  const meshes: THREE.InstancedMesh[] = [];
  batches.forEach((b, i) => {
    const mesh = b.build();
    if (!mesh) return;
    mesh.geometry.setAttribute('aShirt', new THREE.InstancedBufferAttribute(new Float32Array(extra[i].shirt), 3));
    mesh.geometry.setAttribute('aPants', new THREE.InstancedBufferAttribute(new Float32Array(extra[i].pants), 3));
    mesh.geometry.setAttribute('aHair', new THREE.InstancedBufferAttribute(new Float32Array(extra[i].hair), 3));
    group.add(mesh);
    meshes.push(mesh);
  });
  return { group, casters: meshes, count: placed.length };
}
