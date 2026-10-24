import * as THREE from 'three';
import type { Layout } from './layout';
import type { SceneConfig } from './config';

/**
 * 島（ロウアー・マンハッタン）の形と、街の地面（道路・歩道・公園）。
 *  - 島は水の塊の中に立つ石の塊：上面が街の地面、まわりは護岸の石垣（島が台座の縁に届く配置では、そこが切り口＝地層の断面になる）
 *  - 地面は Canvas 2D で描くテクスチャ（道路・白線と黄線・横断歩道・歩道・公園）
 *  - 歩道の区画は少し高い板（縁石の高さ）。道路は区画のすき間
 * 高さは島の地面（道路の面）を 0 とする（街のグループごと水面の上へ置く）。
 */

export type P2 = [number, number];

/** 角を丸めた多角形（各頂点を半径 r の円弧に置き換える。r が辺に対して大きすぎるときは縮める） */
export function roundPolygon(pts: P2[], r: number, seg = 6): P2[] {
  const out: P2[] = [];
  const n = pts.length;
  for (let i = 0; i < n; i++) {
    const p = pts[i];
    const a = pts[(i - 1 + n) % n];
    const b = pts[(i + 1) % n];
    const v1 = [a[0] - p[0], a[1] - p[1]];
    const v2 = [b[0] - p[0], b[1] - p[1]];
    const l1 = Math.hypot(v1[0], v1[1]);
    const l2 = Math.hypot(v2[0], v2[1]);
    const rr = Math.min(r, l1 * 0.45, l2 * 0.45);
    if (rr < 1e-4) {
      out.push(p);
      continue;
    }
    const s = [p[0] + (v1[0] / l1) * rr, p[1] + (v1[1] / l1) * rr];
    const e = [p[0] + (v2[0] / l2) * rr, p[1] + (v2[1] / l2) * rr];
    for (let k = 0; k <= seg; k++) {
      const t = k / seg;
      const x = (1 - t) * (1 - t) * s[0] + 2 * (1 - t) * t * p[0] + t * t * e[0];
      const z = (1 - t) * (1 - t) * s[1] + 2 * (1 - t) * t * p[1] + t * t * e[1];
      out.push([x, z]);
    }
  }
  return out;
}

/** 多角形の向き（上から見て反時計回りなら正。x 右・z 手前の座標） */
export function signedArea(pts: P2[]) {
  let a = 0;
  for (let i = 0; i < pts.length; i++) {
    const [x0, z0] = pts[i];
    const [x1, z1] = pts[(i + 1) % pts.length];
    a += x0 * z1 - x1 * z0;
  }
  return -a / 2;
}

