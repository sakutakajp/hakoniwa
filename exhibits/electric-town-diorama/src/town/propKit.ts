import * as THREE from 'three';
import { BAKED_VISIBILITY_FUNCTIONS, lightsBeginWithBakedVisibility } from '../bakedLighting';
import { createBakeTarget, type PointReceiver } from '../lightBaker';
import { LOCAL_LIGHT_GLSL, TINT_APPLY, TINT_DECL, type TownEnv } from './env';

/**
 * 小物（室外機・街灯・木・人・車…）の共通の道具。
 *  - ProbeSet：小物 1 つにつき 1 点の「光の当たり具合」（主光・空・補助光の遮られ方）を焼き込む
 *  - PropBatch：同じ形の小物をまとめて描く（InstancedMesh）。色と、焼き込みの点の番号を 1 つずつ持つ
 *  - createPropMaterial：焼き込みの点・街の明かり・夕方の色調を使う標準のマテリアル
 */
export class ProbeSet {
  private pos: number[] = [];
  private nor: number[] = [];
  readonly width = 256;
  target: THREE.WebGLRenderTarget | null = null;

  add(p: THREE.Vector3, n: THREE.Vector3 = new THREE.Vector3(0, 1, 0)): number {
    this.pos.push(p.x, p.y, p.z);
    this.nor.push(n.x, n.y, n.z);
    return this.pos.length / 3 - 1;
  }

  get count() {
    return this.pos.length / 3;
  }

  /** 焼き込みの受け手（点の番号 i を、焼き込み先の (i % 幅, i / 幅) の画素に書く） */
  receiver(renderer: THREE.WebGLRenderer, normalOffset: number): PointReceiver {
    const n = Math.max(1, this.count);
    const h = Math.max(1, Math.ceil(n / this.width));
    const uv: number[] = [];
    for (let i = 0; i < n; i++) uv.push(((i % this.width) + 0.5) / this.width, (Math.floor(i / this.width) + 0.5) / h);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos.length ? this.pos : [0, -100, 0], 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor.length ? this.nor : [0, 1, 0], 3));
    g.setAttribute('bakeUv', new THREE.Float32BufferAttribute(uv, 2));
    this.target = createBakeTarget(renderer, this.width, h);
    this.target.texture.minFilter = THREE.NearestFilter;
    this.target.texture.magFilter = THREE.NearestFilter;
    return { target: this.target, geometry: g, matrixWorld: new THREE.Matrix4(), normalOffset };
  }
}

const blankProbe = (() => {
  const t = new THREE.DataTexture(new Uint8Array([0, 0, 0, 255]), 1, 1);
  t.needsUpdate = true;
  return t;
})();

export interface PropMaterialOptions {
  roughness?: number;
  metalness?: number;
  /** 光る部分：頂点の色の a（アルファ）が 1 の所を、色 × glow で光らせる */
  glow?: number;
  /** 街の明かりの受け方 */
  local?: number;
  /** 影の濃さ（焼き込みの点の効き方） */
  shadow?: number;
  side?: THREE.Side;
  /** 両面のとき、裏から見ても法線を裏返さない（葉の板など） */
  keepNormal?: boolean;
  key?: string;
  /** 追加のシェーダー（色の後に実行。diffuseColor を書き換えられる） */
  colorChunk?: string;
  declarations?: string;
  vertexChunk?: string;
  vertexDeclarations?: string;
}

/**
 * 小物の標準マテリアル。頂点の色（color）× インスタンスの色（instanceColor）を地の色にする。
 * attribute aProbe（インスタンスごとの焼き込みの点の番号）を読む
 */
