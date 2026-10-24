import * as THREE from 'three';
import type { SceneConfig } from './config';
import { mulberry32 } from './noise';
import { createBakeTarget, type PointReceiver } from './lightBaker';
import { BAKED_VISIBILITY_FUNCTIONS, lightsBeginWithBakedVisibility } from './bakedLighting';
import type { TerrainLayout } from './terrain/layout';

export interface Props {
  group: THREE.Group;
  casters: THREE.Mesh[];
  receivers: PointReceiver[];
  disks: { x: number; z: number; r: number }[];
}

/**
 * 小物：右岸の倒木（白っぽく乾いた樹皮の幹、折れた先と、根元の根の張り出し）。
 * 形は先細りの管をつないで作り、影は頂点ごとに焼き込む。
 */
export function createProps(renderer: THREE.WebGLRenderer, config: SceneConfig, layout: TerrainLayout): Props {
  const cfg = config.props;
  const group = new THREE.Group();
  group.name = 'props';
  const pos: number[] = [];
  const nor: number[] = [];
  const loc: number[] = [];
  const idx: number[] = [];
  const rnd = mulberry32(31);
  /** 管（a から b、半径 ra から rb）。along は樹皮の筋の向きの座標の始まり */
  const tube = (a: THREE.Vector3, b: THREE.Vector3, ra: number, rb: number, along: number, sides = 10, rough = 0.12) => {
    const axis = b.clone().sub(a);
    const len = axis.length();
    axis.normalize();
    const helper = Math.abs(axis.y) < 0.9 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0);
    const u = new THREE.Vector3().crossVectors(axis, helper).normalize();
    const w = new THREE.Vector3().crossVectors(axis, u).normalize();
    const rings = Math.max(2, Math.ceil(len / 0.06));
    const base = pos.length / 3;
    for (let r = 0; r <= rings; r++) {
      const t = r / rings;
      const c = a.clone().addScaledVector(axis, len * t);
      const rad = ra + (rb - ra) * t;
      for (let i = 0; i <= sides; i++) {
        const ang = (i / sides) * Math.PI * 2;
        const n = u.clone().multiplyScalar(Math.cos(ang)).addScaledVector(w, Math.sin(ang));
        // 樹皮のでこぼこ（縦の筋）
        const bump = 1 + rough * (Math.sin(ang * 7 + t * 3) * 0.5 + (rnd() - 0.5) * 0.4) * 0.3;
        pos.push(...c.clone().addScaledVector(n, rad * bump).toArray());
        nor.push(n.x, n.y, n.z);
        loc.push(along + len * t, ang / (Math.PI * 2), rad);
      }
    }
    for (let r = 0; r < rings; r++) {
      for (let i = 0; i < sides; i++) {
        const a0 = base + r * (sides + 1) + i;
        const a1 = a0 + 1;
        const b0 = a0 + sides + 1;
        const b1 = b0 + 1;
        idx.push(a0, b0, a1, a1, b0, b1);
      }
    }
  };
  /** 折れた先：ぎざぎざの切り口（中心へ向かう三角形の扇） */
  const brokenEnd = (c: THREE.Vector3, axis: THREE.Vector3, rad: number) => {
    const helper = Math.abs(axis.y) < 0.9 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0);
    const u = new THREE.Vector3().crossVectors(axis, helper).normalize();
    const w = new THREE.Vector3().crossVectors(axis, u).normalize();
    const sides = 10;
    const center = c.clone().addScaledVector(axis, rad * 0.4);
    const base = pos.length / 3;
    pos.push(...center.toArray());
    nor.push(axis.x, axis.y, axis.z);
    loc.push(-1, 0, 0);
    for (let i = 0; i <= sides; i++) {
      const ang = (i / sides) * Math.PI * 2;
      const n = u.clone().multiplyScalar(Math.cos(ang)).addScaledVector(w, Math.sin(ang));
      const jag = (rnd() - 0.3) * rad * 0.9;
      pos.push(...c.clone().addScaledVector(n, rad).addScaledVector(axis, jag).toArray());
      nor.push(axis.x * 0.6 + n.x * 0.4, axis.y * 0.6 + n.y * 0.4, axis.z * 0.6 + n.z * 0.4);
      loc.push(-1, 0, 0);
    }
    for (let i = 0; i < sides; i++) idx.push(base, base + 1 + i, base + 2 + i);
  };
  const disks: { x: number; z: number; r: number }[] = [];
  for (const lg of cfg.logs) {
    const [x0, z0, x1, z1, r0, r1] = lg;
    const g0 = layout.heightAt(x0, z0);
    const g1 = layout.heightAt(x1, z1);
    const a = new THREE.Vector3(x0, g0 + r0 * 0.65, z0);
    const b = new THREE.Vector3(x1, g1 + r1 * 0.65, z1);
    const axis = b.clone().sub(a).normalize();
    // 幹（少し曲がる）
    const mid = a.clone().lerp(b, 0.5).add(new THREE.Vector3(0, 0.02, 0));
    tube(a, mid, r0, (r0 + r1) * 0.5, 0);
    tube(mid, b, (r0 + r1) * 0.5, r1, a.distanceTo(mid));
    brokenEnd(b, axis, r1);
    // 根元：根の張り出し（放射状の短い根）と、根元の切り口
    const side = new THREE.Vector3(-axis.z, 0, axis.x);
    // 根：横と下へ張り出し、先は地面にもぐる（上へは伸ばさない）
    for (let i = 0; i < 5; i++) {
      const ang = -0.35 * Math.PI + (i / 4) * 0.7 * Math.PI + (rnd() - 0.5) * 0.3;
      const sd = i % 2 === 0 ? 1 : -1;
      const dir = side.clone().multiplyScalar(sd * Math.cos(ang)).add(new THREE.Vector3(0, -0.35 + 0.45 * Math.sin(ang) * 0.5, 0)).addScaledVector(axis, -0.55).normalize();
      const end = a.clone().addScaledVector(dir, r0 * (1.6 + 0.9 * rnd()));
      end.y = Math.min(end.y, layout.heightAt(end.x, end.z) - 0.01);
      tube(a.clone().addScaledVector(axis, r0 * 0.4), end, r0 * 0.5, r0 * 0.14, 0, 6, 0.3);
    }
    brokenEnd(a, axis.clone().negate(), r0 * 0.95);
    // 折れた枝の付け根
    for (const t of [0.35, 0.62]) {
      const p = a.clone().lerp(b, t);
      const dir = new THREE.Vector3(0, 1, 0).addScaledVector(side, rnd() < 0.5 ? 0.6 : -0.6).normalize();
      tube(p, p.clone().addScaledVector(dir, 0.18 + 0.1 * rnd()), r0 * 0.3, r0 * 0.12, 0, 6);
    }
    for (let t = 0; t <= 1; t += 0.25) {
      const p = a.clone().lerp(b, t);
      disks.push({ x: p.x, z: p.z, r: r0 * 1.6 });
    }
  }
  const count = pos.length / 3;
  const bakeW = 1024;
  const bakeH = Math.max(1, Math.ceil(count / bakeW));
  const bakeUv = new Float32Array(count * 2);
  for (let v = 0; v < count; v++) {
    bakeUv[v * 2] = ((v % bakeW) + 0.5) / bakeW;
    bakeUv[v * 2 + 1] = (Math.floor(v / bakeW) + 0.5) / bakeH;
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  geometry.setAttribute('aLocal', new THREE.Float32BufferAttribute(loc, 3));
  geometry.setAttribute('bakeUv', new THREE.BufferAttribute(bakeUv, 2));
  geometry.setIndex(idx);
  geometry.computeBoundingSphere();
  const target = createBakeTarget(renderer, bakeW, bakeH);
  target.texture.minFilter = THREE.NearestFilter;
  target.texture.magFilter = THREE.NearestFilter;
  const material = createBarkMaterial(cfg.logColor, target.texture, config.shadow.strength);
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = 'props-log';
  group.add(mesh);
  group.updateMatrixWorld(true);
  const pts = new THREE.BufferGeometry();
  pts.setAttribute('position', geometry.attributes.position);
  pts.setAttribute('normal', geometry.attributes.normal);
  pts.setAttribute('bakeUv', geometry.attributes.bakeUv);
  return {
    group,
    casters: [new THREE.Mesh(geometry)],
    receivers: [{ target, geometry: pts, matrixWorld: new THREE.Matrix4(), normalOffset: 0.035 }],
    disks,
  };
}

