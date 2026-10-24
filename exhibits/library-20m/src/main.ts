import { createSceneLifecycle } from '../../shared/lifecycle';
import * as THREE from 'three';
import { config } from './config';
import { assignVertexBake } from './meshBuilder';
import { createLibraryMaterial, type RoomInterior } from './libraryMaterials';
import { createPlateGeometry, createSideMaterial } from './pedestal';
import { createFloor } from './floor';
import { createInteriorEnvironment } from './environment';
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
import { setBakedLightSizes } from './bakedLighting';
import { addViewBounds, applyFit, directionFromAngles, emptyBounds, fitBounds, type Fit, type ViewBounds } from './framing';
import { createViewControls, type ViewState } from './viewControls';
import { useSoftHighlightToneMapping } from './toneMapping';
import { createContext } from './room/context';
import { buildSlab, buildWalls, wallGeometry, windowHoles } from './room/structure';
import { buildGallery } from './room/gallery';
import { buildSpiralStair } from './room/spiral';
import { buildBookcases } from './room/bookcases';
import { buildFurniture } from './room/furniture';
import { createInscriptionAtlas } from './room/inscription';
import { BOOK_COLOR, BOOK_FRAGMENT_DECL, BOOK_NORMAL, BOOK_VERTEX, BOOK_VERTEX_DECL, createBooksMesh } from './room/books';
import { celestialTexture, globeTexture, paintingTexture, rugTexture } from './room/textures';
import { outlineAt, outlinePoints } from './room/shape';
import { createGlows, type GlowItem } from './room/glow';
import { createSunBeams, type BeamWindow } from './room/sunbeams';

/** 操作の案内を一度見たら（触ったら）出さないための印 */
const HINT_KEY = 'library-diorama:view-hint-seen';

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

/**
 * 部屋の床：斜め 45° に張った 2 色の大理石（クリームのボッティチーノと灰色のバルディリオ。コドリントン図書館の床）。
 * 敷石ごとに石の模様の場所と色を変え（別の石から切り出した見え方）、淡い石には濃い筋、濃い石には白い筋。細い目地。
 * 床の縁（台の縁の内側）に沿って、淡い余白・濃い石の帯・淡い細線・濃い細線の縁取り（角の丸みに沿う）。磨いた面のつや
 */
