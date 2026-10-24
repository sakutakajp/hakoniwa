import * as THREE from 'three';
import type { SceneConfig } from '../config';
import { BAKED_VISIBILITY_FUNCTIONS, lightsBeginWithBakedVisibility } from '../bakedLighting';
import { LOCAL_LIGHT_GLSL, TINT_APPLY, TINT_DECL, type TownEnv } from './env';
import type { FaceAtlas } from './atlas';
import type { P2 } from './geometry2d';

/**
 * 雑居ビルの外形（塊の組み合わせ）と、外壁のシェーダー。
 * 塊は上から見た凸の多角形を、歩道の高さから立ち上げたもの。外壁の柄（タイル・窓・店先）はシェーダーで描く。
 * 窓と店先のガラスの奥には、視線に合わせて奥行きのある部屋（天井の明かり・家具・商品の棚）を描く（インテリアマッピング）
 */

export const STYLES = [
  'tileBeige',
  'tileGray',
  'tileWarm',
  'tileDark',
  'glass',
  'blue',
  'concrete',
  'maroon',
  'red',
  'roof',
  'cap',
  'tileWhite',
] as const;
export type StyleName = (typeof STYLES)[number];

export const WINDOW_KINDS = ['none', 'punched', 'wide', 'curtain', 'small', 'tall'] as const;
export type WindowKind = (typeof WINDOW_KINDS)[number];

export interface FaceSpec {
  windows?: WindowKind;
  /** 1 階を店先（ガラス越しに明るい売り場）にする */
  shop?: boolean;
  style?: StyleName;
  /** 窓の並びの間隔 */
  bay?: number;
  /** 窓の明かりがついている割合 */
  lit?: number;
}

export interface MassSpec {
  id: string;
  /** 上から見た外形（凸の多角形、[x, z]） */
  corners: P2[];
  /** 下端の高さ（省略すると歩道の高さ） */
  base?: number;
  /** 壁の高さ（下端から屋根まで） */
  height: number;
  /** 屋上の縁の立ち上がり（パラペット）の高さ。0 でなし */
  parapet?: number;
  style: StyleName;
  /** 1 階と上の階の高さ */
  ground?: number;
  floor?: number;
  /** 面ごとの設定（辺 i は corners[i] → corners[i+1]）。省略した面は defaultFace */
  faces?: Partial<Record<number, FaceSpec>>;
  defaultFace?: FaceSpec;
  /** 屋上を作らない（上に別の塊が載るとき） */
  noRoof?: boolean;
}

/** 塊の面 i（corners[i] → corners[i+1]）の位置と向き：始点、面に沿った単位ベクトル、外向きの法線、長さ、下端の高さ */
export interface FaceFrame {
  a: P2;
  b: P2;
  t: P2;
  n: P2;
  len: number;
  base: number;
  height: number;
}

export function faceFrame(m: MassSpec, i: number, walk: number): FaceFrame {
  const pts = m.corners;
  const a = pts[i % pts.length];
  const b = pts[(i + 1) % pts.length];
  const dx = b[0] - a[0];
  const dz = b[1] - a[1];
  const len = Math.hypot(dx, dz) || 1;
  const t: P2 = [dx / len, dz / len];
  const sign = signedArea(pts) > 0 ? 1 : -1;
  const n: P2 = sign > 0 ? [t[1], -t[0]] : [-t[1], t[0]];
  return { a, b, t, n, len, base: m.base ?? walk, height: m.height };
}

/** 前の辺 a → b から奥（a → b の左の法線の向き）へ depth の長方形 */
export function rectFrom(a: P2, b: P2, depth: number): P2[] {
  const dx = b[0] - a[0];
  const dz = b[1] - a[1];
  const l = Math.hypot(dx, dz) || 1;
  const nx = dz / l;
  const nz = -dx / l;
  return [a, b, [b[0] + nx * depth, b[1] + nz * depth], [a[0] + nx * depth, a[1] + nz * depth]];
}

/** 点 p から向き deg（度）へ len 進んだ点 */
export function along(p: P2, deg: number, len: number): P2 {
  const a = (deg * Math.PI) / 180;
  return [p[0] + Math.cos(a) * len, p[1] + Math.sin(a) * len];
}

/** 多角形を内側へ th だけ縮める（凸の多角形） */
function insetPolygon(pts: P2[], th: number, ccwSign: number): P2[] {
  const n = pts.length;
  const lines: { p: P2; d: P2 }[] = [];
  for (let i = 0; i < n; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % n];
    const dx = b[0] - a[0];
    const dz = b[1] - a[1];
    const l = Math.hypot(dx, dz) || 1;
    // 外向きの法線
    const nx = (ccwSign > 0 ? dz : -dz) / l;
    const nz = (ccwSign > 0 ? -dx : dx) / l;
    lines.push({ p: [a[0] - nx * th, a[1] - nz * th], d: [dx / l, dz / l] });
  }
  const out: P2[] = [];
  for (let i = 0; i < n; i++) {
    const L0 = lines[(i + n - 1) % n];
    const L1 = lines[i];
    const det = L0.d[0] * L1.d[1] - L0.d[1] * L1.d[0];
    if (Math.abs(det) < 1e-6) {
      out.push(L1.p);
      continue;
    }
    const wx = L1.p[0] - L0.p[0];
    const wz = L1.p[1] - L0.p[1];
    const t = (wx * L1.d[1] - wz * L1.d[0]) / det;
    out.push([L0.p[0] + L0.d[0] * t, L0.p[1] + L0.d[1] * t]);
  }
  return out;
}

