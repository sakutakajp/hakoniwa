# Viewer recovery and public camera controls

`SceneFrame.vue` owns iframe readiness, the existing WebP poster, initial failure / context loss / timeout recovery, fresh iframe retries, and accessible camera buttons. Gallery thumbnails remain static; only a selected route loads a scene. URLs and artwork assets are unchanged. The same-origin frame is polled every 500ms; a 45-second readiness timeout offers recovery without claiming a measured percentage. Explicit scene error messages take precedence over ready markers, and late successful readiness may recover. A low-quality link changes the page key so an existing iframe is replaced; an already-low scene uses the retry button.

The scene exposes `window.__hakoniwaControls` through `exhibits/shared/public-controls.ts`. This narrow interface wraps the existing controller's `set` / `reset`; it does not synthesize keyboard events, post unrecognized messages, or expose renderer / inspector internals:

- `rotate(degrees)` bounds one action to ±45 degrees.
- `zoom(factor)` bounds one multiplier to 0.5–2; existing scene zoom limits still apply.
- `reset()` restores the existing home view.
- `setPaused(boolean)` disables water motion and camera inertia/smoothing while preserving explicit camera actions.
- `paused` reports the current preference.

All six scene entry points install this interface. OS reduced-motion changes update the same state; the user may explicitly toggle it afterward. Scene lifecycle cleanup removes the API and media-query listener, while retained API references become inert. Context loss sets an unavailable marker, allowing the shell to show the poster and recovery. The existing context-restored reload remains in place. Menu Escape returns focus to its summary; a focused retry notice transfers focus to the first enabled camera button when the scene becomes ready.

Tokens use the scoped `--hakoniwa-*` namespace so consumers can override warm surfaces, text, muted text, border, focus and radius without applying the host accent to artwork. Gallery description layout follows normal grid flow and reduced-motion removes image hover scaling.

Validation commands:

```
npm run typecheck:exhibits
npm run typecheck
npm run test:indexing
npm run test:controls
npm run build
PORT=3147 HOST=127.0.0.1 node .output/server/index.mjs
BASE_URL=http://127.0.0.1:3147 npm run test:viewer
```

Browser checks use local Chromium/SwiftShader, not live production or real-device performance. They cover gallery desktop/mobile widths, no gallery scene requests, injected initialization failure, real-scene retry, camera actions, dynamic reduced-motion and return navigation. Full six-scene visual regression, Safari/Firefox and physical-device GPU coverage remain separate checks.
