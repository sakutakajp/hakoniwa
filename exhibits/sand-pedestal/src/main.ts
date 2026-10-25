import { installPublicControls } from '../../shared/public-controls';
import { createSceneLifecycle } from '../../shared/lifecycle';
import * as THREE from 'three';
import { config } from './config';
import { createPedestalGeometry, createSideMaterial, outlinePointsAt } from './pedestal';
import { generateSandTextures } from './sandTextures';
import {
  areaLightDirections,
  bakeVisibility,
  blurPlanarBake,
  createBakeTarget,
  skyDirections,
  type DirectionSet,
  type PlaneReceiver,
  type PointReceiver,
} from './lightBaker';
import { applyPlanarBake } from './bakedLighting';
import { createFloor } from './floor';
import { createIsland, createIslandShape } from './island';
import { createVegetation } from './vegetation';
import { createRocks } from './rocks';
import { applyGroundGravel } from './rocks/groundGravel';
import { createSeaLayout, seaLevels } from './sea/layout';
import { createSeabed } from './sea/seabed';
import { createWater } from './sea/water';
import { addViewBounds, applyFit, directionFromAngles, emptyBounds, fitBounds, type Fit, type ViewBounds } from './framing';
import { createViewControls, type ViewState } from './viewControls';
import { useSoftHighlightToneMapping } from './toneMapping';

/** 操作の案内を一度見たら（触ったら）出さないための印 */
const HINT_KEY = 'sand-pedestal:view-hint-seen';

/** GPU を使わないソフトウェア描画かどうか（Chrome の SwiftShader、Linux の llvmpipe など） */
function isSoftwareRenderer(renderer: THREE.WebGLRenderer): boolean {
  const gl = renderer.getContext();
  let name = String(gl.getParameter(gl.RENDERER) ?? '');
  // Chrome と Safari は名前を伏せて返すので、そのときだけ拡張機能で実際の名前を調べる
  if (name === 'WebKit WebGL') {
    const info = gl.getExtension('WEBGL_debug_renderer_info');
    if (info) name = String(gl.getParameter(info.UNMASKED_RENDERER_WEBGL) ?? '');
  }
  return /swiftshader|llvmpipe|softpipe|software|basic render/i.test(name);
}

/** 3D 表示を始められなかったときだけ、理由と対処を画面に出す */
function showMessage(text: string) {
  const el = document.getElementById('scene-message');
  if (!el) return;
  el.textContent = text;
  el.hidden = false;
}

