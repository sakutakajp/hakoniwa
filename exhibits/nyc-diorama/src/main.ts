import { captureAsset } from '../../shared/asset-capture';
import { createSceneLifecycle } from '../../shared/lifecycle';
import * as THREE from 'three';
import { config } from './config';
import { groundHeightAt, layout, type CityLevels } from './layout';
import {
  createBlocksGeometry,
  createGroundTexture,
  createIslandGeometry,
  createSeawallMaterial,
  createSectionMaterial,
  mergeGeometries,
  signedArea,
  type P2,
} from './ground';
import { MeshBuilder, assignVertexBake } from './meshBuilder';
import { addBuildings, buildingOutlinePoints, facadeStyles } from './buildings';
import { addBridge, createCablesGeometry, createFlag } from './bridge';
import { addPier, addPromenadeRailing } from './pier';
import { addFerry } from './ferry';
import { createTrees, placeTrees } from './trees';
import { carPoses, createCars, createTaxiGeometry } from './cars';
import { createLamps } from './lamps';
import { createProps } from './props';
import { createSkyEnvironment } from './environment';
import { createBakedMaterial } from './materials';
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
import { applyPlanarBake, setBakedLightSizes } from './bakedLighting';
import { createFloor } from './floor';
import { createRiverLayout, seaLevels } from './sea/layout';
import { createSeabed } from './sea/seabed';
import { createWater } from './sea/water';
import type { ShoreSource } from './sea/shore';
import { addViewBounds, applyFit, directionFromAngles, emptyBounds, fitBounds, type Fit, type ViewBounds } from './framing';
import { createViewControls, type ViewState } from './viewControls';
import { useSoftHighlightToneMapping } from './toneMapping';

