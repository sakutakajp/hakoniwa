# Independent consumer fixture

This fixture pins the existing consumer baseline rather than upgrading it:

- Nuxt 3.14.1592
- Vue 3.5.13 / Vue Router 4.4.5
- Nitro 2.10.4
- Vite 5.4.14
- Rollup 4.34.9 / Nuxi 3.22.3 / Unstorage 1.15.0

`@rollup/plugin-replace` is locked to 6.0.2: 6.0.3 no longer replaces the
`import.meta.` prefix expected by Nitro 2.10.4, breaking every static asset's
Node-server path. This is a compatibility lock, not an app-framework upgrade.

Its own app, default layout, CSS, metadata, `/`, `/about`, `/dev/assets`,
`/plain.html`, and `/exhibits/host.txt` must survive extending Hakoniwa.

From the **layer repository root**:

```sh
npm run build:consumer
npm run test:layer:http
npm run test:layer
```

`tests/fixtures/build-consumer.mjs` packs the layer without publishing it, installs
that tarball into a separate temporary project, then builds and type-checks using
that project's pinned Nuxt. It also checks that generated files do not leak into
the installed layer package. The temporary project defaults to
`$TMPDIR/hakoniwa-consumer-nuxt3` (usually `/tmp/hakoniwa-consumer-nuxt3`). Set
`LAYER_CONSUMER_DIR` consistently for all commands to use another directory outside
the layer checkout. An ownership marker prevents overwriting an unrelated folder.

The browser-free HTTP suite checks SSR routes, host isolation, all generated scene
HTML/chunk URLs, static metadata, and Three.js bundle separation. The full suite
also checks browser navigation/style restoration and one real WebGL scene; it
requires Chromium (default `/usr/bin/chromium`, override `CHROMIUM_PATH`). An
existing consumer server can be selected with `LAYER_URL`.
