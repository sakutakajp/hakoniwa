import * as THREE from 'three';
import { mulberry32 } from './shape';

/**
 * 画像素材を使わずに描くテクスチャ：ペルシャ絨毯、風景画（大・小）、地球儀の地図。
 * どれも決まった乱数で描くので、毎回同じ絵になる
 */

function canvas(w: number, h: number) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d');
  if (!g) throw new Error('2D canvas is not available');
  return { c, g };
}

function toTexture(c: HTMLCanvasElement, anisotropy = 4) {
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = anisotropy;
  t.needsUpdate = true;
  return t;
}

/**
 * ペルシャ絨毯（絨毯の部位の名前は、地・メダリオン・吊り飾り・四隅の飾り・主の縁・細い縁・房）。
 * 地はえんじに、菱形の格子の交点のロゼットと、格子の辺に沿う細い葉の総柄（ヘラティ文様の簡略形）。
 * 中央は長い辺の向きに伸びた多重のメダリオンと両端の吊り飾り、四隅は紺の四分円の飾り。
 * 主の縁は紺の地に、唐草でつないだロゼットとパルメット、両側に互い違いの三角の細い縁（相互文様）。
 * 手織りの色むら（アブラッシュ：長さの向きに変わる帯）と、結び目の細かなむら。横長（長い辺が x）
 */
