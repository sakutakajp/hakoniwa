import * as THREE from 'three';

/**
 * 外壁の模様つきの形を、頂点を足しながら組み立てる。
 * 頂点ごとに 位置・法線・色・外壁の座標（aFacade = 面の上の横位置 u と高さ v、面の幅と高さ）・様式番号（aStyle）を持つ。
 * 影と空からの遮蔽は頂点ごとに焼き込むので、大きな面は細かい格子に分けておく（maxCell）。
 */
export interface FaceInfo {
  color: THREE.Color;
  style: number;
}

const tmpA = new THREE.Vector3();
const tmpB = new THREE.Vector3();

export class MeshBuilder {
  readonly positions: number[] = [];
  readonly normals: number[] = [];
  readonly colors: number[] = [];
  readonly facade: number[] = [];
  readonly styles: number[] = [];
  readonly indices: number[] = [];
  /** 格子の一マスの最大の大きさ（焼き込みの細かさ） */
  maxCell: number;

  constructor(maxCell = 0.1) {
    this.maxCell = maxCell;
  }

  get vertexCount() {
    return this.positions.length / 3;
  }

  private vertex(p: THREE.Vector3, n: THREE.Vector3, f: FaceInfo, u: number, v: number, w: number, h: number) {
    this.positions.push(p.x, p.y, p.z);
    this.normals.push(n.x, n.y, n.z);
    this.colors.push(f.color.r, f.color.g, f.color.b);
    this.facade.push(u, v, w, h);
    this.styles.push(f.style);
    return this.vertexCount - 1;
  }

  /**
   * 四角形の面（外から見て p0 左下 → p1 右下 → p2 右上 → p3 左上）。台形や平行四辺形でもよい（双一次で分割）。
   * 外壁の座標は、u が左端からの距離（下端の長さ基準）、v が下端からの高さ（v0 から）
   */
  quad(
    p0: THREE.Vector3,
    p1: THREE.Vector3,
    p2: THREE.Vector3,
    p3: THREE.Vector3,
    f: FaceInfo,
    opts: { v0?: number; uOffset?: number; flatNormal?: boolean; cell?: number } = {},
  ) {
    const cell = opts.cell ?? this.maxCell;
    const lenU = Math.max(p0.distanceTo(p1), p3.distanceTo(p2));
    const lenV = Math.max(p0.distanceTo(p3), p1.distanceTo(p2));
    const nu = Math.max(1, Math.ceil(lenU / cell));
    const nv = Math.max(1, Math.ceil(lenV / cell));
    // 面の法線（平らな面）
    const n = tmpA.subVectors(p1, p0).cross(tmpB.subVectors(p3, p0)).normalize().clone();
    const width = p0.distanceTo(p1);
    const height = lenV;
    const v0 = opts.v0 ?? 0;
    const uOff = opts.uOffset ?? 0;
    const base = this.vertexCount;
    const p = new THREE.Vector3();
    const a = new THREE.Vector3();
    const b = new THREE.Vector3();
    for (let j = 0; j <= nv; j++) {
      const t = j / nv;
      a.lerpVectors(p0, p3, t);
      b.lerpVectors(p1, p2, t);
      const rowW = a.distanceTo(b);
      for (let i = 0; i <= nu; i++) {
        const s = i / nu;
        p.lerpVectors(a, b, s);
        // u は面の中心からの距離で数える（台形でも窓の列が左右対称にそろう）
        const u = uOff + width / 2 + (s - 0.5) * rowW;
        this.vertex(p, n, f, u, v0 + t * height, width, height);
      }
    }
    for (let j = 0; j < nv; j++) {
      for (let i = 0; i < nu; i++) {
        const k = base + j * (nu + 1) + i;
        this.indices.push(k, k + 1, k + nu + 2, k, k + nu + 2, k + nu + 1);
      }
    }
  }

  /** 三角形の面（外から見て反時計回り）。頂点の外壁座標は、底辺 p0-p1 を基準にする */
  triangle(p0: THREE.Vector3, p1: THREE.Vector3, apex: THREE.Vector3, f: FaceInfo, v0 = 0) {
    // 頂点を少し離した台形として分割する（細かい格子で焼き込めるように）
    const apexL = apex.clone().lerp(p0, 0.002);
    const apexR = apex.clone().lerp(p1, 0.002);
    this.quad(p0, p1, apexR, apexL, f, { v0 });
  }

