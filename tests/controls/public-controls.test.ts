import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installPublicControls, type PublicSceneControls } from '../../exhibits/shared/public-controls';

test('public controls bound commands, react to OS preference, and become inert on disposal', () => {
  const preference = Object.assign(new EventTarget(), { matches: false });
  const target = { matchMedia: () => preference } as unknown as Window & { __hakoniwaControls?: PublicSceneControls };
  const current = { azimuth: 0, zoom: 1 };
  let reduced = false;
  let sceneReduced = false;
  const dispose = installPublicControls(target, {
    current,
    set: state => Object.assign(current, state),
    reset: () => Object.assign(current, { azimuth: 0, zoom: 1 }),
    setReducedMotion: value => { reduced = value; },
  }, value => { sceneReduced = value; });
  const api = target.__hakoniwaControls!;
  api.rotate(999); assert.equal(current.azimuth, 45);
  api.rotate(NaN); assert.equal(current.azimuth, 45);
  api.zoom(100); assert.equal(current.zoom, 2);
  api.zoom(-1); assert.equal(current.zoom, 2);
  api.reset(); assert.deepEqual(current, { azimuth: 0, zoom: 1 });
  preference.matches = true; preference.dispatchEvent(new Event('change'));
  assert.equal(api.paused, true); assert.equal(reduced, true); assert.equal(sceneReduced, true);
  api.setPaused(false); assert.equal(sceneReduced, false);
  dispose();
  assert.equal(target.__hakoniwaControls, undefined);
  api.rotate(15); api.setPaused(true);
  assert.equal(current.azimuth, 0); assert.equal(sceneReduced, false);
  preference.dispatchEvent(new Event('change')); assert.equal(sceneReduced, false);
});