export function rugTexture(colors: { field: string; border: string; accent: string }, size = 2048, fringe = 0.022) {
  const W = size;
  const H = Math.round(size * 0.735);
  const { c, g } = canvas(W, H);
  const rand = mulberry32(17);
  const fx = Math.round(W * fringe);
  const cream = '#e9d6b0';
  const red2 = '#b5452f';
  const redDark = '#6e2219';
  const navy2 = '#34436e';
  const green = '#4f6b4a';
  const gold = colors.accent;
  // 房（両端）：生成りの細い糸の束
  g.fillStyle = '#e4d6ba';
  g.fillRect(0, 0, W, H);
  for (let y = 0; y < H; y += 2) {
    for (const side of [0, 1]) {
      const len = fx * (0.7 + rand() * 0.3);
      g.fillStyle = `rgba(${200 + rand() * 35},${186 + rand() * 30},${152 + rand() * 30},1)`;
      if (side === 0) g.fillRect(fx - len, y, len, 1.4);
      else g.fillRect(W - fx, y, len, 1.4);
    }
  }
  const x0 = fx;
  const x1 = W - fx;
  const bw = x1 - x0;
  const rect = (inset: number, col: string) => {
    g.fillStyle = col;
    g.fillRect(x0 + inset, inset, bw - 2 * inset, H - 2 * inset);
  };
  const S = H / 1000;
  // 縁の帯の並び（外から）：紺の細い縁 → えんじの線 → 主の縁（紺） → 生成りの線 → えんじの細い縁 → 地
  const gOut = 26 * S;
  const l1 = gOut + 6 * S;
  const mainOut = l1;
  const mainIn = mainOut + 74 * S;
  const l2 = mainIn + 6 * S;
  const gIn = l2 + 22 * S;
  const fieldIn = gIn + 5 * S;
  rect(0, colors.border);
  rect(gOut, red2);
  rect(mainOut, colors.border);
  rect(mainIn, cream);
  rect(l2, red2);
  rect(gIn, gold);
  rect(fieldIn, colors.field);
  // 互い違いの三角の細い縁（外の紺の縁に生成り、内のえんじの縁に紺）
  const reciprocal = (inset0: number, inset1: number, col: string) => {
    const hh = inset1 - inset0;
    const step = hh * 1.1;
    g.fillStyle = col;
    const tri = (ax: number, ay: number, bx: number, by: number, cx: number, cy: number) => {
      g.beginPath();
      g.moveTo(ax, ay);
      g.lineTo(bx, by);
      g.lineTo(cx, cy);
      g.closePath();
      g.fill();
    };
    // 上と下の辺
    for (let x = x0 + inset0; x < x1 - inset0 - step; x += step) {
      tri(x, inset0, x + step, inset0, x + step / 2, inset1 - hh * 0.2);
      tri(x, H - inset0, x + step, H - inset0, x + step / 2, H - inset1 + hh * 0.2);
    }
    // 左と右の辺
    for (let y = inset0; y < H - inset0 - step; y += step) {
      tri(x0 + inset0, y, x0 + inset0, y + step, x0 + inset1 - hh * 0.2, y + step / 2);
      tri(x1 - inset0, y, x1 - inset0, y + step, x1 - inset1 + hh * 0.2, y + step / 2);
    }
  };
  reciprocal(3 * S, gOut - 3 * S, cream);
  reciprocal(l2 + 3 * S, gIn - 3 * S, navy2);
  // 花の形：花びら n 枚のロゼット
  const rosette = (x: number, y: number, r: number, petal: string, center: string, n = 8, ring?: string) => {
    if (ring) {
      g.fillStyle = ring;
      g.beginPath();
      g.arc(x, y, r * 1.08, 0, Math.PI * 2);
      g.fill();
    }
    g.fillStyle = petal;
    for (let k = 0; k < n; k++) {
      const a = (k / n) * Math.PI * 2;
      g.beginPath();
      g.ellipse(x + Math.cos(a) * r * 0.5, y + Math.sin(a) * r * 0.5, r * 0.42, r * 0.2, a, 0, Math.PI * 2);
      g.fill();
    }
    g.fillStyle = center;
    g.beginPath();
    g.arc(x, y, r * 0.3, 0, Math.PI * 2);
    g.fill();
  };
  // パルメット（扇形の花）
  const palmette = (x: number, y: number, r: number, ang: number, col: string, inner: string) => {
    g.save();
    g.translate(x, y);
    g.rotate(ang);
    g.fillStyle = col;
    g.beginPath();
    g.moveTo(0, r * 0.35);
    for (let k = 0; k <= 10; k++) {
      const a = Math.PI * (1.1 + (k / 10) * 0.8);
      const rr = r * (k % 2 === 0 ? 1 : 0.78);
      g.lineTo(Math.cos(a) * rr, Math.sin(a) * rr + r * 0.2);
    }
    g.closePath();
    g.fill();
    g.fillStyle = inner;
    g.beginPath();
    g.ellipse(0, -r * 0.15, r * 0.28, r * 0.4, 0, 0, Math.PI * 2);
    g.fill();
    g.restore();
  };
  const leaf = (x: number, y: number, len: number, ang: number, col: string) => {
    g.save();
    g.translate(x, y);
    g.rotate(ang);
    g.fillStyle = col;
    g.beginPath();
    g.moveTo(-len / 2, 0);
    g.quadraticCurveTo(0, -len * 0.28, len / 2, 0);
    g.quadraticCurveTo(0, len * 0.28, -len / 2, 0);
    g.fill();
    g.restore();
  };
  // 主の縁：唐草（金と生成りの 2 本の波線）でつないだ、ロゼットとパルメットの交互の並び
  {
    const bh = mainIn - mainOut;
    const mid = (mainIn + mainOut) / 2;
    const step = bh * 1.25;
    const vine = (horizontal: boolean, at: number, from: number, to: number, phase: number, col: string, amp: number) => {
      g.strokeStyle = col;
      g.lineWidth = Math.max(1.5, bh * 0.05);
      g.beginPath();
      const n = Math.ceil((to - from) / 4);
      for (let i = 0; i <= n; i++) {
        const t = from + ((to - from) * i) / n;
        const o = Math.sin(((t - from) / step) * Math.PI + phase) * amp;
        if (horizontal) (i === 0 ? g.moveTo(t, at + o) : g.lineTo(t, at + o));
        else (i === 0 ? g.moveTo(at + o, t) : g.lineTo(at + o, t));
      }
      g.stroke();
    };
    for (const [horiz, at] of [
      [true, mid],
      [true, H - mid],
      [false, x0 + mid],
      [false, x1 - mid],
    ] as [boolean, number][]) {
      const from = horiz ? x0 + mainIn : mainIn;
      const to = horiz ? x1 - mainIn : H - mainIn;
      vine(horiz, at, from, to, 0, gold, bh * 0.24);
      vine(horiz, at, from, to, Math.PI, cream, bh * 0.24);
      let k = 0;
      for (let t = from + step * 0.5; t < to - step * 0.3; t += step, k++) {
        const px = horiz ? t : at;
        const py = horiz ? at : t;
        if (k % 2 === 0) rosette(px, py, bh * 0.34, red2, cream, 8, gold);
        else palmette(px, py, bh * 0.36, horiz ? (at < H / 2 ? 0 : Math.PI) : at < W / 2 ? -Math.PI / 2 : Math.PI / 2, cream, red2);
        // 唐草の葉
        for (const s of [-1, 1]) leaf(px + (horiz ? s * step * 0.32 : s * bh * 0.2), py + (horiz ? s * bh * 0.2 : s * step * 0.32), bh * 0.22, horiz ? s * 0.6 : Math.PI / 2 + s * 0.6, green);
      }
    }
    // 四隅：大きなロゼット
    for (const [cx, cy] of [
      [x0 + mid, mid],
      [x1 - mid, mid],
      [x0 + mid, H - mid],
      [x1 - mid, H - mid],
    ]) rosette(cx, cy, bh * 0.42, gold, red2, 10, cream);
  }
  // 地の総柄：菱形の格子（細い紺の線）の交点にロゼット、格子の辺に沿う細い葉、格子の中に小さな花
  const fx0 = x0 + fieldIn;
  const fy0 = fieldIn;
  const fw = bw - 2 * fieldIn;
  const fh = H - 2 * fieldIn;
  g.save();
  g.beginPath();
  g.rect(fx0, fy0, fw, fh);
  g.clip();
  {
    const cw = 64 * S;
    const ch = 46 * S;
    g.strokeStyle = 'rgba(44,56,96,0.55)';
    g.lineWidth = Math.max(1.2, 2.2 * S);
    for (let i = -2; i * cw < fw + cw * 2; i++) {
      g.beginPath();
      g.moveTo(fx0 + i * cw, fy0);
      g.lineTo(fx0 + i * cw + fh * (cw / ch), fy0 + fh);
      g.stroke();
      g.beginPath();
      g.moveTo(fx0 + i * cw, fy0 + fh);
      g.lineTo(fx0 + i * cw + fh * (cw / ch), fy0);
      g.stroke();
    }
    for (let j = 0; j * ch < fh + ch; j++) {
      for (let i = 0; i * cw < fw + cw; i++) {
        const x = fx0 + i * cw + (j % 2) * cw * 0.5;
        const y = fy0 + j * ch;
        const k = (i * 7 + j * 3) % 5;
        if (k === 0) rosette(x, y, 9 * S, navy2, cream, 8);
        else if (k === 2) rosette(x, y, 8 * S, gold, red2, 6);
        else rosette(x, y, 6.5 * S, cream, navy2, 6);
        // 格子の辺に沿う葉（4 方向）
        for (const [dx, dy] of [
          [1, 1],
          [-1, 1],
          [1, -1],
          [-1, -1],
        ]) {
          const ang = Math.atan2(dy * ch, dx * cw * 0.5);
          leaf(x + dx * cw * 0.17, y + dy * ch * 0.25, 15 * S, ang, (i + j) % 2 ? green : navy2);
        }
        // 格子の中の小さな花
        g.fillStyle = 'rgba(233,214,176,0.85)';
        g.beginPath();
        g.arc(x + cw * 0.5, y + ch * 0.5, 2.6 * S, 0, Math.PI * 2);
        g.fill();
      }
    }
  }
  // 四隅の飾り：紺の四分円に金の細い輪、えんじと生成りの花
  {
    const cr = Math.min(fw, fh) * 0.27;
    for (const [cx, cy, a0] of [
      [fx0, fy0, 0],
      [fx0 + fw, fy0, Math.PI / 2],
      [fx0 + fw, fy0 + fh, Math.PI],
      [fx0, fy0 + fh, Math.PI * 1.5],
    ] as [number, number, number][]) {
      g.fillStyle = colors.border;
      g.beginPath();
      g.moveTo(cx, cy);
      for (let k = 0; k <= 36; k++) {
        const a = a0 + (k / 36) * (Math.PI / 2);
        const r = cr * (1 + 0.07 * Math.cos(k * 1.9));
        g.lineTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r);
      }
      g.closePath();
      g.fill();
      g.strokeStyle = gold;
      g.lineWidth = 3 * S;
      g.beginPath();
      g.arc(cx, cy, cr * 0.84, a0, a0 + Math.PI / 2);
      g.stroke();
      for (let k = 0; k < 4; k++) {
        const a = a0 + ((k + 0.5) / 4) * (Math.PI / 2);
        rosette(cx + Math.cos(a) * cr * 0.6, cy + Math.sin(a) * cr * 0.6, cr * 0.11, red2, cream, 8);
        leaf(cx + Math.cos(a + 0.18) * cr * 0.36, cy + Math.sin(a + 0.18) * cr * 0.36, cr * 0.18, a, green);
      }
      rosette(cx + Math.cos(a0 + Math.PI / 4) * cr * 0.22, cy + Math.sin(a0 + Math.PI / 4) * cr * 0.22, cr * 0.1, gold, redDark, 6);
    }
  }
  // 中央のメダリオン（長い辺の向きに長い、多重の花びらの縁）と、両端の吊り飾り
  {
    const mx = W / 2;
    const my = H / 2;
    const shape = (s: number, col: string, lobes = 16, depth = 0.07) => {
      g.fillStyle = col;
      g.beginPath();
      const rx = fw * 0.2 * s;
      const ry = fh * 0.3 * s;
      for (let k = 0; k <= 160; k++) {
        const a = (k / 160) * Math.PI * 2;
        const lobe = 1 + depth * Math.cos(a * lobes);
        const ca = Math.cos(a);
        const sa = Math.sin(a);
        const d = 1 / Math.pow(Math.pow(Math.abs(ca), 1.4) + Math.pow(Math.abs(sa), 1.4), 1 / 1.4);
        const px = mx + ca * rx * d * lobe;
        const py = my + sa * ry * d * lobe;
        if (k === 0) g.moveTo(px, py);
        else g.lineTo(px, py);
      }
      g.closePath();
      g.fill();
    };
    // 吊り飾り（長い辺の向き：左右）
    for (const sx of [-1, 1]) {
      g.fillStyle = colors.border;
      g.beginPath();
      g.moveTo(mx + sx * fw * 0.19, my - fh * 0.05);
      g.quadraticCurveTo(mx + sx * fw * 0.3, my, mx + sx * fw * 0.19, my + fh * 0.05);
      g.closePath();
      g.fill();
      palmette(mx + sx * fw * 0.255, my, fh * 0.045, sx < 0 ? -Math.PI / 2 : Math.PI / 2, gold, red2);
    }
    shape(1.0, gold, 16, 0.07);
    shape(0.96, redDark, 16, 0.07);
    shape(0.88, colors.border, 16, 0.06);
    // 紺の環の中の花の輪
    for (let k = 0; k < 16; k++) {
      const a = (k / 16) * Math.PI * 2;
      rosette(mx + Math.cos(a) * fw * 0.155, my + Math.sin(a) * fh * 0.235, fh * 0.022, k % 2 ? cream : gold, red2, 6);
    }
    shape(0.68, red2, 12, 0.08);
    for (let k = 0; k < 12; k++) {
      const a = (k / 12) * Math.PI * 2 + 0.26;
      leaf(mx + Math.cos(a) * fw * 0.105, my + Math.sin(a) * fh * 0.16, fh * 0.05, a, k % 2 ? green : navy2);
    }
    shape(0.48, cream, 10, 0.08);
    for (let k = 0; k < 10; k++) {
      const a = (k / 10) * Math.PI * 2;
      rosette(mx + Math.cos(a) * fw * 0.07, my + Math.sin(a) * fh * 0.105, fh * 0.017, red2, navy2, 6);
    }
    shape(0.3, colors.border, 8, 0.1);
    rosette(mx, my, fh * 0.055, gold, redDark, 12, red2);
  }
  g.restore();
  // 手織りの色むら（アブラッシュ：長さの向きに変わる帯）と、結び目の細かなむら・毛足の向きのむら
  const img = g.getImageData(0, 0, W, H);
  const d = img.data;
  const band = Array.from({ length: W }, (_, x) => 1 + 0.035 * Math.sin(x * 0.011 + 1.3) + 0.025 * Math.sin(x * 0.0037 + 0.4));
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4;
      const knot = ((x >> 1) + (y >> 1)) & 1 ? 1.02 : 0.98;
      const n = (rand() - 0.5) * 18;
      const k = band[x] * knot;
      d[i] = Math.max(0, Math.min(255, d[i] * 0.95 * k + n));
      d[i + 1] = Math.max(0, Math.min(255, d[i + 1] * 0.95 * k + n * 0.85));
      d[i + 2] = Math.max(0, Math.min(255, d[i + 2] * 0.95 * k + n * 0.75));
    }
  }
  g.putImageData(img, 0, 0);
  return toTexture(c, 8);
}

