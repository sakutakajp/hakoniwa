import * as THREE from 'three';
import { createBakeTarget, type PointReceiver } from '../lightBaker';

/**
 * 建物の壁や屋根のような平らな面に、焼き込んだ影と AO を貼るための「光の地図」（ライトマップ）。
 * 面ごとに地図の中の長方形を割り当て、長方形の画素ごとに面の上の点を作って焼き込む。
 * 頂点には、その点が地図のどこに当たるか（aBake）を持たせる
 */
export interface AtlasFace {
  /** 面の原点（u = 0, v = 0 の点）、u の向き、v の向き（単位ベクトル）、外向きの法線 */
  origin: THREE.Vector3;
  du: THREE.Vector3;
  dv: THREE.Vector3;
  normal: THREE.Vector3;
  /** u, v の長さ */
  w: number;
  h: number;
}

export interface AtlasRect {
  x: number;
  y: number;
  /** 地図の中での u = 0, v = 0 の位置（画素）と、1 あたりの画素数 */
  ox: number;
  oy: number;
}

const PAD = 1;

export class FaceAtlas {
  private faces: AtlasFace[] = [];
  private rects: AtlasRect[] = [];
  readonly size: number;
  texel = 0.05;

  constructor(size: number) {
    this.size = size;
  }

  add(face: AtlasFace): number {
    this.faces.push(face);
    return this.faces.length - 1;
  }

  /** すべての面が収まる画素の大きさ（texel）を決めて、長方形を棚詰めで並べる */
  pack(preferredTexel: number) {
    let texel = preferredTexel;
    for (let attempt = 0; attempt < 12; attempt++) {
      if (this.tryPack(texel)) {
        this.texel = texel;
        return;
      }
      texel *= 1.12;
    }
    throw new Error('光の地図に面が収まりません');
  }

  private tryPack(texel: number): boolean {
    const n = this.size;
    const items = this.faces.map((f, i) => ({
      i,
      w: Math.max(1, Math.ceil(f.w / texel)) + PAD * 2,
      h: Math.max(1, Math.ceil(f.h / texel)) + PAD * 2,
    }));
    items.sort((a, b) => b.h - a.h);
    const rects: AtlasRect[] = new Array(this.faces.length);
    let x = 0;
    let y = 0;
    let rowH = 0;
    for (const it of items) {
      if (it.w > n) return false;
      if (x + it.w > n) {
        x = 0;
        y += rowH;
        rowH = 0;
      }
      if (y + it.h > n) return false;
      rects[it.i] = { x, y, ox: x + PAD, oy: y + PAD };
      x += it.w;
      rowH = Math.max(rowH, it.h);
    }
    this.rects = rects;
    return true;
  }

  /** 面の上の点（u, v）の、地図の座標（0〜1） */
  uv(faceIndex: number, u: number, v: number): [number, number] {
    const r = this.rects[faceIndex];
    return [(r.ox + u / this.texel) / this.size, (r.oy + v / this.texel) / this.size];
  }

  /** 焼き込みの受け手：長方形の画素ごとに、面の上の点（端の余白の画素は面の縁に寄せる） */
  receiver(renderer: THREE.WebGLRenderer, normalOffset: number): { receiver: PointReceiver; texture: THREE.Texture } {
    const pos: number[] = [];
    const nor: number[] = [];
    const buv: number[] = [];
    const p = new THREE.Vector3();
    this.faces.forEach((f, i) => {
      const r = this.rects[i];
      const cw = Math.max(1, Math.ceil(f.w / this.texel));
      const ch = Math.max(1, Math.ceil(f.h / this.texel));
      const eu = Math.min(0.004, f.w * 0.1);
      const ev = Math.min(0.004, f.h * 0.1);
      for (let j = -PAD; j < ch + PAD; j++) {
        const v = THREE.MathUtils.clamp((j + 0.5) * this.texel, ev, f.h - ev);
        for (let k = -PAD; k < cw + PAD; k++) {
          const u = THREE.MathUtils.clamp((k + 0.5) * this.texel, eu, f.w - eu);
          p.copy(f.origin).addScaledVector(f.du, u).addScaledVector(f.dv, v);
          pos.push(p.x, p.y, p.z);
          nor.push(f.normal.x, f.normal.y, f.normal.z);
          buv.push((r.ox + k + 0.5) / this.size, (r.oy + j + 0.5) / this.size);
        }
      }
    });
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
    g.setAttribute('bakeUv', new THREE.Float32BufferAttribute(buv, 2));
    const target = createBakeTarget(renderer, this.size, this.size);
    return {
      receiver: { target, geometry: g, matrixWorld: new THREE.Matrix4(), normalOffset },
      texture: target.texture,
    };
  }

  get count() {
    return this.faces.length;
  }
}