/** 水平な多角形（穴あり）を、高さ y の上向き（または下向き）の面にする。UV はワールドの x, z から */
export function flatPolygon(outer: P2[], holes: P2[][], y: number, uvOf: (x: number, z: number) => [number, number], down = false) {
  const toV = (p: P2) => new THREE.Vector2(p[0], -p[1]);
  const contour = outer.map(toV);
  const hs = holes.map((h) => h.map(toV));
  if (THREE.ShapeUtils.isClockWise(contour)) contour.reverse();
  hs.forEach((h) => {
    if (!THREE.ShapeUtils.isClockWise(h)) h.reverse();
  });
  const faces = THREE.ShapeUtils.triangulateShape(contour, hs);
  const all = [...contour, ...hs.flat()];
  const pos: number[] = [];
  const nor: number[] = [];
  const uv: number[] = [];
  for (const v of all) {
    pos.push(v.x, y, -v.y);
    nor.push(0, down ? -1 : 1, 0);
    uv.push(...uvOf(v.x, -v.y));
  }
  const idx: number[] = [];
  for (const f of faces) {
    if (down) idx.push(f[0], f[2], f[1]);
    else idx.push(f[0], f[1], f[2]);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  return g;
}

/** 辺 a→b の外向きの法線（x, z）。上から見て反時計回りの多角形なら進行方向の右側 */
export function edgeNormal(a: P2, b: P2, ccw: boolean): P2 {
  const len = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
  let nx = -(b[1] - a[1]) / len;
  let nz = (b[0] - a[0]) / len;
  if (!ccw) {
    nx = -nx;
    nz = -nz;
  }
  return [nx, nz];
}

/** 多角形の縁に沿った縦の壁（outward: 外向き） */
export function wallStrip(
  pts: P2[],
  y0: number,
  y1: number,
  uvOf: ((x: number, z: number, y: number) => [number, number]) | null,
  outward = true,
  maxSeg = 0.15,
) {
  const ccw = signedArea(pts) > 0;
  const runs: P2[] = [...pts, pts[0]];
  return openWall(runs, y0, y1, (a, b) => {
    const n = edgeNormal(a, b, ccw);
    return outward ? n : [-n[0], -n[1]];
  }, uvOf ? (x, z, y) => uvOf(x, z, y) : null, maxSeg, false);
}

/**
 * 折れ線に沿った縦の壁。normalOf は辺ごとの外向きの法線。smooth で頂点の法線を前後の辺で平均する（曲がった護岸を丸く見せる）。
 * uvOf の第 4 引数は折れ線に沿った距離
 */
export function openWall(
  pts: P2[],
  y0: number,
  y1: number,
  normalOf: (a: P2, b: P2) => P2,
  uvOf: ((x: number, z: number, y: number, s: number) => [number, number]) | null,
  maxSeg = 0.15,
  smooth = true,
) {
  const pos: number[] = [];
  const nor: number[] = [];
  const uv: number[] = [];
  const idx: number[] = [];
  const segN: P2[] = [];
  for (let i = 0; i + 1 < pts.length; i++) segN.push(normalOf(pts[i], pts[i + 1]));
  const vertN = (i: number): P2 => {
    const a = segN[Math.max(0, i - 1)];
    const b = segN[Math.min(segN.length - 1, i)];
    const x = a[0] + b[0];
    const z = a[1] + b[1];
    const l = Math.hypot(x, z) || 1;
    return [x / l, z / l];
  };
  let dist = 0;
  for (let i = 0; i + 1 < pts.length; i++) {
    const a = pts[i];
    const b = pts[i + 1];
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (len < 1e-6) continue;
    const [nx, nz] = segN[i];
    const na = smooth ? vertN(i) : segN[i];
    const nb = smooth ? vertN(i + 1) : segN[i];
    // 辺の向き × 上向き（反時計回りの面の表）と外向きの法線が同じ向きなら標準の巻き順
    const standard = nx * -(b[1] - a[1]) + nz * (b[0] - a[0]) > 0;
    const segs = Math.max(1, Math.ceil(len / maxSeg));
    const vsegs = Math.max(1, Math.ceil(Math.abs(y1 - y0) / maxSeg));
    const base = pos.length / 3;
    for (let j = 0; j <= vsegs; j++) {
      const y = y0 + ((y1 - y0) * j) / vsegs;
      for (let k = 0; k <= segs; k++) {
        const t = k / segs;
        const x = a[0] + (b[0] - a[0]) * t;
        const z = a[1] + (b[1] - a[1]) * t;
        pos.push(x, y, z);
        const mx = na[0] + (nb[0] - na[0]) * t;
        const mz = na[1] + (nb[1] - na[1]) * t;
        const ml = Math.hypot(mx, mz) || 1;
        nor.push(mx / ml, 0, mz / ml);
        uv.push(...(uvOf ? uvOf(x, z, y, dist + len * t) : [0, 0]));
      }
    }
    for (let j = 0; j < vsegs; j++) {
      for (let k = 0; k < segs; k++) {
        const p0 = base + j * (segs + 1) + k;
        const p1 = p0 + 1;
        const p2 = p0 + segs + 2;
        const p3 = p0 + segs + 1;
        if (standard) idx.push(p0, p1, p2, p0, p2, p3);
        else idx.push(p0, p2, p1, p0, p3, p2);
      }
    }
    dist += len;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  return g;
}

/** 多角形を内側へ d だけ縮める（辺に平行に動かす簡単な方法） */
export function insetPolygon(pts: P2[], d: number): P2[] {
  const n = pts.length;
  const ccw = signedArea(pts) > 0;
  const out: P2[] = [];
  for (let i = 0; i < n; i++) {
    const a = pts[(i - 1 + n) % n];
    const p = pts[i];
    const b = pts[(i + 1) % n];
    const n1 = edgeNormal(a, p, ccw);
    const n2 = edgeNormal(p, b, ccw);
    let nx = n1[0] + n2[0];
    let nz = n1[1] + n2[1];
    const l = Math.hypot(nx, nz) || 1;
    nx /= l;
    nz /= l;
    const cos = nx * n1[0] + nz * n1[1];
    const k = d / Math.max(cos, 0.3);
    out.push([p[0] - nx * k, p[1] - nz * k]);
  }
  return out;
}

export function mergeGeometries(geos: THREE.BufferGeometry[]) {
  const pos: number[] = [];
  const nor: number[] = [];
  const uv: number[] = [];
  const idx: number[] = [];
  let offset = 0;
  for (const g of geos) {
    const p = g.attributes.position.array as ArrayLike<number>;
    const n = g.attributes.normal.array as ArrayLike<number>;
    const t = g.attributes.uv?.array as ArrayLike<number> | undefined;
    for (let i = 0; i < p.length; i++) pos.push(p[i]);
    for (let i = 0; i < n.length; i++) nor.push(n[i]);
    const count = p.length / 3;
    if (t) for (let i = 0; i < t.length; i++) uv.push(t[i]);
    else for (let i = 0; i < count * 2; i++) uv.push(0);
    const index = g.index ? (g.index.array as ArrayLike<number>) : Array.from({ length: count }, (_, i) => i);
    for (let i = 0; i < index.length; i++) idx.push(index[i] + offset);
    offset += count;
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  out.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  out.setIndex(idx);
  out.computeBoundingSphere();
  return out;
}

/** ワールドの x, z から地面のテクスチャの UV へ（台座の正方形全体で 0〜1） */
export function groundUv(half: number) {
  return (x: number, z: number): [number, number] => [(x + half) / (2 * half), 1 - (z + half) / (2 * half)];
}

/** 角丸正方形の外周までの距離（内側が正） */
function roundedSquareInside(x: number, z: number, half: number, r: number) {
  const qx = Math.abs(x) - (half - r);
  const qz = Math.abs(z) - (half - r);
  return -(Math.hypot(Math.max(qx, 0), Math.max(qz, 0)) + Math.min(Math.max(qx, qz), 0) - r);
}

export interface IslandGeometry {
  /** 上面（道路の面） */
  top: THREE.BufferGeometry;
  /** 水に面した護岸の石垣（上面から土台の上面まで） */
  seawall: THREE.BufferGeometry;
  /** 台座の縁に届く所の切り口（地層の断面）。島のまわりがすべて水なら空 */
  section: THREE.BufferGeometry;
  /** 護岸の折れ線（泡や遊歩道の手すりに使う） */
  shoreRuns: P2[][];
}

/**
 * 島の形：上面と、護岸（水の側）・切り口（台座の縁の側）の縦の壁。bottom は壁の下端（土台の上面、島の地面からの高さ）
 */
export function createIslandGeometry(layout: Layout, opts: { half: number; cornerRadius: number; bottom: number }): IslandGeometry {
  const uvOf = groundUv(opts.half);
  const outline = layout.island.outline as P2[];
  const ccw = signedArea(outline) > 0;
  const top = flatPolygon(outline, [], 0, uvOf);
  // 辺ごとに、台座の外形の上（切り口）か、水に面した岸かを分ける
  const onCut = (p: P2) => Math.abs(roundedSquareInside(p[0], p[1], opts.half, opts.cornerRadius)) < 0.012;
  const n = outline.length;
  const kinds: boolean[] = [];
  for (let i = 0; i < n; i++) kinds.push(onCut(outline[i]) && onCut(outline[(i + 1) % n]));
  // 同じ種類の辺が続く所をまとめる（切り口の始まりから一周する）
  let start = kinds.findIndex((k, i) => k !== kinds[(i - 1 + n) % n]);
  if (start < 0) start = 0;
  const runs: { cut: boolean; pts: P2[] }[] = [];
  for (let s = 0; s < n; s++) {
    const i = (start + s) % n;
    const last = runs[runs.length - 1];
    if (!last || last.cut !== kinds[i]) runs.push({ cut: kinds[i], pts: [outline[i]] });
    runs[runs.length - 1].pts.push(outline[(i + 1) % n]);
  }
  const normalOf = (a: P2, b: P2) => edgeNormal(a, b, ccw);
  const seawalls: THREE.BufferGeometry[] = [];
  const sections: THREE.BufferGeometry[] = [];
  const shoreRuns: P2[][] = [];
  for (const r of runs) {
    if (r.cut) {
      sections.push(openWall(r.pts, opts.bottom, 0, normalOf, (_x, _z, y, s) => [s, y], 0.25, false));
    } else {
      seawalls.push(openWall(r.pts, opts.bottom, 0, normalOf, (_x, _z, y, s) => [s, y], 0.1, true));
      shoreRuns.push(r.pts);
    }
  }
  return { top, seawall: mergeGeometries(seawalls), section: mergeGeometries(sections), shoreRuns };
}

/**
 * 護岸の石垣のマテリアル：水の上は明るい花崗岩の切り石、水の中は暗く、水面の近くに藻。
 * 水の中の面は、描いた画像の不透明度を 0 にして「水の側面から見える島の土台」の印にする（シリーズの海の描き方）
 */
export function createSeawallMaterial(cfg: SceneConfig['island'], waterY: number) {
  const material = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.92, metalness: 0 });
  const uniforms = {
    uSwTop: { value: new THREE.Color(cfg.seawall) },
    uSwCap: { value: new THREE.Color(cfg.seawallTop) },
    uSwUnder: { value: new THREE.Color(cfg.underwater) },
    uSwAlgae: { value: new THREE.Color(cfg.algae) },
    uSwWater: { value: waterY },
  };
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vSwPos;\nvarying vec2 vSwUv;')
      .replace('#include <uv_vertex>', '#include <uv_vertex>\nvSwUv = uv;')
      .replace('#include <project_vertex>', '#include <project_vertex>\nvSwPos = ( modelMatrix * vec4( transformed, 1.0 ) ).xyz;');
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
uniform vec3 uSwTop;
uniform vec3 uSwCap;
uniform vec3 uSwUnder;
uniform vec3 uSwAlgae;
uniform float uSwWater;
varying vec3 vSwPos;
varying vec2 vSwUv;
float swHash( vec2 p ) { return fract( sin( dot( p, vec2( 127.1, 311.7 ) ) ) * 43758.5453 ); }
float swNoise( vec2 p ) {
  vec2 i = floor( p ); vec2 f = fract( p ); f = f * f * ( 3.0 - 2.0 * f );
  return mix( mix( swHash( i ), swHash( i + vec2( 1, 0 ) ), f.x ), mix( swHash( i + vec2( 0, 1 ) ), swHash( i + vec2( 1, 1 ) ), f.x ), f.y );
}`,
      )
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
{
  // 切り石：段ごとに半分ずらした横長の石。目地は少し暗い
  float s = vSwUv.x;
  float y = vSwUv.y;
  float rowH = 0.045;
  float row = floor( y / rowH );
  float sx = s / 0.11 + 0.5 * mod( row, 2.0 );
  float jx = fract( sx );
  float jy = fract( y / rowH );
  float joint = max( 1.0 - smoothstep( 0.0, 0.05, jx ) * smoothstep( 1.0, 0.95, jx ), 1.0 - smoothstep( 0.0, 0.09, jy ) * smoothstep( 1.0, 0.91, jy ) );
  float h = swHash( vec2( floor( sx ), row ) );
  vec3 stone = uSwTop * ( 0.9 + 0.16 * h );
  // 上端の笠石（明るい帯）
  float cap = smoothstep( -0.03, -0.022, y );
  stone = mix( stone, uSwCap, cap );
  // 水の中：暗く、水面の近くに藻
  float depth = uSwWater - vSwPos.y;
  float under = smoothstep( -0.004, 0.012, depth );
  vec3 wet = uSwUnder * ( 0.85 + 0.2 * h );
  float algae = smoothstep( 0.0, 0.05, depth ) * ( 1.0 - smoothstep( 0.25, 0.9, depth ) ) * smoothstep( 0.35, 0.65, swNoise( vec2( s * 7.0, y * 11.0 ) ) );
  wet = mix( wet, uSwAlgae, algae * 0.75 );
  // 水の跡（水面のすぐ上のしみ）
  stone *= 1.0 - 0.18 * ( 1.0 - smoothstep( 0.0, 0.035, -depth ) );
  vec3 c = mix( stone, wet, under );
  c *= 1.0 - 0.22 * joint;
  diffuseColor.rgb = c;
}`,
      )
      .replace(
        '#include <dithering_fragment>',
        `#include <dithering_fragment>
gl_FragColor.a = vSwPos.y < uSwWater ? 0.0 : 1.0;`,
      );
  };
  material.customProgramCacheKey = () => 'nyc-seawall';
  return material;
}

