import * as THREE from 'three';
import type { SceneConfig } from '../config';
import { faceFrame, type MassSpec } from './buildings';
import { TINT_APPLY, TINT_DECL, type TownEnv } from './env';
import type { LightSource } from './localLight';
import type { BrandKey } from './brands';
import { drawBlade, drawBrandStrip, drawFascia, drawIconStack, drawTextSign, type IconName } from './signArt';

/**
 * 看板：建物の面に貼る大きな縦長の看板（絵記号を縦に積む）、面から直角に突き出す袖看板（縦書きの文字）、
 * 色の帯（赤いネオンの帯・赤いパネル）。どれも中から光る箱で、絵は 1 枚のキャンバスにまとめて描く
 */
export type SignArt =
  | { kind: 'icons'; panels: { icon: IconName; bg: string; fg: string }[]; frame: string; brand?: BrandKey }
  | { kind: 'text'; text: string; bg: string; fg: string; border?: string; vertical?: boolean }
  | { kind: 'strip'; color: string; light?: string; brand?: BrandKey }
  | { kind: 'fascia'; brand: BrandKey }
  | { kind: 'blade'; brand: BrandKey; floor?: string };

export interface SignSpec {
  /** 取り付ける塊と面 */
  mass: string;
  face: number;
  /** 面に沿った中心の位置（面の始点から。負なら終点から） */
  u: number;
  /** 下端の高さ（歩道から） */
  y: number;
  w: number;
  h: number;
  /** flat：面に貼る、blade：面から直角に突き出す */
  mount: 'flat' | 'blade';
  /** 面からの離れ（flat：すき間、blade：壁から看板の手前の縁まで） */
  off?: number;
  /** 箱の厚み */
  depth?: number;
  art: SignArt;
  /** 光の強さ（0 で光らない） */
  glow?: number;
}

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** キャンバスの中に長方形を棚詰めで並べる */
class Packer {
  private x = 0;
  private y = 0;
  private row = 0;
  constructor(
    readonly w: number,
    readonly h: number,
  ) {}
  alloc(w: number, h: number): Rect {
    const pad = 4;
    if (this.x + w + pad > this.w) {
      this.x = 0;
      this.y += this.row + pad;
      this.row = 0;
    }
    if (this.y + h > this.h) throw new Error('看板のキャンバスに収まりません');
    const r = { x: this.x, y: this.y, w, h };
    this.x += w + pad;
    this.row = Math.max(this.row, h);
    return r;
  }
}

/** 絵の平均の色（光源の色に使う） */
function averageColor(ctx: CanvasRenderingContext2D, r: Rect): THREE.Color {
  const d = ctx.getImageData(r.x, r.y, r.w, r.h).data;
  let R = 0;
  let G = 0;
  let B = 0;
  const step = Math.max(1, Math.floor(d.length / 4 / 600)) * 4;
  let n = 0;
  for (let i = 0; i < d.length; i += step) {
    R += d[i];
    G += d[i + 1];
    B += d[i + 2];
    n++;
  }
  return new THREE.Color().setRGB(R / n / 255, G / n / 255, B / n / 255, THREE.SRGBColorSpace);
}

