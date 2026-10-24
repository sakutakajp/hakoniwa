import { V, type BuildContext } from './context';
import { archBand, archFill, archFrameFace, archPoint, archReveal, at, rectFace, type ArchHole, type Frame } from './arch';
import type { FaceInfo, MeshBuilder } from '../meshBuilder';

/**
 * 窓：アーチの窓と四角い窓の開口（壁の面に穴を抜く）、建具（枠と細い桟の格子。ジョージアン様式の小さなガラスの升目）、ガラス、
 * 石の額縁（アーチの枠と要石・四角い窓の枠・窓台）、まん中のセルリアーナ（ヴェネツィア窓：アーチの窓の両脇に四角い窓、間に細い柱）
 */

/** 四角い開口かどうか（アーチの部分の高さがない） */
export const isRect = (h: ArchHole) => h.top - h.spring < 1e-5;

/** 面を u の範囲で縦の帯に分け、開口のある所はその形を抜いて作る（アーチの開口と四角い開口） */
export function stripFace(mb: MeshBuilder, fr: Frame, u0: number, u1: number, v0: number, v1: number, holes: ArchHole[], f: FaceInfo) {
  let u = u0;
  for (const h of [...holes].sort((a, b) => a.u0 - b.u0)) {
    rectFace(mb, fr, u, h.u0, v0, v1, f);
    if (isRect(h)) {
      rectFace(mb, fr, h.u0, h.u1, v0, h.sill, f);
      rectFace(mb, fr, h.u0, h.u1, h.top, v1, f);
    } else {
      archFrameFace(mb, fr, { u0: h.u0, u1: h.u1, v0, v1 }, h, f);
    }
    u = h.u1;
  }
  rectFace(mb, fr, u, u1, v0, v1, f);
}

/** 四角い開口の内側の面（窓台・左右の脇・上の面）を、奥行き c0 から c1 まで */
export function rectReveal(mb: MeshBuilder, fr: Frame, h: ArchHole, c0: number, c1: number, f: FaceInfo, opts: { sill?: FaceInfo; skipSill?: boolean } = {}) {
  const up = fr.v.clone();
  if (!opts.skipSill) mb.quadAuto(at(fr, h.u0, h.sill, c0), at(fr, h.u1, h.sill, c0), at(fr, h.u1, h.sill, c1), at(fr, h.u0, h.sill, c1), up, opts.sill ?? f);
  mb.quadAuto(at(fr, h.u0, h.top, c0), at(fr, h.u1, h.top, c0), at(fr, h.u1, h.top, c1), at(fr, h.u0, h.top, c1), up.clone().negate(), f);
  mb.quadAuto(at(fr, h.u0, h.sill, c0), at(fr, h.u0, h.top, c0), at(fr, h.u0, h.top, c1), at(fr, h.u0, h.sill, c1), fr.u, f);
  mb.quadAuto(at(fr, h.u1, h.sill, c0), at(fr, h.u1, h.top, c0), at(fr, h.u1, h.top, c1), at(fr, h.u1, h.sill, c1), fr.u.clone().negate(), f);
}

/** 開口の内側の面（アーチか四角か） */
export function holeReveal(mb: MeshBuilder, fr: Frame, h: ArchHole, c0: number, c1: number, f: FaceInfo, opts: { sill?: FaceInfo } = {}) {
  if (isRect(h)) rectReveal(mb, fr, h, c0, c1, f, opts);
  else archReveal(mb, fr, h, c0, c1, f, opts);
}

/**
 * 窓の建具：外枠、格子（ジョージアン様式の上げ下げ窓のような小さなガラスの升目）、アーチの中は放射状の桟と小さな半円（扇窓）、ガラス。
 * cols は升目の列の数、c は建具の奥行きの位置（壁の厚みの中ほど）
 */
