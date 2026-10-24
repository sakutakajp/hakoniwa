/**
 * 架空のお店（名前・ロゴ・色）。どれも実在しないお店で、ロゴの絵（エンブレム）は自作。
 * 看板の文字は、看板用に読み込む書体（fonts.ts）で描く
 */
export type FontKey = 'gothic' | 'pixel' | 'round' | 'pop' | 'latin';

/** 書体の名前（読み込めなかったときは、続く端末の書体で描く） */
export const FONT_FAMILY: Record<FontKey, string> = {
  gothic: '"Dela Gothic One", "Hiragino Sans", "Yu Gothic", "Noto Sans CJK JP", "Noto Sans JP", Meiryo, sans-serif',
  pixel: '"DotGothic16", "Osaka-Mono", "MS Gothic", "Noto Sans Mono CJK JP", monospace',
  round: '"Zen Maru Gothic", "Hiragino Maru Gothic ProN", "Yu Gothic", "Noto Sans CJK JP", sans-serif',
  pop: '"RocknRoll One", "Hiragino Sans", "Yu Gothic", "Noto Sans CJK JP", sans-serif',
  latin: '"Bungee", "Arial Black", "Helvetica Neue", Arial, sans-serif',
};

export type EmblemName =
  | 'cubeHouse'
  | 'bird'
  | 'bee'
  | 'pixelHeart'
  | 'bear'
  | 'owl'
  | 'tree'
  | 'robot'
  | 'moon'
  | 'rocket'
  | 'gear'
  | 'book'
  | 'cup'
  | 'comet'
  | 'wrench'
  | 'radio'
  | 'screw'
  | 'note'
  | 'monitor'
  | 'swallow'
  | 'paw'
  | 'bolt'
  | 'whale'
  | 'octopus'
  | 'planet'
  | 'bulb'
  | 'cassette'
  | 'bowl'
  | 'fox'
  | 'capsule'
  | 'joystick'
  | 'elephant';

export interface Brand {
  /** お店の名前（看板の大きな文字） */
  name: string;
  /** 縦の看板で使う短い名前（省略すると name） */
  short?: string;
  /** 英字の添え書き */
  sub: string;
  font: FontKey;
  /** 看板の地の色・文字の色・差し色（エンブレムの丸） */
  bg: string;
  fg: string;
  accent: string;
  emblem: EmblemName;
  /** エンブレムの絵の色（省略すると bg） */
  emblemInk?: string;
  /** 地を明るいグラデーションにするか（白地の看板） */
  light?: boolean;
}