export function createSigns(config: SceneConfig, env: TownEnv, masses: readonly MassSpec[], specs: readonly SignSpec[], opts: { lowPower: boolean }) {
  const walk = config.town.ground + config.town.curb;
  const byId = new Map(masses.map((m) => [m.id, m]));
  // 1 あたりの画素数（大きな看板でも収まるように）
  const ppu = opts.lowPower ? 150 : 300;
  const size = opts.lowPower ? 1024 : 2048;
  // 絵の大きさ（画素）。背の高い順に棚へ詰める（低い絵が高い棚を無駄にしないように）。入らなければキャンバスを縦に倍にする
  const pix = specs.map((s) => [Math.max(8, Math.round(s.w * ppu)), Math.max(8, Math.round(s.h * ppu))] as const);
  const order = specs.map((_, i) => i).sort((a, b) => pix[b][1] - pix[a][1]);
  let height = size;
  let slots: Rect[] = [];
  for (;;) {
    try {
      const packer = new Packer(size, height);
      slots = [];
      for (const i of order) slots[i] = packer.alloc(pix[i][0], pix[i][1]);
      break;
    } catch (e) {
      if (height >= size * 4) throw e;
      height *= 2;
    }
  }
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, size, height);

  const count = specs.length;
  const geo = new THREE.BoxGeometry(1, 1, 1);
  const material = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.55, metalness: 0 });
  const mesh = new THREE.InstancedMesh(geo, material, count);
  mesh.name = 'signs';
  const rects = new Float32Array(count * 4);
  const glows = new Float32Array(count * 2);
  const lights: LightSource[] = [];
  const m4 = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const basis = new THREE.Matrix4();
  specs.forEach((s, i) => {
    const mass = byId.get(s.mass);
    if (!mass) throw new Error(`看板の建物 ${s.mass} がありません`);
    const f = faceFrame(mass, s.face, walk);
    const u = s.u >= 0 ? s.u : f.len + s.u;
    // 絵を描く
    const r = slots[i];
    const art = s.art;
    if (art.kind === 'icons') {
      drawIconStack(ctx, r.x, r.y, r.w, r.h, art.panels, art.frame, art.brand);
    } else if (art.kind === 'text') {
      drawTextSign(ctx, r.x, r.y, r.w, r.h, art.text, art.bg, art.fg, art.border ?? null, art.vertical ?? s.h > s.w);
    } else if (art.kind === 'fascia') {
      drawFascia(ctx, r.x, r.y, r.w, r.h, art.brand);
    } else if (art.kind === 'blade') {
      drawBlade(ctx, r.x, r.y, r.w, r.h, art.brand, art.floor);
    } else if (art.brand) {
      drawBrandStrip(ctx, r.x, r.y, r.w, r.h, art.brand, art.color, art.light ?? art.color);
    } else {
      const g = ctx.createLinearGradient(r.x, 0, r.x + r.w, 0);
      g.addColorStop(0, art.color);
      g.addColorStop(0.5, art.light ?? art.color);
      g.addColorStop(1, art.color);
      ctx.fillStyle = g;
      ctx.fillRect(r.x, r.y, r.w, r.h);
    }
    // テクスチャの座標（上下は three.js の向き：v は下が 0）
    rects.set([(r.x + 0.5) / size, 1 - (r.y + r.h - 0.5) / height, (r.x + r.w - 0.5) / size, 1 - (r.y + 0.5) / height], i * 4);
    const glow = s.glow ?? 1.25;
    glows.set([glow, s.mount === 'blade' ? 1 : 0], i * 2);
    // 置き方：箱の x = 幅、y = 高さ、z = 厚み
    const depth = s.depth ?? (s.mount === 'blade' ? 0.05 : 0.04);
    const cx0 = f.a[0] + f.t[0] * u;
    const cz0 = f.a[1] + f.t[1] * u;
    const cy = f.base + s.y + s.h / 2;
    let px: number;
    let pz: number;
    if (s.mount === 'flat') {
      const off = (s.off ?? 0.01) + depth / 2;
      px = cx0 + f.n[0] * off;
      pz = cz0 + f.n[1] * off;
      // z 軸 = 外向きの法線、x 軸 = 外から見て右（上 × 法線）
      basis.makeBasis(new THREE.Vector3(f.n[1], 0, -f.n[0]), new THREE.Vector3(0, 1, 0), new THREE.Vector3(f.n[0], 0, f.n[1]));
    } else {
      const off = (s.off ?? 0.04) + s.w / 2;
      px = cx0 + f.n[0] * off;
      pz = cz0 + f.n[1] * off;
      // x 軸 = 外向きの法線（壁から離れる向き）、z 軸 = 法線 × 上（両面に絵）
      basis.makeBasis(new THREE.Vector3(f.n[0], 0, f.n[1]), new THREE.Vector3(0, 1, 0), new THREE.Vector3(-f.n[1], 0, f.n[0]));
    }
    q.setFromRotationMatrix(basis);
    m4.compose(new THREE.Vector3(px, cy, pz), q, new THREE.Vector3(s.w, s.h, depth));
    mesh.setMatrixAt(i, m4);
    // 低い所の看板は足もとを照らす
    if (glow > 0.3 && s.y < 2.2) {
      const c = averageColor(ctx, r);
      const k = glow * Math.min(1, s.w * s.h * 1.6) * (s.y < 1.0 ? 0.55 : 0.3);
      lights.push({
        x: px + f.n[0] * 0.15,
        z: pz + f.n[1] * 0.15,
        radius: 0.7 + s.h * 0.25,
        color: c,
        intensity: k,
      });
    }
  });
  mesh.instanceMatrix.needsUpdate = true;
  geo.setAttribute('aRect', new THREE.InstancedBufferAttribute(rects, 4));
  geo.setAttribute('aGlow', new THREE.InstancedBufferAttribute(glows, 2));

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.needsUpdate = true;

  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, env.uniforms, { uSignAtlas: { value: texture } });
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
attribute vec4 aRect;
attribute vec2 aGlow;
varying vec2 vSUv;
varying float vSFace;
varying vec2 vSGlow;`,
      )
      .replace(
        '#include <uv_vertex>',
        `#include <uv_vertex>
vSUv = mix( aRect.xy, aRect.zw, uv );
// 絵のある面：flat は前（+z）だけ、blade は両面（±z）
vSFace = aGlow.y > 0.5 ? step( 0.5, abs( normal.z ) ) : step( 0.5, normal.z );
vSGlow = aGlow;`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
${TINT_DECL}
uniform sampler2D uSignAtlas;
varying vec2 vSUv;
varying float vSFace;
varying vec2 vSGlow;
vec3 gSignEmit = vec3( 0.0 );`,
      )
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
if ( vSFace > 0.5 ) {
  vec3 t = texture2D( uSignAtlas, vSUv ).rgb;
  // 光る看板は表面がわずかに反射し、ほとんどが内側からの光
  diffuseColor.rgb = t * mix( 1.0, 0.18, clamp( vSGlow.x, 0.0, 1.0 ) );
  gSignEmit = t * vSGlow.x;
} else {
  diffuseColor.rgb = vec3( 0.07, 0.07, 0.075 );
}`,
      )
      .replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
totalEmissiveRadiance = gSignEmit;`,
      )
      .replace('#include <lights_fragment_end>', `#include <lights_fragment_end>\n${TINT_APPLY}`);
  };
  material.customProgramCacheKey = () => 'town-signs';
  return { mesh, lights, texture };
}
