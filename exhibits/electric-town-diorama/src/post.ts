import * as THREE from 'three';

/**
 * 描画の流れ：
 *  1. 路面の映り込み：路面の高さの水平な鏡に映した景色を、半分の解像度で描く（路面と台座は描かない）。
 *     ぼかし用に小さな画像（ミップマップ）も作る
 *  2. シーンを HDR（半精度の浮動小数点）の画像に描く
 *  3. 光のにじみ（ブルーム）：明るい所だけを取り出し、縮小しながらぼかして、拡大しながら重ねる
 *  4. 2 と 3 を合わせ、トーンマッピングして画面へ
 * 映り込みは、見る向きが変わったときだけ描き直す
 */
export interface Pipeline {
  setSize: (width: number, height: number) => void;
  render: (scene: THREE.Scene, camera: THREE.PerspectiveCamera) => void;
  /** 映り込みを次の描画で描き直す */
  invalidateReflection: () => void;
  reflectionTexture: THREE.Texture;
  reflectionMatrix: THREE.Matrix4;
}

const FULLSCREEN_VERTEX = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = position.xy * 0.5 + 0.5;
  gl_Position = vec4( position.xy, 0.0, 1.0 );
}
`;

export function createPipeline(
  renderer: THREE.WebGLRenderer,
  opts: {
    msaa: number;
    /** 映り込みの鏡の高さ */
    mirrorY: number;
    /** 映り込みのときに隠す物（路面・台座・床） */
    hideInReflection: THREE.Object3D[];
    /** 映り込みの解像度（画面に対する倍率） */
    reflectionScale: number;
    /** 映り込みの中の空の色（リニア）。路面には、明るい背景ではなく暗い空が映る */
    reflectionSky: THREE.Color;
    bloom: { strength: number; threshold: number; knee: number; radius: number; levels: number };
  },
): Pipeline {
  const canFloat = renderer.extensions.has('EXT_color_buffer_float') || renderer.extensions.has('EXT_color_buffer_half_float');
  const type = canFloat ? THREE.HalfFloatType : THREE.UnsignedByteType;
  const sceneTarget = new THREE.WebGLRenderTarget(1, 1, { type, samples: opts.msaa, depthBuffer: true });
  sceneTarget.texture.colorSpace = THREE.NoColorSpace;
  const reflTarget = new THREE.WebGLRenderTarget(1, 1, {
    type,
    depthBuffer: true,
    generateMipmaps: true,
    minFilter: THREE.LinearMipmapLinearFilter,
    magFilter: THREE.LinearFilter,
  });
  reflTarget.texture.colorSpace = THREE.NoColorSpace;
  let reflDirty = true;

  // --- フルスクリーンの三角形
  const tri = new THREE.BufferGeometry();
  tri.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 3, -1, 0, -1, 3, 0], 3));
  const quadScene = new THREE.Scene();
  const quadCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const quad = new THREE.Mesh(tri);
  quad.frustumCulled = false;
  quadScene.add(quad);
  const pass = (material: THREE.Material, target: THREE.WebGLRenderTarget | null) => {
    quad.material = material;
    renderer.setRenderTarget(target);
    renderer.render(quadScene, quadCamera);
  };

  // --- ブルーム
  const levels = Math.max(1, opts.bloom.levels);
  const downTargets: THREE.WebGLRenderTarget[] = [];
  const upTargets: THREE.WebGLRenderTarget[] = [];
  for (let i = 0; i < levels; i++) {
    const make = () => {
      const t = new THREE.WebGLRenderTarget(1, 1, { type, depthBuffer: false });
      t.texture.colorSpace = THREE.NoColorSpace;
      return t;
    };
    downTargets.push(make());
    upTargets.push(make());
  }
  const prefilter = new THREE.ShaderMaterial({
    uniforms: { tSrc: { value: null }, uTexel: { value: new THREE.Vector2() }, uThreshold: { value: new THREE.Vector2(opts.bloom.threshold, opts.bloom.knee) } },
    vertexShader: FULLSCREEN_VERTEX,
    fragmentShader: /* glsl */ `
