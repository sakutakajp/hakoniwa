import * as THREE from 'three';

export interface FramingOptions {
  /** 左右の余白（正方形〜横長の画面） */
  paddingX: number;
  /** 左右の余白（縦長のスマートフォン画面。縦横比 0.5 以下でこの値、1 に近づくほど paddingX） */
  paddingXNarrow: number;
  /** 上の余白（台座の奥の縁から画面の上端まで。島と木はこの中に入る） */
  paddingTop: number;
  /** 下の余白（土台の下端から画面の下端まで） */
  paddingBottom: number;
  /** 島と木の上端から画面の上端までの最小の余白 */
  minTop: number;
}

/** 方位角（+z から +x 方向へ）と仰角から、原点から見たその向きの単位ベクトル */
export function directionFromAngles(azimuthDeg: number, elevationDeg: number): THREE.Vector3 {
  const a = THREE.MathUtils.degToRad(azimuthDeg);
  const e = THREE.MathUtils.degToRad(elevationDeg);
  return new THREE.Vector3(Math.sin(a) * Math.cos(e), Math.sin(e), Math.cos(a) * Math.cos(e));
}

/**
 * カメラから見た点の範囲。画角や縦横比によらない値（カメラ座標の x / -z と y / -z）で持つ。
 * 画面上の位置（-1〜1）は、x / (tan(画角/2) × 縦横比)、y / tan(画角/2) で求まる
 */
export interface ViewBounds {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}

export const emptyBounds = (): ViewBounds => ({ minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity });

const tmp = new THREE.Vector3();

/** カメラの位置と向き（matrixWorldInverse）から、点の範囲を求めて out に広げる */
export function addViewBounds(view: THREE.Matrix4, points: readonly THREE.Vector3[], out: ViewBounds): ViewBounds {
  for (const p of points) {
    tmp.copy(p).applyMatrix4(view);
    const iz = -1 / Math.min(tmp.z, -1e-6);
    const x = tmp.x * iz;
    const y = tmp.y * iz;
    if (x < out.minX) out.minX = x;
    if (x > out.maxX) out.maxX = x;
    if (y < out.minY) out.minY = y;
    if (y > out.maxY) out.maxY = y;
  }
  return out;
}

/**
 * 画面への写し方：基準の画角での画面上の位置を s 倍して (dx, dy) だけずらす。
 * 画角で大きさを、レンズのずらし（setViewOffset）で位置を決める（カメラの位置と向きは変えない）
 */
export interface Fit {
  s: number;
  dx: number;
  dy: number;
}

/**
 * 台座の範囲（pedestal）が余白付きで収まり、島と木の範囲（extra）が上の余白の中に入る写し方を求める。
 * 島や木が画面の上端に近づきすぎるときだけ、台座の下の位置を保ったまま縮める。
 * 縦長の画面では、台座と島をまとめて画面の上下の中央に置く。
 */
export function fitBounds(
  pedestal: ViewBounds,
  extra: ViewBounds | null,
  aspect: number,
  framing: FramingOptions,
  baseFov: number,
): Fit {
  const t0 = Math.tan(THREE.MathUtils.degToRad(baseFov) / 2);
  const bx0 = pedestal.minX / (t0 * aspect);
  const bx1 = pedestal.maxX / (t0 * aspect);
  const by0 = pedestal.minY / t0;
  const by1 = pedestal.maxY / t0;
  const narrow = THREE.MathUtils.clamp((1 - aspect) / 0.5, 0, 1);
  const padX = THREE.MathUtils.lerp(framing.paddingX, framing.paddingXNarrow, narrow);
  const availW = Math.max(0.1, 2 - 4 * padX);
  const availH = Math.max(0.1, 2 - 2 * (framing.paddingTop + framing.paddingBottom));
  // 画角を変えると、画面上の位置は中心を基準に一様に拡大縮小する
  let s = Math.min(availW / Math.max(bx1 - bx0, 1e-6), availH / Math.max(by1 - by0, 1e-6));
  // 縦方向：台座の下端を下の余白の位置に、横方向：中央に
  const bottom = -1 + 2 * framing.paddingBottom;
  let dy = bottom - by0 * s;
  const ey1 = extra && Number.isFinite(extra.maxY) ? extra.maxY / t0 : -Infinity;
  // 島と木の上端が上の余白（最小）を越えるなら、台座の下端を保ったまま縮める
  const limit = 1 - 2 * framing.minTop;
  if (ey1 * s + dy > limit) {
    s = (limit - bottom) / Math.max(ey1 - by0, 1e-6);
    dy = bottom - by0 * s;
  }
  // 縦長の画面では、台座と島をまとめて画面の上下の中央に置く（上に大きな空きを作らない）
  if (narrow > 0) {
    const top = Math.max(ey1, by1);
    dy = THREE.MathUtils.lerp(dy, -((top + by0) / 2) * s, narrow);
  }
  const dx = -((bx0 + bx1) / 2) * s;
  return { s, dx, dy };
}

/** 写し方をカメラに設定する（画角とレンズのずらし） */
export function applyFit(camera: THREE.PerspectiveCamera, width: number, height: number, baseFov: number, fit: Fit): void {
  const t0 = Math.tan(THREE.MathUtils.degToRad(baseFov) / 2);
  camera.aspect = width / height;
  camera.fov = THREE.MathUtils.radToDeg(2 * Math.atan(t0 / fit.s));
  camera.setViewOffset(width, height, (-fit.dx * width) / 2, (fit.dy * height) / 2, width, height);
  camera.updateProjectionMatrix();
}

/**
 * 遠近カメラの画角と画面上の位置を合わせる（いまのカメラの位置と向きのまま）。
 * 台座（土台の底から水面までの外形）が余白付きで収まるように合わせ、島と木（extraPoints）は上の余白の中に入る。
 */
export function fitPerspectiveCamera(
  camera: THREE.PerspectiveCamera,
  points: THREE.Vector3[],
  width: number,
  height: number,
  framing: FramingOptions,
  baseFov: number,
  extraPoints: THREE.Vector3[] = [],
): void {
  camera.updateMatrixWorld();
  const view = camera.matrixWorldInverse;
  const b = addViewBounds(view, points, emptyBounds());
  const e = extraPoints.length > 0 ? addViewBounds(view, extraPoints, emptyBounds()) : null;
  applyFit(camera, width, height, baseFov, fitBounds(b, e, width / height, framing, baseFov));
}