function signedArea(pts: P2[]) {
  let a = 0;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i];
    const q = pts[(i + 1) % pts.length];
    a += p[0] * q[1] - q[0] * p[1];
  }
  return a / 2;
}

/** 外壁の頂点を積み上げる入れ物 */
class ShellBuilder {
  pos: number[] = [];
  nor: number[] = [];
  fuv: number[] = [];
  face: number[] = [];
  floors: number[] = [];
  tan: number[] = [];
  bake: number[] = [];
  idx: number[] = [];

  quad(
    p: THREE.Vector3[],
    n: THREE.Vector3,
    fuv: [number, number][],
    face: [number, number, number, number],
    floors: [number, number, number, number],
    tan: THREE.Vector3,
    bake: [number, number][],
  ) {
    const base = this.pos.length / 3;
    // 表（法線の側から見て反時計回り）になるように三角形の向きを決める
    const e1 = new THREE.Vector3().subVectors(p[1], p[0]);
    const e2 = new THREE.Vector3().subVectors(p[2], p[0]);
    const flip = e1.cross(e2).dot(n) < 0;
    for (let i = 0; i < 4; i++) {
      this.pos.push(p[i].x, p[i].y, p[i].z);
      this.nor.push(n.x, n.y, n.z);
      this.fuv.push(fuv[i][0], fuv[i][1]);
      this.face.push(...face);
      this.floors.push(...floors);
      this.tan.push(tan.x, tan.y, tan.z);
      this.bake.push(bake[i][0], bake[i][1]);
    }
    if (flip) this.idx.push(base, base + 2, base + 1, base, base + 3, base + 2);
    else this.idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }

  geometry() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3));
    g.setAttribute('aFUv', new THREE.Float32BufferAttribute(this.fuv, 2));
    g.setAttribute('aFace', new THREE.Float32BufferAttribute(this.face, 4));
    g.setAttribute('aFloors', new THREE.Float32BufferAttribute(this.floors, 4));
    g.setAttribute('aTan', new THREE.Float32BufferAttribute(this.tan, 3));
    g.setAttribute('aBake', new THREE.Float32BufferAttribute(this.bake, 2));
    g.setIndex(this.idx);
    g.computeBoundingSphere();
    return g;
  }
}

export interface BuildingShells {
  mesh: THREE.Mesh;
  /** 影の計算に使う形（外壁と屋上） */
  caster: THREE.Mesh;
  /** 塊ごとの屋上の高さと外形（屋上の物を置くため） */
  roofs: { id: string; y: number; polygon: P2[] }[];
  /** 構図合わせ用：屋上の角の点 */
  topPoints: THREE.Vector3[];
  setAtlas: (texture: THREE.Texture) => void;
}

const UP = new THREE.Vector3(0, 1, 0);