export function windowJoinery(ctx: BuildContext, fr: Frame, h: ArchHole, c: number, opts: { cols?: number; rows?: number; glass?: 'window' } = {}) {
  const { st, mb, glass, cfg } = ctx;
  const frameF = st.face('paint', cfg.colors.windowFrame);
  const fw = 0.045;
  const bar = 0.018;
  const P = (u: number, v: number, cc = c) => at(fr, u, v, cc);
  const beamUV = (a: [number, number], b: [number, number], width: number, depth: number) => mb.beam(P(a[0], a[1]), P(b[0], b[1]), width, depth, frameF, { up: fr.n, cell: 1e3 });
  const rect = isRect(h);
  const inset: ArchHole = { u0: h.u0 + fw / 2, u1: h.u1 - fw / 2, sill: h.sill + fw / 2, spring: h.spring - (rect ? fw / 2 : 0), top: h.top - fw / 2 };
  // 外枠
  beamUV([inset.u0, h.sill], [inset.u0, rect ? h.top : h.spring], fw, 0.065);
  beamUV([inset.u1, h.sill], [inset.u1, rect ? h.top : h.spring], fw, 0.065);
  beamUV([h.u0, inset.sill], [h.u1, inset.sill], fw, 0.065);
  if (rect) beamUV([h.u0, inset.top], [h.u1, inset.top], fw, 0.065);
  else {
    const seg = 14;
    for (let i = 0; i < seg; i++) beamUV(archPoint(inset, Math.PI * (1 - i / seg)), archPoint(inset, Math.PI * (1 - (i + 1) / seg)), fw, 0.065);
    // アーチの始まりの横木
    beamUV([h.u0, h.spring], [h.u1, h.spring], 0.036, 0.055);
  }
  // 格子：縦の桟と横の桟（上げ下げ窓の 2 枚の障子の合わせ目は少し太く）
  const w = h.u1 - h.u0;
  const cols = opts.cols ?? Math.max(2, Math.round(w / 0.3));
  const top = rect ? h.top : h.spring;
  const rows = opts.rows ?? Math.max(3, Math.round((top - h.sill) / 0.3));
  for (let k = 1; k < cols; k++) {
    const u = h.u0 + (w * k) / cols;
    beamUV([u, h.sill], [u, top], bar, 0.04);
  }
  for (let k = 1; k < rows; k++) {
    const v = h.sill + ((top - h.sill) * k) / rows;
    const meeting = k === Math.round(rows / 2);
    beamUV([h.u0, v], [h.u1, v], meeting ? bar * 1.7 : bar, meeting ? 0.055 : 0.04);
  }
  if (!rect) {
    // 扇窓：小さな半円と放射状の桟
    const cu = (h.u0 + h.u1) / 2;
    const inner: ArchHole = { u0: cu - (inset.u1 - inset.u0) * 0.2, u1: cu + (inset.u1 - inset.u0) * 0.2, sill: h.spring, spring: h.spring, top: h.spring + (inset.top - h.spring) * 0.4 };
    for (let i = 0; i < 8; i++) beamUV(archPoint(inner, Math.PI * (1 - i / 8)), archPoint(inner, Math.PI * (1 - (i + 1) / 8)), bar, 0.04);
    for (const th of [Math.PI * 0.16, Math.PI * 0.38, Math.PI * 0.62, Math.PI * 0.84]) beamUV(archPoint(inner, th), archPoint(inset, th), bar, 0.04);
  }
  // ガラス（部屋の側と外の側の 2 枚。影を落とさない）。模様の高さの基準は窓の並びの窓台と頂
  const gs = st.face(opts.glass ?? 'window', '#ffffff');
  if (rect) {
    rectFace(glass, fr, h.u0, h.u1, h.sill, h.top, gs, c - 0.01);
    const back = { o: fr.o, u: fr.u.clone().negate(), v: fr.v, n: fr.n.clone().negate() };
    rectFace(glass, back, -h.u1, -h.u0, h.sill, h.top, gs, -(c - 0.012));
  } else {
    archFill(glass, fr, h, gs, c - 0.01);
    archFill(glass, fr, h, gs, c - 0.012, 14, true);
  }
}

/** 部屋の側の石の額縁：アーチの窓はアーチの枠と要石、四角い窓は細い枠。下に窓台の石 */
export function windowSurround(ctx: BuildContext, fr: Frame, h: ArchHole, opts: { width?: number; depth?: number; keystone?: boolean; sill?: boolean; face?: FaceInfo } = {}) {
  const { st, mb, cfg } = ctx;
  const trim = opts.face ?? st.face('trim', cfg.colors.coping);
  const bw = opts.width ?? 0.075;
  const bd = opts.depth ?? 0.03;
  if (isRect(h)) {
    // 左右と上の枠（上の枠は左右へ少し伸ばす）
    mb.group(() => {
      fbox(mb, fr, [h.u0 - bw, h.u0], [h.sill, h.top], [0, bd], trim, { skip: ['back', 'bottom', 'top'] });
      fbox(mb, fr, [h.u1, h.u1 + bw], [h.sill, h.top], [0, bd], trim, { skip: ['back', 'bottom', 'top'] });
      fbox(mb, fr, [h.u0 - bw, h.u1 + bw], [h.top, h.top + bw], [0, bd], trim, { skip: ['back'] });
    });
  } else {
    archBand(mb, fr, h, bw, bd, trim, opts.keystone === false ? {} : { keystone: { width: 0.13, height: 0.19, depth: bd + 0.025 } });
  }
  if (opts.sill !== false) fbox(mb, fr, [h.u0 - bw - 0.05, h.u1 + bw + 0.05], [h.sill - 0.065, h.sill], [0, 0.1], st.face('trim', cfg.colors.coping), { skip: ['back'] });
}

