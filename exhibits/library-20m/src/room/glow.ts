import * as THREE from 'three';

/**
 * 灯りと窓のまわりのにじみ（光のぼかしの見せかけ）。カメラの方を向く板に、中心が明るく外へなめらかに消える円を重ねる。
 * 加算で重ね、奥行きは書かない（壁や家具の向こうの光は隠れる）
 */
export interface GlowItem {
  position: THREE.Vector3;
  /** 円の直径（ワールド単位） */
  size: number;
  color: THREE.ColorRepresentation;
  opacity: number;
}

let glowTexture: THREE.Texture | null = null;
function texture() {
  if (glowTexture) return glowTexture;
  const n = 128;
  const c = document.createElement('canvas');
  c.width = c.height = n;
  const g = c.getContext('2d')!;
  const img = g.createImageData(n, n);
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const dx = (x + 0.5) / n - 0.5;
      const dy = (y + 0.5) / n - 0.5;
      const r = Math.min(1, Math.hypot(dx, dy) * 2);
      // 中心の明るい芯と、長く尾を引くにじみ
      const v = Math.pow(1 - r, 2.2) * 0.75 + Math.pow(Math.max(0, 1 - r * 3), 2) * 0.25;
      const i = (y * n + x) * 4;
      img.data[i] = img.data[i + 1] = img.data[i + 2] = 255;
      img.data[i + 3] = Math.round(255 * Math.max(0, Math.min(1, v)));
    }
  }
  g.putImageData(img, 0, 0);
  glowTexture = new THREE.CanvasTexture(c);
  glowTexture.colorSpace = THREE.SRGBColorSpace;
  return glowTexture;
}

export function createGlows(items: GlowItem[]): THREE.Group {
  const group = new THREE.Group();
  group.name = 'glows';
  const map = texture();
  for (const it of items) {
    const m = new THREE.SpriteMaterial({ map, color: it.color, opacity: it.opacity, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false });
    const s = new THREE.Sprite(m);
    s.position.copy(it.position);
    s.scale.setScalar(it.size);
    s.renderOrder = 10;
    group.add(s);
  }
  return group;
}
