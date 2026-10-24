import * as THREE from 'three';
import { mulberry32 } from '../noise';

/**
 * シダとソテツの葉（羽状の葉）のテクスチャを描く（外部の画像は使わない）。
 * 縦（v）が葉の付け根（下）から先（上）、横（u）が葉の幅。中央の軸から左右に小葉が並ぶ。
 * 色は明るさの違いだけ（灰色）で描き、植物ごとの色はインスタンスの色で掛ける。不透明度で形を切り抜く。
 *  - fern：やわらかい小葉がさらに細かく裂けた（羽状に深く切れ込む）シダの葉。付け根の方は小葉が短い
 *  - cycad：細長くかたい小葉がまっすぐ並ぶソテツの葉
 */
export function createFrondTexture(kind: 'fern' | 'cycad' | 'spray' | 'palm', seed: number): THREE.Texture {
  if (kind === 'spray') return finishTexture(drawSpray(seed));
  if (kind === 'palm') return finishTexture(drawPalm(seed));
  const W = 128;
  const H = 512;
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d')!;
  ctx.clearRect(0, 0, W, H);
  const rnd = mulberry32(seed);
  const cx = W / 2;
  // 葉の付け根（v = 0）を画像の下に
  const Y = (v: number) => H * (1 - v);
  const n = kind === 'fern' ? 26 : 34;
  const span = (t: number) => {
    // 小葉の長さ：付け根は短く、3 割ほどの所で最も長く、先へ細くなる
    if (kind === 'fern') return Math.sin(Math.PI * Math.min(1, Math.pow(t, 0.75) * 1.0)) * (1 - 0.25 * t);
    return Math.min(1, t * 6) * (1 - Math.pow(t, 3) * 0.85);
  };
  const angle = kind === 'fern' ? 0.95 : 0.85; // 軸からの角度（ラジアン、先の方へ傾く）
  for (let i = 0; i < n; i++) {
    const t = 0.05 + (0.93 * (i + 0.5)) / n;
    const L = span(t) * (W * 0.47) * (0.9 + 0.2 * rnd());
    for (const side of [-1, 1]) {
      const t0 = t + (side < 0 ? 0 : 0.5 / n);
      const y0 = Y(t0);
      const a = angle + (rnd() - 0.5) * 0.12;
      const dx = Math.sin(a) * side;
      const dy = -Math.cos(a);
      const len = L * (0.92 + 0.16 * rnd());
      const wid = kind === 'fern' ? Math.max(2.2, len * 0.2) : Math.max(1.3, len * 0.075);
      // 小葉の形：付け根から先へ、両側の縁（シダは細かく波打つ縁）
      const steps = kind === 'fern' ? 10 : 4;
      const left: [number, number][] = [];
      const right: [number, number][] = [];
      for (let s = 0; s <= steps; s++) {
        const u = s / steps;
        const px = cx + dx * len * u;
        const py = y0 + dy * len * u;
        let w = wid * Math.sin(Math.PI * Math.min(1, 0.15 + u * 0.95)) * (1 - 0.6 * u);
        if (kind === 'fern') w *= 0.75 + 0.45 * Math.abs(Math.sin(u * Math.PI * 5.5));
        // 小葉の幅の向き（軸に沿う向き）
        const nx = -dy * side;
        const ny = dx * side;
        left.push([px + nx * w, py + ny * w]);
        right.push([px - nx * w, py - ny * w]);
      }
      const shade = 150 + Math.floor(80 * rnd());
      const grad = ctx.createLinearGradient(cx, y0, cx + dx * len, y0 + dy * len);
      grad.addColorStop(0, `rgb(${shade - 40},${shade - 30},${shade - 40})`);
      grad.addColorStop(1, `rgb(${Math.min(255, shade + 30)},${Math.min(255, shade + 35)},${Math.min(255, shade + 20)})`);
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.moveTo(cx, y0);
      for (const [x, y] of left) ctx.lineTo(x, y);
      for (let k = right.length - 1; k >= 0; k--) ctx.lineTo(right[k][0], right[k][1]);
      ctx.closePath();
      ctx.fill();
      // 小葉の中央の葉脈（明るい細い線）
      ctx.strokeStyle = 'rgba(235,240,220,0.55)';
      ctx.lineWidth = 0.8;
      ctx.beginPath();
      ctx.moveTo(cx, y0);
      ctx.lineTo(cx + dx * len * 0.85, y0 + dy * len * 0.85);
      ctx.stroke();
    }
  }
  // 中央の軸（付け根は太く、先は細い）
  for (let i = 0; i < 40; i++) {
    const t0 = i / 40;
    const t1 = (i + 1) / 40;
    ctx.strokeStyle = `rgb(${120 + 50 * t0},${125 + 45 * t0},${95 + 30 * t0})`;
    ctx.lineWidth = (kind === 'fern' ? 4.5 : 5.5) * (1 - 0.75 * t0);
    ctx.beginPath();
    ctx.moveTo(cx, Y(t0 * 0.99));
    ctx.lineTo(cx, Y(t1 * 0.99));
    ctx.stroke();
  }
  return finishTexture(canvas);
}