/** 塊の一覧から外壁と屋上を作る（光の地図の面も登録する。地図の詰め込みは呼び出し側で） */
export function createBuildingShells(config: SceneConfig, env: TownEnv, masses: readonly MassSpec[], atlas: FaceAtlas) {
  const walk = config.town.ground + config.town.curb;
  type Pending = { quad: THREE.Vector3[]; n: THREE.Vector3; fuv: [number, number][]; face: [number, number, number, number]; floors: [number, number, number, number]; tan: THREE.Vector3; atlasFace: number; uv: [number, number][]; mass?: number };
  const pending: Pending[] = [];
  const roofs: BuildingShells['roofs'] = [];
  const topPoints: THREE.Vector3[] = [];
  const styleId = (s: StyleName) => STYLES.indexOf(s);
  const winId = (w: WindowKind) => WINDOW_KINDS.indexOf(w);

  let seedCounter = 0;
  for (const [massIndex, m] of masses.entries()) {
    const firstPending = pending.length;
    const base = m.base ?? walk;
    const par = m.parapet ?? 0.04;
    const top = base + m.height;
    const pts = m.corners;
    const sign = signedArea(pts) > 0 ? 1 : -1;
    const n = pts.length;
    const ground = m.ground ?? config.town.buildings.ground;
    const floorH = m.floor ?? config.town.buildings.floor;
    for (let i = 0; i < n; i++) {
      const a = pts[i];
      const b = pts[(i + 1) % n];
      const dx = b[0] - a[0];
      const dz = b[1] - a[1];
      const len = Math.hypot(dx, dz);
      if (len < 1e-4) continue;
      const t = new THREE.Vector3(dx / len, 0, dz / len);
      const nrm = new THREE.Vector3(sign > 0 ? t.z : -t.z, 0, sign > 0 ? -t.x : t.x);
      const fs: FaceSpec = { ...m.defaultFace, ...(m.faces?.[i] ?? {}) };
      const style = styleId(fs.style ?? m.style);
      const wk = winId(fs.windows ?? 'punched');
      const bay = fs.bay ?? config.town.buildings.bay;
      const lit = fs.lit ?? config.town.buildings.lit;
      const h = m.height + par;
      const quad = [
        new THREE.Vector3(a[0], base, a[1]),
        new THREE.Vector3(b[0], base, b[1]),
        new THREE.Vector3(b[0], base + h, b[1]),
        new THREE.Vector3(a[0], base + h, a[1]),
      ];
      const atlasFace = atlas.add({ origin: quad[0].clone(), du: t.clone(), dv: UP.clone(), normal: nrm.clone(), w: len, h });
      const seed = ++seedCounter * 7.13 + (m.id.length % 7) * 0.37;
      pending.push({
        quad,
        n: nrm,
        fuv: [
          [0, 0],
          [len, 0],
          [len, h],
          [0, h],
        ],
        face: [len, m.height, style, seed],
        floors: [ground, floorH, wk + (fs.shop ? 10 : 0), Math.min(bay, 9.9) + Math.round(THREE.MathUtils.clamp(lit, 0, 1) * 100) * 10],
        tan: t,
        atlasFace,
        uv: [
          [0, 0],
          [len, 0],
          [len, h],
          [0, h],
        ],
      });
    }
    if (m.noRoof) {
      for (let k = firstPending; k < pending.length; k++) pending[k].mass = massIndex;
      continue;
    }
    // 屋上：縁の立ち上がりの内側
    const th = par > 0 ? 0.025 : 0;
    const inner = th > 0 ? insetPolygon(pts, th, sign) : pts;
    roofs.push({ id: m.id, y: top, polygon: inner });
    for (const p of pts) topPoints.push(new THREE.Vector3(p[0], top + par, p[1]));
    // 屋上の面（多角形を扇形に分けて四角形 2 枚ずつ……三角形を 1 つの四角形として登録できないので、扇の三角形を退化した四角形にする）
    {
      // 光の地図の面：最初の辺の向きを u、内側を v
      const o = inner[0];
      const e = new THREE.Vector3(inner[1][0] - o[0], 0, inner[1][1] - o[1]).normalize();
      let vdir = new THREE.Vector3(-e.z, 0, e.x);
      // 内側を向くように
      const cx = inner.reduce((s, p) => s + p[0], 0) / inner.length;
      const cz = inner.reduce((s, p) => s + p[1], 0) / inner.length;
      if (vdir.x * (cx - o[0]) + vdir.z * (cz - o[1]) < 0) vdir = vdir.negate();
      let umin = Infinity;
      let umax = -Infinity;
      let vmax = 0;
      for (const p of inner) {
        const rx = p[0] - o[0];
        const rz = p[1] - o[1];
        const u = rx * e.x + rz * e.z;
        const v = rx * vdir.x + rz * vdir.z;
        umin = Math.min(umin, u);
        umax = Math.max(umax, u);
        vmax = Math.max(vmax, v);
      }
      const origin = new THREE.Vector3(o[0], top, o[1]).addScaledVector(e, umin);
      const af = atlas.add({ origin, du: e.clone(), dv: vdir.clone(), normal: UP.clone(), w: umax - umin, h: Math.max(vmax, 0.01) });
      const local = (p: P2): [number, number] => {
        const rx = p[0] - origin.x;
        const rz = p[1] - origin.z;
        return [rx * e.x + rz * e.z, rx * vdir.x + rz * vdir.z];
      };
      const seed = ++seedCounter * 7.13;
      for (let k = 1; k < inner.length - 1; k++) {
        const tri = [inner[0], inner[k], inner[k + 1], inner[k + 1]];
        // 上向きの巻き方にそろえる
        const cross = (tri[1][0] - tri[0][0]) * (tri[2][1] - tri[0][1]) - (tri[1][1] - tri[0][1]) * (tri[2][0] - tri[0][0]);
        const ordered = cross < 0 ? tri : [tri[0], tri[2], tri[1], tri[1]];
        pending.push({
          quad: ordered.map((p) => new THREE.Vector3(p[0], top, p[1])),
          n: UP.clone(),
          fuv: ordered.map((p) => [p[0], p[1]] as [number, number]),
          face: [0, 0, styleId('roof'), seed],
          floors: [0, 0, 0, 0],
          tan: e.clone(),
          atlasFace: af,
          uv: ordered.map(local),
        });
      }
    }
    if (par > 0) {
      // 立ち上がりの内側の壁と、上の笠木
      for (let i = 0; i < n; i++) {
        const a = inner[i];
        const b = inner[(i + 1) % n];
        const oa = pts[i];
        const ob = pts[(i + 1) % n];
        const dx = b[0] - a[0];
        const dz = b[1] - a[1];
        const len = Math.hypot(dx, dz);
        if (len < 1e-4) continue;
        const t = new THREE.Vector3(dx / len, 0, dz / len);
        const inward = new THREE.Vector3(sign > 0 ? -t.z : t.z, 0, sign > 0 ? t.x : -t.x);
        // 内側の壁（内向き）：b → a の順で、外から見て表になるように
        const quad = [
          new THREE.Vector3(b[0], top, b[1]),
          new THREE.Vector3(a[0], top, a[1]),
          new THREE.Vector3(a[0], top + par, a[1]),
          new THREE.Vector3(b[0], top + par, b[1]),
        ];
        const tb = t.clone().negate();
        const af = atlas.add({ origin: quad[0].clone(), du: tb.clone(), dv: UP.clone(), normal: inward.clone(), w: len, h: par });
        pending.push({
          quad,
          n: inward,
          fuv: [
            [0, 0],
            [len, 0],
            [len, par],
            [0, par],
          ],
          face: [len, par, styleId('cap'), 0],
          floors: [0, 0, 0, 0],
          tan: tb,
          atlasFace: af,
          uv: [
            [0, 0],
            [len, 0],
            [len, par],
            [0, par],
          ],
        });
        // 笠木（上向き）
        const capQuad = [
          new THREE.Vector3(oa[0], top + par, oa[1]),
          new THREE.Vector3(ob[0], top + par, ob[1]),
          new THREE.Vector3(b[0], top + par, b[1]),
          new THREE.Vector3(a[0], top + par, a[1]),
        ];
        const c0 = capQuad[0];
        const c1 = capQuad[1];
        const c2 = capQuad[2];
        const crs = (c1.x - c0.x) * (c2.z - c0.z) - (c1.z - c0.z) * (c2.x - c0.x);
        const capOrdered = crs < 0 ? capQuad : [capQuad[0], capQuad[3], capQuad[2], capQuad[1]];
        const capLen = Math.hypot(ob[0] - oa[0], ob[1] - oa[1]);
        const taf = atlas.add({
          origin: new THREE.Vector3(oa[0], top + par, oa[1]),
          du: new THREE.Vector3(ob[0] - oa[0], 0, ob[1] - oa[1]).normalize(),
          dv: inward.clone(),
          normal: UP.clone(),
          w: capLen,
          h: 0.025,
        });
        const capLocal = (p: THREE.Vector3): [number, number] => {
          const rx = p.x - oa[0];
          const rz = p.z - oa[1];
          const du = new THREE.Vector3(ob[0] - oa[0], 0, ob[1] - oa[1]).normalize();
          return [rx * du.x + rz * du.z, Math.max(0, rx * inward.x + rz * inward.z)];
        };
        pending.push({
          quad: capOrdered,
          n: UP.clone(),
          fuv: capOrdered.map((p) => [p.x, p.z] as [number, number]),
          face: [0, 0, styleId('cap'), 0],
          floors: [0, 0, 0, 0],
          tan: t.clone(),
          atlasFace: taf,
          uv: capOrdered.map(capLocal),
        });
      }
    }
    for (let k = firstPending; k < pending.length; k++) pending[k].mass = massIndex;
  }

  const build = () => {
    const sb = new ShellBuilder();
    for (const q of pending) {
      const bake = q.uv.map(([u, v]) => atlas.uv(q.atlasFace, u, v));
      sb.quad(q.quad, q.n, q.fuv, q.face, q.floors, q.tan, bake);
    }
    return sb.geometry();
  };

  /** debug：塊ごとに色を分けた、照明なしの表示（配置の確認用） */
  const finish = (debugColors = false): BuildingShells => {
    const geometry = build();
    const { material, setAtlas } = createFacadeMaterial(config, env);
    let mesh: THREE.Mesh;
    if (debugColors) {
      const col: number[] = [];
      for (const q of pending) {
        const c = new THREE.Color().setHSL(((q.mass ?? 0) * 0.618) % 1, 0.75, 0.5);
        for (let i = 0; i < 4; i++) col.push(c.r, c.g, c.b);
      }
      geometry.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
      mesh = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ vertexColors: true }));
    } else {
      mesh = new THREE.Mesh(geometry, material);
    }
    mesh.name = 'building-shells';
    const caster = new THREE.Mesh(geometry);
    return { mesh, caster, roofs, topPoints, setAtlas };
  };
  return { finish };
}