/** 風景画（空・遠くの丘・湖・木立・手前の草地。柔らかな筆の跡） */
export function paintingTexture(seed: number, w = 512, h = 640) {
  const { c, g } = canvas(w, h);
  const rand = mulberry32(seed);
  const sky = g.createLinearGradient(0, 0, 0, h * 0.6);
  sky.addColorStop(0, '#9fb7c4');
  sky.addColorStop(0.6, '#e4dcc0');
  sky.addColorStop(1, '#f2e2b8');
  g.fillStyle = sky;
  g.fillRect(0, 0, w, h);
  // 雲
  for (let i = 0; i < 14; i++) {
    g.fillStyle = `rgba(255,248,232,${0.25 + rand() * 0.3})`;
    g.beginPath();
    g.ellipse(rand() * w, rand() * h * 0.35, 40 + rand() * 70, 12 + rand() * 18, 0, 0, Math.PI * 2);
    g.fill();
  }
  // 遠くの丘
  const hill = (y: number, amp: number, col: string) => {
    g.fillStyle = col;
    g.beginPath();
    g.moveTo(0, h);
    for (let x = 0; x <= w; x += 8) g.lineTo(x, y + Math.sin(x * 0.012 + seed) * amp + Math.sin(x * 0.031) * amp * 0.4);
    g.lineTo(w, h);
    g.closePath();
    g.fill();
  };
  hill(h * 0.52, 16, '#9aa58a');
  hill(h * 0.58, 12, '#7d8c62');
  // 湖
  g.fillStyle = '#b9c8c4';
  g.beginPath();
  g.ellipse(w * 0.45, h * 0.68, w * 0.36, h * 0.05, 0, 0, Math.PI * 2);
  g.fill();
  // 木立
  for (let i = 0; i < 9; i++) {
    const x = rand() < 0.5 ? rand() * w * 0.3 : w * 0.7 + rand() * w * 0.3;
    const y = h * (0.5 + rand() * 0.15);
    const r = 24 + rand() * 40;
    g.fillStyle = rand() < 0.5 ? '#3f5a2e' : '#556b35';
    g.beginPath();
    g.ellipse(x, y, r * 0.6, r, 0, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = '#4a3420';
    g.fillRect(x - 3, y + r * 0.8, 6, r * 0.6);
  }
  // 手前の草地
  const gr = g.createLinearGradient(0, h * 0.72, 0, h);
  gr.addColorStop(0, '#8d9a55');
  gr.addColorStop(1, '#5c6a34');
  g.fillStyle = gr;
  g.fillRect(0, h * 0.72, w, h * 0.28);
  // 筆の跡（細い斜めの線）
  for (let i = 0; i < 900; i++) {
    const x = rand() * w;
    const y = rand() * h;
    g.strokeStyle = `rgba(${rand() < 0.5 ? '255,255,240' : '40,40,20'},0.05)`;
    g.lineWidth = 2 + rand() * 3;
    g.beginPath();
    g.moveTo(x, y);
    g.lineTo(x + 8 + rand() * 10, y + (rand() - 0.5) * 6);
    g.stroke();
  }
  // ニスの黄ばみ（全体を少し暖かく、四隅を暗く）
  const vg = g.createRadialGradient(w / 2, h / 2, w * 0.2, w / 2, h / 2, w * 0.8);
  vg.addColorStop(0, 'rgba(255,220,150,0.06)');
  vg.addColorStop(1, 'rgba(60,35,10,0.35)');
  g.fillStyle = vg;
  g.fillRect(0, 0, w, h);
  return toTexture(c);
}

/** 地球儀の地図（黄ばんだ海と、茶色がかった大陸、経緯線） */
export function globeTexture(w = 1024, h = 512) {
  const { c, g } = canvas(w, h);
  const rand = mulberry32(5);
  // 古い地球儀の海：ニスの黄ばんだ淡い青緑
  const sea = g.createLinearGradient(0, 0, 0, h);
  sea.addColorStop(0, '#c9ceae');
  sea.addColorStop(0.5, '#d8d9bb');
  sea.addColorStop(1, '#c8caa8');
  g.fillStyle = sea;
  g.fillRect(0, 0, w, h);
  // 大陸（経度・緯度のおおまかな外形）
  const continents: [number, number][][] = [
    // 北アメリカ
    [[-165, 65], [-140, 70], [-95, 72], [-75, 62], [-60, 50], [-80, 30], [-97, 18], [-105, 22], [-118, 33], [-125, 48], [-150, 58]],
    // 南アメリカ
    [[-80, 10], [-60, 8], [-35, -7], [-40, -22], [-55, -35], [-70, -55], [-75, -40], [-80, -5]],
    // ユーラシア
    [[-10, 36], [0, 50], [10, 58], [30, 70], [70, 74], [110, 75], [140, 70], [170, 66], [150, 55], [135, 40], [120, 25], [105, 10], [90, 22], [75, 10], [60, 25], [45, 30], [35, 32], [25, 40], [10, 44]],
    // アフリカ
    [[-17, 15], [-10, 30], [10, 36], [32, 31], [43, 12], [51, 10], [40, -15], [32, -30], [20, -35], [12, -18], [8, 4], [-8, 5]],
    // オーストラリア
    [[114, -22], [130, -12], [142, -11], [153, -27], [146, -39], [135, -35], [115, -34]],
    // グリーンランド
    [[-55, 60], [-45, 82], [-25, 82], [-20, 70], [-40, 60]],
  ];
  const X = (lon: number) => ((lon + 180) / 360) * w;
  const Y = (lat: number) => ((90 - lat) / 180) * h;
  // 大陸は国ごとに塗り分けた古地図のような淡い色（黄土・朱鷺色・草色・砂色）と、セピアの輪郭
  const fills = ['#d9b47c', '#c7a074', '#e0c08a', '#c9946c', '#d6a28a', '#ece4cc'];
  for (const [ci, poly] of continents.entries()) {
    g.fillStyle = fills[ci % fills.length];
    g.strokeStyle = '#6e4a26';
    g.lineWidth = 2.5;
    g.beginPath();
    poly.forEach(([lon, lat], i) => {
      const jx = (rand() - 0.5) * 6;
      const jy = (rand() - 0.5) * 6;
      if (i === 0) g.moveTo(X(lon) + jx, Y(lat) + jy);
      else g.lineTo(X(lon) + jx, Y(lat) + jy);
    });
    g.closePath();
    g.fill();
    g.stroke();
  }
  // 南極
  g.fillStyle = '#c9b48a';
  g.fillRect(0, Y(-70), w, h - Y(-70));
  // 経緯線
  g.strokeStyle = 'rgba(90,60,30,0.35)';
  g.lineWidth = 1;
  for (let lon = -180; lon <= 180; lon += 30) {
    g.beginPath();
    g.moveTo(X(lon), 0);
    g.lineTo(X(lon), h);
    g.stroke();
  }
  for (let lat = -60; lat <= 60; lat += 30) {
    g.beginPath();
    g.moveTo(0, Y(lat));
    g.lineTo(w, Y(lat));
    g.stroke();
  }
  return toTexture(c);
}

/**
 * 天球儀の地図：濃い藍の空に金の星（明るさで大きさを変える）、星座の線、天の赤道と黄道の帯（黄道十二宮の目盛り）、
 * 経線（時角の線）。古い天球儀の、藍の地に金の線で描いた星図のような見た目
 */
export function celestialTexture(w = 1024, h = 512) {
  const { c, g } = canvas(w, h);
  const rand = mulberry32(23);
  const sky = g.createLinearGradient(0, 0, 0, h);
  sky.addColorStop(0, '#1d2a4c');
  sky.addColorStop(0.5, '#273a68');
  sky.addColorStop(1, '#1d2a4c');
  g.fillStyle = sky;
  g.fillRect(0, 0, w, h);
  const X = (ra: number) => (ra / 360) * w;
  const Y = (dec: number) => ((90 - dec) / 180) * h;
  const gold = '#e7c172';
  // 時角の線と赤緯の線
  g.strokeStyle = 'rgba(231,193,114,0.35)';
  g.lineWidth = 1;
  for (let ra = 0; ra < 360; ra += 30) {
    g.beginPath();
    g.moveTo(X(ra), 0);
    g.lineTo(X(ra), h);
    g.stroke();
  }
  for (let dec = -60; dec <= 60; dec += 30) {
    g.beginPath();
    g.moveTo(0, Y(dec));
    g.lineTo(w, Y(dec));
    g.stroke();
  }
  // 天の赤道（太い金の線）と、黄道の帯（赤道に 23.4° 傾いた正弦の帯）と十二宮の目盛り
  g.strokeStyle = gold;
  g.lineWidth = 2.5;
  g.beginPath();
  g.moveTo(0, Y(0));
  g.lineTo(w, Y(0));
  g.stroke();
  const ecl = (ra: number) => 23.4 * Math.sin((ra / 180) * Math.PI);
  for (const off of [-6, 6]) {
    g.lineWidth = 1.5;
    g.beginPath();
    for (let ra = 0; ra <= 360; ra += 4) {
      const y = Y(ecl(ra) + off);
      if (ra === 0) g.moveTo(X(ra), y);
      else g.lineTo(X(ra), y);
    }
    g.stroke();
  }
  for (let ra = 0; ra < 360; ra += 30) {
    g.beginPath();
    g.moveTo(X(ra), Y(ecl(ra) - 6));
    g.lineTo(X(ra), Y(ecl(ra) + 6));
    g.stroke();
  }
  // 星座：近くの星を線で結んだ小さな群れ
  g.lineWidth = 1.2;
  g.strokeStyle = 'rgba(231,193,114,0.75)';
  const stars: [number, number, number][] = [];
  for (let k = 0; k < 26; k++) {
    const ra0 = rand() * 360;
    const dec0 = (rand() - 0.5) * 140;
    const n = 4 + Math.floor(rand() * 4);
    let ra = ra0;
    let dec = dec0;
    g.beginPath();
    for (let i = 0; i < n; i++) {
      if (i === 0) g.moveTo(X(ra), Y(dec));
      else g.lineTo(X(ra), Y(dec));
      stars.push([ra, dec, 1.6 + rand() * 2.2]);
      ra = (ra + (rand() - 0.3) * 18 + 360) % 360;
      dec = Math.max(-80, Math.min(80, dec + (rand() - 0.5) * 16));
    }
    g.stroke();
  }
  for (let k = 0; k < 260; k++) stars.push([rand() * 360, (rand() - 0.5) * 170, 0.6 + rand() * rand() * 2.2]);
  g.fillStyle = gold;
  for (const [ra, dec, r] of stars) {
    const x = X(ra);
    const y = Y(dec);
    if (r > 2.2) {
      // 明るい星は 8 本の光の筋
      g.beginPath();
      for (let i = 0; i < 16; i++) {
        const a = (i / 16) * Math.PI * 2;
        const rr = i % 2 === 0 ? r * 1.9 : r * 0.55;
        g.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr);
      }
      g.closePath();
      g.fill();
    } else {
      g.beginPath();
      g.arc(x, y, r, 0, Math.PI * 2);
      g.fill();
    }
  }
  return toTexture(c);
}