export const BRANDS = {
  hakoniwa: { name: 'ハコニワ電機', short: 'ハコニワ', sub: 'HAKONIWA DENKI', font: 'gothic', bg: '#1d4fb8', fg: '#ffffff', accent: '#ffd23a', emblem: 'cubeHouse' },
  canaria: { name: 'カナリア無線', short: 'カナリア', sub: 'CANARIA RADIO', font: 'round', bg: '#ffd84a', fg: '#174f8c', accent: '#174f8c', emblem: 'bird', emblemInk: '#ffd84a', light: true },
  mitsubachi: { name: 'ミツバチ電子', short: 'ミツバチ', sub: 'MITSUBACHI PARTS', font: 'gothic', bg: '#1a1a1a', fg: '#ffcc1a', accent: '#ffcc1a', emblem: 'bee', emblemInk: '#1a1a1a' },
  pixel: { name: 'ピクセル堂', sub: 'PIXEL-DO RETRO GAMES', font: 'pixel', bg: '#2b1a5a', fg: '#ff6fb8', accent: '#5ff2ff', emblem: 'pixelHeart', emblemInk: '#ff3f8e' },
  kuma: { name: 'くまの模型店', short: 'くま模型', sub: 'KUMA MODELS', font: 'round', bg: '#f6ead2', fg: '#6b3f1f', accent: '#c0392b', emblem: 'bear', emblemInk: '#f6ead2', light: true },
  fukurou: { name: 'フクロウ時計店', short: 'フクロウ時計', sub: 'OWL CLOCKS', font: 'round', bg: '#2a2420', fg: '#f2d39a', accent: '#f2d39a', emblem: 'owl', emblemInk: '#2a2420' },
  mori: { name: 'デンキのモリ', sub: 'DENKI NO MORI', font: 'round', bg: '#2e8b57', fg: '#ffffff', accent: '#e6ffb0', emblem: 'tree', emblemInk: '#2e8b57' },
  gigarobo: { name: 'ギガロボ', sub: 'GIGA ROBO HOBBY', font: 'pop', bg: '#d81d2c', fg: '#ffffff', accent: '#ffd400', emblem: 'robot', emblemInk: '#d81d2c' },
  tsukimi: { name: 'ゲームのつきみ堂', short: 'つきみ堂', sub: 'TSUKIMI-DO GAMES', font: 'gothic', bg: '#141e46', fg: '#ffd86b', accent: '#ffd86b', emblem: 'moon', emblemInk: '#141e46' },
  rocket: { name: 'ロケット家電', short: 'ロケット', sub: 'ROCKET KADEN', font: 'pop', bg: '#ff7a1a', fg: '#ffffff', accent: '#1a2a5a', emblem: 'rocket', emblemInk: '#ffffff' },
  neongear: { name: 'ネオンギア', sub: 'NEON GEAR PC', font: 'gothic', bg: '#0d0f1a', fg: '#38f0ff', accent: '#ff3fd0', emblem: 'gear', emblemInk: '#0d0f1a' },
  aozora: { name: 'アオゾラ書房', short: 'アオゾラ', sub: 'AOZORA BOOKS', font: 'round', bg: '#4aa8f0', fg: '#ffffff', accent: '#ffffff', emblem: 'book', emblemInk: '#4aa8f0' },
  polaris: { name: 'カフェ ポラリス', short: 'ポラリス', sub: 'CAFE POLARIS', font: 'round', bg: '#ffffff', fg: '#3a2a1e', accent: '#3a2a1e', emblem: 'cup', emblemInk: '#ffffff', light: true },
  comet: { name: 'トレカのコメット', short: 'コメット', sub: 'COMET CARDS', font: 'pop', bg: '#ff4f9e', fg: '#ffffff', accent: '#ffffff', emblem: 'comet', emblemInk: '#ff4f9e' },
  junk: { name: 'ジャンク横丁', short: 'ジャンク', sub: 'JUNK ALLEY', font: 'pixel', bg: '#ffcf3a', fg: '#1a1a1a', accent: '#1a1a1a', emblem: 'wrench', emblemInk: '#ffcf3a', light: true },
  radio: { name: 'ラジオのマルミ', short: 'マルミ', sub: 'MARUMI RADIO', font: 'gothic', bg: '#ffffff', fg: '#d0202c', accent: '#d0202c', emblem: 'radio', emblemInk: '#ffffff', light: true },
  neji: { name: 'ネジとチップ', short: 'ネジチップ', sub: 'SCREW & CHIP', font: 'pop', bg: '#2a4fd8', fg: '#ffffff', accent: '#ffffff', emblem: 'screw', emblemInk: '#2a4fd8' },
  melody: { name: 'メロディ楽器', short: 'メロディ', sub: 'MELODY MUSIC', font: 'round', bg: '#29c4ea', fg: '#ffffff', accent: '#ffffff', emblem: 'note', emblemInk: '#29c4ea' },
  dot: { name: 'ドット電脳', short: 'ドット', sub: 'DOT DENNOU', font: 'pixel', bg: '#3cbf6a', fg: '#ffffff', accent: '#ffffff', emblem: 'monitor', emblemInk: '#3cbf6a' },
  tsubame: { name: 'ツバメ無線', short: 'ツバメ', sub: 'TSUBAME MUSEN', font: 'gothic', bg: '#ffffff', fg: '#1d3f8f', accent: '#1d3f8f', emblem: 'swallow', emblemInk: '#ffffff', light: true },
  neko: { name: 'ネコノテ電気', short: 'ネコノテ', sub: 'NEKONOTE DENKI', font: 'round', bg: '#ff8a2a', fg: '#ffffff', accent: '#ffffff', emblem: 'paw', emblemInk: '#ff8a2a' },
  inazuma: { name: 'イナズマ電池', short: 'イナズマ', sub: 'INAZUMA BATTERY', font: 'gothic', bg: '#4b2a99', fg: '#ffe14a', accent: '#ffe14a', emblem: 'bolt', emblemInk: '#4b2a99' },
  kujira: { name: 'クジラ音響', short: 'クジラ', sub: 'KUJIRA AUDIO', font: 'gothic', bg: '#12325e', fg: '#7fe0ff', accent: '#7fe0ff', emblem: 'whale', emblemInk: '#12325e' },
  tako: { name: 'タコアシ電材', short: 'タコアシ', sub: 'TAKOASHI CABLES', font: 'pop', bg: '#e0393e', fg: '#ffffff', accent: '#ffffff', emblem: 'octopus', emblemInk: '#e0393e' },
  planet: { name: 'ワクセイ堂', short: 'ワクセイ', sub: 'WAKUSEI-DO TOYS', font: 'gothic', bg: '#101828', fg: '#ffb84a', accent: '#ffb84a', emblem: 'planet', emblemInk: '#101828' },
  hikari: { name: 'ヒカリ電球店', short: 'ヒカリ電球', sub: 'HIKARI LAMPS', font: 'round', bg: '#fff1c8', fg: '#b35a00', accent: '#f0a000', emblem: 'bulb', emblemInk: '#fff6dc', light: true },
  cassette: { name: 'カセット堂', short: 'カセット', sub: 'CASSETTE-DO RECORDS', font: 'pop', bg: '#efe2c2', fg: '#3a2a6a', accent: '#3a2a6a', emblem: 'cassette', emblemInk: '#efe2c2', light: true },
  ramen: { name: 'らーめん そらまめ', short: 'そらまめ', sub: 'RAMEN SORAMAME', font: 'gothic', bg: '#7a1e1e', fg: '#fff3d6', accent: '#fff3d6', emblem: 'bowl', emblemInk: '#7a1e1e' },
  kitsune: { name: 'キツネ電子', short: 'キツネ', sub: 'KITSUNE ELECTRONICS', font: 'gothic', bg: '#ffffff', fg: '#e05a1a', accent: '#e05a1a', emblem: 'fox', emblemInk: '#ffffff', light: true },
  tamago: { name: 'カプセルのたまご屋', short: 'たまご屋', sub: 'TAMAGO CAPSULE TOYS', font: 'round', bg: '#4cbcae', fg: '#ffffff', accent: '#ffffff', emblem: 'capsule', emblemInk: '#4cbcae' },
  hiscore: { name: 'ゲーセン ハイスコア', short: 'ハイスコア', sub: 'HI-SCORE ARCADE', font: 'pixel', bg: '#121212', fg: '#ff3a6a', accent: '#ff3a6a', emblem: 'joystick', emblemInk: '#121212' },
  zou: { name: 'カレーのゾウ屋', short: 'ゾウ屋', sub: 'ZOUYA CURRY', font: 'round', bg: '#f2a91a', fg: '#4a2a10', accent: '#4a2a10', emblem: 'elephant', emblemInk: '#f2a91a' },
} satisfies Record<string, Brand>;

