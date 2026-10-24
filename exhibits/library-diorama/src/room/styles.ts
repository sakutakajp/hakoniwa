import * as THREE from 'three';
import type { FaceInfo } from '../meshBuilder';
import type { PatternStyle } from '../libraryMaterials';
import type { SceneConfig } from '../config';

/**
 * 図書館の面の仕上げ（模様・つや・金属らしさ）。名前で引き、頂点の aStyle には番号を入れる。
 * 色は頂点の色（FaceInfo.color）で持ち、模様は色に掛けたり混ぜたりする
 */
export function libraryStyles(cfg: SceneConfig): Record<string, PatternStyle> {
  const c = cfg.colors;
  return {
    plain: { kind: 0, scale: [1, 1], joint: '#000000', jointWidth: 0, variation: 0, roughness: 0.85, metalness: 0 },
    // 台の大理石（大きな石を 2 段に積む）と、縁の上面（細かな石）。クレマ・マルフィルのような雲のむら・細い筋・粒と小さな穴
    marble: { kind: 1, scale: [1.5, 0.52], joint: c.marbleJoint, jointWidth: 0.012, variation: 0.05, roughness: 0.38, metalness: 0, vein: 0.32, mottle: 0.9, exterior: true },
    marbleTop: { kind: 1, scale: [1.05, 6], joint: c.marbleJoint, jointWidth: 0.0015, variation: 0.03, roughness: 0.3, metalness: 0, vein: 0.22, mottle: 0.55, exterior: true },
    // 壁の外側と柱の切石（明るいクリームの大理石）
    ashlar: { kind: 1, scale: [0.9, 0.45], joint: c.ashlarJoint, jointWidth: 0.02, variation: 0.04, roughness: 0.5, metalness: 0, vein: 0.2, mottle: 0.6, exterior: true },
    // 部屋の中の壁の切石（窓の壁）
    stone: { kind: 1, scale: [0.92, 0.42], joint: c.stoneJoint, jointWidth: 0.016, variation: 0.035, roughness: 0.72, metalness: 0, vein: 0.07, mottle: 0.35 },
    // 笠石（継ぎ目だけ。上面にも側面にも同じ間隔で）
    coping: { kind: 1, scale: [cfg.room.coping.joint, 8], joint: c.ashlarJoint, jointWidth: 0.0012, variation: 0.04, roughness: 0.55, metalness: 0, vein: 0.12, mottle: 0.45, exterior: true },
    // 部屋の中の石の縁取り（窓の枠・窓台・柱形の台と柱頭）
    trim: { kind: 1, scale: [0.8, 8], joint: c.stoneJoint, jointWidth: 0.0012, variation: 0.03, roughness: 0.6, metalness: 0, vein: 0.08, mottle: 0.35 },
    plaster: { kind: 7, scale: [1, 1], joint: '#000000', jointWidth: 0, variation: 0.05, roughness: 0.9, metalness: 0 },
    // 木：板の幅ごとの色むらと年輪（横に流れる木目と、縦の材の木目）。古いニスの鈍いつや（角のすれは更に鈍く）
    wood: { kind: 2, scale: [0.16, 1], joint: c.woodDark, jointWidth: 0, variation: 0.09, roughness: 0.52, metalness: 0, vein: 1.0, grain: 0, specular: 0.5, ring: 0.03 },
    woodV: { kind: 2, scale: [0.12, 1], joint: c.woodDark, jointWidth: 0, variation: 0.09, roughness: 0.52, metalness: 0, vein: 1.0, grain: 1, specular: 0.5, ring: 0.03 },
    panel: { kind: 3, scale: [0.42, 0.56], joint: c.woodDark, jointWidth: 0.11, variation: 0.07, roughness: 0.5, metalness: 0, vein: 0.9, specular: 0.5, ring: 0.032 },
    // 戸棚の戸（鏡板。木目は控えめに）
    door: { kind: 3, scale: [0.61, 0.5], joint: c.woodDark, jointWidth: 0.1, variation: 0.06, roughness: 0.5, metalness: 0, vein: 0.65, specular: 0.5, ring: 0.028 },
    panelWide: { kind: 3, scale: [0.6, 0.7], joint: c.woodDark, jointWidth: 0.09, variation: 0.07, roughness: 0.5, metalness: 0, vein: 0.9, specular: 0.5, ring: 0.032 },
    // 回廊の鼻隠しの金文字の帯（濃い木の板に金箔の字。字の色は joint）
    inscription: { kind: 13, scale: [0.16, 1], joint: cfg.inscription.gold, jointWidth: 0, variation: 0.06, roughness: 0.5, metalness: 0, vein: 0.9, grain: 0, specular: 0.5, ring: 0.03 },
    plank: { kind: 8, scale: [1.6, 0.12], joint: c.woodDark, jointWidth: 0.035, variation: 0.09, roughness: 0.46, metalness: 0, vein: 0.95, specular: 0.6, ring: 0.028 },
    tread: { kind: 8, scale: [2.4, 0.075], joint: c.woodDark, jointWidth: 0.03, variation: 0.07, roughness: 0.48, metalness: 0, vein: 0.95, specular: 0.6, ring: 0.026 },
    // 窓の外の景色（窓の下端の高さと窓の高さで、空と庭のグラデーションを決める）
    window: { kind: 4, scale: [cfg.room.windows.sill, cfg.room.windows.serliana.top - cfg.room.windows.sill], joint: '#000000', jointWidth: 0, variation: 0, roughness: 0.15, metalness: 0, emissive: 0.74 },
    glow: { kind: 5, scale: [1, 1], joint: '#000000', jointWidth: 0, variation: 0, roughness: 0.3, metalness: 0, emissive: 1.4 },
    glowSoft: { kind: 5, scale: [1, 1], joint: '#000000', jointWidth: 0, variation: 0, roughness: 0.25, metalness: 0, emissive: 0.85 },
    // 緑の色ガラスのランプの笠：つやのある外側（光と映り込みを受ける）と、内からのわずかな光
    shade: { kind: 12, scale: [1, 1], joint: '#000000', jointWidth: 0, variation: 0, roughness: 0.1, metalness: 0, emissive: 0.2, specular: 1.4 },
    // 真鍮（物理ベースの真鍮に近い淡い金色。部屋の映り込みで、明るい所と暗い所の差がはっきり出る）
    brass: { kind: 6, scale: [1, 1], joint: '#000000', jointWidth: 0, variation: 0, roughness: 0.22, metalness: 1, specular: 1.15 },
    gold: { kind: 6, scale: [1, 1], joint: '#000000', jointWidth: 0, variation: 0, roughness: 0.36, metalness: 1 },
    leather: { kind: 11, scale: [1, 1], joint: '#000000', jointWidth: 0, variation: 0, roughness: 0.36, metalness: 0, specular: 1.0 },
    fabric: { kind: 0, scale: [1, 1], joint: '#000000', jointWidth: 0, variation: 0, roughness: 0.95, metalness: 0 },
    leaf: { kind: 9, scale: [1, 1], joint: '#000000', jointWidth: 0, variation: 0, roughness: 0.62, metalness: 0 },
    paper: { kind: 10, scale: [1, 1], joint: '#000000', jointWidth: 0, variation: 0, roughness: 0.9, metalness: 0 },
    bust: { kind: 7, scale: [1, 1], joint: '#000000', jointWidth: 0, variation: 0.025, roughness: 0.4, metalness: 0 },
    pot: { kind: 7, scale: [1, 1], joint: '#000000', jointWidth: 0, variation: 0.06, roughness: 0.8, metalness: 0 },
    paint: { kind: 0, scale: [1, 1], joint: '#000000', jointWidth: 0, variation: 0, roughness: 0.55, metalness: 0 },
  };
}

export type StyleName = keyof ReturnType<typeof libraryStyles>;

export interface StyleTable {
  list: PatternStyle[];
  index: (name: StyleName) => number;
  /** 面の情報（色と仕上げ）。jitter で色を少しばらつかせる（rand は 0〜1 の乱数） */
  face: (name: StyleName, color: THREE.ColorRepresentation, jitter?: number, rand?: () => number) => FaceInfo;
}

export function createStyleTable(cfg: SceneConfig): StyleTable {
  const defs = libraryStyles(cfg);
  const names = Object.keys(defs) as StyleName[];
  const list = names.map((n) => defs[n]);
  const index = (name: StyleName) => names.indexOf(name);
  const face = (name: StyleName, color: THREE.ColorRepresentation, jitter = 0, rand: () => number = Math.random): FaceInfo => {
    const c = new THREE.Color(color);
    if (jitter > 0) {
      const k = 1 + (rand() - 0.5) * 2 * jitter;
      c.multiplyScalar(k);
    }
    return { color: c, style: index(name) };
  };
  return { list, index, face };
}