const FACADE_NOISE = /* glsl */ `
float fcHash( vec2 p ) {
  vec3 p3 = fract( vec3( p.xyx ) * 0.1031 );
  p3 += dot( p3, p3.yzx + 33.33 );
  return fract( ( p3.x + p3.y ) * p3.z );
}
float fcNoise( vec2 p ) {
  vec2 i = floor( p );
  vec2 f = fract( p );
  vec2 u = f * f * ( 3.0 - 2.0 * f );
  return mix( mix( fcHash( i ), fcHash( i + vec2( 1.0, 0.0 ) ), u.x ), mix( fcHash( i + vec2( 0.0, 1.0 ) ), fcHash( i + vec2( 1.0, 1.0 ) ), u.x ), u.y );
}
vec3 fcHsv( float h, float s, float v ) {
  vec3 k = clamp( abs( mod( h * 6.0 + vec3( 0.0, 4.0, 2.0 ), 6.0 ) - 3.0 ) - 1.0, 0.0, 1.0 );
  return v * mix( vec3( 1.0 ), k, s );
}
`;

/**
 * 外壁のマテリアル。attribute：
 *  aFUv = (u：面に沿った長さ, v：下端からの高さ)。屋上は (x, z)
 *  aFace = (面の幅, 塊の高さ, 仕上げの番号, 乱数の種)
 *  aFloors = (1 階の高さ, 上の階の高さ, 窓の種類 + 店先なら 10, 窓の間隔 + 明かりの割合 × 1000)
 *  aTan = 面に沿った u の向き、aBake = 光の地図の座標
 */
export function createFacadeMaterial(config: SceneConfig, env: TownEnv) {
  const f = config.town.facade;
  const palette = STYLES.map((s) => new THREE.Color(f.colors[s]));
  const blank = new THREE.DataTexture(new Uint8Array([0, 0, 0, 255]), 1, 1);
  blank.needsUpdate = true;
  const uniforms = {
    uPalette: { value: palette },
    uAtlas: { value: blank as THREE.Texture },
    uShadowStrength: { value: config.shadow.strength },
    uAoStrength: { value: f.aoStrength },
    uWindowGlow: { value: f.windowGlow },
    uShopGlow: { value: f.shopGlow },
    uInteriorWarm: { value: new THREE.Color(f.interiorWarm) },
    uInteriorCool: { value: new THREE.Color(f.interiorCool) },
    uGlassSky: { value: new THREE.Color(f.glassSky) },
    uLocalWall: { value: f.localLightOnWalls },
  };
  const material = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.85, metalness: 0 });
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms, env.uniforms);
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
attribute vec2 aFUv;
attribute vec4 aFace;
attribute vec4 aFloors;
attribute vec3 aTan;
attribute vec2 aBake;
varying vec2 vFUv;
varying vec4 vFace;
varying vec4 vFloors;
varying vec3 vTan;
varying vec2 vBakeUv;
varying vec3 vWorld3;
varying vec3 vNormalW3;`,
      )
      .replace(
        '#include <project_vertex>',
        `#include <project_vertex>
