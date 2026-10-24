import * as THREE from 'three';
import type { SceneConfig } from './config';

export interface DinoSpotAreas {
  /** 植物を置かない所（体の下） */
  footprints: { x: number; z: number; r: number }[];
  /** 木を置かない所（尾の先から頭の先まで。樹冠が体に重ならないように） */
  treeClear: { x: number; z: number; r: number }[];
  /** 画角合わせ用の点（頭や背中の高さ。恐竜を置いても画面からはみ出さないように） */
  outlinePoints: THREE.Vector3[];
}

/**
 * 恐竜を置く場所（設定の dinoSpots）から、植物を置かない範囲と画角合わせ用の点を作る。
 * 恐竜そのものは作らない（別に用意する 3D モデルを置く）
 */
export function dinoSpotAreas(config: SceneConfig): DinoSpotAreas {
  const footprints: DinoSpotAreas['footprints'] = [];
  const treeClear: DinoSpotAreas['treeClear'] = [];
  const outlinePoints: THREE.Vector3[] = [];
  for (const spot of config.dinoSpots) {
    const h = THREE.MathUtils.degToRad(spot.heading);
    const fwd = new THREE.Vector2(Math.cos(h), Math.sin(h));
    const center = new THREE.Vector2(spot.x, spot.z);
    const tail = center.clone().addScaledVector(fwd, -spot.back);
    // 頭の先：水を飲む恐竜は口元へ（首が体の向きから少しそれる）
    const head = spot.mouth ? new THREE.Vector2(spot.mouth[0], spot.mouth[2]) : center.clone().addScaledVector(fwd, spot.front);
    // 体の線（尾の先 → 体の中心 → 頭の先）に沿って、木を置かない円を並べる
    for (const [a, b] of [[tail, center], [center, head]] as [THREE.Vector2, THREE.Vector2][]) {
      const len = a.distanceTo(b);
      const n = Math.max(1, Math.ceil(len / 0.35));
      for (let i = 0; i <= n; i++) {
        const p = a.clone().lerp(b, i / n);
        treeClear.push({ x: p.x, z: p.y, r: spot.radius });
      }
    }
    // 体の下（胴の長さほど）
    for (const t of [-1, 0, 1]) {
      const p = center.clone().addScaledVector(fwd, t * spot.radius * 0.7);
      footprints.push({ x: p.x, z: p.y, r: spot.radius * 0.6 });
    }
    outlinePoints.push(
      new THREE.Vector3(head.x, spot.ground + (spot.mouth ? spot.mouth[1] - spot.ground : spot.height), head.y),
      new THREE.Vector3(spot.x, spot.ground + spot.height * (spot.mouth ? 1 : 0.7), spot.z),
    );
  }
  return { footprints, treeClear, outlinePoints };
}