uniform sampler2D tSrc;
uniform vec2 uTexel;
uniform vec2 uThreshold;
varying vec2 vUv;
vec3 tap( vec2 o ) { return texture2D( tSrc, vUv + o * uTexel ).rgb; }
void main() {
  // 4 か所の平均（縮小）
  vec3 c = ( tap( vec2( -0.5, -0.5 ) ) + tap( vec2( 0.5, -0.5 ) ) + tap( vec2( -0.5, 0.5 ) ) + tap( vec2( 0.5, 0.5 ) ) ) * 0.25;
  float br = max( c.r, max( c.g, c.b ) );
  // しきい値をなめらかに（knee の幅で）
  float soft = clamp( br - uThreshold.x + uThreshold.y, 0.0, 2.0 * uThreshold.y );
  soft = soft * soft / ( 4.0 * uThreshold.y + 1e-4 );
  float contrib = max( soft, br - uThreshold.x ) / max( br, 1e-4 );
  gl_FragColor = vec4( c * contrib, 1.0 );
}`,
    depthTest: false,
    depthWrite: false,
  });
  const down = new THREE.ShaderMaterial({
    uniforms: { tSrc: { value: null }, uTexel: { value: new THREE.Vector2() } },
    vertexShader: FULLSCREEN_VERTEX,
    fragmentShader: /* glsl */ `
uniform sampler2D tSrc;
uniform vec2 uTexel;
varying vec2 vUv;
vec3 tap( vec2 o ) { return texture2D( tSrc, vUv + o * uTexel ).rgb; }
void main() {
  // 13 か所の重み付き平均（ちらつきの少ない縮小）
  vec3 a = tap( vec2( -1.0, -1.0 ) ) + tap( vec2( 1.0, -1.0 ) ) + tap( vec2( -1.0, 1.0 ) ) + tap( vec2( 1.0, 1.0 ) );
  vec3 b = tap( vec2( -2.0, -2.0 ) ) + tap( vec2( 2.0, -2.0 ) ) + tap( vec2( -2.0, 2.0 ) ) + tap( vec2( 2.0, 2.0 ) );
  vec3 c = tap( vec2( -2.0, 0.0 ) ) + tap( vec2( 2.0, 0.0 ) ) + tap( vec2( 0.0, -2.0 ) ) + tap( vec2( 0.0, 2.0 ) );
  vec3 d = tap( vec2( 0.0 ) );
  gl_FragColor = vec4( a * 0.125 + b * 0.03125 + c * 0.0625 + d * 0.125, 1.0 );
}`,
    depthTest: false,
    depthWrite: false,
  });
  const up = new THREE.ShaderMaterial({
    uniforms: { tSrc: { value: null }, tBase: { value: null }, uTexel: { value: new THREE.Vector2() }, uRadius: { value: opts.bloom.radius } },
    vertexShader: FULLSCREEN_VERTEX,
    fragmentShader: /* glsl */ `
uniform sampler2D tSrc;
uniform sampler2D tBase;
uniform vec2 uTexel;
uniform float uRadius;
varying vec2 vUv;
vec3 tap( vec2 o ) { return texture2D( tSrc, vUv + o * uTexel * uRadius ).rgb; }
void main() {
  // テント状の 9 か所（拡大しながらぼかす）
  vec3 s = tap( vec2( 0.0 ) ) * 4.0;
  s += ( tap( vec2( -1.0, 0.0 ) ) + tap( vec2( 1.0, 0.0 ) ) + tap( vec2( 0.0, -1.0 ) ) + tap( vec2( 0.0, 1.0 ) ) ) * 2.0;
  s += tap( vec2( -1.0, -1.0 ) ) + tap( vec2( 1.0, -1.0 ) ) + tap( vec2( -1.0, 1.0 ) ) + tap( vec2( 1.0, 1.0 ) );
  gl_FragColor = vec4( s / 16.0 + texture2D( tBase, vUv ).rgb, 1.0 );
}`,
    depthTest: false,
    depthWrite: false,
  });
  const composite = new THREE.ShaderMaterial({
    uniforms: { tScene: { value: sceneTarget.texture }, tBloom: { value: null }, uBloom: { value: opts.bloom.strength } },
    vertexShader: FULLSCREEN_VERTEX,
    fragmentShader: /* glsl */ `
