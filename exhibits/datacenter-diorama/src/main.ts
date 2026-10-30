import { createSceneLifecycle } from '../../shared/lifecycle';
import { installPublicControls } from '../../shared/public-controls';
import * as THREE from 'three';
import { config } from './config';
import { assignVertexBake } from './meshBuilder';
import { createLibraryMaterial } from './libraryMaterials';
import { createPlateGeometry } from './pedestal';
import { createFloor } from './floor';
import { areaLightDirections,bakeVisibility,blurPlanarBake,createBakeTarget,skyDirections,type DirectionSet,type PlaneReceiver } from './lightBaker';
import { setBakedLightSizes } from './bakedLighting';
import { addViewBounds,applyFit,directionFromAngles,emptyBounds,fitBounds,type Fit,type ViewBounds } from './framing';
import { createViewControls,type ViewState } from './viewControls';
import { useSoftHighlightToneMapping } from './toneMapping';
import { outlineAt,outlinePoints,insetRect } from './room/shape';
import { buildDatacenter } from './datacenter';
const HINT_KEY='datacenter-diorama:view-hint-seen';
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

function start(canvas:HTMLCanvasElement){
 const t0=performance.now();
 const renderer=new THREE.WebGLRenderer({canvas,antialias:true,powerPreference:'high-performance'});
 renderer.outputColorSpace=THREE.SRGBColorSpace;
 useSoftHighlightToneMapping(renderer,config.renderer.highlightKnee,config.renderer.exposure,config.renderer.grade);
 setBakedLightSizes(config.lights.key.softness,config.lights.fill.softness,0);
 const params=new URLSearchParams(location.search);
 const lowPower=params.get('quality')==='low'||(params.get('quality')!=='high'&&isSoftwareRenderer(renderer));
 const sh=config.shadow; const quality=lowPower?{...config.lowPower,lightSamples:4,aoSamples:8,mapSize:512}:{...sh,maxPixelRatio:config.renderer.maxPixelRatio};
 const W=10; const scene=new THREE.Scene();scene.background=new THREE.Color(config.renderer.background);
 const lifecycle=createSceneLifecycle(renderer,scene);
 const dc=buildDatacenter();
 const archGeo=dc.geometry,archBake=assignVertexBake(archGeo);
 const archTarget=createBakeTarget(renderer,archBake.width,archBake.height);
 lifecycle.addCleanup(() => { archTarget.dispose(); archBake.points.dispose(); });
 const archMat=createLibraryMaterial({mode:'vertex',vertexColors:true,roughness:.64,metalness:.15,shadowStrength:1,aoStrength:.9,aoMin:.22,aoOnDirect:.18});
 const arch=new THREE.Mesh(archGeo,archMat.material);scene.add(arch,dc.slab,dc.deck,new THREE.Mesh(dc.glow,new THREE.MeshBasicMaterial({vertexColors:true})));
 const plateGeo=createPlateGeometry(outlinePoints(insetRect(dc.base,.001)),config.pedestal);
 const plate=new THREE.Mesh(plateGeo,new THREE.MeshStandardMaterial({color:config.pedestal.sideColor,roughness:config.pedestal.sideRoughness}));scene.add(plate);
 const addLight=(s:typeof config.lights.key)=>{const direction=directionFromAngles(s.azimuth,s.elevation);const light=new THREE.DirectionalLight(s.color,s.intensity);light.position.copy(direction).multiplyScalar(40);scene.add(light,light.target);return {light,direction};};
 const key=addLight(config.lights.key),fill=addLight(config.lights.fill);
 const ambient=new THREE.HemisphereLight(config.lights.ambient.skyColor,config.lights.ambient.groundColor,config.lights.ambient.intensity);ambient.groundColor.multiplyScalar(config.lights.ambient.groundBoost);scene.add(ambient);
 scene.updateMatrixWorld(true);
 const tBake=performance.now(),floorBakeSize=W*sh.bakeRegion;
 const outerFloorTarget=createBakeTarget(renderer,quality.bakeResolution,quality.bakeResolution);
 lifecycle.addCleanup(() => outerFloorTarget.dispose());
 const outerFloor:PlaneReceiver={target:outerFloorTarget,centerX:0,centerZ:0,y:0,size:floorBakeSize};
 const deg=THREE.MathUtils.degToRad;
 const sets:DirectionSet[]=[
 {directions:areaLightDirections(key.direction,deg(config.lights.key.softness),quality.lightSamples),channel:0,planes:true,points:true},
 {directions:areaLightDirections(fill.direction,deg(config.lights.fill.softness),quality.lightSamples),channel:2,planes:true,points:true},
 {directions:skyDirections(quality.aoSamples,deg(sh.aoMinElevation)),channel:1,planes:true,points:true}];
 bakeVisibility(renderer,{casters:[arch,plate,dc.slab,dc.deck],sets,planes:[outerFloor],points:[{target:archTarget,geometry:archBake.points,matrixWorld:arch.matrixWorld,normalOffset:.008}],mapSize:quality.mapSize,bias:.008});
 blurPlanarBake(renderer,outerFloor,{boxHalf:[5,5],boxRadius:1.2,spread:deg(config.lights.key.softness)*Math.sqrt(Math.PI/quality.lightSamples)*.75,maxSigma:1.2});
 archMat.setBake(archTarget.texture);const bakeMs=performance.now()-tBake;
 const R=config.room;
  const floor = createFloor({
    color: config.floor.color,
    size: config.floor.size,
    bake: { texture: outerFloorTarget.texture, centerX: 0, centerZ: 0, size: floorBakeSize },
    shadowStrength: sh.strength,
    aoStrength: sh.aoStrength,
    lightMask: [1, 1, 0],
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
      half: [W / 2, R.base.depth / 2],
      radius: R.base.radius.frontLeft,
    },
  });
  scene.add(floor);

  // --- カメラ（仰角・画角・距離はシリーズと同じ、方位は参考画像に合わせて右手前から）と見る向き ---
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
  // 画角合わせ用の外形：台座の底と台の上の縁、壁の上端（笠石）と柱の頭
  const pedestalPoints = outlineAt(dc.base, [0, config.pedestal.thickness], 3);
  const upperPoints = [...outlineAt(dc.base,[dc.floorY],3),...[-4.5,4.5].flatMap(x=>[new THREE.Vector3(x,dc.wallTop+.2,-4.5),new THREE.Vector3(-4.5,dc.wallTop+.2,x)])];
  const extentPoints = [...pedestalPoints, ...upperPoints];
  const orbitCache = new Map<number, ViewBounds>();
  const scratchCamera = new THREE.PerspectiveCamera();
  const orbitBoundsAt = (k: number) => {
    let u = orbitCache.get(k);
    if (!u) {
      u = emptyBounds();
      for (let a = 0; a < 360; a += 10) {
        scratchCamera.position.copy(directionFromAngles(a, k / 2)).multiplyScalar(distance).add(lookAt);
        scratchCamera.lookAt(lookAt);
        scratchCamera.updateMatrixWorld();
        addViewBounds(scratchCamera.matrixWorldInverse, extentPoints, u);
      }
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
    return lerpBounds(orbitBoundsAt(k0), orbitBoundsAt(k0 + 1), k - k0);
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
   * 元の向きでは参考画像の構図、回すにつれて、どの方位から見ても全体が収まる一定の構図へ移る
   */
  const updateCamera = () => {
    const v = controls?.current ?? homeView;
    camera.position.copy(directionFromAngles(v.azimuth, v.elevation)).multiplyScalar(distance).add(lookAt);
    camera.lookAt(lookAt);
    camera.updateMatrixWorld();
    const aspect = viewW / viewH;
    const w = Math.max(smooth01(angleDiff(v.azimuth, homeAzimuth) / ctl.blendRange[0]), smooth01(Math.abs(v.elevation - homeElevation) / ctl.blendRange[1]));
    const local = w < 1 ? fitBounds(addViewBounds(camera.matrixWorldInverse, pedestalPoints, emptyBounds()), addViewBounds(camera.matrixWorldInverse, upperPoints, emptyBounds()), aspect, homeFraming, cam.fov) : null;
    const orbit = w > 0 ? fitBounds(orbitBounds(v.elevation), null, aspect, config.framingOther, cam.fov) : null;
    let fit: Fit;
    if (local && orbit) fit = { s: local.s + (orbit.s - local.s) * w, dx: local.dx + (orbit.dx - local.dx) * w, dy: local.dy + (orbit.dy - local.dy) * w };
    else fit = (local ?? orbit)!;
    applyFit(camera, viewW, viewH, cam.fov, { s: fit.s * v.zoom, dx: fit.dx * v.zoom + v.panX, dy: fit.dy * v.zoom + v.panY });
  };

  // --- 描画（必要なときだけ描く。見る向きを変えているあいだは毎コマ） ---
  let firstFrame = true;
  const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
  // render() submits GPU work; report readiness only once the first frame finishes.
  const context = renderer.getContext();
  if (!(context instanceof WebGL2RenderingContext)) throw new Error('WebGL2 is required');
  const gl = context;
  let firstFrameFence: WebGLSync | null = null;
  lifecycle.addCleanup(() => { if (firstFrameFence) gl.deleteSync(firstFrameFence); });
  const awaitFirstFrame = () => {
    if (!firstFrameFence) return;
    const status = gl.clientWaitSync(firstFrameFence, 0, 0);
    if (status === gl.TIMEOUT_EXPIRED) { lifecycle.schedule(awaitFirstFrame); return; }
    gl.deleteSync(firstFrameFence);
    firstFrameFence = null;
    if (status === gl.WAIT_FAILED) {
      canvas.dataset.unavailable = 'true';
      showMessage('3D表示を完了できませんでした。再試行するか、展示室へ戻ってください。');
      lifecycle.dispose();
      return;
    }
    canvas.dataset.ready = 'true';
    canvas.dataset.startupMs = String(Math.round(performance.now() - t0));
    showHint();
  };
  const draw = () => {
    if(document.hidden)return;
    renderer.render(scene, camera);
    if (firstFrame) {
      firstFrame = false;
      canvas.dataset.startupMs = String(Math.round(performance.now() - t0));
      console.info(
        `scene submitted: total ${Math.round(performance.now() - t0)} ms (bake ${Math.round(bakeMs)} ms, ${archGeo.attributes.position.count} vertices, 20 racks)`,
      );
      firstFrameFence = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
      if (!firstFrameFence) {
        canvas.dataset.unavailable = 'true';
        showMessage('3D表示を完了できませんでした。再試行してください。');
        lifecycle.dispose();
        return;
      }
      gl.flush();
      lifecycle.schedule(awaitFirstFrame);
    }
  };
  const basePixelRatio = () => Math.min(window.devicePixelRatio || 1, quality.maxPixelRatio);
  let loopRunning = false;
  let needsRender = true;
  let lastFrame = 0;
  const frame = (now: number) => {
    const dtMs = lastFrame ? Math.min(now - lastFrame, 1000) : 1000 / 60;
    lastFrame = now;
    let doRender = needsRender;
    needsRender = false;
    const moving = !!controls && (controls.isMoving() || controls.isInteracting());
    if (controls && controls.update(dtMs / 1000)) {
      updateCamera();
      doRender = true;
    }
    if (doRender) draw();
    if (needsRender || moving || controls?.isMoving()) {
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
  let hideTimer = 0;
  const hideHint = () => {
    window.clearTimeout(hintTimer);
    if (!hint || hint.hidden) return;
    hint.classList.remove('is-visible');
    window.clearTimeout(hideTimer);
    hideTimer = window.setTimeout(() => (hint.hidden = true), 600);
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
  if (controls) lifecycle.addCleanup(installPublicControls(window, controls, () => requestRender()));
  function showHint() {
    if (!hint || !controls || !ctl.hint || params.get('hint') === '0') return;
    try {
      if (window.localStorage.getItem(HINT_KEY)) return;
    } catch {
      // 読めないときは案内を出す
    }
    const touch = window.matchMedia?.('(hover: none) and (pointer: coarse)').matches ?? false;
    hint.textContent = touch ? 'ドラッグで回転 ・ ピンチで拡大 ・ ダブルタップで戻す' : 'ドラッグで回転 ・ ホイールで拡大縮小 ・ ダブルクリックで元の向き';
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
    requestRender();
  };
  const observer = new ResizeObserver(resize);
  observer.observe(canvas);
  lifecycle.addCleanup(() => {
    observer.disconnect();
    controls?.dispose();
    window.clearTimeout(hintTimer);
    window.clearTimeout(hideTimer);
    window.removeEventListener('resize', resize);
    window.removeEventListener('orientationchange', resize);
  });
  window.addEventListener('resize', resize);
  window.addEventListener('orientationchange', resize);
  resize();

  const onContextLost = (event: Event) => {
    event.preventDefault();
    canvas.dataset.ready = 'false';
    canvas.dataset.unavailable = 'true';
    showMessage('3D表示が中断されました。再試行するか、展示室へ戻ってください。');
    lifecycle.dispose();
  };
  canvas.addEventListener('webglcontextlost', onContextLost);
  lifecycle.addCleanup(() => canvas.removeEventListener('webglcontextlost', onContextLost));

  /** 見る向き：get でいまの向き、set で変える、reset で元の向き、isMoving で動いている途中か */
  const view = {
    get: (): ViewState => ({ ...(controls?.current ?? homeView) }),
    set: (state: Partial<ViewState>, opts?: { animate?: boolean }) => controls?.set(state, opts),
    reset: (opts?: { animate?: boolean }) => controls?.reset(opts),
    isMoving: () => !!controls && (controls.isMoving() || controls.isInteracting()),
    setEnabled: (enabled: boolean) => controls?.setEnabled(enabled),
  };
  return { renderer, scene, camera, view, requestRender };
}

const canvas = document.querySelector<HTMLCanvasElement>('#scene');
if (canvas) {
  try {
    const app = start(canvas);
    // 開発時の確認用（ブラウザのコンソールから参照できる）
    (window as unknown as { __scene?: unknown }).__scene = app;
  } catch (error) {
    (window as unknown as { __disposeScene?: () => void }).__disposeScene?.();
    canvas.dataset.unavailable = 'true';
    console.error('3D シーンを初期化できませんでした（WebGL2 が必要です）', error);
    showMessage('このブラウザでは3D表示（WebGL2）を開始できませんでした。最新の Chrome、Safari、Firefox、Edge のいずれかで開いてください。');
  }
}
