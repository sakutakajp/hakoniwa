import * as THREE from 'three';
import type { SceneConfig } from '../config';
import { buildIslandMesh, type IslandMeshData } from './buildGeometry';
import { createRockMaterial } from './rockMaterial';
import { IslandShape, type IslandFrame } from './shape';

export type { IslandShape };
import { createBakeTarget, type PointReceiver } from '../lightBaker';

export interface Island {
  /** 島全体をまとめたグループ（シーンに追加する） */
  group: THREE.Group;
  mesh: THREE.Mesh;
  /** 影の焼き込みで使う、島の頂点の受け手 */
  bakeReceiver: PointReceiver;
  /** カメラの画角合わせ用の点（島の外形の上端） */
  outlinePoints: THREE.Vector3[];
  /** メッシュと形の情報（植生と岩の配置に使う） */
  data: IslandMeshData;
  timings: Record<string, number>;
}

/**
 * 島（崖と尾根）を作る。形状は距離場から生成した1枚の閉じたメッシュで、
 * 外形・高さ・凹凸・色は config.island で調整する。
 */
/** 島の形の定義（足もとの外形・高さ・崖らしさ）。海底の形を決めるのにも使うので、メッシュより先に作る */
export function createIslandShape(config: SceneConfig, frame: IslandFrame): IslandShape {
  return new IslandShape(config.island, frame);
}

export function createIsland(
  renderer: THREE.WebGLRenderer,
  config: SceneConfig,
  shape: IslandShape,
  opts: {
    voxelScale: number;
    groundY: (x: number, z: number) => number;
    waterLevel: number;
    /** 海底と砂浜の高さのテクスチャ（水の中の土台の根元に砂をかけるのに使う） */
    ground?: { texture: THREE.Texture; size: number };
  },
): Island {
  const cfg = config.island;
  const W = config.pedestal.size;
  let t0 = performance.now();
  const data = buildIslandMesh(shape, {
    step: cfg.voxelSize * W * opts.voxelScale,
    aoDistance: cfg.ao.distance * W,
    aoStrength: cfg.ao.strength,
    groundY: opts.groundY,
  });

  const geometry = new THREE.BufferGeometry();
  const position = new THREE.BufferAttribute(data.positions, 3);
  const normal = new THREE.BufferAttribute(data.normals, 3);
  const bakeUv = new THREE.BufferAttribute(data.bakeUv, 2);
  geometry.setAttribute('position', position);
  geometry.setAttribute('normal', normal);
  geometry.setAttribute('bakeUv', bakeUv);
  geometry.setAttribute('rockAo', new THREE.BufferAttribute(data.ao, 1));
  // 森の地面にしてよい所（水際の岩壁より上の斜面と上面）。入り江側の崖の面は岩のまま
  {
    const n = data.positions.length / 3;
    const cover = new Float32Array(n);
    const band = 0.012 * W;
    const c0 = cfg.slope.cliffFraction;
    for (let i = 0; i < n; i++) {
      const x = data.positions[i * 3];
      const y = data.positions[i * 3 + 1] - opts.waterLevel;
      const z = data.positions[i * 3 + 2];
      const H = Math.max(shape.heightAt(x, z), 0.05);
      const cliff = THREE.MathUtils.clamp(shape.cliffAt(x, z), 0, 1);
      const wallTop = (c0 + (1 - c0) * cliff) * H;
      cover[i] = THREE.MathUtils.smoothstep(y, wallTop - band, wallTop + band);
    }
    geometry.setAttribute('aCover', new THREE.BufferAttribute(cover, 1));
  }
  geometry.setIndex(new THREE.BufferAttribute(data.indices, 1));
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();

  t0 = performance.now();
  const rock = createRockMaterial({
    colors: cfg.colors,
    roughness: cfg.roughness,
    surface: cfg.surface,
    aoMin: cfg.ao.min,
    shadeTint: cfg.shadeTint,
    shadowStrength: config.shadow.strength,
    unit: W / 10,
    seed: cfg.seed,
    variant: {
      // 水の中の部分は藻の色に寄せる
      underwater: { level: opts.waterLevel, color: config.sea.algae.color, amount: config.sea.algae.amount },
      // 水の中の部分（島の土台）に印を付け、水の側面からガラス越しに見えるときは水の色に沈める
      waterMask: true,
      // 水の中の土台の根元には海底の砂がかかる（海底となじませ、根元が暗い塊に見えないように）
      sandLine: opts.ground
        ? {
            texture: opts.ground.texture,
            size: opts.ground.size,
            color: config.rocks.sandLine.color,
            height: cfg.underwater.sand.height * W,
            strength: cfg.underwater.sand.strength,
            underwaterOnly: true,
          }
        : undefined,
      groundCover: {
        color: cfg.groundCover.color,
        minY: opts.waterLevel + cfg.groundCover.minHeight * W,
        slope: cfg.groundCover.slope,
        amount: config.vegetation.enabled ? cfg.groundCover.amount : 0,
      },
    },
  });

  const mesh = new THREE.Mesh(geometry, rock.material);
  mesh.name = 'island-rock';

  const group = new THREE.Group();
  group.name = 'island';
  group.add(mesh);
  group.updateMatrixWorld(true);

  // 焼き込み先：各頂点に1テクセル。焼き込み後にマテリアルへ渡す
  const target = createBakeTarget(renderer, data.bakeWidth, data.bakeHeight);
  target.texture.minFilter = THREE.NearestFilter;
  target.texture.magFilter = THREE.NearestFilter;
  rock.setBake(target.texture);
  const pointsGeometry = new THREE.BufferGeometry();
  pointsGeometry.setAttribute('position', position);
  pointsGeometry.setAttribute('normal', normal);
  pointsGeometry.setAttribute('bakeUv', bakeUv);

  // 画角合わせ用：水平方向の小さな区画ごとに一番高い頂点（尾根を取りこぼさない）
  const outlinePoints: THREE.Vector3[] = [];
  const count = data.positions.length / 3;
  const cell = 0.02 * W;
  const highest = new Map<number, number>();
  for (let i = 0; i < count; i++) {
    const key = Math.floor(data.positions[i * 3] / cell) * 4096 + Math.floor(data.positions[i * 3 + 2] / cell);
    const j = highest.get(key);
    if (j === undefined || data.positions[i * 3 + 1] > data.positions[j * 3 + 1]) highest.set(key, i);
  }
  for (const i of highest.values()) {
    outlinePoints.push(new THREE.Vector3(data.positions[i * 3], data.positions[i * 3 + 1], data.positions[i * 3 + 2]));
  }
  data.timings.material = performance.now() - t0;

  return {
    group,
    mesh,
    bakeReceiver: {
      target,
      geometry: pointsGeometry,
      matrixWorld: mesh.matrixWorld,
      normalOffset: 0.035 * (W / 10),
      // 岩肌の空からの遮蔽は形状から求めた AO を使うので、主光と補助光だけ
      channels: [true, false, true],
    },
    outlinePoints,
    data,
    timings: data.timings,
  };
}