function start(canvas: HTMLCanvasElement) {
  const t0 = performance.now();
  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: true,
    powerPreference: 'default',
  });
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  useSoftHighlightToneMapping(renderer, config.renderer.highlightKnee, config.renderer.exposure);
  renderer.setClearColor(config.renderer.background, 1);

  // GPU がない環境では、起動時の生成処理を軽くする（?quality=high / low で確認用に切り替え可能）
  const params = new URLSearchParams(window.location.search);
  const forced = params.get('quality');
  const lowPower = forced === 'high' ? false : forced === 'low' ? true : (isSoftwareRenderer(renderer) || window.matchMedia('(max-width: 700px)').matches);
  const quality = lowPower
    ? config.lowPower
    : {
        textureSize: config.sand.textureSize,
        lightSamples: config.shadow.lightSamples,
        aoSamples: config.shadow.aoSamples,
        bakeResolution: config.shadow.bakeResolution,
        sandBakeResolution: config.shadow.sandBakeResolution,
        mapSize: config.shadow.mapSize,
        maxPixelRatio: config.renderer.maxPixelRatio,
        voxelScale: 1,
      };
  const W = config.pedestal.size;
  const unit = W / 10;

  const scene = new THREE.Scene();
  const lifecycle = createSceneLifecycle(renderer, scene);
  scene.background = new THREE.Color(config.renderer.background);

  // --- 台座と海の高さ関係、島の形、砂浜と海底の形 ---
  const tIsland = performance.now();
  const levels = seaLevels(config);
  const islandShape = config.island.enabled
    ? createIslandShape(config, {
        size: W,
        cornerRadius: config.pedestal.cornerRadius,
        yWater: levels.yWater,
        yBottom: levels.yBaseTop,
        seabedDepth: levels.yWater - levels.ySeabed,
      })
    : null;
  const sea = createSeaLayout(config, islandShape ? (x, z) => -islandShape.footprintAt(x, z) : undefined);

  // --- 島（独立したグループ） ---
  // 海底と砂浜の高さのテクスチャ（影の焼き込みと、岩や島の土台の根元にかかる砂に使う）
  const sandBakeSize = W * 1.02;
  const seabedHeight = sea.heightTexture(sandBakeSize, quality.sandBakeResolution);

  const island = islandShape
    ? createIsland(renderer, config, islandShape, {
        voxelScale: quality.voxelScale,
        groundY: sea.seabedY,
        waterLevel: sea.yWater,
        ground: { texture: seabedHeight, size: sandBakeSize },
      })
    : null;
  if (island) scene.add(island.group);
  const islandMs = performance.now() - tIsland;

  // --- 土台（水の塊の下の薄い板） ---
  const baseShape = {
    ...config.pedestal,
    size: sea.baseHalf * 2,
    cornerRadius: sea.baseCornerRadius,
  };
  const baseGeometry = createPedestalGeometry(baseShape);
  const sideMaterial = createSideMaterial({
    color: config.pedestal.sideColor,
    roughness: config.pedestal.sideRoughness,
    thickness: config.pedestal.thickness,
    bottomOcclusion: config.pedestal.sideBottomOcclusion,
    baseY: sea.yFloor,
  });
  const base = new THREE.Mesh(baseGeometry, sideMaterial);
  base.name = 'pedestal-base';
  base.position.y = sea.yFloor;
  scene.add(base);

  // --- 砂（砂浜と海底） ---
  const sandTextures = generateSandTextures(renderer, { ...config.sand, textureSize: quality.textureSize }, W);
  const sandMaterial = new THREE.MeshStandardMaterial({
    map: sandTextures.colorMap,
    normalMap: sandTextures.normalMap,
    roughness: config.sand.roughness,
    metalness: 0,
  });
  sandMaterial.normalScale.setScalar(config.sand.normalStrength);
  const seabed = createSeabed(sea, sandMaterial, {
    size: W,
    segments: lowPower ? 220 : 300,
    sandColor: config.sea.skirt.sand,
  });
  scene.add(seabed.surface, seabed.skirt);

  // --- 植生（独立したグループ）。?vegetation=0 で隠した状態から始める ---
  const tVegetation = performance.now();
  const vegetation = island && config.vegetation.enabled ? createVegetation(renderer, config, island.data) : null;
  if (vegetation) {
    vegetation.group.visible = params.get('vegetation') !== '0';
    scene.add(vegetation.group);
  }
  const vegetationMs = performance.now() - tVegetation;

  // --- 岩・海底の緑の岩・小石（独立したグループ）。?rocks=0 で隠した状態から始める ---
  const tRocks = performance.now();
  const rocks = config.rocks.enabled
    ? createRocks(
        renderer,
        config,
        island?.data ?? null,
        sea.seabedY,
        sea.enabled ? { level: sea.yWater, deepAt: sea.deepAt, beachAt: sea.beachAt } : null,
        { texture: seabedHeight, size: sandBakeSize },
      )
    : null;
  let groundGravel: { setEnabled: (on: boolean) => void } | null = null;
  if (rocks) {
    rocks.group.visible = params.get('rocks') !== '0';
    scene.add(rocks.group);
    // 細かな砂利は砂の表面の模様として描く
    groundGravel = applyGroundGravel(sandMaterial, {
      density: rocks.groundDensity,
      size: W,
      cell: 0.05 * unit,
      tint: new THREE.Color(0.74, 0.66, 0.58),
    });
    groundGravel.setEnabled(rocks.group.visible);
  }
  const rocksMs = performance.now() - tRocks;

  // --- 照明（追加する順番が、焼き込んだ影のライト番号になる：0 = 主光、1 = 補助光） ---
  type LightSetting = { color: string; intensity: number; azimuth: number; elevation: number };
  const addDirectionalLight = (s: LightSetting) => {
    const direction = directionFromAngles(s.azimuth, s.elevation);
    const light = new THREE.DirectionalLight(s.color, s.intensity);
    light.position.copy(direction).multiplyScalar(40);
    scene.add(light, light.target);
    return { light, direction };
  };
  const key = addDirectionalLight(config.lights.key);
  const fill = addDirectionalLight(config.lights.fill);

  const ambient = new THREE.HemisphereLight(
    config.lights.ambient.skyColor,
    config.lights.ambient.groundColor,
    config.lights.ambient.intensity,
  );
  ambient.groundColor.multiplyScalar(config.lights.ambient.groundBoost);
  scene.add(ambient);

  // --- 影の焼き込み（床・海底・岩肌の頂点・植物・岩）。遮るのは土台・島・植生・岩の実際の形 ---
  const tBake = performance.now();
  const floorBakeSize = W * config.shadow.bakeRegion;
  const floorTarget = createBakeTarget(renderer, quality.bakeResolution, quality.bakeResolution);
  const sandTarget = createBakeTarget(renderer, quality.sandBakeResolution, quality.sandBakeResolution);
  // 土台は上面をわずかに下げて影を作る（海底が土台の影を拾わないように）
  const baseCaster = new THREE.Mesh(baseGeometry);
  baseCaster.position.y = sea.yFloor;
  baseCaster.scale.y = 0.95;
  baseCaster.updateMatrixWorld();
  // 水の塊（土台の上面から水面まで）。床にだけ、薄めの影を落とす
  let seaVisible = sea.enabled && params.get('sea') !== '0';
  const waterBlockCaster = sea.enabled
    ? new THREE.Mesh(
        createPedestalGeometry({
          ...config.pedestal,
          size: sea.half * 2,
          cornerRadius: sea.cornerRadius,
          thickness: sea.yWater - sea.yDeep,
          topEdgeRadius: 0.01,
          bottomEdgeRadius: 0.01,
        }),
      )
    : null;
  if (waterBlockCaster) {
    waterBlockCaster.position.y = sea.yDeep;
    waterBlockCaster.updateMatrixWorld();
  }
  const deg = THREE.MathUtils.degToRad;
  const sets: DirectionSet[] = [
    {
      directions: areaLightDirections(key.direction, deg(config.lights.key.softness), quality.lightSamples),
      channel: 0,
      planes: true,
      points: true,
    },
    {
      directions: areaLightDirections(fill.direction, deg(config.lights.fill.softness), quality.lightSamples),
      channel: 2,
      planes: true,
      points: true,
    },
    {
      directions: skyDirections(quality.aoSamples, deg(config.shadow.aoMinElevation)),
      channel: 1,
      planes: true,
      // 空からの遮蔽は植物と岩に書く（島の岩肌は形状から求めた AO を使うので書かない）
      points: true,
    },
  ];
  const floorPlane: PlaneReceiver = {
    target: floorTarget,
    centerX: 0,
    centerZ: 0,
    y: sea.yFloor,
    size: floorBakeSize,
    lateWeight: sea.enabled ? config.sea.floorShadow : undefined,
  };
  // 海底と砂浜（起伏は高さのテクスチャで与える）
  const sandPlane: PlaneReceiver = {
    target: sandTarget,
    centerX: 0,
    centerZ: 0,
    y: 0.002 * unit,
    size: sandBakeSize,
    heightMap: seabedHeight,
  };
  const sampleSpacing = deg(config.lights.key.softness) * Math.sqrt(Math.PI / quality.lightSamples);
  /** 影を焼き込む。植生や岩の表示を切り替えたときにも、そのときの形で作り直す */
  const bakeShadows = () => {
    const casters: THREE.Mesh[] = [baseCaster];
    const points: PointReceiver[] = [];
    if (island) {
      casters.push(island.mesh);
      points.push(island.bakeReceiver);
    }
    if (rocks?.group.visible) {
      casters.push(...rocks.casters);
      points.push(...rocks.receivers);
    }
    if (vegetation?.group.visible) {
      casters.push(...vegetation.casters);
      points.push(vegetation.receiver);
    }
    bakeVisibility(renderer, {
      casters,
      lateCasters: seaVisible && waterBlockCaster ? [waterBlockCaster] : [],
      sets,
      planes: [floorPlane, sandPlane],
      points,
      mapSize: quality.mapSize,
      bias: 0.02 * unit,
    });
    // 面光源を有限個の方向で近似したため、長い影の先で縞が出る。台座から離れるほどぼかして消す
    blurPlanarBake(renderer, floorPlane, {
      boxHalf: W / 2,
      boxRadius: config.pedestal.cornerRadius,
      spread: sampleSpacing * 0.75,
      maxSigma: 1.2 * unit,
    });
  };
  bakeShadows();
  const bakeMs = performance.now() - tBake;

  // 水の中の海底の影は薄く（水が光を散らす）。砂浜は陸上と同じ
  applyPlanarBake(
    sandMaterial,
    { texture: sandTarget.texture, centerX: 0, centerZ: 0, size: sandBakeSize },
    {
      shadowStrength: config.shadow.strength,
      aoStrength: config.shadow.sandAoStrength,
      underwater: sea.enabled
        ? { level: sea.yWater, strength: config.sea.seabedShadow, fillStrength: 0, aoStrength: 0.3, fade: 0.02 * W }
        : undefined,
    },
  );

  const floor = createFloor({
    color: config.floor.color,
    size: config.floor.size,
    bake: { texture: floorTarget.texture, centerX: 0, centerZ: 0, size: floorBakeSize },
    shadowStrength: config.shadow.strength,
    aoStrength: config.shadow.aoStrength,
    gradient: config.floor.gradient,
    gradientAzimuth: config.floor.gradientAzimuth,
    gradientDistance: config.floor.gradientDistance,
    horizon: {
      // 背景色（画面の色）になるトーンマッピング前の色：トーンマッピング（knee より上を丸める）の逆
      color: (() => {
        const c = new THREE.Color(config.renderer.background);
        const k = config.renderer.highlightKnee;
        const inv = (v: number) => (v <= k ? v : k - (1 - k) * Math.log(Math.max(1 - (v - k) / (1 - k), 1e-4)));
        return new THREE.Color(inv(c.r), inv(c.g), inv(c.b)).multiplyScalar(1 / config.renderer.exposure);
      })(),
      start: 4 * W,
      end: 20 * W,
    },
    dropShadow: {
      strength: config.floor.dropShadow.strength,
      offset: [config.floor.dropShadow.offset[0] * W, config.floor.dropShadow.offset[1] * W],
      blur: config.floor.dropShadow.blur * W,
      spread: config.floor.dropShadow.spread * W,
      half: sea.half,
      radius: sea.cornerRadius,
    },
  });
  floor.position.y = sea.yFloor;
  scene.add(floor);

  // --- 海（水面・側面の断面・泡・水中の光）。不透明な物を描いた画像に重ねて描く。?sea=0 で隠した状態から始める ---
  const shoreSource = () => ({
    sampleField: island?.data.sampleField ?? null,
    landAt: (x: number, z: number) => sea.seabedY(x, z) > sea.yWater + 0.0005 * W,
    rocks: rocks?.group.visible ? rocks.footprints : [],
  });
  const water = sea.enabled
    ? createWater(renderer, config, sea, {
        lowPower,
        bake: { texture: sandTarget.texture, size: sandBakeSize, height: sandPlane.heightMap! },
        shore: shoreSource(),
      })
    : null;

  // --- カメラ（遠近）と見る向き ---
  // ?az=方位角&el=仰角 で始める向きを変えられる（例：?az=-135&el=37）。通常は config.camera の値。
  // 見る向きはドラッグ・ホイール・ピンチ・キーボードで変えられる（viewControls.ts）。元に戻すとこの向きになる
  const angle = (name: string, fallback: number, min: number, max: number) => {
    const v = Number.parseFloat(params.get(name) ?? '');
    return Number.isFinite(v) ? THREE.MathUtils.clamp(v, min, max) : fallback;
  };
  const cam = config.camera;
  const ctl = config.controls;
  const homeAzimuth = angle('az', cam.azimuth, -360, 360);
  const homeElevation = angle('el', cam.elevation, ctl.elevationRange[0], ctl.elevationRange[1]);
  // 元の向きの構図：既定の向きでは参考画像と同じ構図、?az / ?el で始めたときは台座全体を画面いっぱいに
  const homeFraming = params.has('az') || params.has('el') ? config.framingOther : config.framing;
  const distance = cam.distance * W;
  const camera = new THREE.PerspectiveCamera(cam.fov, 1, distance * 0.4, distance * 8);
  const lookAt = new THREE.Vector3(0, sea.yBaseTop + cam.targetHeight * W, 0);
  // 画角合わせ用の外形：土台の底・水面の外周（台座）と、島と植生の上端（植生を隠しているときは島だけ）
  const pedestalOutline = outlinePointsAt(sea.half, sea.cornerRadius, [sea.yFloor, sea.yWater]);
  const islandPoints = () => [...(island?.outlinePoints ?? []), ...(vegetation?.group.visible ? vegetation.outlinePoints : [])];
  let extraPoints = islandPoints();
  // 回しても収まる構図の計算用（間引いた点。いちばん高い点はすべて残す）
  const sparsePoints = (pts: THREE.Vector3[]) => {
    const step = Math.max(1, Math.floor(pts.length / 400));
    const top = [...pts].sort((a, b) => b.y - a.y).slice(0, 60);
    return [...top, ...pts.filter((_, i) => i % step === 0)];
  };
  let orbitPoints = sparsePoints(extraPoints);
  // 見下ろす角度ごとに、全方位から見た範囲を合わせたもの（画面の縦横比によらないので、0.5 度ごとに覚えておく）
  const orbitCache = new Map<number, { ped: ViewBounds; extra: ViewBounds | null }>();
  const scratchCamera = new THREE.PerspectiveCamera();
  const orbitBoundsAt = (key: number) => {
    let u = orbitCache.get(key);
    if (!u) {
      const ped = emptyBounds();
      const extra = emptyBounds();
      for (let a = 0; a < 360; a += 10) {
        scratchCamera.position.copy(directionFromAngles(a, key / 2)).multiplyScalar(distance).add(lookAt);
        scratchCamera.lookAt(lookAt);
        scratchCamera.updateMatrixWorld();
        addViewBounds(scratchCamera.matrixWorldInverse, pedestalOutline, ped);
        addViewBounds(scratchCamera.matrixWorldInverse, orbitPoints, extra);
      }
      u = { ped, extra: orbitPoints.length > 0 ? extra : null };
      orbitCache.set(key, u);
    }
    return u;
  };
  const lerpBounds = (a: ViewBounds, b: ViewBounds, t: number): ViewBounds => ({
    minX: a.minX + (b.minX - a.minX) * t,
    maxX: a.maxX + (b.maxX - a.maxX) * t,
    minY: a.minY + (b.minY - a.minY) * t,
    maxY: a.maxY + (b.maxY - a.maxY) * t,
  });
  /** 見下ろす角度 el で、どの方位に回しても台座と島が収まる範囲（0.5 度ごとの値を補間） */
  const orbitBounds = (el: number) => {
    const k = el * 2;
    const k0 = Math.floor(k);
    const t = k - k0;
    const a = orbitBoundsAt(k0);
    const b = orbitBoundsAt(k0 + 1);
    return {
      ped: lerpBounds(a.ped, b.ped, t),
      extra: a.extra && b.extra ? lerpBounds(a.extra, b.extra, t) : null,
    };
  };
  const angleDiff = (a: number, b: number) => Math.abs(((((a - b) % 360) + 540) % 360) - 180);
  const smooth01 = (v: number) => {
    const t = THREE.MathUtils.clamp(v, 0, 1);
    return t * t * (3 - 2 * t);
  };
  let viewW = 1;
  let viewH = 1;
  const homeView: ViewState = { azimuth: homeAzimuth, elevation: homeElevation, zoom: 1, panX: 0, panY: 0 };
  /**
   * いまの見る向きにカメラを置き、画角と画面上の位置を決める。
   * 元の向きでは参考画像の構図、回すにつれて、どの方位から見ても台座全体が収まる一定の構図へ移る
   * （回しているあいだに大きさが伸び縮みしない）。最後に、拡大と平行移動を重ねる。
   */
  const updateCamera = () => {
    const v = controls?.current ?? homeView;
    camera.position.copy(directionFromAngles(v.azimuth, v.elevation)).multiplyScalar(distance).add(lookAt);
    camera.lookAt(lookAt);
    camera.updateMatrixWorld();
    const aspect = viewW / viewH;
    const w = Math.max(
      smooth01(angleDiff(v.azimuth, homeAzimuth) / ctl.blendRange[0]),
      smooth01(Math.abs(v.elevation - homeElevation) / ctl.blendRange[1]),
    );
    const view = camera.matrixWorldInverse;
    const local =
      w < 1
        ? fitBounds(
            addViewBounds(view, pedestalOutline, emptyBounds()),
            extraPoints.length > 0 ? addViewBounds(view, extraPoints, emptyBounds()) : null,
            aspect,
            homeFraming,
            cam.fov,
          )
        : null;
    let orbit: Fit | null = null;
    if (w > 0) {
      const u = orbitBounds(v.elevation);
      orbit = fitBounds(u.ped, u.extra, aspect, config.framingOther, cam.fov);
    }
    let fit: Fit;
    if (local && orbit) {
      fit = {
        s: local.s + (orbit.s - local.s) * w,
        dx: local.dx + (orbit.dx - local.dx) * w,
        dy: local.dy + (orbit.dy - local.dy) * w,
      };
    } else {
      fit = (local ?? orbit)!;
    }
    applyFit(camera, viewW, viewH, cam.fov, {
      s: fit.s * v.zoom,
      dx: fit.dx * v.zoom + v.panX,
      dy: fit.dy * v.zoom + v.panY,
    });
  };

  // --- 描画（必要なときだけ描く。海は波のために一定の間隔で、見る向きを変えているあいだは毎コマ描く） ---
  let firstFrame = true;
  // 波・泡・水中の光の動き。動きを減らす設定のときや ?seaTime=秒 を付けたときは止める
  const fixedTime = Number.parseFloat(params.get('seaTime') ?? '');
  let reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
  let animate = !!water && !Number.isFinite(fixedTime) && !reduceMotion;
  const fps = lowPower ? config.sea.lowPowerFps : config.sea.fps;
  let seaTime = Number.isFinite(fixedTime) ? fixedTime : 0;
  const draw = () => {
    if (water && seaVisible) water.render(renderer, scene, camera, seaTime);
    else renderer.render(scene, camera);
    // 描画完了の目印（CSS でのフェードインなどに使える）
    canvas.dataset.ready = 'true';
    if (firstFrame) {
      firstFrame = false;
      canvas.dataset.startupMs = String(Math.round(performance.now() - t0));
      console.info(
        `scene ready: total ${Math.round(performance.now() - t0)} ms (island ${Math.round(islandMs)} ms, vegetation ${Math.round(vegetationMs)} ms, rocks ${Math.round(rocksMs)} ms, bake ${Math.round(bakeMs)} ms)`,
        island?.timings ?? {},
        vegetation ? { ...vegetation.counts, ...vegetation.timings } : {},
        rocks ? { ...rocks.counts, ...rocks.timings } : {},
      );
      showHint();
    }
  };

  // 操作開始・停止でcanvasをリサイズしない。解像度切替による輪郭の揺れと未描画を防ぐ。
  const basePixelRatio = () => Math.min(window.devicePixelRatio || 1, quality.maxPixelRatio);
  let loopRunning = false;
  let needsRender = true;
  let lastFrame = 0;
  let lastSeaTick = 0;
  const frame = (now: number) => {
    // 1 コマが長くかかる環境（GPU を使えない描画など）でも、動きが実際の時間どおりに進むように 1 秒までは数える
    const dtMs = lastFrame ? Math.min(now - lastFrame, 1000) : 1000 / 60;
    lastFrame = now;
    let doRender = needsRender;
    needsRender = false;
    const moving = !!controls && (controls.isMoving() || controls.isInteracting());
    if (controls && controls.update(dtMs / 1000)) {
      updateCamera();
      water?.invalidate();
      doRender = true;
    }

    const seaRunning = animate && seaVisible;
    if (seaRunning && now - lastSeaTick >= 1000 / fps - 2) {
      lastSeaTick = now;
      seaTime = now / 1000;
      doRender = true;
    }
    if (doRender) draw();
    if (seaRunning || needsRender || moving || controls?.isMoving()) {
      lifecycle.schedule(frame);
    } else {
      loopRunning = false;
      lastFrame = 0;
    }
  };
  /** 描画の繰り返しを始める（止まっていれば） */
  const wake = () => {
    if (loopRunning) return;
    loopRunning = true;
    lifecycle.schedule(frame);
  };
  const requestRender = () => {
    needsRender = true;
    wake();
  };

  // --- 見る向きの操作 ---
  const hint = document.getElementById('scene-hint');
  let hintTimer = 0;
  const hideHint = () => {
    window.clearTimeout(hintTimer);
    if (!hint || hint.hidden) return;
    hint.classList.remove('is-visible');
    window.setTimeout(() => (hint.hidden = true), 600);
  };
  const controls = ctl.enabled
    ? createViewControls(canvas, {
        home: { azimuth: homeAzimuth, elevation: homeElevation },
        elevationRange: ctl.elevationRange,
        zoomRange: ctl.zoomRange,
        rotateSpeed: ctl.rotateSpeed,
        damping: ctl.damping,
        inertia: ctl.inertia,
        reduceMotion,
        onChange: wake,
        onFirstInteraction: () => {
          hideHint();
          try {
            window.localStorage.setItem(HINT_KEY, '1');
          } catch {
            // 保存できなくても操作には影響しない
          }
        },
      })
    : null;
  if (controls) canvas.classList.add('is-interactive');
  if (controls) lifecycle.addCleanup(installPublicControls(window, controls, reduced => {
    reduceMotion = reduced;
    animate = !!water && !Number.isFinite(fixedTime) && !reduceMotion;
    requestRender();
  }));
  /** 操作の案内（最初に 1 回。触ったことがあれば出さない。?hint=0 で出さない） */
  function showHint() {
    if (!hint || !controls || !ctl.hint || params.get('hint') === '0') return;
    try {
      if (window.localStorage.getItem(HINT_KEY)) return;
    } catch {
      // 読めないときは案内を出す
    }
    const touch = window.matchMedia?.('(hover: none) and (pointer: coarse)').matches ?? false;
    hint.textContent = touch
      ? 'ドラッグで回転 ・ ピンチで拡大 ・ ダブルタップで戻す'
      : 'ドラッグで回転 ・ ホイールで拡大縮小 ・ ダブルクリックで元の向き';
    hint.hidden = false;
    lifecycle.schedule(() => hint.classList.add('is-visible'));
    hintTimer = window.setTimeout(hideHint, 9000);
  }

  const resize = () => {
    viewW = Math.max(1, canvas.clientWidth);
    viewH = Math.max(1, canvas.clientHeight);
    renderer.setPixelRatio(basePixelRatio());
    renderer.setSize(viewW, viewH, false);
    updateCamera();
    water?.invalidate();
    requestRender();
  };

  const observer = new ResizeObserver(resize);
  observer.observe(canvas);
  lifecycle.addCleanup(() => {
    observer.disconnect();
    controls?.dispose();
    window.clearTimeout(hintTimer);
    window.removeEventListener('resize', resize);
    window.removeEventListener('orientationchange', resize);
  });
  // 画面の回転や、ピクセル比の違うディスプレイへの移動にも追従する
  window.addEventListener('resize', resize);
  window.addEventListener('orientationchange', resize);
  resize();

  // GPU 上で生成したテクスチャはコンテキストが失われると消えるので、復帰時は作り直す
  const onContextLost = (event: Event) => {
    event.preventDefault();
    canvas.dataset.ready = 'false';
    canvas.dataset.unavailable = 'true';
    showMessage('3D表示が中断されました。再試行するか、展示室へ戻ってください。');
  };
  const onContextRestored = () => window.location.reload();
  canvas.addEventListener('webglcontextlost', onContextLost);
  canvas.addEventListener('webglcontextrestored', onContextRestored);
  lifecycle.addCleanup(() => {
    canvas.removeEventListener('webglcontextlost', onContextLost);
    canvas.removeEventListener('webglcontextrestored', onContextRestored);
  });

  /** 植生の表示・非表示を切り替える（影もその状態で作り直す） */
  const setVegetationVisible = (visible: boolean) => {
    if (!vegetation || vegetation.group.visible === visible) return;
    vegetation.group.visible = visible;
    bakeShadows();
    extraPoints = islandPoints();
    orbitPoints = sparsePoints(extraPoints);
    orbitCache.clear();
    resize();
  };

  /** 海（水面・断面・泡・水中の光）の表示・非表示を切り替える。海底・岩・台座の位置関係の確認用（影も作り直す） */
  const setSeaVisible = (visible: boolean) => {
    if (!water || seaVisible === visible) return;
    seaVisible = visible;
    bakeShadows();
    water.invalidate();
    requestRender();
  };

  /** 岩・緑の岩・小石の表示・非表示を切り替える（影と地表の砂利の模様もその状態にする） */
  const setRocksVisible = (visible: boolean) => {
    if (!rocks || rocks.group.visible === visible) return;
    rocks.group.visible = visible;
    groundGravel?.setEnabled(visible);
    bakeShadows();
    // 水面から出た岩のまわりの泡も、岩の有無に合わせる
    water?.updateShore(shoreSource());
    water?.invalidate();
    requestRender();
  };

  /**
   * 見る向き：get でいまの向き、set で変える（{ azimuth, elevation, zoom, panX, panY } の一部。animate: false ですぐに）、
   * reset で元の向きに戻す、isMoving で動いている途中か、setEnabled で操作の受け付けを止める・再開する
   */
  const view = {
    get: (): ViewState => ({ ...(controls?.current ?? homeView) }),
    set: (state: Partial<ViewState>, opts?: { animate?: boolean }) => controls?.set(state, opts),
    reset: (opts?: { animate?: boolean }) => controls?.reset(opts),
    /** 動いている途中か（ドラッグ中・なめらかに追いついている途中・惰性で回っている途中） */
    isMoving: () => !!controls && (controls.isMoving() || controls.isInteracting()),
    setEnabled: (enabled: boolean) => controls?.setEnabled(enabled),
  };

  return { renderer, scene, camera, view, setVegetationVisible, setRocksVisible, setSeaVisible };
}

const canvas = document.querySelector<HTMLCanvasElement>('#scene');
if (canvas) {
  try {
    const app = start(canvas);
    // 開発時の確認用（ブラウザのコンソールから参照できる）
    if (import.meta.env.DEV || new URLSearchParams(location.search).has('inspect')) (window as unknown as { __scene?: unknown }).__scene = app;
  } catch (error) {
    (window as unknown as { __disposeScene?: () => void }).__disposeScene?.();
    console.error('3D シーンを初期化できませんでした（WebGL2 が必要です）', error);
    showMessage(
      'このブラウザでは3D表示（WebGL2）を開始できませんでした。最新の Chrome、Safari、Firefox、Edge のいずれかで開いてください。',
    );
  }
}
