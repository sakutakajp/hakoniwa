import { withNoindexMeta } from '../shared/indexing.ts';
import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { cpSync, mkdirSync, readdirSync } from 'node:fs';
import { createRequire } from 'node:module';

const root = fileURLToPath(new URL('.', import.meta.url));
const names = ['sand-pedestal', 'nyc-diorama', 'library-diorama', 'dino-diorama', 'electric-town-diorama', 'library-20m'];

export function createExhibitsConfig(outDir = resolve(root, '../public/ja/hakoniwa/exhibits')) {
  return defineConfig({
  root,
  base: '/ja/hakoniwa/exhibits/',
  publicDir: false,
  plugins: [{
    name: 'exhibit-licenses',
    transformIndexHtml: html => withNoindexMeta(html),
    closeBundle() {
      const directory = resolve(outDir, 'licenses');
      mkdirSync(directory, { recursive: true });
      const require = createRequire(import.meta.url);
      cpSync(resolve(require.resolve('three'), '../../LICENSE'), resolve(directory, 'THREE-LICENSE.txt'));
      const fonts = resolve(root, 'electric-town-diorama/fonts');
      for (const file of readdirSync(fonts).filter(file => file.endsWith('.txt'))) {
        cpSync(resolve(fonts, file), resolve(directory, file));
      }
    },
  }],
  build: {
    outDir,
    emptyOutDir: true,
    rollupOptions: {
      input: Object.fromEntries(names.map(name => [name, resolve(root, name, 'index.html')])),
    },
  },
  });
}

export default createExhibitsConfig();