/** 面の座標で決める箱（u・v・奥行き c の範囲） */
export function fbox(mb: MeshBuilder, fr: Frame, u: [number, number], v: [number, number], c: [number, number], f: FaceInfo, opts: { skip?: ('front' | 'right' | 'back' | 'left' | 'top' | 'bottom')[]; top?: FaceInfo; cell?: number } = {}) {
  // 面の座標の「手前」（c の大きい側）を hexa の front（下の面の 0→1 の辺）にする
  const P = (a: number, b: number, cc: number) => at(fr, a, b, cc);
  const b = [P(u[0], v[0], c[1]), P(u[1], v[0], c[1]), P(u[1], v[0], c[0]), P(u[0], v[0], c[0])];
  const t = [P(u[0], v[1], c[1]), P(u[1], v[1], c[1]), P(u[1], v[1], c[0]), P(u[0], v[1], c[0])];
  mb.hexa(b, t, f, opts);
}

/**
 * イオニア式の柱頭の見せかけ：四角い頂板と、左右の渦巻き（短い円柱を横に寝かせた形）、その下の卵形の刳り形の帯。
 * u は柱の中心、v は柱頭の下端、w は柱の幅、c0 は柱の前の面
 */
export function ionicCapital(ctx: BuildContext, fr: Frame, u: number, v: number, w: number, c0: number, face: FaceInfo) {
  const { mb } = ctx;
  const h = w * 0.42;
  mb.group(() => {
    // 卵形の刳り形の帯と、頂板
    fbox(mb, fr, [u - w * 0.5, u + w * 0.5], [v, v + h * 0.45], [0, c0 + w * 0.08], face, { skip: ['back'] });
    fbox(mb, fr, [u - w * 0.62, u + w * 0.62], [v + h * 0.75, v + h], [0, c0 + w * 0.14], face, { skip: ['back'] });
    // 渦巻き（左右）：頂板の下の両端に、前を向いた円盤
    for (const s of [-1, 1]) {
      const cu = u + s * w * 0.46;
      const cv = v + h * 0.52;
      const r = h * 0.3;
      const seg = 10;
      const ring = (k: number, rr: number, cc: number) => {
        const a = (k / seg) * Math.PI * 2;
        return at(fr, cu + Math.cos(a) * rr, cv + Math.sin(a) * rr, cc);
      };
      for (let k = 0; k < seg; k++) {
        // 円盤の前の面（中心の目に向かって少しへこむ）と、縁
        mb.quadAuto(ring(k, r, c0 + w * 0.12), ring(k + 1, r, c0 + w * 0.12), ring(k + 1, r * 0.25, c0 + w * 0.09), ring(k, r * 0.25, c0 + w * 0.09), fr.n, face, { cell: 1e3 });
        const mid = ((k + 0.5) / seg) * Math.PI * 2;
        const out = fr.u.clone().multiplyScalar(Math.cos(mid)).addScaledVector(fr.v, Math.sin(mid));
        mb.quadAuto(ring(k, r, 0), ring(k + 1, r, 0), ring(k + 1, r, c0 + w * 0.12), ring(k, r, c0 + w * 0.12), out, face, { cell: 1e3 });
      }
    }
  });
}

/** 細い丸柱（台座・柱身・柱頭）。セルリアーナの窓の間に立つ。p は柱の中心（面の座標 u, 奥行き c）、y0〜y1 */
export function slenderColumn(ctx: BuildContext, fr: Frame, u: number, c: number, y0: number, y1: number, r: number, face: FaceInfo) {
  const { mb } = ctx;
  const p = at(fr, u, 0, c);
  const h = y1 - y0;
  mb.lathe([p.x, p.z], [
    [r * 1.45, y0],
    [r * 1.45, y0 + h * 0.035],
    [r * 1.2, y0 + h * 0.05],
    [r * 1.2, y0 + h * 0.065],
    [r, y0 + h * 0.08],
    [r * 0.92, y0 + h * 0.88],
    [r * 1.15, y0 + h * 0.9],
    [r * 1.0, y0 + h * 0.92],
    [r * 1.0, y0 + h * 0.94],
  ], face, 14, { capBottom: false });
  // 柱頭（イオニア式の見せかけ）と、その上の四角い頂板
  ionicCapital(ctx, fr, u, y0 + h * 0.94, r * 2.6, c + r, face);
  mb.aabb([p.x - r * 1.7, p.x + r * 1.7], [y1 - h * 0.012, y1], [p.z - r * 1.7, p.z + r * 1.7], face, {});
  return V(p.x, y1, p.z);
}