/** 切り口のマテリアル：舗装 → 土 → 盛り土 → 片岩の岩盤（斜めの縞）。下ほどわずかに暗い */
export function createSectionMaterial(cfg: SceneConfig['island']) {
  const material = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.95, metalness: 0 });
  const c = cfg.section;
  const uniforms = {
    uScAsphalt: { value: new THREE.Color(c.asphalt) },
    uScSoil: { value: new THREE.Color(c.soil) },
    uScFill: { value: new THREE.Color(c.fill) },
    uScRock: { value: new THREE.Color(c.rock) },
    uScRockDark: { value: new THREE.Color(c.rockDark) },
  };
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec2 vScUv;')
      .replace('#include <uv_vertex>', '#include <uv_vertex>\nvScUv = uv;');
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
uniform vec3 uScAsphalt;
uniform vec3 uScSoil;
uniform vec3 uScFill;
uniform vec3 uScRock;
uniform vec3 uScRockDark;
varying vec2 vScUv;
float scHash( vec2 p ) { return fract( sin( dot( p, vec2( 127.1, 311.7 ) ) ) * 43758.5453 ); }
float scNoise( vec2 p ) {
  vec2 i = floor( p ); vec2 f = fract( p ); f = f * f * ( 3.0 - 2.0 * f );
  return mix( mix( scHash( i ), scHash( i + vec2( 1, 0 ) ), f.x ), mix( scHash( i + vec2( 0, 1 ) ), scHash( i + vec2( 1, 1 ) ), f.x ), f.y );
}`,
      )
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
{
  float s = vScUv.x;
  float d = -vScUv.y;
  float wob = 0.03 * ( scNoise( vec2( s * 3.0, 1.7 ) ) - 0.5 );
  vec3 col = uScAsphalt;
  col = mix( col, uScSoil, smoothstep( 0.028, 0.034, d + wob * 0.2 ) );
  col = mix( col, uScFill, smoothstep( 0.2, 0.24, d + wob ) );
  // 岩盤：斜めに傾いた片岩の縞と、ところどころ明るい石英の筋
  float foli = sin( ( d * 26.0 + s * 9.0 ) + 4.0 * scNoise( vec2( s * 1.2, d * 2.0 ) ) );
  vec3 rock = mix( uScRockDark, uScRock, 0.55 + 0.45 * foli );
  rock = mix( rock, vec3( 0.86, 0.85, 0.82 ), smoothstep( 0.92, 0.98, scNoise( vec2( s * 6.0, d * 14.0 ) ) ) * 0.6 );
  col = mix( col, rock, smoothstep( 0.55, 0.62, d + wob * 2.0 ) );
  col *= 0.94 + 0.12 * scNoise( vec2( s * 40.0, d * 40.0 ) );
  col *= 1.0 - 0.18 * smoothstep( 0.6, 2.4, d );
  diffuseColor.rgb = col;
}`,
      );
  };
  material.customProgramCacheKey = () => 'nyc-section';
  return material;
}