/** 操作の案内を一度見たら（触ったら）出さないための印 */
const HINT_KEY = 'nyc-diorama:view-hint-seen';

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
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'default' });
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  useSoftHighlightToneMapping(renderer, config.renderer.highlightKnee, config.renderer.exposure, config.renderer.grade);
  // 光源の大きさ（影のぼけと同じ）を、つやのある面に映る光の広がりにも使う
  setBakedLightSizes(config.lights.key.softness, config.lights.fill.softness);
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
        mapSize: config.shadow.mapSize,
        bakeResolution: config.shadow.bakeResolution,
        groundBakeResolution: config.shadow.groundBakeResolution,
        sandBakeResolution: config.shadow.sandBakeResolution,
        maxPixelRatio: config.renderer.maxPixelRatio,
        textureScale: 1,
      };
  const W = config.pedestal.size;
  const unit = W / 10;
  const sh = config.shadow;

  const scene = new THREE.Scene();
  const lifecycle = createSceneLifecycle(renderer, scene);
  scene.background = new THREE.Color(config.renderer.background);

  // --- 台座と水の高さ関係、川底の形（シリーズと同じ仕組み） ---
  const levels = seaLevels(config);
  const sea = createRiverLayout(config, layout);
  const yGround = levels.yGround;
  // 街の中の高さ（島の地面が 0）：水面と川底
  const city: CityLevels = { water: sea.yWater - yGround, bedAt: (x, z) => sea.seabedY(x, z) - yGround };

  // --- 土台（水の塊の下の薄い板） ---
  const baseShape = { ...config.pedestal, size: sea.baseHalf * 2, cornerRadius: sea.baseCornerRadius };
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

  // --- 砂（川底） ---
  const sandBakeSize = W * 1.02;
  const seabedHeight = sea.heightTexture(sandBakeSize, quality.sandBakeResolution);
  const sandTextures = generateSandTextures(renderer, { ...config.sand, textureSize: quality.textureSize }, W);
  const sandMaterial = new THREE.MeshStandardMaterial({
    map: sandTextures.colorMap,
    normalMap: sandTextures.normalMap,
    roughness: config.sand.roughness,
    metalness: 0,
  });
  sandMaterial.normalScale.setScalar(config.sand.normalStrength);
  const seabed = createSeabed(sea, sandMaterial, { size: W, segments: lowPower ? 220 : 300, sandColor: config.sea.skirt.sand });
  scene.add(seabed.surface, seabed.skirt);

  // --- 街のグループ（島の地面の高さに置く。中の形はすべて地面を 0 とした座標） ---
  const cityGroup = new THREE.Group();
  cityGroup.name = 'city';
  cityGroup.position.y = yGround;
  scene.add(cityGroup);
  cityGroup.updateMatrixWorld(true);

  // 映り込み用の空（ガラス・車・街灯のつやのある面だけ。拡散光は半球光から受ける）
  const reflectionEnv = createSkyEnvironment(renderer, {
    zenith: config.lights.reflection.zenith,
    horizon: config.lights.reflection.horizon,
    ground: config.lights.reflection.ground,
  });
  const reflection = { envMap: reflectionEnv, envMapIntensity: config.lights.reflection.intensity, envDiffuse: false };

  // --- 島：上面（道路の面）と護岸の石垣（台座の縁に届く配置なら、その切り口も） ---
  const islandGeo = createIslandGeometry(layout, { half: sea.half, cornerRadius: sea.cornerRadius, bottom: sea.yBaseTop - yGround });
  const groundBakeSize = W * 1.02;
  const groundTarget = createBakeTarget(renderer, quality.groundBakeResolution, quality.groundBakeResolution);
  const groundTexture = createGroundTexture(layout, W / 2, config.ground, quality.textureScale).texture;
  groundTexture.anisotropy = renderer.capabilities.getMaxAnisotropy();
  const groundMat = createBakedMaterial({
    mode: 'plane',
    plane: { centerX: 0, centerZ: 0, size: groundBakeSize },
    map: groundTexture,
    roughness: 0.93,
    shadowStrength: sh.strength,
    aoStrength: sh.groundAoStrength,
    aoMin: 0.3,
  });
  const islandTop = new THREE.Mesh(islandGeo.top, groundMat.material);
  islandTop.name = 'island-ground';
  const blocks = new THREE.Mesh(createBlocksGeometry(layout, W / 2, config.ground.curbHeight), groundMat.material);
  blocks.name = 'blocks';
  const seawall = new THREE.Mesh(islandGeo.seawall, createSeawallMaterial(config.island, sea.yWater));
  seawall.name = 'seawall';
  const section = new THREE.Mesh(islandGeo.section, createSectionMaterial(config.island));
  section.name = 'island-section';
  cityGroup.add(islandTop, blocks, seawall, section);

  // --- 建物・橋・桟橋・フェリー・遊歩道の手すり（外壁の模様つきの 1 つの形。影は頂点ごとに焼き込む） ---
  const { styles, index } = facadeStyles(config);
  const mb = new MeshBuilder(0.09);
  addBuildings(mb, layout, config, index);
  const bridge = captureAsset("bridge", [["structures", mb]], () => addBridge(mb, layout, config, index, city));
  const pier = captureAsset("pier", [["structures", mb]], () => addPier(mb, layout, config, index, city));
  const ferry = captureAsset("ferry", [["structures", mb]], () => addFerry(mb, layout, config, index, city.water));
  {
    const an = layout.bridge.anchorage;
    const [px0, px1] = layout.pier.deck;
    const front = layout.island.front;
    const R = sea.cornerRadius;
    const h = sea.half;
    addPromenadeRailing(mb, config, index, islandGeo.shoreRuns, {
      y: config.ground.curbHeight,
      ccw: signedArea(layout.island.outline as P2[]) > 0,
      skip: (x, z) => {
        // 桟橋と橋台の付け根
        if (z > front - 0.3 && x > px0 - 0.06 && x < px1 + 0.06) return true;
        if (z > front - 0.3 && x > an.c[0] - an.size[0] / 2 - 0.06 && x < an.c[0] + an.size[0] / 2 + 0.06) return true;
        // 台座の縁の近く（切り口）
        const qx = Math.abs(x) - (h - R);
        const qz = Math.abs(z) - (h - R);
        const inside = -(Math.hypot(Math.max(qx, 0), Math.max(qz, 0)) + Math.min(Math.max(qx, qz), 0) - R);
        return inside < 0.08;
      },
    });
  }
  const structGeo = mb.build();
  const structBake = assignVertexBake(structGeo, 1024);
  const structTarget = createBakeTarget(renderer, structBake.width, structBake.height);
  const structMat = createBakedMaterial({
    mode: 'vertex',
    facade: {
      styles,
      gradient: [config.buildings.groundShade, config.buildings.groundShadeHeight, config.buildings.topLift],
      groundY: yGround,
    },
    aoOnDirect: config.buildings.aoOnDirect,
    vertexColors: true,
    roughness: 0.82,
    shadowStrength: sh.strength,
    aoStrength: sh.aoStrength,
    aoMin: 0.32,
    glassBoost: config.buildings.glassBoost,
    ...reflection,
  });
  const structures = new THREE.Mesh(structGeo, structMat.material);
  structures.name = 'structures';
  cityGroup.add(structures);
  // 影を落とす形：トラスと手すり（模様で抜く所）は除く
  const structCaster = (() => {
    const skip = new Set([index('truss'), index('railing')]);
    const style = structGeo.attributes.aStyle;
    const src = structGeo.index!.array;
    const kept: number[] = [];
    for (let i = 0; i < src.length; i += 3) {
      if (!skip.has(Math.round(style.getX(src[i])))) kept.push(src[i], src[i + 1], src[i + 2]);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', structGeo.attributes.position);
    g.setIndex(kept);
    g.computeBoundingSphere();
    const m = new THREE.Mesh(g);
    cityGroup.add(m);
    m.visible = false;
    return m;
  })();
  // 島の塊も影を落とす（上面・護岸）
  const islandCaster = (() => {
    const m = new THREE.Mesh(mergeGeometries([islandGeo.top, islandGeo.seawall, islandGeo.section]));
    cityGroup.add(m);
    m.visible = false;
    return m;
  })();

  // 橋のケーブルと旗
  const cables = new THREE.Mesh(createCablesGeometry(bridge), new THREE.MeshStandardMaterial({ color: config.bridge.cable, roughness: 0.55 }));
  cables.name = 'bridge-cables';
  cityGroup.add(cables, createFlag(bridge.tower, config.bridge.pole));

  // --- 木・タクシー・街灯・ベンチと消火栓（インスタンスごとに影を焼き込む） ---
  const curb = config.ground.curbHeight;
  const groundAt = (x: number, z: number) => groundHeightAt(layout, x, z, curb);
  const an = layout.bridge.anchorage;
  const treeList = placeTrees(layout, {
    groundAt,
    // 橋の坂道と橋台のまわり
    avoid: (x, z, r) =>
      Math.abs(x - an.c[0]) < layout.bridge.width / 2 + r * 0.45 && z > layout.bridge.ramp.z[0] - 0.1 && z < an.c[1] + an.size[1] / 2,
  });
  const poses = carPoses(layout, bridge);
  const lampsData = createLamps(layout, config.lamps, groundAt);
  const propsData = createProps(layout, config.props, groundAt);
  const probeCount = treeList.length + poses.length + lampsData.count + propsData.count;
  const probeW = 256;
  const probeH = Math.max(1, Math.ceil(probeCount / probeW));
  const slotUv = (s: number): [number, number] => [((s % probeW) + 0.5) / probeW, (Math.floor(s / probeW) + 0.5) / probeH];
  const probeTarget = createBakeTarget(renderer, probeW, probeH);
  // 葉：主光が当たる側の輪郭を少し明るく（縁の光）、光と反対側の面にも葉を透かした光を少し足す
  const leafMat = createBakedMaterial({
    mode: 'instance',
    vertexColors: true,
    roughness: 0.9,
    shadowStrength: sh.strength,
    aoStrength: 0.6,
    aoMin: 0.35,
    extraUniforms: {
      uLeafRim: { value: config.trees.rim },
      uLeafTrans: { value: config.trees.translucency },
      uLeafClump: { value: new THREE.Vector3(1 / config.trees.clumpSize, config.trees.clumpBump, config.trees.clumpCavity) },
      uLeafUnder: { value: config.trees.underShade },
    },
    extraDeclarations: /* glsl */ `
uniform float uLeafRim;
uniform float uLeafTrans;
uniform vec3 uLeafClump;
uniform float uLeafUnder;
vec3 leafHash( vec3 p ) {
  p = vec3( dot( p, vec3( 127.1, 311.7, 74.7 ) ), dot( p, vec3( 269.5, 183.3, 246.1 ) ), dot( p, vec3( 113.5, 271.9, 124.6 ) ) );
  return fract( sin( p ) * 43758.5453 );
}`,
    // 葉の房：樹冠の表面に小さな丸いふくらみを並べる（3D のセル模様。いちばん近い点を中心にした丸みへ法線を傾け、房の境目を暗く）
    normalFragment: /* glsl */ `
{
  vec3 p = vBkWorld * uLeafClump.x;
  vec3 ip = floor( p );
  vec3 fp = fract( p );
  float d1 = 8.0;
  float d2 = 8.0;
  vec3 r1 = vec3( 0.0 );
  for ( int k = -1; k <= 1; k++ ) {
    for ( int j = -1; j <= 1; j++ ) {
      for ( int i = -1; i <= 1; i++ ) {
        vec3 g = vec3( float( i ), float( j ), float( k ) );
        vec3 r = g + leafHash( ip + g ) * 0.8 + 0.1 - fp;
        float d = dot( r, r );
        if ( d < d1 ) {
          d2 = d1;
          d1 = d;
          r1 = r;
        } else if ( d < d2 ) {
          d2 = d;
        }
      }
    }
  }
  // 房の中心から外へ向かう向きの、面に沿った成分だけで傾ける（裏返らないように）
  vec3 bump = ( viewMatrix * vec4( -r1, 0.0 ) ).xyz;
  bump -= dot( bump, normal ) * normal;
  normal = normalize( normal + uLeafClump.y * bump );
  float edge = sqrt( d2 ) - sqrt( d1 );
  diffuseColor.rgb *= mix( 1.0 - uLeafClump.z, 1.0, smoothstep( 0.0, 0.6, edge ) );
}`,
    extraFragment: /* glsl */ `
{
  // 樹冠の下側には、自分の葉と足もとの陰で空の光が届きにくい
  vec3 wN = inverseTransformDirection( normal, viewMatrix );
  reflectedLight.indirectDiffuse *= 1.0 - uLeafUnder * smoothstep( 0.5, -0.8, wN.y );
}
#if NUM_DIR_LIGHTS > 0
{
  vec3 N = normalize( geometryNormal );
  vec3 V = geometryViewDir;
  vec3 L = directionalLights[ 0 ].direction;
  // 日なたの面の拡散光と同じ尺度（three.js の直接光は 1/π 倍）。影の中では効かない
  vec3 lightC = directionalLights[ 0 ].color * gBakedVis.x * RECIPROCAL_PI;
  float ndl = dot( N, L );
  // 葉を透かした光：光と反対を向いた面ほど、また光源の方を見るときほど強い
  float through = clamp( dot( -V, L ) * 0.5 + 0.5, 0.0, 1.0 );
  float trans = uLeafTrans * clamp( 0.35 - ndl * 0.5, 0.0, 1.0 ) * ( 0.35 + 0.65 * through * through );
  // 縁の光：輪郭に近く、光の方を向いた所
  float rim = uLeafRim * pow( 1.0 - clamp( dot( N, V ), 0.0, 1.0 ), 2.5 ) * smoothstep( -0.2, 0.6, ndl );
  reflectedLight.directDiffuse += lightC * diffuseColor.rgb * ( trans * vec3( 0.95, 1.05, 0.6 ) + rim );
}
#endif`,
  });
  const trunkMat = createBakedMaterial({ mode: 'instance', color: '#8a5d40', roughness: 0.9, shadowStrength: sh.strength, aoStrength: 0.6, aoMin: 0.3 });
  const trees = createTrees(treeList, leafMat.material, trunkMat.material, slotUv);
  cityGroup.add(trees.group);
  const taxiGeo = createTaxiGeometry(config.cars);
  {
    const uv = new Float32Array(poses.length * 2);
    poses.forEach((_, i) => uv.set(slotUv(treeList.length + i), i * 2));
    taxiGeo.setAttribute('instanceBakeUv', new THREE.InstancedBufferAttribute(uv, 2));
  }
  const carMat = createBakedMaterial({
    mode: 'instance',
    vertexColors: true,
    roughness: 0.38,
    metalness: 0.05,
    shadowStrength: sh.strength,
    aoStrength: 0.55,
    aoMin: 0.35,
    ...reflection,
  });
  const cars = createCars(poses, taxiGeo, carMat.material);
  cityGroup.add(cars.mesh);
  const lampMat = createBakedMaterial({ mode: 'instance', vertexColors: true, roughness: 0.5, shadowStrength: sh.strength, aoStrength: 0.4, aoMin: 0.4, ...reflection });
  const lamps = lampsData.build(lampMat.material, (i) => slotUv(treeList.length + poses.length + i));
  cityGroup.add(lamps.mesh);
  // ベンチと消火栓（塗装した木と金属：街灯より少しつやを抑える）
  const propMat = createBakedMaterial({ mode: 'instance', vertexColors: true, roughness: 0.6, shadowStrength: sh.strength, aoStrength: 0.5, aoMin: 0.35 });
  const props = propsData.build(propMat.material, (i) => slotUv(treeList.length + poses.length + lampsData.count + i));
  cityGroup.add(...props.meshes);
  scene.updateMatrixWorld(true);

  // --- 照明（シリーズと同じ。追加する順番が、焼き込んだ影のライト番号になる：0 = 主光、1 = 補助光） ---
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
  const ambient = new THREE.HemisphereLight(config.lights.ambient.skyColor, config.lights.ambient.groundColor, config.lights.ambient.intensity);
  ambient.groundColor.multiplyScalar(config.lights.ambient.groundBoost);
  scene.add(ambient);

  // --- 影の焼き込み（床・川底・水面・街の地面、建物などの頂点、木と車）。遮るのは土台・島・建物・木などの実際の形 ---
  const tBake = performance.now();
  const floorBakeSize = W * sh.bakeRegion;
  const floorTarget = createBakeTarget(renderer, quality.bakeResolution, quality.bakeResolution);
  const sandTarget = createBakeTarget(renderer, quality.sandBakeResolution, quality.sandBakeResolution);
  const surfaceTarget = createBakeTarget(renderer, quality.sandBakeResolution, quality.sandBakeResolution);
  // 土台は上面をわずかに下げて影を作る（川底が土台の影を拾わないように）
  const baseCaster = new THREE.Mesh(baseGeometry);
  baseCaster.position.y = sea.yFloor;
  baseCaster.scale.y = 0.95;
  baseCaster.updateMatrixWorld();
  // 水の塊（土台の上面から水面まで）。床にだけ、薄めの影を落とす
  let seaVisible = params.get('sea') !== '0';
  const waterBlockCaster = new THREE.Mesh(
    createPedestalGeometry({
      ...config.pedestal,
      size: sea.half * 2,
      cornerRadius: sea.cornerRadius,
      thickness: sea.yWater - sea.yDeep,
      topEdgeRadius: 0.01,
      bottomEdgeRadius: 0.01,
    }),
  );
  waterBlockCaster.position.y = sea.yDeep;
  waterBlockCaster.updateMatrixWorld();
  const deg = THREE.MathUtils.degToRad;
  const sets: DirectionSet[] = [
    { directions: areaLightDirections(key.direction, deg(config.lights.key.softness), quality.lightSamples), channel: 0, planes: true, points: true },
    { directions: areaLightDirections(fill.direction, deg(config.lights.fill.softness), quality.lightSamples), channel: 2, planes: true, points: true },
    { directions: skyDirections(quality.aoSamples, deg(sh.aoMinElevation)), channel: 1, planes: true, points: true },
  ];
  const floorPlane: PlaneReceiver = { target: floorTarget, centerX: 0, centerZ: 0, y: sea.yFloor, size: floorBakeSize, lateWeight: config.sea.floorShadow };
  const sandPlane: PlaneReceiver = { target: sandTarget, centerX: 0, centerZ: 0, y: 0.002 * unit, size: sandBakeSize, heightMap: seabedHeight };
  const surfacePlane: PlaneReceiver = { target: surfaceTarget, centerX: 0, centerZ: 0, y: sea.yWater + 0.002 * unit, size: sandBakeSize };
  const groundPlane: PlaneReceiver = { target: groundTarget, centerX: 0, centerZ: 0, y: yGround + 0.006, size: groundBakeSize };
  const structReceiver: PointReceiver = { target: structTarget, geometry: structBake.points, matrixWorld: cityGroup.matrixWorld, normalOffset: 0.018 };
  const probeReceiver: PointReceiver = (() => {
    const pos = new Float32Array(probeCount * 3);
    const nor = new Float32Array(probeCount * 3);
    const uv = new Float32Array(probeCount * 2);
    const all = [...trees.probes, ...cars.probes, ...lamps.probes, ...props.probes];
    all.forEach((p, i) => {
      p.toArray(pos, i * 3);
      nor[i * 3 + 1] = 1;
      uv.set(slotUv(i), i * 2);
    });
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
    g.setAttribute('bakeUv', new THREE.BufferAttribute(uv, 2));
    return { target: probeTarget, geometry: g, matrixWorld: cityGroup.matrixWorld, normalOffset: 0.02 };
  })();
  const sampleSpacing = deg(config.lights.key.softness) * Math.sqrt(Math.PI / quality.lightSamples);
  const bakeShadows = () => {
    bakeVisibility(renderer, {
      casters: [baseCaster, islandCaster, structCaster, ...trees.meshes, cars.mesh, lamps.mesh, ...props.meshes],
      lateCasters: seaVisible ? [waterBlockCaster] : [],
      sets,
      planes: [floorPlane, sandPlane, surfacePlane, groundPlane],
      points: [structReceiver, probeReceiver],
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
  groundMat.setBake(groundTarget.texture);
  structMat.setBake(structTarget.texture);
  for (const m of [leafMat, trunkMat, carMat, lampMat, propMat]) m.setBake(probeTarget.texture);

  // 水の中の川底の影は薄く（水が光を散らす）。砂浜は陸上と同じ
  applyPlanarBake(
    sandMaterial,
    { texture: sandTarget.texture, centerX: 0, centerZ: 0, size: sandBakeSize },
    {
      shadowStrength: sh.strength,
      aoStrength: sh.sandAoStrength,
      underwater: { level: sea.yWater, strength: config.sea.seabedShadow, fillStrength: 0, aoStrength: 0.3, fade: 0.02 * W },
    },
  );

  // --- 床（シリーズと同じ暖かい淡いベージュ。遠くは背景の色に溶け込む） ---
  const floor = createFloor({
    color: config.floor.color,
    size: config.floor.size,
    bake: { texture: floorTarget.texture, centerX: 0, centerZ: 0, size: floorBakeSize },
    shadowStrength: sh.strength,
    aoStrength: sh.aoStrength,
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

  // --- 水（水面・側面の断面・泡・水中の光・フェリーの航跡）。不透明な物を描いた画像に重ねて描く。?sea=0 で隠した状態から始める ---
  const insideFootprint = (x: number, z: number) =>
    bridge.footprints.some((f) => {
      const dx = x - f.c[0];
      const dz = z - f.c[1];
      const a = dx * f.along[0] + dz * f.along[1];
      const n = -dx * f.along[1] + dz * f.along[0];
      return Math.abs(a) <= f.half[0] && Math.abs(n) <= f.half[1];
    });
  const shoreSource = (): ShoreSource => ({
    sampleField: null,
    landAt: (x, z) => sea.islandDistance(x, z) < 0 || sea.seabedY(x, z) > sea.yWater + 0.0005 * W || insideFootprint(x, z),
    // 桟橋の杭（水面の高さでの太さ）
    rocks: pier.pilings.map((p) => ({ x: p.x, z: p.z, radius: p.r, bottom: sea.yWater - 0.1, top: sea.yWater + 0.5 })),
  });
  const water = createWater(renderer, config, sea, {
    lowPower,
    bake: { texture: sandTarget.texture, size: sandBakeSize, height: seabedHeight, surface: surfaceTarget.texture },
    shore: shoreSource(),
    ferry: { center: ferry.center, dir: ferry.dir, length: ferry.length, width: ferry.width },
  });

  // --- カメラ（シリーズと同じ：手前の辺の正面から見下ろす）と見る向き ---
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
  // 元の向きの構図：既定の向きではシリーズと同じ構図、?az / ?el で始めたときは台座全体を画面いっぱいに
  const homeFraming = params.has('az') || params.has('el') ? config.framingOther : config.framing;
  const distance = cam.distance * W;
  const camera = new THREE.PerspectiveCamera(cam.fov, 1, distance * 0.4, distance * 8);
  const lookAt = new THREE.Vector3(0, sea.yBaseTop + cam.targetHeight * W, 0);
  // 画角合わせ用の外形：土台の底・水面の外周（台座）と、建物・橋・木などの上端
  const pedestalOutline = outlinePointsAt(sea.half, sea.cornerRadius, [sea.yFloor, sea.yWater]);
  const toWorld = (pts: THREE.Vector3[]) => pts.map((p) => new THREE.Vector3(p.x, p.y + yGround, p.z));
  const extraPoints = toWorld([
    ...buildingOutlinePoints(layout),
    ...bridge.outline,
    ...pier.outline,
    ...ferry.outline,
    ...trees.outline,
    ...cars.outline,
  ]);
  // 回しても収まる構図の計算用（間引いた点。いちばん高い点はすべて残す）
  const orbitPoints = (() => {
    const step = Math.max(1, Math.floor(extraPoints.length / 400));
    const top = [...extraPoints].sort((a, b) => b.y - a.y).slice(0, 60);
    return [...top, ...extraPoints.filter((_, i) => i % step === 0)];
  })();
  // 見下ろす角度ごとに、全方位から見た範囲を合わせたもの（画面の縦横比によらないので、0.5 度ごとに覚えておく）
  const orbitCache = new Map<number, { ped: ViewBounds; extra: ViewBounds }>();
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
      u = { ped, extra };
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
  /** 見下ろす角度 el で、どの方位に回しても台座と街が収まる範囲（0.5 度ごとの値を補間） */
  const orbitBounds = (el: number) => {
    const k = el * 2;
    const k0 = Math.floor(k);
    const t = k - k0;
    const a = orbitBoundsAt(k0);
    const b = orbitBoundsAt(k0 + 1);
    return { ped: lerpBounds(a.ped, b.ped, t), extra: lerpBounds(a.extra, b.extra, t) };
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
   * 元の向きではシリーズの構図、回すにつれて、どの方位から見ても台座全体が収まる一定の構図へ移る
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
        ? fitBounds(addViewBounds(view, pedestalOutline, emptyBounds()), addViewBounds(view, extraPoints, emptyBounds()), aspect, homeFraming, cam.fov)
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

  // --- 描画（必要なときだけ描く。水は波のために一定の間隔で、見る向きを変えているあいだは毎コマ描く） ---
  let firstFrame = true;
  // 波・泡・水中の光・航跡の動き。動きを減らす設定のときや ?seaTime=秒 を付けたときは止める
  const fixedTime = Number.parseFloat(params.get('seaTime') ?? params.get('waterTime') ?? '');
  const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
  const animate = !Number.isFinite(fixedTime) && !reduceMotion;
  const fps = lowPower ? config.sea.lowPowerFps : config.sea.fps;
  let seaTime = Number.isFinite(fixedTime) ? fixedTime : 0;
  const draw = () => {
    if (seaVisible) water.render(renderer, scene, camera, seaTime);
    else renderer.render(scene, camera);
    // 描画完了の目印（CSS でのフェードインに使う）
    canvas.dataset.ready = 'true';
    if (firstFrame) {
      firstFrame = false;
      canvas.dataset.startupMs = String(Math.round(performance.now() - t0));
      console.info(
        `scene ready: total ${Math.round(performance.now() - t0)} ms (bake ${Math.round(bakeMs)} ms, ${structGeo.attributes.position.count} vertices, ${treeList.length} trees, ${poses.length} cars)`,
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
      water.invalidate();
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
  // 画面の回転や、ピクセル比の違うディスプレイへの移動にも追従する
  window.addEventListener('resize', resize);
  window.addEventListener('orientationchange', resize);
  resize();

  // GPU 上で作ったテクスチャはコンテキストが失われると消えるので、復帰時は作り直す
  canvas.addEventListener('webglcontextlost', (event) => event.preventDefault());
  canvas.addEventListener('webglcontextrestored', () => window.location.reload());

  /** 水（水面・断面・泡・水中の光）の表示・非表示を切り替える。川底・橋の基礎・台座の位置関係の確認用（影も作り直す） */
  const setSeaVisible = (visible: boolean) => {
    if (seaVisible === visible) return;
    seaVisible = visible;
    bakeShadows();
    water.invalidate();
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
    isMoving: () => !!controls && (controls.isMoving() || controls.isInteracting()),
    setEnabled: (enabled: boolean) => controls?.setEnabled(enabled),
  };
  /** 水の時刻を決めて描く（確認用。動きを止めて同じ絵を撮るとき） */
  const setSeaTime = (t: number) => {
    seaTime = t;
    requestRender();
  };
  return { renderer, scene, camera, view, setSeaVisible, setSeaTime, setWaterTime: setSeaTime, requestRender };
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