function finishTexture(canvas: HTMLCanvasElement): THREE.Texture {
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.ClampToEdgeWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.anisotropy = 4;
  tex.generateMipmaps = true;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.needsUpdate = true;
  return tex;
}

/**
 * 針葉樹の枝葉（上から見た平たい枝先）：中央の枝から左右へ小枝が斜め前へ出て、小枝には短い針葉が
 * びっしり並ぶ。全体は付け根と先が細い卵形。縦（v）が付け根（下）から先（上）。明るさだけで描く
 */
function drawSpray(seed: number): HTMLCanvasElement {
  const W = 128;
  const H = 256;
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d')!;
  ctx.clearRect(0, 0, W, H);
  ctx.lineCap = 'round';
  const rnd = mulberry32(seed);
  const cx = W / 2;
  const Y = (v: number) => H * (1 - v);
  // 外形の半幅（画素）：付け根は細く、4 割ほどの所で最も広く、先は尖る
  const half = (t: number) => (W * 0.47) * Math.pow(Math.sin(Math.PI * Math.min(1, Math.pow(t, 0.8))), 0.85) * (1 - 0.3 * t);
  /** 針葉の並んだ小枝を描く（p から角度 ang の向きへ len） */
  const twig = (px: number, py: number, ang: number, len: number, dark: number, needle: number) => {
    const dx = Math.sin(ang);
    const dy = -Math.cos(ang);
    // 小枝の軸
    ctx.strokeStyle = `rgb(${dark},${dark + 6},${dark - 10})`;
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.moveTo(px, py);
    ctx.lineTo(px + dx * len, py + dy * len);
    ctx.stroke();
    const steps = Math.max(4, Math.round(len / 2.2));
    for (let s = 0; s <= steps; s++) {
      const u = s / steps;
      const qx = px + dx * len * u;
      const qy = py + dy * len * u;
      const nl = needle * (1 - 0.45 * u) * (0.8 + 0.4 * rnd());
      for (const side of [-1, 1]) {
        const a = ang + side * (0.75 + 0.25 * rnd());
        const g = Math.round(dark + (230 - dark) * (0.35 + 0.65 * u) * (0.75 + 0.3 * rnd()));
        ctx.strokeStyle = `rgb(${g - 6},${Math.min(255, g + 4)},${g - 22})`;
        ctx.lineWidth = 1.5 + 0.5 * rnd();
        ctx.beginPath();
        ctx.moveTo(qx, qy);
        ctx.lineTo(qx + Math.sin(a) * nl, qy - Math.cos(a) * nl);
        ctx.stroke();
      }
    }
    // 小枝の先の房
    for (let k = 0; k < 3; k++) {
      const a = ang + (rnd() - 0.5) * 0.7;
      const g = 200 + Math.floor(40 * rnd());
      ctx.strokeStyle = `rgb(${g - 8},${Math.min(255, g + 6)},${g - 30})`;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(px + dx * len, py + dy * len);
      ctx.lineTo(px + dx * len + Math.sin(a) * needle * 0.7, py + dy * len - Math.cos(a) * needle * 0.7);
      ctx.stroke();
    }
  };
  // 左右の小枝（互い違い）。付け根の方は暗く、先の方は明るい
  const n = 9;
  const order: [number, number][] = [];
  for (let i = 0; i < n; i++) for (const side of [-1, 1]) order.push([i, side]);
  for (const [i, side] of order) {
    const t = 0.07 + (0.86 * (i + (side > 0 ? 0.5 : 0) + 0.25)) / n;
    const a = side * (0.9 + 0.2 * rnd());
    const w = half(t);
    const len = Math.max(4, w / Math.sin(Math.abs(a))) * (0.85 + 0.2 * rnd());
    const dark = Math.round(95 + 55 * t + 15 * rnd());
    twig(cx + side * 1.5, Y(t), a, len, dark, 7.5 + 2.5 * (1 - t));
    // 小枝からさらに分かれる短い小枝（枝葉をふさふさに）
    if (len > 22) {
      const u = 0.45 + 0.2 * rnd();
      const sx = cx + Math.sin(a) * len * u;
      const sy = Y(t) - Math.cos(a) * len * u;
      twig(sx, sy, a - side * 0.55, len * 0.38, dark + 25, 6);
    }
  }
  // 中央の枝と、その上の針葉
  twig(cx, Y(0.02), 0, H * 0.95, 105, 7);
  return canvas;
}