/**
 * 地面のテクスチャ（Canvas 2D で描く）：道路と白線・黄線、横断歩道、歩道（縁石の縁と目地）、遊歩道、公園の芝生と小道、池と砦
 */
export function createGroundTexture(layout: Layout, half: number, cfg: SceneConfig['ground'], scale = 1) {
  const ppu = cfg.texelsPerUnit * scale;
  const N = Math.round(2 * half * ppu);
  const canvas = document.createElement('canvas');
  canvas.width = N;
  canvas.height = N;
  const ctx = canvas.getContext('2d')!;
  const X = (x: number) => (x + half) * ppu;
  const Z = (z: number) => (z + half) * ppu;
  const path = (pts: P2[], close = true) => {
    ctx.beginPath();
    pts.forEach(([x, z], i) => (i === 0 ? ctx.moveTo(X(x), Z(z)) : ctx.lineTo(X(x), Z(z))));
    if (close) ctx.closePath();
  };
  const noise = (seed: number) => {
    let s = seed;
    return () => {
      s = (s * 16807) % 2147483647;
      return s / 2147483647;
    };
  };
  // 下地は道路の色（島の外は見えない）
  ctx.fillStyle = cfg.asphalt;
  ctx.fillRect(0, 0, N, N);
  const rnd = noise(7);
  ctx.globalAlpha = 0.05;
  for (let i = 0; i < 2600; i++) {
    ctx.fillStyle = rnd() < 0.5 ? '#000000' : '#ffffff';
    const r = (0.01 + rnd() * 0.05) * ppu;
    ctx.beginPath();
    ctx.arc(rnd() * N, rnd() * N, r, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;

  // --- 道路の線：中央線（黄色の二重線・破線）と端の白線。交差点の中には描かない
  const offsetLine = (pts: P2[], d: number): P2[] =>
    pts.map((p, i) => {
      const a = pts[Math.max(0, i - 1)];
      const b = pts[Math.min(pts.length - 1, i + 1)];
      const dx = b[0] - a[0];
      const dz = b[1] - a[1];
      const l = Math.hypot(dx, dz) || 1;
      // 進む向きの右（上から見て時計回りに 90°）
      return [p[0] - (dz / l) * d, p[1] + (dx / l) * d] as P2;
    });
  const stroke = (pts: P2[], width: number, color: string, on = 0, off = 0) => {
    ctx.strokeStyle = color;
    ctx.lineWidth = width * ppu;
    ctx.lineJoin = 'round';
    ctx.setLineDash(on > 0 ? [on * ppu, off * ppu] : []);
    path(pts, false);
    ctx.stroke();
    ctx.setLineDash([]);
  };
  for (const r of layout.roads) {
    const e = r.width / 2 - 0.035;
    stroke(offsetLine(r.path, e), 0.008, cfg.lineWhite);
    stroke(offsetLine(r.path, -e), 0.008, cfg.lineWhite);
    if (r.center === 'double') {
      stroke(offsetLine(r.path, 0.012), 0.01, cfg.lineYellow);
      stroke(offsetLine(r.path, -0.012), 0.01, cfg.lineYellow);
    } else if (r.center === 'dashed') {
      stroke(r.path, 0.012, cfg.lineYellow, 0.09, 0.07);
    }
  }
  // 交差点の中を道路の色で塗り直す（線を消す）
  ctx.fillStyle = cfg.asphaltWarm;
  for (const j of layout.junctions) {
    path(j);
    ctx.fill();
  }

  // --- 横断歩道（白い縞）
  ctx.fillStyle = cfg.crosswalk;
  for (const c of layout.crosswalks) {
    const [cx, cz] = c.c;
    const stripe = 0.035;
    const gap = 0.03;
    const L = c.length - 0.06;
    const D = c.depth;
    if (c.dir === 'z') {
      // 南北の道を渡る：縞は z 方向に長く、x 方向に並ぶ
      for (let x = cx - L / 2; x + stripe <= cx + L / 2 + 1e-6; x += stripe + gap) ctx.fillRect(X(x), Z(cz - D / 2), stripe * ppu, D * ppu);
    } else {
      for (let z = cz - L / 2; z + stripe <= cz + L / 2 + 1e-6; z += stripe + gap) ctx.fillRect(X(cx - D / 2), Z(z), D * ppu, stripe * ppu);
    }
  }

  // --- 歩道の区画：縁石の色の縁、内側は歩道の色と細かい目地
  for (const bl of layout.blocks as P2[][]) {
    path(bl);
    ctx.fillStyle = cfg.curb;
    ctx.fill();
    const inner = insetPolygon(bl, 0.014);
    path(inner);
    ctx.fillStyle = cfg.sidewalk;
    ctx.fill();
    ctx.save();
    path(inner);
    ctx.clip();
    ctx.strokeStyle = 'rgba(150,140,135,0.16)';
    ctx.lineWidth = Math.max(1, 0.004 * ppu);
    const step = 0.08;
    for (let x = -half; x <= half; x += step) {
      ctx.beginPath();
      ctx.moveTo(X(x), 0);
      ctx.lineTo(X(x), N);
      ctx.stroke();
    }
    for (let z = -half; z <= half; z += step) {
      ctx.beginPath();
      ctx.moveTo(0, Z(z));
      ctx.lineTo(N, Z(z));
      ctx.stroke();
    }
    ctx.restore();
  }
  // 岸の縁の笠石（遊歩道の水際の明るい石の帯）
  path(layout.island.outline as P2[]);
  ctx.strokeStyle = cfg.coping;
  ctx.lineWidth = 0.05 * ppu;
  ctx.stroke();

  // --- 公園：芝生のグラデーションとむら、小道、池・砦
  for (const pk of layout.parks) {
    for (const poly of pk.polys as P2[][]) {
      const xs = poly.map((p) => p[0]);
      const zs = poly.map((p) => p[1]);
      const x0 = Math.min(...xs);
      const x1 = Math.max(...xs);
      const z0 = Math.min(...zs);
      const z1 = Math.max(...zs);
      path(poly);
      const grd = ctx.createLinearGradient(X(x0), Z(z0), X(x1), Z(z1));
      grd.addColorStop(0, cfg.grassLight);
      grd.addColorStop(1, cfg.grass);
      ctx.fillStyle = grd;
      ctx.fill();
      ctx.save();
      path(poly);
      ctx.clip();
      const rg = noise(Math.round((x0 + 10) * 100 + (z0 + 10) * 7));
      for (let i = 0; i < 500; i++) {
        ctx.globalAlpha = 0.08;
        ctx.fillStyle = rg() < 0.5 ? '#4f8f1a' : '#c8e060';
        ctx.beginPath();
        ctx.arc(X(x0 + rg() * (x1 - x0)), Z(z0 + rg() * (z1 - z0)), (0.02 + rg() * 0.06) * ppu, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
      // 小道：池（または砦）を囲む輪と、四隅と辺の中ほどからの道
      const cx = pk.pond ? pk.pond.c[0] : pk.fort ? pk.fort.c[0] : (x0 + x1) / 2;
      const cz = pk.pond ? pk.pond.c[1] : pk.fort ? pk.fort.c[1] : (z0 + z1) / 2;
      const rx = pk.pond ? pk.pond.r[0] : pk.fort ? pk.fort.r : 0.3;
      const rz = pk.pond ? pk.pond.r[1] : pk.fort ? pk.fort.r : 0.3;
      const inPoly = polygonContains(poly, cx, cz);
      ctx.strokeStyle = cfg.path;
      ctx.lineCap = 'round';
      if (inPoly) {
        ctx.lineWidth = 0.07 * ppu;
        ctx.beginPath();
        ctx.ellipse(X(cx), Z(cz), (rx + 0.12) * ppu, (rz + 0.12) * ppu, 0, 0, Math.PI * 2);
        ctx.stroke();
        ctx.lineWidth = 0.055 * ppu;
        const spokes: P2[] = [
          [x0, z0],
          [x1, z0],
          [x1, z1],
          [x0, z1],
          [(x0 + x1) / 2, z0],
          [x1, (z0 + z1) / 2],
          [(x0 + x1) / 2, z1],
          [x0, (z0 + z1) / 2],
        ];
        for (const [sx, sz] of spokes) {
          const a = Math.atan2(sz - cz, sx - cx);
          ctx.beginPath();
          ctx.moveTo(X(cx + Math.cos(a) * (rx + 0.12)), Z(cz + Math.sin(a) * (rz + 0.12)));
          const mx = (sx + cx + Math.cos(a) * rx) / 2 + 0.06 * Math.sin(a * 3);
          const mz = (sz + cz + Math.sin(a) * rz) / 2 - 0.06 * Math.cos(a * 2);
          ctx.quadraticCurveTo(X(mx), Z(mz), X(sx), Z(sz));
          ctx.stroke();
        }
      } else {
        // 砦のない側の芝生：ゆるく曲がった小道を 1 本
        ctx.lineWidth = 0.055 * ppu;
        ctx.beginPath();
        ctx.moveTo(X(x0 + 0.1), Z(z0 + (z1 - z0) * 0.3));
        ctx.quadraticCurveTo(X((x0 + x1) / 2), Z((z0 + z1) / 2 + 0.2), X(x1 - 0.05), Z(z0 + (z1 - z0) * 0.75));
        ctx.stroke();
      }
      ctx.restore();
      if (pk.pond && inPoly) {
        // 池：明るい縁石と水（中ほどが明るい）、きらめき
        const blob = (grow: number) => {
          ctx.beginPath();
          const n = 72;
          for (let i = 0; i <= n; i++) {
            const a = (i / n) * Math.PI * 2;
            const k = 1 + 0.08 * Math.sin(2 * a + 0.6) + 0.05 * Math.sin(3 * a + 1.9);
            const x = cx + Math.cos(a) * (rx * k + grow);
            const z = cz + Math.sin(a) * (rz * k + grow);
            if (i === 0) ctx.moveTo(X(x), Z(z));
            else ctx.lineTo(X(x), Z(z));
          }
          ctx.closePath();
        };
        ctx.fillStyle = cfg.pondEdge;
        blob(0.04);
        ctx.fill();
        const pg = ctx.createRadialGradient(X(cx - rx * 0.3), Z(cz - rz * 0.3), 0, X(cx), Z(cz), rx * ppu);
        pg.addColorStop(0, '#8fd0f6');
        pg.addColorStop(1, cfg.pond);
        ctx.fillStyle = pg;
        blob(0);
        ctx.fill();
        ctx.strokeStyle = 'rgba(255,255,255,0.55)';
        ctx.lineWidth = 0.008 * ppu;
        const rp = noise(5);
        for (let i = 0; i < 10; i++) {
          const ax = cx + (rp() - 0.5) * rx * 1.3;
          const az = cz + (rp() - 0.5) * rz * 1.3;
          ctx.beginPath();
          ctx.moveTo(X(ax), Z(az));
          ctx.lineTo(X(ax + 0.05 + rp() * 0.06), Z(az));
          ctx.stroke();
        }
      }
      if (pk.fort && inPoly) {
        // 砦の中の広場（明るい砂岩の床）
        ctx.fillStyle = cfg.plaza;
        ctx.beginPath();
        ctx.arc(X(cx), Z(cz), (pk.fort.r + 0.02) * ppu, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 8;
  texture.generateMipmaps = true;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  return { texture, canvas };
}

function polygonContains(poly: P2[], x: number, z: number) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, zi] = poly[i];
    const [xj, zj] = poly[j];
    if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}

/** 区画（歩道の板）：上面と縁石の側面、公園の芝生（歩道より少し高い）。上面は地面のテクスチャ */
export function createBlocksGeometry(layout: Layout, half: number, height: number) {
  const uvOf = groundUv(half);
  const geos: THREE.BufferGeometry[] = [];
  for (const bl of layout.blocks as P2[][]) {
    geos.push(flatPolygon(bl, [], height, uvOf));
    geos.push(wallStrip(bl, 0, height, (x, z) => uvOf(x, z), true, 0.2));
  }
  for (const pk of layout.parks) {
    for (const poly of pk.polys as P2[][]) {
      geos.push(flatPolygon(poly, [], height + 0.012, uvOf));
      geos.push(wallStrip(poly, height, height + 0.012, (x, z) => uvOf(x, z), true, 0.2));
    }
  }
  return mergeGeometries(geos);
}