vFUv = aFUv;
vFace = aFace;
vFloors = aFloors;
vTan = normalize( mat3( modelMatrix ) * aTan );
vBakeUv = aBake;
vWorld3 = ( modelMatrix * vec4( transformed, 1.0 ) ).xyz;
vNormalW3 = normalize( mat3( modelMatrix ) * objectNormal );`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
${FACADE_NOISE}
${LOCAL_LIGHT_GLSL}
${TINT_DECL}
${BAKED_VISIBILITY_FUNCTIONS}
uniform vec3 uPalette[ ${STYLES.length} ];
uniform sampler2D uAtlas;
uniform float uShadowStrength;
uniform float uAoStrength;
uniform float uWindowGlow;
uniform float uShopGlow;
uniform vec3 uInteriorWarm;
uniform vec3 uInteriorCool;
uniform vec3 uGlassSky;
uniform float uLocalWall;
varying vec2 vFUv;
varying vec4 vFace;
varying vec4 vFloors;
varying vec3 vTan;
varying vec2 vBakeUv;
varying vec3 vWorld3;
varying vec3 vNormalW3;
vec3 gEmit = vec3( 0.0 );
float gRough = 0.85;
float gMetal = 0.0;
float gGlass = 0.0;

// 部屋の中：p = 部屋の正面の位置（0〜1）、d = 視線（部屋の幅・高さ・奥行きを 1 とした単位、z が奥）。kind 0 = 住まいや事務所、1 = 売り場の棚
vec3 fcRoom( vec2 p, vec3 d, float seed, float kind ) {
  vec3 o = vec3( p, 0.0 );
  float tx = d.x > 0.0 ? ( 1.0 - o.x ) / max( d.x, 1e-4 ) : o.x / max( -d.x, 1e-4 );
  float ty = d.y > 0.0 ? ( 1.0 - o.y ) / max( d.y, 1e-4 ) : o.y / max( -d.y, 1e-4 );
  float tz = 1.0 / max( d.z, 1e-4 );
  float t = min( min( tx, ty ), tz );
  vec3 h = o + d * t;
  float r1 = fcHash( vec2( seed, 1.7 ) );
  float r2 = fcHash( vec2( seed, 9.1 ) );
  float r3 = fcHash( vec2( seed, 4.3 ) );
  vec3 wallC = mix( vec3( 0.95, 0.78, 0.58 ), vec3( 0.92, 0.88, 0.8 ), r1 );
  vec3 c;
  if ( kind > 0.5 ) {
    // 売り場：壁一面の棚に色とりどりの箱
    vec2 sp = t == tz ? h.xy : ( t == tx ? vec2( h.z * 1.6, h.y ) : vec2( h.x, h.z ) );
    // 白い棚に、白っぽい箱（絵の入った箱は色がある）
    float rows = 3.0;
    float row = floor( sp.y * rows );
    float fy = fract( sp.y * rows );
    float cols = 4.0;
    float xi = sp.x * cols + row * 0.37;
    float item = floor( xi );
    float fx = fract( xi );
    float hue = fcHash( vec2( item, row + seed * 3.1 ) );
    vec3 box = fcHsv( hue, 0.45 + 0.3 * fcHash( vec2( item + 3.0, row ) ), 0.92 );
    // 箱の白い地と、色の帯
    float band = step( 0.35, fract( fy * 1.0 + fx * 0.3 ) ) * step( fract( fy * 1.0 + fx * 0.3 ), 0.62 );
    box = mix( vec3( 0.96, 0.95, 0.93 ), box, mix( 0.25, 0.9, band ) * step( 0.55, fcHash( vec2( item, row + 11.0 ) ) ) );
    float isBox = step( 0.16, fy ) * step( fy, 0.88 - 0.25 * fcHash( vec2( item, row + 5.0 ) ) ) * step( 0.07, fx ) * step( fx, 0.93 );
    vec3 shelf = vec3( 0.94, 0.92, 0.88 );
    // 棚板（明るい）と、箱のすき間（暗い奥）
    float plank = 1.0 - step( 0.1, fy );
    c = mix( mix( vec3( 0.32, 0.3, 0.29 ), shelf, plank ), box, isBox );
    if ( t == ty ) {
      if ( d.y > 0.0 ) {
        c = vec3( 1.0, 0.96, 0.9 ) * 1.2;
        c += 2.0 * smoothstep( 0.1, 0.03, abs( fract( h.x * 2.0 ) - 0.5 ) ) * smoothstep( 0.45, 0.35, abs( h.z - 0.5 ) );
      } else {
        c = vec3( 0.75, 0.68, 0.6 ) * ( 0.85 + 0.15 * fcNoise( h.xz * 8.0 ) );
      }
    }
  } else {
    if ( t == tz ) {
      c = wallC;
      // 家具の影（机・棚）、壁の絵
      float furn = step( h.y, 0.32 + 0.25 * r2 ) * step( abs( h.x - 0.25 - 0.5 * r3 ), 0.22 );
      c = mix( c, c * vec3( 0.42, 0.36, 0.32 ), furn );
      float pic = step( abs( h.x - 0.7 + 0.3 * r2 ), 0.08 ) * step( abs( h.y - 0.62 ), 0.07 ) * step( 0.5, r1 );
      c = mix( c, fcHsv( r3, 0.5, 0.6 ), pic );
    } else if ( t == ty ) {
      if ( d.y > 0.0 ) {
        c = vec3( 1.0, 0.95, 0.86 ) * 1.1;
        c += 1.6 * smoothstep( 0.16, 0.08, abs( h.x - 0.5 ) ) * smoothstep( 0.3, 0.2, abs( h.z - 0.45 ) );
      } else {
        c = mix( vec3( 0.42, 0.3, 0.2 ), vec3( 0.6, 0.55, 0.5 ), r2 ) * 0.8;
      }
    } else {
      c = wallC * 0.82;
      float shelfS = step( h.y, 0.75 ) * step( 0.25, h.z ) * step( h.z, 0.8 ) * step( 0.55, r1 );
      c = mix( c, c * 0.55, shelfS );
    }
  }
  // 奥ほどわずかに暗く
  c *= mix( 1.0, 0.72, h.z );
  return c;
}

// 窓ガラスの映り込み（空と地面の簡単な近似）
vec3 fcGlassReflect( vec3 V, vec3 N ) {
  vec3 R = reflect( V, N );
  float up = clamp( R.y * 1.5 + 0.35, 0.0, 1.0 );
  return mix( vec3( 0.06, 0.05, 0.05 ), uGlassSky, up );
}
`,
      )
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
{
  vec3 nW = normalize( vNormalW3 );
  vec3 V = normalize( vWorld3 - cameraPosition );
  float style = floor( vFace.z + 0.5 );
  vec3 baseC = uPalette[ int( style ) ];
  float seed = vFace.w;
  vec2 uv = vFUv;
  vec3 c = baseC;
  if ( style > 8.5 && style < 10.5 ) {
    // 屋上（9）・笠木（10）：コンクリートのしみ、目地
    vec2 q = uv;
    float n1 = fcNoise( q * 3.1 + seed );
    float n2 = fcNoise( q * 17.0 + seed * 1.3 );
    c = baseC * ( 0.82 + 0.22 * n1 + 0.08 * n2 );
    if ( style < 9.5 ) {
      vec2 g = abs( fract( q * 2.5 ) - 0.5 );
      float joint = smoothstep( 0.485, 0.495, max( g.x, g.y ) );
      c *= 1.0 - 0.18 * joint;
      // 水の跡（暗いしみ）
      c *= 1.0 - 0.25 * smoothstep( 0.55, 0.8, fcNoise( q * 1.3 + seed * 2.0 ) );
    }
    gRough = 0.92;
  } else {
    float L = vFace.x;
    float H = vFace.y;
    float gH = vFloors.x;
    float fH0 = vFloors.y;
    float wkRaw = floor( vFloors.z + 0.5 );
    float shop = step( 9.5, wkRaw );
    float wk = wkRaw - 10.0 * shop;
    float lit = floor( vFloors.w / 10.0 ) / 100.0;
    float bay0 = vFloors.w - floor( vFloors.w / 10.0 ) * 10.0;
    // 縁の立ち上がり（屋上より上）
    float isPar = step( H, uv.y );
    // --- 壁の仕上げ
    if ( style < 3.5 || style > 10.5 || ( style > 6.5 && style < 8.5 ) ) {
      // タイル（ベージュ・灰・暖色・暗い・白）、えんじ・赤のタイル
      float ts = 0.1;
      vec2 q = uv / ts;
      vec2 cell = floor( q );
      vec2 fq = fract( q );
      float aa = clamp( ( fwidth( q.x ) + fwidth( q.y ) ) * 0.6, 0.0, 1.0 );
      float gw = 0.05;
      float tileIn = smoothstep( gw, gw + aa + 0.02, fq.x ) * smoothstep( gw, gw + aa + 0.02, fq.y );
      float tv = fcHash( cell + seed * 13.0 ) - 0.5;
      // 建物ごとのわずかな色の違い
      vec3 bvar = vec3( 1.0 ) + 0.07 * ( vec3( fcHash( vec2( seed, 1.0 ) ), fcHash( vec2( seed, 2.0 ) ), fcHash( vec2( seed, 3.0 ) ) ) - 0.5 );
      c = baseC * bvar * ( 1.0 + 0.12 * tv );
      float groutK = mix( 0.9, 0.2, aa );
      c = mix( c * ( 1.0 + 0.22 * groutK ), c, tileIn );
      // 目地の際の細い影（タイルの下と右）
      c *= 1.0 - 0.12 * ( smoothstep( gw + 0.12, gw, fq.y ) * tileIn ) * ( 1.0 - aa );
      gRough = 0.78;
    } else if ( style > 4.5 && style < 5.5 ) {
      // 青い金属のパネル：縦の継ぎ目
      float seam = smoothstep( 0.46, 0.49, abs( fract( uv.x / 0.14 ) - 0.5 ) );
      c = baseC * ( 0.95 + 0.08 * fcNoise( vec2( floor( uv.x / 0.14 ), uv.y * 2.0 ) ) );
      c *= 1.0 - 0.35 * seam;
      gRough = 0.5;
      gMetal = 0.25;
    } else if ( style > 5.5 && style < 6.5 ) {
      // コンクリート
      c = baseC * ( 0.86 + 0.18 * fcNoise( uv * 3.0 + seed ) + 0.06 * fcNoise( uv * 31.0 ) );
      gRough = 0.9;
    }
    // 汚れ：大きなむら、上から垂れる縦の筋、足もとの黒ずみ、角の柱（少し明るい）
    float big = fcNoise( uv * vec2( 1.3, 0.7 ) + seed );
    float streak = fcNoise( vec2( uv.x * 9.0 + seed, uv.y * 0.6 ) );
    float streak2 = fcNoise( vec2( uv.x * 23.0 + seed * 1.7, uv.y * 1.3 ) );
    c *= 0.86 + 0.22 * big;
    c *= 1.0 - 0.2 * smoothstep( 0.55, 0.9, streak ) * smoothstep( 0.0, 1.5, H - uv.y + 0.6 );
    c *= 1.0 - 0.1 * smoothstep( 0.6, 0.95, streak2 );
    c *= mix( 0.82, 1.0, smoothstep( 0.0, 0.5, uv.y ) );
    float pil = 1.0 - smoothstep( 0.035, 0.05, min( uv.x, L - uv.x ) );
    c = mix( c, uPalette[ 10 ] * ( 0.9 + 0.12 * big ), pil * 0.45 * step( 0.5, 10.5 - style ) );
    // 縁の立ち上がりは少し明るい笠木の色に
    c = mix( c, uPalette[ 10 ] * ( 0.9 + 0.1 * big ), isPar * 0.7 );

    vec3 T = normalize( vTan );
    vec3 Vl = vec3( dot( V, T ), V.y, -dot( V, nW ) );
    float front = step( 0.02, Vl.z );
    // --- 1 階の店先
    if ( shop > 0.5 && uv.y < gH ) {
      float plinth = 0.03;
      float fascia = 0.1;
      float sbay = 0.34;
      float nb = max( 1.0, floor( L / sbay + 0.5 ) );
      float bw = L / nb;
      float bx = uv.x / bw;
      float bi = floor( bx );
      float fx = fract( bx );
      float gy = ( uv.y - plinth ) / ( gH - plinth - fascia );
      float mull = 1.0 - smoothstep( 0.015, 0.03, min( fx, 1.0 - fx ) * bw );
      if ( uv.y < plinth ) {
        c = vec3( 0.08, 0.075, 0.07 );
      } else if ( gy > 1.0 ) {
        // 看板の帯
        c = mix( vec3( 0.16, 0.14, 0.13 ), baseC * 0.5, 0.3 );
        gRough = 0.6;
      } else {
        vec3 d = vec3( Vl.x / bw, Vl.y / ( gH - plinth - fascia ), Vl.z / 0.7 );
        vec3 room = fcRoom( vec2( fx, clamp( gy, 0.0, 1.0 ) ), d, seed * 5.7 + bi * 1.31, 1.0 );
        float sh = 0.85 + 0.3 * fcHash( vec2( seed, bi ) );
        gEmit = room * mix( uInteriorWarm, uInteriorCool, 0.3 ) * uShopGlow * sh * front * ( 1.0 - mull );
        c = mix( vec3( 0.02 ), vec3( 0.1, 0.1, 0.11 ), mull );
        gGlass = 1.0 - mull;
        gRough = mix( 0.12, 0.5, mull );
        gMetal = mull * 0.6;
      }
    } else if ( isPar < 0.5 && wk > 0.5 ) {
      // --- 窓
      float margin = 0.08;
      float bay = bay0 > 0.05 ? bay0 : 0.5;
      float span = max( L - 2.0 * margin, 0.05 );
      float nb = max( 1.0, floor( span / bay + 0.5 ) );
      float bw = span / nb;
      float x = uv.x - margin;
      float bi = floor( x / bw );
      float fx = fract( x / bw );
      float inBays = step( 0.0, x ) * step( x, span );
      float nF = max( 1.0, floor( ( H - gH ) / fH0 + 0.3 ) );
      float fH = ( H - gH ) / nF;
      float fy0 = ( uv.y - gH ) / fH;
      float fi = floor( fy0 );
      float fy = fract( fy0 );
      float upper = step( gH, uv.y );
      // 店先でない 1 階は、1 階の高さを 1 つの階として扱う
      if ( upper < 0.5 ) {
        fi = -1.0;
        fy = uv.y / gH;
      }
      float fHc = upper > 0.5 ? fH : gH;
      // 窓の大きさ（柱間・階の高さに対する割合）と下端
      vec3 wsz = vec3( 0.6, 0.55, 0.24 );
      if ( wk > 1.5 && wk < 2.5 ) wsz = vec3( 0.84, 0.46, 0.3 );
      if ( wk > 2.5 && wk < 3.5 ) wsz = vec3( 0.96, 0.82, 0.1 );
      if ( wk > 3.5 && wk < 4.5 ) wsz = vec3( 0.28, 0.3, 0.38 );
      if ( wk > 4.5 ) wsz = vec3( 0.42, 0.66, 0.18 );
      // 柱間ごとに窓の有無を少し変える（小さな窓の面）
      float wpx = wsz.x * bw;
      float wpy = wsz.y * fHc;
      float dx = ( fx - 0.5 ) * bw;
      float dy = ( fy - wsz.z ) * fHc;
      float wx = dx / wpx + 0.5;
      float wy = dy / wpy;
      float inWin = inBays * step( 0.0, wx ) * step( wx, 1.0 ) * step( 0.0, wy ) * step( wy, 1.0 );
      // 床の帯（各階の床の位置）
      float band = ( 1.0 - smoothstep( 0.0, 0.03, fy * fHc ) ) * upper;
      c *= 1.0 - 0.1 * band;
      // 窓の下の汚れの筋
      float under = inBays * step( abs( wx - 0.5 ), 0.45 ) * step( dy, 0.0 ) * smoothstep( -0.35, 0.0, dy );
      c *= 1.0 - 0.16 * under * smoothstep( 0.35, 0.75, fcNoise( vec2( uv.x * 55.0, uv.y * 4.0 + seed ) ) );
      // 水切り（窓の下の出っ張り）と、その下の影
      float sillW = abs( wx - 0.5 ) * wpx - 0.5 * wpx - 0.018;
      float sill = inBays * step( sillW, 0.0 ) * step( -0.022, dy ) * step( dy, 0.0 );
      float sillShadow = inBays * step( sillW, 0.0 ) * step( -0.045, dy ) * step( dy, -0.022 );
      c = mix( c, uPalette[ 10 ] * 1.05, sill );
      c *= 1.0 - 0.3 * sillShadow;
      if ( inWin > 0.5 ) {
        float fr = wk > 2.5 && wk < 3.5 ? 0.026 : 0.022;
        float edge = min( min( wx, 1.0 - wx ) * wpx, min( wy, 1.0 - wy ) * wpy );
        float frame = 1.0 - smoothstep( fr * 0.75, fr, edge );
        // 縦の桟（幅の広い窓とカーテンウォール）、引き違いの真ん中の桟
        float mullion = 0.0;
        float mcount = wk > 2.5 && wk < 3.5 ? 3.0 : 2.0;
        float mx = fract( wx * mcount );
        mullion = 1.0 - smoothstep( 0.005, 0.009, min( mx, 1.0 - mx ) * wpx / mcount );
        float roomSeed = seed * 3.7 + bi * 1.91 + fi * 7.3;
        float on = step( fcHash( vec2( roomSeed, 2.2 ) ), lit );
        float kind = wk > 2.5 && wk < 3.5 ? 1.0 : 0.0;
        // 部屋は柱間 1 つ分の幅、1 階分の高さ、奥行き 0.42
        vec2 rp = vec2( fx, fy );
        vec3 d = vec3( Vl.x / bw, Vl.y / fHc, Vl.z / ( kind > 0.5 ? 0.6 : 0.42 ) );
        vec3 room = fcRoom( rp, d, roomSeed, kind );
        float warm = fcHash( vec2( roomSeed, 5.5 ) );
        vec3 lightC = kind > 0.5 ? mix( uInteriorWarm, uInteriorCool, 0.3 ) : mix( uInteriorWarm, uInteriorCool, step( 0.82, warm ) );
        float bright = ( 0.7 + 0.6 * fcHash( vec2( roomSeed, 8.8 ) ) ) * ( kind > 0.5 ? uShopGlow * 0.75 : uWindowGlow );
        // カーテン・ブラインド（明かりの部屋の一部）
        float blind = step( 0.66, fcHash( vec2( roomSeed, 3.3 ) ) ) * ( 1.0 - kind );
        float slat = 0.65 + 0.35 * step( 0.5, fract( wy * 16.0 ) );
        float blindCover = blind * step( 1.0 - 0.3 - 0.55 * fcHash( vec2( roomSeed, 4.4 ) ), wy );
        vec3 inside = mix( room, vec3( 0.95, 0.85, 0.7 ) * slat, blindCover );
        // ガラスの奥の陰（上の枠の影）
        float recess = 1.0 - 0.55 * ( 1.0 - smoothstep( 0.0, 0.05, ( 1.0 - wy ) * wpy - fr ) );
        vec3 refl = fcGlassReflect( V, nW );
        float fres = 0.05 + 0.6 * pow( 1.0 - clamp( Vl.z, 0.0, 1.0 ), 4.0 );
        float solid = max( frame, mullion );
        gEmit = ( on * inside * lightC * bright * recess * front + refl * fres * ( 1.0 - on * 0.5 ) ) * ( 1.0 - solid );
        // 消えた部屋は、暗い青灰色のガラス
        vec3 glassDark = vec3( 0.035, 0.04, 0.05 ) + room * 0.015;
        c = mix( glassDark, wk > 2.5 && wk < 3.5 ? vec3( 0.1, 0.1, 0.11 ) : vec3( 0.58, 0.56, 0.53 ), solid );
        gGlass = 1.0 - solid;
        gRough = mix( 0.08, 0.45, solid );
        gMetal = solid * 0.4;
      } else if ( wk > 2.5 && wk < 3.5 && inBays > 0.5 && upper > 0.5 ) {
        // カーテンウォールの床の帯（暗い）
        c = vec3( 0.09, 0.085, 0.09 );
        gRough = 0.4;
      }
    }
  }
  diffuseColor.rgb = c;
}`,
      )
      .replace(
        '#include <roughnessmap_fragment>',
        `#include <roughnessmap_fragment>
