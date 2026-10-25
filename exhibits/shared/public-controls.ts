/** Small same-origin viewer contract; no renderer or inspector internals escape. */
export interface PublicSceneControls {
  rotate(degrees: number): void;
  zoom(factor: number): void;
  reset(): void;
  setPaused(paused: boolean): void;
  readonly paused: boolean;
}
interface Controls {
  readonly current: { azimuth: number; zoom: number };
  set(state: { azimuth?: number; zoom?: number }, options: { animate: boolean }): void;
  reset(options: { animate: boolean }): void;
  setReducedMotion(value: boolean): void;
}
export function installPublicControls(
  target: Window & { __hakoniwaControls?: PublicSceneControls },
  controls: Controls,
  setMotionReduced: (reduced: boolean) => void,
) {
  const preference = target.matchMedia('(prefers-reduced-motion: reduce)');
  let paused = preference.matches;
  let disposed = false;
  const apply = () => {
    controls.setReducedMotion(paused);
    setMotionReduced(paused);
  };
  const api: PublicSceneControls = {
    rotate: degrees => { if (!disposed && Number.isFinite(degrees)) controls.set({ azimuth: controls.current.azimuth + Math.max(-45, Math.min(45, degrees)) }, { animate: false }); },
    zoom: factor => { if (!disposed && Number.isFinite(factor) && factor > 0) controls.set({ zoom: controls.current.zoom * Math.max(0.5, Math.min(2, factor)) }, { animate: false }); },
    reset: () => { if (!disposed) controls.reset({ animate: false }); },
    setPaused: value => { if (!disposed) { paused = value; apply(); } },
    get paused() { return paused; },
  };
  const onPreference = () => { paused = preference.matches; apply(); };
  preference.addEventListener('change', onPreference);
  target.__hakoniwaControls = api;
  apply();
  return () => {
    disposed = true;
    preference.removeEventListener('change', onPreference);
    if (target.__hakoniwaControls === api) delete target.__hakoniwaControls;
  };
}
