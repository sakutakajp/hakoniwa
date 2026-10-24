import * as THREE from 'three';
import type { SceneConfig } from '../config';
import type { PlanarBake } from '../bakedLighting';
import type { PointReceiver } from '../lightBaker';
import type { TownEnv } from './env';
import type { LightSource } from './localLight';
import type { Streets } from './streets';
import { FaceAtlas } from './atlas';
import { createBuildingShells } from './buildings';
import { MASSES } from './layout';
import { FIRE_ESCAPES, SIGNS, WALL_UNITS } from './features';
import { createFacadeProps } from './facadeProps';
import { createSigns } from './signs';
import { ProbeSet } from './propKit';
import { createRooftops } from './rooftops';
import { createStreet } from './street';
import { createPeople } from './people';
import { createVehicles } from './vehicles';

/** 街の中身（建物・看板・街灯・木・人・車）をまとめたもの */
export interface Town {
  group: THREE.Group;
  /** 影を落とす形 */
  casters: THREE.Mesh[];
  /** 焼き込みの受け手（建物の壁の光の地図、小物の点） */
  receivers: PointReceiver[];
  /** 構図合わせ用の上端の点 */
  outlinePoints: THREE.Vector3[];
  /** 街の明かりの光源 */
  lights: LightSource[];
  counts: Record<string, number>;
  /** 地面の焼き込み（小物の足もとの影を読むため） */
  setGroundBake: (bake: PlanarBake) => void;
}

export function createTown(
  renderer: THREE.WebGLRenderer,
  config: SceneConfig,
  streets: Streets,
  env: TownEnv,
  opts: { lowPower: boolean; debug?: string | null },
): Town {
  const group = new THREE.Group();
  group.name = 'town';
  const casters: THREE.Mesh[] = [];
  const receivers: PointReceiver[] = [];
  const outlinePoints: THREE.Vector3[] = [];
  const lights: LightSource[] = [];
  const counts: Record<string, number> = {};

  // --- 建物の外壁と屋上（光の地図に焼き込む）
  const atlas = new FaceAtlas(opts.lowPower ? 512 : 1024);
  const shells = createBuildingShells(config, env, MASSES, atlas);
  atlas.pack(opts.lowPower ? 0.07 : 0.035);
  const built = shells.finish(opts.debug === 'mass');
  const bake = atlas.receiver(renderer, 0.012);
  built.setAtlas(bake.texture);
  group.add(built.mesh);
  casters.push(built.caster);
  receivers.push(bake.receiver);
  outlinePoints.push(...built.topPoints);
  counts.masses = MASSES.length;
  counts.atlasFaces = atlas.count;
  counts.atlasTexel = Math.round(atlas.texel * 1000);

  // --- 看板
  const signs = createSigns(config, env, MASSES, SIGNS, opts);
  group.add(signs.mesh);
  lights.push(...signs.lights);
  counts.signs = SIGNS.length;

  // --- 屋上の物（室外機・アンテナ・手すり・鉄塔など）
  const probes = new ProbeSet();
  const roofs = createRooftops(config, env, probes, built, MASSES);
  group.add(roofs.group);
  casters.push(...roofs.casters);
  outlinePoints.push(...roofs.topPoints);
  Object.assign(counts, roofs.counts);

  // --- 外壁の物（非常階段・壁の室外機）
  const fprops = createFacadeProps(config, env, probes, MASSES, FIRE_ESCAPES, WALL_UNITS);
  group.add(fprops.group);
  casters.push(...fprops.casters);
  Object.assign(counts, fprops.counts);

  // --- 通りの物（日よけ・商品の棚・街灯・街路樹・電柱・車止め…）
  const street = createStreet(config, env, probes, MASSES, streets, opts);
  group.add(street.group);
  casters.push(...street.casters);
  outlinePoints.push(...street.topPoints);
  lights.push(...street.lights);
  Object.assign(counts, street.counts);

  // --- 人と車
  const people = createPeople(config, env, probes, streets, MASSES, { count: opts.lowPower ? 80 : 95 });
  group.add(people.group);
  casters.push(...people.casters);
  counts.people = people.count;
  const vehicles = createVehicles(config, env, probes);
  group.add(vehicles.group);
  casters.push(...vehicles.casters);
  lights.push(...vehicles.lights);

  // 小物の焼き込みの点（すべての小物を置いた後に）
  receivers.push(probes.receiver(renderer, 0.03));
  counts.probes = probes.count;

  return {
    group,
    casters,
    receivers,
    outlinePoints,
    lights,
    counts,
    setGroundBake: () => {},
  };
}
