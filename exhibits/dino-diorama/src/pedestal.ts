import * as THREE from 'three';

export interface PedestalShape {
  size: number;
  thickness: number;
  cornerRadius: number;
  topEdgeRadius: number;
  bottomEdgeRadius: number;
  cornerSegments: number;
  edgeSegments: number;
}

interface OutlinePoint {
  x: number;
  z: number;
  nx: number;
  nz: number;
}

interface ProfilePoint {
  /** 外周線からの外向きオフセット（負なら内側） */
  o: number;
  y: number;
  /** 断面上の法線（外向き成分, 上向き成分） */
  no: number;
  ny: number;
}

/** 角丸正方形の外周（上から見て時計回り）。直線部は角丸の端点同士を結ぶ。 */
function roundedSquareOutline(half: number, radius: number, segments: number): OutlinePoint[] {
  const c = half - radius;
  const corners = [
    { cx: c, cz: c, start: 0 },
    { cx: -c, cz: c, start: 90 },
    { cx: -c, cz: -c, start: 180 },
    { cx: c, cz: -c, start: 270 },
  ];
  const pts: OutlinePoint[] = [];
  for (const k of corners) {
    for (let i = 0; i <= segments; i++) {
      const a = THREE.MathUtils.degToRad(k.start + (90 * i) / segments);
      const nx = Math.cos(a);
      const nz = Math.sin(a);
      pts.push({ x: k.cx + radius * nx, z: k.cz + radius * nz, nx, nz });
    }
  }
  return pts;
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
 * 縁に丸みのある薄い角丸正方形の台座。
 * グループ0 = 上面（砂）、グループ1 = 側面と底面。
 * UV は上から見た平面投影（u: +x 方向, v: -z 方向）で、上面全体が 0..1 に収まる。
 */
export function createPedestalGeometry(p: PedestalShape): THREE.BufferGeometry {
  const half = p.size / 2;
  const outline = roundedSquareOutline(half, p.cornerRadius, p.cornerSegments);
  const profile = edgeProfile(p.thickness, p.topEdgeRadius, p.bottomEdgeRadius, p.edgeSegments);

  const positions: number[] = [];
  const normals: number[] = [];
  const uvs: number[] = [];
  const topIndices: number[] = [];
  const sideIndices: number[] = [];

  const push = (x: number, y: number, z: number, nx: number, ny: number, nz: number) => {
    positions.push(x, y, z);
    normals.push(nx, ny, nz);
    uvs.push(x / p.size + 0.5, 0.5 - z / p.size);
    return positions.length / 3 - 1;
  };

  // 上面：中心からの扇形（凸形状なのでこれで十分）
  const topCenter = push(0, p.thickness, 0, 0, 1, 0);
  const topRing = outline.map((q) =>
    push(q.x - q.nx * p.topEdgeRadius, p.thickness, q.z - q.nz * p.topEdgeRadius, 0, 1, 0),
  );
  for (let i = 0; i < topRing.length; i++) {
    const a = topRing[i];
    const b = topRing[(i + 1) % topRing.length];
    topIndices.push(topCenter, b, a);
  }

  // 側面：外周 × 断面のスイープ（法線は解析的に与えるので継ぎ目なく滑らか）
  const rows = profile.length;
  const ring: number[][] = outline.map((q) =>
    profile.map((s) =>
      push(q.x + q.nx * s.o, s.y, q.z + q.nz * s.o, q.nx * s.no, s.ny, q.nz * s.no),
    ),
  );
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i];
    const b = ring[(i + 1) % ring.length];
    for (let j = 0; j < rows - 1; j++) {
      sideIndices.push(a[j], b[j], b[j + 1], a[j], b[j + 1], a[j + 1]);
    }
  }

  // 底面
  const bottomCenter = push(0, 0, 0, 0, -1, 0);
  const bottomRing = outline.map((q) =>
    push(q.x - q.nx * p.bottomEdgeRadius, 0, q.z - q.nz * p.bottomEdgeRadius, 0, -1, 0),
  );
  for (let i = 0; i < bottomRing.length; i++) {
    const a = bottomRing[i];
    const b = bottomRing[(i + 1) % bottomRing.length];
    sideIndices.push(bottomCenter, a, b);
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex([...topIndices, ...sideIndices]);
  geometry.addGroup(0, topIndices.length, 0);
  geometry.addGroup(topIndices.length, sideIndices.length, 1);
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return geometry;
}

/**
 * 側面のマテリアル。床に近いほど環境光が遮られる分だけわずかに暗くする（簡易AO）。
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
        '#include <common>\nuniform float uSideHeight;\nuniform float uSideBottomOcclusion;\nuniform float uSideBase;\nvarying float vSideHeight;',
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

/**
 * カメラの画角合わせ用：角丸正方形の外周を、指定した高さごとに並べた点群
 * （土台の底と上面、水面など）。
 */
export function outlinePointsAt(half: number, radius: number, ys: number[], segments = 24): THREE.Vector3[] {
  const outline = roundedSquareOutline(half, radius, segments);
  const pts: THREE.Vector3[] = [];
  for (const q of outline) for (const y of ys) pts.push(new THREE.Vector3(q.x, y, q.z));
  return pts;
}