const MARBLE_FLOOR_GLSL = /* glsl */ `
{
  vec2 p = vBkWorld.xz;
  float fw = max( max( fwidth( p.x ), fwidth( p.y ) ), 1e-4 );
  float s = uFloorTile.x;
  // 敷石：45° 回した正方形の格子
  vec2 r = vec2( p.x + p.y, p.y - p.x ) * ( 0.70710678 / s );
  vec2 cell = floor( r );
  vec2 f = fract( r );
  float parity = mod( cell.x + cell.y, 2.0 );
  float h = lbHash( cell + vec2( 17.0, 3.0 ) );
  float h2 = lbHash( cell + vec2( 5.0, 91.0 ) );
  vec3 mm = lbMarble( p * 1.35 + vec2( h * 23.0, h2 * 31.0 ), fw * 1.35 );
  vec3 stoneA = uMarbleA * ( 0.97 + 0.06 * h ) * vec3( 1.0 + 0.02 * ( h2 - 0.5 ), 1.0, 1.0 - 0.03 * ( h2 - 0.5 ) );
  vec3 stoneB = uMarbleB * ( 0.92 + 0.14 * h ) * vec3( 1.0 - 0.02 * ( h2 - 0.5 ), 1.0, 1.0 + 0.04 * ( h2 - 0.5 ) );
  float cloud = smoothstep( 0.18, 0.85, mm.x );
  stoneA *= mix( 1.02, 0.94, cloud * 0.6 );
  stoneB *= mix( 1.04, 0.92, cloud * 0.6 );
  stoneA = mix( stoneA, stoneA * vec3( 0.84, 0.81, 0.78 ), mm.y * 0.5 );
  stoneB = mix( stoneB, stoneB * vec3( 0.86, 0.85, 0.86 ), mm.y * 0.4 );
  vec3 field = mix( stoneA, stoneB, parity ) * ( 1.0 + 0.05 * mm.z );
  float e = min( min( f.x, 1.0 - f.x ), min( f.y, 1.0 - f.y ) ) * s;
  float joint = 1.0 - smoothstep( uFloorTile.y - fw * 0.6, uFloorTile.y + fw * 0.6, e );
  // 床の縁からの距離（角の丸い正方形の内側）
  vec2 q = abs( p ) - vec2( uFloorShape.x - uFloorShape.y );
  float d = -( min( max( q.x, q.y ), 0.0 ) + length( max( q, 0.0 ) ) - uFloorShape.y );
  float b0 = uFloorBorder.x;
  float b1 = b0 + uFloorBorder.y;
  float b2 = b1 + uFloorBorder.z;
  float b3 = b2 + uFloorBorder.w;
  float aa = fw * 0.7;
  float inBand = smoothstep( b0 - aa, b0 + aa, d ) * ( 1.0 - smoothstep( b1 - aa, b1 + aa, d ) );
  float inLine = smoothstep( b2 - aa, b2 + aa, d ) * ( 1.0 - smoothstep( b3 - aa, b3 + aa, d ) );
  float inField = smoothstep( b3 - aa, b3 + aa, d );
  vec3 band = uFloorBand * ( 0.92 + 0.12 * mm.x ) * ( 1.0 + 0.08 * mm.z );
  band = mix( band, vec3( 0.78, 0.74, 0.68 ), mm.y * 0.35 );
  vec3 col = mix( stoneA, band, max( inBand, inLine ) );
  col = mix( col, field, inField );
  // 縁取りの境目と敷石の目地は細い溝（少し暗く、粗い）
  float edgeLine = 0.0;
  for ( int k = 0; k < 4; k++ ) {
    float bd = k == 0 ? b0 : ( k == 1 ? b1 : ( k == 2 ? b2 : b3 ) );
    edgeLine = max( edgeLine, 1.0 - smoothstep( uFloorTile.y * 0.8, uFloorTile.y * 0.8 + fw, abs( d - bd ) ) );
  }
  float groove = max( joint * inField, edgeLine );
  // 床のまん中の手前の、象嵌の星（方位の星：4 本の長い光・4 本の斜めの光・16 本の小さな光。光ごとに明るい半分と陰の半分）と、まわりの輪
  {
    vec2 dp = p - uRose.xy;
    float R = uRose.z;
    float r = length( dp );
    if ( r < R + 0.02 ) {
      float th = atan( dp.x, -dp.y );
      float aaR = fw * 0.8;
      // 星の 1 層：n 本の光、光の長さ L、光の間のくびれの半径 w。返り値 x = 内側（0〜1）、y = 光の右半分なら 1
      vec3 starCol = vec3( 0.0 );
      float starA = 0.0;
      for ( int layer = 0; layer < 3; layer++ ) {
        float n = layer == 0 ? 16.0 : ( layer == 1 ? 8.0 : 4.0 );
        float L = R * ( layer == 0 ? 0.5 : ( layer == 1 ? 0.7 : 0.86 ) );
        float wv = R * ( layer == 0 ? 0.19 : ( layer == 1 ? 0.21 : 0.2 ) );
        float off = layer == 1 ? 3.14159265 / 8.0 : ( layer == 0 ? 3.14159265 / 16.0 : 0.0 );
        float seg = 6.28318531 / n;
        float a = th - off;
        float k = floor( a / seg + 0.5 );
        float ph = a - k * seg;
        vec2 q = vec2( r * cos( ph ), r * sin( abs( ph ) ) );
        vec2 T = vec2( L, 0.0 );
        vec2 Vv = vec2( wv * cos( seg * 0.5 ), wv * sin( seg * 0.5 ) );
        vec2 e1 = Vv - T;
        float sd = ( ( q.x - T.x ) * e1.y - ( q.y - T.y ) * e1.x ) / length( e1 );
        float inside = smoothstep( aaR, -aaR, sd ) * step( 0.0, q.x );
        // 長い光は淡い石と濃い石、斜めの光はばら色の石、小さな光は灰色の石（どれも明るい半分と陰の半分）
        vec3 lightC = layer == 2 ? uMarbleA * 1.03 : ( layer == 1 ? uRoseB : uRoseC );
        vec3 darkC = layer == 2 ? uRoseA : lightC * 0.76;
        vec3 cc = ph > 0.0 ? lightC : darkC;
        starCol = mix( starCol, cc, inside );
        starA = max( starA, inside );
        // 光の中筋（明るい半分と陰の半分の境目）の細い線
        starCol = mix( starCol, darkC * 0.8, inside * ( 1.0 - smoothstep( 0.0, aaR * 1.5 + 0.002, abs( q.y ) ) ) * 0.6 );
      }
      // 輪：外の濃い帯、淡い細線、濃い細線
      float ring = smoothstep( R - 0.075 - aaR, R - 0.075 + aaR, r ) * ( 1.0 - smoothstep( R - aaR, R + aaR, r ) );
      float ring2 = smoothstep( R - 0.11 - aaR, R - 0.11 + aaR, r ) * ( 1.0 - smoothstep( R - 0.095 - aaR, R - 0.095 + aaR, r ) );
      vec3 disc = mix( stoneA, uMarbleB, 0.42 );
      vec3 rc = mix( disc, starCol, starA );
      rc = mix( rc, band, max( ring, ring2 ) );
      // 中心の小さな円
      float hub = 1.0 - smoothstep( R * 0.06 - aaR, R * 0.06 + aaR, r );
      rc = mix( rc, uRoseA, hub );
      float inDisc = 1.0 - smoothstep( R - aaR, R + aaR, r );
      col = mix( col, rc, inDisc );
      groove = mix( groove, max( 1.0 - smoothstep( 0.0015, 0.0015 + fw, abs( r - R ) ), 1.0 - smoothstep( 0.0015, 0.0015 + fw, abs( r - R + 0.075 ) ) ), inDisc );
    }
  }
  diffuseColor.rgb = mix( col, col * 0.62, groove * 0.75 );
  roughnessFactor = uFloorTile.z + 0.06 * ( h2 - 0.5 ) + 0.05 * mm.x + 0.4 * groove;
}
`;