export type BrandKey = keyof typeof BRANDS;

type Ctx = CanvasRenderingContext2D;

/** エンブレムを (x, y) から一辺 s の正方形に描く（ink は絵の色、paper は抜きの色） */
export function drawEmblem(ctx: Ctx, name: EmblemName, x: number, y: number, s: number, ink: string, paper: string) {
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(s, s);
  ctx.fillStyle = ink;
  ctx.strokeStyle = ink;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  const circle = (cx: number, cy: number, r: number) => {
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fill();
  };
  const star = (cx: number, cy: number, r1: number, r2: number) => {
    ctx.beginPath();
    for (let i = 0; i < 10; i++) {
      const a = -Math.PI / 2 + (i * Math.PI) / 5;
      const r = i % 2 ? r2 : r1;
      const px = cx + Math.cos(a) * r;
      const py = cy + Math.sin(a) * r;
      if (i) ctx.lineTo(px, py);
      else ctx.moveTo(px, py);
    }
    ctx.closePath();
    ctx.fill();
  };
  switch (name) {
    case 'cubeHouse': {
      // 立方体（箱）と、上に小さな家の屋根
      ctx.beginPath();
      ctx.moveTo(0.5, 0.22);
      ctx.lineTo(0.82, 0.38);
      ctx.lineTo(0.82, 0.74);
      ctx.lineTo(0.5, 0.9);
      ctx.lineTo(0.18, 0.74);
      ctx.lineTo(0.18, 0.38);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = paper;
      ctx.beginPath();
      ctx.moveTo(0.5, 0.54);
      ctx.lineTo(0.82, 0.38);
      ctx.lineTo(0.82, 0.42);
      ctx.lineTo(0.5, 0.58);
      ctx.lineTo(0.18, 0.42);
      ctx.lineTo(0.18, 0.38);
      ctx.closePath();
      ctx.fill();
      ctx.fillRect(0.485, 0.56, 0.03, 0.32);
      // 屋根と窓
      ctx.fillStyle = ink;
      ctx.beginPath();
      ctx.moveTo(0.36, 0.25);
      ctx.lineTo(0.5, 0.1);
      ctx.lineTo(0.64, 0.25);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = paper;
      ctx.fillRect(0.3, 0.6, 0.1, 0.1);
      ctx.fillRect(0.6, 0.6, 0.1, 0.1);
      break;
    }
    case 'bird': {
      ctx.beginPath();
      ctx.ellipse(0.46, 0.56, 0.24, 0.17, -0.25, 0, Math.PI * 2);
      ctx.fill();
      circle(0.66, 0.4, 0.12);
      ctx.beginPath();
      ctx.moveTo(0.76, 0.38);
      ctx.lineTo(0.88, 0.42);
      ctx.lineTo(0.76, 0.46);
      ctx.closePath();
      ctx.fill();
      ctx.beginPath();
      ctx.moveTo(0.26, 0.6);
      ctx.lineTo(0.08, 0.72);
      ctx.lineTo(0.3, 0.7);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = paper;
      circle(0.69, 0.38, 0.025);
      // 電波
      ctx.strokeStyle = ink;
      ctx.lineWidth = 0.04;
      for (const r of [0.12, 0.2]) {
        ctx.beginPath();
        ctx.arc(0.22, 0.26, r, -1.9, -0.5);
        ctx.stroke();
      }
      break;
    }
    case 'bee': {
      // 六角形の中のハチ
      ctx.beginPath();
      for (let i = 0; i < 6; i++) {
        const a = Math.PI / 6 + (i * Math.PI) / 3;
        const px = 0.5 + Math.cos(a) * 0.44;
        const py = 0.5 + Math.sin(a) * 0.44;
        if (i) ctx.lineTo(px, py);
        else ctx.moveTo(px, py);
      }
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = paper;
      ctx.beginPath();
      ctx.ellipse(0.5, 0.56, 0.17, 0.22, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = ink;
      ctx.fillRect(0.33, 0.5, 0.34, 0.06);
      ctx.fillRect(0.34, 0.62, 0.32, 0.06);
      circle(0.5, 0.32, 0.08);
      ctx.fillStyle = paper;
      ctx.globalAlpha = 0.85;
      ctx.beginPath();
      ctx.ellipse(0.33, 0.4, 0.1, 0.06, -0.6, 0, Math.PI * 2);
      ctx.ellipse(0.67, 0.4, 0.1, 0.06, 0.6, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;
      break;
    }
    case 'pixelHeart': {
      const rows = ['01100110', '11111111', '11111111', '11111111', '01111110', '00111100', '00011000'];
      const c = 0.1;
      rows.forEach((r, j) => {
        for (let i = 0; i < 8; i++) if (r[i] === '1') ctx.fillRect(0.1 + i * c, 0.16 + j * c, c * 0.92, c * 0.92);
      });
      ctx.fillStyle = paper;
      ctx.fillRect(0.2, 0.26, c * 0.9, c * 0.9);
      break;
    }
    case 'bear': {
      circle(0.26, 0.28, 0.13);
      circle(0.74, 0.28, 0.13);
      circle(0.5, 0.56, 0.34);
      ctx.fillStyle = paper;
      circle(0.38, 0.5, 0.045);
      circle(0.62, 0.5, 0.045);
      ctx.beginPath();
      ctx.ellipse(0.5, 0.68, 0.12, 0.09, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = ink;
      circle(0.5, 0.65, 0.035);
      break;
    }
    case 'owl': {
      ctx.beginPath();
      ctx.moveTo(0.2, 0.14);
      ctx.lineTo(0.36, 0.3);
      ctx.lineTo(0.64, 0.3);
      ctx.lineTo(0.8, 0.14);
      ctx.lineTo(0.84, 0.62);
      ctx.quadraticCurveTo(0.8, 0.92, 0.5, 0.92);
      ctx.quadraticCurveTo(0.2, 0.92, 0.16, 0.62);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = paper;
      circle(0.36, 0.48, 0.13);
      circle(0.64, 0.48, 0.13);
      ctx.fillStyle = ink;
      circle(0.36, 0.48, 0.05);
      circle(0.64, 0.48, 0.05);
      // 時計の針
      ctx.strokeStyle = ink;
      ctx.lineWidth = 0.025;
      ctx.beginPath();
      ctx.moveTo(0.36, 0.48);
      ctx.lineTo(0.36, 0.38);
      ctx.moveTo(0.64, 0.48);
      ctx.lineTo(0.72, 0.48);
      ctx.stroke();
      ctx.fillStyle = paper;
      ctx.beginPath();
      ctx.moveTo(0.46, 0.6);
      ctx.lineTo(0.54, 0.6);
      ctx.lineTo(0.5, 0.7);
      ctx.closePath();
      ctx.fill();
      break;
    }
    case 'tree': {
      circle(0.5, 0.36, 0.24);
      circle(0.32, 0.48, 0.16);
      circle(0.68, 0.48, 0.16);
      ctx.fillRect(0.45, 0.55, 0.1, 0.3);
      // 差し込みのプラグ
      ctx.fillRect(0.3, 0.84, 0.4, 0.06);
      ctx.fillRect(0.38, 0.9, 0.04, 0.06);
      ctx.fillRect(0.58, 0.9, 0.04, 0.06);
      break;
    }
    case 'robot': {
      ctx.fillRect(0.47, 0.08, 0.06, 0.12);
      circle(0.5, 0.08, 0.05);
      ctx.beginPath();
      ctx.roundRect(0.18, 0.22, 0.64, 0.52, 0.1);
      ctx.fill();
      ctx.fillRect(0.1, 0.38, 0.08, 0.2);
      ctx.fillRect(0.82, 0.38, 0.08, 0.2);
      ctx.fillStyle = paper;
      circle(0.36, 0.44, 0.08);
      circle(0.64, 0.44, 0.08);
      ctx.fillRect(0.34, 0.6, 0.32, 0.06);
      ctx.fillStyle = ink;
      ctx.fillRect(0.3, 0.78, 0.4, 0.14);
      break;
    }
    case 'moon': {
      circle(0.46, 0.52, 0.34);
      ctx.fillStyle = paper;
      circle(0.6, 0.42, 0.3);
      ctx.fillStyle = ink;
      ctx.beginPath();
      for (let i = 0; i < 10; i++) {
        const a = -Math.PI / 2 + (i * Math.PI) / 5;
        const r = i % 2 ? 0.05 : 0.12;
        const px = 0.72 + Math.cos(a) * r;
        const py = 0.62 + Math.sin(a) * r;
        if (i) ctx.lineTo(px, py);
        else ctx.moveTo(px, py);
      }
      ctx.closePath();
      ctx.fill();
      break;
    }
    case 'rocket': {
      ctx.translate(0.5, 0.5);
      ctx.rotate(0.6);
      ctx.beginPath();
      ctx.moveTo(0, -0.42);
      ctx.quadraticCurveTo(0.17, -0.2, 0.13, 0.22);
      ctx.lineTo(-0.13, 0.22);
      ctx.quadraticCurveTo(-0.17, -0.2, 0, -0.42);
      ctx.fill();
      ctx.beginPath();
      ctx.moveTo(-0.13, 0.08);
      ctx.lineTo(-0.27, 0.3);
      ctx.lineTo(-0.12, 0.26);
      ctx.closePath();
      ctx.moveTo(0.13, 0.08);
      ctx.lineTo(0.27, 0.3);
      ctx.lineTo(0.12, 0.26);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = paper;
      circle(0, -0.12, 0.07);
      ctx.fillStyle = ink;
      ctx.beginPath();
      ctx.moveTo(-0.07, 0.26);
      ctx.lineTo(0, 0.42);
      ctx.lineTo(0.07, 0.26);
      ctx.closePath();
      ctx.fill();
      break;
    }
    case 'gear': {
      ctx.beginPath();
      for (let i = 0; i < 16; i++) {
        const a = (i * Math.PI) / 8;
        const r = i % 2 ? 0.34 : 0.44;
        const a1 = a - Math.PI / 16;
        const a2 = a + Math.PI / 16;
        ctx.lineTo(0.5 + Math.cos(a1) * r, 0.5 + Math.sin(a1) * r);
        ctx.lineTo(0.5 + Math.cos(a2) * r, 0.5 + Math.sin(a2) * r);
      }
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = paper;
      circle(0.5, 0.5, 0.2);
      ctx.fillStyle = ink;
      ctx.beginPath();
      ctx.moveTo(0.54, 0.34);
      ctx.lineTo(0.42, 0.53);
      ctx.lineTo(0.5, 0.53);
      ctx.lineTo(0.46, 0.66);
      ctx.lineTo(0.58, 0.47);
      ctx.lineTo(0.5, 0.47);
      ctx.closePath();
      ctx.fill();
      break;
    }
    case 'book': {
      ctx.beginPath();
      ctx.moveTo(0.5, 0.36);
      ctx.quadraticCurveTo(0.3, 0.26, 0.1, 0.32);
      ctx.lineTo(0.1, 0.8);
      ctx.quadraticCurveTo(0.3, 0.74, 0.5, 0.84);
      ctx.quadraticCurveTo(0.7, 0.74, 0.9, 0.8);
      ctx.lineTo(0.9, 0.32);
      ctx.quadraticCurveTo(0.7, 0.26, 0.5, 0.36);
      ctx.fill();
      ctx.fillStyle = paper;
      ctx.fillRect(0.485, 0.38, 0.03, 0.42);
      // 雲
      ctx.fillStyle = ink;
      circle(0.42, 0.16, 0.08);
      circle(0.54, 0.13, 0.1);
      circle(0.66, 0.17, 0.07);
      break;
    }
    case 'cup': {
      ctx.beginPath();
      ctx.moveTo(0.2, 0.38);
      ctx.lineTo(0.72, 0.38);
      ctx.lineTo(0.66, 0.78);
      ctx.quadraticCurveTo(0.46, 0.86, 0.26, 0.78);
      ctx.closePath();
      ctx.fill();
      ctx.lineWidth = 0.06;
      ctx.beginPath();
      ctx.arc(0.74, 0.54, 0.1, -1.4, 1.4);
      ctx.stroke();
      ctx.fillRect(0.14, 0.86, 0.64, 0.05);
      ctx.lineWidth = 0.04;
      for (const x of [0.36, 0.52]) {
        ctx.beginPath();
        ctx.moveTo(x, 0.3);
        ctx.quadraticCurveTo(x + 0.06, 0.22, x, 0.14);
        ctx.stroke();
      }
      break;
    }
    case 'comet': {
      ctx.beginPath();
      ctx.moveTo(0.1, 0.9);
      ctx.quadraticCurveTo(0.4, 0.62, 0.58, 0.32);
      ctx.lineTo(0.72, 0.46);
      ctx.quadraticCurveTo(0.42, 0.66, 0.1, 0.9);
      ctx.fill();
      ctx.beginPath();
      for (let i = 0; i < 10; i++) {
        const a = -Math.PI / 2 + (i * Math.PI) / 5;
        const r = i % 2 ? 0.1 : 0.24;
        const px = 0.66 + Math.cos(a) * r;
        const py = 0.36 + Math.sin(a) * r;
        if (i) ctx.lineTo(px, py);
        else ctx.moveTo(px, py);
      }
      ctx.closePath();
      ctx.fill();
      break;
    }
    case 'wrench': {
      ctx.translate(0.5, 0.5);
      ctx.rotate(-0.78);
      ctx.fillRect(-0.06, -0.2, 0.12, 0.56);
      circle(0, -0.28, 0.17);
      ctx.fillStyle = paper;
      ctx.fillRect(-0.06, -0.48, 0.12, 0.2);
      break;
    }
    case 'radio': {
      ctx.beginPath();
      ctx.roundRect(0.1, 0.34, 0.8, 0.5, 0.08);
      ctx.fill();
      ctx.lineWidth = 0.04;
      ctx.beginPath();
      ctx.moveTo(0.3, 0.34);
      ctx.lineTo(0.62, 0.12);
      ctx.stroke();
      ctx.fillStyle = paper;
      circle(0.34, 0.6, 0.14);
      ctx.fillRect(0.56, 0.46, 0.24, 0.06);
      ctx.fillRect(0.56, 0.58, 0.24, 0.06);
      ctx.fillRect(0.56, 0.7, 0.24, 0.06);
      ctx.fillStyle = ink;
      circle(0.34, 0.6, 0.05);
      break;
    }
    case 'screw': {
      ctx.beginPath();
      ctx.ellipse(0.5, 0.24, 0.3, 0.12, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillRect(0.4, 0.26, 0.2, 0.5);
      ctx.beginPath();
      ctx.moveTo(0.4, 0.76);
      ctx.lineTo(0.5, 0.92);
      ctx.lineTo(0.6, 0.76);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = paper;
      ctx.fillRect(0.36, 0.22, 0.28, 0.04);
      for (let k = 0; k < 5; k++) ctx.fillRect(0.38, 0.32 + k * 0.09, 0.24, 0.025);
      break;
    }
    case 'note': {
      circle(0.32, 0.74, 0.13);
      circle(0.7, 0.66, 0.13);
      ctx.fillRect(0.41, 0.2, 0.05, 0.54);
      ctx.fillRect(0.79, 0.12, 0.05, 0.54);
      ctx.beginPath();
      ctx.moveTo(0.41, 0.2);
      ctx.lineTo(0.84, 0.12);
      ctx.lineTo(0.84, 0.24);
      ctx.lineTo(0.41, 0.32);
      ctx.closePath();
      ctx.fill();
      break;
    }
    case 'monitor': {
      ctx.fillRect(0.12, 0.2, 0.76, 0.5);
      ctx.fillRect(0.4, 0.7, 0.2, 0.1);
      ctx.fillRect(0.28, 0.8, 0.44, 0.06);
      ctx.fillStyle = paper;
      const c = 0.07;
      const px = ['10001', '01110', '11011', '01110'];
      px.forEach((r, j) => {
        for (let i = 0; i < 5; i++) if (r[i] === '1') ctx.fillRect(0.32 + i * c, 0.27 + j * c, c * 0.85, c * 0.85);
      });
      break;
    }
    case 'paw': {
      // 猫の手（肉球）
      circle(0.4, 0.64, 0.13);
      circle(0.6, 0.64, 0.13);
      ctx.beginPath();
      ctx.ellipse(0.5, 0.7, 0.2, 0.14, 0, 0, Math.PI * 2);
      ctx.fill();
      for (const [cx, cy, rot] of [
        [0.2, 0.42, -0.45],
        [0.38, 0.26, -0.15],
        [0.62, 0.26, 0.15],
        [0.8, 0.42, 0.45],
      ]) {
        ctx.beginPath();
        ctx.ellipse(cx, cy, 0.085, 0.115, rot, 0, Math.PI * 2);
        ctx.fill();
      }
      break;
    }
    case 'bolt': {
      // 電池と稲妻
      ctx.beginPath();
      ctx.roundRect(0.08, 0.27, 0.72, 0.46, 0.07);
      ctx.fill();
      ctx.fillRect(0.8, 0.4, 0.09, 0.2);
      ctx.fillStyle = paper;
      ctx.beginPath();
      ctx.moveTo(0.52, 0.31);
      ctx.lineTo(0.28, 0.53);
      ctx.lineTo(0.44, 0.53);
      ctx.lineTo(0.36, 0.7);
      ctx.lineTo(0.62, 0.46);
      ctx.lineTo(0.46, 0.46);
      ctx.lineTo(0.56, 0.31);
      ctx.closePath();
      ctx.fill();
      break;
    }
    case 'whale': {
      // 潮の代わりに音の波を吹くクジラ
      ctx.beginPath();
      ctx.moveTo(0.08, 0.62);
      ctx.quadraticCurveTo(0.1, 0.38, 0.4, 0.4);
      ctx.quadraticCurveTo(0.68, 0.42, 0.74, 0.58);
      ctx.lineTo(0.9, 0.44);
      ctx.lineTo(0.92, 0.54);
      ctx.lineTo(0.86, 0.62);
      ctx.lineTo(0.94, 0.74);
      ctx.lineTo(0.78, 0.7);
      ctx.quadraticCurveTo(0.6, 0.86, 0.32, 0.84);
      ctx.quadraticCurveTo(0.08, 0.82, 0.08, 0.62);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = paper;
      circle(0.23, 0.58, 0.035);
      ctx.strokeStyle = paper;
      ctx.lineWidth = 0.03;
      ctx.beginPath();
      ctx.moveTo(0.13, 0.7);
      ctx.quadraticCurveTo(0.34, 0.79, 0.58, 0.72);
      ctx.stroke();
      ctx.strokeStyle = ink;
      ctx.lineWidth = 0.045;
      for (const r of [0.08, 0.16, 0.24]) {
        ctx.beginPath();
        ctx.arc(0.32, 0.36, r, -2.3, -0.84);
        ctx.stroke();
      }
      break;
    }
    case 'octopus': {
      // タコの足（延長コード）
      ctx.beginPath();
      ctx.ellipse(0.5, 0.36, 0.24, 0.24, 0, Math.PI, 0);
      ctx.lineTo(0.74, 0.54);
      ctx.lineTo(0.26, 0.54);
      ctx.closePath();
      ctx.fill();
      ctx.lineWidth = 0.075;
      for (const [x0, dx] of [
        [0.3, -0.16],
        [0.43, -0.06],
        [0.57, 0.06],
        [0.7, 0.16],
      ]) {
        ctx.beginPath();
        ctx.moveTo(x0, 0.5);
        ctx.quadraticCurveTo(x0 + dx * 0.2, 0.8, x0 + dx, 0.84);
        ctx.stroke();
      }
      ctx.fillRect(0.82, 0.76, 0.1, 0.09);
      ctx.fillRect(0.84, 0.85, 0.02, 0.06);
      ctx.fillRect(0.88, 0.85, 0.02, 0.06);
      ctx.fillStyle = paper;
      circle(0.41, 0.38, 0.05);
      circle(0.59, 0.38, 0.05);
      ctx.fillStyle = ink;
      circle(0.42, 0.39, 0.022);
      circle(0.6, 0.39, 0.022);
      break;
    }
    case 'planet': {
      // 輪のある星と小さな星
      const ring = (a0: number, a1: number, color: string, lw: number) => {
        ctx.save();
        ctx.translate(0.48, 0.54);
        ctx.rotate(-0.38);
        ctx.strokeStyle = color;
        ctx.lineWidth = lw;
        ctx.beginPath();
        ctx.ellipse(0, 0, 0.42, 0.12, 0, a0, a1);
        ctx.stroke();
        ctx.restore();
      };
      ring(Math.PI, Math.PI * 2, ink, 0.06);
      circle(0.48, 0.54, 0.24);
      ring(0, Math.PI, paper, 0.13);
      ring(0, Math.PI, ink, 0.06);
      star(0.82, 0.17, 0.09, 0.04);
      break;
    }
    case 'bulb': {
      circle(0.5, 0.42, 0.21);
      ctx.beginPath();
      ctx.moveTo(0.35, 0.56);
      ctx.lineTo(0.65, 0.56);
      ctx.lineTo(0.6, 0.7);
      ctx.lineTo(0.4, 0.7);
      ctx.closePath();
      ctx.fill();
      ctx.fillRect(0.4, 0.7, 0.2, 0.15);
      ctx.fillStyle = paper;
      ctx.fillRect(0.4, 0.745, 0.2, 0.025);
      ctx.fillRect(0.4, 0.795, 0.2, 0.025);
      ctx.strokeStyle = paper;
      ctx.lineWidth = 0.035;
      ctx.beginPath();
      ctx.moveTo(0.43, 0.6);
      ctx.lineTo(0.43, 0.46);
      ctx.lineTo(0.47, 0.4);
      ctx.lineTo(0.53, 0.46);
      ctx.lineTo(0.57, 0.4);
      ctx.lineTo(0.57, 0.6);
      ctx.stroke();
      ctx.strokeStyle = ink;
      ctx.lineWidth = 0.045;
      for (const a of [-2.7, -2.1, -1.57, -1.04, -0.44]) {
        ctx.beginPath();
        ctx.moveTo(0.5 + Math.cos(a) * 0.27, 0.42 + Math.sin(a) * 0.27);
        ctx.lineTo(0.5 + Math.cos(a) * 0.36, 0.42 + Math.sin(a) * 0.36);
        ctx.stroke();
      }
      break;
    }
    case 'cassette': {
      ctx.beginPath();
      ctx.roundRect(0.08, 0.22, 0.84, 0.58, 0.07);
      ctx.fill();
      ctx.fillStyle = paper;
      ctx.beginPath();
      ctx.roundRect(0.16, 0.3, 0.68, 0.26, 0.04);
      ctx.fill();
      ctx.fillStyle = ink;
      ctx.beginPath();
      ctx.roundRect(0.27, 0.37, 0.46, 0.12, 0.06);
      ctx.fill();
      ctx.fillStyle = paper;
      circle(0.35, 0.43, 0.035);
      circle(0.65, 0.43, 0.035);
      ctx.beginPath();
      ctx.moveTo(0.25, 0.8);
      ctx.lineTo(0.31, 0.64);
      ctx.lineTo(0.69, 0.64);
      ctx.lineTo(0.75, 0.8);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = ink;
      circle(0.4, 0.72, 0.025);
      circle(0.6, 0.72, 0.025);
      break;
    }
    case 'bowl': {
      // 湯気の立つどんぶりと箸
      ctx.lineWidth = 0.04;
      for (const x of [0.3, 0.44, 0.58]) {
        ctx.beginPath();
        ctx.moveTo(x, 0.42);
        ctx.bezierCurveTo(x - 0.06, 0.34, x + 0.06, 0.26, x, 0.16);
        ctx.stroke();
      }
      ctx.lineWidth = 0.035;
      ctx.beginPath();
      ctx.moveTo(0.58, 0.5);
      ctx.lineTo(0.9, 0.2);
      ctx.moveTo(0.64, 0.52);
      ctx.lineTo(0.94, 0.28);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(0.1, 0.48);
      ctx.lineTo(0.9, 0.48);
      ctx.quadraticCurveTo(0.88, 0.84, 0.5, 0.84);
      ctx.quadraticCurveTo(0.12, 0.84, 0.1, 0.48);
      ctx.fill();
      ctx.fillRect(0.37, 0.84, 0.26, 0.06);
      ctx.fillStyle = paper;
      for (let i = 0; i < 6; i++) ctx.fillRect(0.21 + i * 0.1, 0.56, 0.05, 0.05);
      break;
    }
    case 'fox': {
      ctx.beginPath();
      ctx.moveTo(0.14, 0.12);
      ctx.lineTo(0.38, 0.32);
      ctx.lineTo(0.62, 0.32);
      ctx.lineTo(0.86, 0.12);
      ctx.lineTo(0.84, 0.5);
      ctx.lineTo(0.5, 0.9);
      ctx.lineTo(0.16, 0.5);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = paper;
      ctx.beginPath();
      ctx.moveTo(0.21, 0.53);
      ctx.lineTo(0.5, 0.63);
      ctx.lineTo(0.79, 0.53);
      ctx.lineTo(0.5, 0.86);
      ctx.closePath();
      ctx.fill();
      ctx.beginPath();
      ctx.ellipse(0.36, 0.45, 0.065, 0.026, 0.4, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.ellipse(0.64, 0.45, 0.065, 0.026, -0.4, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.moveTo(0.2, 0.2);
      ctx.lineTo(0.33, 0.31);
      ctx.lineTo(0.22, 0.37);
      ctx.closePath();
      ctx.moveTo(0.8, 0.2);
      ctx.lineTo(0.67, 0.31);
      ctx.lineTo(0.78, 0.37);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = ink;
      circle(0.5, 0.82, 0.035);
      break;
    }
    case 'capsule': {
      // カプセルのおもちゃ
      circle(0.5, 0.5, 0.36);
      ctx.fillStyle = paper;
      ctx.globalAlpha = 0.5;
      ctx.beginPath();
      ctx.arc(0.5, 0.5, 0.36, 0.04, Math.PI - 0.04);
      ctx.closePath();
      ctx.fill();
      ctx.globalAlpha = 1;
      ctx.fillRect(0.13, 0.48, 0.74, 0.05);
      circle(0.37, 0.33, 0.06);
      ctx.fillStyle = ink;
      star(0.5, 0.69, 0.1, 0.045);
      break;
    }
    case 'joystick': {
      ctx.beginPath();
      ctx.roundRect(0.12, 0.64, 0.76, 0.22, 0.06);
      ctx.fill();
      ctx.fillRect(0.465, 0.32, 0.07, 0.34);
      circle(0.5, 0.28, 0.14);
      ctx.fillStyle = paper;
      circle(0.45, 0.23, 0.04);
      circle(0.27, 0.75, 0.045);
      circle(0.73, 0.75, 0.045);
      ctx.fillStyle = ink;
      star(0.17, 0.3, 0.085, 0.038);
      star(0.83, 0.3, 0.085, 0.038);
      break;
    }
    case 'elephant': {
      circle(0.23, 0.42, 0.19);
      circle(0.77, 0.42, 0.19);
      ctx.fillStyle = paper;
      circle(0.22, 0.43, 0.12);
      circle(0.78, 0.43, 0.12);
      ctx.fillStyle = ink;
      circle(0.5, 0.42, 0.22);
      ctx.lineWidth = 0.11;
      ctx.beginPath();
      ctx.moveTo(0.5, 0.52);
      ctx.quadraticCurveTo(0.53, 0.8, 0.36, 0.86);
      ctx.stroke();
      ctx.fillStyle = paper;
      circle(0.41, 0.4, 0.032);
      circle(0.59, 0.4, 0.032);
      break;
    }
    case 'swallow': {
      ctx.beginPath();
      ctx.moveTo(0.08, 0.36);
      ctx.quadraticCurveTo(0.38, 0.36, 0.52, 0.5);
      ctx.quadraticCurveTo(0.7, 0.3, 0.92, 0.26);
      ctx.quadraticCurveTo(0.74, 0.46, 0.66, 0.6);
      ctx.lineTo(0.8, 0.9);
      ctx.lineTo(0.56, 0.68);
      ctx.lineTo(0.4, 0.86);
      ctx.lineTo(0.44, 0.6);
      ctx.quadraticCurveTo(0.3, 0.44, 0.08, 0.36);
      ctx.fill();
      break;
    }
  }
  ctx.restore();
}