uniform sampler2D tScene;
uniform sampler2D tBloom;
uniform float uBloom;
varying vec2 vUv;
void main() {
  vec3 c = texture2D( tScene, vUv ).rgb + texture2D( tBloom, vUv ).rgb * uBloom;
  gl_FragColor = vec4( c, 1.0 );
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`,
    depthTest: false,
    depthWrite: false,
    toneMapped: true,
  });

  // --- 映り込みのカメラ
  const mirrorCamera = new THREE.PerspectiveCamera();
  mirrorCamera.matrixAutoUpdate = true;
  const reflectionMatrix = new THREE.Matrix4();
  const clipPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -opts.mirrorY);
  const tmpV = new THREE.Vector3();
  const tmpL = new THREE.Vector3();
  const updateMirror = (camera: THREE.PerspectiveCamera) => {
    const n = new THREE.Vector3(0, 1, 0);
    const planePoint = new THREE.Vector3(0, opts.mirrorY, 0);
    camera.updateMatrixWorld();
    const camPos = new THREE.Vector3().setFromMatrixPosition(camera.matrixWorld);
    // 鏡に映したカメラの位置
    tmpV.subVectors(planePoint, camPos).reflect(n).negate().add(planePoint);
    mirrorCamera.position.copy(tmpV);
    // 見る向き
    const dir = new THREE.Vector3(0, 0, -1).applyMatrix4(new THREE.Matrix4().extractRotation(camera.matrixWorld));
    tmpL.copy(camPos).add(dir);
    const target = new THREE.Vector3().subVectors(planePoint, tmpL).reflect(n).negate().add(planePoint);
    mirrorCamera.up.set(0, 1, 0).applyMatrix4(new THREE.Matrix4().extractRotation(camera.matrixWorld)).reflect(n);
    mirrorCamera.lookAt(target);
    mirrorCamera.near = camera.near;
    mirrorCamera.far = camera.far;
    mirrorCamera.updateMatrixWorld();
    mirrorCamera.projectionMatrix.copy(camera.projectionMatrix);
    mirrorCamera.projectionMatrixInverse.copy(camera.projectionMatrixInverse);
    reflectionMatrix.set(0.5, 0, 0, 0.5, 0, 0.5, 0, 0.5, 0, 0, 0.5, 0.5, 0, 0, 0, 1);
    reflectionMatrix.multiply(mirrorCamera.projectionMatrix).multiply(mirrorCamera.matrixWorldInverse);
  };

  const size = new THREE.Vector2();
  const setSize = (width: number, height: number) => {
    void width;
    void height;
    renderer.getDrawingBufferSize(size);
    const w = Math.max(1, size.x);
    const h = Math.max(1, size.y);
    sceneTarget.setSize(w, h);
    reflTarget.setSize(Math.max(1, Math.round(w * opts.reflectionScale)), Math.max(1, Math.round(h * opts.reflectionScale)));
    let bw = Math.max(1, w >> 1);
    let bh = Math.max(1, h >> 1);
    for (let i = 0; i < levels; i++) {
      downTargets[i].setSize(bw, bh);
      upTargets[i].setSize(bw, bh);
      bw = Math.max(1, bw >> 1);
      bh = Math.max(1, bh >> 1);
    }
    reflDirty = true;
  };

  const render = (scene: THREE.Scene, camera: THREE.PerspectiveCamera) => {
    const prevTarget = renderer.getRenderTarget();
    // 1. 映り込み
    if (reflDirty) {
      updateMirror(camera);
      const vis = opts.hideInReflection.map((o) => o.visible);
      opts.hideInReflection.forEach((o) => (o.visible = false));
      const prevClip = renderer.clippingPlanes;
      const prevBg = scene.background;
      scene.background = opts.reflectionSky;
      renderer.clippingPlanes = [clipPlane];
      renderer.setRenderTarget(reflTarget);
      renderer.clear();
      renderer.render(scene, mirrorCamera);
      renderer.clippingPlanes = prevClip;
      scene.background = prevBg;
      opts.hideInReflection.forEach((o, i) => (o.visible = vis[i]));
      reflDirty = false;
    }
    // 2. シーン
    renderer.setRenderTarget(sceneTarget);
    renderer.clear();
    renderer.render(scene, camera);
    // 3. ブルーム
    let src: THREE.Texture = sceneTarget.texture;
    let sw = sceneTarget.width;
    let sh = sceneTarget.height;
    for (let i = 0; i < levels; i++) {
      const mat = i === 0 ? prefilter : down;
      mat.uniforms.tSrc.value = src;
      (mat.uniforms.uTexel.value as THREE.Vector2).set(1 / sw, 1 / sh);
      pass(mat, downTargets[i]);
      src = downTargets[i].texture;
      sw = downTargets[i].width;
      sh = downTargets[i].height;
    }
    let upSrc: THREE.Texture = downTargets[levels - 1].texture;
    for (let i = levels - 2; i >= 0; i--) {
      up.uniforms.tSrc.value = upSrc;
      up.uniforms.tBase.value = downTargets[i].texture;
      (up.uniforms.uTexel.value as THREE.Vector2).set(1 / downTargets[i + 1].width, 1 / downTargets[i + 1].height);
      pass(up, upTargets[i]);
      upSrc = upTargets[i].texture;
    }
    // 4. 合成して画面へ
    composite.uniforms.tBloom.value = upSrc;
    pass(composite, prevTarget);
  };

  return {
    setSize,
    render,
    invalidateReflection: () => {
      reflDirty = true;
    },
    reflectionTexture: reflTarget.texture,
    reflectionMatrix,
  };
}