/** 回廊の床板（奥の回廊は x の向き、左の回廊は z の向きの板。板ごとに継ぎ目の位置をずらす）。板ごとの年輪と色むら、目地、つやのむら */
const DECK_GLSL = /* glsl */ `
{
  vec2 p = vBkWorld.xz;
  // 左の回廊（角より手前）は z の向きの板
  if ( p.x < uDeckEdge && p.y > uDeckEdge ) p = vec2( -p.y, p.x );
  float bw = 0.115;
  float row = floor( p.y / bw );
  float h = lbHash( vec2( row, 3.0 ) );
  float cu = p.x / 1.3 + h;
  float cell = floor( cu );
  float sd = cell * 17.0 + row * 5.0;
  float h2 = lbHash1( sd );
  float fw = max( max( fwidth( p.x ), fwidth( p.y ) ), 1e-4 );
  float late;
  float t = lbWood( p.x + h2 * 9.0, p.y - ( row + 0.5 ) * bw, sd, 0.028, fw, late );
  vec3 base = uDeckColor * ( 0.9 + 0.2 * h2 ) * vec3( 1.0 + 0.05 * ( h2 - 0.5 ), 1.0, 1.0 - 0.07 * ( h2 - 0.5 ) );
  base *= t;
  base = mix( base, base * vec3( 0.9, 0.78, 0.68 ), late * 0.5 );
  float aaV = max( fwidth( p.y / bw ), 1e-4 );
  float aaU = max( fwidth( cu ), 1e-4 );
  float joint = max( 1.0 - lbBand( fract( p.y / bw ), 0.03, 0.97, aaV ), 1.0 - lbBand( fract( cu ), 0.005, 0.995, aaU ) );
  diffuseColor.rgb = mix( base, base * 0.5, joint * 0.7 );
  roughnessFactor = 0.42 + 0.08 * ( h2 - 0.5 ) + 0.05 * late + 0.25 * joint;
}
`;