  /** 水平な面（上向き、または down で下向き）。四隅は上から見て反時計回り（手前左 → 手前右 → 奥右 → 奥左） */
  flat(corners: THREE.Vector3[], f: FaceInfo, down = false) {
    const [c0, c1, c2, c3] = corners;
    if (down) this.quad(c0, c3, c2, c1, f);
    else this.quad(c0, c1, c2, c3, f);
  }

  /**
   * 平面が長方形の箱（回転あり）。側面 4 枚と上面（bottom: true で底面も）。
   * 側面の外壁座標の v は y0 からの高さに vBase を足したもの
   */
  box(
    c: [number, number],
    size: [number, number],
    y: [number, number],
    side: FaceInfo,
    top: FaceInfo | null,
    opts: { rot?: number; topSize?: [number, number]; bottom?: FaceInfo; vBase?: number } = {},
  ) {
    const rot = opts.rot ?? 0;
    const ca = Math.cos(rot);
    const sa = Math.sin(rot);
    const pt = (px: number, pz: number, yy: number) => new THREE.Vector3(c[0] + px * ca - pz * sa, yy, c[1] + px * sa + pz * ca);
    const [sx, sz] = size;
    const [tx, tz] = opts.topSize ?? size;
    const b = [pt(-sx / 2, sz / 2, y[0]), pt(sx / 2, sz / 2, y[0]), pt(sx / 2, -sz / 2, y[0]), pt(-sx / 2, -sz / 2, y[0])];
    const t = [pt(-tx / 2, tz / 2, y[1]), pt(tx / 2, tz / 2, y[1]), pt(tx / 2, -tz / 2, y[1]), pt(-tx / 2, -tz / 2, y[1])];
    // 側面：手前（+z）、右（+x）、奥（-z）、左（-x）。外から見て左下から反時計回り
    for (let i = 0; i < 4; i++) {
      const j = (i + 1) % 4;
      this.quad(b[i], b[j], t[j], t[i], side, { v0: opts.vBase ?? 0 });
    }
    if (top) this.flat([t[0], t[1], t[2], t[3]], top);
    if (opts.bottom) this.flat([b[0], b[1], b[2], b[3]], opts.bottom, true);
  }

  /**
   * 縦の角を面取りした箱（平面は八角形）。面取りの細い面は光を受けて、角に明るい線ができる。
   * 側面 4 枚は side、面取りの面は edge、上面は top（null なら作らない）。返り値は上面の外形（上から見て反時計回り）
   */
  bevelBox(
    c: [number, number],
    size: [number, number],
    y: [number, number],
    bevel: number,
    side: FaceInfo,
    edge: FaceInfo,
    top: FaceInfo | null,
    opts: { rot?: number; bottom?: FaceInfo; vBase?: number } = {},
  ) {
    const rot = opts.rot ?? 0;
    const ca = Math.cos(rot);
    const sa = Math.sin(rot);
    const pt = (px: number, pz: number, yy: number) => new THREE.Vector3(c[0] + px * ca - pz * sa, yy, c[1] + px * sa + pz * ca);
    const hx = size[0] / 2;
    const hz = size[1] / 2;
    const b = Math.min(bevel, hx * 0.45, hz * 0.45);
    // 手前の辺の左から、上から見て反時計回り（偶数番目の辺が側面、奇数番目が面取り）
    const plan: [number, number][] = [
      [-hx + b, hz],
      [hx - b, hz],
      [hx, hz - b],
      [hx, -hz + b],
      [hx - b, -hz],
      [-hx + b, -hz],
      [-hx, -hz + b],
      [-hx, hz - b],
    ];
    const lo = plan.map(([px, pz]) => pt(px, pz, y[0]));
    const hi = plan.map(([px, pz]) => pt(px, pz, y[1]));
    for (let i = 0; i < 8; i++) {
      const j = (i + 1) % 8;
      this.quad(lo[i], lo[j], hi[j], hi[i], i % 2 === 0 ? side : edge, { v0: opts.vBase ?? 0 });
    }
    if (top) this.polygon(hi, top);
    if (opts.bottom) this.polygon(lo, opts.bottom, true);
    return hi;
  }

