/**
 * 箱庭の見る向きを変える操作（マウス・タッチ・キーボード）。
 *  - ドラッグ：まわりを回る（左右で方位、上下で見下ろす角度）。手を離すと少し惰性で回る
 *  - ホイール・ピンチ（トラックパッドのピンチを含む）：拡大縮小（指した所に向かって）
 *  - 右ドラッグ・Shift＋ドラッグ・2 本指のドラッグ：画面の中で平行移動
 *  - ダブルクリック・ダブルタップ・0 キー：元の向きに戻す
 *  - 矢印キー：回す・傾ける。＋／−：拡大縮小
 * 角度は度、拡大はかけ算の倍率、平行移動は画面の座標（-1〜1）で持つ。
 * 目標の値にいまの値がなめらかに追いつく（動きを減らす設定のときはすぐに合わせる）。
 */

export interface ViewState {
  /** 方位角（度。0 = 手前、90 = 右から） */
  azimuth: number;
  /** 見下ろす角度（度） */
  elevation: number;
  /** 拡大の倍率（1 で元の大きさ） */
  zoom: number;
  /** 画面の中での平行移動（画面の幅・高さを 2 とした座標） */
  panX: number;
  panY: number;
}

export interface ViewControlsOptions {
  /** 元に戻すときの向き */
  home: { azimuth: number; elevation: number };
  /** 見下ろす角度の範囲（度） */
  elevationRange: [number, number];
  /** 拡大の倍率の範囲 */
  zoomRange: [number, number];
  /** 画面の高さ分ドラッグしたときに回る角度（度） */
  rotateSpeed: number;
  /** 目標に追いつく速さ（1 秒あたり。大きいほどきびきび動く） */
  damping: number;
  /** 手を離したあとの惰性が弱まる速さ（1 秒あたり。大きいほど早く止まる） */
  inertia: number;
  /** 動きを減らす設定（なめらかな追従と惰性を省く） */
  reduceMotion: boolean;
  /** 見る向きが変わり始めたときに呼ぶ（描画の再開） */
  onChange: () => void;
  /** 最初の操作のときに 1 回だけ呼ぶ（操作の案内を消す） */
  onFirstInteraction?: () => void;
}

export interface ViewControls {
  /** いまの見る向き（なめらかに動いている途中の値） */
  readonly current: ViewState;
  /** 1 コマ進める。見る向きが変わったら true */
  update: (dt: number) => boolean;
  /** 動いている途中か（目標に追いついていない、または惰性で回っている） */
  isMoving: () => boolean;
  /** 指を触れている・ドラッグしているあいだ true */
  isInteracting: () => boolean;
  /** 見る向きを変える（指定しない項目はそのまま）。animate: false ですぐに合わせる */
  set: (state: Partial<ViewState>, opts?: { animate?: boolean }) => void;
  /** 元の向き・大きさに戻す */
  reset: (opts?: { animate?: boolean }) => void;
  /** 操作の受け付けを止める・再開する */
  setEnabled: (enabled: boolean) => void;
  setReducedMotion: (value: boolean) => void;
  dispose: () => void;
}

const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);
/** 手を離したあとに惰性で回る速さの上限（度 / 秒） */
const MAX_SPIN = 320;

