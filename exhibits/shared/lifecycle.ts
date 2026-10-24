import * as THREE from 'three';
import { showAsset } from './asset-view';

/** 各展示は別documentで動かす。切替前にGPUを解放し、非表示中の描画を止める。 */
export function createSceneLifecycle(renderer: THREE.WebGLRenderer, scene: THREE.Scene) {
  let inspection:ReturnType<typeof showAsset>|undefined;
  if(new URLSearchParams(location.search).has('inspect')) (window as any).__showAsset = (kind:Parameters<typeof showAsset>[1]) => { inspection?.dispose(); inspection=showAsset(window,kind); return inspection; };
  let disposed = false;
  const pending = new Set<FrameRequestCallback>();
  const frames = new Set<number>();
  const cleanups: Array<() => void> = [];
  const schedule = (callback: FrameRequestCallback) => {
    if (disposed) return;
    if (document.hidden) { pending.add(callback); return; }
    const id = requestAnimationFrame(time => {
      frames.delete(id);
      if (disposed) return;
      if (document.hidden) pending.add(callback);
      else callback(time);
    });
    frames.add(id);
  };
  const onVisibility = () => {
    if (document.hidden || disposed) return;
    const callbacks = [...pending];
    pending.clear();
    callbacks.forEach(schedule);
  };
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    frames.forEach(cancelAnimationFrame);
    frames.clear();
    pending.clear();
    inspection?.dispose();
    cleanups.forEach(cleanup => cleanup());
    document.removeEventListener('visibilitychange', onVisibility);
    window.removeEventListener('pagehide', dispose);
    const geometries = new Set<THREE.BufferGeometry>();
    const materials = new Set<THREE.Material>();
    const textures = new Set<THREE.Texture>();
    scene.traverse(object => {
      if (!(object instanceof THREE.Mesh)) return;
      geometries.add(object.geometry);
      const list = Array.isArray(object.material) ? object.material : [object.material];
      list.forEach(material => {
        materials.add(material);
        Object.values(material).forEach(value => {
          if (value instanceof THREE.Texture) textures.add(value);
        });
      });
    });
    geometries.forEach(value => value.dispose());
    materials.forEach(value => value.dispose());
    textures.forEach(value => value.dispose());
    renderer.dispose();
    // シェーダーのuniformや水面用render targetを含む残りのGPU資源も解放する。
    renderer.forceContextLoss();
    scene.clear();
    renderer.domElement.dataset.disposed = 'true';
  };
  document.addEventListener('visibilitychange', onVisibility);
  window.addEventListener('pagehide', dispose);
  // 同一オリジンの展示室がiframeを取り外す前に呼ぶ。
  (window as unknown as { __disposeScene: () => void }).__disposeScene = dispose;
  window.addEventListener('pageshow', event => { if (event.persisted && disposed) location.reload(); });
  return { schedule, dispose, addCleanup: (cleanup: () => void) => cleanups.push(cleanup) };
}