function start(canvas: HTMLCanvasElement) {
  const t0 = performance.now();
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'default' });
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  useSoftHighlightToneMapping(renderer, config.renderer.highlightKnee, config.renderer.exposure, config.renderer.grade);
  setBakedLightSizes(config.lights.key.softness, config.lights.fill.softness, config.lights.sun.softness);
  renderer.setClearColor(config.renderer.background, 1);

  // GPU がない環境では、起動時の焼き込みを軽くする（?quality=high / low で確認用に切り替え可能）
  const params = new URLSearchParams(window.location.search);
  const forced = params.get('quality');
  const lowPower = forced === 'high' ? false : forced === 'low' ? true : (isSoftwareRenderer(renderer) || window.matchMedia('(max-width: 700px)').matches);
  const sh = config.shadow;
  const quality = lowPower
    ? config.lowPower
    : {
        lightSamples: sh.lightSamples,
        sunSamples: sh.sunSamples,
        aoSamples: sh.aoSamples,
        mapSize: sh.mapSize,
        bakeResolution: sh.bakeResolution,
        roomBakeResolution: sh.roomBakeResolution,
        maxPixelRatio: config.renderer.maxPixelRatio,
      };
  const R = config.room;
  const W = R.base.width;
  const floorY = R.slab.floorY;
  const gy = R.gallery.y;

  const scene = new THREE.Scene();
  const lifecycle = createSceneLifecycle(renderer, scene);
  scene.background = new THREE.Color(config.renderer.background);

  // --- 部屋を組み立てる（形・本・灯り・テクスチャを貼る小物） ---
  const ctx = createContext(config);
  const atlas = createInscriptionAtlas([...config.inscription.left, ...config.inscription.back]);
  buildSlab(ctx);
  buildWalls(ctx);
  buildGallery(ctx, atlas);
  buildSpiralStair(ctx);
  buildBookcases(ctx);
  buildFurniture(ctx);
  const g = wallGeometry(ctx);
  const holes = windowHoles(ctx);
  const room: RoomInterior = { leftX: g.xi, backZ: g.zi, arcCenter: [g.blc.x, g.blc.z], arcRadius: g.rBLi, minY: floorY - 0.01, light: config.lights.interior };

  // 映り込み用の部屋の環境（真鍮・金箔・ニス・磨いた石のつやのある面だけ。拡散光は半球光から受ける）
  const reflectionEnv = createInteriorEnvironment(renderer, config.lights.reflection);
  const reflection = { envMap: reflectionEnv, envMapIntensity: config.lights.reflection.intensity };
  const glassColors = { top: config.colors.glassTop, bottom: config.colors.glassBottom };

  // --- 台座の土台（シリーズの明るい木地の板。外形は台座の角丸の長方形） ---
  const plateGeo = createPlateGeometry(outlinePoints(ctx.base, 12, 10), config.pedestal);
  const plate = new THREE.Mesh(
    plateGeo,
    createSideMaterial({
      color: config.pedestal.sideColor,
      roughness: config.pedestal.sideRoughness,
      thickness: config.pedestal.thickness,
      bottomOcclusion: config.pedestal.sideBottomOcclusion,
    }),
  );
  plate.name = 'pedestal-plate';
  scene.add(plate);

  // --- 骨組み・本棚・家具（1 つの形。影は頂点ごとに焼き込む） ---
  const archGeo = ctx.mb.build();
  const archBake = assignVertexBake(archGeo, 1024);
  const archTarget = createBakeTarget(renderer, archBake.width, archBake.height);
  const archMat = createLibraryMaterial({
    mode: 'vertex',
    styles: ctx.st.list,
    vertexColors: true,
    shadowStrength: sh.strength,
    aoStrength: sh.aoStrength,
    aoMin: 0.28,
    aoOnDirect: 0.3,
    room,
    lamps: ctx.lamps,
    glass: glassColors,
    bevel: config.bevel,
    inscription: atlas.texture,
    ...reflection,
  });
  const arch = new THREE.Mesh(archGeo, archMat.material);
  arch.name = 'library';
  scene.add(arch);

  // 窓のガラス（明るい空と庭の景色。影を落とさない）
  const glassMat = createLibraryMaterial({ mode: 'plane', styles: ctx.st.list, vertexColors: true, shadowStrength: 0, aoStrength: 0, glass: glassColors });
  const glass = new THREE.Mesh(ctx.glass.build(), glassMat.material);
  glass.name = 'window-glass';
  scene.add(glass);

  // 陳列台のガラス（透明。映り込みだけで、影は落とさない）
  {
    const geo = ctx.clearGlass.build();
    if (geo.attributes.position.count > 0) {
      const m = new THREE.MeshStandardMaterial({ color: '#eef4f2', roughness: 0.03, metalness: 0, transparent: true, opacity: 0.2, envMap: reflectionEnv, envMapIntensity: 2.4, depthWrite: false, side: THREE.DoubleSide });
      const mesh = new THREE.Mesh(geo, m);
      mesh.name = 'case-glass';
      mesh.renderOrder = 8;
      scene.add(mesh);
    }
  }

  // 植物の葉（両面）
  const foliageGeo = ctx.foliage.build();
  const foliageBake = assignVertexBake(foliageGeo, 512);
  const foliageTarget = createBakeTarget(renderer, foliageBake.width, foliageBake.height);
  const foliageMat = createLibraryMaterial({
    mode: 'vertex',
    styles: ctx.st.list,
    vertexColors: true,
    side: THREE.DoubleSide,
    shadowStrength: sh.strength,
    aoStrength: 0.7,
    aoMin: 0.35,
    room,
    lamps: ctx.lamps,
  });
  const foliage = new THREE.Mesh(foliageGeo, foliageMat.material);
  foliage.name = 'plants';
  scene.add(foliage);

  // --- 本（インスタンス。影は 1 冊ごとに背の前で焼き込む） ---
  const probeW = 256;
  const probeH = Math.max(1, Math.ceil(ctx.books.length / probeW));
  const slotUv = (s: number): [number, number] => [((s % probeW) + 0.5) / probeW, (Math.floor(s / probeW) + 0.5) / probeH];
  const bookTarget = createBakeTarget(renderer, probeW, probeH);
  const bookMat = createLibraryMaterial({
    mode: 'instance',
    roughness: 0.78,
    shadowStrength: sh.strength,
    aoStrength: 0.85,
    aoMin: 0.3,
    room,
    lamps: ctx.lamps,
    vertexDeclarations: BOOK_VERTEX_DECL,
    vertexFragment: BOOK_VERTEX,
    extraDeclarations: BOOK_FRAGMENT_DECL,
    normalFragment: BOOK_NORMAL,
    colorFragment: BOOK_COLOR,
    extraUniforms: {
      uBookGold: { value: new THREE.Color(config.books.gold) },
      uBookPaper: { value: new THREE.Color(config.colors.paper) },
    },
    // 箔押しの金と革のつやに、部屋の映り込み
    ...reflection,
  });
  const books = createBooksMesh(ctx.books, bookMat.material, slotUv);
  scene.add(books.mesh);

  // --- 部屋の床（寄木）と回廊の床板、敷物（平面に影を焼き込む） ---
  const roomBakeSize = W * 1.04;
  const floorTarget = createBakeTarget(renderer, quality.roomBakeResolution, quality.roomBakeResolution);
  const deckTarget = createBakeTarget(renderer, quality.roomBakeResolution, quality.roomBakeResolution);
  const polyGeometry = (pts: [number, number][], y: number) => {
    const contour = pts.map(([x, z]) => new THREE.Vector2(x, -z));
    if (THREE.ShapeUtils.isClockWise(contour)) contour.reverse();
    const tris = THREE.ShapeUtils.triangulateShape(contour, []);
    const pos: number[] = [];
    for (const p of contour) pos.push(p.x, y, -p.y);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('normal', new THREE.Float32BufferAttribute(contour.flatMap(() => [0, 1, 0]), 3));
    geo.setIndex(tris.flat());
    geo.computeBoundingSphere();
    return geo;
  };
  const MF = config.marbleFloor;
  const floorMat = createLibraryMaterial({
    mode: 'plane',
    plane: { centerX: 0, centerZ: 0, size: roomBakeSize },
    roughness: MF.roughness,
    shadowStrength: sh.strength,
    aoStrength: 0.9,
    aoMin: 0.25,
    room,
    lamps: ctx.lamps,
    colorFragment: MARBLE_FLOOR_GLSL,
    extraDeclarations: 'uniform vec3 uMarbleA;\nuniform vec3 uMarbleB;\nuniform vec3 uFloorBand;\nuniform vec3 uFloorTile;\nuniform vec2 uFloorShape;\nuniform vec4 uFloorBorder;\nuniform vec3 uRose;\nuniform vec3 uRoseA;\nuniform vec3 uRoseB;\nuniform vec3 uRoseC;',
    extraUniforms: {
      uMarbleA: { value: new THREE.Color(MF.light) },
      uMarbleB: { value: new THREE.Color(MF.dark) },
      uFloorBand: { value: new THREE.Color(MF.band) },
      uFloorTile: { value: new THREE.Vector3(MF.tile, MF.joint, MF.roughness) },
      uFloorShape: { value: new THREE.Vector2(W / 2 - R.slab.rimWidth, R.base.radius.frontLeft - R.slab.rimWidth) },
      uFloorBorder: { value: new THREE.Vector4(...MF.border) },
      uRose: { value: new THREE.Vector3(MF.rose.center[0], MF.rose.center[1], MF.rose.radius) },
      uRoseA: { value: new THREE.Color(MF.rose.colors[0]) },
      uRoseB: { value: new THREE.Color(MF.rose.colors[1]) },
      uRoseC: { value: new THREE.Color(MF.rose.colors[2]) },
    },
    ...reflection,
    envMapIntensity: 0.55,
  });
  const roomFloor = new THREE.Mesh(polyGeometry(ctx.floorOutline, floorY), floorMat.material);
  roomFloor.name = 'marble-floor';
  scene.add(roomFloor);
  const deckMat = createLibraryMaterial({
    mode: 'plane',
    plane: { centerX: 0, centerZ: 0, size: roomBakeSize },
    roughness: 0.5,
    shadowStrength: sh.strength,
    aoStrength: 0.9,
    aoMin: 0.25,
    room,
    lamps: ctx.lamps,
    colorFragment: DECK_GLSL,
    extraDeclarations: 'uniform vec3 uDeckColor;\nuniform float uDeckEdge;',
    extraUniforms: { uDeckColor: { value: new THREE.Color(config.colors.deck) }, uDeckEdge: { value: g.edge } },
    ...reflection,
    envMapIntensity: 0.5,
  });
  const deck = new THREE.Mesh(polyGeometry(ctx.deckOutline, gy), deckMat.material);
  deck.name = 'gallery-deck';
  scene.add(deck);
  const rugMat = createLibraryMaterial({
    mode: 'plane',
    plane: { centerX: 0, centerZ: 0, size: roomBakeSize },
    map: rugTexture({ field: config.colors.rugField, border: config.colors.rugBorder, accent: config.colors.rugAccent }),
    roughness: 0.95,
    shadowStrength: sh.strength,
    aoStrength: 0.9,
    aoMin: 0.25,
    room,
    lamps: ctx.lamps,
    // 毛足：結び目の細かなむら（近づいたときだけ）と、浅い角度ほど明るいビロードのようなつや
    colorFragment: /* glsl */ `
{
  vec2 p = vBkWorld.xz;
  float fw = max( max( fwidth( p.x ), fwidth( p.y ) ), 1e-4 );
  float pile = mix( 0.5, lbNoise( p * 420.0 ), lbKeep( fw * 420.0 ) );
  diffuseColor.rgb *= 0.94 + 0.12 * pile;
  float ndv = clamp( dot( normalize( vNormal ), normalize( vViewPosition ) ), 0.0, 1.0 );
  diffuseColor.rgb *= 1.0 + 0.2 * pow( 1.0 - ndv, 3.0 );
}
`,
  });
  // 各卓に実寸4.9×3.6mの敷物。元の柄と家具の実寸比を保つ。
  const rugGeo = new THREE.PlaneGeometry(2.45, 1.8).rotateX(-Math.PI / 2);
  for (const x of [-1.45, 1.25]) for (const z of [-1.2, 1.5]) {
    const rug = new THREE.Mesh(rugGeo, rugMat.material);
    rug.position.set(x, floorY + 0.006, z);
    rug.name = 'rug';
    scene.add(rug);
  }

  // 絵と地球儀（テクスチャを貼った小さな形）
  const maps = { painting: paintingTexture(3), paintingSmall: paintingTexture(11, 256, 320), globe: globeTexture(), celestial: celestialTexture() };
  for (const t of ctx.textured) {
    const m = createLibraryMaterial({ mode: 'plane', map: maps[t.map], roughness: t.roughness ?? 0.6, shadowStrength: 0, aoStrength: 0, room, lamps: ctx.lamps });
    const mesh = new THREE.Mesh(t.geometry, m.material);
    mesh.name = t.name;
    scene.add(mesh);
  }
  // 灯りと窓のまわりのにじみ
  {
    const items: GlowItem[] = ctx.lamps.map((l) => ({ position: l.position, size: l.range > 1.4 ? 0.7 : 0.4, color: l.color, opacity: l.range > 1.4 ? 0.6 : 0.5 }));
    // 窓のにじみ：まん中のセルリアーナをいちばん明るく（ほかの窓は控えめに）
    for (const h of holes.all) {
      const w = h.u1 - h.u0;
      const main = h === holes.center;
      items.push({ position: new THREE.Vector3((h.u0 + h.u1) / 2, (h.sill + h.top) / 2, g.zi + 0.08), size: main ? 2.6 : 0.8 + w * 0.8, color: '#fff0d2', opacity: main ? 0.3 : 0.13 });
    }
    scene.add(createGlows(items));
  }
  // 窓から差し込む日差しの筋（奥の上の窓から、日差しの向きに）
  {
    const sb = config.sunbeams;
    const wins: BeamWindow[] = holes.all.map((h) => ({ center: new THREE.Vector3((h.u0 + h.u1) / 2, 0, g.zi + 0.04), right: new THREE.Vector3(1, 0, 0), width: h.u1 - h.u0, sill: h.sill, top: h.top }));
    scene.add(createSunBeams(wins, directionFromAngles(config.lights.sun.azimuth, config.lights.sun.elevation), sb));
  }
  scene.updateMatrixWorld(true);

  // --- 照明（シリーズの主光・補助光・半球光と、窓の日差し。追加する順番が焼き込みのライト番号：0 = 主光、1 = 補助光、2 = 日差し） ---
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
  const sun = addDirectionalLight(config.lights.sun);
  const ambient = new THREE.HemisphereLight(config.lights.ambient.skyColor, config.lights.ambient.groundColor, config.lights.ambient.intensity);
  ambient.groundColor.multiplyScalar(config.lights.ambient.groundBoost);
  scene.add(ambient);
  // 確認用：?light=key / fill / sun / ambient で、その光だけにする（光ごとの効き方と影の焼き込みを確かめる）
  {
    const only = params.get('light');
    if (only) {
      key.light.visible = only === 'key';
      fill.light.visible = only === 'fill';
      sun.light.visible = only === 'sun';
      ambient.visible = only === 'ambient';
      if (only !== 'key') key.light.intensity = 0;
      if (only !== 'fill') fill.light.intensity = 0;
      if (only !== 'sun') sun.light.intensity = 0;
      key.light.visible = fill.light.visible = sun.light.visible = true;
    }
  }

  // --- 影の焼き込み ---
  const tBake = performance.now();
  const floorBakeSize = W * sh.bakeRegion;
  const outerFloorTarget = createBakeTarget(renderer, quality.bakeResolution, quality.bakeResolution);
  // 土台は上面をわずかに下げて影を作る（部屋の床が土台の影を拾わないように）
  const plateCaster = new THREE.Mesh(plateGeo);
  plateCaster.scale.y = 0.95;
  plateCaster.updateMatrixWorld();
  // 窓の日差しだけに効く見えない天井と右の覆い（部屋に入る日差しを窓からだけにする。日は右奥から差すので、開いた手前からは入らない）
  // 天井と、開いた右の面、奥の壁の右の端から台の右の縁までのすき間をふさぐ（窓へ向かう光はさえぎらない）
  const shieldH = R.wall.top + 0.45;
  const shield = [
    new THREE.Mesh(new THREE.BoxGeometry(W + 0.6, 0.2, R.base.depth + 0.6).translate(0, R.wall.top + 0.25, 0)),
    new THREE.Mesh(new THREE.BoxGeometry(0.2, shieldH, R.base.depth + 0.4).translate(W / 2 + 0.25, shieldH / 2, 0.15)),
    new THREE.Mesh(new THREE.BoxGeometry(W / 2 - g.backEnd + 0.7, shieldH, 0.3).translate((g.backEnd - 0.2 + W / 2 + 0.5) / 2, shieldH / 2, (g.zo + g.zi) / 2)),
  ];
  const deg = THREE.MathUtils.degToRad;
  const sets: DirectionSet[] = [
    { directions: areaLightDirections(key.direction, deg(config.lights.key.softness), quality.lightSamples), channel: 0, planes: true, points: true },
    { directions: areaLightDirections(fill.direction, deg(config.lights.fill.softness), quality.lightSamples), channel: 2, planes: true, points: true },
    { directions: skyDirections(quality.aoSamples, deg(sh.aoMinElevation)), channel: 1, planes: true, points: true },
    { directions: areaLightDirections(sun.direction, deg(config.lights.sun.softness), quality.sunSamples), channel: 3, planes: true, points: true, extraCasters: shield },
  ];
  const outerFloor: PlaneReceiver = { target: outerFloorTarget, centerX: 0, centerZ: 0, y: 0, size: floorBakeSize };
  const floorPlane: PlaneReceiver = { target: floorTarget, centerX: 0, centerZ: 0, y: floorY + 0.004, size: roomBakeSize };
  const deckPlane: PlaneReceiver = { target: deckTarget, centerX: 0, centerZ: 0, y: gy + 0.004, size: roomBakeSize };
  const archReceiver: PointReceiver = { target: archTarget, geometry: archBake.points, matrixWorld: arch.matrixWorld, normalOffset: 0.012 };
  const foliageReceiver: PointReceiver = { target: foliageTarget, geometry: foliageBake.points, matrixWorld: foliage.matrixWorld, normalOffset: 0.01 };
  const bookReceiver: PointReceiver = (() => {
    const n = books.probes.length;
    const pos = new Float32Array(n * 3);
    const nor = new Float32Array(n * 3);
    const uv = new Float32Array(n * 2);
    books.probes.forEach((p, i) => {
      p.position.toArray(pos, i * 3);
      p.normal.toArray(nor, i * 3);
      uv.set(slotUv(i), i * 2);
    });
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
    geo.setAttribute('bakeUv', new THREE.BufferAttribute(uv, 2));
    return { target: bookTarget, geometry: geo, matrixWorld: new THREE.Matrix4(), normalOffset: 0.006 };
  })();
  bakeVisibility(renderer, {
    casters: [plateCaster, arch, books.mesh, foliage],
    sets,
    planes: [outerFloor, floorPlane, deckPlane],
    points: [archReceiver, foliageReceiver, bookReceiver],
    mapSize: quality.mapSize,
    bias: 0.012,
  });
  // 面光源を有限個の方向で近似したため、長い影の先で縞が出る。台座から離れるほどぼかして消す
  blurPlanarBake(renderer, outerFloor, {
    boxHalf: [W / 2, R.base.depth / 2],
    boxRadius: R.base.radius.frontLeft,
    spread: deg(config.lights.key.softness) * Math.sqrt(Math.PI / quality.lightSamples) * 0.75,
    maxSigma: 1.2,
  });
  const bakeMs = performance.now() - tBake;
  archMat.setBake(archTarget.texture);
  foliageMat.setBake(foliageTarget.texture);
  bookMat.setBake(bookTarget.texture);
  for (const m of [floorMat, rugMat]) m.setBake(floorTarget.texture);
  deckMat.setBake(deckTarget.texture);

  // --- 台座のまわりの床（シリーズと同じ暖かい淡いベージュ。遠くは背景の色に溶け込む） ---
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
  const extentPoints = (() => {
    const pts = outlineAt(ctx.base, [0, R.slab.top], 3);
    const ch = R.coping.height;
    // 左の壁と奥の壁の笠石の両端、奥の左の丸い角、壁の端の柱の頭
    for (const z of [g.leftEnd, g.blc.z]) for (const x of [g.xo - 0.05, g.xi + 0.2]) pts.push(new THREE.Vector3(x, g.top + ch + 0.03, z));
    for (const x of [g.backEnd, g.blc.x]) for (const z of [g.zo - 0.05, g.zi + 0.2]) pts.push(new THREE.Vector3(x, g.top + ch + 0.03, z));
    for (let i = 0; i <= 8; i++) {
      const t = Math.PI + (i / 8) * (Math.PI / 2);
      pts.push(new THREE.Vector3(g.blc.x + (g.rBLo + 0.05) * Math.cos(t), g.top + ch, g.blc.z + (g.rBLo + 0.05) * Math.sin(t)));
    }
    return pts;
  })();
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
    const local = w < 1 ? fitBounds(addViewBounds(camera.matrixWorldInverse, extentPoints, emptyBounds()), null, aspect, homeFraming, cam.fov) : null;
    const orbit = w > 0 ? fitBounds(orbitBounds(v.elevation), null, aspect, config.framingOther, cam.fov) : null;
    let fit: Fit;
    if (local && orbit) fit = { s: local.s + (orbit.s - local.s) * w, dx: local.dx + (orbit.dx - local.dx) * w, dy: local.dy + (orbit.dy - local.dy) * w };
    else fit = (local ?? orbit)!;
    applyFit(camera, viewW, viewH, cam.fov, { s: fit.s * v.zoom, dx: fit.dx * v.zoom + v.panX, dy: fit.dy * v.zoom + v.panY });
  };

  // --- 描画（必要なときだけ描く。見る向きを変えているあいだは毎コマ） ---
  let firstFrame = true;
  const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
  const draw = () => {
    renderer.render(scene, camera);
    canvas.dataset.ready = 'true';
    if (firstFrame) {
      firstFrame = false;
      canvas.dataset.startupMs = String(Math.round(performance.now() - t0));
      console.info(
        `scene ready: total ${Math.round(performance.now() - t0)} ms (bake ${Math.round(bakeMs)} ms, ${archGeo.attributes.position.count} vertices, ${ctx.books.length} books, ${ctx.lamps.length} lamps)`,
      );
      showHint();
    }
  };
  // 操作開始・停止でcanvasをリサイズしない。解像度切替による輪郭の揺れと未描画を防ぐ。
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
    window.removeEventListener('resize', resize);
    window.removeEventListener('orientationchange', resize);
  });
  window.addEventListener('resize', resize);
  window.addEventListener('orientationchange', resize);
  resize();

  canvas.addEventListener('webglcontextlost', (event) => event.preventDefault());
  canvas.addEventListener('webglcontextrestored', () => window.location.reload());

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
    if (import.meta.env.DEV || new URLSearchParams(location.search).has('inspect')) (window as unknown as { __scene?: unknown }).__scene = app;
  } catch (error) {
    (window as unknown as { __disposeScene?: () => void }).__disposeScene?.();
    console.error('3D シーンを初期化できませんでした（WebGL2 が必要です）', error);
    showMessage('このブラウザでは3D表示（WebGL2）を開始できませんでした。最新の Chrome、Safari、Firefox、Edge のいずれかで開いてください。');
  }
}
