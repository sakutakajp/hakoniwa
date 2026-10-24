import { BRANDS, FONT_FAMILY, drawEmblem, type BrandKey } from './brands';

/**
 * 看板の絵をキャンバスに描く：自作の絵記号、架空のお店のロゴの看板（横長・縦長・見出し）。
 * 実在の店名やロゴは使わない。絵記号は 0〜1 の正方形の中に、線と塗りで描く
 */
export type IconName =
  | 'controller'
  | 'train'
  | 'car'
  | 'plane'
  | 'robot'
  | 'box'
  | 'camera'
  | 'laptop'
  | 'headphones'
  | 'chip'
  | 'pin'
  | 'phone'
  | 'tv'
  | 'disc'
  | 'star';

type Ctx = CanvasRenderingContext2D;

function rr(ctx: Ctx, x: number, y: number, w: number, h: number, r: number) {
  const k = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + k, y);
  ctx.lineTo(x + w - k, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + k);
  ctx.lineTo(x + w, y + h - k);
  ctx.quadraticCurveTo(x + w, y + h, x + w - k, y + h);
  ctx.lineTo(x + k, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - k);
  ctx.lineTo(x, y + k);
  ctx.quadraticCurveTo(x, y, x + k, y);
  ctx.closePath();
}

/** 絵記号を (x, y) から一辺 s の正方形に描く */
export function drawIcon(ctx: Ctx, name: IconName, x: number, y: number, s: number, fg: string, bg: string) {
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(s, s);
  ctx.fillStyle = fg;
  ctx.strokeStyle = fg;
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  switch (name) {
    case 'controller': {
      // 両手で持つゲーム機のコントローラー
      ctx.beginPath();
      ctx.moveTo(0.22, 0.32);
      ctx.lineTo(0.78, 0.32);
      ctx.bezierCurveTo(0.93, 0.32, 0.98, 0.55, 0.95, 0.68);
      ctx.bezierCurveTo(0.92, 0.8, 0.8, 0.8, 0.74, 0.7);
      ctx.lineTo(0.66, 0.6);
      ctx.lineTo(0.34, 0.6);
      ctx.lineTo(0.26, 0.7);
      ctx.bezierCurveTo(0.2, 0.8, 0.08, 0.8, 0.05, 0.68);
      ctx.bezierCurveTo(0.02, 0.55, 0.07, 0.32, 0.22, 0.32);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = bg;
      // 十字キー
      ctx.fillRect(0.2, 0.42, 0.14, 0.045);
      ctx.fillRect(0.248, 0.375, 0.045, 0.14);
      // ボタン
      for (const [bx, by] of [
        [0.72, 0.39],
        [0.78, 0.45],
        [0.66, 0.45],
        [0.72, 0.51],
      ]) {
        ctx.beginPath();
        ctx.arc(bx, by, 0.028, 0, Math.PI * 2);
        ctx.fill();
      }
      break;
    }
    case 'train': {
      // 正面から見た電車
      rr(ctx, 0.27, 0.14, 0.46, 0.6, 0.12);
      ctx.fill();
      ctx.fillStyle = bg;
      rr(ctx, 0.33, 0.22, 0.34, 0.2, 0.04);
      ctx.fill();
      ctx.fillRect(0.47, 0.22, 0.06, 0.2);
      ctx.fillStyle = fg;
      ctx.fillRect(0.495, 0.22, 0.01, 0.2);
      ctx.fillStyle = bg;
      ctx.beginPath();
      ctx.arc(0.36, 0.58, 0.04, 0, Math.PI * 2);
      ctx.arc(0.64, 0.58, 0.04, 0, Math.PI * 2);
      ctx.fill();
      ctx.lineWidth = 0.04;
      ctx.beginPath();
      ctx.moveTo(0.36, 0.74);
      ctx.lineTo(0.26, 0.88);
      ctx.moveTo(0.64, 0.74);
      ctx.lineTo(0.74, 0.88);
      ctx.moveTo(0.29, 0.83);
      ctx.lineTo(0.71, 0.83);
      ctx.stroke();
      break;
    }
    case 'car': {
      // 横から見た車
      ctx.beginPath();
      ctx.moveTo(0.08, 0.66);
      ctx.lineTo(0.08, 0.56);
      ctx.quadraticCurveTo(0.1, 0.5, 0.2, 0.48);
      ctx.lineTo(0.32, 0.36);
      ctx.quadraticCurveTo(0.36, 0.32, 0.44, 0.32);
      ctx.lineTo(0.64, 0.32);
      ctx.quadraticCurveTo(0.7, 0.32, 0.74, 0.37);
      ctx.lineTo(0.82, 0.48);
      ctx.quadraticCurveTo(0.92, 0.5, 0.93, 0.58);
      ctx.lineTo(0.93, 0.66);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = bg;
      ctx.beginPath();
      ctx.moveTo(0.36, 0.46);
      ctx.lineTo(0.42, 0.38);
      ctx.lineTo(0.52, 0.38);
      ctx.lineTo(0.52, 0.46);
      ctx.closePath();
      ctx.moveTo(0.56, 0.46);
      ctx.lineTo(0.56, 0.38);
      ctx.lineTo(0.66, 0.38);
      ctx.lineTo(0.72, 0.46);
      ctx.closePath();
      ctx.fill();
      for (const wx of [0.27, 0.73]) {
        ctx.fillStyle = bg;
        ctx.beginPath();
        ctx.arc(wx, 0.66, 0.095, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = fg;
        ctx.beginPath();
        ctx.arc(wx, 0.66, 0.065, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = bg;
        ctx.beginPath();
        ctx.arc(wx, 0.66, 0.025, 0, Math.PI * 2);
        ctx.fill();
      }
      break;
    }
    case 'plane': {
      // 斜め上へ飛ぶ飛行機
      ctx.translate(0.5, 0.5);
      ctx.rotate(-0.35);
      ctx.beginPath();
      ctx.ellipse(0, 0, 0.42, 0.055, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.moveTo(-0.05, 0);
      ctx.lineTo(0.08, 0);
      ctx.lineTo(-0.12, 0.3);
      ctx.lineTo(-0.2, 0.3);
      ctx.closePath();
      ctx.moveTo(-0.05, 0);
      ctx.lineTo(0.08, 0);
      ctx.lineTo(-0.1, -0.22);
      ctx.lineTo(-0.17, -0.22);
      ctx.closePath();
      ctx.moveTo(-0.3, 0);
      ctx.lineTo(-0.38, -0.16);
      ctx.lineTo(-0.42, -0.16);
      ctx.lineTo(-0.4, 0);
      ctx.closePath();
      ctx.fill();
      break;
    }
    case 'robot': {
      // 人型のロボット
      ctx.fillRect(0.42, 0.1, 0.16, 0.12);
      ctx.fillRect(0.47, 0.06, 0.06, 0.05);
      ctx.beginPath();
      ctx.moveTo(0.3, 0.24);
      ctx.lineTo(0.7, 0.24);
      ctx.lineTo(0.66, 0.5);
      ctx.lineTo(0.34, 0.5);
      ctx.closePath();
      ctx.fill();
      ctx.fillRect(0.2, 0.24, 0.12, 0.1);
      ctx.fillRect(0.68, 0.24, 0.12, 0.1);
      ctx.fillRect(0.2, 0.34, 0.08, 0.24);
      ctx.fillRect(0.72, 0.34, 0.08, 0.24);
      ctx.fillRect(0.38, 0.5, 0.24, 0.08);
      ctx.fillRect(0.36, 0.58, 0.11, 0.3);
      ctx.fillRect(0.53, 0.58, 0.11, 0.3);
      ctx.fillRect(0.32, 0.86, 0.16, 0.06);
      ctx.fillRect(0.52, 0.86, 0.16, 0.06);
      ctx.fillStyle = bg;
      ctx.fillRect(0.45, 0.14, 0.1, 0.03);
      ctx.fillRect(0.46, 0.3, 0.08, 0.1);
      break;
    }
    case 'box': {
      // 箱（線で描いた立方体）
      ctx.lineWidth = 0.045;
      ctx.beginPath();
      ctx.moveTo(0.5, 0.18);
      ctx.lineTo(0.82, 0.34);
      ctx.lineTo(0.82, 0.7);
      ctx.lineTo(0.5, 0.86);
      ctx.lineTo(0.18, 0.7);
      ctx.lineTo(0.18, 0.34);
      ctx.closePath();
      ctx.moveTo(0.18, 0.34);
      ctx.lineTo(0.5, 0.5);
      ctx.lineTo(0.82, 0.34);
      ctx.moveTo(0.5, 0.5);
      ctx.lineTo(0.5, 0.86);
      ctx.stroke();
      break;
    }
    case 'camera': {
      rr(ctx, 0.14, 0.3, 0.72, 0.48, 0.08);
      ctx.fill();
      rr(ctx, 0.36, 0.22, 0.24, 0.12, 0.03);
      ctx.fill();
      ctx.fillStyle = bg;
      ctx.beginPath();
      ctx.arc(0.5, 0.54, 0.16, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = fg;
      ctx.beginPath();
      ctx.arc(0.5, 0.54, 0.1, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = bg;
      ctx.fillRect(0.72, 0.36, 0.08, 0.05);
      break;
    }
    case 'laptop': {
      ctx.lineWidth = 0.05;
      rr(ctx, 0.24, 0.24, 0.52, 0.36, 0.03);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(0.12, 0.7);
      ctx.lineTo(0.88, 0.7);
      ctx.lineTo(0.82, 0.62);
      ctx.lineTo(0.18, 0.62);
      ctx.closePath();
      ctx.fill();
      break;
    }
    case 'headphones': {
      ctx.lineWidth = 0.07;
      ctx.beginPath();
      ctx.arc(0.5, 0.52, 0.3, Math.PI, 0);
      ctx.stroke();
      rr(ctx, 0.15, 0.5, 0.15, 0.28, 0.05);
      ctx.fill();
      rr(ctx, 0.7, 0.5, 0.15, 0.28, 0.05);
      ctx.fill();
      break;
    }
    case 'chip': {
      ctx.lineWidth = 0.035;
      rr(ctx, 0.28, 0.28, 0.44, 0.44, 0.04);
      ctx.stroke();
      for (let i = 0; i < 4; i++) {
        const p = 0.35 + i * 0.1;
        ctx.beginPath();
        ctx.moveTo(p, 0.28);
        ctx.lineTo(p, 0.18);
        ctx.moveTo(p, 0.72);
        ctx.lineTo(p, 0.82);
        ctx.moveTo(0.28, p);
        ctx.lineTo(0.18, p);
        ctx.moveTo(0.72, p);
        ctx.lineTo(0.82, p);
        ctx.stroke();
      }
      ctx.lineWidth = 0.025;
      ctx.beginPath();
      ctx.moveTo(0.36, 0.42);
      ctx.lineTo(0.48, 0.42);
      ctx.lineTo(0.48, 0.58);
      ctx.lineTo(0.64, 0.58);
      ctx.moveTo(0.36, 0.58);
      ctx.lineTo(0.42, 0.52);
      ctx.moveTo(0.56, 0.36);
      ctx.lineTo(0.56, 0.48);
      ctx.lineTo(0.64, 0.48);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(0.64, 0.58, 0.025, 0, Math.PI * 2);
      ctx.arc(0.36, 0.42, 0.025, 0, Math.PI * 2);
      ctx.fill();
      break;
    }
    case 'pin': {
      // 安全ピン
      ctx.lineWidth = 0.05;
      ctx.translate(0.5, 0.5);
      ctx.rotate(-0.6);
      ctx.beginPath();
      ctx.moveTo(-0.34, -0.06);
      ctx.lineTo(0.28, -0.06);
      ctx.arc(0.28, 0, 0.06, -Math.PI / 2, Math.PI / 2);
      ctx.lineTo(-0.3, 0.06);
      ctx.stroke();
      rr(ctx, -0.42, -0.1, 0.14, 0.2, 0.04);
      ctx.fill();
      break;
    }
    case 'phone': {
      rr(ctx, 0.33, 0.14, 0.34, 0.72, 0.06);
      ctx.fill();
      ctx.fillStyle = bg;
      ctx.fillRect(0.37, 0.22, 0.26, 0.5);
      ctx.beginPath();
      ctx.arc(0.5, 0.79, 0.03, 0, Math.PI * 2);
      ctx.fill();
      break;
    }
    case 'tv': {
      ctx.lineWidth = 0.05;
      rr(ctx, 0.16, 0.24, 0.68, 0.46, 0.05);
      ctx.stroke();
      ctx.fillRect(0.4, 0.74, 0.2, 0.05);
      ctx.beginPath();
      ctx.moveTo(0.38, 0.12);
      ctx.lineTo(0.5, 0.22);
      ctx.lineTo(0.62, 0.12);
      ctx.stroke();
      break;
    }
    case 'disc': {
      ctx.beginPath();
      ctx.arc(0.5, 0.5, 0.34, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = bg;
      ctx.beginPath();
      ctx.arc(0.5, 0.5, 0.08, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = bg;
      ctx.lineWidth = 0.02;
      ctx.beginPath();
      ctx.arc(0.5, 0.5, 0.24, -0.9, -0.2);
      ctx.stroke();
      break;
    }
    case 'star': {
      ctx.beginPath();
      for (let i = 0; i < 10; i++) {
        const a = -Math.PI / 2 + (i * Math.PI) / 5;
        const r = i % 2 ? 0.17 : 0.38;
        const px = 0.5 + Math.cos(a) * r;
        const py = 0.53 + Math.sin(a) * r;
        if (i) ctx.lineTo(px, py);
        else ctx.moveTo(px, py);
      }
      ctx.closePath();
      ctx.fill();
      break;
    }
  }
  ctx.restore();
}

/** 縦に積んだ絵記号の看板（パネルごとに背景色と絵の色） */
export function drawIconStack(
  ctx: Ctx,
  x: number,
  y: number,
  w: number,
  h: number,
  panels: { icon: IconName; bg: string; fg: string }[],
  frame: string,
  brand?: BrandKey,
) {
  ctx.fillStyle = frame;
  ctx.fillRect(x, y, w, h);
  const pad = Math.max(2, w * 0.05);
  // 上にお店のロゴの見出し
  if (brand) {
    const hh = w * 0.9;
    drawHeader(ctx, x + pad, y + pad, w - pad * 2, hh, brand);
    y += hh + pad;
    h -= hh + pad;
  }
  const ih = (h - pad * 2) / panels.length;
  panels.forEach((p, i) => {
    const py = y + pad + i * ih;
    ctx.fillStyle = p.bg;
    ctx.fillRect(x + pad, py + (i ? 1 : 0), w - pad * 2, ih - (i ? 1 : 0));
    const s = Math.min(w - pad * 2, ih) * 0.84;
    drawIcon(ctx, p.icon, x + (w - s) / 2, py + (ih - s) / 2, s, p.fg, p.bg);
    // パネルのつなぎ目の細い線
    if (i) {
      ctx.fillStyle = 'rgba(0,0,0,0.18)';
      ctx.fillRect(x + pad, py, w - pad * 2, Math.max(1, ih * 0.012));
    }
  });
}

/** 細い書体は、同じ色の縁取りで少し太らせる（遠くからでも読めるように） */
const BOOST: Partial<Record<string, number>> = { [FONT_FAMILY.pixel]: 0.07, [FONT_FAMILY.pop]: 0.03 };

function fillTextBold(ctx: Ctx, text: string, x: number, y: number, font: string, size: number) {
  ctx.fillText(text, x, y);
  const k = BOOST[font];
  if (k) {
    ctx.save();
    ctx.strokeStyle = ctx.fillStyle;
    ctx.lineWidth = Math.max(1, size * k);
    ctx.lineJoin = 'round';
    ctx.strokeText(text, x, y);
    ctx.restore();
  }
}

/** 縦書きで小さく書く仮名（横書きの字形のままなので、縦書きの位置へ右上にずらす） */
const SMALL_KANA = new Set(Array.from('ぁぃぅぇぉっゃゅょゎァィゥェォッャュョヮヵヶ'));

/**
 * 縦書きで 1 文字ずつ描く（中心の x、上端、1 文字の大きさ、字間）。
 * 長音記号は縦の線に、小さな仮名は右上に、空白は半分の間にする
 */
function drawVertical(ctx: Ctx, text: string, cx: number, top: number, cell: number, gap = 0, font = '') {
  let y = top;
  for (const ch of Array.from(text)) {
    if (ch === ' ' || ch === '\u3000') {
      y += cell * 0.5;
      continue;
    }
    const cy = y + cell / 2;
    if (ch === 'ー' || ch === '－') {
      ctx.fillRect(cx - cell * 0.07, cy - cell * 0.36, cell * 0.14, cell * 0.72);
    } else if (SMALL_KANA.has(ch)) {
      fillTextBold(ctx, ch, cx + cell * 0.1, cy - cell * 0.12, font, cell);
    } else {
      fillTextBold(ctx, ch, cx, cy, font, cell);
    }
    y += cell + gap;
  }
}

/** 縦書きの文字の高さ（空白は半分） */
function verticalLength(text: string) {
  return Array.from(text).reduce((a, c) => a + (c === ' ' || c === '\u3000' ? 0.5 : 1), 0);
}

/** 文字の看板（縦書き・横書き）。背景、縁取り、文字の色 */
export function drawTextSign(
  ctx: Ctx,
  x: number,
  y: number,
  w: number,
  h: number,
  text: string,
  bg: string,
  fg: string,
  border: string | null,
  vertical: boolean,
) {
  ctx.fillStyle = bg;
  ctx.fillRect(x, y, w, h);
  if (border) {
    ctx.strokeStyle = border;
    ctx.lineWidth = Math.max(2, Math.min(w, h) * 0.07);
    ctx.strokeRect(x + ctx.lineWidth * 0.9, y + ctx.lineWidth * 0.9, w - ctx.lineWidth * 1.8, h - ctx.lineWidth * 1.8);
  }
  ctx.fillStyle = fg;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const family = FONT_FAMILY.gothic;
  if (vertical) {
    const n = verticalLength(text);
    const cell = Math.min(w * 0.72, (h * 0.86) / n);
    ctx.font = `400 ${Math.floor(cell * 0.92)}px ${family}`;
    drawVertical(ctx, text, x + w / 2, y + (h - cell * n) / 2, cell, 0, family);
  } else {
    const size = Math.min(h * 0.62, (w * 0.9) / Math.max(1, Array.from(text).length));
    ctx.font = `400 ${Math.floor(size)}px ${family}`;
    fitText(ctx, text, x + w / 2, y + h / 2 + size * 0.04, w * 0.9, size, family);
  }
}

/** 文字を幅 maxW に収めて描く（大きすぎるときは横に詰める） */
function fitText(ctx: Ctx, text: string, cx: number, cy: number, maxW: number, size: number, font: string, weight = '400') {
  ctx.font = `${weight} ${Math.round(size)}px ${font}`;
  const w = ctx.measureText(text).width;
  ctx.save();
  ctx.translate(cx, cy);
  if (w > maxW) ctx.scale(maxW / w, 1);
  fillTextBold(ctx, text, 0, 0, font, size);
  ctx.restore();
  return Math.min(w, maxW);
}

/** 英字の添え書き（字間を少し空ける） */
function drawSub(ctx: Ctx, text: string, cx: number, cy: number, maxW: number, size: number, color: string) {
  ctx.fillStyle = color;
  ctx.font = `400 ${Math.round(size)}px ${FONT_FAMILY.latin}`;
  const spacing = size * 0.12;
  const chars = Array.from(text);
  const widths = chars.map((c) => ctx.measureText(c).width);
  let total = widths.reduce((a, b) => a + b, 0) + spacing * (chars.length - 1);
  const k = total > maxW ? maxW / total : 1;
  total *= k;
  ctx.save();
  ctx.translate(cx - total / 2, cy);
  ctx.scale(k, 1);
  let x = 0;
  ctx.textAlign = 'left';
  chars.forEach((c, i) => {
    ctx.fillText(c, x, 0);
    x += widths[i] + spacing;
  });
  ctx.restore();
  ctx.textAlign = 'center';
}

function brandBackground(ctx: Ctx, x: number, y: number, w: number, h: number, key: BrandKey) {
  const b = BRANDS[key];
  if ('light' in b && b.light) {
    const g = ctx.createLinearGradient(0, y, 0, y + h);
    g.addColorStop(0, '#ffffff');
    g.addColorStop(1, b.bg === '#ffffff' ? '#e9e6e0' : b.bg);
    ctx.fillStyle = g;
  } else {
    const g = ctx.createLinearGradient(0, y, 0, y + h);
    g.addColorStop(0, b.bg);
    g.addColorStop(1, shade(b.bg, 0.78));
    ctx.fillStyle = g;
  }
  ctx.fillRect(x, y, w, h);
}

/** 色の明るさ（0〜1、おおよそ） */
function luminance(hex: string) {
  const n = Number.parseInt(hex.slice(1), 16);
  return (0.299 * ((n >> 16) & 255) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255;
}

/** 色を暗くする（k 倍） */
function shade(hex: string, k: number) {
  const n = Number.parseInt(hex.slice(1), 16);
  const r = Math.round(((n >> 16) & 255) * k);
  const g = Math.round(((n >> 8) & 255) * k);
  const b = Math.round((n & 255) * k);
  return `rgb(${r},${g},${b})`;
}

function emblemBadge(ctx: Ctx, key: BrandKey, cx: number, cy: number, d: number) {
  const b = BRANDS[key];
  ctx.fillStyle = b.accent;
  ctx.beginPath();
  ctx.arc(cx, cy, d / 2, 0, Math.PI * 2);
  ctx.fill();
  const ink = 'emblemInk' in b && b.emblemInk ? b.emblemInk : b.bg;
  drawEmblem(ctx, b.emblem, cx - d * 0.36, cy - d * 0.36, d * 0.72, ink, b.accent);
}

/** 横長の店名の看板（左にロゴのしるし、店名、下に英字） */
export function drawFascia(ctx: Ctx, x: number, y: number, w: number, h: number, key: BrandKey) {
  const b = BRANDS[key];
  brandBackground(ctx, x, y, w, h, key);
  // 上下の縁
  ctx.fillStyle = 'rgba(0,0,0,0.25)';
  ctx.fillRect(x, y + h - Math.max(1, h * 0.06), w, Math.max(1, h * 0.06));
  ctx.fillStyle = 'rgba(255,255,255,0.25)';
  ctx.fillRect(x, y, w, Math.max(1, h * 0.05));
  const d = h * 0.8;
  const textX0 = x + h * 1.02;
  const textW = w - (textX0 - x) - h * 0.22;
  // 店名と英字をまとめて、文字の場所の中央に
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = b.fg;
  const nameSize = h * 0.54;
  ctx.font = `400 ${Math.round(nameSize)}px ${FONT_FAMILY[b.font]}`;
  const nameW = Math.min(ctx.measureText(b.name).width, textW);
  const blockW = Math.max(nameW, Math.min(textW, nameW));
  const cx = textX0 + textW / 2;
  // ロゴのしるしは、店名のすぐ左（看板が長いときに離れすぎないように）
  const badgeX = Math.max(x + h * 0.5, cx - blockW / 2 - h * 0.55);
  emblemBadge(ctx, key, badgeX, y + h / 2, d);
  ctx.fillStyle = b.fg;
  fitText(ctx, b.name, cx, y + h * 0.42, textW, nameSize, FONT_FAMILY[b.font]);
  drawSub(ctx, b.sub, cx, y + h * 0.82, Math.min(textW, blockW * 1.05), h * 0.15, b.fg);
}

/** 縦長の店名の看板（上にロゴのしるし、縦書きの店名、下に階） */
export function drawBlade(ctx: Ctx, x: number, y: number, w: number, h: number, key: BrandKey, floor?: string) {
  const b = BRANDS[key];
  brandBackground(ctx, x, y, w, h, key);
  const lw = Math.max(2, w * 0.06);
  ctx.strokeStyle = b.accent;
  ctx.lineWidth = lw;
  ctx.strokeRect(x + lw * 0.8, y + lw * 0.8, w - lw * 1.6, h - lw * 1.6);
  const d = w * 0.78;
  emblemBadge(ctx, key, x + w / 2, y + lw * 1.6 + d / 2, d);
  const top = y + lw * 2.2 + d;
  const bottomBand = floor ? w * 0.55 : 0;
  const avail = y + h - lw * 1.8 - bottomBand - top;
  // 縦に入るなら正式な名前、入らなければ短い名前
  const full = b.name;
  const short = ('short' in b && b.short) || b.name;
  const name = avail / verticalLength(full) >= w * 0.5 ? full : short;
  const n = verticalLength(name);
  const cell = Math.min(w * 0.7, avail / n);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = b.fg;
  ctx.font = `400 ${Math.floor(cell * 0.94)}px ${FONT_FAMILY[b.font]}`;
  drawVertical(ctx, name, x + w / 2, top + (avail - cell * n) / 2, cell, 0, FONT_FAMILY[b.font]);
  if (floor) {
    ctx.fillStyle = b.accent;
    ctx.fillRect(x + lw * 1.6, y + h - lw * 1.6 - bottomBand, w - lw * 3.2, bottomBand);
    ctx.fillStyle = 'emblemInk' in b && b.emblemInk ? b.emblemInk : b.bg;
    ctx.font = `400 ${Math.floor(bottomBand * 0.62)}px ${FONT_FAMILY.latin}`;
    ctx.fillText(floor, x + w / 2, y + h - lw * 1.6 - bottomBand / 2);
  }
}

/** 大きな看板の上の見出し（ロゴのしるしと店名） */
export function drawHeader(ctx: Ctx, x: number, y: number, w: number, h: number, key: BrandKey) {
  const b = BRANDS[key];
  brandBackground(ctx, x, y, w, h, key);
  const d = Math.min(h * 0.62, w * 0.3);
  emblemBadge(ctx, key, x + w / 2, y + h * 0.06 + d / 2, d);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = b.fg;
  fitText(ctx, b.name, x + w / 2, y + h * 0.06 + d + (h * 0.94 - d) * 0.42, w * 0.9, (h * 0.94 - d) * 0.55, FONT_FAMILY[b.font]);
  drawSub(ctx, b.sub, x + w / 2, y + h * 0.06 + d + (h * 0.94 - d) * 0.84, w * 0.86, (h * 0.94 - d) * 0.2, b.fg);
}

/** 縦長の帯に、店名を縦に大きく（ネオンの帯の看板）。上下にロゴのしるし */
export function drawBrandStrip(ctx: Ctx, x: number, y: number, w: number, h: number, key: BrandKey, color: string, light: string) {
  const g = ctx.createLinearGradient(x, 0, x + w, 0);
  g.addColorStop(0, color);
  g.addColorStop(0.5, light);
  g.addColorStop(1, color);
  ctx.fillStyle = g;
  ctx.fillRect(x, y, w, h);
  const b = BRANDS[key];
  // 縁の細い線
  const lw = Math.max(2, w * 0.05);
  ctx.strokeStyle = 'rgba(255,255,255,0.75)';
  ctx.lineWidth = lw;
  ctx.strokeRect(x + lw * 1.2, y + lw * 1.2, w - lw * 2.4, h - lw * 2.4);
  const d = w * 0.7;
  emblemBadge(ctx, key, x + w / 2, y + lw * 2.6 + d / 2, d);
  emblemBadge(ctx, key, x + w / 2, y + h - lw * 2.6 - d / 2, d);
  const top = y + lw * 3.4 + d;
  const avail = h - 2 * (lw * 3.4 + d);
  const name = b.name;
  const n = verticalLength(name);
  const cell = Math.min(w * 0.74, avail / n);
  // 余るときは字間を空ける（文字の大きさの 0.6 倍まで）
  const count = Array.from(name).filter((c) => c !== ' ').length;
  const gap = count > 1 ? Math.min(cell * 0.6, Math.max(0, (avail * 0.9 - cell * n) / (count - 1))) : 0;
  const total = cell * n + gap * (count - 1);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  // 地が明るい帯は、お店の文字の色で
  ctx.fillStyle = luminance(color) > 0.6 ? b.fg : '#ffffff';
  ctx.font = `400 ${Math.floor(cell * 0.92)}px ${FONT_FAMILY[b.font]}`;
  drawVertical(ctx, name, x + w / 2, top + (avail - total) / 2, cell, gap, FONT_FAMILY[b.font]);
}
