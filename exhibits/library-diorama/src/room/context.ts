import * as THREE from 'three';
import { MeshBuilder } from '../meshBuilder';
import type { SceneConfig } from '../config';
import type { LampLight } from '../libraryMaterials';
import { createStyleTable, type StyleTable } from './styles';
import { mulberry32, roundedRect, type RoundedRect } from './shape';

/** 本 1 冊（棚の上の位置・向き・大きさ・色） */
export interface BookInstance {
  /** 中心（ワールド） */
  position: THREE.Vector3;
  /** 本の向き：背の外向き（n）と、本の上（up） */
  normal: THREE.Vector3;
  up: THREE.Vector3;
  /** 厚み・高さ・奥行き */
  size: THREE.Vector3;
  color: THREE.Color;
  /** 背の模様の種類（0〜5：革装の背バンド・布装の箔押し・紙の題簽・半革装・新しい布装・総箔押し） */
  pattern: number;
  /** 本の天から上の棚の下面までのすき間（棚の中の陰の強さを決める）。寝かせた本などは省く */
  gap?: number;
}

/** 部屋を組み立てるときに持ち回るもの */
export interface BuildContext {
  cfg: SceneConfig;
  st: StyleTable;
  /** 不透明な形（壁・本棚・家具。影を落とし、頂点ごとに影を受ける） */
  mb: MeshBuilder;
  /** 窓のガラス（影を落とさない） */
  glass: MeshBuilder;
  /** 植物の葉（両面。影を落とす） */
  foliage: MeshBuilder;
  /** 陳列台の透明なガラス（影を落とさず、映り込みだけ） */
  clearGlass: MeshBuilder;
  books: BookInstance[];
  lamps: LampLight[];
  rand: () => number;
  /** 台座の外形 */
  base: RoundedRect;
  /** 床（寄木）の外形（上から見た多角形 [x, z]） */
  floorOutline: [number, number][];
  /** 回廊の床の上面の多角形（別に平面で影を焼き込む） */
  deckOutline: [number, number][];
  /** 敷物・絵・地球儀など、テクスチャを貼る小さな形 */
  textured: { name: string; geometry: THREE.BufferGeometry; map: 'painting' | 'paintingSmall' | 'globe' | 'celestial'; roughness?: number }[];
}

export function createContext(cfg: SceneConfig): BuildContext {
  const b = cfg.room.base;
  return {
    cfg,
    st: createStyleTable(cfg),
    mb: new MeshBuilder(0.09),
    glass: new MeshBuilder(0.5),
    foliage: new MeshBuilder(0.2),
    clearGlass: new MeshBuilder(1e3),
    books: [],
    lamps: [],
    rand: mulberry32(cfg.books.seed),
    base: roundedRect(b.width, b.depth, b.radius),
    floorOutline: [],
    deckOutline: [],
    textured: [],
  };
}

export const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
