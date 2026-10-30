# Independent consumer fixture

This fixture pins the Nuxt 4 host baseline:

- Nuxt 4.6.3
- Vue 3.5.44 / Vue Router 5.4.0
- Node `^22.22.3 || ^24.15.0 || >=26.0.0` (Node 24 recommended)

Nitro, the Nuxt Vite builder, Rollup and CLI are resolved by Nuxt and frozen in
package-lock.json. Old Nuxt 3 Nitro/Rollup/Unstorage overrides are intentionally
removed rather than forcing obsolete transitive packages into Nuxt 4.
The Layer's separate iframe exhibit build uses Vite 7.3.7; Nuxt's app builder
uses its own compatible Vite version.

Its own app, default layout, CSS, metadata, `/`, `/about`, `/dev/assets`,
`/plain.html`, and `/exhibits/host.txt` must survive extending Hakoniwa.

From the **layer repository root**:

```sh
npm run build:consumer
npm run test:layer:http
npm run test:layer
# Also validate the npm-published files list independently:
LAYER_PACKAGE_MODE=npm npm run build:consumer
```

`tests/fixtures/build-consumer.mjs` defaults to **source-archive mode**. It creates
a temporary Git index, snapshots the current non-ignored working files, and uses
`git archive` to extract a clean Layer outside the checkout. This includes all
repository tests and configs (not just the npm `files` whitelist), but no ignored
`.nuxt`, output, or dependencies. The real Git index is never modified. Set
`LAYER_SOURCE_REF=<commit SHA>` to verify that exact committed archive instead.

The extracted Layer installs dependencies with `--ignore-scripts`; its `.nuxt`
must remain absent. The independent consumer then runs prepare, production build,
and typecheck using the pinned Nuxt versions. The helper verifies that no generated
files leak into the Layer before or after those steps. This catches the GitHub
archive-specific tsconfig/test-boundary failures that an npm tarball can hide.

`LAYER_PACKAGE_MODE=npm` retains the separate npm-pack/install validation without
publishing anything. Both modes use a temporary consumer project, defaulting to
`$TMPDIR/hakoniwa-consumer-nuxt4` (usually `/tmp/hakoniwa-consumer-nuxt4`). Set
`LAYER_CONSUMER_DIR` consistently for all commands to use another directory outside
the layer checkout. An ownership marker prevents overwriting an unrelated folder.

The browser-free HTTP suite checks SSR routes, host isolation, all generated scene
HTML/chunk URLs, static metadata, and Three.js bundle separation. The full suite
also checks browser navigation/style restoration and one real WebGL scene; it
requires Chromium (default `/usr/bin/chromium`, override `CHROMIUM_PATH`). An
existing consumer server can be selected with `LAYER_URL`.