/**
 * 広葉樹の葉の房（上から見た放射状の葉の集まり）：細長い葉が中心から星形に広がる。
 * 中心は暗く、葉先は明るい。正方形の中心が房の中心
 */
function drawPalm(seed: number): HTMLCanvasElement {
  const S = 256;
  const canvas = document.createElement('canvas');
  canvas.width = S;
  canvas.height = S;
  const ctx = canvas.getContext('2d')!;
  ctx.clearRect(0, 0, S, S);
  const rnd = mulberry32(seed);
  const c = S / 2;
  const leaves: { a: number; L: number; w: number; shade: number }[] = [];
  const n = 9;
  const a0 = rnd() * Math.PI * 2;
  for (let i = 0; i < n; i++) {
    leaves.push({
      a: a0 + (i / n) * Math.PI * 2 + (rnd() - 0.5) * 0.35,
      L: S * 0.47 * (0.78 + 0.22 * rnd()),
      w: 0.17 + 0.05 * rnd(),
      shade: 175 + Math.floor(55 * rnd()),
    });
  }
  // 内側の短い葉（中心を埋める）
  for (let i = 0; i < 5; i++) {
    leaves.push({ a: rnd() * Math.PI * 2, L: S * 0.28 * (0.8 + 0.3 * rnd()), w: 0.22, shade: 150 + Math.floor(40 * rnd()) });
  }
  for (const lf of leaves) {
    const dx = Math.cos(lf.a);
    const dy = Math.sin(lf.a);
    const nx = -dy;
    const ny = dx;
    const steps = 14;
    const left: [number, number][] = [];
    const right: [number, number][] = [];
    for (let s = 0; s <= steps; s++) {
      const u = s / steps;
      const r = S * 0.03 + (lf.L - S * 0.03) * u;
      // 披針形：中ほどで最も幅広く、先は尖る。縁はわずかにぎざぎざ
      let w = lf.L * lf.w * Math.pow(Math.sin(Math.PI * Math.min(1, Math.pow(u, 0.75))), 0.9) * 0.5;
      w *= 1 + 0.12 * Math.sin(u * 37 + lf.a * 5);
      left.push([c + dx * r + nx * w, c + dy * r + ny * w]);
      right.push([c + dx * r - nx * w, c + dy * r - ny * w]);
    }
    const grad = ctx.createLinearGradient(c, c, c + dx * lf.L, c + dy * lf.L);
    grad.addColorStop(0, `rgb(${lf.shade - 70},${lf.shade - 62},${lf.shade - 85})`);
    grad.addColorStop(0.6, `rgb(${lf.shade - 10},${lf.shade},${lf.shade - 35})`);
    grad.addColorStop(1, `rgb(${Math.min(255, lf.shade + 25)},${Math.min(255, lf.shade + 30)},${lf.shade - 10})`);
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.moveTo(c, c);
    for (const [x, y] of left) ctx.lineTo(x, y);
    for (let k = right.length - 1; k >= 0; k--) ctx.lineTo(right[k][0], right[k][1]);
    ctx.closePath();
    ctx.fill();
    // 葉の中央の葉脈と、片側の陰（葉が中央で浅く折れている）
    ctx.fillStyle = 'rgba(40,50,20,0.16)';
    ctx.beginPath();
    ctx.moveTo(c, c);
    for (const [x, y] of left) ctx.lineTo(x, y);
    for (let s = steps; s >= 0; s--) {
      const r = S * 0.03 + (lf.L - S * 0.03) * (s / steps);
      ctx.lineTo(c + dx * r, c + dy * r);
    }
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = 'rgba(240,245,210,0.5)';
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.moveTo(c + dx * S * 0.04, c + dy * S * 0.04);
    ctx.lineTo(c + dx * lf.L * 0.9, c + dy * lf.L * 0.9);
    ctx.stroke();
  }
  return canvas;
}
