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
  /** 部品の番号（木目の位置や板の色むらを部品ごとに変える乱数の種） */
  readonly seeds: number[] = [];
  /**
   * 箱の面の 4 つの辺までの距離（左・右・下・上、ワールド単位）。シェーダーで辺の近くの法線を外へ傾け、
   * 角の丸み（面取り）が光を受ける細い線にする。箱でない面は遠い値（丸めない）
   */
  readonly edges: number[] = [];
  /** 面の上のテクスチャの座標（四角形の面だけ。uvRect で決める。金文字の帯などに使う） */
  readonly uvs: number[] = [];
  readonly indices: number[] = [];
  /** 格子の一マスの最大の大きさ（焼き込みの細かさ） */
  maxCell: number;
  private seedDepth = 0;
  private seedValue = 0;
  private bevelDepth = 0;
  private edgeTmp: [number, number, number, number] = [1e3, 1e3, 1e3, 1e3];
  private uvTmp: [number, number] = [0, 0];

  constructor(maxCell = 0.1) {
    this.maxCell = maxCell;
  }

  get vertexCount() {
    return this.positions.length / 3;
  }

  /** 部品を 1 つ始める（入れ子のときは外側の部品の番号のまま） */
  private begin() {
    if (this.seedDepth++ === 0) this.seedValue = (this.seedValue + 1) % 65521;
  }

  private end() {
    this.seedDepth--;
  }

  /** fn の中で作る形を、すべて同じ部品の番号にする（何枚もの面でできた 1 つの部材の木目をそろえる） */
  group<T>(fn: () => T): T {
    this.begin();
    try {
      return fn();
    } finally {
      this.end();
    }
  }

  protected vertex(p: THREE.Vector3, n: THREE.Vector3, f: FaceInfo, u: number, v: number, w: number, h: number) {
    this.positions.push(p.x, p.y, p.z);
    this.normals.push(n.x, n.y, n.z);
    this.colors.push(f.color.r, f.color.g, f.color.b);
    this.facade.push(u, v, w, h);
    this.styles.push(f.style);
    this.seeds.push(this.seedValue);
    this.edges.push(...this.edgeTmp);
    this.uvs.push(this.uvTmp[0], this.uvTmp[1]);
    return this.vertexCount - 1;
  }

  /** fn の中で作る四角形の面は、辺を丸める（箱の面） */
  private rounded<T>(fn: () => T): T {
    this.bevelDepth++;
    try {
      return fn();
    } finally {
      this.bevelDepth--;
    }
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
    opts: { v0?: number; uOffset?: number; flatNormal?: boolean; cell?: number; uvRect?: [number, number, number, number] } = {},
  ) {
    const cell = opts.cell ?? this.maxCell;
    const lenU = Math.max(p0.distanceTo(p1), p3.distanceTo(p2));
    const lenV = Math.max(p0.distanceTo(p3), p1.distanceTo(p2));
    // 大きすぎる面（座標の誤り）で止まらないよう、分割数に上限を設ける
    const nu = Math.min(4000, Math.max(1, Math.ceil(lenU / cell)));
    const nv = Math.min(4000, Math.max(1, Math.ceil(lenV / cell)));
    if (!Number.isFinite(lenU + lenV) || lenU > 100 || lenV > 100) {
      console.warn('MeshBuilder.quad: 面が大きすぎるため作りません', p0, p1, p2, p3);
      return;
    }
    // 面の法線（平らな面）。対角線どうしの外積で求める（1 辺がつぶれた三角形に近い四角形でも向きが決まる）
    const n = tmpA.subVectors(p2, p0).cross(tmpB.subVectors(p3, p1)).normalize().clone();
    if (!Number.isFinite(n.x) || n.lengthSq() < 0.5) return;
    const width = p0.distanceTo(p1);
    const height = lenV;
    const v0 = opts.v0 ?? 0;
    const uOff = opts.uOffset ?? 0;
    const base = this.vertexCount;
    const p = new THREE.Vector3();
    const a = new THREE.Vector3();
    const b = new THREE.Vector3();
    const round = this.bevelDepth > 0;
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
        if (round) this.edgeTmp = [s * rowW, (1 - s) * rowW, t * height, (1 - t) * height];
        if (opts.uvRect) this.uvTmp = [opts.uvRect[0] + (opts.uvRect[2] - opts.uvRect[0]) * s, opts.uvRect[1] + (opts.uvRect[3] - opts.uvRect[1]) * t];
        this.vertex(p, n, f, u, v0 + t * height, width, height);
      }
    }
    this.edgeTmp = [1e3, 1e3, 1e3, 1e3];
    this.uvTmp = [0, 0];
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

  /** 四角形の面。p0→p1→p2→p3 の向きを outward（外向きの目安）に合わせてから足す */
  quadAuto(
    p0: THREE.Vector3,
    p1: THREE.Vector3,
    p2: THREE.Vector3,
    p3: THREE.Vector3,
    outward: THREE.Vector3,
    f: FaceInfo,
    opts: { v0?: number; uOffset?: number; cell?: number; uvRect?: [number, number, number, number] } = {},
  ) {
    const n = tmpA.subVectors(p2, p0).cross(tmpB.subVectors(p3, p1));
    if (n.dot(outward) >= 0) this.quad(p0, p1, p2, p3, f, opts);
    else {
      // 向きを裏返すときは左右が入れ替わるので、テクスチャの座標の左右も入れ替える
      const r = opts.uvRect;
      this.quad(p1, p0, p3, p2, f, r ? { ...opts, uvRect: [r[2], r[1], r[0], r[3]] } : opts);
    }
  }

  /**
   * 8 つの角で決まる六面体（下の面 b0〜b3、上の面 t0〜t3。どちらも上から見て 手前左 → 手前右 → 奥右 → 奥左）。
   * skip に面の名前を入れると、その面は作らない（壁に接して見えない面など）
   */
  hexa(
    b: THREE.Vector3[],
    t: THREE.Vector3[],
    f: FaceInfo,
    opts: { top?: FaceInfo; bottom?: FaceInfo; skip?: ('front' | 'right' | 'back' | 'left' | 'top' | 'bottom')[]; cell?: number; vBase?: number } = {},
  ) {
    const skip = new Set(opts.skip ?? []);
    const center = new THREE.Vector3();
    for (const p of [...b, ...t]) center.add(p);
    center.multiplyScalar(1 / 8);
    const names = ['front', 'right', 'back', 'left'] as const;
    this.rounded(() => {
      for (let i = 0; i < 4; i++) {
        if (skip.has(names[i])) continue;
        const j = (i + 1) % 4;
        const mid = new THREE.Vector3().add(b[i]).add(b[j]).add(t[j]).add(t[i]).multiplyScalar(0.25);
        this.quadAuto(b[i], b[j], t[j], t[i], mid.sub(center), f, { cell: opts.cell, v0: opts.vBase });
      }
      if (!skip.has('top')) {
        const mid = new THREE.Vector3().add(t[0]).add(t[1]).add(t[2]).add(t[3]).multiplyScalar(0.25);
        this.quadAuto(t[0], t[1], t[2], t[3], mid.sub(center), opts.top ?? f, { cell: opts.cell });
      }
      if (!skip.has('bottom')) {
        const mid = new THREE.Vector3().add(b[0]).add(b[1]).add(b[2]).add(b[3]).multiplyScalar(0.25);
        this.quadAuto(b[0], b[3], b[2], b[1], mid.sub(center), opts.bottom ?? f, { cell: opts.cell });
      }
    });
  }

  /** 軸に沿った箱（x, y, z の範囲）。skip で見えない面を省く */
  aabb(
    x: [number, number],
    y: [number, number],
    z: [number, number],
    f: FaceInfo,
    opts: { top?: FaceInfo; bottom?: FaceInfo; skip?: ('front' | 'right' | 'back' | 'left' | 'top' | 'bottom')[]; cell?: number; vBase?: number } = {},
  ) {
    const V = (a: number, bb: number, c: number) => new THREE.Vector3(a, bb, c);
    const b = [V(x[0], y[0], z[1]), V(x[1], y[0], z[1]), V(x[1], y[0], z[0]), V(x[0], y[0], z[0])];
    const t = [V(x[0], y[1], z[1]), V(x[1], y[1], z[1]), V(x[1], y[1], z[0]), V(x[0], y[1], z[0])];
    this.hexa(b, t, f, opts);
  }

  /**
   * 2 点を結ぶ角材（手すり・ささら桁・梯子の脚など）。幅は水平の横向き、高さはそれと軸に直交する向き。
   * up は高さの向きの目安（既定は上）
   */
  beam(p0: THREE.Vector3, p1: THREE.Vector3, width: number, height: number, f: FaceInfo, opts: { up?: THREE.Vector3; top?: FaceInfo; cell?: number; caps?: boolean } = {}) {
    const a = new THREE.Vector3().subVectors(p1, p0).normalize();
    const up = opts.up ?? new THREE.Vector3(0, 1, 0);
    let s = new THREE.Vector3().crossVectors(a, up);
    if (s.lengthSq() < 1e-8) s = new THREE.Vector3().crossVectors(a, new THREE.Vector3(1, 0, 0));
    s.normalize();
    const n = new THREE.Vector3().crossVectors(s, a).normalize();
    const c = (p: THREE.Vector3, i: number, j: number) => p.clone().addScaledVector(s, (i - 0.5) * width).addScaledVector(n, (j - 0.5) * height);
    // 「下の面」を始点側の断面、「上の面」を終点側の断面として六面体を作る
    const b = [c(p0, 0, 0), c(p0, 1, 0), c(p0, 1, 1), c(p0, 0, 1)];
    const t = [c(p1, 0, 0), c(p1, 1, 0), c(p1, 1, 1), c(p1, 0, 1)];
    this.hexa(b, t, f, { top: opts.top, cell: opts.cell, skip: opts.caps === false ? ['top', 'bottom'] : [] });
  }

  /**
   * 縦の軸のまわりに断面を回した形（ろくろ挽き：手すり子・親柱の頭・ランプの台・植木鉢など）。
   * profile は下から上への [半径, 高さ]。法線は断面の傾きから求めてなめらかにする。半径 0 の端は点に閉じ、それ以外の端はふたをする
   */
  lathe(c: [number, number], profile: [number, number][], f: FaceInfo, segments = 8, opts: { capTop?: boolean; capBottom?: boolean; phase?: number } = {}) {
    const n = profile.length;
    // 断面の各点の接線（前後の点の差）から、外向きの法線（半径方向の成分と上下の成分）を求める
    const prof = profile.map(([r, y], k) => {
      const [ra, ya] = profile[Math.max(0, k - 1)];
      const [rb, yb] = profile[Math.min(n - 1, k + 1)];
      const dr = rb - ra;
      const dy = yb - ya;
      const len = Math.hypot(dr, dy) || 1;
      return { r, y, nr: dy / len, ny: -dr / len };
    });
    let vAcc = 0;
    const vs: number[] = [0];
    for (let k = 1; k < n; k++) {
      vAcc += Math.hypot(profile[k][0] - profile[k - 1][0], profile[k][1] - profile[k - 1][1]);
      vs.push(vAcc);
    }
    const maxR = Math.max(...profile.map((q) => q[0]), 1e-4);
    const ringStart: number[] = [];
    const p = new THREE.Vector3();
    const nn = new THREE.Vector3();
    for (let k = 0; k < n; k++) {
      ringStart.push(this.vertexCount);
      for (let i = 0; i <= segments; i++) {
        const a = ((i + (opts.phase ?? 0)) / segments) * Math.PI * 2;
        const ca = Math.cos(a);
        const sa = -Math.sin(a);
        p.set(c[0] + ca * prof[k].r, prof[k].y, c[1] + sa * prof[k].r);
        nn.set(ca * prof[k].nr, prof[k].ny, sa * prof[k].nr).normalize();
        this.vertex(p, nn, f, (i / segments) * 2 * Math.PI * maxR, vs[k], 2 * Math.PI * maxR, vAcc);
      }
    }
    for (let k = 0; k < n - 1; k++) {
      for (let i = 0; i < segments; i++) {
        const a0 = ringStart[k] + i;
        const a1 = a0 + 1;
        const b0 = ringStart[k + 1] + i;
        const b1 = b0 + 1;
        // 外から見て反時計回り（角度は上から見て反時計回りに増える）
        this.indices.push(a0, a1, b1, a0, b1, b0);
      }
    }
    const cap = (k: number, upward: boolean) => {
      if (prof[k].r < 1e-5) return;
      const nrm = new THREE.Vector3(0, upward ? 1 : -1, 0);
      const center = this.vertex(new THREE.Vector3(c[0], prof[k].y, c[1]), nrm, f, 0, 0, 1, 1);
      const ring: number[] = [];
      for (let i = 0; i <= segments; i++) {
        const a = ((i + (opts.phase ?? 0)) / segments) * Math.PI * 2;
        ring.push(this.vertex(new THREE.Vector3(c[0] + Math.cos(a) * prof[k].r, prof[k].y, c[1] - Math.sin(a) * prof[k].r), nrm, f, 0, 0, 1, 1));
      }
      for (let i = 0; i < segments; i++) {
        if (upward) this.indices.push(center, ring[i], ring[i + 1]);
        else this.indices.push(center, ring[i + 1], ring[i]);
      }
    };
    if (opts.capTop !== false) cap(n - 1, true);
    if (opts.capBottom !== false) cap(0, false);
  }

  /** 球（親柱の頭の玉など）。なめらかな法線の緯度・経度の格子 */
  sphere(center: THREE.Vector3, r: number, f: FaceInfo, segW = 10, segH = 6) {
    const start = this.vertexCount;
    const p = new THREE.Vector3();
    const nn = new THREE.Vector3();
    for (let j = 0; j <= segH; j++) {
      const th = (j / segH) * Math.PI;
      for (let i = 0; i <= segW; i++) {
        const ph = (i / segW) * Math.PI * 2;
        nn.set(Math.sin(th) * Math.cos(ph), Math.cos(th), -Math.sin(th) * Math.sin(ph));
        p.copy(center).addScaledVector(nn, r);
        this.vertex(p, nn, f, (i / segW) * 2 * Math.PI * r, (1 - j / segH) * Math.PI * r, 2 * Math.PI * r, Math.PI * r);
      }
    }
    for (let j = 0; j < segH; j++) {
      for (let i = 0; i < segW; i++) {
        const a = start + j * (segW + 1) + i;
        const b = a + segW + 1;
        this.indices.push(a, b, b + 1, a, b + 1, a + 1);
      }
    }
  }

  /**
   * 角の丸い箱や楕円体（超楕円体）：クッション・肘掛け・胸像の肩など。e = 1 で楕円体、0 に近いほど箱に近い。
   * axes は局所の x・y・z の向き（既定はワールドの軸）、half は各向きの半分の大きさ
   */
  blob(center: THREE.Vector3, half: THREE.Vector3, f: FaceInfo, opts: { e?: number; segW?: number; segH?: number; axes?: [THREE.Vector3, THREE.Vector3, THREE.Vector3] } = {}) {
    const e = opts.e ?? 0.4;
    const segW = opts.segW ?? 16;
    const segH = opts.segH ?? 10;
    const [ax, ay, az] = opts.axes ?? [new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, 0, 1)];
    const sp = (w: number, m: number) => Math.sign(Math.sin(w)) * Math.pow(Math.abs(Math.sin(w)), m);
    const cp = (w: number, m: number) => Math.sign(Math.cos(w)) * Math.pow(Math.abs(Math.cos(w)), m);
    const start = this.vertexCount;
    const p = new THREE.Vector3();
    const nn = new THREE.Vector3();
    for (let j = 0; j <= segH; j++) {
      const th = (j / segH) * Math.PI;
      for (let i = 0; i <= segW; i++) {
        const ph = (i / segW) * Math.PI * 2;
        const lx = half.x * sp(th, e) * cp(ph, e);
        const ly = half.y * cp(th, e);
        const lz = half.z * sp(th, e) * sp(ph, e);
        p.copy(center).addScaledVector(ax, lx).addScaledVector(ay, ly).addScaledVector(az, lz);
        const nx = (sp(th, 2 - e) * cp(ph, 2 - e)) / half.x;
        const ny = cp(th, 2 - e) / half.y;
        const nz = (sp(th, 2 - e) * sp(ph, 2 - e)) / half.z;
        nn.set(0, 0, 0).addScaledVector(ax, nx).addScaledVector(ay, ny).addScaledVector(az, nz).normalize();
        if (!Number.isFinite(nn.x)) nn.copy(ay).multiplyScalar(j < segH / 2 ? 1 : -1);
        this.vertex(p, nn, f, (i / segW) * 2, (1 - j / segH) * 2 * half.y, 2, 2 * half.y);
      }
    }
    for (let j = 0; j < segH; j++) {
      for (let i = 0; i < segW; i++) {
        const a = start + j * (segW + 1) + i;
        const b = a + segW + 1;
        // 局所の軸が右手系でないとき（axes の向き）は面の向きを逆に
        if (new THREE.Vector3().crossVectors(ax, ay).dot(az) >= 0) this.indices.push(a, b + 1, b, a, a + 1, b + 1);
        else this.indices.push(a, b, b + 1, a, b + 1, a + 1);
      }
    }
  }

  /** 頂点の色を後から決めた形のために、頂点を 1 つ足して番号を返す（独自の面を作るとき用） */
  addVertex(p: THREE.Vector3, n: THREE.Vector3, f: FaceInfo, u = 0, v = 0, w = 1, h = 1) {
    return this.vertex(p, n, f, u, v, w, h);
  }

  build(): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.positions, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.normals, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.colors, 3));
    g.setAttribute('aFacade', new THREE.Float32BufferAttribute(this.facade, 4));
    g.setAttribute('aStyle', new THREE.Float32BufferAttribute(this.styles, 1));
    g.setAttribute('aSeed', new THREE.Float32BufferAttribute(this.seeds, 1));
    g.setAttribute('aEdge', new THREE.Float32BufferAttribute(this.edges, 4));
    g.setAttribute('aUv', new THREE.Float32BufferAttribute(this.uvs, 2));
    g.setIndex(this.indices);
    g.computeBoundingSphere();
    return g;
  }
}

// 形を作る関数は、呼ぶたびに 1 つの部品として番号を進める（中で呼ぶ別の関数は同じ番号のまま）
type PartMethod = 'quad' | 'triangle' | 'flat' | 'box' | 'bevelBox' | 'ringWall' | 'polygon' | 'cylinder' | 'quadAuto' | 'hexa' | 'aabb' | 'beam' | 'lathe' | 'sphere' | 'blob';
for (const name of ['quad', 'triangle', 'flat', 'box', 'bevelBox', 'ringWall', 'polygon', 'cylinder', 'quadAuto', 'hexa', 'aabb', 'beam', 'lathe', 'sphere', 'blob'] as PartMethod[]) {
  const proto = MeshBuilder.prototype as unknown as Record<PartMethod, (...args: unknown[]) => unknown>;
  const original = proto[name];
  proto[name] = function (this: MeshBuilder, ...args: unknown[]) {
    return this.group(() => original.apply(this, args));
  };
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
