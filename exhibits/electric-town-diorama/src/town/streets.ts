import type { SceneConfig } from '../config';
import {
  clipHalfPlane,
  filletArc,
  insidePolygon,
  line,
  lineCoords,
  lineInside,
  onLine,
  resample,
  roundedSquare,
  splitPolygon,
  type Line2,
  type P2,
} from './geometry2d';

/**
 * 通りの形：路面の塊の上面を、車道と歩道に分ける。
 *  - 縁石の線：左の通りの線 → 角の円弧 → 右の通りの線（左から右へ）。この線の奥（左の法線の側）が街区の歩道
 *  - 車道：左右の通りとも、縁石から一定の幅（config.town.road.width）。その先（手前）は向かいの街区の歩道で、台座の縁で切れる
 * 多角形は上から見た [x, z] の点の列
 */
export interface Streets {
  half: number;
  radius: number;
  /** 台座の外周 */
  outline: P2[];
  /** 縁石の線（台座の外まで延ばした折れ線、左から右へ） */
  curbLine: P2[];
  /** 台座の内側の縁石の線（外周との交点から交点まで） */
  curbInside: P2[];
  /** 向かいの歩道の縁石（左の通り・右の通り。台座の内側、なければ空） */
  nearLeft: P2[];
  nearRight: P2[];
  /** 街区（歩道の高さ）・向かいの歩道（左手前・右手前）・車道の多角形 */
  block: P2[];
  farLeft: P2[];
  farRight: P2[];
  road: P2[];
  /** 縁石の線（左の通り・右の通り） */
  left: Line2;
  right: Line2;
  /** 車道の幅 */
  width: number;
  /** 左右の通りの縁石からの距離（車道の側が正） */
  dLeft: (p: P2) => number;
  dRight: (p: P2) => number;
  /** その場所が歩道の高さか（街区・向かいの歩道） */
  raised: (x: number, z: number) => boolean;
  /** 地面の高さ（車道は ground、歩道は ground + curb） */
  heightAt: (x: number, z: number) => number;
}

export function createStreets(config: SceneConfig): Streets {
  const t = config.town;
  const half = config.pedestal.size / 2;
  const radius = config.pedestal.cornerRadius;
  const outline = roundedSquare(half, radius, 20);
  const left = line(t.curbLeft.point, t.curbLeft.dir);
  const right = line(t.curbRight.point, t.curbRight.dir);
  const W = t.road.width;
  // 縁石の折れ線：左の線の遠い所 → 角の円弧 → 右の線の遠い所
  const arc = filletArc(left, right, t.cornerRadius, 12);
  const [sa] = lineCoords(left, arc[0]);
  const [sb] = lineCoords(right, arc[arc.length - 1]);
  const curbLine: P2[] = [onLine(left, sa - 14), ...arc, onLine(right, sb + 14)];
  const split = splitPolygon(outline, resample(curbLine, 0.05));
  // 街区は縁石の線の左（奥）、残りが車道と向かいの歩道
  const block = split.a;
  const lower = split.b;
  // 車道の側への距離（縁石の線の法線 n は奥向きなので、車道の側は -n）
  const dLeft = (p: P2) => -lineCoords(left, p)[1];
  const dRight = (p: P2) => -lineCoords(right, p)[1];
  // 車道：両方の通りとも縁石から W 以内（向かいの縁石の線の手前）
  const road = clipHalfPlane(clipHalfPlane(lower, (p) => dLeft(p) - W), (p) => dRight(p) - W);
  // 向かいの歩道：左手前と右手前（それぞれ片方の通りの向こう側）
  const farLeft = clipHalfPlane(lower, (p) => W - dLeft(p));
  const farRight = clipHalfPlane(lower, (p) => W - dRight(p));
  // 向かいの縁石の線（台座の内側の区間）
  const nearSegment = (l: Line2): P2[] => {
    const span = lineInside(l, outline, -W);
    if (!span) return [];
    const pts: P2[] = [];
    const k = Math.max(2, Math.ceil((span[1] - span[0]) / 0.1));
    for (let i = 0; i <= k; i++) pts.push(onLine(l, span[0] + ((span[1] - span[0]) * i) / k, -W));
    return pts;
  };
  const clipNear = (pts: P2[], other: (p: P2) => number) => pts.filter((p) => other(p) <= W + 1e-6);
  // 左の向かいの縁石は、右の通りの車道の中までは続かない（交差点）
  const nearLeft = clipNear(nearSegment(left), dRight);
  const nearRight = clipNear(nearSegment(right), dLeft);
  const curb = t.curb;
  const inFar = (x: number, z: number) =>
    (farLeft.length > 2 && insidePolygon(x, z, farLeft)) || (farRight.length > 2 && insidePolygon(x, z, farRight));
  const raised = (x: number, z: number) => insidePolygon(x, z, block) || inFar(x, z);
  return {
    half,
    radius,
    outline,
    curbLine,
    curbInside: split.cutInside,
    nearLeft,
    nearRight,
    block,
    farLeft,
    farRight,
    road,
    left,
    right,
    width: W,
    dLeft,
    dRight,
    raised,
    heightAt: (x, z) => t.ground + (raised(x, z) ? curb : 0),
  };
}