roughnessFactor = gRough;`,
      )
      .replace(
        '#include <metalnessmap_fragment>',
        `#include <metalnessmap_fragment>
metalnessFactor = gMetal;`,
      )
      .replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
totalEmissiveRadiance = gEmit;`,
      )
      .replace(
        '#include <lights_fragment_begin>',
        `vec3 gAtlasOcc = clamp( texture2D( uAtlas, vBakeUv ).rgb, 0.0, 1.0 );
gBakedVis = 1.0 - uShadowStrength * gAtlasOcc.rb;
${lightsBeginWithBakedVisibility()}`,
      )
      .replace(
        '#include <lights_fragment_end>',
        `#include <lights_fragment_end>
${TINT_APPLY}
{
  vec3 nW = normalize( vNormalW3 );
  // 空の遮られ方：遮るものがないときの見え方（壁なら半分）を基準にする
  float f0 = 0.5 + 0.5 * max( nW.y, 0.0 );
  float skyVis = clamp( ( 1.0 - gAtlasOcc.g ) / f0, 0.0, 1.0 );
  reflectedLight.indirectDiffuse *= mix( 1.0, skyVis, uAoStrength );
  // 街の明かり（面のすぐ外の位置で読む）
  vec3 lp = vWorld3 + vec3( nW.x, 0.0, nW.z ) * 0.12;
  reflectedLight.indirectDiffuse += diffuseColor.rgb * localLightAt( lp, nW ) * uLocalWall * ( 1.0 - gGlass * 0.9 );
}`,
      );
  };
  material.customProgramCacheKey = () => 'town-facade';
  return {
    material,
    setAtlas: (t: THREE.Texture) => {
      uniforms.uAtlas.value = t;
    },
  };
}
