import * as THREE from 'three';
import type { SceneConfig } from '../config';
import type { IslandMeshData } from '../island/buildGeometry';
import { createBakeTarget, type PointReceiver } from '../lightBaker';
import { createTemplates, type PlantTemplate } from './templates';
import { scatterVegetation, type PlantInstance, type TemplateGroup } from './scatter';
import { createPlantMaterial } from './plantMaterial';
import { createTrail } from './trail';

export interface Vegetation {
  /** 植生をまとめたグループ（名前 'vegetation'）。表示・非表示の切り替えは main.ts の setVegetationVisible で */
  group: THREE.Group;
  /** 影の計算に使う簡易形状（シーンには入れない） */
  casters: THREE.Mesh[];
  /** 各植物の受ける光（影）を焼き込む点 */
  receiver: PointReceiver;
  /** 画角合わせ用の点（木と低木の樹冠の上端） */
  outlinePoints: THREE.Vector3[];
  counts: Record<string, number>;
  timings: Record<string, number>;
}

/**
 * 島の表面に植生（樹木・ヤシ・低木・地表の草・崖の草むら・つる）を作る。
 * 同じ形はひな形を InstancedMesh で使い回し、木や群落ごとの色はインスタンスカラーで付ける。
 */
export function createVegetation(
  renderer: THREE.WebGLRenderer,
  config: SceneConfig,
  island: IslandMeshData,
): Vegetation {
  const cfg = config.vegetation;
  const timings: Record<string, number> = {};
  let t0 = performance.now();
  const lib = createTemplates(cfg.seed);
  timings.templates = performance.now() - t0;

  t0 = performance.now();
  const instances = scatterVegetation(island, cfg, { size: config.pedestal.size }, lib);
  timings.scatter = performance.now() - t0;

  t0 = performance.now();
  const common = {
    roughness: cfg.roughness,
    interior: cfg.shading.interior,
    tipLight: cfg.shading.tipLight,
    tipColor: cfg.colors.tip,
    aoMin: cfg.shading.aoMin,
    shadowStrength: config.shadow.strength,
    aoStrength: cfg.shading.aoStrength,
    leafScale: 1 / (cfg.shading.leafSize * config.pedestal.size),
    leafBump: cfg.shading.leafBump,
    leafContrast: cfg.shading.leafContrast,
    sheen: cfg.shading.sheen,
    sheenColor: cfg.colors.sheen,
  };
  const leafMat = createPlantMaterial({ kind: 'foliage', ...common });
  const woodMat = createPlantMaterial({ kind: 'wood', color: cfg.colors.trunk, ...common, interior: 0, tipLight: 0 });
  const casterMaterial = new THREE.MeshBasicMaterial();

  // 焼き込み先：植物1つに1テクセル
  const total = instances.length;
  const bakeWidth = 512;
  const bakeHeight = Math.max(1, Math.ceil(total / bakeWidth));
  const target = createBakeTarget(renderer, bakeWidth, bakeHeight);
  target.texture.minFilter = THREE.NearestFilter;
  target.texture.magFilter = THREE.NearestFilter;
  leafMat.setBake(target.texture);
  woodMat.setBake(target.texture);

  const probePos = new Float32Array(total * 3);
  const probeNor = new Float32Array(total * 3);
  const probeUv = new Float32Array(total * 2);

  // ひな形ごとにまとめる
  const byTemplate = new Map<PlantTemplate, { list: PlantInstance[]; group: TemplateGroup }>();
  for (const inst of instances) {
    const tpl = lib[inst.group][inst.index];
    const entry = byTemplate.get(tpl);
    if (entry) entry.list.push(inst);
    else byTemplate.set(tpl, { list: [inst], group: inst.group });
  }

  const group = new THREE.Group();
  group.name = 'vegetation';
  const casters: THREE.Mesh[] = [];
  const counts: Record<string, number> = {};
  let slot = 0;
  for (const [tpl, { list, group: kind }] of byTemplate) {
    counts[kind] = (counts[kind] ?? 0) + list.length;
    const n = list.length;
    const uv = new Float32Array(n * 2);
    for (let i = 0; i < n; i++) {
      const s = slot++;
      const u = ((s % bakeWidth) + 0.5) / bakeWidth;
      const v = (Math.floor(s / bakeWidth) + 0.5) / bakeHeight;
      uv[i * 2] = u;
      uv[i * 2 + 1] = v;
      probeUv[s * 2] = u;
      probeUv[s * 2 + 1] = v;
      list[i].probe.toArray(probePos, s * 3);
      list[i].probeNormal.toArray(probeNor, s * 3);
    }
    const uvAttr = new THREE.InstancedBufferAttribute(uv, 2);

    const leaves = new THREE.InstancedMesh(tpl.foliage, leafMat.material, n);
    leaves.name = `vegetation-${kind}-leaves`;
    tpl.foliage.setAttribute('instanceBakeUv', uvAttr);
    for (let i = 0; i < n; i++) {
      leaves.setMatrixAt(i, list[i].matrix);
      leaves.setColorAt(i, list[i].color);
    }
    leaves.instanceMatrix.needsUpdate = true;
    if (leaves.instanceColor) leaves.instanceColor.needsUpdate = true;
    leaves.computeBoundingSphere();
    group.add(leaves);

    if (tpl.wood) {
      const wood = new THREE.InstancedMesh(tpl.wood, woodMat.material, n);
      wood.name = `vegetation-${kind}-wood`;
      tpl.wood.setAttribute('instanceBakeUv', uvAttr);
      wood.instanceMatrix = leaves.instanceMatrix;
      wood.computeBoundingSphere();
      group.add(wood);
    }
    if (tpl.proxy) {
      const proxy = new THREE.InstancedMesh(tpl.proxy, casterMaterial, n);
      proxy.instanceMatrix = leaves.instanceMatrix;
      proxy.computeBoundingSphere();
      casters.push(proxy);
    }
  }
  // 尾根の小道（森の中の白っぽい線）
  const trail = createTrail(island, cfg, config.pedestal.size);
  if (trail) group.add(trail);
  group.updateMatrixWorld(true);

  // 画角合わせ用：樹冠の上端（樹冠の上の調べる点）を使う。山頂の木が画面からはみ出さないように
  const outlinePoints = instances
    .filter((i) => i.group === 'trees' || i.group === 'shrubs')
    .map((i) => i.probe.clone());

  const pointsGeometry = new THREE.BufferGeometry();
  pointsGeometry.setAttribute('position', new THREE.BufferAttribute(probePos, 3));
  pointsGeometry.setAttribute('normal', new THREE.BufferAttribute(probeNor, 3));
  pointsGeometry.setAttribute('bakeUv', new THREE.BufferAttribute(probeUv, 2));
  timings.meshes = performance.now() - t0;

  return {
    group,
    casters,
    receiver: {
      target,
      geometry: pointsGeometry,
      matrixWorld: new THREE.Matrix4(),
      normalOffset: 0.02 * (config.pedestal.size / 10),
      channels: [true, true, true],
    },
    outlinePoints,
    counts,
    timings,
  };
}
