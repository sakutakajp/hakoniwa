import { defineNuxtModule } from '@nuxt/kit';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Build iframe-only 3D assets even when this repository is used through extends. */
export default defineNuxtModule({
  meta: { name: 'hakoniwa-exhibits', compatibility: { nuxt: '^3.14.1592 || ^4.0.0' } },
  setup(_options, nuxt) {
    const layerRoot = fileURLToPath(new URL('../', import.meta.url));
    // GitHub archives include development tests unlike an npm package. Do not
    // pull those tests into the consuming app's typecheck through layer scanning.
    nuxt.hook('prepare:types', ({ tsConfig }) => {
      tsConfig.exclude ||= [];
      tsConfig.exclude.push(resolve(layerRoot, 'tests/**/*'));
    });
    // Installed layers may be read-only. Keep generated files in the consumer's build dir.
    const outDir = resolve(nuxt.options.buildDir, 'hakoniwa-exhibits');
    nuxt.hook('nitro:config', nitro => {
      nitro.publicAssets ||= [];
      nitro.publicAssets.push({ dir: outDir, baseURL: '/ja/hakoniwa/exhibits/', maxAge: 0 });
    });
    // The CLI clears buildDir after loading Nuxt. Build only after that cleanup.
    nuxt.hook('build:before', async () => {
      if (nuxt.options._prepare) return;
      const [{ build }, { createExhibitsConfig }] = await Promise.all([
        import('vite'),
        import('../exhibits/vite.config'),
      ]);
      await build({ ...createExhibitsConfig(outDir), configFile: false });
    });
  },
});
