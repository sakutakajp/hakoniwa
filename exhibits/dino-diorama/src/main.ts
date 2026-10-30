import { installPublicControls } from '../../shared/public-controls';
import { createSceneLifecycle } from '../../shared/lifecycle';
import * as THREE from 'three';
import { config } from './config';
import { createPedestalGeometry, createSideMaterial, outlinePointsAt } from './pedestal';
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
import { createFloor } from './floor';
import { addViewBounds, applyFit, directionFromAngles, emptyBounds, fitBounds, type Fit, type ViewBounds } from './framing';
import { createViewControls, type ViewState } from './viewControls';
import { useSoftHighlightToneMapping } from './toneMapping';
import { createTerrainLayout } from './terrain/layout';
import { buildTerrainMeshes } from './terrain/mesh';
import { createGroundMaterial, createStrataMaterial } from './terrain/materials';
import { createWater } from './river/water';
import { createRocks } from './rocks';
import { createPlants } from './plants';
import { dinoSpotAreas } from './dinoSpots';
import { createProps } from './props';

/** 操作の案内を一度見たら（触ったら）出さないための印 */
const HINT_KEY = 'dino-diorama:view-hint-seen';

/** GPU を使わないソフトウェア描画かどうか（Chrome の SwiftShader、Linux の llvmpipe など） */
function isSoftwareRenderer(renderer: THREE.WebGLRenderer): boolean {
  const gl = renderer.getContext();
  let name = String(gl.getParameter(gl.RENDERER) ?? '');
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
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'default' });
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  useSoftHighlightToneMapping(renderer, config.renderer.highlightKnee, config.renderer.exposure);
  renderer.setClearColor(config.renderer.background, 1);

  const params = new URLSearchParams(window.location.search);
  const forced = params.get('quality');
  const lowPower = forced === 'high' ? false : forced === 'low' ? true : (isSoftwareRenderer(renderer) || window.matchMedia('(max-width: 700px)').matches);
  const quality = lowPower
    ? config.lowPower
    : {
        lightSamples: config.shadow.lightSamples,
        aoSamples: config.shadow.aoSamples,
        bakeResolution: config.shadow.bakeResolution,
        groundBakeResolution: config.shadow.groundBakeResolution,
        mapSize: config.shadow.mapSize,
        maxPixelRatio: config.renderer.maxPixelRatio,
      };
  const W = config.pedestal.size;
  const unit = W / 10;
  const timings: Record<string, number> = {};

  const scene = new THREE.Scene();
  const lifecycle = createSceneLifecycle(renderer, scene);
  scene.background = new THREE.Color(config.renderer.background);

  // --- 地面の塊の形（上面の高さ・川・砂地） ---
  let tt = performance.now();
  const layout = createTerrainLayout(config);
  timings.layout = performance.now() - tt;

  // --- 土台（地面の塊の下の薄い板。シリーズと同じく、塊よりわずかに内側） ---
  const baseInset = 0.012 * W;
  const baseShape = { ...config.pedestal, size: W - 2 * baseInset, cornerRadius: config.pedestal.cornerRadius - baseInset };
  const baseGeometry = createPedestalGeometry(baseShape);
  const sideMaterial = createSideMaterial({
    color: config.pedestal.sideColor,
    roughness: config.pedestal.sideRoughness,
    thickness: config.pedestal.thickness,
    bottomOcclusion: config.pedestal.sideBottomOcclusion,
  });
  const base = new THREE.Mesh(baseGeometry, sideMaterial);
  base.name = 'pedestal-base';
  scene.add(base);

  // --- 地面の塊（上面と外周の切り口） ---
  tt = performance.now();
  const meshes = buildTerrainMeshes(layout, lowPower ? 300 : config.terrain.segments);
  timings.terrainMesh = performance.now() - tt;
  const groundBakeSize = W * 1.02;
  const groundHeight = layout.heightTexture(groundBakeSize, quality.groundBakeResolution);
  const maskSize = W * 1.02;
  const mask = layout.maskTexture(maskSize, 512);
  const ground = createGroundMaterial(config, { mask, maskSize, levelRange: layout.levelRange });
  const terrainTop = new THREE.Mesh(meshes.top, ground.material);
  terrainTop.name = 'terrain-top';
  const terrainSkirt = new THREE.Mesh(meshes.skirt, createStrataMaterial(config, layout.yBase, { half: layout.half, radius: layout.cornerRadius }));
  terrainSkirt.name = 'terrain-section';
  scene.add(terrainTop, terrainSkirt);

  // --- 岩・川底の岩・小石。?rocks=0 で隠した状態から始める ---
  tt = performance.now();
  const rocks = createRocks(renderer, config, layout, { texture: groundHeight, size: groundBakeSize });
  rocks.group.visible = params.get('rocks') !== '0';
  scene.add(rocks.group);
  timings.rocks = performance.now() - tt;

  // --- 小物（倒木） ---
  const props = createProps(renderer, config, layout);
  scene.add(props.group);

  // --- 恐竜を置く場所（恐竜は別に用意する 3D モデルを置く。ここでは植物を置かずに空けておくだけ） ---
  const spots = dinoSpotAreas(config);

  // --- 植物（森・下草）。?plants=0 で隠した状態から始める ---
  tt = performance.now();
  const plants = createPlants(renderer, config, layout, [...rocks.disks, ...spots.footprints, ...props.disks], spots.treeClear);
  plants.group.visible = params.get('plants') !== '0';
  scene.add(plants.group);
  timings.plants = performance.now() - tt;

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

  // --- 影の焼き込み（床・地面の上面・岩・植物・倒木） ---
  tt = performance.now();
  const floorBakeSize = W * config.shadow.bakeRegion;
  const floorTarget = createBakeTarget(renderer, quality.bakeResolution, quality.bakeResolution);
  const groundTarget = createBakeTarget(renderer, quality.groundBakeResolution, quality.groundBakeResolution);
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
      points: true,
    },
  ];
  const floorPlane: PlaneReceiver = { target: floorTarget, centerX: 0, centerZ: 0, y: 0, size: floorBakeSize };
  const groundPlane: PlaneReceiver = {
    target: groundTarget,
    centerX: 0,
    centerZ: 0,
    y: 0.006 * unit,
    size: groundBakeSize,
    heightMap: groundHeight,
  };
  const sampleSpacing = deg(config.lights.key.softness) * Math.sqrt(Math.PI / quality.lightSamples);
  const casterBase = new THREE.Mesh(baseGeometry);
  const casterTop = new THREE.Mesh(meshes.top);
  const casterSkirt = new THREE.Mesh(meshes.skirt);
  const bakeShadows = () => {
    const casters: THREE.Mesh[] = [casterBase, casterTop, casterSkirt, ...props.casters];
    const points: PointReceiver[] = [...props.receivers];
    if (rocks.group.visible) {
      casters.push(...rocks.casters);
      points.push(...rocks.receivers);
    }
    if (plants.group.visible) {
      casters.push(...plants.casters);
      points.push(plants.receiver);
    }
    bakeVisibility(renderer, {
      casters,
      sets,
      planes: [floorPlane, groundPlane],
      points,
      mapSize: quality.mapSize,
      bias: 0.02 * unit,
    });
    blurPlanarBake(renderer, floorPlane, {
      boxHalf: W / 2,
      boxRadius: config.pedestal.cornerRadius,
      spread: sampleSpacing * 0.75,
      maxSigma: 1.2 * unit,
    });
  };
  bakeShadows();
  timings.bake = performance.now() - tt;
  ground.setBake({ texture: groundTarget.texture, size: groundBakeSize });

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
      half: W / 2,
      radius: config.pedestal.cornerRadius,
    },
  });
  scene.add(floor);

  // --- 川の水（水面・断面・滝）。不透明な物を描いた画像に重ねて描く。?water=0 で隠した状態から始める ---
  tt = performance.now();
  let waterVisible = params.get('water') !== '0';
  const water = createWater(renderer, config, layout, meshes, {
    lowPower,
    bake: { texture: groundTarget.texture, size: groundBakeSize, height: groundHeight },
    rocks: rocks.group.visible ? rocks.footprints : [],
  });
  timings.water = performance.now() - tt;

  // --- カメラ（遠近）と見る向き ---
  const angle = (name: string, fallback: number, min: number, max: number) => {
    const v = Number.parseFloat(params.get(name) ?? '');
    return Number.isFinite(v) ? THREE.MathUtils.clamp(v, min, max) : fallback;
  };
  const cam = config.camera;
  const ctl = config.controls;
  const homeAzimuth = angle('az', cam.azimuth, -360, 360);
  const homeElevation = angle('el', cam.elevation, ctl.elevationRange[0], ctl.elevationRange[1]);
  const homeFraming = params.has('az') || params.has('el') ? config.framingOther : config.framing;
  const distance = cam.distance * W;
  const camera = new THREE.PerspectiveCamera(cam.fov, 1, distance * 0.4, distance * 8);
  const lookAt = new THREE.Vector3(0, config.pedestal.thickness + cam.targetHeight * W, 0);
  // 画角合わせ用の外形：土台の底から地面の塊の上面までの外周（台座）と、木の上端、恐竜を置く場所の頭の高さ
  const pedestalOutline = outlinePointsAt(W / 2, config.pedestal.cornerRadius, [0, config.terrain.ground]);
  const contentPoints = () => [
    ...(plants.group.visible ? plants.outlinePoints : []),
    ...spots.outlinePoints,
  ];
  let extraPoints = contentPoints();
  const sparsePoints = (pts: THREE.Vector3[]) => {
    const step = Math.max(1, Math.floor(pts.length / 400));
    const top = [...pts].sort((a, b) => b.y - a.y).slice(0, 60);
    return [...top, ...pts.filter((_, i) => i % step === 0)];
  };
  let orbitPoints = sparsePoints(extraPoints);
  const orbitCache = new Map<number, { ped: ViewBounds; extra: ViewBounds | null }>();
  const scratchCamera = new THREE.PerspectiveCamera();
  const orbitBoundsAt = (k: number) => {
    let u = orbitCache.get(k);
    if (!u) {
      const ped = emptyBounds();
      const extra = emptyBounds();
      for (let a = 0; a < 360; a += 10) {
        scratchCamera.position.copy(directionFromAngles(a, k / 2)).multiplyScalar(distance).add(lookAt);
        scratchCamera.lookAt(lookAt);
        scratchCamera.updateMatrixWorld();
        addViewBounds(scratchCamera.matrixWorldInverse, pedestalOutline, ped);
        addViewBounds(scratchCamera.matrixWorldInverse, orbitPoints, extra);
      }
      u = { ped, extra: orbitPoints.length > 0 ? extra : null };
      orbitCache.set(k, u);
    }
    return u;
  };
  const lerpBounds = (a: ViewBounds, b: ViewBounds, t: number): ViewBounds => ({
    minX: a.minX + (b.minX - a.minX) * t,
    maxX: a.maxX + (b.maxX - a.maxX) * t,
    minY: a.minY + (b.minY - a.minY) * t,
    maxY: a.maxY + (b.maxY - a.maxY) * t,
  });
  const orbitBounds = (el: number) => {
    const k = el * 2;
    const k0 = Math.floor(k);
    const t = k - k0;
    const a = orbitBoundsAt(k0);
    const b = orbitBoundsAt(k0 + 1);
    return { ped: lerpBounds(a.ped, b.ped, t), extra: a.extra && b.extra ? lerpBounds(a.extra, b.extra, t) : null };
  };
  const angleDiff = (a: number, b: number) => Math.abs(((((a - b) % 360) + 540) % 360) - 180);
  const smooth01 = (v: number) => {
    const t = THREE.MathUtils.clamp(v, 0, 1);
    return t * t * (3 - 2 * t);
  };
  let viewW = 1;
  let viewH = 1;
  const homeView: ViewState = { azimuth: homeAzimuth, elevation: homeElevation, zoom: 1, panX: 0, panY: 0 };
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
    applyFit(camera, viewW, viewH, cam.fov, { s: fit.s * v.zoom, dx: fit.dx * v.zoom + v.panX, dy: fit.dy * v.zoom + v.panY });
  };

  // --- 描画（必要なときだけ描く。水は動きのために一定の間隔で、見る向きを変えているあいだは毎コマ描く） ---
  let firstFrame = true;
  // 水の動き。動きを減らす設定のときや ?waterTime=秒 を付けたときは止める
  const fixedTime = Number.parseFloat(params.get('waterTime') ?? '');
  let reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
  let animate = !Number.isFinite(fixedTime) && !reduceMotion;
  const fps = lowPower ? config.water.lowPowerFps : config.water.fps;
  let waterTime = Number.isFinite(fixedTime) ? fixedTime : 3;
  const draw = () => {
    if (waterVisible) water.render(renderer, scene, camera, waterTime);
    else renderer.render(scene, camera);
    canvas.dataset.ready = 'true';
    if (firstFrame) {
      firstFrame = false;
      canvas.dataset.startupMs = String(Math.round(performance.now() - t0));
      let triangles = 0;
      scene.traverse((o) => {
        const mesh = o as THREE.Mesh;
        if (!mesh.isMesh || !mesh.visible) return;
        const g = mesh.geometry;
        const n = (g.index ? g.index.count : g.attributes.position.count) / 3;
        triangles += n * ((o as THREE.InstancedMesh).isInstancedMesh ? (o as THREE.InstancedMesh).count : 1);
      });
      console.info(`scene ready: total ${Math.round(performance.now() - t0)} ms, ${Math.round(triangles / 1000)}k triangles`, timings, JSON.stringify(plants.counts), JSON.stringify(rocks.counts));
      showHint();
    }
  };

  // 操作開始・停止でcanvasをリサイズしない。解像度切替による輪郭の揺れと未描画を防ぐ。
  const basePixelRatio = () => Math.min(window.devicePixelRatio || 1, quality.maxPixelRatio);
  let loopRunning = false;
  let needsRender = true;
  let lastFrame = 0;
  let lastWaterTick = 0;
  const frame = (now: number) => {
    const dtMs = lastFrame ? Math.min(now - lastFrame, 1000) : 1000 / 60;
    lastFrame = now;
    let doRender = needsRender;
    needsRender = false;
    const moving = !!controls && (controls.isMoving() || controls.isInteracting());
    if (controls && controls.update(dtMs / 1000)) {
      updateCamera();
      water.invalidate();
      doRender = true;
    }

    const waterRunning = animate && waterVisible && !document.hidden;
    if (waterRunning && now - lastWaterTick >= 1000 / fps - 2) {
      lastWaterTick = now;
      waterTime = now / 1000;
      doRender = true;
    }
    if (doRender) draw();
    if (waterRunning || needsRender || moving || controls?.isMoving()) {
      lifecycle.schedule(frame);
    } else {
      loopRunning = false;
      lastFrame = 0;
    }
  };
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
    animate = !Number.isFinite(fixedTime) && !reduceMotion;
    requestRender();
  }));
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
    water.invalidate();
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
  // ページが隠れているあいだは水の動きを止め、戻ったら再開する
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) requestRender();
  });
  window.addEventListener('resize', resize);
  window.addEventListener('orientationchange', resize);
  resize();

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

  const refreshFraming = () => {
    extraPoints = contentPoints();
    orbitPoints = sparsePoints(extraPoints);
    orbitCache.clear();
    resize();
  };
  void refreshFraming;

  /** 川の水（水面・断面・滝）の表示・非表示を切り替える（形の確認用） */
  const setWaterVisible = (visible: boolean) => {
    if (waterVisible === visible) return;
    waterVisible = visible;
    water.invalidate();
    requestRender();
  };

  const view = {
    get: (): ViewState => ({ ...(controls?.current ?? homeView) }),
    set: (state: Partial<ViewState>, opts?: { animate?: boolean }) => controls?.set(state, opts),
    reset: (opts?: { animate?: boolean }) => controls?.reset(opts),
    isMoving: () => !!controls && (controls.isMoving() || controls.isInteracting()),
    setEnabled: (enabled: boolean) => controls?.setEnabled(enabled),
  };
  return { renderer, scene, camera, view, layout, setWaterVisible };
}

const canvas = document.querySelector<HTMLCanvasElement>('#scene');
if (canvas) {
  try {
    const app = start(canvas);
    if (import.meta.env.DEV || new URLSearchParams(location.search).has('inspect')) (window as unknown as { __scene?: unknown }).__scene = app;
  } catch (error) {
    (window as unknown as { __disposeScene?: () => void }).__disposeScene?.();
    console.error('3D シーンを初期化できませんでした（WebGL2 が必要です）', error);
    showMessage(
      'このブラウザでは3D表示（WebGL2）を開始できませんでした。最新の Chrome、Safari、Firefox、Edge のいずれかで開いてください。',
    );
  }
}