export function createPropMaterial(env: TownEnv, probes: ProbeSet, o: PropMaterialOptions = {}) {
  const material = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    roughness: o.roughness ?? 0.7,
    metalness: o.metalness ?? 0,
    vertexColors: true,
    side: o.side ?? THREE.FrontSide,
  });
  const uniforms = {
    uProbeTex: { value: blankProbe as THREE.Texture },
    uProbeW: { value: probes.width },
    uPropGlow: { value: o.glow ?? 0 },
    uPropLocal: { value: o.local ?? 1 },
    uPropShadow: { value: o.shadow ?? 1 },
  };
  material.onBeforeCompile = (shader) => {
    if (probes.target) uniforms.uProbeTex.value = probes.target.texture;
    Object.assign(shader.uniforms, env.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
attribute float aProbe;
uniform sampler2D uProbeTex;
uniform float uProbeW;
varying vec3 vProbe;
varying vec3 vPWorld;
varying vec3 vPNormal;
varying float vGlowMask;
${o.vertexDeclarations ?? ''}`,
      )
      .replace(
        '#include <color_vertex>',
        `#include <color_vertex>
#ifdef USE_COLOR_ALPHA
vGlowMask = color.a;
#else
vGlowMask = 0.0;
#endif`,
      )
      .replace(
        '#include <project_vertex>',
        `#include <project_vertex>
{
  int pi = int( aProbe + 0.5 );
  ivec2 ps = textureSize( uProbeTex, 0 );
  vProbe = ps.x > 1 ? texelFetch( uProbeTex, ivec2( pi % int( uProbeW ), pi / int( uProbeW ) ), 0 ).rgb : vec3( 0.0 );
#ifdef USE_INSTANCING
  vPWorld = ( modelMatrix * instanceMatrix * vec4( transformed, 1.0 ) ).xyz;
  vPNormal = normalize( mat3( modelMatrix ) * mat3( instanceMatrix ) * objectNormal );
#else
  vPWorld = ( modelMatrix * vec4( transformed, 1.0 ) ).xyz;
  vPNormal = normalize( mat3( modelMatrix ) * objectNormal );
#endif
}
${o.vertexChunk ?? ''}`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
${LOCAL_LIGHT_GLSL}
${TINT_DECL}
${BAKED_VISIBILITY_FUNCTIONS}
uniform float uPropGlow;
uniform float uPropLocal;
uniform float uPropShadow;
varying vec3 vProbe;
varying vec3 vPWorld;
varying vec3 vPNormal;
varying float vGlowMask;
vec3 gPropEmit = vec3( 0.0 );
${o.declarations ?? ''}`,
      )
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
${o.colorChunk ?? ''}
gPropEmit += diffuseColor.rgb * uPropGlow * vGlowMask;`,
      )
      .replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
totalEmissiveRadiance += gPropEmit;`,
      )
      .replace('#include <normal_fragment_begin>', o.keepNormal ? '#include <normal_fragment_begin>\nnormal = normalize( vNormal );' : '#include <normal_fragment_begin>')
      .replace(
        '#include <lights_fragment_begin>',
        `gBakedVis = 1.0 - uPropShadow * clamp( vProbe.rb, 0.0, 1.0 );
${lightsBeginWithBakedVisibility()}`,
      )
      .replace(
        '#include <lights_fragment_end>',
        `#include <lights_fragment_end>
${TINT_APPLY}
reflectedLight.indirectDiffuse *= 1.0 - 0.85 * clamp( vProbe.g, 0.0, 1.0 );
{
  vec3 nW = normalize( vPNormal );
  reflectedLight.indirectDiffuse += diffuseColor.rgb * localLightAt( vPWorld + vec3( nW.x, 0.0, nW.z ) * 0.05, nW ) * uPropLocal;
}`,
      );
  };
  material.customProgramCacheKey = () => `town-prop-${o.key ?? ''}`;
  return material;
}

/** 同じ形の小物をまとめる */
export class PropBatch {
  private mats: THREE.Matrix4[] = [];
  private cols: THREE.Color[] = [];
  private probeIdx: number[] = [];
  constructor(
    readonly name: string,
    readonly geometry: THREE.BufferGeometry,
    readonly material: THREE.Material,
    readonly probes: ProbeSet,
  ) {}

  /** 1 つ置く。probeAt は焼き込みの点の位置（省略すると置いた位置の少し上） */
  add(matrix: THREE.Matrix4, color: THREE.ColorRepresentation = 0xffffff, probeAt?: THREE.Vector3, probeNormal?: THREE.Vector3) {
    this.mats.push(matrix.clone());
    this.cols.push(new THREE.Color(color));
    const p = probeAt ?? new THREE.Vector3().setFromMatrixPosition(matrix).add(new THREE.Vector3(0, 0.05, 0));
    this.probeIdx.push(this.probes.add(p, probeNormal));
    return this.mats.length - 1;
  }

  get count() {
    return this.mats.length;
  }

  build(): THREE.InstancedMesh | null {
    const n = this.mats.length;
    if (!n) return null;
    const g = this.geometry.clone();
    g.setAttribute('aProbe', new THREE.InstancedBufferAttribute(new Float32Array(this.probeIdx), 1));
    if (!g.getAttribute('color')) {
      const c = new Float32Array(g.getAttribute('position').count * 3).fill(1);
      g.setAttribute('color', new THREE.Float32BufferAttribute(c, 3));
    }
    const mesh = new THREE.InstancedMesh(g, this.material, n);
    mesh.name = this.name;
    this.mats.forEach((m, i) => {
      mesh.setMatrixAt(i, m);
      mesh.setColorAt(i, this.cols[i]);
    });
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    mesh.computeBoundingSphere();
    return mesh;
  }
}

/** 形を作る道具：箱を部品として足していく（頂点の色つき、a が 1 の所は光る） */
export class ShapeBuilder {
  private parts: THREE.BufferGeometry[] = [];

  box(cx: number, cy: number, cz: number, sx: number, sy: number, sz: number, color: THREE.ColorRepresentation = 0xffffff, glow = 0, rotY = 0) {
    const g = new THREE.BoxGeometry(sx, sy, sz);
    if (rotY) g.rotateY(rotY);
    g.translate(cx, cy, cz);
    this.paint(g, color, glow);
    this.parts.push(g);
    return this;
  }

  cylinder(cx: number, cy: number, cz: number, r: number, h: number, color: THREE.ColorRepresentation = 0xffffff, seg = 10, glow = 0, rTop?: number) {
    const g = new THREE.CylinderGeometry(rTop ?? r, r, h, seg);
    g.translate(cx, cy, cz);
    this.paint(g, color, glow);
    this.parts.push(g);
    return this;
  }

  sphere(cx: number, cy: number, cz: number, r: number, color: THREE.ColorRepresentation = 0xffffff, glow = 0, sx = 1, sy = 1, sz = 1, detail = 1) {
    const g = new THREE.IcosahedronGeometry(r, detail);
    g.scale(sx, sy, sz);
    g.translate(cx, cy, cz);
    this.paint(g, color, glow);
    this.parts.push(g);
    return this;
  }

  /** 既にある形を足す（色を塗る。color を null にすると、形の頂点の色（4 成分）をそのまま使う） */
  add(g: THREE.BufferGeometry, color: THREE.ColorRepresentation | null = 0xffffff, glow = 0) {
    const gg = g.index ? g.toNonIndexed() : g.clone();
    const c = gg.getAttribute('color');
    if (color !== null || !c || c.itemSize !== 4) this.paint(gg, color ?? 0xffffff, glow);
    this.parts.push(gg);
    return this;
  }

  private paint(g: THREE.BufferGeometry, color: THREE.ColorRepresentation, glow: number) {
    const c = new THREE.Color(color);
    const n = g.getAttribute('position').count;
    const arr = new Float32Array(n * 4);
    for (let i = 0; i < n; i++) arr.set([c.r, c.g, c.b, glow], i * 4);
    g.setAttribute('color', new THREE.Float32BufferAttribute(arr, 4));
  }

  build(): THREE.BufferGeometry {
    const geos = this.parts.map((g) => (g.index ? g.toNonIndexed() : g));
    // 位置・法線・色だけにそろえてつなぐ
    let total = 0;
    for (const g of geos) total += g.getAttribute('position').count;
    const pos = new Float32Array(total * 3);
    const nor = new Float32Array(total * 3);
    const col = new Float32Array(total * 4);
    const uv = new Float32Array(total * 2);
    let o = 0;
    for (const g of geos) {
      const p = g.getAttribute('position');
      const nn = g.getAttribute('normal');
      const c = g.getAttribute('color');
      const t = g.getAttribute('uv');
      for (let i = 0; i < p.count; i++) {
        pos.set([p.getX(i), p.getY(i), p.getZ(i)], (o + i) * 3);
        nor.set([nn.getX(i), nn.getY(i), nn.getZ(i)], (o + i) * 3);
        col.set([c.getX(i), c.getY(i), c.getZ(i), c.getW(i)], (o + i) * 4);
        if (t) uv.set([t.getX(i), t.getY(i)], (o + i) * 2);
      }
      o += p.count;
    }
    const out = new THREE.BufferGeometry();
    out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    out.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
    out.setAttribute('color', new THREE.BufferAttribute(col, 4));
    out.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    out.computeBoundingSphere();
    return out;
  }
}
