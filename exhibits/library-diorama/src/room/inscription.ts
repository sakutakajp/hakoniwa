import * as THREE from 'three';

/**
 * 回廊の鼻隠しの金文字（区画ごとの学問の名）と、柱形の上の小さな花の飾り。
 * 字の形をアルファに描いたテクスチャ（金色はシェーダーで付ける）。1 つのセルが 1 つの区画の帯（横 7.5 : 縦 1）
 */
export const INSCRIPTION_CELL = { w: 1024, h: 136 };
const COLS = 2;
const ROWS = 8;

export interface InscriptionAtlas {
  texture: THREE.Texture;
  /** 語の番号（words の順）のセルの uv の範囲 [u0, v0, u1, v1]（v0 が下） */
  word: (i: number) => [number, number, number, number];
  /** 花の飾りのセルの uv の範囲（縦横比 aspect = 幅 / 高さ に合わせて中央を切り出す） */
  rosette: (aspect: number) => [number, number, number, number];
}

export function createInscriptionAtlas(words: string[]): InscriptionAtlas {
  const { w, h } = INSCRIPTION_CELL;
  const canvas = document.createElement('canvas');
  canvas.width = w * COLS;
  canvas.height = h * ROWS;
  const g = canvas.getContext('2d')!;
  g.clearRect(0, 0, canvas.width, canvas.height);
  g.fillStyle = '#ffffff';
  g.textBaseline = 'alphabetic';
  const cellOf = (i: number) => ({ x: (i % COLS) * w, y: Math.floor(i / COLS) * h });
  // 碑文の大文字：字の間を広く空け、字の高さはセルの 52%
  const capH = h * 0.52;
  const fontPx = capH / 0.7;
  const fonts = `600 ${fontPx}px "Times New Roman", Georgia, "Hiragino Mincho ProN", serif`;
  words.forEach((word, i) => {
    const { x, y } = cellOf(i);
    g.font = fonts;
    const spacing = fontPx * 0.16;
    const letters = [...word];
    const widths = letters.map((ch) => g.measureText(ch).width);
    const total = widths.reduce((s, v) => s + v, 0) + spacing * (letters.length - 1);
    const scale = Math.min(1, (w * 0.86) / total);
    g.save();
    g.translate(x + w / 2, y + h / 2 + capH / 2);
    g.scale(scale, 1);
    let cx = -total / 2;
    letters.forEach((ch, k) => {
      g.fillText(ch, cx, 0);
      cx += widths[k] + spacing;
    });
    g.restore();
    // 語の両脇の小さな菱形の点
    for (const s of [-1, 1]) {
      const px = x + w / 2 + s * (Math.min(total * scale, w * 0.86) / 2 + fontPx * 0.32);
      const py = y + h / 2;
      const r = h * 0.07;
      g.beginPath();
      g.moveTo(px, py - r);
      g.lineTo(px + r, py);
      g.lineTo(px, py + r);
      g.lineTo(px - r, py);
      g.closePath();
      g.fill();
    }
  });
  // 花の飾り（8 枚の花びらと中心）。最後のセル
  const ri = COLS * ROWS - 1;
  {
    const { x, y } = cellOf(ri);
    const cx = x + w / 2;
    const cy = y + h / 2;
    const R = h * 0.36;
    for (let k = 0; k < 8; k++) {
      const a = (k / 8) * Math.PI * 2;
      g.beginPath();
      g.ellipse(cx + Math.cos(a) * R * 0.52, cy + Math.sin(a) * R * 0.52, R * 0.42, R * 0.17, a, 0, Math.PI * 2);
      g.fill();
    }
    g.globalCompositeOperation = 'destination-out';
    g.beginPath();
    g.arc(cx, cy, R * 0.22, 0, Math.PI * 2);
    g.fill();
    g.globalCompositeOperation = 'source-over';
    g.beginPath();
    g.arc(cx, cy, R * 0.13, 0, Math.PI * 2);
    g.fill();
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.NoColorSpace;
  texture.anisotropy = 4;
  texture.generateMipmaps = true;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.needsUpdate = true;
  const rect = (i: number, x0 = 0, x1 = 1): [number, number, number, number] => {
    const { x, y } = cellOf(i);
    const W = canvas.width;
    const H = canvas.height;
    // キャンバスの上が v = 1（テクスチャの flipY）
    return [(x + w * x0) / W, 1 - (y + h) / H, (x + w * x1) / W, 1 - y / H];
  };
  return {
    texture,
    word: (i) => rect(i),
    rosette: (aspect) => {
      const half = Math.min(0.5, ((h * aspect) / w) * 0.5);
      return rect(ri, 0.5 - half, 0.5 + half);
    },
  };
}