export function createViewControls(element: HTMLElement, opts: ViewControlsOptions): ViewControls {
  const [elMin, elMax] = opts.elevationRange;
  const [zMin, zMax] = opts.zoomRange;
  const home = (): ViewState => ({
    azimuth: opts.home.azimuth,
    elevation: clamp(opts.home.elevation, elMin, elMax),
    zoom: 1,
    panX: 0,
    panY: 0,
  });
  const target = home();
  const current = home();
  const velocity = { az: 0, el: 0 };
  /** set で current をすぐに合わせたとき、次の update で変わったことを知らせる */
  let snapped = false;
  let enabled = true;
  let firstDone = false;

  const first = () => {
    if (firstDone) return;
    firstDone = true;
    opts.onFirstInteraction?.();
  };
  const changed = () => {
    first();
    opts.onChange();
  };

  /** 平行移動は、拡大の倍率に応じて内容が画面から出ていかない範囲に限る */
  const clampPan = (s: ViewState) => {
    const limit = 0.25 + 0.75 * s.zoom;
    s.panX = clamp(s.panX, -limit, limit);
    s.panY = clamp(s.panY, -limit, limit);
  };

  /** 画面上の点 (mx, my)（-1〜1）に向かって f 倍に拡大する */
  const zoomAt = (f: number, mx: number, my: number) => {
    const z = clamp(target.zoom * f, zMin, zMax);
    const g = z / target.zoom;
    target.panX = g * target.panX + (1 - g) * mx;
    target.panY = g * target.panY + (1 - g) * my;
    target.zoom = z;
    clampPan(target);
  };

  /** 要素の中の位置（CSS の画素）を画面の座標（-1〜1）にする */
  const toScreen = (clientX: number, clientY: number) => {
    const r = element.getBoundingClientRect();
    return {
      x: ((clientX - r.left) / Math.max(r.width, 1)) * 2 - 1,
      y: 1 - ((clientY - r.top) / Math.max(r.height, 1)) * 2,
    };
  };

  // ===== ポインター（マウス・タッチ・ペン） =====
  const pointers = new Map<number, { x: number; y: number }>();
  let mode: 'rotate' | 'pan' | null = null;
  let lastMove = 0;
  let pinch: { dist: number; mx: number; my: number } | null = null;
  let lastTap = { time: 0, x: 0, y: 0 };
  let downInfo = { time: 0, x: 0, y: 0, moved: 0 };

  const pinchState = () => {
    const [a, b] = [...pointers.values()];
    const m = toScreen((a.x + b.x) / 2, (a.y + b.y) / 2);
    return { dist: Math.hypot(a.x - b.x, a.y - b.y), mx: m.x, my: m.y };
  };

  const onPointerDown = (e: PointerEvent) => {
    if (!enabled) return;
    if (e.pointerType === 'mouse' && e.button !== 0 && e.button !== 2) return;
    element.setPointerCapture?.(e.pointerId);
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    velocity.az = 0;
    velocity.el = 0;
    first();
    if (pointers.size === 1) {
      mode = e.button === 2 || e.shiftKey || e.ctrlKey || e.metaKey ? 'pan' : 'rotate';
      downInfo = { time: performance.now(), x: e.clientX, y: e.clientY, moved: 0 };
      lastMove = performance.now();
    } else if (pointers.size === 2) {
      mode = null;
      pinch = pinchState();
    }
    element.classList.add('is-dragging');
  };

  const onPointerMove = (e: PointerEvent) => {
    const p = pointers.get(e.pointerId);
    if (!p || !enabled) return;
    const dxPx = e.clientX - p.x;
    const dyPx = e.clientY - p.y;
    p.x = e.clientX;
    p.y = e.clientY;
    const r = element.getBoundingClientRect();
    const h = Math.max(r.height, 1);
    const w = Math.max(r.width, 1);
    if (pointers.size === 1) {
      downInfo.moved = Math.max(downInfo.moved, Math.hypot(e.clientX - downInfo.x, e.clientY - downInfo.y));
      if (mode === 'rotate') {
        const k = opts.rotateSpeed / h;
        const dAz = -dxPx * k;
        const dEl = dyPx * k * 0.6;
        target.azimuth += dAz;
        target.elevation = clamp(target.elevation + dEl, elMin, elMax);
        // 惰性用の速さ（度 / 秒）。最近の動きほど重く
        const now = performance.now();
        const dt = Math.max((now - lastMove) / 1000, 1 / 240);
        lastMove = now;
        const a = Math.min(1, dt * 18);
        velocity.az += (dAz / dt - velocity.az) * a;
        velocity.el += (dEl / dt - velocity.el) * a;
      } else if (mode === 'pan') {
        target.panX += (2 * dxPx) / w;
        target.panY -= (2 * dyPx) / h;
        clampPan(target);
      }
      changed();
    } else if (pointers.size === 2 && pinch) {
      const next = pinchState();
      if (pinch.dist > 1 && next.dist > 1) zoomAt(next.dist / pinch.dist, next.mx, next.my);
      // 2 本指を一緒に動かすと平行移動
      target.panX += next.mx - pinch.mx;
      target.panY += next.my - pinch.my;
      clampPan(target);
      pinch = next;
      changed();
    }
  };

  const onPointerUp = (e: PointerEvent) => {
    if (!pointers.has(e.pointerId)) return;
    pointers.delete(e.pointerId);
    element.releasePointerCapture?.(e.pointerId);
    const now = performance.now();
    if (pointers.size === 0) {
      element.classList.remove('is-dragging');
      // 最後に動かしてからすぐ離したときだけ、惰性で回り続ける（速すぎる回転は抑える）
      if (mode !== 'rotate' || opts.reduceMotion || now - lastMove > 90) {
        velocity.az = 0;
        velocity.el = 0;
      } else {
        velocity.az = clamp(velocity.az, -MAX_SPIN, MAX_SPIN);
        velocity.el = clamp(velocity.el, -MAX_SPIN / 2, MAX_SPIN / 2);
        changed();
      }
      // ダブルタップ（タッチ）：ほとんど動かさずに短く 2 回触れたら元に戻す
      if (e.pointerType === 'touch' && downInfo.moved < 10 && now - downInfo.time < 300) {
        if (now - lastTap.time < 320 && Math.hypot(e.clientX - lastTap.x, e.clientY - lastTap.y) < 30) {
          reset();
          lastTap = { time: 0, x: 0, y: 0 };
        } else {
          lastTap = { time: now, x: e.clientX, y: e.clientY };
        }
      }
      mode = null;
      pinch = null;
    } else if (pointers.size === 1) {
      // 2 本指の一方を離したら、残った指で回す
      pinch = null;
      mode = 'rotate';
      lastMove = now;
      velocity.az = 0;
      velocity.el = 0;
    }
  };

  const onWheel = (e: WheelEvent) => {
    if (!enabled) return;
    e.preventDefault();
    const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 400 : 1;
    // トラックパッドのピンチ（ctrlKey 付きのホイール）は値が小さいので強めに効かせる
    const k = e.ctrlKey ? 0.01 : 0.0015;
    const m = toScreen(e.clientX, e.clientY);
    zoomAt(Math.exp(-e.deltaY * unit * k), m.x, m.y);
    changed();
  };

  // Safari（macOS）のトラックパッドのピンチ
  let gestureScale = 1;
  // iPhone / iPad の Safari では 2 本指のピンチでもこのイベントが来るので、指で触れているとき（ポインターで処理済み）は使わない
  const onGestureStart = (e: Event) => {
    if (!enabled) return;
    e.preventDefault();
    gestureScale = (e as unknown as { scale: number }).scale || 1;
  };
  const onGestureChange = (e: Event) => {
    if (!enabled) return;
    e.preventDefault();
    if (pointers.size > 0) return;
    const g = e as unknown as { scale: number; clientX: number; clientY: number };
    const s = g.scale || 1;
    const m = toScreen(g.clientX ?? 0, g.clientY ?? 0);
    zoomAt(s / gestureScale, m.x, m.y);
    gestureScale = s;
    changed();
  };

  const onDblClick = (e: MouseEvent) => {
    if (!enabled) return;
    e.preventDefault();
    reset();
  };

  const onKeyDown = (e: KeyboardEvent) => {
    if (!enabled || e.altKey || e.metaKey || e.ctrlKey) return;
    const stepAz = e.shiftKey ? 45 : 15;
    switch (e.key) {
      case 'ArrowLeft':
        target.azimuth += stepAz;
        break;
      case 'ArrowRight':
        target.azimuth -= stepAz;
        break;
      case 'ArrowUp':
        target.elevation = clamp(target.elevation + 5, elMin, elMax);
        break;
      case 'ArrowDown':
        target.elevation = clamp(target.elevation - 5, elMin, elMax);
        break;
      case '+':
      case '=':
        zoomAt(1.2, 0, 0);
        break;
      case '-':
      case '_':
        zoomAt(1 / 1.2, 0, 0);
        break;
      case '0':
      case 'Home':
        reset();
        e.preventDefault();
        return;
      default:
        return;
    }
    e.preventDefault();
    velocity.az = 0;
    velocity.el = 0;
    changed();
  };

  const onContextMenu = (e: Event) => e.preventDefault();

  element.addEventListener('pointerdown', onPointerDown);
  element.addEventListener('pointermove', onPointerMove);
  element.addEventListener('pointerup', onPointerUp);
  element.addEventListener('pointercancel', onPointerUp);
  element.addEventListener('wheel', onWheel, { passive: false });
  element.addEventListener('gesturestart', onGestureStart);
  element.addEventListener('gesturechange', onGestureChange);
  element.addEventListener('dblclick', onDblClick);
  element.addEventListener('keydown', onKeyDown);
  element.addEventListener('contextmenu', onContextMenu);

  const keys: (keyof ViewState)[] = ['azimuth', 'elevation', 'zoom', 'panX', 'panY'];
  /** 目標との差がこれより小さければ追いついたとみなす */
  const eps: Record<keyof ViewState, number> = { azimuth: 0.01, elevation: 0.01, zoom: 0.0005, panX: 0.0005, panY: 0.0005 };
  const inertiaActive = () => Math.abs(velocity.az) > 0.5 || Math.abs(velocity.el) > 0.5;

  const update = (dt: number) => {
    let moved = snapped;
    snapped = false;
    // 手を離したあとの惰性
    if (pointers.size === 0 && inertiaActive()) {
      // 速さが指数的に弱まるときの移動量をそのまま積分する（1 コマが長くても行き過ぎない）
      const decay = Math.exp(-opts.inertia * dt);
      const travel = (1 - decay) / opts.inertia;
      target.azimuth += velocity.az * travel;
      const el = clamp(target.elevation + velocity.el * travel, elMin, elMax);
      if (el === elMin || el === elMax) velocity.el = 0;
      target.elevation = el;
      velocity.az *= decay;
      velocity.el *= decay;
      if (!inertiaActive()) {
        velocity.az = 0;
        velocity.el = 0;
      }
    }
    const a = opts.reduceMotion ? 1 : 1 - Math.exp(-opts.damping * dt);
    for (const k of keys) {
      const d = target[k] - current[k];
      if (Math.abs(d) <= eps[k]) {
        if (d !== 0) {
          current[k] = target[k];
          moved = true;
        }
        continue;
      }
      current[k] += d * a;
      moved = true;
    }
    return moved;
  };

  const isMoving = () => snapped || inertiaActive() || keys.some((k) => Math.abs(target[k] - current[k]) > 0);

  const set = (state: Partial<ViewState>, o: { animate?: boolean } = {}) => {
    if (state.azimuth !== undefined) {
      // 遠回りしないよう、いまの向きに近い同じ方位にそろえる
      const d = ((((state.azimuth - target.azimuth) % 360) + 540) % 360) - 180;
      target.azimuth += d;
    }
    if (state.elevation !== undefined) target.elevation = clamp(state.elevation, elMin, elMax);
    if (state.zoom !== undefined) target.zoom = clamp(state.zoom, zMin, zMax);
    if (state.panX !== undefined) target.panX = state.panX;
    if (state.panY !== undefined) target.panY = state.panY;
    clampPan(target);
    velocity.az = 0;
    velocity.el = 0;
    if (o.animate === false || opts.reduceMotion) {
      for (const k of keys) current[k] = target[k];
      snapped = true;
    }
    opts.onChange();
  };

  const reset = (o: { animate?: boolean } = {}) => set(home(), o);

  return {
    current,
    update,
    isMoving,
    isInteracting: () => pointers.size > 0,
    set,
    reset,
    setEnabled: (v: boolean) => {
      enabled = v;
      if (!v) {
        pointers.clear();
        mode = null;
        pinch = null;
        element.classList.remove('is-dragging');
      }
    },
    setReducedMotion: value => {
      opts.reduceMotion = value;
      velocity.az = 0;
      velocity.el = 0;
      set(target, { animate: false });
    },
    dispose: () => {
      element.removeEventListener('pointerdown', onPointerDown);
      element.removeEventListener('pointermove', onPointerMove);
      element.removeEventListener('pointerup', onPointerUp);
      element.removeEventListener('pointercancel', onPointerUp);
      element.removeEventListener('wheel', onWheel);
      element.removeEventListener('gesturestart', onGestureStart);
      element.removeEventListener('gesturechange', onGestureChange);
      element.removeEventListener('dblclick', onDblClick);
      element.removeEventListener('keydown', onKeyDown);
      element.removeEventListener('contextmenu', onContextMenu);
    },
  };
}
