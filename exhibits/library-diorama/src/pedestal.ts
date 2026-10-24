import * as THREE from 'three';
import { bakedVisibilityFunctions, lightsBeginWithBakedVisibility } from './bakedLighting';

interface ProfilePoint {
  /** 外周線からの外向きオフセット（負なら内側） */
  o: number;
  y: number;
  /** 断面上の法線（外向き成分, 上向き成分） */
  no: number;
  ny: number;
}

/** 側面の断面：上縁フィレット → 垂直な側面 → 下縁フィレット */
function edgeProfile(t: number, rTop: number, rBottom: number, segments: number): ProfilePoint[] {
  const prof: ProfilePoint[] = [];
  for (let i = 0; i <= segments; i++) {
    const th = (Math.PI / 2) * (1 - i / segments);
    prof.push({
      o: -rTop + rTop * Math.cos(th),
      y: t - rTop + rTop * Math.sin(th),
      no: Math.cos(th),
      ny: Math.sin(th),
    });
  }
  for (let i = 0; i <= segments; i++) {
    const th = -(Math.PI / 2) * (i / segments);
    prof.push({
      o: -rBottom + rBottom * Math.cos(th),
      y: rBottom + rBottom * Math.sin(th),
      no: Math.cos(th),
      ny: Math.sin(th),
    });
  }
  return prof;
}

/**
 * 縁に丸みのある薄い板（シリーズの台座の土台）。外形は角丸の長方形（outline：上から見た外周の点と外向きの法線）。
 * グループ0 = 上面、グループ1 = 側面と底面。
 */
export function createPlateGeometry(
  outline: { x: number; z: number; nx: number; nz: number }[],
  p: { thickness: number; topEdgeRadius: number; bottomEdgeRadius: number; edgeSegments: number },
): THREE.BufferGeometry {
  const profile = edgeProfile(p.thickness, p.topEdgeRadius, p.bottomEdgeRadius, p.edgeSegments);
  const positions: number[] = [];
  const normals: number[] = [];
  const topIndices: number[] = [];
  const sideIndices: number[] = [];
  const push = (x: number, y: number, z: number, nx: number, ny: number, nz: number) => {
    positions.push(x, y, z);
    normals.push(nx, ny, nz);
    return positions.length / 3 - 1;
  };
  const topCenter = push(0, p.thickness, 0, 0, 1, 0);
  const topRing = outline.map((q) => push(q.x - q.nx * p.topEdgeRadius, p.thickness, q.z - q.nz * p.topEdgeRadius, 0, 1, 0));
  for (let i = 0; i < topRing.length; i++) topIndices.push(topCenter, topRing[(i + 1) % topRing.length], topRing[i]);
  const rows = profile.length;
  const ring: number[][] = outline.map((q) => profile.map((s) => push(q.x + q.nx * s.o, s.y, q.z + q.nz * s.o, q.nx * s.no, s.ny, q.nz * s.no)));
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i];
    const b = ring[(i + 1) % ring.length];
    for (let j = 0; j < rows - 1; j++) sideIndices.push(a[j], b[j], b[j + 1], a[j], b[j + 1], a[j + 1]);
  }
  const bottomCenter = push(0, 0, 0, 0, -1, 0);
  const bottomRing = outline.map((q) => push(q.x - q.nx * p.bottomEdgeRadius, 0, q.z - q.nz * p.bottomEdgeRadius, 0, -1, 0));
  for (let i = 0; i < bottomRing.length; i++) sideIndices.push(bottomCenter, bottomRing[i], bottomRing[(i + 1) % bottomRing.length]);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  geometry.setIndex([...topIndices, ...sideIndices]);
  geometry.addGroup(0, topIndices.length, 0);
  geometry.addGroup(topIndices.length, sideIndices.length, 1);
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return geometry;
}

/**
 * 側面のマテリアル。床に近いほど環境光が遮られる分だけわずかに暗くする（簡易AO）。
 * 窓の日差し（3 つ目の平行光）は部屋の中だけの光なので、土台には当てない
 */
export function createSideMaterial(opts: {
  color: THREE.ColorRepresentation;
  roughness: number;
  thickness: number;
  bottomOcclusion: number;
  /** 台座の底の高さ（床の高さ。海の分だけ下げたときに使う） */
  baseY?: number;
}): THREE.MeshStandardMaterial {
  const material = new THREE.MeshStandardMaterial({
    color: opts.color,
    roughness: opts.roughness,
    metalness: 0,
  });
  const uniforms = {
    uDirMask: { value: new THREE.Vector3(1, 1, 0) },
    uSideHeight: { value: opts.thickness },
    uSideBottomOcclusion: { value: opts.bottomOcclusion },
    uSideBase: { value: opts.baseY ?? 0 },
  };
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying float vSideHeight;')
      .replace(
        '#include <project_vertex>',
        '#include <project_vertex>\nvSideHeight = ( modelMatrix * vec4( transformed, 1.0 ) ).y;',
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>\nuniform float uSideHeight;\nuniform float uSideBottomOcclusion;\nuniform float uSideBase;\nvarying float vSideHeight;\n${bakedVisibilityFunctions()}`,
      )
      .replace(
        '#include <lights_fragment_begin>',
        `gBakedVis = vec3( 1.0, 1.0, 0.0 );
${lightsBeginWithBakedVisibility()}`,
      )
      .replace(
        '#include <lights_fragment_end>',
        `#include <lights_fragment_end>
reflectedLight.indirectDiffuse *= 1.0 - uSideBottomOcclusion * ( 1.0 - smoothstep( 0.0, uSideHeight, vSideHeight - uSideBase ) );`,
      );
  };
  material.customProgramCacheKey = () => 'pedestal-side';
  return material;
}
