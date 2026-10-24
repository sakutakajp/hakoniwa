import * as THREE from 'three';
import { Noise, mulberry32 } from '../noise';
import type { SceneConfig } from '../config';
import type { IslandMeshData } from '../island/buildGeometry';
import { roundedSquareInside } from '../island/shape';
import type { RockLibrary, RockTemplate } from './templates';

export type RocksConfig = SceneConfig['rocks'];
export type RockClass = 'major' | 'coral' | 'small' | 'gravel';

export interface RockInstance {
  cls: RockClass;
  /** ひな形（major と coral は large、small は small、gravel は gravel の中の番号） */
  index: number;
  matrix: THREE.Matrix4;
  /** 色（岩の色に掛ける） */
  tint: THREE.Color;
  moss: number;
  /** 中心（水平位置）と横幅の半分、上端の高さ */
  x: number;
  z: number;
  radius: number;
  top: number;
}

const smoothstep = (a: number, b: number, v: number) => {
  const t = THREE.MathUtils.clamp((v - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};

/** 平面上の円の重なりを調べる格子 */
class DiskHash {
  private readonly cells = new Map<number, { x: number; z: number; r: number }[]>();
  constructor(private readonly cell: number) {}
  private key(ix: number, iz: number) {
    return ix * 73856093 + iz * 19349663;
  }
  add(x: number, z: number, r: number) {
    const k = this.key(Math.floor(x / this.cell), Math.floor(z / this.cell));
    const list = this.cells.get(k);
    if (list) list.push({ x, z, r });
    else this.cells.set(k, [{ x, z, r }]);
  }
  free(x: number, z: number, r: number, factor: number, reach: number) {
    const ix = Math.floor(x / this.cell);
    const iz = Math.floor(z / this.cell);
    const span = Math.ceil(reach / this.cell);
    for (let a = -span; a <= span; a++) {
      for (let b = -span; b <= span; b++) {
        const list = this.cells.get(this.key(ix + a, iz + b));
        if (!list) continue;
        for (const o of list) if (Math.hypot(o.x - x, o.z - z) < (o.r + r) * factor) return false;
      }
    }
    return true;
  }
}

export interface RockLayout {
  instances: RockInstance[];
  /** 小石・砂利の密度（0〜1 程度）。地表の砂利の模様にも使う */
  density: (x: number, z: number) => number;
}

/**
 * 岩を配置する。
 *  1. 水際の岩：設定で位置・大きさ・形・向き・苔を指定（深くめり込む組は離し、島に近すぎるときは少しずらす）
 *  2. 海底の緑の岩：設定で指定したものと、浅瀬に自動で散らすもの（島や砂浜から離し、互いに重ならない）
 *  3. 小石・砂利：崖のふもと・洞窟の入口・群落・岩の周りで密度が高い密度場に従って散らす
 * 岩の底は地面（砂浜・海底）に少し埋め（傾けた岩も底の縁が浮かない深さまで）、乱数はシード固定。
 */
export function placeRocks(
  cfg: RocksConfig,
  pedestal: { size: number; cornerRadius: number },
  island: IslandMeshData | null,
  lib: RockLibrary,
  /** 地面（砂浜・海底）の高さ */
  groundIn: (x: number, z: number) => number,
  /** 水面の高さと、深場らしさ（緑の岩の散らし方に使う） */
  water: { level: number; deepAt: (x: number, z: number) => number; beachAt: (x: number, z: number) => number },
): RockLayout {
  const W = pedestal.size;
  const u = W / 10;
  const rnd = mulberry32(cfg.seed);
  const noise = new Noise(cfg.seed * 13 + 5);
  const F = island?.sampleField ?? (() => -1);
  // 地面：海底と砂浜に加えて、水の中の島の岩（崖のふもとの浅い岩棚）の上面
  const seabed = groundIn;
  const islandTop = (x: number, z: number) => {
    const step = 0.004 * W;
    let y = water.level + 0.03 * W;
    if (F(x, y, z) > 0) return y;
    for (let i = 0; i < 60; i++) {
      const y2 = y - step;
      if (F(x, y2, z) > 0) {
        // 境目を二分法で詰める
        let lo = y2;
        let hi = y;
        for (let k = 0; k < 6; k++) {
          const mid = (lo + hi) / 2;
          if (F(x, mid, z) > 0) lo = mid;
          else hi = mid;
        }
        return lo;
      }
      y = y2;
    }
    return -Infinity;
  };
  const groundCache = new Map<number, number>();
  const ground = (x: number, z: number) => {
    const key = Math.round(x / (0.002 * W)) * 100003 + Math.round(z / (0.002 * W));
    let g = groundCache.get(key);
    if (g === undefined) {
      g = Math.max(seabed(x, z), island ? islandTop(x, z) : -Infinity);
      groundCache.set(key, g);
    }
    return g;
  };
  const shape = island?.shape ?? null;
  const half = pedestal.size / 2;
  /** 台座の縁から離す距離（土台は水の塊より 0.012W 内側にある） */
  const edgeMargin = Math.max(0.06 * u, 0.017 * W);
  const out: RockInstance[] = [];

  // --- 色：場所ごとの大きなまとまり＋岩ごとのばらつき
  const beige = new THREE.Color(cfg.tints.beige);
  const gray = new THREE.Color(cfg.tints.grayBrown);
  const brown = new THREE.Color(cfg.tints.lightBrown);
  const tintAt = (x: number, z: number) => {
    const n1 = noise.fbm2(x / (0.9 * u) + 2.1, z / (0.9 * u) - 7.3, 2);
    const n2 = noise.fbm2(x / (0.6 * u) - 4.4, z / (0.6 * u) + 1.9, 2);
    const c = beige.clone().lerp(gray, smoothstep(-0.35, 0.45, n1 + (rnd() - 0.5) * 0.5));
    c.lerp(brown, 0.6 * smoothstep(0.0, 0.5, n2 + (rnd() - 0.5) * 0.4));
    return c.multiplyScalar(0.94 + 0.12 * rnd());
  };
  const coralTint = () => new THREE.Color(1, 1, 1).multiplyScalar(0.85 + 0.3 * rnd());

  /** 島の足もとからの距離（海の側で正。島がなければ大きな値） */
  const shoreDist = (x: number, z: number) => (shape ? -shape.footprintAt(x, z) : 99);

  /**
   * 島の崖の真下か（水面の高さに島の岩がある）。台座の縁では、水の中の島の土台を縁から離してあるので、
   * 崖の下に水と海底の砂の隙間ができる。そこは光が届かず、置いた岩が黒い塊に見えるので置かない
   */
  const underCliff = (x: number, z: number) => F(x, water.level + 0.004 * W, z) > 0;
  /** 岩を置ける場所か：台座の上（端から離す）で、島の岩の中や張り出しの下に入らない */
  const canPlace = (x: number, z: number, r: number, h: number) => {
    // 土台（水の塊より少し内側）の外へはみ出さない（深く埋めた岩の底が、水の塊の下からのぞかないように）
    if (roundedSquareInside(x, z, half, pedestal.cornerRadius) < r + edgeMargin) return false;
    if (underCliff(x, z)) return false;
    const g = ground(x, z);
    for (const yy of [0.3, 0.7]) if (F(x, g + h * yy, z) > -r * 0.2) return false;
    // 洞窟の奥や崖の大きな張り出しの真下には置かない（光が届かず、黒っぽい塊に見えるため）
    for (const yy of [1.3, 1.9]) if (F(x, g + yy * u, z) > 0.01 * W) return false;
    return true;
  };

  const tmpQ = new THREE.Quaternion();
  const tilt = new THREE.Quaternion();
  const up = new THREE.Vector3(0, 1, 0);
  /** ひな形の底の縁（砂に埋まる部分の外周）の点 */
  const bottomRings = new Map<RockTemplate, THREE.Vector3[]>();
  const bottomRing = (tpl: RockTemplate) => {
    let ring = bottomRings.get(tpl);
    if (!ring) {
      ring = [];
      const P = tpl.geometry.attributes.position;
      const limit = tpl.height * 0.06;
      for (let i = 0; i < P.count; i++) {
        if (P.getY(i) < limit) ring.push(new THREE.Vector3().fromBufferAttribute(P, i));
      }
      bottomRings.set(tpl, ring);
    }
    return ring;
  };
  const tmpV = new THREE.Vector3();
  const add = (
    cls: RockClass,
    tpl: RockTemplate,
    index: number,
    x: number,
    z: number,
    width: number,
    yawDeg: number,
    tiltDeg: number,
    moss: number,
    tint: THREE.Color,
    sinkRange: [number, number] = cfg.sink,
    squash = 1,
    /** 上端をこの高さより上に出す（持ち上げる量には上限がある）。水際の岩を水面から出すのに使う */
    minTop?: number,
  ) => {
    const h = tpl.height * width * squash;
    const sink = THREE.MathUtils.lerp(sinkRange[0], sinkRange[1], rnd());
    tmpQ.setFromAxisAngle(up, THREE.MathUtils.degToRad(yawDeg));
    const ta = THREE.MathUtils.degToRad(tiltDeg);
    tilt.setFromEuler(new THREE.Euler((rnd() - 0.5) * 2 * ta, 0, (rnd() - 0.5) * 2 * ta));
    tmpQ.premultiply(tilt);
    const scale = new THREE.Vector3(width, width * squash, width);
    // 傾けると底面の縁の一方が持ち上がるので、その縁の最も高い所でも地面より下になる深さまで埋める
    const g = ground(x, z);
    let edge = -Infinity;
    for (const p of bottomRing(tpl)) {
      tmpV.copy(p).multiply(scale).applyQuaternion(tmpQ);
      edge = Math.max(edge, tmpV.y + g - ground(x + tmpV.x, z + tmpV.z));
    }
    const depth = Math.max(sink * h, Number.isFinite(edge) ? edge + 0.04 * h : 0);
    const pos = new THREE.Vector3(x, g - depth, z);
    // 上端の高さ（傾けた形で求める）
    let top = -Infinity;
    const P = tpl.geometry.attributes.position;
    for (let i = 0; i < P.count; i += 7) {
      tmpV.fromBufferAttribute(P, i).multiply(scale).applyQuaternion(tmpQ);
      top = Math.max(top, tmpV.y);
    }
    // 水際の岩を水面から出す。持ち上げても底が地面から浮かない量まで（埋めた深さの範囲で）
    if (minTop !== undefined && pos.y + top < minTop) {
      pos.y += Math.max(0, Math.min(minTop - (pos.y + top), cfg.emerge.maxLift * W, depth - 0.05 * h));
    }
    const matrix = new THREE.Matrix4().compose(pos, tmpQ.clone(), scale);
    out.push({ cls, index, matrix, tint, moss, x, z, radius: tpl.radius * width, top: pos.y + top });
  };

  const majorHash = new DiskHash(0.5 * u);
  const placeListed = (
    cls: 'major' | 'coral',
    list: { x: number; z: number; size: number; shape: number; yaw: number; moss: number }[],
    /** 水際の岩として水面から出す */
    emerge = false,
  ) => {
    const placed: { x: number; z: number; r: number }[] = [];
    for (const item of list) {
      const pool = cls === 'coral' ? lib.coral : lib.large;
      const tpl = pool[((item.shape % pool.length) + pool.length) % pool.length];
      const width = item.size * W * (cls === 'coral' ? cfg.coralScale : cfg.majorScale);
      const rr = tpl.radius * width;
      let px = item.x * W;
      let pz = item.z * W;
      // 先に置いた岩に深くめり込むときは離す（寄り添って接する程度は許す）
      for (let it = 0; it < 8; it++) {
        let moved = false;
        for (const o of placed) {
          const dx = px - o.x;
          const dz = pz - o.z;
          const d = Math.hypot(dx, dz) || 1e-6;
          const minD = (o.r + rr) * (1 - cfg.majorOverlap);
          if (d < minD) {
            px = o.x + (dx / d) * minD;
            pz = o.z + (dz / d) * minD;
            moved = true;
          }
        }
        if (!moved) break;
      }
      // 島に近すぎるときは、島から離れる向きへ少しずらす
      for (let i = 0; i < 14 && !canPlace(px, pz, rr * 0.8, tpl.height * width); i++) {
        const e = 0.05 * u;
        const gx = shoreDist(px + e, pz) - shoreDist(px - e, pz);
        const gz = shoreDist(px, pz + e) - shoreDist(px, pz - e);
        const gl = Math.hypot(gx, gz) || 1;
        const toCenter = roundedSquareInside(px, pz, half, pedestal.cornerRadius) < rr + edgeMargin;
        px += toCenter ? -Math.sign(px) * 0.05 * u : (gx / gl) * 0.05 * u;
        pz += toCenter ? -Math.sign(pz) * 0.05 * u : (gz / gl) * 0.05 * u;
      }
      const idx = pool.indexOf(tpl);
      if (cls === 'major') {
        const minTop = emerge ? water.level + cfg.emerge.fraction * tpl.height * width : undefined;
        // 水の中に沈んだ岩は、海底の砂に深めに埋める
        const sink = emerge ? cfg.sink : cfg.seabedSink;
        add('major', tpl, idx, px, pz, width, item.yaw, 4, THREE.MathUtils.clamp(item.moss * cfg.mossAmount, 0, 1), tintAt(px, pz), sink, 1, minTop);
      } else {
        // 緑の岩：海底の砂に少し埋める
        add('coral', tpl, idx, px, pz, width, item.yaw, 6, 1, coralTint(), cfg.seabedSink, 1);
      }
      majorHash.add(px, pz, rr);
      placed.push({ x: px, z: pz, r: rr });
    }
  };

  // ===== 1. 水際の岩 =====
  placeListed(
    'major',
    cfg.major.map(([x, z, size, shapeIdx, yaw, moss]) => ({ x, z, size, shape: shapeIdx, yaw, moss })),
    true,
  );
  // 水の中に沈んだ岩（水際の岩と同じ岩質）
  placeListed(
    'major',
    cfg.submerged.map(([x, z, size, shapeIdx, yaw, moss]) => ({ x, z, size, shape: shapeIdx, yaw, moss })),
  );
  // 島の外側の海岸（西と北）の波打ち際の岩：足もとの線に沿って散らす
  if (shape && cfg.coastBoulders.count > 0) {
    const cb = cfg.coastBoulders;
    const outline = shape.outline;
    // 外形の線の長さに沿って一様に選ぶ
    const seg: number[] = [0];
    for (let i = 0; i < outline.length; i++) {
      const [ax, az] = outline[i];
      const [bx, bz] = outline[(i + 1) % outline.length];
      seg.push(seg[seg.length - 1] + Math.hypot(bx - ax, bz - az));
    }
    const total = seg[seg.length - 1];
    let placed = 0;
    for (let k = 0; k < cb.count * 40 && placed < cb.count; k++) {
      const t = rnd() * total;
      let i = 0;
      while (i < outline.length - 1 && seg[i + 1] < t) i++;
      const f = (t - seg[i]) / Math.max(seg[i + 1] - seg[i], 1e-6);
      const [ax, az] = outline[i];
      const [bx, bz] = outline[(i + 1) % outline.length];
      let x = ax + (bx - ax) * f;
      let z = az + (bz - az) * f;
      // 外側の海岸だけ（入り江側の崖には置かない）
      if (shape.cliffAt(x, z) > cb.maxCliff) continue;
      // 島から外へ少し離す
      const e = 0.05 * u;
      const gx = shoreDist(x + e, z) - shoreDist(x - e, z);
      const gz = shoreDist(x, z + e) - shoreDist(x, z - e);
      const gl = Math.hypot(gx, gz) || 1;
      const off = THREE.MathUtils.lerp(cb.offset[0], cb.offset[1], rnd()) * W;
      x += (gx / gl) * off;
      z += (gz / gl) * off;
      const tpl = lib.large[Math.floor(rnd() * lib.large.length)];
      const width = THREE.MathUtils.lerp(cb.size[0], cb.size[1], Math.pow(rnd(), 1.5)) * W;
      const r = tpl.radius * width;
      if (roundedSquareInside(x, z, half, pedestal.cornerRadius) < r + edgeMargin) continue;
      if (underCliff(x, z)) continue;
      // 波打ち際の浅い岩棚の上だけ。足もと全体が浅い所に限る（台座の縁の近くで島の土台を離した所は深く、
      // 一部でもかかると、底が浮かないように深く沈めて水の底の黒い塊になる）
      let shallow = water.level - ground(x, z) <= 0.03 * W;
      for (let i = 0; i < 8 && shallow; i++) {
        const a = (i / 8) * Math.PI * 2;
        if (water.level - ground(x + Math.cos(a) * r, z + Math.sin(a) * r) > 0.045 * W) shallow = false;
      }
      if (!shallow) continue;
      if (!majorHash.free(x, z, r, 0.8, 1.2 * u)) continue;
      majorHash.add(x, z, r);
      const minTop = water.level + cfg.emerge.fraction * tpl.height * width;
      add('major', tpl, lib.large.indexOf(tpl), x, z, width, rnd() * 360, 8, 0, tintAt(x, z), cfg.sink, 1, minTop);
      placed++;
    }
  }
  const majors = out.slice();

  // ===== 2. 海底の緑の岩 =====
  {
    // 群れ：中ほどにいちばん大きな岩、まわりに小さめの岩（大きい順に置くので、小さい岩が大きい岩に寄り添う）
    const grouped: { x: number; z: number; size: number; shape: number; yaw: number; moss: number }[] = [];
    for (const [gx, gz, gr, n, gs] of cfg.coralGroups) {
      for (let i = 0; i < n; i++) {
        const a = rnd() * Math.PI * 2;
        const d = i === 0 ? gr * 0.2 * rnd() : gr * (0.35 + 0.65 * Math.sqrt(rnd()));
        const size = i === 0 ? gs : gs * (0.35 + 0.45 * rnd());
        grouped.push({ x: gx + Math.cos(a) * d, z: gz + Math.sin(a) * d, size, shape: Math.floor(rnd() * 97), yaw: rnd() * 360, moss: 1 });
      }
    }
    placeListed('coral', [
      ...cfg.corals.map(([x, z, size, shapeIdx, yaw]) => ({ x, z, size, shape: shapeIdx, yaw, moss: 1 })),
      ...grouped,
    ]);
  }
  {
    const sc = cfg.coralScatter;
    const clearance = sc.clearance * W;
    let placed = 0;
    for (let k = 0; k < sc.count * 80 && placed < sc.count; k++) {
      const x = (rnd() - 0.5) * W;
      const z = (rnd() - 0.5) * W;
      if (shoreDist(x, z) < clearance + 0.02 * u) continue;
      const g = ground(x, z);
      // 水の中だけ（砂浜や波打ち際には置かない）
      if (water.level - g < 0.05 * W || water.beachAt(x, z) > 0.01) continue;
      // 深場では少なめ、まだらに群れる。手前と左の水の壁の近くに多い（側面から見える）
      const patch = 0.5 + 0.5 * noise.fbm2(x / (0.5 * u) + 3.3, z / (0.5 * u) - 8.8, 2);
      const nearWall = Math.max(smoothstep(0.28 * W, 0.44 * W, z), smoothstep(0.28 * W, 0.44 * W, -x));
      const p = (1 - 0.95 * water.deepAt(x, z)) * smoothstep(0.25, 0.75, patch) * (0.55 + sc.wallBias * nearWall);
      if (rnd() > p) continue;
      // 壁の近くには大きな塊も
      const big = Math.pow(rnd(), 1.6 - 0.8 * nearWall);
      const width = sc.size[0] * W * Math.pow(sc.size[1] / sc.size[0], big);
      const ci = Math.floor(rnd() * lib.coral.length);
      const tpl = lib.coral[ci];
      const r = tpl.radius * width;
      if (!canPlace(x, z, r, tpl.height * width)) continue;
      if (!majorHash.free(x, z, r, 0.95, 1.2 * u)) continue;
      majorHash.add(x, z, r);
      add('coral', tpl, ci, x, z, width, rnd() * 360, 8, 1, coralTint(), cfg.seabedSink, 0.85 + 0.3 * rnd());
      placed++;
    }
  }

  // 海底の岩（緑の岩と沈んだ岩）。まわりに小石と砂利を散らす
  const seabedRocks = out.filter((r) => r.cls === 'coral' || (r.cls === 'major' && r.top < water.level - 0.01 * W));
  const stonesReach = cfg.seabedStones.reach;

  // ===== 3. 小石と砂利の密度場 =====
  const clusters = cfg.clusters.map(([x, z, r, d]) => ({ x: x * W, z: z * W, r: r * W, d }));
  const clearings = cfg.clearings.map(([x, z, r]) => ({ x: x * W, z: z * W, r: r * W }));
  const baseW = cfg.cliffBase.width * W;
  const cave = shape?.cave;
  const caveReach = cfg.cave.reach * W;
  const density = (x: number, z: number) => {
    let d = 0;
    const cd = shoreDist(x, z);
    // 崖のふもと（水の浅い所と砂浜）
    if (cd > -0.1 * u) d += cfg.cliffBase.density * Math.exp(-Math.max(cd, 0) / baseW);
    if (cave) {
      const dx = x - cave.cx;
      const dz = z - cave.cz;
      const along = -(dx * cave.nx + dz * cave.nz);
      const side = dx * cave.tx + dz * cave.tz;
      if (along > -0.2 * u) {
        const rr = (along * along) / (caveReach * caveReach) + (side * side) / ((cave.a * 1.6 + 0.3 * along) ** 2);
        d += cfg.cave.density * Math.exp(-rr);
      }
    }
    for (const c of clusters) d += c.d * Math.exp(-(((x - c.x) ** 2 + (z - c.z) ** 2) / (c.r * c.r)));
    // 水際の岩のまわり（大きな岩ほど広く）
    for (const m of majors) {
      const dist = Math.hypot(x - m.x, z - m.z) - m.radius;
      if (dist < 4 * m.radius) d += (0.45 + 4 * (m.radius / W)) * Math.exp(-Math.max(dist, 0) / (0.9 * m.radius));
    }
    // 砂浜の上（乾いた砂）にはほとんど置かない（崖のふもとの際だけ）
    d *= 1 - 0.85 * water.beachAt(x, z) * smoothstep(0.004 * W, 0.02 * W, cd);
    // 深い所には少ない
    const depth = water.level - ground(x, z);
    d *= 1 - 0.8 * smoothstep(0.04 * W, 0.12 * W, depth);

    // まだらにする
    const patch = noise.fbm2(x / (0.7 * u) + 9.1, z / (0.7 * u) - 2.6, 3);
    d *= 0.25 + 1.3 * smoothstep(-0.35, 0.45, patch);
    for (const c of clearings) d *= smoothstep(0.55, 1.0, Math.hypot(x - c.x, z - c.z) / c.r);
    return d;
  };

  // ===== 4. 小石：密度の高い所から、重ならないように置く =====
  const stoneHash = new DiskHash(0.25 * u);
  const scatter = (cls: 'small' | 'gravel', count: number, [sMin, sMax]: [number, number], spacing: number) => {
    const templates = lib[cls];
    const tries = count * 80;
    let placed = 0;
    for (let k = 0; k < tries && placed < count; k++) {
      const x = (rnd() - 0.5) * W;
      const z = (rnd() - 0.5) * W;
      const d = density(x, z);
      const p = cls === 'gravel' ? Math.min(1, Math.pow(d, 1.3) * 0.45) : Math.min(1, Math.pow(d, 1.6) * 0.35);
      if (rnd() > p) continue;
      const width = sMin * W * Math.pow(sMax / sMin, Math.pow(rnd(), cfg.sizeBias));
      const idx = Math.floor(rnd() * templates.length);
      const tpl = templates[idx];
      const r = tpl.radius * width;
      const h = tpl.height * width;
      if (!canPlace(x, z, r, h)) continue;
      if (!majorHash.free(x, z, r, 0.92, 1.2 * u)) continue;
      if (!stoneHash.free(x, z, r, spacing, 0.5 * u)) continue;
      stoneHash.add(x, z, r);
      add(cls, tpl, idx, x, z, width, rnd() * 360, cls === 'small' ? 12 : 20, 0, tintAt(x, z));
      placed++;
    }
  };
  scatter('small', cfg.counts.small, cfg.sizes.small, 1.05);
  scatter('gravel', cfg.counts.gravel, cfg.sizes.gravel, 1.1);

  // ===== 5. 海底の岩のまわりの細かな石：岩の根元に近いほど多く、まだらに =====
  {
    const ss = cfg.seabedStones;
    const nearRock = (x: number, z: number) => {
      let best = 0;
      for (const m of seabedRocks) {
        const dx = x - m.x;
        const dz = z - m.z;
        const reach = m.radius * (1 + stonesReach);
        if (dx * dx + dz * dz > reach * reach) continue;
        const dist = Math.max(Math.hypot(dx, dz) - m.radius * 0.8, 0);
        best = Math.max(best, Math.exp(-dist / (0.4 * stonesReach * m.radius)));
      }
      return best;
    };
    const [sMin, sMax] = ss.size;
    let placed = 0;
    for (let k = 0; k < ss.count * 60 && placed < ss.count; k++) {
      // 海底の岩のどれかのまわりを選んで、その中に点を取る
      const m = seabedRocks[Math.floor(rnd() * seabedRocks.length)];
      if (!m) break;
      const a = rnd() * Math.PI * 2;
      const rr = m.radius * (0.7 + (1 + stonesReach - 0.7) * Math.pow(rnd(), 0.8));
      const x = m.x + Math.cos(a) * rr;
      const z = m.z + Math.sin(a) * rr;
      const patch = 0.5 + 0.5 * noise.fbm2(x / (0.25 * u) + 5.7, z / (0.25 * u) - 1.3, 2);
      if (rnd() > nearRock(x, z) * (0.35 + 0.65 * patch)) continue;
      const pool = rnd() < 0.7 ? 'gravel' : 'small';
      const templates = lib[pool];
      const idx = Math.floor(rnd() * templates.length);
      const tpl = templates[idx];
      const width = sMin * W * Math.pow(sMax / sMin, Math.pow(rnd(), 1.8));
      const r = tpl.radius * width;
      if (!canPlace(x, z, r, tpl.height * width)) continue;
      if (!majorHash.free(x, z, r, 0.9, 1.2 * u)) continue;
      if (!stoneHash.free(x, z, r, 1.1, 0.5 * u)) continue;
      stoneHash.add(x, z, r);
      add(pool, tpl, idx, x, z, width, rnd() * 360, 25, 0, tintAt(x, z), ss.sink);
      placed++;
    }
  }

  return { instances: out, density };
}