  /**
   * 外形（上から見て反時計回りの凸多角形）に沿った低い壁（屋上の手すり壁など）：外側と内側の面と上面。
   * thickness だけ内側に厚みを持たせる
   */
  ringWall(outline: THREE.Vector3[], thickness: number, height: number, f: FaceInfo, topF: FaceInfo = f) {
    const n = outline.length;
    const y0 = outline[0].y;
    const y1 = y0 + height;
    // 内側の外形：各頂点を、両側の辺の内向きの法線の平均の向きへ動かす
    const inner = outline.map((p, i) => {
      const a = outline[(i - 1 + n) % n];
      const b = outline[(i + 1) % n];
      const n1 = new THREE.Vector2(-(p.z - a.z), p.x - a.x).normalize();
      const n2 = new THREE.Vector2(-(b.z - p.z), b.x - p.x).normalize();
      const m = n1.clone().add(n2).normalize();
      const k = thickness / Math.max(m.dot(n1), 0.3);
      // 上の法線は外向き（上から見て反時計回りの辺の右側）なので、内側へは引く
      return new THREE.Vector3(p.x - m.x * k, y0, p.z - m.y * k);
    });
    const at = (p: THREE.Vector3, yy: number) => new THREE.Vector3(p.x, yy, p.z);
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      this.quad(at(outline[i], y0), at(outline[j], y0), at(outline[j], y1), at(outline[i], y1), f);
      this.quad(at(inner[j], y0), at(inner[i], y0), at(inner[i], y1), at(inner[j], y1), f);
      this.flat([at(outline[i], y1), at(outline[j], y1), at(inner[j], y1), at(inner[i], y1)], topF);
    }
  }

  /** 水平な多角形（上から見て反時計回りの点、同じ高さ）。三角形に分けて足す。down で下向き */
  polygon(pts: THREE.Vector3[], f: FaceInfo, down = false) {
    const contour = pts.map((p) => new THREE.Vector2(p.x, -p.z));
    const tris = THREE.ShapeUtils.triangulateShape(contour, []);
    const n = new THREE.Vector3(0, down ? -1 : 1, 0);
    const base = this.vertexCount;
    for (const p of pts) this.vertex(p, n, f, p.x, -p.z, 100, 100);
    for (const [a, b, c] of tris) {
      // triangulateShape は (x, -z) の面で反時計回りの三角形を返す（上から見て反時計回り）
      if (down) this.indices.push(base + a, base + c, base + b);
      else this.indices.push(base + a, base + b, base + c);
    }
  }

  /** 縦の円柱（先細り可）。上下のふた付き */
  cylinder(c: [number, number], y: [number, number], r0: number, r1: number, f: FaceInfo, segments = 12, caps = true) {
    const ring = (r: number, yy: number) =>
      Array.from({ length: segments }, (_, i) => {
        const a = (i / segments) * Math.PI * 2;
        return new THREE.Vector3(c[0] + Math.cos(a) * r, yy, c[1] - Math.sin(a) * r);
      });
    const b = ring(r0, y[0]);
    const t = ring(r1, y[1]);
    const circumference = 2 * Math.PI * Math.max(r0, r1);
    for (let i = 0; i < segments; i++) {
      const j = (i + 1) % segments;
      this.quad(b[i], b[j], t[j], t[i], f, { uOffset: (i / segments) * circumference });
    }
    if (caps && r1 > 1e-4) {
      // 上のふた：中心から扇形に
      const center = new THREE.Vector3(c[0], y[1], c[1]);
      const n = new THREE.Vector3(0, 1, 0);
      const k0 = this.vertex(center, n, f, 0, 0, 1, 1);
      const ks = t.map((p) => this.vertex(p, n, f, 0, 0, 1, 1));
      for (let i = 0; i < segments; i++) this.indices.push(k0, ks[i], ks[(i + 1) % segments]);
    }
  }

  build(): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.positions, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.normals, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.colors, 3));
    g.setAttribute('aFacade', new THREE.Float32BufferAttribute(this.facade, 4));
    g.setAttribute('aStyle', new THREE.Float32BufferAttribute(this.styles, 1));
    g.setIndex(this.indices);
    g.computeBoundingSphere();
    return g;
  }
}

/**
 * 頂点ごとの焼き込み先の位置（bakeUv）を割り当て、焼き込みで光を調べる点群を作る。
 * 焼き込み先のテクスチャは幅 width、高さは頂点数に合わせる
 */
export function assignVertexBake(geometry: THREE.BufferGeometry, width = 1024) {
  const count = geometry.attributes.position.count;
  const height = Math.max(1, Math.ceil(count / width));
  const uv = new Float32Array(count * 2);
  for (let i = 0; i < count; i++) {
    uv[i * 2] = ((i % width) + 0.5) / width;
    uv[i * 2 + 1] = (Math.floor(i / width) + 0.5) / height;
  }
  geometry.setAttribute('bakeUv', new THREE.BufferAttribute(uv, 2));
  const points = new THREE.BufferGeometry();
  points.setAttribute('position', geometry.attributes.position);
  points.setAttribute('normal', geometry.attributes.normal);
  points.setAttribute('bakeUv', geometry.attributes.bakeUv);
  return { width, height, points };
}