/** 乾いた樹皮：幹に沿った縦の筋と割れ目、明るく白っぽい木肌（切り口は明るい木の色） */
function createBarkMaterial(color: string, bake: THREE.Texture, shadow: number): THREE.MeshStandardMaterial {
  const material = new THREE.MeshStandardMaterial({ color: new THREE.Color(color), roughness: 0.95, metalness: 0 });
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uBkBake = { value: bake };
    shader.uniforms.uBkShadow = { value: shadow };
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
attribute vec2 bakeUv;
attribute vec3 aLocal;
uniform sampler2D uBkBake;
varying vec3 vBkOcc;
varying vec3 vBkLocal;`,
      )
      .replace('#include <project_vertex>', '#include <project_vertex>\nvBkOcc = texture2D( uBkBake, bakeUv ).rgb;\nvBkLocal = aLocal;');
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
uniform float uBkShadow;
varying vec3 vBkOcc;
varying vec3 vBkLocal;
${BAKED_VISIBILITY_FUNCTIONS}
float bkHash( vec2 p ) {
  return fract( sin( dot( p, vec2( 127.1, 311.7 ) ) ) * 43758.5453 );
}
float bkNoise( vec2 p ) {
  vec2 i = floor( p );
  vec2 f = fract( p );
  vec2 u = f * f * ( 3.0 - 2.0 * f );
  return mix( mix( bkHash( i ), bkHash( i + vec2( 1.0, 0.0 ) ), u.x ), mix( bkHash( i + vec2( 0.0, 1.0 ) ), bkHash( i + vec2( 1.0, 1.0 ) ), u.x ), u.y );
}`,
      )
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
if ( vBkLocal.x < -0.5 ) {
  // 切り口：明るい木の色
  diffuseColor.rgb = vec3( 0.78, 0.66, 0.5 );
} else {
  vec2 q = vec2( vBkLocal.y * 22.0, vBkLocal.x * 3.0 );
  float streak = bkNoise( q ) * 0.6 + bkNoise( q * vec2( 2.3, 3.1 ) + 4.0 ) * 0.4;
  float crack = smoothstep( 0.72, 0.9, bkNoise( vec2( vBkLocal.y * 30.0, vBkLocal.x * 1.5 ) ) );
  diffuseColor.rgb *= ( 0.82 + 0.3 * streak ) * ( 1.0 - 0.45 * crack );
}`,
      )
      .replace(
        '#include <lights_fragment_begin>',
        `gBakedVis = 1.0 - uBkShadow * clamp( vBkOcc.rb, 0.0, 1.0 );
${lightsBeginWithBakedVisibility()}`,
      )
      .replace(
        '#include <lights_fragment_end>',
        `#include <lights_fragment_end>
reflectedLight.indirectDiffuse *= max( 1.0 - 0.8 * clamp( vBkOcc.g, 0.0, 1.0 ), 0.35 );`,
      );
  };
  material.customProgramCacheKey = () => 'dino-bark';
  return material;
}
